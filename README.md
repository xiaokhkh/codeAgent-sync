# codeAgent-sync

Minimal MVP for PC Codex Companion ↔ Backend ↔ iOS.

## Layout

- `apps/companion-backend`: Hono + PostgreSQL + WebSocket backend
- `apps/pc-companion`: Node CLI with node-pty + ws
- `docs/companion-mvp.md`: protocol, events, and flows

## Quick Start

1) Run backend:

```bash
pnpm --filter @codeagent/companion-backend dev
```

2) Run companion:

```bash
pnpm --filter @codeagent/pc-companion dev -- \
  --backend http://localhost:8787 \
  --agent-name mac-mini-1 \
  --codex-cmd "codex"
```
