// Types for the Task SDK (task.sdk.ts): types first, then interfaces, each
// in alphabetical order.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Result of TaskSDK.seedAdmin(): the admin user and whether it was created,
// already existed, or was skipped because ADMIN_PASSWORD isn't set (the only
// case with no user).
export type AdminSeedResult =
  | { user: ParseUser; result: 'created' | 'exists' }
  | { user: null; result: 'skipped' };

export type FieldSpec =
  Exclude<FieldType, 'Pointer'> | { type: 'Pointer'; targetClass: string };

export type FieldType = 'Array' | 'Date' | 'Number' | 'Pointer' | 'String';

// Parse is a global set by Parse Server before Cloud Code is loaded (see
// src/types/global.d.ts). The SDK doesn't export its type files, so
// ParseObject and ParseUser are derived from it.
export type ParseObject = InstanceType<typeof Parse.Object>;

export type ParseUser = InstanceType<typeof Parse.User>;

// A pointer value accepted by create() and update(): a saved Parse.Object,
// an objectId string or { objectId }.
export type PointerInput = ParseObject | string | { objectId: string };

// A Task as returned by queries, with typed get() and set().
export type TaskObject = InstanceType<typeof Parse.Object<TaskAttributes>>;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

// One entry in a task's activity log.
export interface Activity {
  status: string;
  timestamp: Date;
  user?: ParseUser;
}

// The parts of a beforeSave request this module uses.
export interface BeforeSaveRequest {
  context?: Record<string, unknown>;
  master: boolean;
  object: ParseObject;
  original?: ParseObject;
  user?: ParseUser;
}

// Options passed through to Parse queries and saves.
export interface RequestOptions {
  // Passed to the Task beforeSave trigger as req.context, e.g. { seed: true }.
  context?: Record<string, unknown>;
  sessionToken?: string;
  useMasterKey?: boolean;
}

// Result of TaskSDK.schema().
export interface SchemaResult {
  fieldsAdded: string[];
  permissionsUpdated: boolean;
  result: 'success';
  schema: 'created' | 'updated' | 'unchanged';
}

// Result of TaskSDK.seed().
export interface SeedResult {
  admin: AdminSeedResult;
  // Number of tasks created from task-seed.json.
  records: number;
  result: 'success';
  schema: SchemaResult;
}

// A Task's attributes as stored, i.e. what task.get() returns for each
// field. Any field may be unset, so each is optional.
export interface TaskAttributes {
  activity?: Activity[];
  creator?: ParseUser;
  description?: string;
  focus?: string;
  hours?: number;
  notes?: string;
  order?: number;
  owner?: ParseUser;
  priority?: string;
  // When work on the task started. Defaults to the time the task was created.
  startedAt?: Date;
  status?: string;
  task?: string;
}

// Field values accepted by create() and update(); null unsets a field on
// update.
export interface TaskData {
  activity?: unknown[] | null;
  creator?: PointerInput | null;
  description?: string | null;
  focus?: string | null;
  hours?: number | null;
  notes?: string | null;
  order?: number | null;
  owner?: PointerInput | null;
  priority?: string | null;
  // A Date or an ISO date string.
  startedAt?: Date | string | null;
  status?: string | null;
  task?: string | null;
}

// Parameters for TaskSDK.read().
export interface TaskReadParams {
  // creator to filter by (objectId of the user who created the task).
  creator?: string;
  // Include tasks whose status is 'deleted' (left out by default).
  deleted?: boolean;
  // Maximum number of tasks to return. Defaults to 100.
  limit?: number;
  // objectId to filter by (the unique identifier of the task).
  objectId?: string;
  // Index of the first task to return (for pagination). Defaults to 0.
  offset?: number;
  // owner to filter by (objectId of the user who owns the task).
  owner?: string;
  // Status to filter by (e.g., 'pending', 'active', 'completed', 'deleted'). If omitted, all non-deleted tasks are returned.
  status?: string;
}

// Result of TaskSDK.read(): one page of Tasks plus what's needed to fetch
// the next one.
export interface TaskReadResult {
  // Total number of Tasks matching the filters, across all pages.
  count: number;
  // Page size used (params.limit, capped at 100).
  limit: number;
  // Index of the first Task in results.
  offset: number;
  results: TaskObject[];
}

// The Task SDK (task.sdk.ts): its public API and the helpers it uses.
export interface TaskSDK {
  // Gives the creator and owner (on create) or the owner (on update) read
  // and write access to object, replacing its ACL.
  applyACL(object: ParseObject, isNew: boolean): void;

  // Throws if data has any keys that aren't in FIELDS.
  assertKnownFields(data: object): void;

  // Task beforeSave trigger: fills in creator, owner, startedAt and activity,
  // and sets the ACL. Master-key saves with context { seed: true } use the creator as
  // the owner and the acting user.
  beforeSave(req: BeforeSaveRequest): void;

  // Creates and saves a Task from field values checked against FIELDS.
  create(data?: TaskData, options?: RequestOptions): Promise<ParseObject>;

  // Finds a page of up to 100 Tasks matching params, leaving out deleted ones
  // unless params.deleted or params.status asks for them.
  read(
    params?: TaskReadParams,
    options?: RequestOptions,
  ): Promise<TaskReadResult>;

  // Creates the Task class, or adds missing fields and resets its CLP.
  schema(): Promise<SchemaResult>;

  // Sets up the Task class, creates the admin user if it's missing, and
  // returns what was done.
  seed(): Promise<SeedResult>;

  // Creates the admin user if no user named admin exists (any case).
  seedAdmin(): Promise<AdminSeedResult>;

  // Creates a Task for each entry in task-seed.json, owned by user, when the
  // Task class is empty. Returns the number created.
  seedTasks(user: ParseUser | null): Promise<number>;

  // Sets each FIELDS key present in data on object; null values are skipped,
  // or unset the field if unsetNull.
  setFields(
    object: ParseObject,
    data: TaskData,
    options?: { unsetNull?: boolean },
  ): void;

  // Checks value against a FIELDS entry and returns it in the form Parse
  // expects, turning Pointer values into Parse.Object pointers.
  toFieldValue(name: string, field: FieldSpec, value: unknown): unknown;

  // Fetches the Task named by data.objectId and saves the given changes, or
  // creates a new Task when there's no objectId.
  update(data?: TaskUpdateData, options?: RequestOptions): Promise<ParseObject>;
}

export interface TaskUpdateData extends TaskData {
  objectId?: string | null;
}
