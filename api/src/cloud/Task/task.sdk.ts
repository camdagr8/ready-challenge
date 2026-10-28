import path from 'node:path';
import fs from 'node:fs/promises';
import { CLASS_NAME, CLP, FIELDS, READ_LIMIT } from './task.schema.ts';

import type {
  Activity,
  BeforeSaveRequest,
  FieldSpec,
  ParseObject,
  ParseUser,
  RequestOptions,
  SchemaResult,
  SeedResult,
  TaskData,
  TaskObject,
  TaskReadParams,
  TaskReadResult,
  TaskSDK,
  TaskUpdateData,
} from './task.types.ts';

// Tasks created by seed() when the Task class is empty.
const SEED_FILE = path.join(import.meta.dirname, 'task-seed.json');

// Default admin account created by seed() if no admin user exists yet. The
// password comes from ADMIN_PASSWORD in .env.
const ADMIN_USER = {
  username: 'admin',
  email: 'admin@email.com',
};

class Task implements TaskSDK {
  constructor() {}

  // On create, gives the creator and owner read and write access. On update,
  // clears the ACL and gives access to the owner only, so a change of owner
  // moves access with it. Left alone when there's no one to add, since an
  // empty ACL would make the task readable only with the master key.
  applyACL(object: ParseObject, isNew: boolean): void {
    const fields = isNew ? ['creator', 'owner'] : ['owner'];
    const users = fields
      .map((field) => object.get(field) as ParseObject | undefined)
      .filter((user): user is ParseObject => Boolean(user?.id));

    if (users.length === 0) return;

    const acl = new Parse.ACL();

    for (const user of users) {
      acl.setReadAccess(user.id!, true);
      acl.setWriteAccess(user.id!, true);
    }

    object.setACL(acl);
  }

  // Throws if data has any keys that aren't in FIELDS.
  assertKnownFields(data: object): void {
    const unknown = Object.keys(data).filter((name) => !(name in FIELDS));

    if (unknown.length > 0) {
      throw new Parse.Error(
        Parse.Error.INVALID_KEY_NAME,
        `Unknown Task field(s): ${unknown.join(', ')}`,
      );
    }
  }

  // Fills in creator and owner on new tasks. creator is always the signed-in
  // user and can't be changed afterwards; owner defaults to the creator. The
  // master key can set either field freely (e.g. for seeding or admin tools).
  // New tasks get an ACL for the creator and owner; updates reset it to the
  // owner only.
  beforeSave(req: BeforeSaveRequest): void {
    const { object, original, master, context } = req;

    // A Pointer with no objectId makes Parse Server throw an uncaught
    // exception (and exit) when it re-encodes the object after this trigger,
    // so reject those before anything else.
    for (const field of ['creator', 'owner']) {
      const value = object.get(field) as ParseObject | undefined;

      if (value && !value.id) {
        throw new Parse.Error(
          Parse.Error.INCORRECT_TYPE,
          `${field} must point to a saved user`,
        );
      }
    }

    // Seeding saves tasks with the master key and context { seed: true }. The
    // creator then becomes the owner and the user recorded in activity, and
    // the request's user is ignored. Clients can send a context too, so
    // without the master key it has no effect.
    const seeding = master && context?.seed === true;
    const creator = object.get('creator') as ParseUser | undefined;
    const user = seeding ? creator : req.user;

    if (seeding) {
      if (creator) object.set('owner', creator);
    } else if (!master) {
      if (!original) {
        if (user) {
          object.set('creator', user);
        } else {
          object.unset('creator');
        }

        if (user && !object.get('owner')) {
          object.set('owner', user);
        }
      } else if (object.dirty('creator')) {
        throw new Parse.Error(
          Parse.Error.OPERATION_FORBIDDEN,
          'creator cannot be changed',
        );
      }
    }

    // startedAt defaults to now on new tasks. Tasks saved before the field
    // existed (or with it unset) fall back to their createdAt.
    if (!object.get('startedAt')) {
      object.set('startedAt', object.createdAt ?? new Date());
    }

    // Every new task starts with a pending activity, dated startedAt, unless
    // it's being seeded with its own history. After that, the status is
    // appended whenever it differs from the last activity entry.
    const status = object.get('status') as string | undefined;
    const seededActivity = object.get('activity') as Activity[] | undefined;
    if (!original && seeding && seededActivity?.length) {
      // Keep the activity history from task-seed.json.
    } else if (!original) {
      const entry: Activity = {
        status: status || 'pending',
        timestamp: object.get('startedAt') as Date,
        user,
      };
      object.set('activity', [entry]);
    } else {
      const activity = object.get('activity') as Activity[] | undefined;
      const last = activity?.at(-1);

      if (status && status !== last?.status) {
        const entry: Activity = { status, timestamp: new Date(), user };
        object.add('activity', entry);
      }
    }

    this.applyACL(object, !original);
  }

