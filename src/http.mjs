// file: src/http.mjs
import { cfg } from './config.mjs';

// x-real-ip is honoured only from a loopback peer, i.e. a reverse proxy on the same host.
export const clientIp = function (req) {
 const peer = req.socket.remoteAddress || '';
 const fwd = req.headers['x-real-ip'];
 const local = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
 return local && typeof fwd === 'string' && fwd ? fwd : peer;
};

export const send = function (res, code, body, headers = {}) {
 const data = body === undefined ? '' : JSON.stringify(body);
 res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
 res.end(data);
};

export const readBody = function (req) {
 return new Promise((resolve, reject) => {
  const chunks = [];
  let len = 0;
  req.on('data', d => {
   len += d.length;
   if (len > cfg.maxBody) { reject(new Error('too large')); req.destroy(); return; }
   chunks.push(d);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
 });
};
