// file: src/tools/handlers/read.mjs
import { cfg } from '../../config.mjs';
import { sess } from '../../sessions.mjs';
import { audit } from '../../audit.mjs';
import { fsx, lineHead } from '../../fsx.mjs';

export const readHandlers = {
 read_file: async function (a, ctx) {
  const s = sess.get(a.sessionId, ctx.key);
  if (typeof a.path !== 'string' || !a.path) throw new Error('path must be a non-empty string');
  const p = sess.resolve(s, a.path);
  const from = a.start_line ?? a.fromLine ?? 1;
  const to = a.end_line ?? a.toLine ?? null;
  const r = await fsx.readSlice(p, from, to);
  audit.log({ key: ctx.key, ip: ctx.ip, sid: s.id, read: p, from: r.from, to: r.to, truncated: r.truncated }).catch(() => { });
  return { path: p, size: r.size, lines: r.total, from: r.from, to: r.to, truncated: r.truncated, content: lineHead(r) + '\n' + r.text };
 },
 read_files: async function (a, ctx) {
  const s = sess.get(a.sessionId, ctx.key);
  if (!Array.isArray(a.paths) || !a.paths.length) throw new Error('paths must be a non-empty array');
  if (a.paths.length > cfg.maxFiles) throw new Error(`too many files (${a.paths.length} > ${cfg.maxFiles})`);
  const files = [];
  const parts = [];
  let budget = cfg.maxBatch;
  for (const ent of a.paths) {
   const rel = typeof ent === 'string' ? ent : (ent && ent.path);
   const from = (ent && typeof ent === 'object' ? (ent.start_line ?? ent.fromLine) : null) || 1;
   const to = (ent && typeof ent === 'object' ? (ent.end_line ?? ent.toLine) : null) || null;
   if (!rel || typeof rel !== 'string') {
    parts.push('── ? ──\nerror: invalid entry');
    files.push({ path: null, ok: false, error: 'invalid entry' });
    continue;
   }
   if (budget <= 0) {
    parts.push(`── ${rel} ──\nskipped: batch byte budget (${cfg.maxBatch}B) exhausted`);
    files.push({ path: rel, ok: false, error: 'skipped: budget exhausted' });
    continue;
   }
   try {
    const p = sess.resolve(s, rel);
    const r = await fsx.readSlice(p, from, to);
    let text = r.text;
    let cut = false;
    const bytes = Buffer.byteLength(text);
    if (bytes > budget) {
     // Cut on a line boundary so the batch output stays parseable.
     const buf = Buffer.from(text);
     let slice = buf.subarray(0, budget).toString('utf8');
     const nl = slice.lastIndexOf('\n');
     if (nl > 0) slice = slice.slice(0, nl);
     text = slice;
     cut = true;
    }
    budget -= Math.min(Buffer.byteLength(text), budget);
    parts.push(`── ${rel} ──\n${lineHead(r)}\n${text}${cut ? '\n…[batch budget exhausted]' : ''}`);
    files.push({ path: p, ok: true, bytes: r.size, from: r.from, to: r.to, truncated: r.truncated || cut });
   } catch (e) {
    parts.push(`── ${rel} ──\nerror: ${e.message}`);
    files.push({ path: rel, ok: false, error: e.message });
   }
  }
  audit.log({ key: ctx.key, ip: ctx.ip, sid: s.id, read: files.map(f => f.path) }).catch(() => { });
  return { files, text: parts.join('\n\n') };
 }
};
