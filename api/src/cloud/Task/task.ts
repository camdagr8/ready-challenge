import SDK from './task.sdk.ts';

/**
 * ---------------------------------------------------------------------------------------
 * Hooks
 * ---------------------------------------------------------------------------------------
 */

// Set up the Task class before the server starts taking requests
Hook.register('beforeStart', () => SDK.schema());

/**
 * ---------------------------------------------------------------------------------------
 * Cloud functions
 * ---------------------------------------------------------------------------------------
 */

// task-seed
// Seeds the database with initial tasks
Parse.Cloud.define('task-seed', (req) => {
  if (!req.master) {
    console.log('task-seed error: Master key required');
    throw new Error('task-seed - Master key required');
  }

  return SDK.seed();
});

// task-create
// Creates a new Task
Parse.Cloud.define('task-create', (req) => {
  const options = { sessionToken: req.user?.getSessionToken() ?? undefined };
  return SDK.create(req.params, options);
});

// task-read
// Reads Tasks based on query parameters
Parse.Cloud.define('task-read', (req) => {
  const options = { sessionToken: req.user?.getSessionToken() ?? undefined };
  return SDK.read(req.params, options);
});

// task-update
// Updates an existing Task
Parse.Cloud.define('task-update', (req) => {
  const options = { sessionToken: req.user?.getSessionToken() ?? undefined };
  return SDK.update(req.params, options);
});

// task-delete
// Deletes an existing Task
Parse.Cloud.define('task-delete', (req) => {
  const objectId = req.params.objectId;
  if (!objectId) {
    throw new Error('task-delete - `objectId` is required');
  }

  const options = { sessionToken: req.user?.getSessionToken() ?? undefined };
  return SDK.update({ ...req.params, status: 'deleted' }, options);
});

/**
 * ---------------------------------------------------------------------------------------
 * Cloud beforeSave
 * ---------------------------------------------------------------------------------------
 */
// Runs before saving a Task, allowing for validation and ACL application.
Parse.Cloud.beforeSave('Task', (req) => {
  return SDK.beforeSave(req);
});
