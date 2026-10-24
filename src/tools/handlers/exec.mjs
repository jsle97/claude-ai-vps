// file: src/tools/handlers/exec.mjs
import crypto from 'node:crypto';
import { cfg } from '../../config.mjs';
import { sess } from '../../sessions.mjs';
import { audit } from '../../audit.mjs';
import { run } from '../../shell.mjs';

export const execHandlers = {
 exec: async function (a, ctx) {
  const s = sess.get(a.sessionId, ctx.key);
  const cmd = typeof a.command === 'string' ? a.command : '';
  if (!cmd.trim()) throw new Error('command must be a non-empty string');
  const timeout = Math.min(Math.max(Number(a.timeout) || cfg.defTimeout, 1), cfg.maxTimeout);
  const cwd0 = s.cwd;
  const rid = crypto.randomBytes(6).toString('hex');
  await audit.must({ key: ctx.key, ip: ctx.ip, sid: s.id, rid, cwd: cwd0, cmd });
  const r = await run(s, cmd, timeout);
  audit.log({ key: ctx.key, ip: ctx.ip, sid: s.id, rid, code: r.code, ms: r.ms, bytes: r.bytes }).catch(() => { });
  return { exitCode: r.code, cwd: s.cwd, timedOut: r.timedOut, durationMs: r.ms, stdout: r.stdout, stderr: r.stderr };
 }
};
