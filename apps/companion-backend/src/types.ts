export type AgentStatus = "online" | "offline";
export type EventType = "message_in" | "message_out" | "agent_status";
export type EventSender = "ios" | "pc" | "system";

export type AgentRow = {
  id: string;
  name: string;
  platform: string | null;
  status: AgentStatus;
  last_seen_at: string | null;
};

export type EventRecord = {
  id: string;
  agent_id: string;
  seq: number;
  type: EventType | string;
  sender: EventSender | string;
  payload: Record<string, unknown>;
  created_at: string;
  user_id: string | null;
  tenant_id: string | null;
};

export type RegisterAgentInput = {
  name: string;
  platform?: string;
  meta?: Record<string, unknown> | null;
  user_id?: string;
  tenant_id?: string;
};

export type MessageInput = {
  agent_id: string;
  content: string;
  client_msg_id?: string;
  user_id?: string;
  tenant_id?: string;
};

export type RealtimeClientRole = "pc" | "ios";
