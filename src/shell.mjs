// file: src/shell.mjs
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { cfg } from './config.mjs';

export const shq = function (s) {
 return "'" + String(s).replace(/'/g, "'\\''") + "'";
};

export const clip = function (buf) {
 if (buf.length <= cfg.maxOut) return buf.toString('utf8');
 const half = cfg.maxOut / 2;
 return buf.subarray(0, half).toString('utf8') + `\n…[truncated ${buf.length - cfg.maxOut} bytes]…\n` + buf.subarray(-half).toString('utf8');
};

export const run = function (s, cmd, timeoutSec) {
 // Marker printed after the command lets us recover the final cwd without a persistent shell
 const mark = '__RSH_' + crypto.randomBytes(8).toString('hex') + '__';
 const script = `${cmd}\n__rc=$?; printf '\\n%s%s\\n' '${mark}' "$PWD"; exit $__rc`;
 return new Promise(resolve => {
  const t0 = Date.now();
  const ch = spawn('bash', ['-c', script], { cwd: s.cwd, env: { ...process.env, HOME: cfg.home }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [], err = [];
  let outLen = 0, errLen = 0, timedOut = false, done = false;
  const cap = cfg.maxOut * 4;
  const finish = function (r) {
   if (done) return;
   done = true;
   clearTimeout(timer);
   resolve(r);
  };
  ch.stdout.on('data', d => { if (outLen < cap) out.push(d); outLen += d.length; });
  ch.stderr.on('data', d => { if (errLen < cap) err.push(d); errLen += d.length; });
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-ch.pid, 'SIGKILL'); } catch { } }, timeoutSec * 1000);
  ch.on('error', e => finish({ code: -1, stdout: '', stderr: e.code === 'ENOENT' ? 'bash not found on PATH, exec requires bash' : e.message, ms: Date.now() - t0, timedOut, bytes: 0 }));
  ch.on('close', code => {
   let stdout = Buffer.concat(out).toString('utf8');
   const i = stdout.lastIndexOf('\n' + mark);
   if (i !== -1) {
    const cwd = stdout.slice(i + mark.length + 1).trim();
    if (cwd) s.cwd = cwd;
    stdout = stdout.slice(0, i);
   }
   finish({ code: timedOut ? 124 : code, stdout: clip(Buffer.from(stdout)), stderr: clip(Buffer.concat(err)), ms: Date.now() - t0, timedOut, bytes: outLen + errLen });
  });
 });
};
