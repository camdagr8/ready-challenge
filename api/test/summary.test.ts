import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskObject } from '../src/cloud/Task/task.types.ts';

const { default: SDK } = await import('../src/cloud/Summary/summary.sdk.ts');

const start = new Date('2026-10-19T00:00:00Z');
const end = new Date('2026-10-26T00:00:00Z');

// Minimal stand-in for a Task Parse.Object: get() and createdAt.
const fakeTask = (
  attrs: Record<string, unknown>,
  createdAt = new Date('2026-10-01T00:00:00Z'),
) =>
  ({
    id: String(Math.random()),
    createdAt,
    get: (key: string) => attrs[key],
  }) as unknown as TaskObject;

const entry = (status: string, iso: string) => ({
  status,
  timestamp: new Date(iso),
});

describe('Summary metrics', () => {
  it('counts completed and started tasks and hours in the window', () => {
    const tasks = [
      fakeTask({
        status: 'completed',
        priority: 'high',
        focus: 'high',
        hours: 5,
        activity: [
          entry('pending', '2026-10-01T00:00:00Z'),
          entry('active', '2026-10-20T00:00:00Z'),
          entry('completed', '2026-10-22T00:00:00Z'),
        ],
      }),
      fakeTask({
        status: 'active',
        priority: 'low',
        focus: 'low',
        hours: 2.5,
        activity: [
          entry('pending', '2026-10-01T00:00:00Z'),
          // Encoded the way Parse stores Dates inside arrays.
          { status: 'active', timestamp: { iso: '2026-10-21T00:00:00Z' } },
        ],
      }),
      // No activity in the window, so only counted in the snapshot.
      fakeTask({
        status: 'pending',
        priority: 'high',
        focus: 'medium',
        hours: 9,
        activity: [entry('pending', '2026-10-01T00:00:00Z')],
      }),
    ];

    const metrics = SDK.metrics(tasks, start, end);

    expect(metrics).toMatchObject({
      totalTasks: 3,
      tasksTouched: 2,
      completed: 1,
      started: 2,
      statusChanges: 3,
      openHighPriority: 1,
      totalHours: 7.5,
      hoursByFocus: { high: 5, low: 2.5 },
      hoursByPriority: { high: 5, low: 2.5 },
      statusCounts: { completed: 1, active: 1, pending: 1 },
    });
  });

  it("doesn't count a new task's first entry as a status change", () => {
    const created = new Date('2026-10-20T00:00:00Z');
    const task = fakeTask(
      {
        status: 'pending',
        activity: [entry('pending', created.toISOString())],
      },
      created,
    );

    const metrics = SDK.metrics([task], start, end);

    expect(metrics.tasksTouched).toBe(1);
    expect(metrics.statusChanges).toBe(0);
  });

  it('uses startedAt rather than createdAt for the window', () => {
    // Created after the window, but backdated to start inside it.
    const startedAt = new Date('2026-10-20T00:00:00Z');
    const task = fakeTask(
      {
        status: 'pending',
        startedAt,
        activity: [entry('pending', startedAt.toISOString())],
      },
      new Date('2026-10-27T00:00:00Z'),
    );

    const metrics = SDK.metrics([task], start, end);

    expect(metrics.tasksTouched).toBe(1);
    expect(metrics.statusChanges).toBe(0);
    expect(SDK.describe(task, start, end)).toContain('Started: 2026-10-20');
  });
});

describe('Summary weeks', () => {
  it.each([
    // [date, week, Monday start]
    ['2026-10-27T15:30:00Z', '2026-44', '2026-10-26'],
    ['2026-10-26T00:00:00Z', '2026-44', '2026-10-26'],
    ['2026-11-01T23:59:59Z', '2026-44', '2026-10-26'],
    // Days around New Year belong to the week of its Thursday.
    ['2026-01-01T00:00:00Z', '2026-01', '2025-12-29'],
    ['2027-01-01T00:00:00Z', '2026-53', '2026-12-28'],
    ['2024-12-30T00:00:00Z', '2025-01', '2024-12-30'],
  ])('weekOf(%s) is %s', (date, week, monday) => {
    const period = SDK.weekOf(new Date(date));

    expect(period.week).toBe(week);
    expect(period.start.toISOString()).toBe(`${monday}T00:00:00.000Z`);
    expect(period.end.getTime() - period.start.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000 - 1,
    );
  });

  it('weekFromString round-trips with weekOf', () => {
    const period = SDK.weekFromString('2026-44');

    expect(period?.start.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(period?.end.toISOString()).toBe('2026-11-01T23:59:59.999Z');
    expect(SDK.weekFromString('2026-1')?.week).toBe('2026-01');
  });

  it('uses local Mondays in the given time zone', () => {
    // 05:00 Monday in Tokyo, but still Sunday (week 43) in UTC.
    const date = new Date('2026-10-25T20:00:00Z');

    expect(SDK.weekOf(date).week).toBe('2026-43');

    const tokyo = SDK.weekOf(date, 'Asia/Tokyo');
    expect(tokyo.week).toBe('2026-44');
    expect(tokyo.start.toISOString()).toBe('2026-10-25T15:00:00.000Z');
    expect(tokyo.end.toISOString()).toBe('2026-11-01T14:59:59.999Z');
  });

  it('handles a week with a DST change', () => {
    // US clocks fall back on Sunday 2026-11-01, so this week is 169 hours.
    const chicago = SDK.weekFromString('2026-44', 'America/Chicago');

    expect(chicago?.start.toISOString()).toBe('2026-10-26T05:00:00.000Z');
    expect(chicago?.end.toISOString()).toBe('2026-11-02T05:59:59.999Z');
    expect(SDK.weekOf(chicago!.end, 'America/Chicago').week).toBe('2026-44');
  });

  it('dates task descriptions in the time zone', () => {
    const startedAt = new Date('2026-10-25T20:00:00Z');
    const task = fakeTask({ startedAt, activity: [] });

    expect(SDK.describe(task, start, end, 'Asia/Tokyo')).toContain(
      'Started: 2026-10-26',
    );
    expect(SDK.metrics([task], start, end, 'Asia/Tokyo').timeZone).toBe(
      'Asia/Tokyo',
    );
  });

  it.each(['2026-00', '2025-53', '2026-54', '2026-W44', 'nope'])(
    'weekFromString rejects %s',
    (week) => {
      expect(SDK.weekFromString(week)).toBeNull();
    },
  );
});

describe('summary cloud functions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const loadCloud = async () => {
    const define = vi.fn();
    vi.stubGlobal('Parse', { Cloud: { define, beforeSave: vi.fn() } });
    await import('../src/cloud/Summary/summary.ts');
    return define;
  };

  it('registers summary-create, summary-read and summary-schema', async () => {
    const define = await loadCloud();
    const names = define.mock.calls.map(([name]) => name);

    expect(names).toEqual(
      expect.arrayContaining([
        'summary-create',
        'summary-read',
        'summary-schema',
      ]),
    );
  });

  it('summary-schema requires the master key', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const define = await loadCloud();
    const [, handler] = define.mock.calls.find(
      ([name]) => name === 'summary-schema',
    )!;

    expect(() => handler({ master: false })).toThrow('Master key required');
  });
});
