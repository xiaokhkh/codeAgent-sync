# PC Companion (MVP)

Node CLI that spawns Codex via PTY and bridges messages with the Companion backend.

## Requirements

- Node >= 22
- Codex CLI available on PATH

## Run

```bash
pnpm --filter @codeagent/pc-companion dev -- \
  --backend http://localhost:8787 \
  --agent-name mac-mini-1 \
  --codex-cmd "codex" \
  --token $COMPANION_TOKEN
```

Or use env defaults:

```bash
cp .env.example .env
COMPANION_BACKEND=http://localhost:8787 \
COMPANION_AGENT_NAME=mac-mini-1 \
pnpm --filter @codeagent/pc-companion dev
```

Optional env:

- `COMPANION_CODEX_HOME` overrides the `~/.codex` location used for session discovery.
- `COMPANION_CODEX_CWD` sets the working directory for Codex.
- `COMPANION_SKIP_GIT_REPO_CHECK` passes `--skip-git-repo-check` to Codex (default on).

Defaults:

- `--backend` defaults to `http://localhost:8787`.
- `--agent-name` defaults to the Codex resume/session id from `--codex-cmd` if present.
- If no resume/session id is passed, it scans `~/.codex/sessions` for the newest session id after startup.
- When no session id is found, it falls back to the host name.
- `--token` defaults to `dev-token`; override with `COMPANION_TOKEN` when needed.
- Use `--cwd` if you want to launch Codex inside a specific repo.
- By default, `--skip-git-repo-check` is enabled; use `--require-git-repo` to enforce it.
- `--codex-cmd` will auto-resolve `codex` from common PATH locations if needed.
- If `node-pty` fails, the CLI will try `script` (PTY) fallback before stdio.

## Global CLI (recommended)

Build and link the CLI once, then run `agent-sync` (or `ags`) anywhere:

```bash
pnpm --filter @codeagent/pc-companion build
pnpm -C . link
agent-sync --backend http://localhost:8787 --agent-name mac-mini-1 --codex-cmd "codex"
ags --backend http://localhost:8787 --agent-name mac-mini-1 --codex-cmd "codex"
```

Unlink:

```bash
pnpm -C . unlink
```

Build + run:

```bash
pnpm --filter @codeagent/pc-companion build
node apps/pc-companion/dist/index.js --backend http://localhost:8787 --agent-name mac-mini-1
```

## Behavior

- Registers the agent name (idempotent by name).
- Connects to `/realtime` as role `pc` and subscribes from the last saved seq.
- Writes inbound `message_in` content to Codex stdin (adds trailing newline).
- Buffers Codex output and flushes as `message_out` events after 800ms idle.
- Sends heartbeat every 15s.
- Stores last seq at `~/.companion/<agent_id>.json`.

## Optional restart command

If the backend sends `{ "type": "command", "cmd": "restart" }`, the companion will restart Codex.
