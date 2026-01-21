# codeAgent-sync

Minimal MVP for PC Codex Companion ↔ Backend ↔ iOS.

## Layout

- `apps/companion-backend`: Hono + PostgreSQL + WebSocket backend
- `apps/pc-companion`: Node CLI with node-pty + ws
- `docs/companion-mvp.md`: protocol, events, and flows

## Quick Start

1) Backend setup:

- Ensure PostgreSQL is running and create a database.
- Copy the env file and set `DATABASE_URL`.

```bash
cp apps/companion-backend/.env.example apps/companion-backend/.env
```

- Run migrations (dbmate example):

```bash
cd apps/companion-backend
DBMATE_MIGRATIONS_DIR=db/migrations dbmate up
```

2) Run backend:

```bash
pnpm dev:backend
```

3) Run companion (flags or env):

```bash
pnpm dev:pc -- \
  --backend http://localhost:8787 \
  --agent-name mac-mini-1 \
  --codex-cmd "codex"
```

Or use env defaults:

```bash
cp apps/pc-companion/.env.example apps/pc-companion/.env
COMPANION_BACKEND=http://localhost:8787 \
COMPANION_AGENT_NAME=mac-mini-1 \
pnpm dev:pc
```

Notes:

- `--backend` defaults to `http://localhost:8787`.
- `--agent-name` defaults to the Codex resume/session id from `--codex-cmd` if present.
- If no resume/session id is passed, it scans `~/.codex/sessions` for the newest session id after startup.
- When no session id is found, it falls back to the host name.
- Set `COMPANION_CODEX_HOME` to override the `~/.codex` location.

4) (Optional) Link global CLI:

```bash
pnpm link:pc
agent-sync --backend http://localhost:8787 --agent-name mac-mini-1 --codex-cmd "codex"
ags --backend http://localhost:8787 --agent-name mac-mini-1 --codex-cmd "codex"
```
