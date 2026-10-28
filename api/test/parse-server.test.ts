import express, { type Application } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Replace Parse Server with a fake so these tests don't need MongoDB.
// vi.hoisted lets the mock factory (hoisted above imports) use these.
const { ParseServer, start, createLiveQueryServer } = vi.hoisted(() => {
  const start = vi.fn(async () => {});
  const createLiveQueryServer = vi.fn(async () => ({}));
  const ParseServer = Object.assign(
    vi.fn((options: Record<string, unknown>) => {
      const app = express();
      app.get('/test', (req, res) => {
        res.json({ appId: options.appId });
      });
      return { start, app };
    }),
    { createLiveQueryServer },
  );
  return { ParseServer, start, createLiveQueryServer };
});

vi.mock('parse-server', () => ({ ParseServer }));

const { default: parseServer } =
  await import('../src/middleware/Parse/parse-server.ts');

type Options = Record<string, unknown> & { cloud: () => Promise<unknown> };
const lastOptions = () => ParseServer.mock.lastCall?.[0] as Options;

describe('parse-server middleware', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('APP_ID', 'test-app');
    vi.stubEnv('MASTER_KEY', 'test-master-key');
    vi.stubEnv('DATABASE_URI', 'mongodb://localhost:27017/test');
    vi.stubEnv('PORT', '4000');
    vi.stubEnv('SERVER_URL', '');
    ParseServer.mockClear();
    start.mockClear();
    createLiveQueryServer.mockClear();
    Hook.flush('beforeStart');
    Hook.flush('started');
  });

  it('starts Parse Server and mounts it at /parse', async () => {
    const app: Application = express();
    await parseServer(app);

    expect(start).toHaveBeenCalledOnce();

    const res = await request(app).get('/parse/test');
    expect(res.body).toEqual({ appId: 'test-app' });
  });

  it('passes the .env settings through to Parse Server', async () => {
    vi.stubEnv('SERVER_URL', 'https://api.example.com/parse');
    await parseServer(express());

    expect(lastOptions()).toMatchObject({
      appId: 'test-app',
      masterKey: 'test-master-key',
      databaseURI: 'mongodb://localhost:27017/test',
      serverURL: 'https://api.example.com/parse',
      allowClientClassCreation: false,
    });
  });

  it('enables LiveQuery for the Task and Summary classes', async () => {
    await parseServer(express());

    expect(lastOptions().liveQuery).toEqual({
      classNames: ['Summary', 'Task'],
    });
  });

  it('attaches the LiveQuery server to the HTTP server on beforeStart', async () => {
    vi.stubEnv('SERVER_URL', 'https://api.example.com/parse');
    await parseServer(express());
    expect(createLiveQueryServer).not.toHaveBeenCalled();

    const httpServer = {};
    await Hook.run('beforeStart', { httpServer });

    expect(createLiveQueryServer).toHaveBeenCalledWith(
      httpServer,
      {
        appId: 'test-app',
        masterKey: 'test-master-key',
        serverURL: 'https://api.example.com/parse',
      },
      lastOptions(),
    );
  });

  it('builds SERVER_URL from PORT when it is not set', async () => {
    delete process.env.SERVER_URL;
    await parseServer(express());

    expect(lastOptions().serverURL).toBe('http://localhost:4000/parse');
  });

  it('loads Cloud Code with a function that imports cloud/index.ts', async () => {
    await parseServer(express());
    const { cloud } = lastOptions();

    expect(typeof cloud).toBe('function');

    vi.stubGlobal('Parse', {
      Cloud: { define: vi.fn(), beforeSave: vi.fn() },
    });
    await cloud();
    expect(Parse.Cloud.define).toHaveBeenCalledWith(
      'task-seed',
      expect.any(Function),
    );
    vi.unstubAllGlobals();
  });

  it.each(['APP_ID', 'MASTER_KEY', 'DATABASE_URI'])(
    'does not start without %s',
    async (name) => {
      vi.stubEnv(name, '');
      await parseServer(express());

      expect(ParseServer).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    },
  );
});
