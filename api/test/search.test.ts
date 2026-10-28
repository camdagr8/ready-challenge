import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SummaryObject, Week } from '../src/cloud/Search/search.types.ts';
import type { TaskObject } from '../src/cloud/Task/task.types.ts';

const { default: SDK } = await import('../src/cloud/Search/search.sdk.ts');

// Minimal stand-in for a Parse.Object: get() and createdAt.
const fake = <T>(attrs: Record<string, unknown>) =>
  ({
    id: String(Math.random()),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    get: (key: string) => attrs[key],
  }) as unknown as T;

const entry = (status: string, iso: string) => ({
  status,
  timestamp: new Date(iso),
});

const metrics = (overrides: Record<string, unknown> = {}) => ({
  start: '',
  end: '',
  timeZone: 'UTC',
  totalTasks: 0,
  tasksTouched: 0,
  completed: 0,
  started: 0,
  statusChanges: 0,
  openHighPriority: 0,
  totalHours: 0,
  hoursByFocus: {},
  hoursByPriority: {},
  statusCounts: {},
  ...overrides,
});

const summary = (week: string, start: string, end: string) =>
  fake<SummaryObject>({
    week,
    start: new Date(start),
    end: new Date(end),
    summary: `Summary for ${week}`,
    metrics: metrics({ tasksTouched: 2, completed: 1 }),
  });

// The current week, with no Summary.
const current = {
  week: '2026-44',
  start: new Date('2026-10-26T00:00:00Z'),
  end: new Date('2026-11-01T23:59:59.999Z'),
  timeZone: 'UTC',
};

// Hashes each word into one of 64 dimensions, so texts sharing words are
// close. Normalized like the real embeddings.
const embed = (text: string): number[] => {
  const vector = new Array<number>(64).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 64;
    vector[hash] += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((n) => n / norm);
};

const embeddings = {
  embedQuery: async (text: string) => embed(text),
  embedDocuments: async (texts: string[]) => texts.map(embed),
} as unknown as FaissStore['embeddings'];

const week = (label: string, completed: string[], worked: string[] = []) =>
  ({
    week: label,
    start: new Date('2026-10-05T00:00:00Z'),
    end: new Date('2026-10-11T23:59:59.999Z'),
    summary: null,
    text: '',
    metrics: metrics(),
    completed: completed.map((task) => ({
      task,
      status: 'completed',
      priority: 'high',
      focus: 'high',
      hours: 2,
    })),
    worked: worked.map((task) => ({
      task,
      status: 'active',
      priority: 'low',
      focus: 'low',
      hours: 1,
    })),
  }) as Week;

