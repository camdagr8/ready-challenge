import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('cloud code', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const loadCloud = async () => {
    const define = vi.fn();
    const beforeSave = vi.fn();
    vi.stubGlobal('Parse', { Cloud: { define, beforeSave } });
    await import('../src/cloud/index.ts');
    return { define, beforeSave };
  };

  it('imports every cloud file so its functions are registered', async () => {
    const { define } = await loadCloud();
    const names = define.mock.calls.map(([name]) => name);

    expect(names).toContain('task-seed');
  });

  it('registers the Task beforeSave trigger', async () => {
    const { beforeSave } = await loadCloud();

    expect(beforeSave).toHaveBeenCalledWith('Task', expect.any(Function));
  });

  it.each(['task-seed', 'summary-seed'])(
    '%s requires the master key',
    async (name) => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const { define } = await loadCloud();
      const [, handler] = define.mock.calls.find(([n]) => n === name)!;

      expect(() => handler({ master: false })).toThrow('Master key required');
    },
  );
});

describe('getCloudFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const touch = (name: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), '');
  };

  // Importing the loader also loads the real cloud files, which need Parse.
  const getCloudFiles = async () => {
    vi.stubGlobal('Parse', {
      Cloud: { define: vi.fn(), beforeSave: vi.fn() },
    });
    const loader = await import('../src/cloud/index.ts');
    return loader.getCloudFiles(dir);
  };

  it('returns .ts files in sorted order, including subfolders', async () => {
    touch('b.ts');
    touch('a.ts');
    touch('Task/task.ts');

    expect(await getCloudFiles()).toEqual(['Task/task.ts', 'a.ts', 'b.ts']);
  });

  it('skips .d.ts, .test.ts, .types.ts, .schema.ts and .sdk. files', async () => {
    touch('Task/task.ts');
    touch('Task/task.d.ts');
    touch('Task/task.test.ts');
    touch('Task/task.types.ts');
    touch('Task/task.schema.ts');
    touch('Task/task.sdk.ts');
    touch('Task/notes.md');

    expect(await getCloudFiles()).toEqual(['Task/task.ts']);
  });

  it('finds the real cloud files by default, without the skipped ones', async () => {
    vi.stubGlobal('Parse', {
      Cloud: { define: vi.fn(), beforeSave: vi.fn() },
    });
    const loader = await import('../src/cloud/index.ts');
    const files = loader.getCloudFiles();

    expect(files).toContain('Task/task.ts');
    expect(files).not.toContain('index.ts');
    expect(
      files.filter((file) => /\.(types|schema)\.ts$|\.sdk\./.test(file)),
    ).toEqual([]);
  });
});
