import path from "node:path";
import os from "node:os";
import process from "node:process";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import express from "express";
import { fileURLToPath } from "node:url";
import { CodexAppClient } from "./codex-app-client.js";
import { SessionStore, mapItem, type Thread, type ThreadItem } from "./session-store.js";
import type {
  AccountInfo,
  AvailableModel,
  CodexConfigInfo,
  DiagnosticsInfo,
  MessageAttachment,
  SessionDetail,
  UploadedAttachment
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const clientDist = path.join(rootDir, "dist");
const codexConfigPath = path.join(process.env.HOME ?? "/root", ".codex", "config.toml");
const sessionModelsPath = path.join(process.env.HOME ?? "/root", ".codex", "codex-ui-session-models.json");
const sessionAttachmentsPath = path.join(process.env.HOME ?? "/root", ".codex", "codex-ui-thread-attachments.json");
const attachmentsRoot = path.join(os.tmpdir(), "codex-ui-attachments");
const projectsRoot = "/projects";
let activeWorkspaceDir = rootDir;

const app = express();
app.use(express.json({ limit: "25mb" }));
const execFileAsync = promisify(execFile);

const codex = new CodexAppClient({ cwd: activeWorkspaceDir });
const store = new SessionStore();
const sseClients = new Set<express.Response>();

type ThreadResponse = { thread: Thread; model?: string };
type ModelListResponse = {
  data: AvailableModel[];
  nextCursor?: string | null;
};
type FileTreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  extension: string | null;
};

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

function isMissingRolloutError(error: unknown) {
  const message = getErrorMessage(error);
  return message.includes("no rollout found") || message.includes("not materialized yet");
}

function resolveProjectsPath(input?: string | null) {
  const target = path.resolve(projectsRoot, input?.trim() || ".");
  if (target !== projectsRoot && !target.startsWith(`${projectsRoot}${path.sep}`)) {
    throw new Error("Path must stay within /projects.");
  }

  return target;
}

function toProjectRelativePath(targetPath: string) {
  const relative = path.relative(projectsRoot, targetPath);
  return relative === "" ? "" : relative;
}

async function readDirectoryTree(input?: string | null) {
  await fs.mkdir(projectsRoot, { recursive: true });
  const absolutePath = resolveProjectsPath(input);
  const stats = await fs.stat(absolutePath);
  if (!stats.isDirectory()) {
    throw new Error("Requested path is not a directory.");
  }

  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  const mapped = entries
    .map((entry) => {
      const nextPath = path.join(absolutePath, entry.name);
      return {
        name: entry.name,
        path: toProjectRelativePath(nextPath),
        type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        extension: entry.isDirectory() ? null : path.extname(entry.name).slice(1).toLowerCase() || null
      };
    })
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });

  return {
    path: toProjectRelativePath(absolutePath),
    entries: mapped satisfies FileTreeEntry[]
  };
}

async function readProjectFile(input?: string | null) {
  const absolutePath = resolveProjectsPath(input);
  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error("Requested path is not a file.");
  }

  const content = await fs.readFile(absolutePath);
  if (content.includes(0)) {
    return {
      path: toProjectRelativePath(absolutePath),
      name: path.basename(absolutePath),
      extension: path.extname(absolutePath).slice(1).toLowerCase() || null,
      content: "Binary file preview is not supported."
    };
  }

  return {
    path: toProjectRelativePath(absolutePath),
    name: path.basename(absolutePath),
    extension: path.extname(absolutePath).slice(1).toLowerCase() || null,
    content: content.toString("utf8")
  };
}

