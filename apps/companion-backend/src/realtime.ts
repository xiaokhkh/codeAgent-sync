import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { getAgent, getLastSeq, insertEvent, listEvents, setAgentStatus, touchAgent } from "./store.js";
import type { EventRecord, RealtimeClientRole } from "./types.js";

const OFFLINE_GRACE_MS = 30_000;
const OFFLINE_SWEEP_MS = 5_000;

type ClientInfo = {
  ws: WebSocket;
  agentId: string;
  role: RealtimeClientRole;
};

type AgentState = {
  lastHeartbeat: number;
  pcConnections: Set<WebSocket>;
};

const clientsByAgent = new Map<string, Set<ClientInfo>>();
const agentStates = new Map<string, AgentState>();

function getState(agentId: string): AgentState {
  let state = agentStates.get(agentId);
  if (!state) {
    state = { lastHeartbeat: Date.now(), pcConnections: new Set() };
    agentStates.set(agentId, state);
  }
  return state;
}

function parseBearer(authHeader: string | undefined | null): string | null {
  if (!authHeader) {
    return null;
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function toJson(data: unknown): string {
  return JSON.stringify(data);
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(toJson(payload));
}

function broadcast(agentId: string, payload: unknown): void {
  const clients = clientsByAgent.get(agentId);
  if (!clients) {
    return;
  }
  for (const client of clients) {
    send(client.ws, payload);
  }
}

export function publishEvent(event: EventRecord): void {
  broadcast(event.agent_id, { type: "event", event });
}

async function emitAgentStatus(agentId: string, status: "online" | "offline" | "heartbeat"): Promise<void> {
  const event = await insertEvent({
    agent_id: agentId,
    type: "agent_status",
    sender: "system",
    payload: { status }
  });
  broadcast(agentId, { type: "event", event });
}

async function markOnline(agentId: string): Promise<void> {
  const changed = await setAgentStatus(agentId, "online");
  await touchAgent(agentId);
  if (changed) {
    await emitAgentStatus(agentId, "online");
  }
}

async function markOffline(agentId: string): Promise<void> {
  const changed = await setAgentStatus(agentId, "offline");
  if (changed) {
    await emitAgentStatus(agentId, "offline");
  }
}

function safeJsonParse(message: string): unknown | null {
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}

async function handleSubscribe(agentId: string, ws: WebSocket, sinceSeq: number | undefined): Promise<void> {
  const events = await listEvents({
    agent_id: agentId,
    since_seq: sinceSeq ?? 0,
    limit: 200
  });
  send(ws, { type: "events", events });
}

async function handleIncomingEvent(agentId: string, message: unknown): Promise<void> {
  if (!message || typeof message !== "object") {
    return;
  }
  const event = (message as { event?: EventRecord }).event;
  if (!event || typeof event !== "object") {
    return;
  }
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const stored = await insertEvent({
    agent_id: agentId,
    type: event.type ?? "message_out",
    sender: event.sender ?? "pc",
    payload,
    user_id: event.user_id ?? null,
    tenant_id: event.tenant_id ?? null
  });
  broadcast(agentId, { type: "event", event: stored });
}

async function handleHeartbeat(agentId: string): Promise<void> {
  const state = getState(agentId);
  state.lastHeartbeat = Date.now();
  await markOnline(agentId);
  await emitAgentStatus(agentId, "heartbeat");
}

async function handleConnection(ws: WebSocket, agentId: string, role: RealtimeClientRole): Promise<void> {
  const agent = await getAgent(agentId);
  if (!agent) {
    send(ws, { type: "error", message: "Unknown agent_id." });
    ws.close();
    return;
  }

  const clientInfo: ClientInfo = { ws, agentId, role };
  const clients = clientsByAgent.get(agentId) ?? new Set<ClientInfo>();
  clients.add(clientInfo);
  clientsByAgent.set(agentId, clients);

  const state = getState(agentId);
  if (role === "pc") {
    state.pcConnections.add(ws);
    state.lastHeartbeat = Date.now();
    await markOnline(agentId);
  }

  const lastSeq = await getLastSeq(agentId);
  send(ws, {
    type: "hello",
    agent_id: agentId,
    last_seq: lastSeq,
    server_time: new Date().toISOString()
  });

  ws.on("message", async (raw) => {
    const message = typeof raw === "string" ? raw : raw.toString();
    const data = safeJsonParse(message);
    if (!data || typeof data !== "object") {
      send(ws, { type: "error", message: "Invalid JSON." });
      return;
    }
    const { type } = data as { type?: string };
    if (type === "subscribe") {
      const sinceSeq = (data as { since_seq?: number }).since_seq;
      await handleSubscribe(agentId, ws, sinceSeq);
      return;
    }
    if (type === "event") {
      await handleIncomingEvent(agentId, data);
      return;
    }
    if (type === "heartbeat") {
      await handleHeartbeat(agentId);
      return;
    }
    send(ws, { type: "error", message: `Unknown message type: ${type ?? "unknown"}.` });
  });

  ws.on("close", () => {
    const set = clientsByAgent.get(agentId);
    if (set) {
      for (const client of set) {
        if (client.ws === ws) {
          set.delete(client);
          break;
        }
      }
      if (set.size === 0) {
        clientsByAgent.delete(agentId);
      }
    }

    if (role === "pc") {
      const state = getState(agentId);
      state.pcConnections.delete(ws);
    }
  });
}

function startOfflineSweep(): void {
  const sweep = async () => {
    const now = Date.now();
    for (const [agentId, state] of agentStates.entries()) {
      if (state.pcConnections.size === 0) {
        if (now - state.lastHeartbeat > OFFLINE_GRACE_MS) {
          await markOffline(agentId);
        }
        continue;
      }
      if (now - state.lastHeartbeat > OFFLINE_GRACE_MS) {
        for (const ws of state.pcConnections) {
          ws.terminate();
        }
        state.pcConnections.clear();
        await markOffline(agentId);
      }
    }
  };

  setInterval(() => {
    void sweep().catch((err) => {
      console.error(\"offline sweep failed\", err);
    });
  }, OFFLINE_SWEEP_MS).unref();
}

export function initRealtime(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/realtime") {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token") ?? parseBearer(req.headers.authorization);
    if (config.authToken && token !== config.authToken) {
      socket.destroy();
      return;
    }

    const agentId = url.searchParams.get("agent_id");
    const role = url.searchParams.get("role");
    if (!agentId || (role !== "pc" && role !== "ios")) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(ws, agentId, role);
    });
  });

  startOfflineSweep();
}
