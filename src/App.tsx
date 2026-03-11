import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  CircleStop,
  CircleX,
  Copy,
  Expand,
  Minimize2,
  MessagesSquare,
  Eraser,
  FolderKanban,
  Gauge,
  LoaderCircle,
  MessageSquareMore,
  Palette,
  Plus,
  RefreshCw,
  SendHorizonal,
  Settings2,
  SquarePen,
  Sparkles
} from "lucide-react";
import type { AccountInfo, BootstrapResponse, CodexConfigInfo, SessionDetail, SessionSummary, Theme } from "./types";

const THEMES: Theme[] = [
  {
    id: "linen",
    label: "Linen Ledger",
    description: "Lin clair, graphite doux et accent olive."
  },
  {
    id: "slate",
    label: "Slate Office",
    description: "Gris bleuté, blanc cassé et accent ardoise."
  },
  {
    id: "paper",
    label: "Paper Console",
    description: "Ivoire, encre et accent cyan."
  }
];

const THREAD_KEY = "codex-ui-current-thread";
const THEME_KEY = "codex-ui-theme";

async function fetchJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error ?? "Request failed");
  }

  return (await response.json()) as T;
}

function formatSessionDate(timestamp: number) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(timestamp * 1000);
}

function deriveSessionTitle(session: Pick<SessionSummary, "name" | "preview"> | null | undefined) {
  if (!session) {
    return "Untitled session";
  }

  const explicit = session.name?.trim();
  if (explicit) {
    return explicit;
  }

  const fallback = session.preview.replace(/\s+/g, " ").trim();
  return fallback ? fallback.slice(0, 72) : "Untitled session";
}

function isExpandable(text: string) {
  return text.length > 420 || text.split("\n").length > 10;
}

function applyPermissiveCodexPreset(content: string) {
  void content;
  return `model = "gpt-5.4"
approval_policy = "never"
sandbox_mode = "danger-full-access"
search = true

[notice]
hide_full_access_warning = true

[notice.model_migrations]
"gpt-5.3-codex" = "gpt-5.4"
`;
}

