// file: app.mjs
import http from 'node:http';
import { cfg, VERSION } from './src/config.mjs';
import { route } from './src/router.mjs';
import { send } from './src/http.mjs';

const server = http.createServer((req, res) => {
 route(req, res).catch(e => {
  if (res.headersSent) return res.destroy();
  send(res, 500, { error: e.message });
 });
});

if (!cfg.keys.length) console.warn('claude-ai-vps: CLAUDE_AI_VPS_KEYS is empty, all requests will be rejected');
if (!cfg.publicUrl) console.warn('claude-ai-vps: PUBLIC_URL unset, upload_instruction and download_instruction will emit the bind address');
server.listen(cfg.port, cfg.host, () => console.log(`claude-ai-vps ${VERSION} listening on ${cfg.host}:${cfg.port} (${cfg.keys.length} keys)`));
