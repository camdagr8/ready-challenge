import { z } from 'zod';
import TaskSDK from '../Task/task.sdk.ts';
import { ChatAnthropic } from '@langchain/anthropic';
import { Document } from '@langchain/core/documents';
import type { Activity } from '../Task/task.types.ts';
import { createAgent, providerStrategy, tool } from 'langchain';
import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/huggingface_transformers';

import {
  CLASS_NAME,
  CLP,
  DEFAULT_MODEL,
  DEFAULT_TIME_ZONE,
  EMBEDDING_MODEL,
  FIELDS,
  READ_LIMIT,
  SEARCH_K,
  SEED_TIME_ZONE,
  SEED_WEEKS,
  WEEK_MS,
} from './summary.schema.ts';

import type {
  FieldSpec,
  ParseUser,
  RequestOptions,
  SchemaResult,
  SummaryCreateParams,
  SummaryObject,
  SummaryReadParams,
  SummaryReadResult,
  SummaryReport,
  SummarySDK,
  SummarySeedResult,
  SummaryWeek,
  TaskObject,
  WeeklyMetrics,
} from './summary.types.ts';

const SYSTEM_PROMPT = `You write weekly productivity reports for one person, based on their task tracker.

You have two tools:
- get_weekly_metrics: the week's numbers (tasks completed and started, hours by focus level and priority, open high-priority work, status counts).
- search_tasks: semantic search over the person's tasks, including descriptions, notes and this week's status changes.

Start with get_weekly_metrics, then use search_tasks to look into what stands out: what got finished, what is stuck or still pending, where high-priority or high-focus hours went. Base every statement on what the tools return and don't invent tasks or numbers.

Then return:
- summary: one paragraph of 4 to 6 sentences, written to the person ("you"), covering what was done this week, how time and focus were spent, and what is still open.
- suggestions: 3 to 5 short, specific suggestions for next week that would improve efficiency or focus, each tied to something in the data (for example a stalled high-priority task, or deep-focus work crowded out by low-priority work). Use single quotes around tasks (for example 
  "Give the open high-priority items, starting with Create the task list view (pending, high priority, medium focus, 0 hours logged), a dedicated block early next week so they don't keep getting pushed behind medium-priority work." Create the task list view should be wrapped in single quotes)`;

// What the agent must return, sent as Anthropic's output_config.format.
const REPORT_SCHEMA = z.object({
  summary: z
    .string()
    .describe('One-paragraph summary of the week, addressed to the user.'),
  suggestions: z
    .array(z.string())
    .describe('3 to 5 specific suggestions to improve efficiency or focus.'),
});

// Activity timestamps can come back as Dates or as encoded { iso } objects.
export const toDate = (value: unknown): Date | null => {
  const iso = (value as { iso?: string } | null)?.iso;
  const date = new Date((iso ?? value) as string | Date);
  return Number.isNaN(date.getTime()) ? null : date;
};

const round = (n: number): number => Math.round(n * 100) / 100;

const DAY_MS = 24 * 60 * 60 * 1000;

// One formatter per time zone; creating them is slow.
const formatters = new Map<string, Intl.DateTimeFormat>();

// The wall-clock date and time in timeZone at date. Throws a RangeError for
// an unknown time zone.
const zonedParts = (date: Date, timeZone: string) => {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, format);
  }

  const parts = Object.fromEntries(
    format
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;

  return parts;
};

// How far timeZone's wall clock is ahead of UTC at date, in ms.
const zoneOffset = (date: Date, timeZone: string): number => {
  const p = zonedParts(date, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - (date.getTime() - date.getUTCMilliseconds());
};

// The instant it's midnight in timeZone on the calendar day that the UTC
// midnight `day` names. Rechecks the offset at the result so a DST change
// between the two is accounted for.
const zonedMidnight = (day: number, timeZone: string): Date => {
  const guess = day - zoneOffset(new Date(day), timeZone);
  return new Date(day - zoneOffset(new Date(guess), timeZone));
};

// The calendar date (YYYY-MM-DD) of date in timeZone.
export const localDate = (date: Date, timeZone: string): string => {
  const { year, month, day } = zonedParts(date, timeZone);
  return [year, month, day].map((n) => String(n).padStart(2, '0')).join('-');
};

// Whether timeZone is an IANA time zone this runtime knows.
export const isTimeZone = (timeZone: unknown): timeZone is string => {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    zonedParts(new Date(), timeZone);
    return true;
  } catch {
    return false;
  }
};

