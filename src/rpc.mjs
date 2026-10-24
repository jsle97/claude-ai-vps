// file: src/rpc.mjs
import { PROTOS, VERSION } from './config.mjs';
import { tools } from './tools/schemas.mjs';
import { handlers } from './tools/handlers/index.mjs';

export const rpc = {
 ok: (id, result) => ({ jsonrpc: '2.0', id, result }),
 err: (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } }),
 handle: async function (msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpc.err(msg?.id ?? null, -32600, 'Invalid Request');
  const { id, method, params = {} } = msg;
  if (id === undefined) return null;
  switch (method) {
   case 'initialize':
    return rpc.ok(id, {
     protocolVersion: PROTOS.includes(params.protocolVersion) ? params.protocolVersion : PROTOS[0],
     capabilities: { tools: { listChanged: false } },
     serverInfo: { name: 'claude-ai-vps', version: VERSION },
     instructions: 'Shell and file access to the VPS. Start with session_open, then use exec/read_file/read_files/write_file/edit_fragment/multi_edit. Sessions are bound to the API key that created them. Writes are confined to $HOME and WRITE_ROOTS. For binaries or large files use upload_instruction (HTTP PUT /upload/<key>) to send and download_instruction (HTTP GET /download/<key>) to fetch. Never restart a Node/pm2 process before node --check passes; back up files before destructive edits.'
    });
   case 'ping':
    return rpc.ok(id, {});
   case 'tools/list':
    return rpc.ok(id, { tools });
   case 'tools/call': {
    const fn = handlers[params.name];
    if (!fn) return rpc.err(id, -32602, `Unknown tool: ${params.name}`);
    try {
     const res = await fn(params.arguments || {}, ctx);
     const failed = res.exitCode !== undefined ? res.exitCode !== 0 : res.ok === false;
     return rpc.ok(id, { content: [{ type: 'text', text: JSON.stringify(res, null, 1) }], structuredContent: res, isError: failed });
    } catch (e) {
     return rpc.ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
   }
   default:
    return rpc.err(id, -32601, `Method not found: ${method}`);
  }
 }
};
