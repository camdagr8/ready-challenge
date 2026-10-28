// Cloud Code entry point (loaded by Parse Server via the `cloud` option).
// Imports every other .ts file in this directory and its subdirectories
// (up to MAX_DEPTH levels deep), so each file can define its own
// functions, triggers and jobs with Parse.Cloud.*.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_DEPTH = 2;
const { dirname, filename } = import.meta;

// Returns paths relative to `root`, e.g. 'hello.ts' or 'users/triggers.ts'.
function collect(root: string, dir: string, depth: number): string[] {
  return fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return depth < MAX_DEPTH ? collect(root, rel, depth + 1) : [];
      }
      const isCloudFile =
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.d.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.types.ts') &&
        !entry.name.endsWith('.schema.ts') &&
        !entry.name.includes('.sdk.') &&
        path.join(root, rel) !== filename;
      return isCloudFile ? [rel] : [];
    });
}

/**
 * Returns the Cloud Code files under `root` (this directory by default) as
 * paths relative to it, sorted so load order is predictable. Skips this
 * file and .d.ts, .test.ts, .types.ts, .schema.ts and .sdk. files.
 */
export const getCloudFiles = (root: string = dirname): string[] =>
  collect(root, '', 0).sort();

// Imported one at a time, in path order, so everything is registered
// before Parse Server finishes starting.
for (const rel of getCloudFiles()) {
  await import(pathToFileURL(path.join(dirname, rel)).href);
}
