// file: src/tools/handlers/write.mjs
import path from 'node:path';
import { readFile, appendFile, mkdir, stat } from 'node:fs/promises';
import { cfg } from '../../config.mjs';
import { sess } from '../../sessions.mjs';
import { audit } from '../../audit.mjs';
import { confine } from '../../paths.mjs';
import { fsx } from '../../fsx.mjs';

export const writeHandlers = {
 write_file: async function (a, ctx) {
  const s = sess.get(a.sessionId, ctx.key);
  if (typeof a.path !== 'string' || !a.path) throw new Error('path must be a non-empty string');
  if (typeof a.content !== 'string') throw new Error('content must be a string');
  const p = await confine(sess.resolve(s, a.path));
  const st = await stat(p).catch(() => null);
  if (st && st.isDirectory()) throw new Error(`path is a directory: ${p}`);
  const data = Buffer.from(a.content, a.encoding === 'base64' ? 'base64' : 'utf8');
  await mkdir(path.dirname(p), { recursive: true });
  const syn = !a.append && a.encoding !== 'base64' ? await fsx.syntaxCheck(p, data.toString('utf8')) : 'ok';
  await audit.must({ key: ctx.key, ip: ctx.ip, sid: s.id, write: p, bytes: data.length, append: !!a.append, syntax: syn === 'ok' ? 'ok' : 'error' });
  if (a.append) await appendFile(p, data);
  else await fsx.writeAtomic(p, data);
  return { path: p, bytes: data.length, append: !!a.append, syntax: syn };
 },
 edit_fragment: async function (a, ctx) {
  const s = sess.get(a.sessionId, ctx.key);
  if (typeof a.path !== 'string' || !a.path) throw new Error('path must be a non-empty string');
  if (typeof a.old_text !== 'string' || !a.old_text.length) throw new Error('old_text must be a non-empty string');
  if (a.old_text.length > cfg.maxEditLen) throw new Error(`old_text too long (> ${cfg.maxEditLen} chars)`);
  if (typeof a.new_text !== 'string') throw new Error('new_text must be a string');
  const p = await confine(sess.resolve(s, a.path));
  const st = await stat(p).catch(() => null);
  if (!st || !st.isFile()) throw new Error(`not an existing file: ${p}`);
  const raw = await readFile(p, 'utf8');
  const r = fsx.applyFrag(raw, a.old_text, a.new_text);
  if (!r.ok) throw new Error(r.error);
  const syn = await fsx.syntaxCheck(p, r.updated);
  if (syn !== 'ok') {
   audit.log({ key: ctx.key, ip: ctx.ip, sid: s.id, rejected: p, tool: 'edit_fragment', reason: 'syntax' }).catch(() => { });
   throw new Error(`rejected, nothing written — syntax error: ${syn}`);
  }
  await audit.must({ key: ctx.key, ip: ctx.ip, sid: s.id, edit: p, line: r.line, old: a.old_text.length, new: a.new_text.length, bytes: Buffer.byteLength(r.updated) });
  await fsx.writeAtomic(p, r.updated);
  return { path: p, line: r.line, bytes: Buffer.byteLength(r.updated), syntax: 'ok' };
 },
 multi_edit: async function (a, ctx) {
  const s = sess.get(a.sessionId, ctx.key);
  if (typeof a.path !== 'string' || !a.path) throw new Error('path must be a non-empty string');
  if (!Array.isArray(a.edits) || !a.edits.length) throw new Error('edits must be a non-empty array');
  const seen = new Set();
  for (let i = 0; i < a.edits.length; i++) {
   const e = a.edits[i];
   if (typeof e?.old_text !== 'string' || !e.old_text.length) throw new Error(`edit ${i + 1}: old_text must be a non-empty string`);
   if (e.old_text.length > cfg.maxEditLen) throw new Error(`edit ${i + 1}: old_text too long (> ${cfg.maxEditLen} chars)`);
   if (typeof e.new_text !== 'string') throw new Error(`edit ${i + 1}: new_text must be a string`);
   if (seen.has(e.old_text)) throw new Error(`edit ${i + 1}: duplicate old_text (edits must be independent)`);
   seen.add(e.old_text);
  }
  const p = await confine(sess.resolve(s, a.path));
  const st = await stat(p).catch(() => null);
  if (!st || !st.isFile()) throw new Error(`not an existing file: ${p}`);
  let content = await readFile(p, 'utf8');
  const lines = [];
  for (let i = 0; i < a.edits.length; i++) {
   const r = fsx.applyFrag(content, a.edits[i].old_text, a.edits[i].new_text);
   if (!r.ok) {
    audit.log({ key: ctx.key, ip: ctx.ip, sid: s.id, rejected: p, tool: 'multi_edit', failed: i + 1 }).catch(() => { });
    throw new Error(`edit ${i + 1}/${a.edits.length}: ${r.error} — nothing written`);
   }
   content = r.updated;
   lines.push(r.line);
  }
  const syn = await fsx.syntaxCheck(p, content);
  if (syn !== 'ok') {
   audit.log({ key: ctx.key, ip: ctx.ip, sid: s.id, rejected: p, tool: 'multi_edit', reason: 'syntax' }).catch(() => { });
   throw new Error(`rejected, nothing written — syntax error: ${syn}`);
  }
  await audit.must({ key: ctx.key, ip: ctx.ip, sid: s.id, edit: p, edits: a.edits.length, bytes: Buffer.byteLength(content) });
  await fsx.writeAtomic(p, content);
  return { path: p, edits: a.edits.length, lines, bytes: Buffer.byteLength(content), syntax: 'ok' };
 }
};
