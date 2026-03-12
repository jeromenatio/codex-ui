import type { LiveStatus, MessageAttachment, SessionDetail, SessionSummary, ThreadStatusType, UiMessage } from "./types.js";

export type ThreadItem =
  | { type: "userMessage"; id: string; content: Array<{ type: "text"; text: string }> }
  | { type: "agentMessage"; id: string; text: string; phase?: "commentary" | "final_answer" | null }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: string;
      aggregatedOutput?: string | null;
      exitCode?: number | null;
      durationMs?: number | null;
    }
  | { type: "fileChange"; id: string; status: string; changes?: Array<{ path?: string; changeType?: string }> }
  | { type: "mcpToolCall" | "dynamicToolCall" | "collabAgentToolCall" | "webSearch" | "imageView" | "imageGeneration" | "enteredReviewMode" | "exitedReviewMode" | "contextCompaction"; id: string; [key: string]: unknown };

export type Turn = {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  items: ThreadItem[];
  error?: { message?: string | null } | null;
};

export type Thread = {
  id: string;
  name: string | null;
  preview: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  model?: string | null;
  status: { type: ThreadStatusType; activeFlags?: string[] };
  turns: Turn[];
};

function createLiveStatus(overrides?: Partial<LiveStatus>): LiveStatus {
  return {
    tone: "idle",
    label: "Idle",
    detail: "Ready for a new prompt.",
    updatedAt: Date.now(),
    ...overrides
  };
}

function joinUserText(item: Extract<ThreadItem, { type: "userMessage" }>) {
  return item.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

function mapItem(item: ThreadItem): UiMessage {
  if (item.type === "userMessage") {
    return {
      id: item.id,
      kind: "user",
      role: "user",
      title: "You",
      text: joinUserText(item),
      status: "sent"
    };
  }

  if (item.type === "agentMessage") {
    return {
      id: item.id,
      kind: "assistant",
      role: "assistant",
      title: item.phase === "commentary" ? "Agent commentary" : "Codex",
      text: item.text,
      phase: item.phase ?? null,
      status: "streaming"
    };
  }

  if (item.type === "plan") {
    return {
      id: item.id,
      kind: "plan",
      role: "system",
      title: "Plan",
      text: item.text
    };
  }

  if (item.type === "reasoning") {
    return {
      id: item.id,
      kind: "reasoning",
      role: "system",
      title: "Reasoning",
      text: [...item.summary, ...item.content].filter(Boolean).join("\n")
    };
  }

  if (item.type === "commandExecution") {
    const meta = [
      item.cwd ? `cwd: ${item.cwd}` : "",
      item.exitCode !== null && item.exitCode !== undefined ? `exit: ${item.exitCode}` : "",
      item.durationMs ? `${item.durationMs}ms` : ""
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      id: item.id,
      kind: "command",
      role: "system",
      title: "Command",
      text: `${item.command}${meta ? `\n${meta}` : ""}${item.aggregatedOutput ? `\n\n${item.aggregatedOutput}` : ""}`,
      status: item.status
    };
  }

  if (item.type === "fileChange") {
    const changeText = (item.changes ?? [])
      .map((change) => `${change.changeType ?? "updated"} ${change.path ?? "file"}`)
      .join("\n");

    return {
      id: item.id,
      kind: "file",
      role: "system",
      title: "File changes",
      text: changeText || "Files changed.",
      status: item.status
    };
  }

  return {
    id: item.id,
    kind: "tool",
    role: "system",
    title: "Agent activity",
    text: item.type
  };
}

function applyAttachmentMetadata(messages: UiMessage[], attachmentsByText: Array<{ text: string; attachments: MessageAttachment[] }>) {
  let attachmentIndex = 0;

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const nextEntry = attachmentsByText[attachmentIndex];
    if (!nextEntry) {
      break;
    }

    if ((message.text || "").trim() === nextEntry.text.trim()) {
      message.attachments = nextEntry.attachments;
      attachmentIndex += 1;
    }
  }
}

