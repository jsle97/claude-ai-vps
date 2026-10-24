// file: src/tools/handlers/session.mjs
import os from 'node:os';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { cfg } from '../../config.mjs';
import { sess } from '../../sessions.mjs';

export const sessionHandlers = {
 session_open: async function (a, ctx) {
  const cwd = a.cwd ? path.resolve(cfg.home, a.cwd.replace(/^~(?=$|\/)/, cfg.home)) : cfg.home;
  const st = await stat(cwd).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error(`not a directory: ${cwd}`);
  const s = sess.open(ctx.key, cwd);
  return { sessionId: s.id, cwd: s.cwd, host: os.hostname(), user: os.userInfo().username };
 },
 session_close: async function (a, ctx) {
  return { closed: sess.close(a.sessionId, ctx.key) };
 }
};
