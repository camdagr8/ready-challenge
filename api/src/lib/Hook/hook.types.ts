// Types for the Hook SDK (hook.ts): types first, then interfaces, each in
// alphabetical order.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// A hook callback. It receives the params passed to run() or runSync(),
// followed by the shared context object. Async callbacks may return a
// promise; the resolved value is stored on the context under the
// callback's id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- hook params are arbitrary
export type HookCallback = (...args: any[]) => unknown;

// 'async' hooks run with run() and are awaited in order; 'sync' hooks run
// with runSync().
export type HookType = 'async' | 'sync';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

// A registered callback.
export interface HookAction {
  callback: HookCallback;
  id: string;
  order: number;
}

// The context passed to every callback of a run, after its params. Callbacks
// can add to it, and run() also stores each async callback's result under
// its id.
export interface HookContext {
  [key: string]: unknown;
  hook: string;
  params: unknown[];
}

// Where a registered callback lives, by id.
export interface HookLocation {
  name: string;
  type: HookType;
}

// The Hook SDK (hook.ts), also available as the global `Hook`.
export interface HookSDK {
  // Registered callbacks by type, hook name and id.
  action: Record<HookType, Record<string, Record<string, HookAction>>>;

  // Where each registered id lives, for unregister().
  actionIds: Record<string, HookLocation>;

  // Removes every callback registered for a hook.
  flush(name: string, type?: HookType): void;

  // Names of the hooks with callbacks registered, sorted.
  list(type?: HookType): string[];

  // Registers an async callback and returns its id.
  register(
    name: string,
    callback: HookCallback,
    order?: number,
    id?: string,
  ): string;

  // Registers a sync callback and returns its id.
  registerSync(
    name: string,
    callback: HookCallback,
    order?: number,
    id?: string,
  ): string;

  // Runs a hook's async callbacks one at a time, lowest order first, and
  // resolves with the context. If a callback throws, the rest are skipped
  // and the promise rejects with { [id]: error }.
  run(name: string, ...params: unknown[]): Promise<HookContext>;

  // Runs a hook's sync callbacks, lowest order first, and returns the
  // context.
  runSync(name: string, ...params: unknown[]): HookContext;

  // Removes a callback by the id register() returned.
  unregister(id: string): void;
}