function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentThread, setCurrentThread] = useState<SessionDetail | null>(null);
  const [message, setMessage] = useState("");
  const [newSessionName, setNewSessionName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPosting, setIsPosting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) ?? THEMES[0].id);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [configDraft, setConfigDraft] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isConfigSaving, setIsConfigSaving] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingAutoScrollRef = useRef(false);
  const scrollTimerRef = useRef<number | null>(null);
  const lastScrollStateRef = useRef<{ threadId: string | null; count: number }>({
    threadId: null,
    count: 0
  });
  const selectedThreadId = currentThread?.summary.id ?? null;
  const visibleConversationCount =
    currentThread?.messages.filter(
      (entry) => entry.role === "user" || (entry.role === "assistant" && entry.phase !== "commentary")
    ).length ?? 0;
  const isBusy = currentThread?.liveStatus.tone === "running";
  const conversationMessages = useMemo(
    () =>
      currentThread?.messages.filter(
        (entry) => entry.role === "user" || (entry.role === "assistant" && entry.phase !== "commentary")
      ) ?? [],
    [currentThread?.messages]
  );
  const activityMessages = useMemo(
    () =>
      currentThread?.messages.filter(
        (entry) => !(entry.role === "user" || (entry.role === "assistant" && entry.phase !== "commentary"))
      ) ?? [],
    [currentThread?.messages]
  );

  async function refreshSessions() {
    const data = await fetchJson<{ sessions: SessionSummary[] }>("/api/sessions");
    setSessions(data.sessions);
  }

  async function refreshAccount(threadId?: string | null) {
    const search = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
    const data = await fetchJson<{ account: AccountInfo }>(`/api/account${search}`);
    setAccount(data.account);
  }

  async function refreshConfig() {
    const data = await fetchJson<{ config: CodexConfigInfo }>("/api/config");
    setConfigDraft(data.config.content);
    setConfigPath(data.config.path);
  }

  async function loadThread(threadId: string, options?: { preserveError?: boolean }) {
    const data = await fetchJson<{ thread: SessionDetail }>(`/api/sessions/${threadId}`);
    pendingAutoScrollRef.current = true;
    setCurrentThread(data.thread);
    setSessions((previous) => {
      const exists = previous.some((entry) => entry.id === data.thread.summary.id);
      const next = exists
        ? previous.map((entry) => (entry.id === data.thread.summary.id ? data.thread.summary : entry))
        : [data.thread.summary, ...previous];

      return [...next].sort((left, right) => right.updatedAt - left.updatedAt);
    });
    localStorage.setItem(THREAD_KEY, data.thread.summary.id);
    if (!options?.preserveError) {
      setError(null);
    }
  }

  async function bootstrap() {
    setIsLoading(true);
    try {
      const rememberedThreadId = localStorage.getItem(THREAD_KEY);
      const search = rememberedThreadId ? `?threadId=${encodeURIComponent(rememberedThreadId)}` : "";
      const data = await fetchJson<BootstrapResponse>(`/api/bootstrap${search}`);
      setSessions(data.sessions);
      pendingAutoScrollRef.current = true;
      setCurrentThread(data.selectedThread);
      await refreshConfig();
      if (data.selectedThread) {
        localStorage.setItem(THREAD_KEY, data.selectedThread.summary.id);
      }
      await refreshAccount(data.selectedThread?.summary.id ?? null);
      setError(null);
    } catch (nextError) {
      try {
        const fallback = await fetchJson<{ sessions: SessionSummary[] }>("/api/sessions");
        setSessions(fallback.sessions);
      } catch {
        setSessions([]);
      }
      setError(nextError instanceof Error ? nextError.message : "Unable to load the UI.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!selectedThreadId) {
      void refreshAccount(null).catch(() => {
        return;
      });
      return;
    }

    const interval = window.setInterval(() => {
      void Promise.all([
        loadThread(selectedThreadId, { preserveError: true }),
        refreshSessions(),
        refreshAccount(selectedThreadId)
      ]).catch(() => {
        return;
      });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [selectedThreadId]);

  useEffect(() => {
    void refreshAccount(selectedThreadId).catch(() => {
      return;
    });
  }, [selectedThreadId]);

  useEffect(() => {
    const events = new EventSource("/events");

    events.addEventListener("sessions", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as SessionSummary[];
      setSessions(payload);
    });

    events.addEventListener("thread", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as SessionDetail;
      setCurrentThread((previous) => {
        if (!previous || previous.summary.id !== payload.summary.id) {
          return previous;
        }

        return payload;
      });
    });

    events.onerror = () => {
      events.close();
    };

    return () => events.close();
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || isLoading || !selectedThreadId || !conversationMessages.length) {
      return;
    }

    const previous = lastScrollStateRef.current;
    const nextCount = conversationMessages.length;
    const threadChanged = previous.threadId !== selectedThreadId;
    const countIncreased = nextCount > previous.count;
    const forceScroll = pendingAutoScrollRef.current;

    if (!forceScroll && !threadChanged && !countIncreased) {
      lastScrollStateRef.current = {
        threadId: selectedThreadId,
        count: nextCount
      };
      return;
    }

    const scrollToBottom = () => {
      if (typeof element.scrollTo === "function") {
        element.scrollTo({
          top: element.scrollHeight,
          behavior: forceScroll || threadChanged ? "auto" : "smooth"
        });
      } else {
        element.scrollTop = element.scrollHeight;
      }
    };

    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }

    scrollTimerRef.current = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(scrollToBottom);
      });
      scrollTimerRef.current = null;
    }, 80);

    lastScrollStateRef.current = {
      threadId: selectedThreadId,
      count: nextCount
    };
    pendingAutoScrollRef.current = false;
  }, [selectedThreadId, conversationMessages.length, isLoading]);

  async function handleCreateSession() {
    setIsCreating(true);
    try {
      const data = await fetchJson<{ thread: SessionDetail }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: newSessionName.trim() || null
        })
      });

      setCurrentThread(data.thread);
      setNewSessionName("");
      setIsCreateModalOpen(false);
      await refreshSessions();
      localStorage.setItem(THREAD_KEY, data.thread.summary.id);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create a new session.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentThread || !message.trim()) {
      return;
    }

    const submitted = message.trim();
    setMessage("");
    setIsPosting(true);

    setCurrentThread((previous) =>
      previous
        ? {
            ...previous,
            messages: [
              ...previous.messages,
              {
                id: `optimistic-${Date.now()}`,
                kind: "user",
                role: "user",
                title: "You",
                text: submitted,
                status: "queued"
              }
            ],
            liveStatus: {
              tone: "running",
              label: "Queued",
              detail: "Message sent to Codex.",
              updatedAt: Date.now()
            }
          }
        : previous
    );

    try {
      await fetchJson(`/api/sessions/${currentThread.summary.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: submitted })
      });
      await refreshSessions();
      setError(null);
    } catch (nextError) {
      setMessage(submitted);
      setError(nextError instanceof Error ? nextError.message : "Unable to send the message.");
      await loadThread(currentThread.summary.id, { preserveError: true });
    } finally {
      setIsPosting(false);
    }
  }

  async function handleStop() {
    if (!currentThread) {
      return;
    }

    try {
      await fetchJson(`/api/sessions/${currentThread.summary.id}/stop`, {
        method: "POST"
      });
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to stop the current turn.");
    }
  }

  async function handleClear() {
    if (!currentThread) {
      return;
    }

    try {
      const data = await fetchJson<{ thread: SessionDetail }>(
        `/api/sessions/${currentThread.summary.id}/clear`,
        { method: "POST" }
      );
      setCurrentThread(data.thread);
      await refreshSessions();
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to clear this session.");
    }
  }

  async function handleCopyMessage(messageId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1200);
    } catch {
      setError("Unable to copy message.");
    }
  }

  function toggleMessageExpanded(messageId: string) {
    setExpandedMessages((previous) => ({
      ...previous,
      [messageId]: !previous[messageId]
    }));
  }

  async function handleOpenConfig() {
    await refreshConfig();
    setIsConfigOpen(true);
  }

  async function handleSaveConfig(restart: boolean) {
    setIsConfigSaving(true);
    try {
      const data = await fetchJson<{ config: CodexConfigInfo }>("/api/config", {
        method: "POST",
        body: JSON.stringify({
          content: configDraft,
          restart
        })
      });
      setConfigDraft(data.config.content);
      setConfigPath(data.config.path);
      if (restart) {
        await bootstrap();
      }
      setError(null);
      setIsConfigOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save Codex config.");
    } finally {
      setIsConfigSaving(false);
    }
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <nav className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div>
            <p>Codex UI</p>
            <span>Local sessions</span>
          </div>
        </div>

        <div className="topbar-actions">
          <label className="theme-switcher">
            <Palette size={16} />
            <select value={theme} onChange={(event) => setTheme(event.target.value)}>
              {THEMES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <button className="ghost-button" type="button" onClick={() => void refreshSessions()}>
            <RefreshCw size={16} />
            Refresh
          </button>

          <button className="ghost-button" type="button" onClick={() => void handleOpenConfig()}>
            <Settings2 size={16} />
            Config
          </button>
        </div>
      </nav>

      <main className="layout">
        <section className="conversation-column">
          <div className="section-head section-head-compact tight">
            <div className="panel-title">
              <MessagesSquare size={15} />
              <h2>Conversation</h2>
            </div>
            <button
              type="button"
              className="ghost-button subtle"
              onClick={() => setIsActivityOpen(true)}
              disabled={!activityMessages.length}
            >
              <Activity size={15} />
              Activity
            </button>
          </div>

          <div className="conversation-panel" ref={scrollRef}>
            {isLoading ? (
              <div className="empty-state">
                <LoaderCircle size={18} className="spin" />
                <p>Loading Codex sessions...</p>
              </div>
            ) : currentThread ? (
              conversationMessages.length ? (
                conversationMessages.map((entry) => (
                  <article key={entry.id} className={`message-card message-${entry.role} message-kind-${entry.kind}`}>
                    <div className="message-head">
                      <strong>{entry.title}</strong>
                      <div className="message-toolbar">
                        {isExpandable(entry.text) ? (
                          <button
                            type="button"
                            className="message-icon-button"
                            onClick={() => toggleMessageExpanded(entry.id)}
                            aria-label={expandedMessages[entry.id] ? "Collapse message" : "Expand message"}
                          >
                            {expandedMessages[entry.id] ? <Minimize2 size={14} /> : <Expand size={14} />}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="message-icon-button"
                          onClick={() => void handleCopyMessage(entry.id, entry.text)}
                          aria-label="Copy message"
                          title={copiedMessageId === entry.id ? "Copied" : "Copy"}
                        >
                          <Copy size={14} />
                        </button>
                        {entry.status ? <span>{entry.status}</span> : null}
                      </div>
                    </div>
                    <div className={`markdown-message ${expandedMessages[entry.id] ? "expanded" : ""}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.text}</ReactMarkdown>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <MessageSquareMore size={22} />
                  <p>No messages yet. Start by posting a prompt on the right.</p>
                </div>
              )
            ) : (
              <div className="empty-state">
                <Plus size={22} />
                <p>Create or load a session to start.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="sidebar-column">
          <div className="sidebar-sticky">
            <section className="sidebar-panel">
              <div className="section-head section-head-compact tight">
                <div className="panel-title">
                  <FolderKanban size={15} />
                  <h2>Sessions</h2>
                </div>
                <span className="meta-tag">{visibleConversationCount} msgs</span>
              </div>

              <div className="session-picker-row">
                <label className="session-select-wrap">
                  <select
                    value={selectedThreadId ?? ""}
                    onChange={(event) => {
                      if (event.target.value) {
                        void loadThread(event.target.value);
                      }
                    }}
                  >
                    <option value="" disabled>
                      Select a session
                    </option>
                    {sessions.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {formatSessionDate(entry.updatedAt)} - {deriveSessionTitle(entry)}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="solid-button icon-button"
                  onClick={() => setIsCreateModalOpen(true)}
                  aria-label="Create a new session"
                >
                  <Plus size={16} />
                </button>
              </div>
            </section>

            <section className="sidebar-panel">
              <div className="section-head section-head-compact tight">
                <div className="panel-title">
                  <SquarePen size={15} />
                  <h2>Composer</h2>
                </div>
              </div>

              <form className="composer" onSubmit={handleSubmit}>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Post a message to the active Codex session..."
                  disabled={!currentThread}
                />
                <div className="composer-actions">
                  <button
                    type="button"
                    className="ghost-button subtle stop-button"
                    onClick={() => void handleStop()}
                    disabled={!currentThread?.currentTurnId}
                  >
                    <CircleStop size={15} />
                    Stop
                  </button>

                  <button
                    type="button"
                    className="ghost-button subtle clear-button"
                    onClick={() => void handleClear()}
                    disabled={!currentThread}
                  >
                    <Eraser size={15} />
                    Clear
                  </button>

                  <button
                    type="submit"
                    className="solid-button send-button"
                    disabled={!currentThread || isPosting || !message.trim()}
                  >
                    <SendHorizonal size={16} />
                    {isPosting ? "Sending..." : "Send"}
                  </button>
                </div>
              </form>
            </section>

            <section className="sidebar-panel sidebar-account-panel">
              <div className="section-head section-head-compact tight">
                <div className="panel-title">
                  <Gauge size={15} />
                  <h2>Quota</h2>
                </div>
                <span className="meta-tag">{account?.planLabel ?? "..."}</span>
              </div>

              <div className="quota-row">
                <div className="quota-pill">
                  <span>5h</span>
                  <strong className="account-value-ok">{account?.remaining5hLabel ?? "Loading..."}</strong>
                </div>
                <div className="quota-pill">
                  <span>reset</span>
                  <strong>{account?.reset5hLabel ?? "Loading..."}</strong>
                </div>
                <div className="quota-pill">
                  <span>7d</span>
                  <strong className="account-value-ok">{account?.remaining7dLabel ?? "Loading..."}</strong>
                </div>
                <div className="quota-pill">
                  <span>reset</span>
                  <strong>{account?.reset7dLabel ?? "Loading..."}</strong>
                </div>
              </div>
            </section>

            <section className="sidebar-panel sidebar-status-panel">
              <div className={`status-pill status-${currentThread?.liveStatus.tone ?? "idle"}`}>
                {isBusy ? <LoaderCircle size={16} className="spin" /> : <SquarePen size={15} />}
                <strong>{currentThread?.liveStatus.label ?? "Ready"}</strong>
                <span>{currentThread?.liveStatus.detail ?? "Select or create a session."}</span>
              </div>
            </section>

            {error ? <section className="error-box">{error}</section> : null}
          </div>
        </aside>
      </main>

      {isCreateModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsCreateModalOpen(false)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>New session</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setIsCreateModalOpen(false)}
                aria-label="Close modal"
              >
                <CircleX size={16} />
              </button>
            </div>

            <p className="modal-copy">
              Leave the title empty to use an excerpt of the first user message automatically.
            </p>

            <input
              value={newSessionName}
              onChange={(event) => setNewSessionName(event.target.value)}
              placeholder="Session title"
              autoFocus
            />

            <div className="modal-actions">
              <button
                type="button"
                className="ghost-button subtle"
                onClick={() => setIsCreateModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="solid-button"
                onClick={() => void handleCreateSession()}
                disabled={isCreating}
              >
                <Plus size={16} />
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isActivityOpen ? (
        <div className="modal-backdrop" onClick={() => setIsActivityOpen(false)}>
          <section className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Activity</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setIsActivityOpen(false)}
                aria-label="Close activity overlay"
              >
                <CircleX size={16} />
              </button>
            </div>

            <div className="activity-list">
              {activityMessages.length ? (
                activityMessages.map((entry) => (
                  <article key={entry.id} className="activity-card">
                    <div className="message-head">
                      <strong>{entry.title}</strong>
                      <div className="message-toolbar">
                        {isExpandable(entry.text) ? (
                          <button
                            type="button"
                            className="message-icon-button"
                            onClick={() => toggleMessageExpanded(entry.id)}
                            aria-label={expandedMessages[entry.id] ? "Collapse activity" : "Expand activity"}
                          >
                            {expandedMessages[entry.id] ? <Minimize2 size={14} /> : <Expand size={14} />}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="message-icon-button"
                          onClick={() => void handleCopyMessage(entry.id, entry.text)}
                          aria-label="Copy activity"
                        >
                          <Copy size={14} />
                        </button>
                        {entry.status ? <span>{entry.status}</span> : null}
                      </div>
                    </div>
                    <div className={`markdown-message ${expandedMessages[entry.id] ? "expanded" : ""}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.text}</ReactMarkdown>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state compact-empty">
                  <p>No activity details for this conversation.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {isConfigOpen ? (
        <div className="modal-backdrop" onClick={() => setIsConfigOpen(false)}>
          <section className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Codex config</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setIsConfigOpen(false)}
                aria-label="Close config overlay"
              >
                <CircleX size={16} />
              </button>
            </div>

            <p className="modal-copy">
              {configPath || "~/.codex/config.toml"}
            </p>

            <div className="config-toolbar">
              <button
                type="button"
                className="ghost-button subtle"
                onClick={() => setConfigDraft((current) => applyPermissiveCodexPreset(current))}
              >
                Apply full access preset
              </button>
            </div>

            <textarea
              className="config-editor"
              value={configDraft}
              onChange={(event) => setConfigDraft(event.target.value)}
              spellCheck={false}
            />

            <div className="modal-actions">
              <button
                type="button"
                className="ghost-button subtle"
                onClick={() => void handleSaveConfig(false)}
                disabled={isConfigSaving}
              >
                Save
              </button>
              <button
                type="button"
                className="solid-button"
                onClick={() => void handleSaveConfig(true)}
                disabled={isConfigSaving}
              >
                <Settings2 size={16} />
                {isConfigSaving ? "Saving..." : "Save + Relaunch Codex"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
