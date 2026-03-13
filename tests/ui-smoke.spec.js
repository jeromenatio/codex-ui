import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const THREAD_KEY = "codex-ui-current-thread";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnH9i0AAAAASUVORK5CYII=",
  "base64"
);

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueName(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function fetchSessions(request) {
  const response = await request.get("/api/sessions");
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return data.sessions ?? [];
}

async function fetchThread(request, threadId) {
  const response = await request.get(`/api/sessions/${threadId}`);
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return data.thread;
}

async function fetchConfig(request) {
  const response = await request.get("/api/config");
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return data.config;
}

async function saveConfig(request, content) {
  const response = await request.post("/api/config", {
    data: {
      content,
      restart: false
    }
  });
  expect(response.ok()).toBeTruthy();
}

async function createSession(request, options = {}) {
  const response = await request.post("/api/sessions", {
    data: {
      name: options.name ?? null,
      cwd: options.cwd ?? null
    }
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return data.thread;
}

async function renameSession(request, threadId, name) {
  const response = await request.post(`/api/sessions/${threadId}/rename`, {
    data: { name }
  });
  expect(response.ok()).toBeTruthy();
}

async function deleteSession(request, threadId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request.delete(`/api/sessions/${threadId}`);
    if (response.ok() || response.status() === 404) {
      return;
    }
    await sleep(750);
  }

  throw new Error(`Unable to delete temporary session ${threadId}`);
}

async function waitForAssistantText(request, threadId, expectedText, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const thread = await fetchThread(request, threadId);
    const match = thread.messages.find(
      (entry) => entry.role === "assistant" && entry.phase !== "commentary" && (entry.text ?? "").includes(expectedText)
    );
    if (match) {
      return thread;
    }
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for assistant text "${expectedText}" in thread ${threadId}`);
}

async function waitForThreadIdle(request, threadId, timeoutMs = 45_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const thread = await fetchThread(request, threadId);
    if (thread.liveStatus?.tone !== "running") {
      return thread;
    }
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for thread ${threadId} to stop running`);
}

async function waitForSessionPresence(request, threadId, present, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const sessions = await fetchSessions(request);
    const found = sessions.some((entry) => entry.id === threadId);
    if (found === present) {
      return sessions;
    }
    await sleep(750);
  }

  throw new Error(`Timed out waiting for session ${threadId} present=${present}`);
}

async function selectSession(page, threadId) {
  await page.locator("select").first().selectOption(threadId);
  await expect(page.locator("select").first()).toHaveValue(threadId);
}

async function openChat(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible();
}

