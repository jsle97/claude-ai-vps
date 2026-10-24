// file: src/paths.mjs
import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { cfg } from './config.mjs';

// Writes are confined to the home directory and any explicitly configured roots.
export const within = function (abs, root) {
 const rel = path.relative(root, abs);
 return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Symlinks of the deepest existing ancestor are resolved, so a link inside a root cannot redirect a write outside it.
export const confine = async function (abs) {
 let probe = abs, rest = '', real = null;
 while (real === null) {
  real = await realpath(probe).catch(() => null);
  if (real !== null) break;
  if (await lstat(probe).then(() => true, () => false)) throw new Error(`refusing to write through a dangling or unreadable link: ${probe}`);
  const up = path.dirname(probe);
  if (up === probe) { real = probe; break; }
  rest = rest ? path.join(path.basename(probe), rest) : path.basename(probe);
  probe = up;
 }
 const target = rest ? path.join(real, rest) : real;
 const home = await realpath(cfg.home).catch(() => path.resolve(cfg.home));
 if (target === path.parse(target).root) throw new Error(`refusing to write to filesystem root: ${abs}`);
 if (target === home) throw new Error(`refusing to overwrite home directory: ${abs}`);
 const roots = [home, ...await Promise.all(cfg.roots.map(r => realpath(r).catch(() => r)))];
 if (!roots.some(r => within(target, r))) {
  throw new Error(`path is outside the writable roots (${roots.join(', ')}): ${abs}${target !== abs ? ` (resolves to ${target})` : ''}`);
 }
 return target;
};
