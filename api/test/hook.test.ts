import { afterEach, describe, expect, it } from 'vitest';
import Hook, { Enums } from '../src/lib/Hook/hook.ts';

describe('Hook', () => {
  afterEach(() => {
    for (const type of ['async', 'sync'] as const) {
      for (const name of Hook.list(type)) Hook.flush(name, type);
    }
  });

  it('sets the global Hook', () => {
    expect(globalThis.Hook).toBe(Hook);
  });

  it('runs async callbacks in order with the params and a shared context', async () => {
    const calls: string[] = [];

    Hook.register(
      'test',
      async (a, b, context) => {
        calls.push(`low ${a} ${b}`);
        context.seen = [...(context.seen as string[]), 'low'];
      },
      Enums.priority.low,
    );

    Hook.register(
      'test',
      (a, b, context) => {
        calls.push(`highest ${a} ${b}`);
        context.seen = ['highest'];
        return 'first';
      },
      Enums.priority.highest,
      'first-id',
    );

    const context = await Hook.run('test', 1, 2);

    expect(calls).toEqual(['highest 1 2', 'low 1 2']);
    expect(context).toMatchObject({
      hook: 'test',
      params: [1, 2],
      seen: ['highest', 'low'],
      'first-id': 'first',
    });
  });

  it('keeps registration order for callbacks with the same order', async () => {
    const calls: number[] = [];
    Hook.register('ties', () => calls.push(1));
    Hook.register('ties', () => calls.push(2));
    Hook.register('ties', () => calls.push(3));

    await Hook.run('ties');

    expect(calls).toEqual([1, 2, 3]);
  });

  it('stops at the first error and rejects with { [id]: error }', async () => {
    const error = new Error('boom');
    let laterRan = false;

    Hook.register(
      'fails',
      () => {
        throw error;
      },
      0,
      'bad',
    );
    Hook.register(
      'fails',
      () => {
        laterRan = true;
      },
      1,
    );

    await expect(Hook.run('fails')).rejects.toEqual({ bad: error });
    expect(laterRan).toBe(false);
  });

  it('runs sync callbacks in order and returns the context', () => {
    Hook.registerSync(
      'sync',
      (x, context) => {
        context.out = `${context.out}-${x}b`;
      },
      10,
    );
    Hook.registerSync(
      'sync',
      (x, context) => {
        context.out = `${x}a`;
      },
      -10,
    );

    expect(Hook.runSync('sync', 'x')).toMatchObject({
      hook: 'sync',
      params: ['x'],
      out: 'xa-xb',
    });
  });

  it('keeps async and sync callbacks separate', async () => {
    let asyncRan = false;
    Hook.register('both', () => {
      asyncRan = true;
    });

    Hook.runSync('both');
    expect(asyncRan).toBe(false);

    await Hook.run('both');
    expect(asyncRan).toBe(true);
  });

  it('allows dots in hook names', async () => {
    let ran = false;
    Hook.register('plugin.init', () => {
      ran = true;
    });

    await Hook.run('plugin.init');

    expect(ran).toBe(true);
    expect(Hook.list()).toEqual(['plugin.init']);
  });

  it('unregisters a callback by id', async () => {
    let ran = false;
    const id = Hook.register('remove', () => {
      ran = true;
    });

    Hook.unregister(id);
    await Hook.run('remove');

    expect(ran).toBe(false);
    expect(Hook.actionIds[id]).toBeUndefined();
    expect(Hook.list()).not.toContain('remove');
    expect(() => Hook.unregister('unknown')).not.toThrow();
  });

  it('flushes every callback for a hook and forgets their ids', async () => {
    const id = Hook.register('flush', () => {
      throw new Error('should not run');
    });

    Hook.flush('flush');

    await expect(Hook.run('flush')).resolves.toMatchObject({ hook: 'flush' });
    expect(Hook.actionIds[id]).toBeUndefined();
    expect(Hook.list()).not.toContain('flush');
  });

  it('lists hook names by type, sorted', () => {
    Hook.register('b', () => {});
    Hook.register('a', () => {});
    Hook.registerSync('s', () => {});

    expect(Hook.list()).toEqual(['a', 'b']);
    expect(Hook.list('sync')).toEqual(['s']);
  });
});
