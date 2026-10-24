// file: scripts/keygen.mjs
// Generates one CLAUDE_AI_VPS_KEYS entry: a random API key with a recognizable prefix
// plus the sha256 stub that the server actually stores.
import crypto from 'node:crypto';

// 62 chars: a byte gives a uniform index up to 248, bytes above that are redrawn.
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const LIMIT = 256 - (256 % CHARSET.length);
const MIN_LEN = 16;
const MAX_LEN = 128;
const MAX_TRY = 256;
// No ":" and no whitespace: both would break the comma-separated label:hash stub.
const PREFIX_RE = /^[A-Za-z0-9_-]{1,16}$/;

const fail = function (msg) {
 console.error(`keygen: ${msg}`);
 process.exit(1);
};

const randomKey = function (len) {
 let out = '';
 while (out.length < len) {
  for (const b of crypto.randomBytes(len * 2)) {
   if (b >= LIMIT) continue;
   out += CHARSET[b % CHARSET.length];
   if (out.length === len) break;
  }
 }
 return out;
};

const flags = { prefix: 'rsh_', label: null, length: 48, json: false, count: 1, help: false };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
 const a = args[i];
 const [name, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, null];
 const value = function () {
  if (inline !== null) return inline;
  const v = args[++i];
  if (v === undefined) fail(`${name} needs a value`);
  return v;
 };
 if (name === '-h' || name === '--help') flags.help = true;
 else if (name === '--json') flags.json = true;
 else if (name === '--prefix') flags.prefix = value();
 else if (name === '--label') flags.label = value();
 else if (name === '--length') flags.length = Number(value());
 else if (name === '--count') flags.count = Number(value());
 else fail(`unknown argument: ${a} (try --help)`);
}

if (flags.help) {
 console.log(`usage: node scripts/keygen.mjs [options]

  --label <name>     label stored in CLAUDE_AI_VPS_KEYS (default: key-<4 random chars>)
  --prefix <str>     key prefix, keeps keys greppable (default: rsh_)
  --length <n>       total key length ${MIN_LEN}-${MAX_LEN}, prefix included (default: 48)
  --count <n>        generate n keys, one per line (default: 1)
  --json             print {label, key, hash} objects instead of the stub line
  -h, --help         this text

The stub line is what CLAUDE_AI_VPS_KEYS expects; the key itself is shown once,
is not stored anywhere and cannot be recovered from the stub.`);
 process.exit(0);
}

if (!PREFIX_RE.test(flags.prefix)) fail('--prefix must be 1-16 chars of [A-Za-z0-9_-], e.g. rsh_ (no ":", no spaces)');
if (!Number.isInteger(flags.length) || flags.length < MIN_LEN || flags.length > MAX_LEN) fail(`--length must be an integer ${MIN_LEN}-${MAX_LEN}`);
if (flags.length <= flags.prefix.length) fail('--length must be longer than --prefix');
if (!Number.isInteger(flags.count) || flags.count < 1 || flags.count > 100) fail('--count must be an integer 1-100');

const LABEL_RE = /^[^\s:]+$/;
const taken = new Set();
const out = [];
for (let i = 0; i < flags.count; i++) {
 let label = flags.label;
 if (label !== null) label = flags.count > 1 ? `${label}-${i + 1}` : label;
 else {
  let t = 0;
  do { label = 'key-' + randomKey(4).toLowerCase(); } while (taken.has(label) && ++t < MAX_TRY);
 }
 if (!LABEL_RE.test(label)) fail(`invalid label "${label}": no whitespace or ":" (it is part of the comma-separated stub)`);
 if (taken.has(label)) fail(`duplicate label "${label}"`);
 taken.add(label);
 const key = flags.prefix + randomKey(flags.length - flags.prefix.length);
 out.push({ label, key, hash: crypto.createHash('sha256').update(key).digest('hex') });
}

if (flags.json) for (const r of out) console.log(JSON.stringify(r));
else for (const r of out) console.log(`${r.label}:${r.hash}`);

if (!flags.json) {
 const one = flags.count === 1;
 console.error('');
 console.error(`Key (secret, shown once${one ? '' : ', one per line below'}):`);
 for (const r of out) console.error(`  ${r.key}`);
 console.error('');
 console.error('Add the stub line above to CLAUDE_AI_VPS_KEYS (comma-separated, no spaces) and keep the key in the URL:');
 console.error(`  CLAUDE_AI_VPS_KEYS='${out.map(r => `${r.label}:${r.hash}`).join(',')}' node app.mjs`);
 console.error(`  https://<public-url>/mcp/${out[0].key}`);
}
