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
  LoaderCircle,
  MessageSquareMore,
  Palette,
  Plus,
  RefreshCw,
  SendHorizonal,
  SquarePen,
  Sparkles
} from "lucide-react";
import type { BootstrapResponse, SessionDetail, SessionSummary, Theme } from "./types";

const THEMES: Theme[] = [
  {
    id: "atelier",
    label: "Atelier Signal",
    description: "Blanc cassé, rouge brique et vert sauge."
  },
  {
    id: "nocturne",
    label: "Nocturne Grid",
    description: "Bleu nuit, laiton et brume froide."
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

  const scrollRef = useRef<HTMLDivElement | null>(null);
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

  async function loadThread(threadId: string, options?: { preserveError?: boolean }) {
    const data = await fetchJson<{ thread: SessionDetail }>(`/api/sessions/${threadId}`);
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
      setCurrentThread(data.selectedThread);
      if (data.selectedThread) {
        localStorage.setItem(THREAD_KEY, data.selectedThread.summary.id);
      }
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
      return;
    }

    const interval = window.setInterval(() => {
      void Promise.all([loadThread(selectedThreadId, { preserveError: true }), refreshSessions()]).catch(() => {
        return;
      });
    }, 5000);

    return () => window.clearInterval(interval);
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
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const previous = lastScrollStateRef.current;
    const nextCount = conversationMessages.length;
    const threadChanged = previous.threadId !== selectedThreadId;
    const countIncreased = nextCount > previous.count;

    if (!threadChanged && !countIncreased) {
      lastScrollStateRef.current = {
        threadId: selectedThreadId,
        count: nextCount
      };
      return;
    }

    if (typeof element.scrollTo === "function") {
      element.scrollTo({
        top: element.scrollHeight,
        behavior: threadChanged ? "auto" : "smooth"
      });
    } else {
      element.scrollTop = element.scrollHeight;
    }

    lastScrollStateRef.current = {
      threadId: selectedThreadId,
      count: nextCount
    };
  }, [selectedThreadId, conversationMessages.length]);

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
    </div>
  );
}

export default App;
