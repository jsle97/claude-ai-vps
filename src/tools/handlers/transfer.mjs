// file: src/tools/handlers/transfer.mjs
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { cfg } from '../../config.mjs';
import { sess } from '../../sessions.mjs';
import { audit } from '../../audit.mjs';
import { confine } from '../../paths.mjs';
import { fsx } from '../../fsx.mjs';
import { shq } from '../../shell.mjs';

export const transferHandlers = {
 upload_instruction: async function (a, ctx) {
  const s = sess.get(a.sessionId, ctx.key);
  if (typeof a.path !== 'string' || !a.path) throw new Error('path must be a non-empty string');
  const p = sess.resolve(s, a.path);
  // Only emit the command if the destination would be accepted by the upload endpoint.
  await confine(p);
  const base = cfg.publicUrl || `http://${cfg.host}:${cfg.port}`;
  const q = `?path=${encodeURIComponent(p)}&sessionId=${encodeURIComponent(s.id)}`;
  return {
   endpoint: `${base}/upload/${ctx.raw}${q}`,
   methods: ['PUT', 'POST'],
   maxUploadBytes: cfg.maxUpload,
   curl: `curl -X PUT -T ./local.bin "${base}/upload/${ctx.raw}${q}"`,
   headers: { 'x-target-path': p, 'x-session-id': s.id },
   options: { append: 'add &append=1 to the URL (or header x-append: 1) to append in place instead of replacing atomically' },
   response: '{ ok, path, bytes, sha256 }',
   notes: 'Body is streamed to disk (no RAM buffering, no JSON-RPC base64 overhead). Non-append uploads land in a temp file and are renamed atomically. append=1 writes in place (non-atomic, partial data survives an abort). Over-limit or aborted transfers leave no partial file behind.'
  };
 },
 download_instruction: async function (a, ctx) {
  const s = sess.get(a.sessionId, ctx.key);
  if (typeof a.path !== 'string' || !a.path) throw new Error('path must be a non-empty string');
  const p = sess.resolve(s, a.path);
  const st = await stat(p).catch(() => null);
  if (!st) throw new Error(`not found: ${p}`);
  if (st.isDirectory()) throw new Error(`is a directory, pack it with exec (tar -czf) and download the archive: ${p}`);
  if (!st.isFile()) throw new Error(`not a regular file: ${p}`);
  if (st.size > cfg.maxDownload) throw new Error(`file is ${st.size}B, limit is ${cfg.maxDownload}B`);
  const sha256 = await fsx.hashFile(p);
  const name = path.basename(p);
  const base = cfg.publicUrl || `http://${cfg.host}:${cfg.port}`;
  const q = `?path=${encodeURIComponent(p)}&sessionId=${encodeURIComponent(s.id)}`;
  const endpoint = `${base}/download/${ctx.raw}${q}`;
  audit.log({ key: ctx.key, ip: ctx.ip, sid: s.id, issued: p, bytes: st.size, sha256 }).catch(() => { });
  return {
   endpoint,
   methods: ['GET', 'HEAD'],
   path: p,
   bytes: st.size,
   mtime: st.mtime.toISOString(),
   sha256,
   curl: `curl -fsS -o ${shq(name)} "${endpoint}" && echo ${shq(sha256 + '  ' + name)} | sha256sum -c -`,
   notes: 'Body is streamed from disk as application/octet-stream with Content-Length. The SHA-256 reflects the file at the time of this call, so a file changed since then fails the check. The URL embeds the API key and is unauthenticated for anyone who holds it: treat it as a secret and keep it out of chat logs, screenshots and shell history.'
  };
 }
};
