# claude-ai-vps

Minimal MCP server that hands a **shell and file access on a Linux VPS** to a model that has no shell of its own — claude.ai in the browser (Connectors / custom MCP), the mobile app, or any other MCP client that can reach an HTTPS URL.

## What it is and who it is for

**For:** people who run a VPS and want to ask a chat model "check why pm2 restarted, look at the log, bump the port and restart" from a phone or a browser tab, without SSH clients, without a desktop agent, without installing anything on the phone.

**What it is not:** a remote desktop, a web IDE, or a multi-tenant service. It is a single-operator tool: one person, one box, one or a few API keys.

Design choices that follow from that:

- **Stateless HTTP, JSON only.** Request/response. No SSE stream, no `Mcp-Session-Id`, no server memory between HTTP calls. Sessions are an application-level concept (`sessionId`), not MCP transport sessions.
- **No OAuth.** One shared secret per operator, sent in the URL or as `Authorization: Bearer`.
- **Tiny dependency surface.** Zero runtime dependencies, Node.js ≥ 22 only.
- **Raw `bash` behind `exec`.** The shell is the product, not an API wrapper around `ls` and `cat`. Everything else (`read_file`, `write_file`, …) exists only to save the model round trips and to give it syntax checks before it edits a file.

## Tools

| Tool | What it does |
| --- | --- |
| `session_open` | Opens a shell session (`sessionId`), remembers the cwd between calls. Expires after 30 min idle, max 20 sessions per server. |
| `session_close` | Closes a session. |
| `exec` | Runs a bash command in the session cwd. Fresh `bash` per call: `cd` persists (cwd is tracked), environment does not. `timeout` 1–600 s (default 60). Output truncated to 64 KB per stream. |
| `read_file` | Reads a text file, optional `start_line`/`end_line`. Response starts with `[lines 1-40 of 120, 3.2kB]`. |
| `read_files` | Up to 20 files in one call, 1 MB total budget, per-file errors do not abort the batch. |
| `write_file` | Creates/overwrites a file (atomic temp+rename), creates parent dirs, reports a `syntax` field (`node --check` for JS, `JSON.parse` for JSON). |
| `edit_fragment` | Replaces one **unique** fragment; 0 or multiple matches are rejected. Syntax checked **before** writing: nothing is saved on a syntax error. |
| `multi_edit` | Several replacements in one file, applied in order, written only if all apply and the result passes the syntax check. |
| `upload_instruction` | Returns a ready `curl` for `PUT /upload/<key>` — streams a local file straight to the VPS. |
| `download_instruction` | Returns a ready `curl` for `GET /download/<key>` plus the SHA-256 of the file. |

HTTP endpoints (all key-authenticated, key in the path or as Bearer):

```text
POST   /mcp/<key>        JSON-RPC 2.0 (initialize, ping, tools/list, tools/call)
PUT    /upload/<key>     ?path=/abs/target  (+ &append=1), body streamed to disk
GET    /download/<key>   ?path=/abs/source, streamed, SHA-256 printed by the instruction tool
GET    /health           {"ok":true}, no key
```

## Install, step by step

**1. Node.js ≥ 22** on the VPS (needs `bash` as well):

```bash
node -v          # must be v22 or newer
which bash
```

**2. Get the code** into a directory of the user that will own the shell:

```bash
git clone <this-repo> ~/claude-ai-vps && cd ~/claude-ai-vps
```

There is nothing to `npm install` — the server has no dependencies.

**3. Generate an API key:**

```bash
npm run -s keygen          # or: node scripts/keygen.mjs
```

It prints three things:

```text
key-rsxe:323aefe0355c…c774e6fd          <- stub line: paste into CLAUDE_AI_VPS_KEYS
Key (secret, shown once): rsh_RXpriULL…Hsd   <- the key: goes into the URL, nowhere else
```

Options: `--label prod` (name in `CLAUDE_AI_VPS_KEYS`, default `key-<4 random chars>`), `--prefix rsh_` (key prefix, makes keys greppable in logs), `--length 48` (16–128, prefix included), `--count 3`, `--json`. Only the SHA-256 of the key is stored on the server, so a lost key is re-generated, never recovered.

**4. Start the server** (pick one):