async function switchLanguage(page, languageLabel) {
  await page.locator(".language-picker > button").click();
  await page.getByRole("button", { name: languageLabel, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(([threadKey]) => {
    window.localStorage.setItem("codex-ui-language", "en");
    window.localStorage.setItem("codex-ui-theme", "paper");
    window.localStorage.removeItem(threadKey);
  }, [THREAD_KEY]);
});

test("chat shell loads and diagnostics overlay opens", async ({ page }) => {
  await openChat(page);

  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Composer" })).toBeVisible();

  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
  await expect(page.getByText("Codex version")).toBeVisible();
  await expect(page.getByText("Projects root")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
});

test("files page opens, previews a file, and archive excludes node_modules and .env by default", async ({ page, request }) => {
  const folderName = uniqueName("archive-e2e");
  const folderPath = path.join("/projects", folderName);
  const zipPath = path.join(os.tmpdir(), `${folderName}.zip`);

  await fs.mkdir(path.join(folderPath, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(folderPath, "README.txt"), "archive smoke", "utf8");
  await fs.writeFile(path.join(folderPath, ".env"), "SECRET_TOKEN=fake", "utf8");
  await fs.writeFile(path.join(folderPath, "node_modules", "pkg", "index.js"), "module.exports = {};", "utf8");

  try {
    await openChat(page);
    await page.getByRole("button", { name: "Files" }).click();

    await expect(page).toHaveURL(/\/files$/);
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Viewer" })).toBeVisible();

    const codexFolder = page.locator(".file-tree-row").filter({ hasText: "codex-ui" }).first();
    await codexFolder.click();
    await page.locator(".file-tree-row").filter({ hasText: "README.md" }).first().click();
    await expect(page.locator(".file-viewer-content")).toContainText("codex-ui");

    const archiveRow = page.locator(".file-tree-row").filter({ hasText: folderName }).first();
    await expect(archiveRow).toBeVisible();
    await archiveRow.locator(`button[title="Download zip"]`).click();
    await expect(page.getByRole("heading", { name: "Download folder as zip" })).toBeVisible();
    await page.getByRole("button", { name: "Download zip" }).click();
    await expect(page.getByText("Archive download started.")).toBeVisible();

    const response = await request.post("/api/files/archive", {
      data: {
        path: folderName,
        includeEnv: false
      }
    });
    expect(response.ok()).toBeTruthy();
    await fs.writeFile(zipPath, Buffer.from(await response.body()));

    const listed = execFileSync(
      "python3",
      [
        "-c",
        "import json, sys, zipfile; archive = zipfile.ZipFile(sys.argv[1]); print(json.dumps(sorted(archive.namelist())))",
        zipPath
      ],
      { encoding: "utf8" }
    );
    const names = JSON.parse(listed);
    expect(names.some((entry) => entry.endsWith("README.txt"))).toBeTruthy();
    expect(names.some((entry) => entry.includes("node_modules"))).toBeFalsy();
    expect(names.some((entry) => entry.endsWith(".env"))).toBeFalsy();
  } finally {
    await fs.rm(folderPath, { recursive: true, force: true });
    await fs.rm(zipPath, { force: true });
  }
});

test("conversation search and markdown export work", async ({ page, request }) => {
  const sessions = await fetchSessions(request);
  const session = sessions[0] ?? null;
  expect(session).toBeTruthy();

  await openChat(page);
  await selectSession(page, session.id);
  await expect(page.locator(".message-card").first()).toBeVisible({ timeout: 15_000 });

  const searchInput = page.getByPlaceholder("Search conversation");
  await searchInput.fill("clear");
  await expect(page.locator(".meta-tag").filter({ hasText: "matches" }).first()).toBeVisible();
  await searchInput.clear();

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByText("Conversation exported.")).toBeVisible();
});

test("language picker switches the main UI between EN and FR", async ({ page }) => {
  await openChat(page);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  await switchLanguage(page, "FR");
  await expect(page.getByPlaceholder("Rechercher dans la conversation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Envoyer" })).toBeVisible();
  await page.getByRole("button", { name: "Fichiers" }).click();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Visionneuse" })).toBeVisible();

  await switchLanguage(page, "EN");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Viewer" })).toBeVisible();
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page.getByPlaceholder("Search conversation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("config modal saves through the form and can be restored", async ({ page, request }) => {
  const originalConfig = await fetchConfig(request);

  try {
    await openChat(page);
    await page.getByRole("button", { name: "Configs" }).click();
    await expect(page.getByRole("heading", { name: "Codex config" })).toBeVisible();

    const webSearchSelect = page.locator(".config-form select").nth(3);
    const currentWebSearch = await webSearchSelect.inputValue();
    const nextWebSearch = currentWebSearch === "cached" ? "live" : "cached";
    await webSearchSelect.selectOption(nextWebSearch);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Config saved.")).toBeVisible();

    const updatedConfig = await fetchConfig(request);
    expect(updatedConfig.content.includes(`web_search = "${nextWebSearch}"`)).toBeTruthy();
  } finally {
    await saveConfig(request, originalConfig.content);
  }
});

test("session model overlay changes the current session model", async ({ page, request }) => {
  const modelsResponse = await request.get("/api/models");
  expect(modelsResponse.ok()).toBeTruthy();
  const modelsData = await modelsResponse.json();
  const availableModels = modelsData.models ?? [];
  expect(availableModels.length > 1).toBeTruthy();

  const tempName = uniqueName("model-e2e");
  const tempPath = `/projects/${tempName}`;
  const thread = await createSession(request, { name: tempName, cwd: tempPath });
  const originalModel = thread.summary.model ?? availableModels[0].model;
  const targetModel = availableModels.find((entry) => entry.model !== originalModel)?.model ?? availableModels[0].model;

  try {
    await openChat(page);
    await selectSession(page, thread.summary.id);

    await page.getByRole("button", { name: originalModel }).click();
    await expect(page.getByRole("heading", { name: "Session model" })).toBeVisible();
    await page.locator(".model-option").filter({ hasText: targetModel }).first().click();
    await expect(page.getByText(`Session model changed to ${targetModel}.`)).toBeVisible();
    await expect
      .poll(async () => {
        const sessions = await fetchSessions(request);
        return sessions.find((entry) => entry.id === thread.summary.id)?.model ?? null;
      })
      .toBe(targetModel);
  } finally {
    await deleteSession(request, thread.summary.id);
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

test("composer clear removes typed text and pending images", async ({ page, request }) => {
  const tempName = uniqueName("clear-e2e");
  const tempPath = `/projects/${tempName}`;
  const thread = await createSession(request, { name: tempName, cwd: tempPath });

  try {
    await openChat(page);
    await selectSession(page, thread.summary.id);

    const composer = page.getByPlaceholder("Post a message to the active Codex session...");
    await composer.fill("temporary text");

    await page.getByRole("button", { name: "Attach" }).click();
    await expect(page.getByRole("heading", { name: "Attached images" })).toBeVisible();
    await page.locator("#composer-image-input").setInputFiles([
      {
        name: "tiny.png",
        mimeType: "image/png",
        buffer: TINY_PNG
      }
    ]);

    await expect(page.getByText("Image added.")).toBeVisible();
    await expect(page.locator(".attach-badge")).toHaveText("1");
    await expect(page.locator(".attachment-chip")).toHaveCount(1);
    await page.getByLabel("Close images modal").click();

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(composer).toHaveValue("");
    await expect(page.locator(".attach-badge")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Attached images" })).toHaveCount(0);
  } finally {
    await deleteSession(request, thread.summary.id);
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

test("session rename persists and quick prompts CRUD works", async ({ page, request }) => {
  await openChat(page);

  const sessions = await fetchSessions(request);
  const originalSession = sessions.find((entry) => entry.status !== "active") ?? sessions[0] ?? null;
  expect(originalSession).toBeTruthy();

  await selectSession(page, originalSession.id);

  const renamedTitle = `${originalSession.name || "Session"} e2e`;
  await page.getByRole("button", { name: "Rename session" }).click();
  await page.getByPlaceholder("Rename session").fill(renamedTitle);
  await page.locator(".inline-session-rename .message-icon-button").first().click();
  await expect(page.getByText("Session renamed.")).toBeVisible();

  const renamedSessions = await fetchSessions(request);
  expect(renamedSessions.some((entry) => entry.id === originalSession.id && entry.name === renamedTitle)).toBeTruthy();

  await page.getByRole("button", { name: "Quick prompts" }).click();
  await expect(page.getByRole("heading", { name: "Quick prompts" })).toBeVisible();
  await page.getByPlaceholder("Title").fill("E2E Prompt");
  await page.getByPlaceholder("Message content").fill("E2E content");
  await page.getByRole("button", { name: "Add prompt" }).click();
  await expect(page.getByText("Quick prompt created.")).toBeVisible();
  await expect(page.locator(".quick-prompt-row").filter({ hasText: "E2E Prompt" }).first()).toBeVisible();
  await page.locator(".quick-prompt-row").filter({ hasText: "E2E Prompt" }).locator('button[title="Delete"]').click();
  await expect(page.getByText("Quick prompt removed.")).toBeVisible();
  await page.getByLabel("Close quick prompts modal").click();

  await renameSession(request, originalSession.id, originalSession.name || "");
});

test("chat can send a message and retry the last prompt", async ({ page, request }) => {
  test.setTimeout(120_000);

  const tempName = uniqueName("chat-e2e");
  const tempPath = `/projects/${tempName}`;
  const thread = await createSession(request, { name: tempName, cwd: tempPath });
  const prompt = `Reply with the exact token ${tempName.toUpperCase()} and nothing else.`;

  try {
    await openChat(page);
    await selectSession(page, thread.summary.id);

    const composer = page.getByPlaceholder("Post a message to the active Codex session...");
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(composer).toHaveValue("");
    await expect(page.locator(".message-card.message-user").filter({ hasText: prompt }).first()).toBeVisible();

    await waitForAssistantText(request, thread.summary.id, tempName.toUpperCase(), 90_000);
    await expect(page.locator(".message-card.message-assistant").filter({ hasText: tempName.toUpperCase() }).first()).toBeVisible({ timeout: 90_000 });

    const beforeRetryThread = await fetchThread(request, thread.summary.id);
    const beforeRetryUserCount = beforeRetryThread.messages.filter((entry) => entry.role === "user").length;
    await page.getByRole("button", { name: "Retry" }).click();

    await expect
      .poll(async () => {
        const current = await fetchThread(request, thread.summary.id);
        return current.messages.filter((entry) => entry.role === "user").length;
      }, { timeout: 30_000 })
      .toBeGreaterThan(beforeRetryUserCount);
  } finally {
    await waitForThreadIdle(request, thread.summary.id).catch(() => {
      return null;
    });
    await deleteSession(request, thread.summary.id);
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

test("stop interrupts a running turn", async ({ page, request }) => {
  test.setTimeout(120_000);

  const tempName = uniqueName("stop-e2e");
  const tempPath = `/projects/${tempName}`;
  const thread = await createSession(request, { name: tempName, cwd: tempPath });
  const prompt =
    "Think carefully for a while before answering. Explore multiple options and do not finish immediately. End with STOP-E2E only after detailed reasoning.";

  try {
    await openChat(page);
    await selectSession(page, thread.summary.id);

    await page.getByPlaceholder("Post a message to the active Codex session...").fill(prompt);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.locator(".status-pill")).toContainText("Stopping", { timeout: 20_000 });

    const stoppedThread = await waitForThreadIdle(request, thread.summary.id, 45_000);
    expect(stoppedThread.liveStatus?.tone === "running").toBeFalsy();
  } finally {
    await deleteSession(request, thread.summary.id);
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

test("new session creation selects the new session", async ({ page, request }) => {
  const existingSessions = await fetchSessions(request);
  const fallbackSession = existingSessions[0] ?? null;

  await openChat(page);

  const tempName = uniqueName("create-e2e");
  const tempPath = `/projects/${tempName}`;

  await page.getByLabel("Create a new session").click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await page.getByPlaceholder("/projects/my-workspace").fill(tempPath);
  await page.getByPlaceholder("Session title").fill(tempName);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect
    .poll(async () => {
      const entries = await fetchSessions(request);
      return entries.some((entry) => entry.name === tempName);
    }, { timeout: 20_000 })
    .toBeTruthy();
  const currentSessions = await fetchSessions(request);
  const created = currentSessions.find((entry) => entry.name === tempName);
  expect(created).toBeTruthy();
  await expect(page.locator("select").first()).toHaveValue(created.id, { timeout: 15_000 });

  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(page.getByText("Loaded sessions")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  try {
    if (fallbackSession && fallbackSession.id !== created.id) {
      await selectSession(page, fallbackSession.id);
      await page.waitForTimeout(500);
    }
  } finally {
    await deleteSession(request, created.id);
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

test("new session can send its first message immediately", async ({ page, request }) => {
  test.setTimeout(120_000);

  const tempName = uniqueName("first-message-e2e");
  const tempPath = `/projects/${tempName}`;
  const prompt = `Reply with the exact token ${tempName.toUpperCase()} and nothing else.`;

  let created = null;

  try {
    await openChat(page);
    await page.getByLabel("Create a new session").click();
    await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
    await page.getByPlaceholder("/projects/my-workspace").fill(tempPath);
    await page.getByPlaceholder("Session title").fill(tempName);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect
      .poll(async () => {
        const sessions = await fetchSessions(request);
        return sessions.find((entry) => entry.name === tempName)?.id ?? null;
      }, { timeout: 20_000 })
      .not.toBeNull();

    const sessions = await fetchSessions(request);
    created = sessions.find((entry) => entry.name === tempName) ?? null;
    expect(created).toBeTruthy();

    const composer = page.getByPlaceholder("Post a message to the active Codex session...");
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.locator(".message-card.message-user").filter({ hasText: prompt }).first()).toBeVisible({
      timeout: 15_000
    });

    await waitForAssistantText(request, created.id, tempName.toUpperCase(), 90_000);
    await expect(
      page.locator(".message-card.message-assistant").filter({ hasText: tempName.toUpperCase() }).first()
    ).toBeVisible({ timeout: 90_000 });
  } finally {
    if (created?.id) {
      await waitForThreadIdle(request, created.id).catch(() => null);
      await deleteSession(request, created.id);
    }
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

test("sessions overlay deletes a temporary session through the UI", async ({ page, request }) => {
  const tempName = uniqueName("delete-e2e");
  const tempPath = `/projects/${tempName}`;
  const thread = await createSession(request, { name: tempName, cwd: tempPath });

  try {
    await openChat(page);
    page.on("dialog", (dialog) => dialog.accept());

    await page.getByRole("button", { name: "Sessions" }).click();
    await expect(page.getByRole("heading", { name: "Manage sessions" })).toBeVisible();

    const sessionRow = page.locator(".session-admin-row").filter({ hasText: tempName }).first();
    await expect(sessionRow).toBeVisible();
    await sessionRow.getByRole("button", { name: "Delete" }).click();

    await expect(page.locator(".session-admin-row").filter({ hasText: tempName })).toHaveCount(0, { timeout: 15_000 });
    await waitForSessionPresence(request, thread.summary.id, false, 20_000);
  } finally {
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});
