import SDK from './summary.sdk.ts';

/**
 * ---------------------------------------------------------------------------------------
 * Hooks
 * ---------------------------------------------------------------------------------------
 */

// Set up the Summary class before the server starts taking requests
Hook.register('beforeStart', () => SDK.schema());

/**
 * ---------------------------------------------------------------------------------------
 * Cloud functions
 * ---------------------------------------------------------------------------------------
 */
// summary-schema
// Creates or updates the Summary class
Parse.Cloud.define('summary-schema', (req) => {
  if (!req.master) {
    console.log('summary-schema error: Master key required');
    throw new Error('summary-schema - Master key required');
  }

  return SDK.schema();
});

// summary-seed
// Generates a summary for every user for ISO weeks 01-44 of the current year
// (Pacific/Honolulu), skipping weeks that already have one. Slow: one AI
// model call per user per week.
Parse.Cloud.define('summary-seed', (req) => {
  if (!req.master) {
    console.log('summary-seed error: Master key required');
    throw new Error('summary-seed - Master key required');
  }

  return SDK.seed();
});

// summary-create
// Generates a summary of the signed-in user's ISO week (the current one, or
// { week: 'YYYY-WW' } or { date }) with suggestions for next week, and saves
// it, replacing any earlier summary for that week. With the master key,
// { user: objectId } summarizes that user's week instead.
Parse.Cloud.define('summary-create', (req) => {
  const { user: userId, ...params } = req.params;

  // Only the master key may summarize another user's week; anyone else gets
  // their own summary, whatever user they pass.
  let user = req.user;

  if (req.master && userId && typeof userId === 'string') {
    user = Parse.User.createWithoutData(userId) as typeof req.user;
  }

  return SDK.create(params, user);
});

// summary-read
// Reads the signed-in user's saved summaries, newest first
Parse.Cloud.define('summary-read', (req) => {
  const options = { sessionToken: req.user?.getSessionToken() ?? undefined };
  return SDK.read(req.params, options);
});