```bash
# foreground, does not survive logout
CLAUDE_AI_VPS_KEYS='key-rsxe:323a…' PORT=49995 HOST=127.0.0.1 node app.mjs

# pm2
pm2 start app.mjs --name claude-ai-vps --update-env

# systemd — /etc/systemd/system/claude-ai-vps.service
[Unit]
Description=claude-ai-vps MCP
After=network.target

[Service]
User=deploy
WorkingDirectory=/home/deploy/claude-ai-vps
Environment=PORT=49995
Environment=HOST=127.0.0.1
Environment=PUBLIC_URL=https://rsh.example.com
Environment=CLAUDE_AI_VPS_KEYS=key-rsxe:323a…
Environment=SHELL_HOME=/home/deploy
Environment=WRITE_ROOTS=/home/deploy,/srv/app
ExecStart=/usr/bin/node /home/deploy/claude-ai-vps/app.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

`npm start` is the same as `node app.mjs`. On start the server logs the bind address and the number of loaded keys, and warns if `CLAUDE_AI_VPS_KEYS` is empty (in that case every request is rejected).

**5. Put HTTPS in front of it.** claude.ai only talks to public HTTPS, so terminate TLS with nginx/caddy and proxy to `127.0.0.1:49995`, keeping the path:

```nginx
location / {
    proxy_pass http://127.0.0.1:49995;
    proxy_request_buffering off;      # stream uploads instead of buffering them to disk
    proxy_http_version 1.1;
    client_max_body_size 0;           # MAX_UPLOAD is enforced by the app
    proxy_read_timeout 700s;          # a single exec may run up to 600 s
    proxy_set_header X-Real-IP $remote_addr;
}
```

`X-Real-IP` is only honoured when the peer is loopback, i.e. exactly this setup; it feeds the per-IP brute-force counter.

**6. Smoke test** before wiring up any client:

```bash
curl -s http://127.0.0.1:49995/health
curl -s -X POST https://rsh.example.com/mcp/<key> -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**7. Add the connector in claude.ai:**

1. claude.ai → **Settings → Connectors → Add custom connector** (on mobile: Settings → Connectors, same list).
2. Name: `claude-ai-vps`. URL: `https://rsh.example.com/mcp/<key>` — the full URL **including the key**, with no trailing slash.
3. Leave the OAuth fields empty; this server has no OAuth. Add the connector, then enable it in a conversation (the tools icon) so the model can call `session_open`, `exec`, etc.
4. Ask something verifiable first: *"Use claude-ai-vps: open a session and run `hostname; df -h /`"*.

The connector URL is the secret. `?key=<key>` works as an alternative to `/mcp/<key>` if a client mangles path segments.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_AI_VPS_KEYS` | *(empty)* | Comma-separated `label:sha256hex` stubs, **no spaces**. Generate with `npm run keygen`. Empty = every request is rejected (404). |
| `PUBLIC_URL` | *(empty)* | Public base URL (`https://rsh.example.com`). Used by `upload_instruction`/`download_instruction` to build the URLs the model should curl. If unset the handlers emit the bind address, which a remote client usually cannot reach. |
| `SHELL_HOME` | `os.homedir()` | The directory the shell starts in, `~` expands to, and the first writable root. Point it at the user you want the model to act as. |
| `WRITE_ROOTS` | *(empty)* | Extra comma-separated directories that `write_file`/`edit_fragment`/`multi_edit`/`/upload` may write to, on top of `SHELL_HOME`. Relative paths are resolved against the server cwd. `exec` ignores this list (see Security). |
| `AUDIT_LOG` | `./audit.log` | JSON-lines audit file. Mutations are logged **before** they happen; if it cannot be appended to, the mutation is refused. |
| `MAX_UPLOAD` | `524288000` (500 MB) | Max size of a single `/upload` body, enforced while streaming. `0`/garbage falls back to the default. |
| `MAX_DOWNLOAD` | `524288000` (500 MB) | Max size of a file served by `/download` (checked before streaming). |
| `PORT` | `49995` | Listen port. |
| `HOST` | `127.0.0.1` | Bind address. Keep it loopback and let the proxy expose it; `0.0.0.0` puts the raw HTTP server on the internet. |

Fixed in code (not env): MCP body limit 4 MB, output truncation 64 KB per stream, `exec` timeout 60 s default / 600 s max, 30 min session idle TTL, 20 sessions, 20 failed auth attempts per IP per 10 min before `429`.

## Security model

Read this before pointing the server at a public URL. Short version: **the only real boundary is the API key.**

