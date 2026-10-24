// file: src/fsx.mjs
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat, open, rename, unlink } from 'node:fs/promises';
import { cfg } from './config.mjs';

// ── file helpers shared by read/write/edit tools ─────────────
export const fsx = {
 applyFrag: function (content, old, rep) {
  if (typeof old !== 'string' || !old.length) return { ok: false, error: 'old_text must be a non-empty string' };
  if (typeof rep !== 'string') return { ok: false, error: 'new_text must be a string' };
  const hits = [];
  let idx = content.indexOf(old), from = 0;
  while (idx !== -1) { hits.push(idx); from = idx + 1; idx = content.indexOf(old, from); }
  if (!hits.length) return { ok: false, error: `old_text not found (${old.length} chars)` };
  const lineOf = p => content.slice(0, p).split('\n').length;
  if (hits.length > 1) return { ok: false, error: `old_text not unique, found ${hits.length}x at lines ${hits.map(lineOf).join(',')}` };
  const pos = hits[0];
  return { ok: true, updated: content.slice(0, pos) + rep + content.slice(pos + old.length), line: lineOf(pos) };
 },
 syntaxCheck: async function (abs, content) {
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.json') {
   try { JSON.parse(content); return 'ok'; } catch (e) { return e.message; }
  }
  if (ext !== '.js' && ext !== '.mjs' && ext !== '.cjs') return 'ok';
  const r = await fsx.nodeCheck(abs, content, ext);
  // A .js under "type": "commonjs" (or Node < 22.7) fails on ESM syntax although it may be browser or ESM code: retry as .mjs
  if (ext === '.js' && r !== 'ok' && /outside a module|Unexpected token 'export'/.test(r)) return fsx.nodeCheck(abs, content, '.mjs');
  return r;
 },
 nodeCheck: async function (abs, content, ext) {
  // Temp file lives in the target dir so node --check sees the same package.json (ESM vs CJS)
  const tmp = path.join(path.dirname(abs), '.check-' + crypto.randomBytes(6).toString('hex') + ext);
  try {
   await writeFile(tmp, content);
   const r = await new Promise(resolve => {
    const ch = spawn(process.execPath, ['--check', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let done = false;
    const finish = function (v) { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { try { ch.kill('SIGKILL'); } catch { } }, cfg.syntaxTimeout);
    ch.stdout.on('data', d => out.push(d));
    ch.stderr.on('data', d => out.push(d));
    ch.on('error', e => finish({ code: -1, text: e.message }));
    ch.on('close', code => finish({ code, text: Buffer.concat(out).toString('utf8').trim().slice(0, 800) }));
   });
   return r.code === 0 ? 'ok' : (r.text || 'syntax error');
  } finally {
   await unlink(tmp).catch(() => { });
  }
 },
 writeAtomic: async function (abs, content) {
  const tmp = abs + '.tmp-' + crypto.randomBytes(6).toString('hex');
  try {
   await writeFile(tmp, content);
   await rename(tmp, abs);
  } catch (e) {
   await unlink(tmp).catch(() => { });
   throw e;
  }
 },
 hashFile: async function (abs) {
  const h = crypto.createHash('sha256');
  for await (const chunk of createReadStream(abs)) h.update(chunk);
  return h.digest('hex');
 },
 readSlice: async function (abs, from, to) {
  const st = await stat(abs);
  if (!st.isFile()) throw new Error(`not a file: ${abs}`);
  const a = Math.max(1, Number(from) || 1);
  const b = to ? Math.max(a, Number(to)) : null;
  const fh = await open(abs, 'r');
  try {
   if (st.size <= cfg.maxRead) {
    const raw = await fh.readFile({ encoding: 'utf8' });
    const lines = raw.split('\n');
    const total = lines.length;
    if (a > total) throw new Error(`start_line(${a}) > total lines(${total})`);
    const end = b ? Math.min(b, total) : total;
    return { text: lines.slice(a - 1, end).join('\n'), from: a, to: end, total, size: st.size, truncated: false };
   }
   // Large file: skip to start_line by counting raw newline bytes, then decode one window of at most maxRead bytes.
   const buf = Buffer.alloc(64 * 1024);
   let pos = 0, line = 1;
   while (line < a && pos < st.size) {
    const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
    if (!bytesRead) break;
    const view = buf.subarray(0, bytesRead);
    let i = 0;
    while (line < a) {
     const nl = view.indexOf(10, i);
     if (nl === -1) { i = bytesRead; break; }
     line++;
     i = nl + 1;
    }
    pos += i;
   }
   if (line < a) throw new Error(`start_line(${a}) > total lines(${line})`);
   const want = Math.min(st.size - pos, cfg.maxRead);
   const win = Buffer.alloc(want);
   let got = 0;
   while (got < want) {
    const { bytesRead } = await fh.read(win, got, want - got, pos + got);
    if (!bytesRead) break;
    got += bytesRead;
   }
   const eof = pos + got >= st.size;
   const lines = win.subarray(0, got).toString('utf8').split('\n');
   // Before EOF the last piece is a partial line; keep it only when it is all there is (one huge line).
   if (!eof && lines.length > 1) lines.pop();
   const out = lines.slice(0, b ? b - a + 1 : cfg.maxReadLines);
   const total = eof ? a - 1 + lines.length : null;
   return { text: out.join('\n'), from: a, to: a + out.length - 1, total, size: st.size, truncated: total === null };
  } finally {
   await fh.close();
  }
 }
};

export const lineHead = function (r) {
 if (r.total === null) return `[lines ${r.from}-${r.to}, ${r.size}B file, truncated — use start_line/end_line for more]`;
 return `[lines ${r.from}-${r.to} of ${r.total}, ${r.size}B]`;
};