describe('Search weeks', () => {
  it('builds a week per summary, plus the current week, oldest first', () => {
    const tasks = [
      fake<TaskObject>({
        task: 'Add a task-create cloud function',
        status: 'completed',
        activity: [
          entry('pending', '2026-10-01T00:00:00Z'),
          entry('completed', '2026-10-21T00:00:00Z'),
        ],
      }),
      fake<TaskObject>({
        task: 'Add dark mode',
        status: 'active',
        activity: [
          entry('pending', '2026-10-01T00:00:00Z'),
          entry('active', '2026-10-20T00:00:00Z'),
          entry('completed', '2026-10-27T00:00:00Z'),
        ],
      }),
    ];

    const weeks = SDK.weeks(
      [
        summary('2026-43', '2026-10-19T00:00:00Z', '2026-10-25T23:59:59.999Z'),
        summary('2026-41', '2026-10-05T00:00:00Z', '2026-10-11T23:59:59.999Z'),
      ],
      tasks,
      current,
    );

    expect(weeks.map((w) => w.week)).toEqual(['2026-41', '2026-43', '2026-44']);

    const [, w43, w44] = weeks;
    expect(w43.completed.map((t) => t.task)).toEqual([
      'Add a task-create cloud function',
    ]);
    expect(w43.worked.map((t) => t.task)).toEqual(['Add dark mode']);
    expect(w43.text).toBe('Summary for 2026-43');

    expect(w44.summary).toBeNull();
    expect(w44.completed.map((t) => t.task)).toEqual(['Add dark mode']);
    expect(w44.metrics.completed).toBe(1);
  });

  it('skips summaries saved before weeks were added', () => {
    const old = fake<SummaryObject>({
      start: new Date('2026-10-05T00:00:00Z'),
      end: new Date('2026-10-11T00:00:00Z'),
      metrics: metrics(),
    });

    expect(SDK.weeks([old], [], current).map((w) => w.week)).toEqual([
      '2026-44',
    ]);
  });

  it('works out focus shares and completion rate', () => {
    const overview = SDK.overview({
      ...week('2026-41', ['A']),
      metrics: metrics({
        tasksTouched: 4,
        completed: 1,
        totalHours: 10,
        hoursByFocus: { high: 2, low: 8 },
      }),
    });

    expect(overview).toMatchObject({
      start: '2026-10-05',
      end: '2026-10-11',
      completionRate: 0.25,
      focusShare: { high: 0.2, low: 0.8 },
      completedTasks: ['A'],
    });
  });

  it('indexes an overview per week and an entry per task', () => {
    const docs = SDK.documents([week('2026-41', ['A', 'B'], ['C'])]);

    expect(docs.map((doc) => doc.metadata)).toEqual([
      { week: '2026-41', kind: 'overview' },
      { week: '2026-41', kind: 'completed', task: 'A' },
      { week: '2026-41', kind: 'completed', task: 'B' },
      { week: '2026-41', kind: 'worked', task: 'C' },
    ]);
  });
});

describe('Search FAISS', () => {
  const weeks = [
    week('2026-40', ['Write unit tests for the cloud function']),
    week('2026-41', ['Run an accessibility audit']),
    week('2026-42', ['Write unit tests for the beforeSave trigger']),
    week('2026-43', ['Write the API README']),
  ];

  const store = () =>
    FaissStore.fromDocuments(SDK.documents(weeks), embeddings);

  it('finds weeks by the work done in them, grouped by week', async () => {
    const hits = await SDK.searchWeeks(await store(), 'unit tests', 2);

    expect(hits.map((hit) => hit.week).sort()).toEqual(['2026-40', '2026-42']);
    expect(hits[0].matches).toContainEqual(
      expect.stringMatching(/^completed: Write unit tests/),
    );
  });

  it('ranks weeks by how alike their completed tasks are', async () => {
    const hits = await SDK.similarWeeks(await store(), weeks[2], 3);

    expect(hits[0].week).toBe('2026-40');
    expect(hits.map((hit) => hit.week)).not.toContain('2026-42');
  });
});

describe('search-weeks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  class ParseError extends Error {
    static SESSION_MISSING = 206;
    static INVALID_QUERY = 102;
    code: number;
    constructor(code: number, message: string) {
      super(message);
      this.code = code;
    }
  }

  const user = {
    id: 'u1',
    getSessionToken: () => 'r:token',
  } as never;

  it('is registered as a cloud function', async () => {
    const define = vi.fn();
    vi.stubGlobal('Parse', { Cloud: { define } });
    await import('../src/cloud/Search/search.ts');

    expect(define).toHaveBeenCalledWith('search-weeks', expect.any(Function));
  });

  it('requires a user, a query and a valid time zone', async () => {
    vi.stubGlobal('Parse', { Error: ParseError });

    await expect(SDK.search({ query: 'x' }, undefined)).rejects.toThrow(
      'requires a signed-in user',
    );
    await expect(SDK.search({ query: '  ' }, user)).rejects.toThrow(
      'query must be',
    );
    await expect(
      SDK.search({ query: 'x', timeZone: 'Mars/Base' }, user),
    ).rejects.toThrow('timeZone must be');
  });
});