async function createProjectArchive(input?: string | null, includeEnv = false) {
  await fs.mkdir(projectsRoot, { recursive: true });
  const absolutePath = resolveProjectsPath(input);
  const stats = await fs.stat(absolutePath);
  if (!stats.isDirectory()) {
    throw new Error("Requested path is not a directory.");
  }

  const folderName = path.basename(absolutePath);
  const parentDir = path.dirname(absolutePath);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-ui-archive-"));
  const archivePath = path.join(tempDir, `${folderName}.zip`);
  const script = `
import os
import sys
import zipfile

root_dir = sys.argv[1]
folder_name = sys.argv[2]
archive_path = sys.argv[3]
include_env = sys.argv[4] == "1"
target_root = os.path.join(root_dir, folder_name)

with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for current_root, dirs, files in os.walk(target_root):
        dirs[:] = [directory for directory in dirs if directory != "node_modules"]
        for file_name in files:
            if not include_env and file_name == ".env":
                continue
            absolute_file = os.path.join(current_root, file_name)
            relative_file = os.path.relpath(absolute_file, root_dir)
            archive.write(absolute_file, relative_file)
`;

  await execFileAsync("python3", ["-c", script, parentDir, folderName, archivePath, includeEnv ? "1" : "0"], {
    cwd: parentDir,
    env: process.env
  });

  return {
    archivePath,
    archiveName: `${folderName}.zip`,
    tempDir
  };
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-") || "attachment";
}

function isImageAttachment(mimeType: string, fileName: string) {
  if (mimeType.startsWith("image/")) {
    return true;
  }

  const extension = path.extname(fileName).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(extension);
}

async function storeAttachment(payload: {
  name: string;
  mimeType: string;
  contentBase64: string;
}): Promise<UploadedAttachment> {
  const name = sanitizeFileName(payload.name);
  if (!isImageAttachment(payload.mimeType, name)) {
    throw new Error("Only image attachments are supported.");
  }
  const id = crypto.randomUUID();
  const filePath = path.join(attachmentsRoot, `${id}-${name}`);
  const buffer = Buffer.from(payload.contentBase64, "base64");

  await fs.mkdir(attachmentsRoot, { recursive: true });
  await fs.writeFile(filePath, buffer);

  return {
    id,
    name,
    path: filePath,
    mimeType: payload.mimeType,
    size: buffer.byteLength,
    kind: "image"
  };
}

async function readCodexConfig(): Promise<CodexConfigInfo> {
  const content = await fs.readFile(codexConfigPath, "utf8").catch(() => "");
  return {
    path: codexConfigPath,
    content
  };
}

async function readSessionModelOverrides() {
  try {
    const content = await fs.readFile(sessionModelsPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
    );
  } catch {
    return {} as Record<string, string>;
  }
}

async function writeSessionModelOverrides(overrides: Record<string, string>) {
  await fs.mkdir(path.dirname(sessionModelsPath), { recursive: true });
  await fs.writeFile(sessionModelsPath, JSON.stringify(overrides, null, 2), "utf8");
}

