// Hook: register callbacks under a name and run them in priority order.
// Importing this file also sets the global `Hook` (see src/types/global.d.ts),
// so src/index.ts imports it before anything else.
import { randomUUID } from 'node:crypto';
import type {
  HookAction,
  HookCallback,
  HookContext,
  HookSDK,
  HookType,
} from './hook.types.ts';

export const Enums = {
  cache: {
    settings: 1000 * 90,
  },
  priority: {
    highest: -1000,
    high: -500,
    neutral: 0,
    low: 500,
    lowest: 1000,
  },
  Plugin: {
    prematureCallError: (callName: string) =>
      `${callName} called before ready. Wait for Plugin.register() promise to be resolved.`,
  },
};

const noop: Record<HookType, HookCallback> = {
  sync: () => {},
  async: () => Promise.resolve(),
};

const Hook: HookSDK = {
  action: { async: {}, sync: {} },
  actionIds: {},

  /**
   * Clears all registered callbacks for a hook.
   * @param name the hook name
   * @param type 'async' (default) or 'sync' hooks
   */
  flush(name, type = 'async') {
    for (const id of Object.keys(Hook.action[type][name] ?? {})) {
      delete Hook.actionIds[id];
    }
    delete Hook.action[type][name];
  },

  /**
   * Lists the names of hooks that have callbacks registered, sorted.
   * @param type 'async' (default) or 'sync' hooks
   */
  list(type = 'async') {
    return Object.keys(Hook.action[type]).sort();
  },

  /**
   * Registers an async callback (an async function, or one returning a
   * promise) to call when the hook is run. It receives any params given to
   * Hook.run(), followed by a context object shared by every callback.
   * @param name the hook name
   * @param callback the callback
   * @param order lower runs first; defaults to Enums.priority.neutral
   * @param id unique id; a UUID is generated if not given
   * @returns the id, for Hook.unregister()
   * @example
   * Hook.register('plugin-init', async (context) => {
   *   // mutate context asynchronously here
   *   console.log('Plugins initialized!');
   * }, Enums.priority.highest);
   */
  register(name, callback, order, id) {
    return add('async', name, callback, order, id);
  },

  /**
   * Registers a sync callback to call when the hook is run with
   * Hook.runSync(). It receives any params given to Hook.runSync(),
   * followed by a context object shared by every callback.
   * @param name the hook name
   * @param callback the callback
   * @param order lower runs first; defaults to Enums.priority.neutral
   * @param id unique id; a UUID is generated if not given
   * @returns the id, for Hook.unregister()
   * @example
   * Hook.registerSync('my-sync-hook', (context) => {
   *   // mutate context synchronously here
   *   console.log('my-sync-hook run!');
   * }, Enums.priority.highest);
   */
  registerSync(name, callback, order, id) {
    return add('sync', name, callback, order, id);
  },

  /**
   * Runs a hook's async callbacks one at a time, lowest order first. Each
   * callback's result (or true if it returns nothing) is stored on the
   * context under its id. If a callback throws, the rest are skipped and
   * the promise rejects with { [id]: error }.
   * @param name the hook name
   * @param params any number of values passed to each callback
   * @returns the context passed to each callback
   */
  async run(name, ...params) {
    const context: HookContext = { hook: name, params };

    for (const { id, callback } of sorted('async', name)) {
      try {
        context[id] = (await callback(...params, context)) || true;
      } catch (error) {
        throw { [id]: error };
      }
    }

    return context;
  },

  /**
   * Runs a hook's sync callbacks, lowest order first.
   * @param name the hook name
   * @param params any number of values passed to each callback
   * @returns the context passed to each callback
   */
  runSync(name, ...params) {
    const context: HookContext = { hook: name, params };

    for (const { callback } of sorted('sync', name)) {
      callback(...params, context);
    }

    return context;
  },

  /**
   * Unregisters a callback by id.
   * @param id the id returned by Hook.register() or Hook.registerSync()
   */
  unregister(id) {
    const location = Hook.actionIds[id];
    if (!location) return;

    const { type, name } = location;
    const actions = Hook.action[type][name];

    delete actions?.[id];
    delete Hook.actionIds[id];

    // Drop the hook once it has no callbacks, so list() leaves it out.
    if (actions && Object.keys(actions).length === 0) {
      delete Hook.action[type][name];
    }
  },
};

// Stores a callback for register() and registerSync().
function add(
  type: HookType,
  name: string,
  callback: HookCallback,
  order: number = Enums.priority.neutral,
  id: string = randomUUID(),
): string {
  Hook.action[type][name] ??= {};
  Hook.action[type][name][id] = { id, order, callback };
  Hook.actionIds[id] = { type, name };

  return id;
}

// A hook's callbacks, lowest order first; ties keep registration order.
function sorted(type: HookType, name: string): HookAction[] {
  return Object.values(Hook.action[type][name] ?? {})
    .map((action) => ({ ...action, callback: action.callback ?? noop[type] }))
    .sort((a, b) => a.order - b.order);
}

globalThis.Hook = Hook;

export { Hook as default, Hook };
