// file: src/routes/upload.mjs
import crypto from 'node:crypto';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, stat, rename, unlink } from 'node:fs/promises';
import { cfg } from '../config.mjs';
import { sess } from '../sessions.mjs';
import { audit } from '../audit.mjs';
import { confine } from '../paths.mjs';
import { send } from '../http.mjs';

export const handleUpload = async function (req, res, key, ip, url) {
 if (req.method !== 'PUT' && req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'PUT, POST' });
 const rawPath = url.searchParams.get('path') || req.headers['x-target-path'];
 if (typeof rawPath !== 'string' || !rawPath) return send(res, 400, { error: 'missing ?path= query parameter or x-target-path header' });
 const sid = url.searchParams.get('sessionId') || req.headers['x-session-id'];
 const s = sess.touch(sid, key);
 if (sid && !s) return send(res, 404, { error: `session "${sid}" not found, expired or owned by another key` });
 let dest;
 try { dest = await confine(path.resolve(s ? s.cwd : cfg.home, rawPath.replace(/^~(?=$|\/)/, cfg.home))); } catch (e) { return send(res, 403, { error: e.message }); }
 const declared = Number(req.headers['content-length'] || 0);
 if (declared > cfg.maxUpload) return send(res, 413, { error: `declared size ${declared}B exceeds limit ${cfg.maxUpload}B` });
 const append = url.searchParams.get('append') === '1' || req.headers['x-append'] === '1';
 const prev = await stat(dest).catch(() => null);
 if (prev && prev.isDirectory()) return send(res, 400, { error: 'destination is a directory' });
 // Append overwrites in place; refuse anything that is not a regular file to avoid clobbering devices or pipes.
 if (append && prev && !prev.isFile()) return send(res, 400, { error: 'append target is not a regular file' });
 await mkdir(path.dirname(dest), { recursive: true });
 const rid = crypto.randomBytes(6).toString('hex');
 try { await audit.must({ key, ip, rid, upload: dest, declared, append }); } catch (e) { return send(res, 503, { error: e.message }); }
 const target = append ? dest : dest + '.upload-' + crypto.randomBytes(6).toString('hex');
 const hash = crypto.createHash('sha256');
 let bytes = 0, overflow = false, aborted = false;
 const meter = new Transform({
  transform: function (chunk, enc, cb) {
   bytes += chunk.length;
   if (bytes > cfg.maxUpload) { overflow = true; return cb(new Error('payload too large')); }
   hash.update(chunk);
   cb(null, chunk);
  }
 });
 // Client disconnect during a non-append upload must not leave the temp file behind.
 const onAbort = function () { aborted = true; };
 req.on('aborted', onAbort);
 try {
  await pipeline(req, meter, createWriteStream(target, append ? { flags: 'a' } : { flags: 'w' }));
  if (aborted) throw new Error('client aborted');
  if (!append) await rename(target, dest);
  const sha256 = hash.digest('hex');
  audit.log({ key, ip, rid, bytes, sha256 }).catch(() => { });
  return send(res, 200, { ok: true, path: dest, bytes, sha256, append });
 } catch (e) {
  req.off('aborted', onAbort);
  if (!append) {
   // Close the write stream before unlinking (pipeline already destroyed it on error).
   await unlink(target).catch(() => { });
  }
  audit.log({ key, ip, rid, failed: overflow ? 'too large' : aborted ? 'aborted' : e.message }).catch(() => { });
  if (overflow) return send(res, 413, { error: `payload exceeds limit ${cfg.maxUpload}B` });
  if (aborted) return send(res, 499, { error: 'client aborted' });
  return send(res, 500, { error: `upload failed: ${e.message}` });
 }
};
