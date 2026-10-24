// file: src/routes/download.mjs
import path from 'node:path';
import { stat, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { cfg } from '../config.mjs';
import { sess } from '../sessions.mjs';
import { audit } from '../audit.mjs';
import { send } from '../http.mjs';

export const handleDownload = async function (req, res, key, ip, url) {
 if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET, HEAD' });
 const rawPath = url.searchParams.get('path');
 if (!rawPath) return send(res, 400, { error: 'missing ?path= query parameter' });
 const sid = url.searchParams.get('sessionId');
 const s = sess.touch(sid, key);
 if (sid && !s) return send(res, 404, { error: `session "${sid}" not found, expired or owned by another key` });
 const src = path.resolve(s ? s.cwd : cfg.home, rawPath.replace(/^~(?=$|\/)/, cfg.home));
 // stat before open: opening a FIFO for reading would block until a writer appears
 const pre = await stat(src).catch(() => null);
 if (!pre || !pre.isFile()) return send(res, 404, { error: `not a regular file: ${src}` });
 let fh;
 try { fh = await open(src, 'r'); } catch (e) { return send(res, 403, { error: `cannot open ${src}: ${e.code || e.message}` }); }
 const st = await fh.stat();
 if (!st.isFile() || st.size > cfg.maxDownload) {
  await fh.close();
  if (!st.isFile()) return send(res, 404, { error: `not a regular file: ${src}` });
  return send(res, 413, { error: `file is ${st.size}B, limit is ${cfg.maxDownload}B` });
 }
 const name = path.basename(src);
 const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
 const ext = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
 res.writeHead(200, {
  'Content-Type': 'application/octet-stream',
  'Content-Length': st.size,
  'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${ext}`,
  'Last-Modified': st.mtime.toUTCString(),
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
 });
 if (req.method === 'HEAD' || !st.size) { await fh.close(); return res.end(); }
 try {
  // Bounded to the size announced in Content-Length even if the file grows meanwhile.
  await pipeline(fh.createReadStream({ start: 0, end: st.size - 1 }), res);
  audit.log({ key, ip, download: src, bytes: st.size }).catch(() => { });
 } catch (e) {
  audit.log({ key, ip, download: src, bytes: st.size, failed: e.message }).catch(() => { });
 }
};
