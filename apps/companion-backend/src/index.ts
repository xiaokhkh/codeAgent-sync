import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildWsUrl, config } from "./config.js";
import { publishEvent, initRealtime } from "./realtime.js";
import { insertEvent, listAgents, listEvents, registerAgent } from "./store.js";

const app = new Hono();

app.use("*", cors());
app.use("*", async (c, next) => {
  if (!config.authToken) {
    return next();
  }
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${config.authToken}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

app.get("/health", (c) => c.json({ ok: true }));

app.post("/agents/register", async (c) => {
  try {
    const body = await c.req.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }

    const agent = await registerAgent({
      name,
      platform: typeof body?.platform === "string" ? body.platform : undefined,
      meta: typeof body?.meta === "object" ? body.meta : undefined,
      user_id: typeof body?.user_id === "string" ? body.user_id : undefined,
      tenant_id: typeof body?.tenant_id === "string" ? body.tenant_id : undefined
    });

    return c.json({
      agent_id: agent.id,
      ws_url: buildWsUrl()
    });
  } catch (err) {
    console.error("register agent failed", err);
    return c.json({ error: "failed to register agent" }, 500);
  }
});

app.get("/agents", async (c) => {
  try {
    const agents = await listAgents();
    return c.json({ agents });
  } catch (err) {
    console.error("list agents failed", err);
    return c.json({ error: "failed to list agents" }, 500);
  }
});

app.post("/messages", async (c) => {
  try {
    const body = await c.req.json();
    const agentId = typeof body?.agent_id === "string" ? body.agent_id : "";
    const content = typeof body?.content === "string" ? body.content : "";
    if (!agentId || !content) {
      return c.json({ error: "agent_id and content are required" }, 400);
    }

    const event = await insertEvent({
      agent_id: agentId,
      type: "message_in",
      sender: "ios",
      payload: {
        content,
        client_msg_id: typeof body?.client_msg_id === "string" ? body.client_msg_id : undefined
      },
      user_id: typeof body?.user_id === "string" ? body.user_id : undefined,
      tenant_id: typeof body?.tenant_id === "string" ? body.tenant_id : undefined
    });

    publishEvent(event);

    return c.json({ event_id: event.id, seq: event.seq });
  } catch (err) {
    console.error("post message failed", err);
    return c.json({ error: "failed to post message" }, 500);
  }
});

app.get("/messages", async (c) => {
  try {
    const agentId = c.req.query("agent_id");
    if (!agentId) {
      return c.json({ error: "agent_id is required" }, 400);
    }
    const since = Number(c.req.query("since_seq") ?? 0);
    const limitRaw = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 200)
      : 50;

    const events = await listEvents({
      agent_id: agentId,
      since_seq: Number.isFinite(since) ? since : 0,
      limit,
      types: ["message_in", "message_out"]
    });

    return c.json({ events });
  } catch (err) {
    console.error("get messages failed", err);
    return c.json({ error: "failed to fetch messages" }, 500);
  }
});

const server = serve({
  fetch: app.fetch,
  port: config.port
});

initRealtime(server);

console.log(`Companion backend listening on :${config.port}`);
