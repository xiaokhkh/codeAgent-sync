# Companion Backend (MVP)

Minimal Hono + PostgreSQL + WebSocket backend for Codex Companion.

## Requirements

- Node >= 22
- PostgreSQL 14+

## Environment

- `DATABASE_URL` (required)
- `COMPANION_TOKEN` (optional, bearer token for HTTP + WS)
- `PUBLIC_BASE_URL` (optional, for `ws_url` in register response; default `http://localhost:${PORT}`)
- `PORT` (optional, default 8787)

```bash
cp .env.example .env
```

## Migrations

This repo ships SQL migrations compatible with dbmate.

```bash
cd apps/companion-backend
# Example with dbmate
DBMATE_MIGRATIONS_DIR=db/migrations dbmate up
```

Or run the SQL directly in `db/migrations` using psql.

## Run

```bash
pnpm --filter @codeagent/companion-backend dev
```

## API Examples

Register an agent (idempotent by `name`):

```bash
curl -s -X POST http://localhost:8787/agents/register \
  -H 'Authorization: Bearer $COMPANION_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"name":"mac-mini-1","platform":"macOS"}'
```

List agents:

```bash
curl -s http://localhost:8787/agents \
  -H 'Authorization: Bearer $COMPANION_TOKEN'
```

Send a message to an agent:

```bash
curl -s -X POST http://localhost:8787/messages \
  -H 'Authorization: Bearer $COMPANION_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"<uuid>","content":"Hello from iOS"}'
```

Fetch backlog:

```bash
curl -s "http://localhost:8787/messages?agent_id=<uuid>&since_seq=0&limit=50" \
  -H 'Authorization: Bearer $COMPANION_TOKEN'
```

## WebSocket

Connect to `ws://localhost:8787/realtime?agent_id=<uuid>&role=pc`.

Include `Authorization: Bearer <token>` header, or pass `token` as query param if needed.

On connect, server sends:

```json
{ "type": "hello", "agent_id": "...", "last_seq": 12, "server_time": "..." }
```

Client messages:

```json
{ "type": "subscribe", "since_seq": 12 }
{ "type": "event", "event": { "type": "message_out", "sender": "pc", "payload": { "content": "..." } } }
{ "type": "heartbeat" }
```

Server messages:

```json
{ "type": "events", "events": [ ... ] }
{ "type": "event", "event": { ... } }
```