async function readThreadAttachmentRegistry() {
  try {
    const content = await fs.readFile(sessionAttachmentsPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, Array<{ text: string; attachments: MessageAttachment[] }>>;
    return parsed;
  } catch {
    return {} as Record<string, Array<{ text: string; attachments: MessageAttachment[] }>>;
  }
}

async function writeThreadAttachmentRegistry(registry: Record<string, Array<{ text: string; attachments: MessageAttachment[] }>>) {
  await fs.mkdir(path.dirname(sessionAttachmentsPath), { recursive: true });
  await fs.writeFile(sessionAttachmentsPath, JSON.stringify(registry, null, 2), "utf8");
}

async function appendThreadAttachments(threadId: string, text: string, attachments: UploadedAttachment[]) {
  if (!attachments.length) {
    return;
  }

  const registry = await readThreadAttachmentRegistry();
  const nextEntry = {
    text,
    attachments: attachments.map((attachment) => ({
      ...attachment,
      url: `/api/attachments/content?path=${encodeURIComponent(attachment.path)}`
    }))
  };

  registry[threadId] = [...(registry[threadId] ?? []), nextEntry];
  await writeThreadAttachmentRegistry(registry);
}

async function getThreadAttachments(threadId: string) {
  const registry = await readThreadAttachmentRegistry();
  return registry[threadId] ?? [];
}

async function clearThreadAttachments(threadId: string) {
  const registry = await readThreadAttachmentRegistry();
  if (!registry[threadId]) {
    return;
  }
  delete registry[threadId];
  await writeThreadAttachmentRegistry(registry);
}

function resolveAttachmentPath(input?: string | null) {
  const raw = input?.trim() || ".";
  const target = path.resolve(raw.startsWith("/") ? raw : path.join(attachmentsRoot, raw));
  if (target !== attachmentsRoot && !target.startsWith(`${attachmentsRoot}${path.sep}`)) {
    throw new Error("Path must stay within attachment storage.");
  }
  return target;
}

async function setSessionModelOverride(threadId: string, model: string | null) {
  const overrides = await readSessionModelOverrides();
  if (model) {
    overrides[threadId] = model;
  } else {
    delete overrides[threadId];
  }
  await writeSessionModelOverrides(overrides);
}

async function resolveSessionModel(threadId: string, fallbackModel: string | null) {
  const overrides = await readSessionModelOverrides();
  return overrides[threadId] ?? fallbackModel;
}

async function readConfiguredModel() {
  const config = await readCodexConfig();
  const match = config.content.match(/^\s*model\s*=\s*"([^"\n]+)"/m);
  return match?.[1] ?? null;
}

async function restartCodex() {
  await codex.restart();
  await listThreads();
}

async function ensureWorkspaceDir(workspacePath: string) {
  await fs.mkdir(workspacePath, { recursive: true });
}

function resolveWorkspaceDir(input?: string | null) {
  const raw = input?.trim();
  if (!raw) {
    return activeWorkspaceDir;
  }

  return path.resolve(raw.startsWith("/") ? raw : path.join(activeWorkspaceDir, raw));
}

async function switchWorkspace(workspacePath: string) {
  if (activeWorkspaceDir === workspacePath) {
    return;
  }

  await ensureWorkspaceDir(workspacePath);
  activeWorkspaceDir = workspacePath;
  codex.setCwd(workspacePath);
  process.chdir(workspacePath);
}

async function listThreads() {
  const configuredModel = await readConfiguredModel();
  const overrides = await readSessionModelOverrides();
  const response = await codex.request<{ data: ThreadResponse["thread"][] }>("thread/list", {
    cwd: rootDir,
    limit: 50,
    sourceKinds: []
  });

  return store.setSummaries(
    response.data.map((thread) => ({
      ...thread,
      model: overrides[thread.id] ?? thread.model ?? configuredModel
    })) as Thread[]
  );
}

async function listAvailableModels() {
  const models: AvailableModel[] = [];
  let cursor: string | null | undefined = null;

  do {
    const response: ModelListResponse = await codex.request<ModelListResponse>("model/list", {
      cursor,
      includeHidden: false,
      limit: 100
    });
    models.push(...response.data);
    cursor = response.nextCursor ?? null;
  } while (cursor);

  return models;
}

async function threadLoaded(threadId: string) {
  const response = await codex.request<{ data: string[] }>("thread/loaded/list", {});
  return response.data.includes(threadId);
}