- **`exec` is a full shell.** It runs `bash -c` as the server user with no sandbox, no allow-list, no argument filtering. Anything that user can do, the model can do — including `cat ~/.ssh/id_ed25519`, `systemctl`, `curl | bash`, and killing the server. `WRITE_ROOTS` is not consulted by `exec`.
- **Path confinement is not a security boundary.** `WRITE_ROOTS`/`SHELL_HOME` limits apply to `write_file`, `edit_fragment`, `multi_edit` and `/upload`. They exist to stop the model writing into the wrong place by accident (system configs, other projects, `/etc`), not to stop an attacker: one `exec` call bypasses them completely. Read access is likewise unrestricted. Treat write confinement as a guardrail against model mistakes.
- **Symlinks are resolved best-effort.** Before a confined write, the deepest existing ancestor of the target is `realpath`-ed and the result must stay inside a root; symlinked parents, `..` in the path, dangling links and a write to `/` or to the home directory itself are rejected. Between that check and the actual write there is a window: a process that can create symlinks inside a root can win the race (**TOCTOU**). Non-atomic only in the sense that the path is re-resolved by the kernel at write time; the write itself is atomic (temp file + rename). `append` uploads are written in place.
- **Audit is fail-closed, with exceptions.** Every mutation (`exec` command, `write_file`, `edit_fragment`, `multi_edit`, `/upload`) is appended to `AUDIT_LOG` *before* it runs; if the log cannot be written the operation is refused with `refused, nothing changed`. Reads, downloads and the `*_instruction` tools only log *after* the fact and their failures are swallowed — if you need "nothing leaves the box without a log line", you must narrow this yourself. The log is plain text on disk: rotate it, and keep it out of anything the shell tools can read if the model is not trusted.
- **The key in the URL is the secret.** `/mcp/<key>`, `/upload/<key>` and `/download/<key>` embed the key; a `curl` line returned to the model therefore contains it, and so may appear in chat history, transcripts, screenshots or `~/.bash_history`. URLs leak through proxy access logs, browser history and `Referer` on any page that links them. If a key leaks, remove its stub from `CLAUDE_AI_VPS_KEYS` and restart — that is the whole revocation story (no per-key state, no expiry).
- **No OAuth, no `Mcp-Session-Id`.** There is no token endpoint, no refresh, no consent screen, no client registration, and no transport session to hijack. One static secret, `timingSafeEqual` comparison over SHA-256 hashes, unknown key ⇒ `404` (not `401`), 20 failures per IP per 10 min ⇒ `429`. Over plain HTTP the key travels in clear text — HTTPS is mandatory.
- **Processes survive a timeout.** `exec` runs the command in its own process group. On timeout the group is `SIGKILL`ed (exit code `124`) and output is still returned, but the kill cannot reach grandchildren that left the group — `setsid`, a daemon, `pm2`-daemonized children, `nohup` — or a process stuck in uninterruptible I/O. Anything like that keeps running after the call returns. `cd` survives only because the cwd is recovered from a marker line; exported variables and shell state do not.

What to do instead of trusting this: run the server as a dedicated unprivileged user, in a container/VM or with `systemd` hardening (`ProtectSystem=strict`, `ProtectHome=read-only` or separate user homes, `NoNewPrivileges`, `PrivateTmp`, restrictive `ReadWritePaths`), bind loopback, front everything with HTTPS, and treat any key you hand to a chat session as a credential that can do whatever that user can do.

## Audit log format

One JSON object per line:

```json
{"ts":"2026-02-20T23:32:05.123Z","key":"key-rsxe","ip":"127.0.0.1","sid":"AbC…","rid":"9f1c2a","cwd":"/home/deploy/app","cmd":"pm2 restart api"}
{"ts":"…","key":"key-rsxe","ip":"127.0.0.1","sid":"AbC…","write":"/home/deploy/app/app.mjs","bytes":735,"append":false,"syntax":"ok"}
{"ts":"…","key":"key-rsxe","ip":"127.0.0.1","rid":"9f1c2a","code":0,"ms":812,"bytes":1204}
```

`key` is the label, never the key or its hash. `rid` ties the pre-execution record to its result.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| claude.ai says the connector failed | URL is not public HTTPS, missing `/mcp/<key>`, or the proxy strips the path. `curl /health` and `curl -X POST …/mcp/<key>` from outside first. |
| Everything returns `404` | `CLAUDE_AI_VPS_KEYS` empty, key hash wrong, or label has a space/`:` (the stub gets split incorrectly). Check the startup log line with the key count. |
| `429 too many requests` | 20 failed auth attempts from that IP within 10 min. Fix the key or restart the server. |
| `upload_instruction` returns an unreachable URL | `PUBLIC_URL` unset. |
| `path is outside the writable roots` | `WRITE_ROOTS`/`SHELL_HOME` do not cover the target, or a symlinked parent resolves elsewhere. Use `exec` (deliberately) or extend the roots. |
| `refused, nothing changed: audit log unavailable` | `AUDIT_LOG` path is not writable by the server user. |
| `bash not found on PATH` | No `bash` on the box (`exec` requires it; Alpine needs `apk add bash`). |
| `exec` returns `124` and no output | Timeout — raise `timeout`, or move the work into a background job. |

## Layout

```text
app.mjs                  http server + startup warnings
scripts/keygen.mjs       key generator (prefix + random suffix, sha256 stub)
src/config.mjs           env parsing, limits, protocol versions
src/router.mjs           URL routing, auth, JSON-RPC dispatch
src/auth.mjs             key check, per-IP fail counter
src/paths.mjs            write confinement (realpath, best effort)
src/audit.mjs            fail-closed audit log
src/sessions.mjs         sessionId → cwd, bound to the owning key
src/shell.mjs            bash spawn, timeout, output clipping, cwd marker
src/fsx.mjs              atomic write, syntax check, line-addressed reads
src/rpc.mjs              initialize / tools/list / tools/call
src/tools/schemas.mjs    tool definitions shown to the model
src/tools/handlers/      one handler per tool
src/routes/upload.mjs    PUT /upload streaming
src/routes/download.mjs  GET /download streaming
```
