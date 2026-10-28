import { createHash } from 'node:crypto';
import { ChatAnthropic } from '@langchain/anthropic';
import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { Document } from '@langchain/core/documents';
import { createAgent, providerStrategy, tool } from 'langchain';
import { z } from 'zod';
import SummarySDK, {
  isTimeZone,
  localDate,
  toDate,
} from '../Summary/summary.sdk.ts';
import { DEFAULT_MODEL, DEFAULT_TIME_ZONE } from '../Summary/summary.schema.ts';
import {
  CACHE_SIZE,
  DEFAULT_RESULTS,
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  SEARCH_K,
} from './search.schema.ts';

import type {
  EntryMetadata,
  ParseUser,
  RequestOptions,
  SearchParams,
  SearchResponse,
  SearchSDK,
  SearchTask,
  SummaryObject,
  TaskObject,
  Week,
  WeekHit,
  WeekOverview,
} from './search.types.ts';

const SYSTEM_PROMPT = `You answer questions about one person's past weeks, using the weekly productivity summaries from their task tracker. Each week is an ISO week labelled YYYY-WW.

You have four tools:
- list_weeks: every week's numbers (tasks completed, started and touched, completion rate, hours by focus level and priority, share of hours by focus, status changes, open high-priority work) and the names of the tasks completed and worked on.
- get_week: the full text of one week: its summary paragraph, numbers and tasks with descriptions.
- search_weeks: semantic search over the weeks' summaries and tasks. Use it to find weeks by the kind of work done, e.g. "coding", "writing tests", "design".
- similar_weeks: the weeks whose completed tasks are most like a given week's.

How to judge weeks:
- Kinds of work: task names and descriptions are free text with no category, so decide from them which tasks fit (for example coding covers implementing features, cloud functions, tests, CI and refactoring, but not writing docs or audits). Use search_weeks to find candidates, then check them against list_weeks or get_week.
- "A lot" is relative: compare the weeks with each other rather than using a fixed number.
- Highly focused: a large share of hours on high-focus tasks, work finished rather than left open, few status changes per completed task.
- Distracted: hours spread across many tasks or mostly on low-focus work, many tasks touched but few completed, lots of status changes without completions, or high-priority work left open while low-priority work got done.
- Similar weeks: use similar_weeks, then confirm the overlap with get_week.

Only name weeks the tools returned, and base every reason on what they returned. Leave out weeks that don't fit, even if that leaves fewer than asked for or none.

Then return:
- answer: one or two sentences answering the question, addressed to the person ("you").
- weeks: the matching weeks, best first, each with a one-sentence reason citing the evidence (task names or numbers).`;

// What the agent must return, sent as Anthropic's output_config.format.
const ANSWER_SCHEMA = z.object({
  answer: z.string().describe('Short answer to the question, to the user.'),
  weeks: z
    .array(
      z.object({
        week: z.string().describe('Week label, YYYY-WW.'),
        reason: z.string().describe('Why this week matches, with evidence.'),
      }),
    )
    .describe('Matching weeks, best first.'),
});

const round = (n: number): number => Math.round(n * 100) / 100;

// FAISS returns squared L2 distances; the embeddings are normalized, so this
// turns one back into cosine similarity.
const similarity = (distance: number): number => round(1 - distance / 2);

const toTask = (task: TaskObject): SearchTask => ({
  task: task.get('task') ?? '(untitled)',
  description: task.get('description'),
  status: task.get('status') ?? 'pending',
  priority: task.get('priority') ?? 'unset',
  focus: task.get('focus') ?? 'unset',
  hours: task.get('hours') ?? 0,
});

const describeTask = ({
  task,
  description,
  focus,
  priority,
  hours,
}: SearchTask) =>
  `${task} (focus ${focus}, priority ${priority}, ${hours}h)` +
  (description ? `: ${description}` : '');

class Search implements SearchSDK {
  // Built indexes by user id, least recently used first. key identifies the
  // weeks an index was built from.
  #cache = new Map<string, { key: string; store: FaissStore }>();

  constructor() {}

