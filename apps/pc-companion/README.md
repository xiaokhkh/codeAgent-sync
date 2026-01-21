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
