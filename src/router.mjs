// file: src/router.mjs
import { clientIp, send, readBody } from './http.mjs';
import { auth } from './auth.mjs';
import { rpc } from './rpc.mjs';
import { handleUpload } from './routes/upload.mjs';
import { handleDownload } from './routes/download.mjs';

export const route = async function (req, res) {
 const ip = clientIp(req);
 const url = new URL(req.url, 'http://x');
 if (url.pathname.endsWith('/health')) return send(res, 200, { ok: true });
 if (auth.blocked(ip)) return send(res, 429, { error: 'too many requests' });
 // Paths may arrive with a proxy prefix, so match only the trailing /<endpoint>[/<key>]; the key may also come as a Bearer header
 const m = url.pathname.match(/\/(mcp|upload|download)(?:\/([A-Za-z0-9_-]{20,128}))?\/?$/);
 const raw = m && (m[2] || auth.bearer(req));
 const key = raw && auth.check(raw);
 if (!key) { auth.fail(ip); return send(res, 404, { error: 'not found' }); }
 if (m[1] === 'upload') return handleUpload(req, res, key, ip, url);
 if (m[1] === 'download') return handleDownload(req, res, key, ip, url);
 if (req.method === 'GET') return send(res, 405, { error: 'SSE stream not supported' }, { Allow: 'POST' });
 if (req.method === 'DELETE') return send(res, 200, {});
 if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
 let msg;
 try { msg = JSON.parse(await readBody(req)); } catch { return send(res, 400, rpc.err(null, -32700, 'Parse error')); }
 const ctx = { key, ip, raw };
 if (Array.isArray(msg)) {
  const out = (await Promise.all(msg.map(x => rpc.handle(x, ctx)))).filter(Boolean);
  return out.length ? send(res, 200, out) : send(res, 202);
 }
 const out = await rpc.handle(msg, ctx);
 return out ? send(res, 200, out) : send(res, 202);
};
