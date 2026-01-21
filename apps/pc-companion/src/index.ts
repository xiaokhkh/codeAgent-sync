#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import WebSocket from "ws";
import * as pty from "node-pty";

type Config = {
  backend: string;
  agentName: string;
  codexCmd: string;
  token?: string;
};

type EventRecord = {
  id?: string;
  agent_id?: string;
  seq?: number;
  type?: string;
  sender?: string;
  payload?: Record<string, unknown>;
};

const OUTPUT_FLUSH_MS = 800;
const OUTPUT_CHUNK_SIZE = 4000;
const HEARTBEAT_MS = 15_000;

const stateDir = path.join(os.homedir(), ".companion");

function printUsage(): void {
  console.log(`sync-agent [--backend <url>] [--agent-name <name>] [--codex-cmd <cmd>] [--token <token>]

Options:
  --backend       Backend base URL (default: http://localhost:8787)
  --agent-name    Agent name to register/use (default: resume/session id or hostname)
  --codex-cmd     Codex command (default: codex)
  --token         Bearer token for backend

Environment defaults:
  COMPANION_BACKEND
  COMPANION_AGENT_NAME
  COMPANION_CODEX_CMD
  COMPANION_TOKEN
`);
}

function deriveAgentNameFromArgs(args: string[]): string | null {
  const flags = new Map<string, string>([
    ["--resume", "resume"],
    ["-r", "resume"],
    ["--resume-id", "resume"],
    ["--session", "session"],
    ["--session-id", "session"]
  ]);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const inlineMatch = arg.match(/^(--resume|--resume-id|--session|--session-id)=(.+)$/);
    if (inlineMatch?.[2]) {
      return inlineMatch[2];
    }
    if (!flags.has(arg)) {
      continue;
    }
    const value = args[i + 1];
    if (value && !value.startsWith("-")) {
      return value;
    }
  }
  return null;
}

function splitCommand(input: string): { cmd: string; args: string[] } {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === " " || char === "\t") {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    parts.push(current);
  }
  const cmd = parts.shift();
  if (!cmd) {
    throw new Error("codex command is required");
  }
  return { cmd, args: parts };
}

