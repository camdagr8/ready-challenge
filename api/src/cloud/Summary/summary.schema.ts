// Schema for the Summary class: its fields and class-level permissions. Used by
// summary.sdk.ts to create the class and to check field values. The cloud
// loader skips .schema.ts files, so this is never run as Cloud Code.
import type { FieldSpec, SummaryAttributes } from './summary.types.ts';

// The Parse Object Class name.
export const CLASS_NAME: string = 'Summary';

// Max number of objects to return at once.
export const READ_LIMIT: number = 100;

// Length of a reporting week.
export const WEEK_MS: number = 7 * 24 * 60 * 60 * 1000;

// How many tasks the agent's search_tasks tool returns per query.
export const SEARCH_K: number = 5;

// Local sentence-embedding model used to build the FAISS index. Runs in
// process through @huggingface/transformers, so no extra API key is needed.
// Downloaded and cached on first use.
export const EMBEDDING_MODEL: string = 'Xenova/all-MiniLM-L6-v2';

// Time zone that weeks are measured in when summary-create isn't given one.
export const DEFAULT_TIME_ZONE: string = 'UTC';

// seed() generates Summaries for ISO weeks 01 to SEED_WEEKS of the current
// year, measured in SEED_TIME_ZONE.
export const SEED_TIME_ZONE: string = 'Pacific/Honolulu';
export const SEED_WEEKS: number = 44;

// Claude model used by the summary agent when SUMMARY_MODEL isn't set.
export const DEFAULT_MODEL: string = 'claude-haiku-5-5';

// Fields for the Summary class. objectId, createdAt, updatedAt and ACL are
// added by Parse automatically, so they aren't listed.
export const FIELDS: Record<keyof SummaryAttributes, FieldSpec> = {
  start: 'Date',
  end: 'Date',
  summary: 'String',
  suggestions: 'Array',
  metrics: 'Object',
  model: 'String',
  week: 'String',
  owner: { type: 'Pointer', targetClass: '_User' },
};

// Class-level permissions. Summaries are only written by Cloud Code with the
// master key, and each one's ACL limits reading to its owner.
export const CLP: Record<string, unknown> = {
  find: { '*': true },
  count: { '*': true },
  get: { '*': true },
  create: {},
  update: {},
  delete: {},
  addField: {},
  protectedFields: { '*': [] },
};