  // One overview entry per week, plus one per task completed or worked on in
  // it, so a search for a kind of work can match a single task rather than a
  // whole week's text.
  documents(weeks: Week[]): Document<EntryMetadata>[] {
    return weeks.flatMap((week) => {
      const overview = this.overview(week);
      const docs: Document<EntryMetadata>[] = [
        new Document({
          pageContent: [
            `Week ${week.week} (${overview.start} to ${overview.end})`,
            week.text,
            `Completed ${overview.completed} of ${overview.tasksTouched} tasks touched; ${overview.totalHours} hours.`,
            `Completed: ${overview.completedTasks.join('; ') || 'nothing'}`,
            `Worked on: ${overview.workedTasks.join('; ') || 'nothing'}`,
          ]
            .filter(Boolean)
            .join('\n'),
          metadata: { week: week.week, kind: 'overview' },
        }),
      ];

      for (const kind of ['completed', 'worked'] as const) {
        for (const task of week[kind]) {
          docs.push(
            new Document({
              pageContent: `${kind === 'completed' ? 'Completed' : 'Worked on'}: ${describeTask(task)}`,
              metadata: { week: week.week, kind, task: task.task },
            }),
          );
        }
      }

      return docs;
    });
  }

  // Embeds the weeks into a FAISS index, or reuses the one built for this
  // user if the weeks' text hasn't changed since. Returns null when there's
  // nothing to index.
  async index(userId: string, weeks: Week[]): Promise<FaissStore | null> {
    const docs = this.documents(weeks);
    if (docs.length === 0) return null;

    const key = createHash('sha256')
      .update(
        JSON.stringify(docs.map((doc) => [doc.metadata, doc.pageContent])),
      )
      .digest('hex');

    const cached = this.#cache.get(userId);
    this.#cache.delete(userId);

    const store =
      cached?.key === key
        ? cached.store
        : await FaissStore.fromDocuments(docs, SummarySDK.embeddings);

    this.#cache.set(userId, { key, store });
    if (this.#cache.size > CACHE_SIZE) {
      this.#cache.delete(this.#cache.keys().next().value!);
    }

    return store;
  }

  overview(week: Week): WeekOverview {
    const { metrics } = week;
    const timeZone = metrics.timeZone ?? DEFAULT_TIME_ZONE;
    const totalHours = metrics.totalHours ?? 0;

    const focusShare = Object.fromEntries(
      Object.entries(metrics.hoursByFocus ?? {}).map(([focus, hours]) => [
        focus,
        totalHours > 0 ? round(hours / totalHours) : 0,
      ]),
    );

    return {
      week: week.week,
      start: localDate(week.start, timeZone),
      end: localDate(week.end, timeZone),
      hasSummary: Boolean(week.summary),
      completed: metrics.completed ?? 0,
      started: metrics.started ?? 0,
      tasksTouched: metrics.tasksTouched ?? 0,
      completionRate: metrics.tasksTouched
        ? round((metrics.completed ?? 0) / metrics.tasksTouched)
        : 0,
      statusChanges: metrics.statusChanges ?? 0,
      openHighPriority: metrics.openHighPriority ?? 0,
      totalHours,
      hoursByFocus: metrics.hoursByFocus ?? {},
      hoursByPriority: metrics.hoursByPriority ?? {},
      focusShare,
      completedTasks: week.completed.map(({ task }) => task),
      workedTasks: week.worked.map(({ task }) => task),
    };
  }