  // Creates and saves a Task from a plain object of field values. Only keys
  // in FIELDS are accepted, and each value must match its field's type;
  // null or undefined values are skipped. Pointers can be given as a saved
  // Parse.Object, an objectId string or { objectId }. options is passed to
  // save(), e.g. { sessionToken } or { useMasterKey: true }.
  async create(
    data: TaskData = {},
    options: RequestOptions = {},
  ): Promise<ParseObject> {
    this.assertKnownFields(data);

    const object = new Parse.Object(CLASS_NAME);
    this.setFields(object, data);

    return object.save(null, options);
  }

  // Finds up to 100 Tasks, sorted by order, then startedAt, then createdAt
  // (for tasks saved before startedAt existed, which sort first). Tasks with a
  // status of 'deleted' are left out unless params.deleted is true. options
  // is passed to find(), so the caller's ACL access applies.
  async read(
    params: TaskReadParams = {},
    options: RequestOptions = {},
  ): Promise<TaskReadResult> {
    const limit = Math.min(params.limit ?? READ_LIMIT, READ_LIMIT);

    const query = new Parse.Query<TaskObject>(CLASS_NAME)
      .ascending('order')
      .addAscending('startedAt')
      .addAscending('createdAt')
      .skip(params.offset ?? 0)
      .limit(limit);

    if (params.deleted !== true && !params.status) {
      query.notEqualTo('status', 'deleted');
    }

    if (params.status) {
      query.equalTo('status', params.status);
    }

    if (params.creator) {
      const creator = this.toFieldValue(
        'creator',
        FIELDS.creator,
        params.creator,
      );
      query.equalTo('creator', creator as ParseUser);
    }

    // owner is a _User pointer, so the objectId has to be turned into one;
    // comparing it with a plain string never matches.
    if (params.owner) {
      const owner = this.toFieldValue('owner', FIELDS.owner, params.owner);
      query.equalTo('owner', owner as ParseUser);
    }

    if (params.objectId) {
      query.equalTo('objectId', params.objectId);
    }

    const [count, results] = await Promise.all([
      query.count(options),
      query.find(options),
    ]);

    const pagination: TaskReadResult = {
      count,
      limit,
      offset: params.offset ?? 0,
      results,
    };

    return pagination;
  }

  // Creates the Task class if it doesn't exist yet, or adds any fields it's
  // missing and resets its permissions to CLP if it does. Safe to run more
  // than once.
  async schema(): Promise<SchemaResult> {
    console.log('Creating or updating Task schema...');

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

    const output: SchemaResult = {
      result: 'success',
      schema: status,
      fieldsAdded: missing.map(([name]) => name),
      permissionsUpdated: Boolean(existing) && clpChanged,
    };

    console.log(JSON.stringify(output, null, 2));

    return output;
  }

  async seed(): Promise<SeedResult> {
    const s = await this.schema();
    const admin = await this.seedAdmin();
    const records = await this.seedTasks(admin.user);

    return {
      schema: s,
      admin,
      result: 'success',
      records,
    };
  }

  // Creates the admin user unless one already exists, or skips it if
  // ADMIN_PASSWORD isn't set. Usernames are matched
  // without regard to case, because Parse Server rejects a sign-up whose
  // username differs from an existing one only by case.
  async seedAdmin(): Promise<SeedResult['admin']> {
    const existing = await new Parse.Query(Parse.User)
      .matches('username', `^${ADMIN_USER.username}$`, 'i')
      .first({ useMasterKey: true });

    if (existing) return { user: existing, result: 'exists' };

    const { ADMIN_PASSWORD } = process.env;

    if (!ADMIN_PASSWORD) {
      console.warn(
        `Skipped creating ${ADMIN_USER.username} user: set ADMIN_PASSWORD in .env.`,
      );
      return { user: null, result: 'skipped' };
    }

    const user = new Parse.User();
    user.set({ ...ADMIN_USER, password: ADMIN_PASSWORD });
    await user.signUp(null, { useMasterKey: true });

    console.log(`Created ${ADMIN_USER.username} user`);

    return { user, result: 'created' };
  }

