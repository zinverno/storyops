import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathExists } from '../shared/fs.js';

/** Locates the package root (the directory containing fixtures/ and skills/), from source or dist. */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (pathExists(path.join(dir, 'fixtures', 'habr', 'manifest.json')) && pathExists(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Cannot locate the storyops package root (fixtures/ not found).');
}