  // Loads the user's Summaries and Tasks, indexes them and lets a Claude
  // agent work out which weeks answer the query. Everything is read with the
  // user's session token, so only their own Summaries and Tasks are used.
  async search(
    params: SearchParams = {},
    user: ParseUser | undefined,
  ): Promise<SearchResponse> {
    if (!user?.id) {
      throw new Parse.Error(
        Parse.Error.SESSION_MISSING,
        'search-weeks requires a signed-in user',
      );
    }

    const query = typeof params.query === 'string' ? params.query.trim() : '';

    if (!query || query.length > MAX_QUERY_LENGTH) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        `query must be 1 to ${MAX_QUERY_LENGTH} characters`,
      );
    }

    const timeZone = params.timeZone ?? DEFAULT_TIME_ZONE;

    if (!isTimeZone(timeZone)) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'timeZone must be an IANA time zone, e.g. America/Chicago',
      );
    }

    const limit = Math.min(
      Math.max(Math.floor(params.limit ?? DEFAULT_RESULTS), 1),
      MAX_RESULTS,
    );

    const options = { sessionToken: user.getSessionToken() ?? undefined };
    const [summaries, tasks] = await Promise.all([
      this.summaries(options),
      SummarySDK.tasks(options),
    ]);

    const isOwn = (object: { get(key: 'owner'): ParseUser | undefined }) =>
      object.get('owner')?.id === user.id;

    const current = { ...SummarySDK.weekOf(new Date(), timeZone), timeZone };
    const weeks = this.weeks(
      summaries.filter(isOwn),
      tasks.filter(isOwn),
      current,
    );

    if (!weeks.some((week) => week.summary)) {
      return {
        query,
        answer:
          'You have no weekly summaries yet. Generate one with summary-create, then search again.',
        results: [],
      };
    }

    const store = await this.index(user.id, weeks);
    const report = await this.ask(query, weeks, store!, current.week, limit);
    const byWeek = new Map(weeks.map((week) => [week.week, week]));

    // Keep only weeks that exist, once each, in the agent's order.
    const seen = new Set<string>();
    const results = report.weeks
      .filter(
        ({ week }) => byWeek.has(week) && !seen.has(week) && seen.add(week),
      )
      .slice(0, limit)
      .map(({ week, reason }) => {
        const found = byWeek.get(week)!;
        return {
          week,
          start: found.start.toISOString(),
          end: found.end.toISOString(),
          reason,
          summary: found.summary,
        };
      });

    return { query, answer: report.answer, results };
  }

  // Runs the agent over the weeks and returns its answer.
  async ask(
    query: string,
    weeks: Week[],
    store: FaissStore,
    currentWeek: string,
    limit: number,
  ): Promise<z.infer<typeof ANSWER_SCHEMA>> {
    const byWeek = new Map(weeks.map((week) => [week.week, week]));
    const unknown = (week: string) =>
      `No week ${week}. Weeks: ${[...byWeek.keys()].join(', ')}`;

    const listWeeks = tool(
      async () => JSON.stringify(weeks.map((week) => this.overview(week))),
      {
        name: 'list_weeks',
        description:
          "Returns every week's numbers and task names as JSON, oldest first.",
        schema: z.object({}),
      },
    );

    const getWeek = tool(
      async ({ week }) => {
        const found = byWeek.get(week);
        if (!found) return unknown(week);
        return [
          JSON.stringify(this.overview(found)),
          found.text && `Summary: ${found.text}`,
          `Completed:\n${found.completed.map((t) => `- ${describeTask(t)}`).join('\n') || '- nothing'}`,
          `Worked on:\n${found.worked.map((t) => `- ${describeTask(t)}`).join('\n') || '- nothing'}`,
        ]
          .filter(Boolean)
          .join('\n\n');
      },
      {
        name: 'get_week',
        description:
          'Returns one week in full: its numbers, summary paragraph and tasks with descriptions.',
        schema: z.object({
          week: z.string().describe('Week label, YYYY-WW.'),
        }),
      },
    );

    const searchWeeks = tool(
      async ({ query }) =>
        JSON.stringify(await this.searchWeeks(store, query, MAX_RESULTS)),
      {
        name: 'search_weeks',
        description:
          'Semantic search over the weeks. Returns the closest weeks with a similarity score (higher is closer) and the entries that matched.',
        schema: z.object({
          query: z
            .string()
            .describe('What to look for, e.g. "implementing API features".'),
        }),
      },
    );

    const similarWeeks = tool(
      async ({ week }) => {
        const found = byWeek.get(week);
        if (!found) return unknown(week);
        return JSON.stringify(
          await this.similarWeeks(store, found, MAX_RESULTS),
        );
      },
      {
        name: 'similar_weeks',
        description:
          "Returns the weeks whose completed tasks are most like the given week's, with a similarity score (higher is closer) and the tasks that matched.",
        schema: z.object({
          week: z.string().describe('Week label, YYYY-WW.'),
        }),
      },
    );

    const agent = createAgent({
      model: new ChatAnthropic({
        model: process.env.SUMMARY_MODEL || DEFAULT_MODEL,
        maxTokens: 16000,
      }),
      tools: [listWeeks, getWeek, searchWeeks, similarWeeks],
      systemPrompt: SYSTEM_PROMPT,
      responseFormat: providerStrategy(ANSWER_SCHEMA),
    });

    const result = await agent.invoke({
      messages: [
        {
          role: 'user',
          content: `The current week is ${currentWeek}. Return at most ${limit} weeks.\n\n${query}`,
        },
      ],
    });

    return ANSWER_SCHEMA.parse(result.structuredResponse);
  }

  // Searches the whole index and groups the entries found by week, scoring
  // each week by its closest entry.
  async searchWeeks(
    store: FaissStore,
    query: string,
    limit: number,
  ): Promise<WeekHit[]> {
    const k = Math.min(SEARCH_K, store.index.ntotal());
    const vector = await store.embeddings.embedQuery(query);
    const hits = await store.similaritySearchVectorWithScore(vector, k);

    return this.group(
      hits.map(([doc, distance]) => ({
        metadata: doc.metadata as EntryMetadata,
        score: similarity(distance),
      })),
    ).slice(0, limit);
  }

  // Searches with each of target's completed tasks (or its overview, if it
  // completed nothing) and ranks the other weeks by how many of those tasks
  // they have a close completed match for, then by how close.
  async similarWeeks(
    store: FaissStore,
    target: Week,
    limit: number,
  ): Promise<WeekHit[]> {
    const [overview] = this.documents([target]);
    const probes =
      target.completed.length > 0
        ? target.completed.map((task) => `Completed: ${describeTask(task)}`)
        : [overview.pageContent];

    const k = Math.min(SEARCH_K, store.index.ntotal());
    const vectors = await store.embeddings.embedDocuments(probes);
    const totals = new Map<string, WeekHit & { total: number }>();

    for (const vector of vectors) {
      const hits = await store.similaritySearchVectorWithScore(vector, k);
      const best = this.group(
        hits
          .map(([doc, distance]) => ({
            metadata: doc.metadata as EntryMetadata,
            score: similarity(distance),
          }))
          .filter(
            ({ metadata }) =>
              metadata.week !== target.week &&
              metadata.kind !== 'worked' &&
              (target.completed.length === 0 || metadata.kind === 'completed'),
          ),
      );

      for (const hit of best) {
        const entry = totals.get(hit.week) ?? {
          week: hit.week,
          score: 0,
          matches: [],
          total: 0,
        };
        entry.total += hit.score;
        entry.matches.push(...hit.matches.slice(0, 1));
        totals.set(hit.week, entry);
      }
    }

    return [...totals.values()]
      .map(({ week, total, matches }) => ({
        week,
        // Average over all probes, so a week matching more of them ranks
        // higher.
        score: round(total / probes.length),
        matches: [...new Set(matches)],
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // Groups scored entries by week, keeping each week's best score and the
  // entries that matched, best week first.
  group(hits: { metadata: EntryMetadata; score: number }[]): WeekHit[] {
    const weeks = new Map<string, WeekHit>();

    for (const { metadata, score } of hits) {
      const hit = weeks.get(metadata.week) ?? {
        week: metadata.week,
        score,
        matches: [],
      };
      hit.score = Math.max(hit.score, score);
      hit.matches.push(
        metadata.task ? `${metadata.kind}: ${metadata.task}` : metadata.kind,
      );
      weeks.set(metadata.week, hit);
    }

    return [...weeks.values()].sort((a, b) => b.score - a.score);
  }

  // Pages through Summary.read() until every Summary the caller can see has
  // been loaded.
  async summaries(options: RequestOptions): Promise<SummaryObject[]> {
    const summaries: SummaryObject[] = [];

    for (;;) {
      const page = await SummarySDK.read({ offset: summaries.length }, options);
      summaries.push(...page.results);
      if (page.results.length === 0 || summaries.length >= page.count) break;
    }

    return summaries;
  }

  // Builds a Week for each Summary from its saved window and metrics, and
  // for the current week from the tasks if it has no Summary yet. The tasks
  // completed and worked on are worked out from each task's activity, so
  // older Summaries get them too. Weeks are returned oldest first.
  weeks(
    summaries: SummaryObject[],
    tasks: TaskObject[],
    current: { week: string; start: Date; end: Date; timeZone: string },
  ): Week[] {
    const build = (
      week: string,
      start: Date,
      end: Date,
      summary: SummaryObject | null,
      metrics: Week['metrics'],
    ): Week => {
      const completed: SearchTask[] = [];
      const worked: SearchTask[] = [];

      for (const task of tasks) {
        const activity = SummarySDK.activityIn(task, start, end);
        const startedAt = SummarySDK.startedAt(task);
        const startedIn = startedAt && startedAt >= start && startedAt <= end;

        if (activity.some((entry) => entry.status === 'completed')) {
          completed.push(toTask(task));
        } else if (activity.length > 0 || startedIn) {
          worked.push(toTask(task));
        }
      }

      return {
        week,
        start,
        end,
        summary,
        text: summary?.get('summary') ?? '',
        metrics,
        completed,
        worked,
      };
    };

    const weeks = new Map<string, Week>();

    for (const summary of summaries) {
      const week = summary.get('week');
      const start = toDate(summary.get('start'));
      const end = toDate(summary.get('end'));
      const metrics = summary.get('metrics');

      // Summaries from before weeks were added have no label; skip them.
      if (!week || !start || !end || !metrics) continue;

      weeks.set(week, build(week, start, end, summary, metrics));
    }

    if (!weeks.has(current.week)) {
      const metrics = SummarySDK.metrics(
        tasks,
        current.start,
        current.end,
        current.timeZone,
      );
      weeks.set(
        current.week,
        build(current.week, current.start, current.end, null, metrics),
      );
    }

    return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
  }
}

export default new Search();
