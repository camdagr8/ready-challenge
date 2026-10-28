import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getMiddlewares } from '../src/bootstrap.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('getMiddlewares', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'middleware-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const touch = (name: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), '');
  };
  const url = (name: string) => pathToFileURL(path.join(dir, name)).href;

  it('returns .ts files as sorted file:// URLs', () => {
    touch('b.ts');
    touch('a.ts');

    expect(getMiddlewares(dir)).toEqual([url('a.ts'), url('b.ts')]);
  });

  it('skips index.ts, .d.ts, .types.ts and .test.ts files, other extensions and folders', () => {
    touch('index.ts');
    touch('types.d.ts');
    touch('middleware.types.ts');
    touch('health.test.ts');
    touch('notes.md');
    touch('legacy.js');
    fs.mkdirSync(path.join(dir, 'nested.ts'));
    touch('health.ts');

    expect(getMiddlewares(dir)).toEqual([url('health.ts')]);
  });

  it('includes subdirectories up to 2 levels deep', () => {
    touch('top.ts');
    touch('a/one.ts');
    touch('a/index.ts');
    touch('a/b/two.ts');
    touch('a/b/c/three.ts');

    expect(getMiddlewares(dir)).toEqual([
      url('a/b/two.ts'),
      url('a/index.ts'),
      url('a/one.ts'),
      url('top.ts'),
    ]);
  });

  it('finds the real middleware by default', () => {
    const names = getMiddlewares().map((href) =>
      path.relative(
        path.join(import.meta.dirname, '../src/middleware'),
        fileURLToPath(href),
      ),
    );

    expect(names).toEqual([
      'Parse/parse-dashboard.ts',
      'Parse/parse-server.ts',
      'health.ts',
    ]);
  });
});
