// file: src/router.mjs
import { clientIp, send, readBody } from './http.mjs';
import { auth } from './auth.mjs';
import { tickets } from './tickets.mjs';
import { rpc } from './rpc.mjs';
import { handleUpload } from './routes/upload.mjs';
import { handleDownload } from './routes/download.mjs';

export const route = async function (req, res) {
 const ip = clientIp(req);
 const url = new URL(req.url, 'http://x');
 if (url.pathname.endsWith('/health')) return send(res, 200, { ok: true });
 if (auth.blocked(ip)) return send(res, 429, { error: 'too many requests' });
 // Paths may arrive with a proxy prefix, so match only the trailing /<endpoint>[/t/<ticket> | /<key>]; the key may also come as a Bearer or x-api-key header
 const m = url.pathname.match(/\/(mcp|upload|download)(?:\/t\/([A-Za-z0-9_-]{20,128})|\/([A-Za-z0-9_-]{20,128}))?\/?$/);
 if (m && m[2]) {
  // Ticket URL: no API key involved. The ticket fixes the operation, the path and the owner.
  if (m[1] === 'mcp') { auth.fail(ip); return send(res, 404, { error: 'not found' }); }
  const up = m[1] === 'upload';
  const okMethod = up ? (req.method === 'PUT' || req.method === 'POST') : (req.method === 'GET' || req.method === 'HEAD');
  if (!okMethod) return send(res, 405, { error: 'method not allowed' }, { Allow: up ? 'PUT, POST' : 'GET, HEAD' });
  // HEAD only inspects: it must not burn the ticket that the following GET needs.
  const g = req.method === 'HEAD' ? tickets.peek(m[2], m[1]) : tickets.take(m[2], m[1]);
  if (!g) { auth.fail(ip); return send(res, 404, { error: 'not found' }); }
  const grant = { path: g.path, tid: g.tid };
  return up ? handleUpload(req, res, g.owner, ip, url, grant) : handleDownload(req, res, g.owner, ip, url, grant);
 }
 const raw = m && (m[3] || auth.bearer(req) || auth.apiKey(req));
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
