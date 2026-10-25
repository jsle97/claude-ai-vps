// file: src/auth.mjs
import crypto from 'node:crypto';
import { cfg } from './config.mjs';

const fails = new Map();

export const auth = {
 check: function (key) {
  if (!key) return null;
  const h = crypto.createHash('sha256').update(key).digest();
  let hit = null;
  for (const k of cfg.keys) if (crypto.timingSafeEqual(h, k.hash)) hit = k.label;
  return hit;
 },
 bearer: function (req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+([A-Za-z0-9_-]{20,128})$/);
  return m ? m[1] : null;
 },
 apiKey: function (req) {
  const v = req.headers['x-api-key'];
  const m = typeof v === 'string' && v.match(/^[A-Za-z0-9_-]{20,128}$/);
  return m ? m[0] : null;
 },
 blocked: function (ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() - f.t > cfg.failWindow) { fails.delete(ip); return false; }
  return f.n >= cfg.failLimit;
 },
 fail: function (ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.t > cfg.failWindow) fails.set(ip, { n: 1, t: Date.now() });
  else f.n++;
 }
};