// The ISO week starting on the calendar Monday that the UTC midnight
// `monday` names, with start and end as instants in timeZone. A week with a
// DST change is an hour longer or shorter than 7 days.
const isoWeek = (monday: number, timeZone: string): SummaryWeek => {
  const start = zonedMidnight(monday, timeZone);
  const end = new Date(zonedMidnight(monday + WEEK_MS, timeZone).getTime() - 1);

  const thursday = new Date(monday + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const dayOfYear = (thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS;
  const number = Math.floor(dayOfYear / 7) + 1;

  return { week: `${year}-${String(number).padStart(2, '0')}`, start, end };
};

class Summary implements SummarySDK {
  constructor() {}

  // Loaded once, on first use: the model download and setup are slow.
  #embeddings?: HuggingFaceTransformersEmbeddings;

  get embeddings(): HuggingFaceTransformersEmbeddings {
    this.#embeddings ??= new HuggingFaceTransformersEmbeddings({
      model: EMBEDDING_MODEL,
    });
    return this.#embeddings;
  }

  // A task's activity entries with timestamps in [start, end].
  activityIn(task: TaskObject, start: Date, end: Date): Activity[] {
    return (task.get('activity') ?? []).filter((entry) => {
      const date = toDate(entry.timestamp);
      return date && date >= start && date <= end;
    });
  }

  // Builds a FAISS index over the tasks and lets a Claude agent explore it,
  // along with the metrics, to write the report.
  async analyze(
    tasks: TaskObject[],
    metrics: WeeklyMetrics,
  ): Promise<SummaryReport> {
    const start = new Date(metrics.start);
    const end = new Date(metrics.end);
    const { timeZone } = metrics;

    const docs = tasks.map(
      (task) =>
        new Document({
          pageContent: this.describe(task, start, end, timeZone),
          metadata: { objectId: task.id },
        }),
    );

    // FaissStore can't be built from zero documents.
    const store =
      docs.length > 0
        ? await FaissStore.fromDocuments(docs, this.embeddings)
        : null;

    const getWeeklyMetrics = tool(async () => JSON.stringify(metrics), {
      name: 'get_weekly_metrics',
      description:
        "Returns this week's productivity metrics for the user as JSON.",
      schema: z.object({}),
    });

    const searchTasks = tool(
      async ({ query }) => {
        if (!store) return 'No tasks found.';
        const results = await store.similaritySearch(query, SEARCH_K);
        return results.map((doc) => doc.pageContent).join('\n\n---\n\n');
      },
      {
        name: 'search_tasks',
        description:
          "Semantic search over the user's tasks. Returns the closest matches with their status, priority, focus, hours, notes and this week's activity.",
        schema: z.object({
          query: z
            .string()
            .describe('What to look for, e.g. "blocked high priority work".'),
        }),
      },
    );

    const agent = createAgent({
      model: new ChatAnthropic({
        model: process.env.SUMMARY_MODEL || DEFAULT_MODEL,
        maxTokens: 16000,
      }),
      tools: [getWeeklyMetrics, searchTasks],
      systemPrompt: SYSTEM_PROMPT,
      responseFormat: providerStrategy(REPORT_SCHEMA),
    });

    const result = await agent.invoke({
      messages: [
        {
          role: 'user',
          content: `Write my report for ${localDate(start, timeZone)} to ${localDate(end, timeZone)} (${timeZone}).`,
        },
      ],
    });

    return REPORT_SCHEMA.parse(result.structuredResponse);
  }

  // Generates and saves the signed-in user's Summary for an ISO week: the
  // one named by params.week, the one params.date falls in, or the current
  // one. Weeks run Monday to Sunday in params.timeZone (UTC by default). An
  // existing Summary for the same owner and week is overwritten.
  // Tasks are read with the user's session token so only tasks they can see
  // are included. A user with no session (a pointer from a master-key call)
  // has their tasks read with the master key. The Summary itself is saved
  // with the master key (clients can't create Summaries) and is readable by
  // its owner only.
  async create(
    params: SummaryCreateParams = {},
    user: ParseUser | undefined,
  ): Promise<SummaryObject> {
    if (!user?.id) {
      throw new Parse.Error(
        Parse.Error.SESSION_MISSING,
        'summary-create requires a signed-in user',
      );
    }

    if (params.week && params.date) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'Give either week or date, not both',
      );
    }

    const timeZone = params.timeZone ?? DEFAULT_TIME_ZONE;

    if (!isTimeZone(timeZone)) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'timeZone must be an IANA time zone, e.g. America/Chicago',
      );
    }

    const date = params.date ? toDate(params.date) : new Date();
    const period = params.week
      ? this.weekFromString(params.week, timeZone)
      : date && this.weekOf(date, timeZone);

    if (!period) {
      throw new Parse.Error(
        Parse.Error.INVALID_QUERY,
        'week must be YYYY-WW (e.g. 2026-44) and date a valid ISO date',
      );
    }

    const { week, start, end } = period;
    const owner = Parse.User.createWithoutData(user.id) as ParseUser;

    const sessionToken = user.getSessionToken() ?? undefined;
    const all = await this.tasks(
      sessionToken ? { sessionToken } : { useMasterKey: true },
    );
    const owned = all.filter((task) => task.get('owner')?.id === user.id);
    const metrics = this.metrics(owned, start, end, timeZone);
    const report = await this.analyze(owned, metrics);

    const acl = new Parse.ACL();
    acl.setReadAccess(user.id, true);

    // One Summary per owner and week: regenerate over the existing one.
    const existing = await new Parse.Query<SummaryObject>(CLASS_NAME)
      .equalTo('owner', owner)
      .equalTo('week', week)
      .first({ useMasterKey: true });

    const summary = existing ?? (new Parse.Object(CLASS_NAME) as SummaryObject);
    summary.set({
      week,
      start,
      end,
      summary: report.summary,
      suggestions: report.suggestions,
      metrics,
      model: process.env.SUMMARY_MODEL || DEFAULT_MODEL,
      // A bare pointer, so the user's session token isn't saved or returned.
      owner,
    });
    summary.setACL(acl);

    return summary.save(null, { useMasterKey: true });
  }

  // Plain-text description of a task for the vector store, including the
  // status changes made in [start, end]. Dates are given in timeZone.
  describe(
    task: TaskObject,
    start: Date,
    end: Date,
    timeZone: string = DEFAULT_TIME_ZONE,
  ): string {
    const changes = this.activityIn(task, start, end)
      .map(({ status, timestamp }) => {
        const date = toDate(timestamp);
        return `${status} (${date ? localDate(date, timeZone) : 'unknown'})`;
      })
      .join(', ');

    const startedAt = this.startedAt(task);
    const started = startedAt && localDate(startedAt, timeZone);

    return [
      `Task: ${task.get('task') ?? '(untitled)'}`,
      `Started: ${started ?? 'unknown'}`,
      `Status: ${task.get('status') ?? 'pending'}`,
      `Priority: ${task.get('priority') ?? 'unset'}`,
      `Focus: ${task.get('focus') ?? 'unset'}`,
      `Hours: ${task.get('hours') ?? 0}`,
      `Description: ${task.get('description') ?? ''}`,
      `Notes: ${task.get('notes') ?? ''}`,
      `Status changes this week: ${changes || 'none'}`,
    ].join('\n');
  }

  metrics(
    tasks: TaskObject[],
    start: Date,
    end: Date,
    timeZone: string = DEFAULT_TIME_ZONE,
  ): WeeklyMetrics {
    const metrics: WeeklyMetrics = {
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone,
      totalTasks: tasks.length,
      tasksTouched: 0,
      completed: 0,
      started: 0,
      statusChanges: 0,
      openHighPriority: 0,
      totalHours: 0,
      hoursByFocus: {},
      hoursByPriority: {},
      statusCounts: {},
    };

    for (const task of tasks) {
      const status = task.get('status') ?? 'pending';
      const priority = task.get('priority') ?? 'unset';
      const focus = task.get('focus') ?? 'unset';
      const hours = task.get('hours') ?? 0;

      metrics.statusCounts[status] = (metrics.statusCounts[status] ?? 0) + 1;

      if (priority === 'high' && status !== 'completed') {
        metrics.openHighPriority += 1;
      }

      const activity = this.activityIn(task, start, end);
      const startedAt = this.startedAt(task);
      const startedInWindow =
        Boolean(startedAt) && startedAt! >= start && startedAt! <= end;

      if (activity.length === 0 && !startedInWindow) continue;

      metrics.tasksTouched += 1;
      // The first entry on a new task is its start, not a status change.
      metrics.statusChanges += startedInWindow
        ? Math.max(activity.length - 1, 0)
        : activity.length;

      if (activity.some((entry) => entry.status === 'completed')) {
        metrics.completed += 1;
      }
      if (activity.some((entry) => entry.status === 'active')) {
        metrics.started += 1;
      }

      metrics.totalHours += hours;
      metrics.hoursByFocus[focus] = (metrics.hoursByFocus[focus] ?? 0) + hours;
      metrics.hoursByPriority[priority] =
        (metrics.hoursByPriority[priority] ?? 0) + hours;
    }

    metrics.totalHours = round(metrics.totalHours);

    return metrics;
  }

  // Finds up to 100 of the caller's Summaries, newest first.
  async read(
    params: SummaryReadParams = {},
    options: RequestOptions = {},
  ): Promise<SummaryReadResult> {
    const limit = Math.min(params.limit ?? READ_LIMIT, READ_LIMIT);
    const offset = params.offset ?? 0;

    const query = new Parse.Query<SummaryObject>(CLASS_NAME)
      .descending('end')
      .skip(offset)
      .limit(limit);

    if (params.objectId) {
      query.equalTo('objectId', params.objectId);
    }

    if (params.week) {
      query.equalTo('week', params.week);
    }

    const [count, results] = await Promise.all([
      query.count(options),
      query.find(options),
    ]);

    return { count, limit, offset, results };
  }

  // Creates the Summary class if it doesn't exist yet, or adds any fields
  // it's missing and resets its permissions to CLP if it does. Safe to run
  // more than once.
  async schema(): Promise<SchemaResult> {
    const schema = new Parse.Schema(CLASS_NAME);
    const existing = await schema.get().catch((err: unknown) => {
      if (!(err instanceof Parse.Error)) throw err;
      if (err.code === Parse.Error.INVALID_CLASS_NAME) return null;
      throw err;
    });

    const missing = (Object.entries(FIELDS) as [string, FieldSpec][]).filter(
      ([name]) => !existing?.fields?.[name],
    );

    for (const [name, field] of missing) {
      const { type, ...options } =
        typeof field === 'string' ? { type: field } : field;
      schema.addField(name, type, options as { targetClass?: string });
    }

    const clpChanged = Object.entries(CLP).some(
      ([key, value]) =>
        JSON.stringify(
          existing?.classLevelPermissions?.[
            key as keyof typeof existing.classLevelPermissions
          ],
        ) !== JSON.stringify(value),
    );

    schema.setCLP(CLP as Parameters<typeof schema.setCLP>[0]);

    let status: SchemaResult['schema'] = 'unchanged';

    if (!existing) {
      await schema.save();
      status = 'created';
    } else if (missing.length > 0 || clpChanged) {
      await schema.update();
      status = 'updated';
    }

    return {
      result: 'success',
      schema: status,
      fieldsAdded: missing.map(([name]) => name),
      permissionsUpdated: Boolean(existing) && clpChanged,
    };
  }

  // Generates a Summary for every user for ISO weeks 01-44 of the current
  // year (in Pacific/Honolulu), oldest first. Weeks a user already has a
  // Summary for are skipped, so it's safe to run again, and a week that
  // fails is recorded and the rest carry on. Each Summary calls the AI
  // model, so this is slow: one call per user per week.
  async seed(): Promise<SummarySeedResult> {
    const timeZone = SEED_TIME_ZONE;
    const year = this.weekOf(new Date(), timeZone).week.slice(0, 4);
    const weeks = Array.from(
      { length: SEED_WEEKS },
      (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`,
    );

    const users = await new Parse.Query(Parse.User).findAll({
      useMasterKey: true,
    });

    const result: SummarySeedResult = {
      result: 'success',
      users: users.length,
      created: 0,
      skipped: 0,
      failed: [],
    };

    for (const { id } of users) {
      if (!id) continue;

      // A bare pointer: no session, so create() reads tasks with the master
      // key.
      const user = Parse.User.createWithoutData(id) as ParseUser;

      const existing = await new Parse.Query<SummaryObject>(CLASS_NAME)
        .equalTo('owner', user)
        .containedIn('week', weeks)
        .select('week')
        .limit(weeks.length)
        .find({ useMasterKey: true });
      const done = new Set(existing.map((summary) => summary.get('week')));

      for (const week of weeks) {
        if (done.has(week)) {
          result.skipped++;
          continue;
        }

        try {
          await this.create({ week, timeZone }, user);
          result.created++;
        } catch (error) {
          result.failed.push({
            user: id,
            week,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    console.log(
      `Seeded summaries: ${result.created} created, ${result.skipped} skipped, ${result.failed.length} failed`,
    );

    return result;
  }

  // When work on a task started: its startedAt, or createdAt for tasks saved
  // before startedAt existed.
  startedAt(task: TaskObject): Date | null {
    const value = task.get('startedAt') ?? task.createdAt;
    return value ? toDate(value) : null;
  }

  // Pages through Task.read() until every non-deleted task the caller can
  // see has been loaded.
  async tasks(options: RequestOptions): Promise<TaskObject[]> {
    const tasks: TaskObject[] = [];

    for (;;) {
      const page = await TaskSDK.read({ offset: tasks.length }, options);
      tasks.push(...page.results);
      if (page.results.length === 0 || tasks.length >= page.count) break;
    }

    return tasks;
  }

  // The ISO week named by a YYYY-WW string in timeZone, or null if it isn't
  // one (week 53 only exists in some years). Week 1 is the week containing
  // January 4th.
  weekFromString(
    week: string,
    timeZone: string = DEFAULT_TIME_ZONE,
  ): SummaryWeek | null {
    const match = /^(\d{4})-(\d{1,2})$/.exec(week);
    if (!match) return null;

    const [year, number] = [Number(match[1]), Number(match[2])];
    const jan4 = Date.UTC(year, 0, 4);
    const week1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
    const period = isoWeek(week1 + (number - 1) * WEEK_MS, timeZone);

    return number >= 1 &&
      period.week === `${year}-${String(number).padStart(2, '0')}`
      ? period
      : null;
  }

  // The ISO week that date falls in, in timeZone: from Monday 00:00 to the
  // last millisecond before the next Monday, local time. Its year is the
  // year of its Thursday, so the days around New Year can belong to the
  // previous or next year's week.
  weekOf(date: Date, timeZone: string = DEFAULT_TIME_ZONE): SummaryWeek {
    const { year, month, day } = zonedParts(date, timeZone);
    const local = Date.UTC(year, month - 1, day);
    const weekday = (new Date(local).getUTCDay() + 6) % 7; // Monday = 0

    return isoWeek(local - weekday * DAY_MS, timeZone);
  }
}

export default new Summary();
