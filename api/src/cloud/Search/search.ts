import SDK from './search.sdk.ts';

/**
 * ---------------------------------------------------------------------------------------
 * Cloud functions
 * ---------------------------------------------------------------------------------------
 */

// search-weeks
// Answers a plain-language question about the signed-in user's past weeks
// ({ query, timeZone?, limit? }), e.g. "weeks when I was highly focused",
// using their saved Summaries. Returns an answer and the matching weeks.
Parse.Cloud.define('search-weeks', (req) => {
  return SDK.search(req.params, req.user);
});
