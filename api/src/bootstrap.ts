import express, { type Application } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Middleware } from './middleware/middleware.types.ts';

const middlewareDir = path.join(import.meta.dirname, 'middleware');

const MAX_DEPTH = 2;

// Returns .ts paths relative to `root`, e.g. 'health.ts' or 'auth/session.ts',
// looking up to MAX_DEPTH levels of subdirectories deep.
const collect = (root: string, dir = '', depth = 0): string[] =>
  fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const rel = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return depth < MAX_DEPTH ? collect(root, rel, depth + 1) : [];
      }

      const isMiddleware =
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.d.ts') &&
        !entry.name.endsWith('.types.ts') &&
        !entry.name.endsWith('.test.ts') &&
        rel !== 'index.ts';

      return isMiddleware ? [rel] : [];
    });

/**
 * Returns every .ts file in ./middleware and its subdirectories (up to
 * MAX_DEPTH levels deep, except the top-level index.ts and .types.ts files,
 * which only hold types) as a file:// URL
 * that can be passed straight to import(). Sorted by relative path so load
 * order is predictable.
 */
export const getMiddlewares = (dir: string = middlewareDir): string[] =>
  collect(dir)
    .sort()
    .map((rel) => pathToFileURL(path.join(dir, rel)).href);

export default async (app?: Application): Promise<Application> => {
  const { PORT = '1337', SERVER_URL = `http://localhost:${PORT}/parse` } =
    process.env;

  app = app || express();

  await Hook.run('bootstrap', {
    app,
    port: Number(PORT),
    serverUrl: SERVER_URL,
  });

  // MIDDLEWARES
  // Load each middleware in order and call its default export with the app.
  // Awaited one at a time so async setup (e.g. Parse Server start) finishes
  // before the next middleware runs and before the server starts listening.
  const middlewares = getMiddlewares();

  for (const url of middlewares) {
    const { default: middleware } = (await import(url)) as {
      default?: Middleware;
    };

    if (typeof middleware !== 'function') {
      console.warn(`Skipping ${url}: default export is not a function`);
      continue;
    }

    await middleware(app);
  }

  // Created before listening so beforeStart callbacks can attach to it
  // (e.g. the Parse LiveQuery WebSocket server).
  const httpServer = http.createServer(app);

  await Hook.run('beforeStart', {
    app,
    httpServer,
    port: Number(PORT),
    serverUrl: SERVER_URL,
  });

  httpServer.listen(Number(PORT), async () => {
    await Hook.run('started', {
      app,
      httpServer,
      port: Number(PORT),
      serverUrl: SERVER_URL,
    });
  });

  return app;
};