async function loadThread(threadId: string) {
  const configuredModel = await readConfiguredModel();
  const loaded = await threadLoaded(threadId);
  let response: ThreadResponse;

  if (loaded) {
    try {
      response = await codex.request<ThreadResponse>("thread/read", { threadId, includeTurns: true });
    } catch (error) {
      if (!isMissingRolloutError(error)) {
        throw error;
      }

      try {
        response = await codex.request<ThreadResponse>("thread/resume", {
          threadId,
          cwd: rootDir,
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          persistExtendedHistory: true
        });
      } catch (resumeError) {
        if (!isMissingRolloutError(resumeError)) {
          throw resumeError;
        }

        const existing = detailFromStore(threadId);
        if (existing) {
          return existing;
        }

        throw resumeError;
      }
    }
  } else {
    try {
      response = await codex.request<ThreadResponse>("thread/resume", {
        threadId,
        cwd: rootDir,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        persistExtendedHistory: true
      });
    } catch (error) {
      if (!isMissingRolloutError(error)) {
        throw error;
      }

      const existing = detailFromStore(threadId);
      if (existing) {
        return existing;
      }

      throw error;
    }
  }

  const detail = store.setThread({
    ...response.thread,
    model: await resolveSessionModel(threadId, response.thread.model ?? response.model ?? configuredModel)
  } as Thread, await getThreadAttachments(threadId));
  await switchWorkspace(detail.summary.cwd);
  return detail;
}

async function createThread(name?: string | null, workspacePath?: string | null) {
  const configuredModel = await readConfiguredModel();
  const targetWorkspaceDir = resolveWorkspaceDir(workspacePath);
  await ensureWorkspaceDir(targetWorkspaceDir);

  const response = await codex.request<ThreadResponse & { model: string }>("thread/start", {
    cwd: targetWorkspaceDir,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    persistExtendedHistory: true,
    experimentalRawEvents: false
  });

  if (name) {
    await codex.request("thread/name/set", { threadId: response.thread.id, name });
    response.thread.name = name;
  }

  const detail = store.setThread({
    ...response.thread,
    model: response.thread.model ?? response.model ?? configuredModel
  } as Thread);
  await switchWorkspace(detail.summary.cwd);
  return detail;
}

function detailFromStore(threadId: string): SessionDetail | null {
  return store.getDetail(threadId);
}

async function getAccountInfo(currentThreadId?: string | null, locale = "en"): Promise<AccountInfo> {
  const fallbackStatus = await execFileAsync("codex", ["login", "status"], {
    cwd: rootDir,
    env: process.env
  })
    .then(({ stdout }) => stdout.trim() || "Login status unavailable")
    .catch(() => "Login status unavailable");

  const accountResponse = await codex
    .request<{
      account?: { type?: string; email?: string; planType?: string } | null;
      requiresOpenaiAuth?: boolean;
    }>("account/read", { refreshAuth: false })
    .catch(() => ({ account: null, requiresOpenaiAuth: false }));

  const rateLimitsResponse = await codex
    .request<{
      rateLimits?: {
        primary?: { usedPercent?: number; resetsAt?: number | null; windowDurationMins?: number | null } | null;
        secondary?: { usedPercent?: number; resetsAt?: number | null; windowDurationMins?: number | null } | null;
      } | null;
      rateLimitsByLimitId?: Record<
        string,
        {
          primary?: { usedPercent?: number; resetsAt?: number | null; windowDurationMins?: number | null } | null;
          secondary?: { usedPercent?: number; resetsAt?: number | null; windowDurationMins?: number | null } | null;
        }
      > | null;
    }>("account/rateLimits/read", {})
    .catch(() => ({ rateLimits: null, rateLimitsByLimitId: null }));

  const snapshots = [
    ...(rateLimitsResponse.rateLimits ? [rateLimitsResponse.rateLimits] : []),
    ...Object.values(rateLimitsResponse.rateLimitsByLimitId ?? {})
  ];

  const windows = snapshots.flatMap((snapshot) => [snapshot.primary, snapshot.secondary]).filter(Boolean) as Array<{
    usedPercent?: number;
    resetsAt?: number | null;
    windowDurationMins?: number | null;
  }>;

  const findWindow = (targetMinutes: number) =>
    windows.find((entry) => entry.windowDurationMins === targetMinutes) ??
    windows.find((entry) => Math.abs((entry.windowDurationMins ?? 0) - targetMinutes) <= 1) ??
    null;

  const toRemainingLabel = (usedPercent?: number) => {
    if (typeof usedPercent !== "number") {
      return locale === "fr" ? "Indisponible" : "Unavailable";
    }

    return locale === "fr" ? `${Math.max(0, 100 - usedPercent)}% restant` : `${Math.max(0, 100 - usedPercent)}% left`;
  };

  const toResetLabel = (timestamp?: number | null) => {
    if (!timestamp) {
      return locale === "fr" ? "Indisponible" : "Unavailable";
    }

    const millis = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
    return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(millis);
  };

  const window5h = findWindow(300);
  const window7d = findWindow(10080);
  const account = accountResponse.account;

  return {
    planLabel: account?.planType?.toUpperCase() ?? "Unknown plan",
    accountLabel: account?.email ?? fallbackStatus,
    remaining5hLabel: toRemainingLabel(window5h?.usedPercent),
    reset5hLabel: toResetLabel(window5h?.resetsAt),
    remaining7dLabel: toRemainingLabel(window7d?.usedPercent),
    reset7dLabel: toResetLabel(window7d?.resetsAt),
    updatedAt: Date.now()
  };
}

