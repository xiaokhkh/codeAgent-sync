import { pool } from "./db.js";
import type { AgentRow, EventRecord, RegisterAgentInput } from "./types.js";

function toIso(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function parseSeq(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function mapAgentRow(row: {
  id: string;
  name: string;
  status: string;
  last_seen_at: Date | string | null;
}): AgentRow {
  return {
    id: row.id,
    name: row.name,
    status: row.status as AgentRow["status"],
    last_seen_at: toIso(row.last_seen_at)
  };
}

function mapEventRow(row: {
  id: string;
  agent_id: string;
  seq: string | number;
  type: string;
  sender: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
  user_id: string | null;
  tenant_id: string | null;
}): EventRecord {
  return {
    id: row.id,
    agent_id: row.agent_id,
    seq: parseSeq(row.seq),
    type: row.type,
    sender: row.sender,
    payload: row.payload,
    created_at: toIso(row.created_at) ?? new Date().toISOString(),
    user_id: row.user_id,
    tenant_id: row.tenant_id
  };
}

export async function registerAgent(input: RegisterAgentInput): Promise<{ id: string }> {
  const result = await pool.query(
    `INSERT INTO agents (name, platform, meta, user_id, tenant_id, status, last_seen_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'offline', NOW(), NOW(), NOW())
     ON CONFLICT (name) DO UPDATE
     SET platform = COALESCE(EXCLUDED.platform, agents.platform),
         meta = COALESCE(EXCLUDED.meta, agents.meta),
         user_id = COALESCE(EXCLUDED.user_id, agents.user_id),
         tenant_id = COALESCE(EXCLUDED.tenant_id, agents.tenant_id),
         updated_at = NOW()
     RETURNING id;`,
    [input.name, input.platform ?? null, input.meta ?? null, input.user_id ?? null, input.tenant_id ?? null]
  );
  const id = result.rows[0]?.id as string | undefined;
  if (!id) {
    throw new Error("Failed to register agent.");
  }
  return { id };
}

export async function getAgent(agentId: string): Promise<AgentRow | null> {
  const result = await pool.query(
    "SELECT id, name, status, last_seen_at FROM agents WHERE id = $1",
    [agentId]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return mapAgentRow(row);
}

export async function listAgents(): Promise<AgentRow[]> {
  const result = await pool.query(
    "SELECT id, name, status, last_seen_at FROM agents ORDER BY last_seen_at DESC NULLS LAST, created_at DESC"
  );
  return result.rows.map(mapAgentRow);
}

export async function touchAgent(agentId: string): Promise<void> {
  await pool.query(
    "UPDATE agents SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1",
    [agentId]
  );
}

export async function setAgentStatus(agentId: string, status: "online" | "offline"): Promise<boolean> {
  const result = await pool.query(
    "UPDATE agents SET status = $2, updated_at = NOW() WHERE id = $1 AND status <> $2 RETURNING id",
    [agentId, status]
  );
  return result.rowCount > 0;
}

export async function insertEvent(params: {
  agent_id: string;
  type: string;
  sender: string;
  payload: Record<string, unknown>;
  user_id?: string | null;
  tenant_id?: string | null;
}): Promise<EventRecord> {
  const result = await pool.query(
    `INSERT INTO events (agent_id, type, sender, payload, user_id, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, agent_id, seq, type, sender, payload, created_at, user_id, tenant_id;`,
    [
      params.agent_id,
      params.type,
      params.sender,
      params.payload,
      params.user_id ?? null,
      params.tenant_id ?? null
    ]
  );
  return mapEventRow(result.rows[0]);
}

export async function listEvents(params: {
  agent_id: string;
  since_seq: number;
  limit: number;
  types?: string[];
}): Promise<EventRecord[]> {
  const values: Array<string | number | string[]> = [params.agent_id, params.since_seq, params.limit];
  let typeFilter = "";
  if (params.types && params.types.length > 0) {
    values.push(params.types);
    typeFilter = "AND type = ANY($4)";
  }

  const result = await pool.query(
    `SELECT id, agent_id, seq, type, sender, payload, created_at, user_id, tenant_id
     FROM events
     WHERE agent_id = $1 AND seq > $2 ${typeFilter}
     ORDER BY seq ASC
     LIMIT $3`,
    values
  );
  return result.rows.map(mapEventRow);
}

export async function getLastSeq(agentId: string): Promise<number> {
  const result = await pool.query(
    "SELECT COALESCE(MAX(seq), 0) AS last_seq FROM events WHERE agent_id = $1",
    [agentId]
  );
  const value = result.rows[0]?.last_seq ?? 0;
  return parseSeq(value);
}
