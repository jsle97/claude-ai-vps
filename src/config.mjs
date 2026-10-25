// file: src/config.mjs
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

// 0, empty and garbage fall back to the default instead of silently disabling a limit.
const envInt = function (name, def) {
 const n = Number(process.env[name]);
 return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
};

export const cfg = {
 port: Number(process.env.PORT) || 49995,
 host: process.env.HOST || '127.0.0.1',
 publicUrl: process.env.PUBLIC_URL || '',
 keys: (process.env.CLAUDE_AI_VPS_KEYS || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
  const [label, hash] = s.split(':');
  return { label, hash: Buffer.from(hash || '', 'hex') };
 }).filter(k => k.label && k.hash.length === 32),
 audit: process.env.AUDIT_LOG || path.resolve('audit.log'),
 home: process.env.SHELL_HOME || os.homedir(),
 roots: (process.env.WRITE_ROOTS || '').split(',').map(s => s.trim()).filter(Boolean).map(s => path.resolve(s)),
 sessionTtl: 30 * 60e3,
 maxSessions: 20,
 maxBody: 4 * 1024 * 1024,
 maxUpload: envInt('MAX_UPLOAD', 500 * 1024 * 1024),
 maxDownload: envInt('MAX_DOWNLOAD', 500 * 1024 * 1024),
 ticketTtl: envInt('TICKET_TTL', 600),
 maxOut: 64 * 1024,
 maxRead: 256 * 1024,
 maxReadLines: 2000,
 maxFiles: 20,
 maxBatch: 1024 * 1024,
 maxEditLen: 64 * 1024,
 defTimeout: 60,
 maxTimeout: 600,
 syntaxTimeout: 5000,
 failLimit: 20,
 failWindow: 10 * 60e3
};

export const PROTOS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const VERSION = await readFile(new URL('../package.json', import.meta.url), 'utf8').then(s => JSON.parse(s).version).catch(() => 'dev');