function inferLiveStatus(thread: Thread): LiveStatus {
  if (!thread.turns.length) {
    return createLiveStatus({
      label: "New session",
      detail: "No messages yet."
    });
  }

  const lastTurn = thread.turns[thread.turns.length - 1];
  if (lastTurn.status === "failed") {
    return createLiveStatus({
      tone: "error",
      label: "Turn failed",
      detail: lastTurn.error?.message ?? "The agent reported an error."
    });
  }

  if (lastTurn.status === "interrupted") {
    return createLiveStatus({
      tone: "waiting",
      label: "Stopped",
      detail: "The active turn was interrupted."
    });
  }

  if (lastTurn.status === "inProgress") {
    const lastItem = lastTurn.items[lastTurn.items.length - 1];
    if (lastItem?.type === "commandExecution") {
      return createLiveStatus({
        tone: "running",
        label: "Running command",
        detail: lastItem.command
      });
    }

    if (lastItem?.type === "agentMessage") {
      return createLiveStatus({
        tone: "running",
        label: "Writing reply",
        detail: "Streaming the latest assistant message."
      });
    }

    return createLiveStatus({
      tone: "running",
      label: "Thinking",
      detail: "Processing the current turn."
    });
  }

  if (thread.status.type === "active") {
    return createLiveStatus({
      tone: "waiting",
      label: "Waiting",
      detail: thread.status.activeFlags?.join(", ") || "Awaiting input."
    });
  }

  return createLiveStatus({
    tone: "done",
    label: "Synced",
    detail: "Conversation is up to date."
  });
}

export class SessionStore {
  private details = new Map<string, SessionDetail>();
  private summaries = new Map<string, SessionSummary>();

  setThread(thread: Thread, attachmentsByText: Array<{ text: string; attachments: MessageAttachment[] }> = []) {
    const summary: SessionSummary = {
      id: thread.id,
      name: thread.name,
      preview: thread.preview,
      updatedAt: thread.updatedAt,
      createdAt: thread.createdAt,
      status: thread.status.type,
      cwd: thread.cwd,
      model: thread.model ?? null
    };

    const detail: SessionDetail = {
      summary,
      messages: thread.turns.flatMap((turn) => turn.items.map(mapItem)),
      liveStatus: inferLiveStatus(thread),
      currentTurnId: [...thread.turns].reverse().find((turn) => turn.status === "inProgress")?.id ?? null
    };

    if (attachmentsByText.length) {
      applyAttachmentMetadata(detail.messages, attachmentsByText);
    }

    this.summaries.set(thread.id, summary);
    this.details.set(thread.id, detail);
    return detail;
  }

  getDetail(threadId: string) {
    return this.details.get(threadId) ?? null;
  }

  getSummaries() {
    return [...this.summaries.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  setSummaries(threads: Thread[]) {
    const nextIds = new Set(threads.map((thread) => thread.id));

    for (const existingId of this.summaries.keys()) {
      if (!nextIds.has(existingId)) {
        this.summaries.delete(existingId);
        this.details.delete(existingId);
      }
    }

    for (const thread of threads) {
      this.summaries.set(thread.id, {
        id: thread.id,
        name: thread.name,
        preview: thread.preview,
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
        status: thread.status.type,
        cwd: thread.cwd,
        model: thread.model ?? null
      });
    }

    return this.getSummaries();
  }

  applyStatus(threadId: string, liveStatus: Partial<LiveStatus>) {
    const current = this.details.get(threadId);
    if (!current) {
      return null;
    }

    current.liveStatus = createLiveStatus({
      ...current.liveStatus,
      ...liveStatus
    });

    return current;
  }

  updateSummary(threadId: string, patch: Partial<SessionSummary>) {
    const current = this.summaries.get(threadId);
    if (!current) {
      return null;
    }

    const next = { ...current, ...patch };
    this.summaries.set(threadId, next);

    const detail = this.details.get(threadId);
    if (detail) {
      detail.summary = next;
    }

    return next;
  }

  appendMessage(threadId: string, message: UiMessage, currentTurnId?: string | null) {
    const current = this.details.get(threadId);
    if (!current) {
      return null;
    }

    const existingIndex = current.messages.findIndex((entry) => entry.id === message.id);
    if (existingIndex >= 0) {
      current.messages[existingIndex] = message;
    } else {
      current.messages.push(message);
    }

    if (currentTurnId !== undefined) {
      current.currentTurnId = currentTurnId;
    }

    current.summary.updatedAt = Math.floor(Date.now() / 1000);
    current.liveStatus.updatedAt = Date.now();
    return current;
  }

  appendDelta(threadId: string, itemId: string, delta: string) {
    const current = this.details.get(threadId);
    if (!current) {
      return null;
    }

    const message = current.messages.find((entry) => entry.id === itemId);
    if (!message) {
      return null;
    }

    message.text += delta;
    current.summary.updatedAt = Math.floor(Date.now() / 1000);
    current.liveStatus.updatedAt = Date.now();
    return current;
  }

  clearTurn(threadId: string) {
    const current = this.details.get(threadId);
    if (!current) {
      return null;
    }

    current.currentTurnId = null;
    return current;
  }

  removeThread(threadId: string) {
    this.details.delete(threadId);
    this.summaries.delete(threadId);
  }
}

export { mapItem };
