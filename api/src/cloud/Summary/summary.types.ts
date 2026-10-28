// Types for the Summary SDK (summary.sdk.ts): types first, then interfaces,
// each in alphabetical order.
import type {
  ParseObject,
  ParseUser,
  RequestOptions,
  SchemaResult,
  TaskObject,
} from '../Task/task.types.ts';

export type {
  ParseObject,
  ParseUser,
  RequestOptions,
  SchemaResult,
  TaskObject,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldSpec =
  Exclude<FieldType, 'Pointer'> | { type: 'Pointer'; targetClass: string };

export type FieldType =
  'Array' | 'Date' | 'Number' | 'Object' | 'Pointer' | 'String';

// A Summary as returned by queries, with typed get() and set().
export type SummaryObject = InstanceType<
  typeof Parse.Object<SummaryAttributes>
>;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

// What the agent returns: the report paragraph and next-week suggestions.
export interface SummaryReport {
  suggestions: string[];
  summary: string;
}

// A Summary's attributes as stored.
export interface SummaryAttributes {
  end?: Date;
  metrics?: WeeklyMetrics;
  model?: string;
  owner?: ParseUser;
  start?: Date;
  suggestions?: string[];
  summary?: string;
  // ISO week the summary covers, as YYYY-WW (e.g. '2026-44').
  week?: string;
}

// Parameters for SummarySDK.create(). Give at most one of date and week;
// with neither, the current week is used.
export interface SummaryCreateParams {
  // Any date (ISO) in the week to summarize.
  date?: string;
  // IANA time zone whose Monday-to-Sunday week is used, e.g.
  // 'America/Chicago'. Defaults to UTC.
  timeZone?: string;
  // ISO week to summarize, as YYYY-WW (e.g. '2026-44').
  week?: string;
}

// Parameters for SummarySDK.read().
export interface SummaryReadParams {
  // Maximum number of summaries to return. Defaults to 100.
  limit?: number;
  // objectId to filter by.
  objectId?: string;
  // Index of the first summary to return (for pagination). Defaults to 0.
  offset?: number;
  // ISO week to filter by, as YYYY-WW.
  week?: string;
}

// Result of SummarySDK.read(): one page of Summaries, newest first.
export interface SummaryReadResult {
  count: number;
  limit: number;
  offset: number;
  results: SummaryObject[];
}

// The Summary SDK (summary.sdk.ts): its public API and the helpers it uses.
export interface SummarySDK {
  // Runs the agent over the user's tasks for the window and returns its
  // report.
  analyze(tasks: TaskObject[], metrics: WeeklyMetrics): Promise<SummaryReport>;

  // Loads the signed-in user's tasks, computes the week's metrics, asks the
  // agent for a report and saves it as the user's Summary for that week,
  // replacing any earlier one.
  create(
    params: SummaryCreateParams,
    user: ParseUser | undefined,
  ): Promise<SummaryObject>;

  // Computes productivity metrics for tasks over [start, end].
  metrics(
    tasks: TaskObject[],
    start: Date,
    end: Date,
    timeZone?: string,
  ): WeeklyMetrics;

  // Finds a page of the caller's Summaries, newest first.
  read(
    params?: SummaryReadParams,
    options?: RequestOptions,
  ): Promise<SummaryReadResult>;

  // Creates the Summary class, or adds missing fields and resets its CLP.
  schema(): Promise<SchemaResult>;

  // Generates a Summary for every user for weeks 01-44 of the current year
  // (Pacific/Honolulu), skipping weeks that already have one.
  seed(): Promise<SummarySeedResult>;

  // When work on a task started: startedAt, or createdAt if it's unset.
  startedAt(task: TaskObject): Date | null;

  // Loads every non-deleted Task the caller can read.
  tasks(options: RequestOptions): Promise<TaskObject[]>;

  // The ISO week named by a YYYY-WW string, in timeZone (default UTC), or
  // null if it isn't one.
  weekFromString(week: string, timeZone?: string): SummaryWeek | null;

  // The ISO week (Monday to Sunday in timeZone, default UTC) that date falls
  // in.
  weekOf(date: Date, timeZone?: string): SummaryWeek;
}

// Result of SummarySDK.seed().
export interface SummarySeedResult {
  // Summaries generated.
  created: number;
  // Weeks that couldn't be generated, with the error for each.
  failed: { error: string; user: string; week: string }[];
  result: 'success';
  // Weeks skipped because the user already had a Summary for them.
  skipped: number;
  // Number of users found.
  users: number;
}

// An ISO week: its YYYY-WW label and its first and last milliseconds.
export interface SummaryWeek {
  end: Date;
  start: Date;
  week: string;
}

// Productivity metrics for one reporting window. Counts by status describe
// all of the user's open work; the rest only covers activity in the window.
export interface WeeklyMetrics {
  // Tasks that reached 'completed' during the window.
  completed: number;
  end: string;
  // Hours on tasks touched in the window, grouped by focus level.
  hoursByFocus: Record<string, number>;
  // Hours on tasks touched in the window, grouped by priority.
  hoursByPriority: Record<string, number>;
  // High-priority tasks that aren't completed yet.
  openHighPriority: number;
  start: string;
  // Tasks started (moved to 'active') during the window.
  started: number;
  // Number of status changes logged during the window.
  statusChanges: number;
  // Current count of all non-deleted tasks per status.
  statusCounts: Record<string, number>;
  // Tasks with any activity, or started (startedAt), during the window.
  tasksTouched: number;
  // IANA time zone the week's start and end are local to.
  timeZone: string;
  // Total tasks the user can see (excluding deleted).
  totalTasks: number;
  // Sum of hours on tasks touched during the window.
  totalHours: number;
}
