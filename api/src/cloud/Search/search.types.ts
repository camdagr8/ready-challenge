// Types for the Search SDK (search.sdk.ts): types first, then interfaces,
// each in alphabetical order.
import type { FaissStore } from '@langchain/community/vectorstores/faiss';
import type {
  ParseUser,
  RequestOptions,
  SummaryObject,
  TaskObject,
  WeeklyMetrics,
} from '../Summary/summary.types.ts';

export type {
  ParseUser,
  RequestOptions,
  SummaryObject,
  TaskObject,
  WeeklyMetrics,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// What an index entry describes: a whole week, a task completed in it, or a
// task worked on in it but not completed.
export type EntryKind = 'completed' | 'overview' | 'worked';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

// Metadata stored with each index entry.
export interface EntryMetadata {
  kind: EntryKind;
  // Task name, for completed and worked entries.
  task?: string;
  week: string;
}

// The parts of a Task a week needs.
export interface SearchTask {
  description?: string;
  focus: string;
  hours: number;
  priority: string;
  status: string;
  task: string;
}

// Parameters for SearchSDK.search().
export interface SearchParams {
  // Most weeks to return. Defaults to 5, capped at 10.
  limit?: number;
  // What to look for, in plain language, e.g. "weeks when I was distracted".
  query?: string;
  // IANA time zone used to find the current week. Defaults to UTC.
  timeZone?: string;
}

// One week in a search result, in the order the agent ranked them.
export interface SearchResult {
  end: string;
  // Why the agent picked this week.
  reason: string;
  start: string;
  // The week's saved Summary, or null for the current week if it has none.
  summary: SummaryObject | null;
  week: string;
}

// Result of SearchSDK.search().
export interface SearchResponse {
  // A short answer to the query, addressed to the user.
  answer: string;
  query: string;
  results: SearchResult[];
}

// The Search SDK (search.sdk.ts): its public API and the helpers it uses.
export interface SearchSDK {
  // Runs the search agent over weeks and returns its answer and the weeks
  // it picked, best first.
  ask(
    query: string,
    weeks: Week[],
    store: FaissStore,
    currentWeek: string,
    limit: number,
  ): Promise<{ answer: string; weeks: { week: string; reason: string }[] }>;

  // Builds the index entries (overview, completed and worked tasks) for weeks.
  documents(weeks: Week[]): { pageContent: string; metadata: EntryMetadata }[];

  // Groups scored index entries by week, best week first.
  group(hits: { metadata: EntryMetadata; score: number }[]): WeekHit[];

  // Returns the FAISS index over weeks for a user, building it only when
  // the weeks have changed since it was last built.
  index(userId: string, weeks: Week[]): Promise<FaissStore | null>;

  // A week's numbers in the form the agent compares weeks by.
  overview(week: Week): WeekOverview;

  // Answers a plain-language question about the signed-in user's weeks,
  // returning the matching weeks with a reason for each.
  search(
    params: SearchParams,
    user: ParseUser | undefined,
  ): Promise<SearchResponse>;

  // Semantic search over the index, grouped by week, best match first.
  searchWeeks(
    store: FaissStore,
    query: string,
    limit: number,
  ): Promise<WeekHit[]>;

  // Weeks whose completed tasks are most like target's, best match first.
  similarWeeks(
    store: FaissStore,
    target: Week,
    limit: number,
  ): Promise<WeekHit[]>;

  // Loads every Summary the caller can read.
  summaries(options: RequestOptions): Promise<SummaryObject[]>;

  // Builds a Week for each Summary, plus the current week if it has no
  // Summary yet, with the tasks completed and worked on in each.
  weeks(
    summaries: SummaryObject[],
    tasks: TaskObject[],
    current: { week: string; start: Date; end: Date; timeZone: string },
  ): Week[];
}

// One week as the search sees it.
export interface Week {
  // Tasks that reached 'completed' during the week.
  completed: SearchTask[];
  end: Date;
  metrics: WeeklyMetrics;
  start: Date;
  // The saved Summary, or null for the current week if it has none.
  summary: SummaryObject | null;
  // The Summary's paragraph, if there is one.
  text: string;
  week: string;
  // Tasks with activity during the week that weren't completed in it.
  worked: SearchTask[];
}

// A week found by a semantic search: how close its best entry was and
// which of its entries matched.
export interface WeekHit {
  // Entries that matched, e.g. "completed: Add a task-create cloud function".
  matches: string[];
  // Cosine similarity of the best-matching entry, from -1 to 1.
  score: number;
  week: string;
}

// A week's numbers for comparing weeks: counts, hours and the shares the
// agent uses to judge focus and distraction.
export interface WeekOverview {
  completed: number;
  completedTasks: string[];
  // completed / tasksTouched, 0 when nothing was touched.
  completionRate: number;
  end: string;
  // Share of the week's hours on high-, medium- and low-focus tasks.
  focusShare: Record<string, number>;
  hasSummary: boolean;
  hoursByFocus: Record<string, number>;
  hoursByPriority: Record<string, number>;
  openHighPriority: number;
  start: string;
  started: number;
  statusChanges: number;
  tasksTouched: number;
  totalHours: number;
  week: string;
  workedTasks: string[];
}
