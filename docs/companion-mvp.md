# Codex Companion MVP Protocol

This document describes the minimal protocol between PC Companion, Backend, and iOS.

## Entities

- **Agent**: A PC Codex session instance registered by `name`.
- **Event**: Single source of truth stored in PostgreSQL and replayed by `seq`.

## Event Schema

```json
{
  "id": "uuid",
  "agent_id": "uuid",
  "seq": 42,
  "type": "message_in | message_out | agent_status",
  "sender": "ios | pc | system",
  "payload": { "content": "...", "client_msg_id": "..." },
  "created_at": "2025-03-08T12:00:00.000Z",
  "user_id": "optional",
  "tenant_id": "optional"
}
```

## REST API

### POST /agents/register

Body:

```json
{ "name": "mac-mini-1", "platform": "macOS", "meta": {}, "user_id": "...", "tenant_id": "..." }
```

Response:

```json
{ "agent_id": "uuid", "ws_url": "ws://host/realtime" }
```

Idempotency: `name` is unique; same `name` returns the existing `agent_id`.

### GET /agents

Response:

```json
{ "agents": [{ "id": "uuid", "name": "mac-mini-1", "status": "online", "last_seen_at": "..." }] }
```

### POST /messages

Body:

```json
{ "agent_id": "uuid", "content": "Hello", "client_msg_id": "ios-123", "user_id": "...", "tenant_id": "..." }
```

Response:

```json
{ "event_id": "uuid", "seq": 100 }
```

### GET /messages

Query: `agent_id=<uuid>&since_seq=<number>&limit=<1..200>`

Response:

```json
{ "events": [ ...message_in/message_out events... ] }
```

## WebSocket /realtime

Connect:

```
ws(s)://host/realtime?agent_id=<uuid>&role=pc|ios
```

Server -> client:

```json
{ "type": "hello", "agent_id": "uuid", "last_seq": 12, "server_time": "..." }
{ "type": "events", "events": [ ... ] }
{ "type": "event", "event": { ... } }
```

Client -> server:

```json
{ "type": "subscribe", "since_seq": 12 }
{ "type": "event", "event": { "type": "message_out", "sender": "pc", "payload": { "content": "..." } } }
{ "type": "heartbeat" }
```

Optional command (server -> PC):

```json
{ "type": "command", "cmd": "restart" }
```

## Sequence (text)

### iOS -> Codex round trip

```
iOS            Backend            PC Companion            Codex
 |  POST /messages  |                    |                   |
 |----------------->|  event(message_in) |                   |
 |                  |------------------->| write stdin       |
 |                  |                    |------"..."------->|
 |                  |                    |<-----stdout-------|
 |                  |<-------------------| event(message_out) |
 |<-----------------| broadcast event    |                   |
```

### Reconnect with since_seq

```
Client          Backend
  | WS connect     |
  |--------------->|
  |<-- hello -------|
  | subscribe(seq)  |
  |--------------->|
  |<-- events -------|
```

## iOS Usage Notes

- Select agent: `GET /agents`
- Open WS: `/realtime?agent_id=...&role=ios`, then send `subscribe` with `since_seq`
- Send message: `POST /messages`
- Reconnect: `GET /messages?agent_id=...&since_seq=...`