  // Creates a Task for each entry in task-seed.json, with user as creator
  // and owner, but only when the Task class is empty. Saves with context
  // { seed: true } so beforeSave keeps user as creator rather than replacing
  // it with the request's user. Returns the number of tasks created.
  async seedTasks(user: ParseUser | null): Promise<number> {
    const count = await new Parse.Query(CLASS_NAME).count({
      useMasterKey: true,
    });

    if (count > 0) return 0;

    if (!user) {
      console.warn('Skipped seeding tasks: no admin user to own them.');
      return 0;
    }

    const rows = JSON.parse(await fs.readFile(SEED_FILE, 'utf8')) as TaskData[];

    // Activity entries in the file are encoded JSON ({ __type: 'Date' } and
    // { __type: 'Pointer' }), so turn them into real Dates and pointers.
    const decode = (entry: Record<string, unknown>): Activity => ({
      status: String(entry.status),
      timestamp: this.toFieldValue(
        'timestamp',
        'Date',
        entry.timestamp,
      ) as Date,
      user: entry.user
        ? (this.toFieldValue('user', FIELDS.creator, entry.user) as ParseUser)
        : undefined,
    });

    // One at a time so startedAt follows the order of the file.
    for (const row of rows) {
      const activity = row.activity as Record<string, unknown>[] | undefined;

      await this.create(
        {
          ...row,
          activity: activity?.map(decode),
          creator: user,
          owner: user,
        },
        { useMasterKey: true, context: { seed: true } },
      );
    }

    console.log(`Seeded ${rows.length} tasks`);

    return rows.length;
  }

  // Sets each FIELDS key present in data on object. undefined values are
  // skipped; null values are skipped too, or unset the field if unsetNull.
  setFields(
    object: ParseObject,
    data: TaskData,
    { unsetNull = false }: { unsetNull?: boolean } = {},
  ): void {
    for (const [name, field] of Object.entries(FIELDS) as [
      keyof TaskData,
      FieldSpec,
    ][]) {
      const value = data[name];

      if (value === undefined) continue;

      if (value === null) {
        if (unsetNull) object.unset(name);
        continue;
      }

      object.set(name, this.toFieldValue(name, field, value));
    }
  }

  // Checks value against a FIELDS entry and returns it in the form Parse
  // expects, turning Pointer values into Parse.Object pointers.
  toFieldValue(name: string, field: FieldSpec, value: unknown): unknown {
    const { type, targetClass } =
      typeof field === 'string'
        ? { type: field, targetClass: undefined }
        : field;

    const invalid = (expected: string) =>
      new Parse.Error(
        Parse.Error.INCORRECT_TYPE,
        `${name} must be ${expected}`,
      );

    switch (type) {
      case 'Number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw invalid('a number');
        }
        return value;

      case 'String':
        if (typeof value !== 'string') throw invalid('a string');
        return value;

      case 'Array':
        if (!Array.isArray(value)) throw invalid('an array');
        return value;

      // A Date, an ISO date string or an encoded { __type: 'Date', iso }.
      case 'Date': {
        const iso = (value as { iso?: unknown } | null)?.iso;
        const raw = typeof iso === 'string' ? iso : value;
        const date =
          raw instanceof Date || typeof raw === 'string' ? new Date(raw) : null;

        if (!date || Number.isNaN(date.getTime())) {
          throw invalid('a Date or ISO date string');
        }
        return date;
      }

      case 'Pointer': {
        const pointer = value as
          | { id?: unknown; objectId?: unknown; className?: unknown }
          | null
          | undefined;
        const id =
          typeof value === 'string'
            ? value
            : (pointer?.id ?? pointer?.objectId);

        if (typeof id !== 'string' || !id) {
          throw invalid(`a ${targetClass} pointer or objectId`);
        }

        if (pointer?.className && pointer.className !== targetClass) {
          throw invalid(`a ${targetClass} pointer`);
        }

        return Parse.Object.fromJSON({
          __type: 'Pointer',
          className: targetClass,
          objectId: id,
        });
      }

      default:
        throw new Error(
          `Unsupported field type ${type satisfies never as string} for ${name}`,
        );
    }
  }

  // Updates and saves a Task from a plain object of field values. If
  // data.objectId is passed, that Task is fetched from the server first
  // (with options, so the caller's ACL access applies) and only the given
  // fields are changed; a null value unsets a field. Without an objectId a
  // new Task is saved, the same as create(). Fields are checked against
  // FIELDS the same way as in create().
  async update(
    data: TaskUpdateData = {},
    options: RequestOptions = {},
  ): Promise<ParseObject> {
    const { objectId, ...fields } = data;

    this.assertKnownFields(fields);

    if (objectId === undefined || objectId === null) {
      return this.create(fields, options);
    }

    if (typeof objectId !== 'string' || !objectId) {
      throw new Parse.Error(
        Parse.Error.INVALID_KEY_NAME,
        'objectId must be a non-empty string',
      );
    }

    const object = await new Parse.Query(CLASS_NAME).get(objectId, options);
    this.setFields(object, fields, { unsetNull: true });

    return object.save(null, options);
  }
}

export default new Task();
