// file: src/tickets.mjs
import crypto from 'node:crypto';
import { cfg } from './config.mjs';

// Transfer URLs carry a random, short-lived, single-use ticket instead of the API key.
// A ticket is bound to one operation (upload or download), one owner and one absolute path.
// Only the sha256 of the ticket is kept in memory, so a heap dump does not reveal usable URLs.
const store = new Map();
const MAX_PENDING = 500;

const idOf = function (token) {
 return crypto.createHash('sha256').update(token).digest('hex');
};

const sweep = function () {
 const now = Date.now();
 for (const [id, t] of store) if (t.exp <= now) store.delete(id);
};

setInterval(sweep, 60e3).unref();

export const tickets = {
 issue: function (kind, owner, abs) {
  sweep();
  if (store.size >= MAX_PENDING) throw new Error('too many pending transfer tickets, wait for them to expire');
  const token = crypto.randomBytes(24).toString('base64url');
  const id = idOf(token);
  const exp = Date.now() + cfg.ticketTtl * 1000;
  store.set(id, { kind, owner, path: abs, exp });
  return { token, tid: id.slice(0, 12), exp };
 },
 peek: function (token, kind) {
  const t = store.get(idOf(token));
  if (!t || t.kind !== kind) return null;
  if (t.exp <= Date.now()) { store.delete(idOf(token)); return null; }
  return { ...t, tid: idOf(token).slice(0, 12) };
 },
 take: function (token, kind) {
  const t = tickets.peek(token, kind);
  if (t) store.delete(idOf(token));
  return t;
 }
};