function parseConfig(): Config {
  const { values } = parseArgs({
    options: {
      backend: { type: "string" },
      "agent-name": { type: "string" },
      "codex-cmd": { type: "string", default: "codex" },
      token: { type: "string" },
      help: { type: "boolean" }
    }
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const backend = values.backend ?? process.env.COMPANION_BACKEND ?? "http://localhost:8787";
  const codexCmd = values["codex-cmd"] ?? process.env.COMPANION_CODEX_CMD ?? "codex";
  const { args } = splitCommand(codexCmd);
  const inferredAgent =
    values["agent-name"] ??
    process.env.COMPANION_AGENT_NAME ??
    deriveAgentNameFromArgs(args) ??
    os.hostname();

  return {
    backend,
    agentName: inferredAgent,
    codexCmd,
    token: values.token ?? process.env.COMPANION_TOKEN
  };
}

async function registerAgent(config: Config): Promise<{ agentId: string; wsUrl: string }> {
  const url = new URL("/agents/register", config.backend).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
    },
    body: JSON.stringify({ name: config.agentName, platform: os.platform() })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`register failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { agent_id?: string; ws_url?: string };
  if (!data.agent_id || !data.ws_url) {
    throw new Error("register response missing agent_id/ws_url");
  }
  return { agentId: data.agent_id, wsUrl: data.ws_url };
}

async function loadLastSeq(agentId: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(stateDir, `${agentId}.json`), "utf8");
    const json = JSON.parse(raw) as { last_seq?: number };
    return typeof json.last_seq === "number" ? json.last_seq : 0;
  } catch {
    return 0;
  }
}

async function saveLastSeq(agentId: string, seq: number): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const target = path.join(stateDir, `${agentId}.json`);
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ last_seq: seq }), "utf8");
  await fs.rename(temp, target);
}

async function main(): Promise<void> {
  const config = parseConfig();
  const { cmd, args } = splitCommand(config.codexCmd);

  const { agentId, wsUrl } = await registerAgent(config);
  let lastSeq = await loadLastSeq(agentId);
  let saveTimer: NodeJS.Timeout | null = null;

  const scheduleSave = () => {
    if (saveTimer) {
      return;
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveLastSeq(agentId, lastSeq).catch((err) => {
        console.error("failed to save state", err);
      });
    }, 1000);
  };

  let currentPty: pty.IPty | null = null;
  let buffer = "";
  let flushTimer: NodeJS.Timeout | null = null;
  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;
  let shuttingDown = false;

  const spawnCodex = () => {
    if (currentPty) {
      return;
    }
    try {
      currentPty = pty.spawn(cmd, args, {
        cols: process.stdout.columns ?? 120,
        rows: process.stdout.rows ?? 30,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
        name: "xterm-color"
      });
    } catch (err) {
      console.error("failed to spawn codex", err);
      process.exit(1);
    }

    currentPty.onData((data) => {
      buffer += data;
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushOutput();
      }, OUTPUT_FLUSH_MS);
    });

    currentPty.onExit((event) => {
      console.error(`codex exited (code=${event.exitCode}, signal=${event.signal})`);
      currentPty = null;
    });
  };

  const flushOutput = () => {
    if (!buffer) {
      return;
    }
    const payload = buffer;
    buffer = "";
    for (let i = 0; i < payload.length; i += OUTPUT_CHUNK_SIZE) {
      const chunk = payload.slice(i, i + OUTPUT_CHUNK_SIZE);
      sendEvent({
        type: "message_out",
        sender: "pc",
        payload: { content: chunk }
      });
    }
  };

  const sendEvent = (event: { type: string; sender: string; payload: Record<string, unknown> }) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ type: "event", event }));
  };

  const handleEvent = (event: EventRecord) => {
    if (typeof event.seq === "number" && event.seq > lastSeq) {
      lastSeq = event.seq;
      scheduleSave();
    }
    if (event.type === "message_in") {
      const content = event.payload?.content;
      if (typeof content === "string") {
        const line = content.endsWith("\n") ? content : `${content}\n`;
        currentPty?.write(line);
      }
    }
  };

  const connectRealtime = () => {
    const realtimeUrl = new URL(wsUrl);
    realtimeUrl.searchParams.set("agent_id", agentId);
    realtimeUrl.searchParams.set("role", "pc");
    if (config.token) {
      realtimeUrl.searchParams.set("token", config.token);
    }

    ws = new WebSocket(realtimeUrl.toString(), {
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : undefined
    });

    ws.on("open", () => {
      reconnectDelay = 1000;
      ws?.send(JSON.stringify({ type: "subscribe", since_seq: lastSeq }));
    });

    ws.on("message", (raw) => {
      const message = typeof raw === "string" ? raw : raw.toString();
      let data: unknown;
      try {
        data = JSON.parse(message);
      } catch {
        return;
      }

      if (!data || typeof data !== "object") {
        return;
      }

      const payload = data as {
        type?: string;
        event?: EventRecord;
        events?: EventRecord[];
        cmd?: string;
      };

      if (payload.type === "event" && payload.event) {
        handleEvent(payload.event);
        return;
      }

      if (payload.type === "events" && Array.isArray(payload.events)) {
        for (const event of payload.events) {
          handleEvent(event);
        }
        return;
      }

      if (payload.type === "command" && payload.cmd === "restart") {
        restartCodex();
      }
    });

    ws.on("close", () => {
      if (shuttingDown) {
        return;
      }
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("ws error", err);
    });
  };

  const scheduleReconnect = () => {
    if (shuttingDown) {
      return;
    }
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    setTimeout(() => {
      connectRealtime();
    }, delay);
  };

  const heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "heartbeat" }));
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();

  const restartCodex = () => {
    if (currentPty) {
      currentPty.kill();
      currentPty = null;
    }
    spawnCodex();
  };

  const shutdown = () => {
    shuttingDown = true;
    flushOutput();
    ws?.close();
    if (currentPty) {
      currentPty.kill();
      currentPty = null;
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  spawnCodex();
  connectRealtime();
}

main().catch((err) => {
  console.error("companion failed", err);
  process.exit(1);
});
