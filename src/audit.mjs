// file: src/audit.mjs
import { appendFile } from 'node:fs/promises';
import { cfg } from './config.mjs';

// Mutations are logged before they happen (fail closed): if the log cannot be written, nothing changes.
export const audit = {
 log: function (rec) {
  return appendFile(cfg.audit, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n');
 },
 must: async function (rec) {
  try { await audit.log(rec); }
  catch (e) { throw new Error(`refused, nothing changed: audit log unavailable (${e.message})`); }
 }
};
