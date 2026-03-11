import path from "node:path";
import process from "node:process";
import express from "express";
import { fileURLToPath } from "node:url";
import { CodexAppClient } from "./codex-app-client.js";
import { SessionStore, mapItem, type Thread, type ThreadItem } from "./session-store.js";
import type { SessionDetail } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const clientDist = path.join(rootDir, "dist");

const app = express();
app.use(express.json());

const codex = new CodexAppClient({ cwd: rootDir });
const store = new SessionStore();
const sseClients = new Set<express.Response>();

type ThreadResponse = { thread: Thread };

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

async function listThreads() {
  const response = await codex.request<{ data: ThreadResponse["thread"][] }>("thread/list", {
    cwd: rootDir,
    limit: 50,
    sourceKinds: []
  });

  return store.setSummaries(response.data as Thread[]);
}

async function threadLoaded(threadId: string) {
  const response = await codex.request<{ data: string[] }>("thread/loaded/list", {});
  return response.data.includes(threadId);
}

async function loadThread(threadId: string) {
  const loaded = await threadLoaded(threadId);
  let response: ThreadResponse;

  if (loaded) {
    try {
      response = await codex.request<ThreadResponse>("thread/read", { threadId, includeTurns: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("not materialized yet")) {
        throw error;
      }

      response = await codex.request<ThreadResponse>("thread/resume", {
        threadId,
        cwd: rootDir,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        persistExtendedHistory: true
      });
    }
  } else {
    response = await codex.request<ThreadResponse>("thread/resume", {
      threadId,
      cwd: rootDir,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      persistExtendedHistory: true
    });
  }

  return store.setThread(response.thread as Thread);
}

async function createThread(name?: string | null) {
  const response = await codex.request<ThreadResponse & { model: string }>("thread/start", {
    cwd: rootDir,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    persistExtendedHistory: true,
    experimentalRawEvents: false
  });

  if (name) {
    await codex.request("thread/name/set", { threadId: response.thread.id, name });
    response.thread.name = name;
  }

  return store.setThread(response.thread as Thread);
}

function detailFromStore(threadId: string): SessionDetail | null {
  return store.getDetail(threadId);
}

codex.on("notification", async (message: { method: string; params?: Record<string, unknown> }) => {
  const params = message.params ?? {};
  const threadId = typeof params.threadId === "string" ? params.threadId : null;

  if (message.method === "thread/started") {
    await listThreads();
    broadcast("sessions", store.getSummaries());
    return;
  }

  if (message.method === "thread/name/updated" && threadId) {
    const name = typeof params.threadName === "string" ? params.threadName : null;
    store.updateSummary(threadId, { name });
    broadcast("sessions", store.getSummaries());
    return;
  }

  if (message.method === "thread/status/changed" && threadId) {
    const status = params.status as { type: "notLoaded" | "idle" | "systemError" | "active"; activeFlags?: string[] };
    store.updateSummary(threadId, { status: status.type });
    if (status.type === "active") {
      store.applyStatus(threadId, {
        tone: status.activeFlags?.length ? "waiting" : "running",
        label: status.activeFlags?.length ? "Waiting" : "Active",
        detail: status.activeFlags?.join(", ") || "Working on the current turn."
      });
    }
    broadcast("sessions", store.getSummaries());
    if (detailFromStore(threadId)) {
      broadcast("thread", detailFromStore(threadId));
    }
    return;
  }

  if (message.method === "turn/started" && threadId) {
    const turn = params.turn as { id: string };
    store.applyStatus(threadId, {
      tone: "running",
      label: "Thinking",
      detail: "The agent is processing your latest message."
    });
    const detail = detailFromStore(threadId);
    if (detail) {
      detail.currentTurnId = turn.id;
      broadcast("thread", detail);
    }
    return;
  }

  if (message.method === "item/started" && threadId) {
    const item = params.item as ThreadItem;
    const turnId = typeof params.turnId === "string" ? params.turnId : null;
    const next = store.appendMessage(threadId, mapItem(item), turnId);

    if (item.type === "agentMessage") {
      store.applyStatus(threadId, {
        tone: "running",
        label: "Writing reply",
        detail: "Streaming the assistant response."
      });
    } else if (item.type === "commandExecution") {
      store.applyStatus(threadId, {
        tone: "running",
        label: "Running command",
        detail: item.command
      });
    } else {
      store.applyStatus(threadId, {
        tone: "running",
        label: "Working",
        detail: `Current item: ${item.type}`
      });
    }

    if (next) {
      broadcast("thread", next);
    }
    return;
  }

  if (message.method === "item/agentMessage/delta" && threadId) {
    const itemId = typeof params.itemId === "string" ? params.itemId : "";
    const delta = typeof params.delta === "string" ? params.delta : "";
    const next = store.appendDelta(threadId, itemId, delta);
    store.applyStatus(threadId, {
      tone: "running",
      label: "Writing reply",
      detail: "Streaming the assistant response."
    });
    if (next) {
      broadcast("thread", next);
    }
    return;
  }

  if (message.method === "item/commandExecution/outputDelta" && threadId) {
    const itemId = typeof params.itemId === "string" ? params.itemId : "";
    const delta = typeof params.delta === "string" ? params.delta : "";
    const next = store.appendDelta(threadId, itemId, delta);
    if (next) {
      broadcast("thread", next);
    }
    return;
  }

  if (message.method === "item/completed" && threadId) {
    const item = params.item as ThreadItem;
    const next = store.appendMessage(threadId, mapItem(item));
    if (next) {
      broadcast("thread", next);
    }
    return;
  }

  if (message.method === "turn/completed" && threadId) {
    const turn = params.turn as { status: string; error?: { message?: string | null } | null };
    store.clearTurn(threadId);

    if (turn.status === "completed") {
      store.applyStatus(threadId, {
        tone: "done",
        label: "Completed",
        detail: "The agent finished this turn."
      });
    } else if (turn.status === "interrupted") {
      store.applyStatus(threadId, {
        tone: "waiting",
        label: "Stopped",
        detail: "The current turn was interrupted."
      });
    } else if (turn.status === "failed") {
      store.applyStatus(threadId, {
        tone: "error",
        label: "Failed",
        detail: turn.error?.message ?? "The turn failed."
      });
    }

    await listThreads();
    const detail = detailFromStore(threadId);
    if (detail) {
      broadcast("thread", detail);
    }
    broadcast("sessions", store.getSummaries());
    return;
  }

  if (message.method === "error" && threadId) {
    const error = params.error as { message?: string };
    const detail = store.applyStatus(threadId, {
      tone: "error",
      label: "Error",
      detail: error.message ?? "A runtime error occurred."
    });

    if (detail) {
      broadcast("thread", detail);
    }
  }
});

app.get("/api/bootstrap", async (request, response) => {
  const threadId = typeof request.query.threadId === "string" ? request.query.threadId : null;
  const sessions = await listThreads();

  let selectedThread: SessionDetail | null = null;
  if (threadId) {
    try {
      selectedThread = await loadThread(threadId);
    } catch {
      selectedThread = null;
    }
  }

  if (!selectedThread && sessions[0]) {
    try {
      selectedThread = await loadThread(sessions[0].id);
    } catch {
      selectedThread = null;
    }
  }

  response.json({
    sessions: store.getSummaries(),
    selectedThread
  });
});

app.get("/api/sessions", async (_request, response) => {
  const sessions = await listThreads();
  response.json({ sessions });
});

app.get("/api/sessions/:threadId", async (request, response) => {
  const detail = await loadThread(request.params.threadId);
  response.json({ thread: detail });
});

app.post("/api/sessions", async (request, response) => {
  const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
  const detail = await createThread(name || null);
  await listThreads();
  broadcast("sessions", store.getSummaries());
  broadcast("thread", detail);
  response.status(201).json({ thread: detail });
});

app.post("/api/sessions/:threadId/messages", async (request, response) => {
  const threadId = request.params.threadId;
  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";

  if (!text) {
    response.status(400).json({ error: "Message text is required." });
    return;
  }

  const existing = detailFromStore(threadId);
  if (!existing) {
    await loadThread(threadId);
  }

  await codex.request("turn/start", {
    threadId,
    input: [{ type: "text", text, text_elements: [] }]
  });

  const current = detailFromStore(threadId);
  if (current) {
    current.messages.push({
      id: `pending-user-${Date.now()}`,
      kind: "user",
      role: "user",
      title: "You",
      text,
      status: "sent"
    });
    current.liveStatus = {
      tone: "running",
      label: "Queued",
      detail: "Message sent to Codex.",
      updatedAt: Date.now()
    };
    broadcast("thread", current);
  }

  response.status(202).json({ ok: true });
});

app.post("/api/sessions/:threadId/stop", async (request, response) => {
  const threadId = request.params.threadId;
  const detail = await loadThread(threadId);

  if (!detail.currentTurnId) {
    response.status(409).json({ error: "No running turn for this session." });
    return;
  }

  await codex.request("turn/interrupt", {
    threadId,
    turnId: detail.currentTurnId
  });

  store.applyStatus(threadId, {
    tone: "waiting",
    label: "Stopping",
    detail: "Interrupt requested."
  });

  const next = detailFromStore(threadId);
  if (next) {
    broadcast("thread", next);
  }

  response.json({ ok: true });
});

app.post("/api/sessions/:threadId/clear", async (request, response) => {
  const threadId = request.params.threadId;
  const detail = await loadThread(threadId);
  const turns = Math.ceil(detail.messages.length / 2);

  const fresh = await codex.request<ThreadResponse>("thread/read", { threadId, includeTurns: true });
  const totalTurns = fresh.thread.turns.length;

  if (!totalTurns) {
    response.json({ thread: detail });
    return;
  }

  await codex.request("thread/rollback", {
    threadId,
    numTurns: totalTurns
  });

  const reloaded = await loadThread(threadId);
  broadcast("thread", reloaded);
  response.json({ thread: reloaded, removedTurns: turns });
});

app.get("/events", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();

  sseClients.add(response);
  response.write(`event: ready\ndata: {"ok":true}\n\n`);

  request.on("close", () => {
    sseClients.delete(response);
  });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDist));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(clientDist, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 3001);

async function start() {
  await codex.start();
  await listThreads();

  app.listen(port, () => {
    console.log(`Codex UI server listening on http://127.0.0.1:${port}`);
  });
}

void start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void codex.stop().finally(() => process.exit(0));
  });
}