async function getDiagnosticsInfo(selectedSessionId?: string | null): Promise<DiagnosticsInfo> {
  const [loginStatus, codexVersion, projectsStats] = await Promise.all([
    execFileAsync("codex", ["login", "status"], {
      cwd: rootDir,
      env: process.env
    })
      .then(({ stdout }) => stdout.trim() || "Login status unavailable")
      .catch(() => "Login status unavailable"),
    execFileAsync("codex", ["--version"], {
      cwd: rootDir,
      env: process.env
    })
      .then(({ stdout }) => stdout.trim() || "Unknown")
      .catch(() => "Unknown"),
    fs.stat(projectsRoot).catch(() => null)
  ]);

  return {
    appVersion: "0.1.0",
    nodeVersion: process.version,
    codexVersion,
    loginStatus,
    currentWorkspace: activeWorkspaceDir,
    projectsRoot,
    projectsRootExists: Boolean(projectsStats?.isDirectory()),
    configPath: codexConfigPath,
    sessionCount: store.getSummaries().length,
    selectedSessionId: selectedSessionId ?? null,
    timestamp: Date.now()
  };
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

  if (message.method === "thread/archived" && threadId) {
    store.removeThread(threadId);
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
    const turnId = typeof params.turnId === "string" ? params.turnId : detailFromStore(threadId)?.currentTurnId ?? null;
    const next = store.appendMessage(threadId, mapItem(item, turnId));
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

app.get("/api/account", async (request, response) => {
  await listThreads().catch(() => {
    return;
  });
  const threadId = typeof request.query.threadId === "string" ? request.query.threadId : null;
  const locale = typeof request.query.locale === "string" ? request.query.locale : "en";
  response.json({ account: await getAccountInfo(threadId, locale) });
});

app.get("/api/config", async (_request, response) => {
  response.json({ config: await readCodexConfig() });
});

app.get("/api/models", async (_request, response) => {
  try {
    response.json({ models: await listAvailableModels() });
  } catch (error) {
    response.status(500).json({ error: getErrorMessage(error) });
  }
});

app.get("/api/files/tree", async (request, response) => {
  try {
    const targetPath = typeof request.query.path === "string" ? request.query.path : "";
    response.json(await readDirectoryTree(targetPath));
  } catch (error) {
    response.status(400).json({ error: getErrorMessage(error) });
  }
});

app.get("/api/files/content", async (request, response) => {
  try {
    const targetPath = typeof request.query.path === "string" ? request.query.path : "";
    response.json(await readProjectFile(targetPath));
  } catch (error) {
    response.status(400).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/files/archive", async (request, response) => {
  try {
    const targetPath = typeof request.body?.path === "string" ? request.body.path : "";
    const includeEnv = Boolean(request.body?.includeEnv);
    const { archivePath, archiveName, tempDir } = await createProjectArchive(targetPath, includeEnv);
    let cleanedUp = false;

    const cleanup = async () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
        return;
      });
    };

    response.download(archivePath, archiveName, async (error) => {
      await cleanup();
      if (error && !response.headersSent) {
        response.status(500).json({ error: "Unable to download archive." });
      }
    });

    response.on("close", () => {
      void cleanup();
    });
  } catch (error) {
    response.status(400).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/attachments", async (request, response) => {
  try {
    const attachments = Array.isArray(request.body?.attachments) ? request.body.attachments : [];
    if (!attachments.length) {
      response.status(400).json({ error: "At least one attachment is required." });
      return;
    }

    const stored = await Promise.all(
      attachments.map(async (entry: unknown) => {
        const payload = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
        const name = typeof payload.name === "string" ? payload.name : "";
        const mimeType = typeof payload.mimeType === "string" ? payload.mimeType : "application/octet-stream";
        const contentBase64 = typeof payload.contentBase64 === "string" ? payload.contentBase64 : "";

        if (!name || !contentBase64) {
          throw new Error("Invalid attachment payload.");
        }

        return storeAttachment({ name, mimeType, contentBase64 });
      })
    );

    response.status(201).json({ attachments: stored });
  } catch (error) {
    response.status(400).json({ error: getErrorMessage(error) });
  }
});

app.get("/api/attachments/content", async (request, response) => {
  try {
    const targetPath = typeof request.query.path === "string" ? request.query.path : "";
    const absolutePath = resolveAttachmentPath(targetPath);
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      response.status(404).json({ error: "Attachment not found." });
      return;
    }
    response.sendFile(absolutePath);
  } catch (error) {
    response.status(400).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/config", async (request, response) => {
  const content = typeof request.body?.content === "string" ? request.body.content : null;
  const restart = Boolean(request.body?.restart);

  if (content === null) {
    response.status(400).json({ error: "Config content is required." });
    return;
  }

  await fs.mkdir(path.dirname(codexConfigPath), { recursive: true });
  await fs.writeFile(codexConfigPath, content, "utf8");

  if (restart) {
    await restartCodex();
    broadcast("sessions", store.getSummaries());
  }

  response.json({
    ok: true,
    restarted: restart,
    config: await readCodexConfig()
  });
});

app.get("/api/sessions", async (_request, response) => {
  const sessions = await listThreads();
  response.json({ sessions });
});

app.get("/api/sessions/:threadId", async (request, response) => {
  const threadId = request.params.threadId;
  const detail =
    (await loadThread(threadId).catch((error) => {
      if (isMissingRolloutError(error)) {
        return detailFromStore(threadId);
      }

      throw error;
    })) ?? null;

  if (!detail) {
    response.status(404).json({ error: "Session not found." });
    return;
  }

  response.json({ thread: detail });
});

app.post("/api/sessions/:threadId/model", async (request, response) => {
  const threadId = request.params.threadId;
  const model = typeof request.body?.model === "string" ? request.body.model.trim() : "";

  if (!model) {
    response.status(400).json({ error: "Model is required." });
    return;
  }

  await setSessionModelOverride(threadId, model);
  const detail = await loadThread(threadId);
  detail.summary.model = model;
  store.upsertDetail(detail);
  await listThreads().catch(() => {
    return store.getSummaries();
  });
  store.updateSummary(threadId, { model });
  broadcast("sessions", store.getSummaries());
  broadcast("thread", detail);
  response.json({ thread: detail, sessions: store.getSummaries() });
});

app.post("/api/sessions/:threadId/rename", async (request, response) => {
  const threadId = request.params.threadId;
  const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";

  await codex.request("thread/name/set", {
    threadId,
    name: name || null
  });

  const detail = await loadThread(threadId);
  await listThreads();
  store.upsertDetail(detail);
  broadcast("sessions", store.getSummaries());
  broadcast("thread", detail);
  response.json({ thread: detail, sessions: store.getSummaries() });
});

app.post("/api/sessions", async (request, response) => {
  const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
  const cwd = typeof request.body?.cwd === "string" ? request.body.cwd.trim() : "";
  const detail = await createThread(name || null, cwd || null);
  await listThreads();
  store.upsertDetail(detail);
  broadcast("sessions", store.getSummaries());
  broadcast("thread", detail);
  response.status(201).json({ thread: detail });
});

app.post("/api/sessions/:threadId/messages", async (request, response) => {
  const threadId = request.params.threadId;
  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
  const attachments = Array.isArray(request.body?.attachments) ? (request.body.attachments as UploadedAttachment[]) : [];

  if (!text && !attachments.length) {
    response.status(400).json({ error: "Message text or attachment is required." });
    return;
  }

  const existing = detailFromStore(threadId);
  if (!existing) {
    await loadThread(threadId);
  }

  await appendThreadAttachments(threadId, text, attachments);

  await codex.request("turn/start", {
    threadId,
    input: [
      ...(text ? [{ type: "text", text, text_elements: [] }] : []),
      ...attachments.map((attachment) => ({ type: "localImage", path: attachment.path }))
    ],
    model: existing?.summary.model ?? null
  });

  const current = detailFromStore(threadId);
  if (current) {
    current.messages.push({
      id: `pending-user-${Date.now()}`,
      kind: "user",
      role: "user",
      title: "You",
      text: [text, ...attachments.map((attachment) => `[Attached: ${attachment.name}]`)].filter(Boolean).join("\n\n"),
      attachments: attachments.map((attachment) => ({
        ...attachment,
        url: `/api/attachments/content?path=${encodeURIComponent(attachment.path)}`
      })),
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
  const detail =
    (await loadThread(threadId).catch((error) => {
      if (isMissingRolloutError(error)) {
        return detailFromStore(threadId);
      }

      throw error;
    })) ?? null;

  if (!detail) {
    response.status(404).json({ error: "Session not found." });
    return;
  }

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

app.delete("/api/sessions/:threadId", async (request, response) => {
  const threadId = request.params.threadId;
  await setSessionModelOverride(threadId, null).catch(() => {
    return;
  });
  await clearThreadAttachments(threadId).catch(() => {
    return;
  });

  await codex.request("thread/archive", { threadId }).catch(() => {
    return;
  });
  store.removeThread(threadId);

  const sessions = await listThreads().catch(() => store.getSummaries());
  const fallbackThread = sessions[0] ? await loadThread(sessions[0].id).catch(() => null) : null;

  broadcast("sessions", store.getSummaries());
  if (fallbackThread) {
    broadcast("thread", fallbackThread);
  }

  response.json({
    ok: true,
    sessions: store.getSummaries(),
    selectedThread: fallbackThread
  });
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

app.get("/api/diagnostics", async (request, response) => {
  const selectedSessionId = typeof request.query.threadId === "string" ? request.query.threadId : null;
  response.json({ diagnostics: await getDiagnosticsInfo(selectedSessionId) });
});

app.use(express.static(clientDist));
app.get("/{*path}", (_request, response) => {
  response.sendFile(path.join(clientDist, "index.html"));
});

const port = Number(process.env.PORT ?? 3001);

async function start() {
  await fs.mkdir(projectsRoot, { recursive: true }).catch(() => {
    return;
  });
  await codex.start().catch((error) => {
    console.error("Codex start failed:", error);
  });
  await listThreads().catch((error) => {
    console.error("Initial thread sync failed:", error);
  });

  app.listen(port, () => {
    console.log(`Codex UI server listening on http://127.0.0.1:${port}`);
  });
}

void start();

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void codex.stop().finally(() => process.exit(0));
  });
}
