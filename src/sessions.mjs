// file: src/sessions.mjs
import crypto from 'node:crypto';
import path from 'node:path';
import { cfg } from './config.mjs';

const sessions = new Map();

// Sessions are bound to the key that created them: a key never sees another key's session.
export const sess = {
 open: function (label, cwd) {
  sess.sweep();
  if (sessions.size >= cfg.maxSessions) throw new Error(`session limit reached (${cfg.maxSessions}), close one first`);
  const id = crypto.randomBytes(12).toString('base64url');
  const s = { id, owner: label, cwd: cwd || cfg.home, lastUsed: Date.now() };
  sessions.set(id, s);
  return s;
 },
 get: function (id, label) {
  sess.sweep();
  const s = sessions.get(id);
  if (!s || s.owner !== label) throw new Error(`session "${id}" not found or expired, call session_open`);
  s.lastUsed = Date.now();
  return s;
 },
 touch: function (id, label) {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s || s.owner !== label) return null;
  s.lastUsed = Date.now();
  return s;
 },
 close: function (id, label) {
  const s = sessions.get(id);
  if (!s || s.owner !== label) return false;
  return sessions.delete(id);
 },
 sweep: function () {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.lastUsed > cfg.sessionTtl) sessions.delete(id);
 },
 resolve: function (s, p) {
  return path.resolve(s.cwd, p.replace(/^~(?=$|\/)/, cfg.home));
 }
};

setInterval(sess.sweep, cfg.sessionTtl).unref();
