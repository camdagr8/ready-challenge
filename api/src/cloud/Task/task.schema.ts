// Schema for the Task class: its fields and class-level permissions. Used by
// task.sdk.ts to create the class and to check field values. The cloud
// loader skips .schema.ts files, so this is never run as Cloud Code.
import type { FieldSpec, TaskData } from './task.types.ts';

// The Parse Object Class name.
export const CLASS_NAME: string = 'Task';

// Max number of objects to return at once.
export const READ_LIMIT: number = 1000;

// Fields for the Task class: a type name, or { type, ...options } for types
// that need options (e.g. a Pointer's targetClass). objectId, createdAt,
// updatedAt and ACL are added by Parse automatically, so they aren't listed.
export const FIELDS: Record<keyof TaskData, FieldSpec> = {
  order: 'Number',
  task: 'String',
  status: 'String',
  hours: 'Number',
  description: 'String',
  notes: 'String',
  focus: 'String',
  priority: 'String',
  startedAt: 'Date',
  activity: 'Array',
  creator: { type: 'Pointer', targetClass: '_User' },
  owner: { type: 'Pointer', targetClass: '_User' },
};

// Class-level permissions. Anyone can read, create and update tasks, but
// only the master key can delete them or add new fields to the class.
export const CLP: Record<string, unknown> = {
  find: { '*': true },
  count: { '*': true },
  get: { '*': true },
  create: { '*': true },
  update: { '*': true },
  delete: {},
  addField: {},
  protectedFields: { '*': [] },
};
