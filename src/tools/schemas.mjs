// file: src/tools/schemas.mjs
import { cfg } from '../config.mjs';

const size = function (n) {
 return n >= 1048576 ? `${Math.round(n / 1048576)}MB` : `${n}B`;
};

export const tools = [
 {
  name: 'session_open',
  description: 'Open a shell session on the VPS. Returns sessionId used by every other tool; the session remembers cwd between calls. Expires after 30 min idle.',
  inputSchema: { type: 'object', properties: { cwd: { type: 'string', description: 'Initial working directory (default $HOME)' } } },
  annotations: { readOnlyHint: true }
 },
 {
  name: 'session_close',
  description: 'Close a shell session.',
  inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
  annotations: { readOnlyHint: true }
 },
 {
  name: 'exec',
  description: 'Run a bash command in the session cwd. Each call is a fresh bash process: cd persists (cwd is tracked), exported variables do not. Output is truncated to 64KB per stream. Rules: back up files before destructive changes, run node --check before pm2 restart, prefer grep -F -- for literals.',
  inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, command: { type: 'string' }, timeout: { type: 'integer', minimum: 1, maximum: cfg.maxTimeout, description: `Seconds (default ${cfg.defTimeout})` } }, required: ['sessionId', 'command'] },
  annotations: { destructiveHint: true, openWorldHint: false }
 },
 {
  name: 'read_file',
  description: 'Read a text file relative to the session cwd. Response starts with a header like [lines 1-40 of 120, 3.2kB]. Large files are truncated: use start_line/end_line instead of reading everything. Text only: for binaries or byte-exact copies use download_instruction.',
  inputSchema: {
   type: 'object',
   properties: {
    sessionId: { type: 'string' },
    path: { type: 'string' },
    start_line: { type: 'integer', minimum: 1, description: '1-based first line' },
    end_line: { type: 'integer', minimum: 1, description: '1-based last line (inclusive)' }
   },
   required: ['sessionId', 'path']
  },
  annotations: { readOnlyHint: true }
 },
 {
  name: 'read_files',
  description: 'Read up to 20 files in one call (total budget 1MB). Errors are reported per file and do not abort the batch. Each entry may be a path string or {path,start_line,end_line}.',
  inputSchema: {
   type: 'object',
   properties: {
    sessionId: { type: 'string' },
    paths: {
     type: 'array',
     items: {
      anyOf: [
       { type: 'string' },
       { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } }, required: ['path'] }
      ]
     }
    }
   },
   required: ['sessionId', 'paths']
  },
  annotations: { readOnlyHint: true }
 },
 {
  name: 'write_file',
  description: 'Create or overwrite a file (parent dirs created, write is atomic via temp+rename). Writes are confined to $HOME and WRITE_ROOTS. The content is syntax-checked before the write (node --check for JS, JSON.parse for JSON) and the result is reported in the "syntax" field; on a syntax error the file is still written, so "syntax" is the only signal that something is off. Prefer edit_fragment for existing files; use /upload for binaries or files above a few hundred KB.',
  inputSchema: {
   type: 'object',
   properties: {
    sessionId: { type: 'string' },
    path: { type: 'string' },
    content: { type: 'string' },
    encoding: { type: 'string', enum: ['utf8', 'base64'] },
    append: { type: 'boolean' }
   },
   required: ['sessionId', 'path', 'content']
  },
  annotations: { destructiveHint: true }
 },
 {
  name: 'edit_fragment',
  description: 'Replace exactly one unique fragment in an existing file. old_text must match exactly once (whitespace included) — 0 hits or multiple hits are rejected with the candidate line numbers. The new content is syntax-checked BEFORE the write: on a syntax error nothing is saved. Use multi_edit for several changes.',
  inputSchema: {
   type: 'object',
   properties: { sessionId: { type: 'string' }, path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } },
   required: ['sessionId', 'path', 'old_text', 'new_text']
  },
  annotations: { destructiveHint: true }
 },
 {
  name: 'multi_edit',
  description: 'Apply several replacements to one file atomically: edits run in order, each sees the result of the previous one, and the file is written only if every edit applies and the result passes the syntax check. Any failure leaves the file untouched. Duplicate old_text values across edits are rejected up front.',
  inputSchema: {
   type: 'object',
   properties: {
    sessionId: { type: 'string' },
    path: { type: 'string' },
    edits: {
     type: 'array',
     minItems: 1,
     items: { type: 'object', properties: { old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['old_text', 'new_text'] }
    }
   },
   required: ['sessionId', 'path', 'edits']
  },
  annotations: { destructiveHint: true }
 },
 {
  name: 'upload_instruction',
  description: `Get a ready-to-use curl command for streaming a file straight to a destination path on the VPS (PUT/POST /upload/<key>, no JSON-RPC size limits, up to ${size(cfg.maxUpload)}, SHA-256 returned).`,
  inputSchema: {
   type: 'object',
   properties: { sessionId: { type: 'string' }, path: { type: 'string', description: 'Destination file path' } },
   required: ['sessionId', 'path']
  },
  annotations: { readOnlyHint: true }
 },
 {
  name: 'download_instruction',
  description: `Get a ready-to-use curl command for streaming a file from the VPS (GET /download/<key>, binary-safe, up to ${size(cfg.maxDownload)}, SHA-256 included for verification). Use it for binaries, large files or byte-exact copies instead of read_file. Directories are not served: pack them first with exec (e.g. tar -czf /tmp/x.tgz -C dir .) and download the archive.`,
  inputSchema: {
   type: 'object',
   properties: { sessionId: { type: 'string' }, path: { type: 'string', description: 'Source file path' } },
   required: ['sessionId', 'path']
  },
  annotations: { readOnlyHint: true }
 }
];
