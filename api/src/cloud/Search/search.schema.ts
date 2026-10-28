// Settings for the Search SDK (search.sdk.ts). Search has no Parse class of
// its own: it indexes the user's Summaries and their Tasks. The cloud loader
// skips .schema.ts files, so this is never run as Cloud Code.

// Most weeks a search returns.
export const MAX_RESULTS: number = 10;

// Weeks returned when the caller doesn't give a limit.
export const DEFAULT_RESULTS: number = 5;

// How many index entries a semantic search looks at before grouping them by
// week. Several entries belong to each week, so this is well above
// MAX_RESULTS.
export const SEARCH_K: number = 40;

// Longest query accepted, in characters.
export const MAX_QUERY_LENGTH: number = 500;

// Most indexes kept in memory at once (one per user). The least recently
// used is dropped first.
export const CACHE_SIZE: number = 50;
