-- migrate:up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  platform text,
  meta jsonb,
  user_id text,
  tenant_id text,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX agents_name_unique ON agents (name);
CREATE INDEX agents_status_idx ON agents (status);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  seq bigserial NOT NULL,
  type text NOT NULL,
  sender text NOT NULL,
  payload jsonb NOT NULL,
  user_id text,
  tenant_id text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX events_agent_seq_unique ON events (agent_id, seq);
CREATE INDEX events_agent_seq_idx ON events (agent_id, seq DESC);

-- migrate:down
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS agents;
DROP EXTENSION IF EXISTS pgcrypto;
