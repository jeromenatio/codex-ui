import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleStop,
  CircleX,
  Copy,
  Download,
  Expand,
  File,
  FileCode2,
  FileText,
  Files as FilesIcon,
  FolderOpen,
  Folder,
  Minimize2,
  MessagesSquare,
  Eraser,
  FolderKanban,
  Gauge,
  Image,
  LoaderCircle,
  MessageSquareMore,
  Palette,
  Plus,
  RefreshCw,
  SendHorizonal,
  Settings2,
  SquarePen,
  Sparkles,
  TriangleAlert,
  Trash2,
  UserRound
} from "lucide-react";
import type { AccountInfo, BootstrapResponse, CodexConfigInfo, SessionDetail, SessionSummary, Theme } from "./types";

const THEMES: Theme[] = [
  {
    id: "paper",
    label: "Paper Console",
    description: "Ivoire, encre et accent cyan."
  },
  {
    id: "glacier",
    label: "Glacier Grid",
    description: "Bleu froid, fond givré et séparation nette des échanges."
  },
  {
    id: "moss",
    label: "Moss Terminal",
    description: "Sauge dense, pierre claire et contraste conversationnel marqué."
  },
  {
    id: "ember",
    label: "Ember Ledger",
    description: "Argile chaude, accents cuivre et bulles fortement séparées."
  },
  {
    id: "rose",
    label: "Rose Signal",
    description: "Rosé pâle, prune sèche et hiérarchie plus éditoriale."
  },
  {
    id: "solar",
    label: "Solar Draft",
    description: "Crème lumineuse, safran franc et lecture très découpée."
  },
  {
    id: "cobalt",
    label: "Cobalt Frame",
    description: "Bleu net, gris clair et rendu plus graphique."
  },
  {
    id: "mono",
    label: "Mono Slate",
    description: "Quasi monochrome, graphite marqué et contraste sobre."
  }
];

const THREAD_KEY = "codex-ui-current-thread";
const THEME_KEY = "codex-ui-theme";
const QUICK_PROMPTS_KEY = "codex-ui-quick-prompts";
const DEFAULT_THEME = "paper";

type AppPage = "chat" | "files";
type FileTreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  extension: string | null;
};
type FileTreeResponse = {
  path: string;
  entries: FileTreeEntry[];
};
type FileContentResponse = {
  path: string;
  name: string;
  content: string;
};
type NotificationKind = "error" | "warning" | "info" | "success";
type AppNotification = {
  id: number;
  kind: NotificationKind;
  message: string;
};
type QuickPrompt = {
  id: string;
  title: string;
  content: string;
};

const DEFAULT_QUICK_PROMPTS: QuickPrompt[] = [
  { id: "commit-push", title: "Commit et push", content: "Commit et push stp" },
  { id: "restart-server", title: "Relance le serveur", content: "Relance le serveur stp" },
  { id: "build-check", title: "Build", content: "Lance un build et dis-moi s'il y a des erreurs" }
];

function notificationIcon(kind: NotificationKind) {
  switch (kind) {
    case "error":
      return <CircleX size={15} />;
    case "warning":
      return <TriangleAlert size={15} />;
    case "success":
      return <BadgeCheck size={15} />;
    case "info":
    default:
      return <AlertTriangle size={15} />;
  }
}

function pageFromPathname(pathname: string): AppPage {
  return pathname === "/files" ? "files" : "chat";
}

function pathFromPage(page: AppPage) {
  return page === "files" ? "/files" : "/";
}

function resolveTheme(themeId: string | null) {
  return THEMES.some((theme) => theme.id === themeId) ? themeId! : DEFAULT_THEME;
}

function loadQuickPrompts() {
  try {
    const raw = window.localStorage.getItem(QUICK_PROMPTS_KEY);
    if (!raw) {
      return DEFAULT_QUICK_PROMPTS;
    }

    const parsed = JSON.parse(raw) as QuickPrompt[];
    if (!Array.isArray(parsed)) {
      return DEFAULT_QUICK_PROMPTS;
    }

    const valid = parsed.filter(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.title === "string" &&
        typeof entry.content === "string" &&
        entry.title.trim() &&
        entry.content.trim()
    );

    return valid.length ? valid : DEFAULT_QUICK_PROMPTS;
  } catch {
    return DEFAULT_QUICK_PROMPTS;
  }
}

function parentDirectory(filePath: string) {
  const segments = filePath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "";
  }

  return segments.slice(0, -1).join("/");
}

function projectLabel(filePath: string) {
  return filePath ? `/projects/${filePath}` : "/projects";
}

function isImageExtension(extension: string | null) {
  return Boolean(extension && ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(extension));
}

function isCodeExtension(extension: string | null) {
  return Boolean(
    extension &&
      [
        "ts",
        "tsx",
        "js",
        "jsx",
        "json",
        "css",
        "scss",
        "html",
        "md",
        "mjs",
        "cjs",
        "yml",
        "yaml",
        "toml",
        "sh",
        "py",
        "rb",
        "go",
        "rs",
        "java",
        "php"
      ].includes(extension)
  );
}

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

function messageIdentityIcon(role: "user" | "assistant" | "system") {
  if (role === "user") {
    return <UserRound size={14} />;
  }

  if (role === "assistant") {
    return <Bot size={14} />;
  }

  return null;
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

function fileEntryIcon(entry: FileTreeEntry, isOpen: boolean) {
  if (entry.type === "directory") {
    return isOpen ? <FolderOpen size={15} /> : <Folder size={15} />;
  }

  if (isImageExtension(entry.extension)) {
    return <Image size={15} />;
  }

  if (isCodeExtension(entry.extension)) {
    return <FileCode2 size={15} />;
  }

  if (entry.extension === "md" || entry.extension === "txt") {
    return <FileText size={15} />;
  }

  return <File size={15} />;
}

function App() {
  const [activePage, setActivePage] = useState<AppPage>(() => pageFromPathname(window.location.pathname));
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentThread, setCurrentThread] = useState<SessionDetail | null>(null);
  const [message, setMessage] = useState("");
  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionPath, setNewSessionPath] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPosting, setIsPosting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [theme, setTheme] = useState<string>(DEFAULT_THEME);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [configDraft, setConfigDraft] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isConfigSaving, setIsConfigSaving] = useState(false);
  const [isSessionsOverlayOpen, setIsSessionsOverlayOpen] = useState(false);
  const [isQuickPromptsOpen, setIsQuickPromptsOpen] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>(() => loadQuickPrompts());
  const [editingQuickPromptId, setEditingQuickPromptId] = useState<string | null>(null);
  const [quickPromptTitle, setQuickPromptTitle] = useState("");
  const [quickPromptContent, setQuickPromptContent] = useState("");
  const [fileTree, setFileTree] = useState<Record<string, FileTreeEntry[]>>({});
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>({});
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectedFileContent, setSelectedFileContent] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("Select a file");
  const [isFileTreeLoading, setIsFileTreeLoading] = useState(false);
  const [isFileContentLoading, setIsFileContentLoading] = useState(false);
  const [isFileContentCopied, setIsFileContentCopied] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<FileTreeEntry | null>(null);
  const [includeEnvInArchive, setIncludeEnvInArchive] = useState(false);
  const [isArchiveDownloading, setIsArchiveDownloading] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingAutoScrollRef = useRef(false);
  const scrollTimerRef = useRef<number | null>(null);
  const notificationIdRef = useRef(1);
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

  function notify(kind: NotificationKind, message: string) {
    const id = notificationIdRef.current++;
    setNotifications((previous) => [...previous, { id, kind, message }]);
    window.setTimeout(() => {
      setNotifications((previous) => previous.filter((entry) => entry.id !== id));
    }, 4200);
  }

  function notifyError(message: string) {
    notify("error", message);
  }

  function notifyWarning(message: string) {
    notify("warning", message);
  }

  function notifyInfo(message: string) {
    notify("info", message);
  }

  function notifySuccess(message: string) {
    notify("success", message);
  }

  function dismissNotification(notificationId: number) {
    setNotifications((previous) => previous.filter((entry) => entry.id !== notificationId));
  }

  function setError(nextError: string | null) {
    if (nextError) {
      notifyError(nextError);
    }
  }

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

  async function loadFolderTree(folderPath: string, options?: { markOpen?: boolean }) {
    const search = folderPath ? `?path=${encodeURIComponent(folderPath)}` : "";
    if (!folderPath) {
      setIsFileTreeLoading(true);
    } else {
      setLoadingFolders((previous) => ({ ...previous, [folderPath]: true }));
    }

    try {
      const data = await fetchJson<FileTreeResponse>(`/api/files/tree${search}`);
      setFileTree((previous) => ({ ...previous, [data.path]: data.entries }));
      if (options?.markOpen) {
        setOpenFolders((previous) => ({ ...previous, [data.path]: true }));
      }
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load the file tree.");
    } finally {
      if (!folderPath) {
        setIsFileTreeLoading(false);
      } else {
        setLoadingFolders((previous) => ({ ...previous, [folderPath]: false }));
      }
    }
  }

  async function loadFileContent(filePath: string) {
    setIsFileContentLoading(true);
    setSelectedFilePath(filePath);
    setIsFileContentCopied(false);

    try {
      const data = await fetchJson<FileContentResponse>(`/api/files/content?path=${encodeURIComponent(filePath)}`);
      setSelectedFileName(data.name);
      setSelectedFileContent(data.content);
      setError(null);
    } catch (nextError) {
      setSelectedFileName(filePath.split("/").pop() || "Unknown file");
      setSelectedFileContent("");
      setError(nextError instanceof Error ? nextError.message : "Unable to load the selected file.");
    } finally {
      setIsFileContentLoading(false);
    }
  }

  function closeFolderBranch(folderPath: string) {
    setOpenFolders((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => key !== folderPath && !key.startsWith(`${folderPath}/`)))
    );
  }

  async function handleFolderToggle(folderPath: string) {
    const currentlyOpen = Boolean(openFolders[folderPath]);
    const parent = parentDirectory(folderPath);
    const siblingEntries = fileTree[parent] ?? [];

    if (currentlyOpen) {
      closeFolderBranch(folderPath);
      return;
    }

    const siblingFolders = siblingEntries.filter((entry) => entry.type === "directory").map((entry) => entry.path);
    setOpenFolders((previous) => {
      const next = { ...previous };
      for (const siblingPath of siblingFolders) {
        if (siblingPath !== folderPath) {
          delete next[siblingPath];
          for (const key of Object.keys(next)) {
            if (key.startsWith(`${siblingPath}/`)) {
              delete next[key];
            }
          }
        }
      }

      next[folderPath] = true;
      return next;
    });

    if (!fileTree[folderPath]) {
      await loadFolderTree(folderPath, { markOpen: true });
    }
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
    const storedTheme = resolveTheme(localStorage.getItem(THEME_KEY));
    setTheme(storedTheme);
  }, []);

  useEffect(() => {
    const resolvedTheme = resolveTheme(theme);
    if (resolvedTheme !== theme) {
      setTheme(resolvedTheme);
      return;
    }

    localStorage.setItem(THEME_KEY, resolvedTheme);
    document.documentElement.dataset.theme = resolvedTheme;
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(QUICK_PROMPTS_KEY, JSON.stringify(quickPrompts));
  }, [quickPrompts]);

  useEffect(() => {
    if (activePage !== "files" || fileTree[""]) {
      return;
    }

    void loadFolderTree("");
  }, [activePage, fileTree]);

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
    if (!isCreateModalOpen) {
      return;
    }

    setNewSessionPath((current) => current || currentThread?.summary.cwd || "/projects/codex-ui");
  }, [currentThread?.summary.cwd, isCreateModalOpen]);

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
  }, [selectedThreadId, conversationMessages.length, isLoading, activePage]);

  async function handleCreateSession() {
    setIsCreating(true);
    try {
      const data = await fetchJson<{ thread: SessionDetail }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: newSessionName.trim() || null,
          cwd: newSessionPath.trim() || null
        })
      });

      setCurrentThread(data.thread);
      setNewSessionName("");
      setNewSessionPath(data.thread.summary.cwd);
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

  async function submitMessageText(submitted: string) {
    if (!currentThread || !submitted.trim()) {
      if (!currentThread) {
        notifyWarning("Select a session before sending a quick prompt.");
      }
      return;
    }

    const nextMessage = submitted.trim();
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
                text: nextMessage,
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
        body: JSON.stringify({ text: nextMessage })
      });
      await refreshSessions();
      setError(null);
    } catch (nextError) {
      setMessage(nextMessage);
      setError(nextError instanceof Error ? nextError.message : "Unable to send the message.");
      await loadThread(currentThread.summary.id, { preserveError: true });
    } finally {
      setIsPosting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitMessageText(message);
  }

  async function handleStop() {
    if (!currentThread) {
      return;
    }

    try {
      setCurrentThread((previous) =>
        previous
          ? {
              ...previous,
              liveStatus: {
                ...previous.liveStatus,
                tone: "waiting",
                label: "Stopping",
                detail: "Interrupt requested.",
                updatedAt: Date.now()
              }
            }
          : previous
      );
      await fetchJson(`/api/sessions/${currentThread.summary.id}/stop`, {
        method: "POST"
      });
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to stop the current turn.");
    }
  }

  function handleClear() {
    setMessage("");
    setError(null);
  }

  function resetQuickPromptEditor() {
    setEditingQuickPromptId(null);
    setQuickPromptTitle("");
    setQuickPromptContent("");
  }

  function handleEditQuickPrompt(prompt: QuickPrompt) {
    setEditingQuickPromptId(prompt.id);
    setQuickPromptTitle(prompt.title);
    setQuickPromptContent(prompt.content);
  }

  function handleSaveQuickPrompt() {
    const title = quickPromptTitle.trim();
    const content = quickPromptContent.trim();

    if (!title || !content) {
      notifyWarning("A quick prompt needs a title and a message.");
      return;
    }

    if (editingQuickPromptId) {
      setQuickPrompts((previous) =>
        previous.map((entry) => (entry.id === editingQuickPromptId ? { ...entry, title, content } : entry))
      );
      notifySuccess("Quick prompt updated.");
    } else {
      setQuickPrompts((previous) => [...previous, { id: `prompt-${Date.now()}`, title, content }]);
      notifySuccess("Quick prompt created.");
    }

    resetQuickPromptEditor();
  }

  function handleDeleteQuickPrompt(promptId: string) {
    setQuickPrompts((previous) => previous.filter((entry) => entry.id !== promptId));
    if (editingQuickPromptId === promptId) {
      resetQuickPromptEditor();
    }
    notifyInfo("Quick prompt removed.");
  }

  function handleMoveQuickPrompt(promptId: string, direction: -1 | 1) {
    setQuickPrompts((previous) => {
      const currentIndex = previous.findIndex((entry) => entry.id === promptId);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= previous.length) {
        return previous;
      }

      const next = [...previous];
      const [item] = next.splice(currentIndex, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  function handleInsertQuickPrompt(content: string) {
    setMessage((current) => (current.trim() ? `${current.trim()}\n\n${content}` : content));
    setIsQuickPromptsOpen(false);
    notifyInfo("Quick prompt inserted into the composer.");
  }

  async function handleSendQuickPrompt(content: string) {
    setIsQuickPromptsOpen(false);
    await submitMessageText(content);
  }

  async function handleCopyMessage(messageId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      notifySuccess("Message copied.");
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1200);
    } catch {
      setError("Unable to copy message.");
    }
  }

  function extractCodeText(children: ReactNode): string {
    if (typeof children === "string") {
      return children.replace(/\n$/, "");
    }

    if (typeof children === "number") {
      return String(children);
    }

    if (Array.isArray(children)) {
      return children.map(extractCodeText).join("").replace(/\n$/, "");
    }

    if (children && typeof children === "object" && "props" in children) {
      return extractCodeText((children as { props?: { children?: ReactNode } }).props?.children);
    }

    return "";
  }

  async function handleCopyCode(codeId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCodeId(codeId);
      notifySuccess("Code block copied.");
      window.setTimeout(() => {
        setCopiedCodeId((current) => (current === codeId ? null : current));
      }, 1200);
    } catch {
      setError("Unable to copy code block.");
    }
  }

  async function handleCopySelectedFile() {
    if (!selectedFilePath || !selectedFileContent) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedFileContent);
      setIsFileContentCopied(true);
      notifySuccess("File content copied.");
      window.setTimeout(() => {
        setIsFileContentCopied(false);
      }, 1200);
    } catch {
      setError("Unable to copy file content.");
    }
  }

  async function handleDownloadArchive() {
    if (!archiveTarget) {
      return;
    }

    setIsArchiveDownloading(true);

    try {
      const response = await fetch("/api/files/archive", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: archiveTarget.path,
          includeEnv: includeEnvInArchive
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Unable to create archive." }));
        throw new Error(error.error ?? "Unable to create archive.");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const fileName = `${archiveTarget.name}.zip`;

      anchor.href = downloadUrl;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setArchiveTarget(null);
      setIncludeEnvInArchive(false);
      notifySuccess("Archive download started.");
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to download archive.");
    } finally {
      setIsArchiveDownloading(false);
    }
  }

  function renderMarkdown(text: string) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre(props) {
            const { children } = props as { children?: ReactNode };
            const firstChild = Array.isArray(children) ? children[0] : children;
            const className =
              firstChild && typeof firstChild === "object" && "props" in firstChild
                ? ((firstChild as { props?: { className?: string } }).props?.className ?? "")
                : "";
            const codeText = extractCodeText(children);
            const language = className.replace("language-", "") || "";
            const codeId = `${language}:${codeText.slice(0, 80)}`;

            return (
              <div className="code-block">
                <div className="code-block-toolbar">
                  <span>{language || "code"}</span>
                  <button
                    type="button"
                    className="message-icon-button"
                    onClick={() => void handleCopyCode(codeId, codeText)}
                    aria-label="Copy code block"
                    title={copiedCodeId === codeId ? "Copied" : "Copy code"}
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <pre>{children}</pre>
              </div>
            );
          },
          code(props) {
            const { className, children, ...rest } = props as {
              className?: string;
              children?: ReactNode;
            };

            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          }
        }}
      >
        {text}
      </ReactMarkdown>
    );
  }

  function toggleMessageExpanded(messageId: string) {
    setExpandedMessages((previous) => ({
      ...previous,
      [messageId]: !previous[messageId]
    }));
  }

  function renderFileTree(folderPath = "", level = 0): ReactNode {
    const entries = fileTree[folderPath] ?? [];

    return entries.map((entry) => {
      const isDirectory = entry.type === "directory";
      const isOpen = Boolean(openFolders[entry.path]);
      const isSelected = !isDirectory && selectedFilePath === entry.path;
      const isLoading = Boolean(loadingFolders[entry.path]);

      return (
        <div key={entry.path} className="file-tree-node">
          <div className={`file-tree-row ${isSelected ? "active" : ""}`} style={{ paddingLeft: `${12 + level * 18}px` }}>
            <button
              type="button"
              className="file-tree-main"
              onClick={() => {
                if (isDirectory) {
                  void handleFolderToggle(entry.path);
                  return;
                }

                void loadFileContent(entry.path);
              }}
            >
              <span className="file-tree-caret">
                {isDirectory ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
              </span>
              <span className="file-tree-icon">{fileEntryIcon(entry, isOpen)}</span>
              <span className="file-tree-label">{entry.name}</span>
            </button>

            {isDirectory ? (
              <button
                type="button"
                className="file-tree-action"
                onClick={() => {
                  setArchiveTarget(entry);
                  setIncludeEnvInArchive(false);
                }}
                aria-label={`Download ${entry.name} as zip`}
                title="Download zip"
              >
                <Download size={14} />
              </button>
            ) : null}

            {isLoading ? <LoaderCircle size={14} className="spin" /> : null}
          </div>

          {isDirectory && isOpen ? <div className="file-tree-children">{renderFileTree(entry.path, level + 1)}</div> : null}
        </div>
      );
    });
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
      notifySuccess(restart ? "Config saved and Codex relaunched." : "Config saved.");
      setIsConfigOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save Codex config.");
    } finally {
      setIsConfigSaving(false);
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await bootstrap();
    } finally {
      setIsRefreshing(false);
    }
  }

  function handlePageChange(page: AppPage) {
    const nextPath = pathFromPage(page);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    if (page === "chat" && currentThread && conversationMessages.length > 0) {
      pendingAutoScrollRef.current = true;
    }
    setActivePage(page);
  }

  async function handleDeleteSession(session: SessionSummary) {
    const confirmed = window.confirm(`Delete session "${deriveSessionTitle(session)}" ?`);
    if (!confirmed) {
      return;
    }

    setDeletingSessionId(session.id);

    try {
      const data = await fetchJson<{ sessions: SessionSummary[]; selectedThread: SessionDetail | null }>(
        `/api/sessions/${session.id}`,
        { method: "DELETE" }
      );

      setSessions(data.sessions);
      setCurrentThread(data.selectedThread);

      if (data.selectedThread) {
        localStorage.setItem(THREAD_KEY, data.selectedThread.summary.id);
      } else {
        localStorage.removeItem(THREAD_KEY);
      }

      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete this session.");
    } finally {
      setDeletingSessionId(null);
    }
  }

  useEffect(() => {
    const handlePopState = () => {
      const nextPage = pageFromPathname(window.location.pathname);
      if (nextPage === "chat" && currentThread && conversationMessages.length > 0) {
        pendingAutoScrollRef.current = true;
      }
      setActivePage(nextPage);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [conversationMessages.length, currentThread]);

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
          <div className="topbar-nav" aria-label="App pages">
            <button
              type="button"
              className={`ghost-button nav-button ${activePage === "chat" ? "active" : ""}`}
              onClick={() => handlePageChange("chat")}
            >
              <MessagesSquare size={16} />
              Chat
            </button>
            <button
              type="button"
              className={`ghost-button nav-button ${activePage === "files" ? "active" : ""}`}
              onClick={() => handlePageChange("files")}
            >
              <FilesIcon size={16} />
              Files
            </button>
          </div>

          <button className="ghost-button" type="button" onClick={() => void handleOpenConfig()}>
            <Settings2 size={16} />
            Configs
          </button>

          <button className="ghost-button" type="button" onClick={() => setIsSessionsOverlayOpen(true)}>
            <FolderOpen size={16} />
            Sessions
          </button>

          <label className="theme-switcher">
            <Palette size={16} />
            <select
              value={theme}
              onChange={(event) => {
                setTheme(event.target.value);
                event.target.blur();
              }}
            >
              {THEMES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <button className="ghost-button" type="button" onClick={() => void handleRefresh()} disabled={isRefreshing}>
            <RefreshCw size={16} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </nav>

      {activePage === "chat" ? (
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
                      <strong className="message-title">
                        {messageIdentityIcon(entry.role)}
                        <span>{entry.title}</span>
                      </strong>
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
                      </div>
                    </div>
                    <div className={`markdown-message ${expandedMessages[entry.id] ? "expanded" : ""}`}>
                      {renderMarkdown(entry.text)}
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

            <section className="sidebar-panel composer-panel">
              <div className="section-head section-head-compact tight">
                <div className="panel-title">
                  <SquarePen size={15} />
                  <h2>Composer</h2>
                </div>
                <button
                  type="button"
                  className="ghost-button subtle"
                  onClick={() => setIsQuickPromptsOpen(true)}
                >
                  <MessageSquareMore size={15} />
                  Quick prompts
                </button>
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
                    disabled={!currentThread || (!currentThread.currentTurnId && !isBusy)}
                  >
                    <CircleStop size={15} />
                    Stop
                  </button>

                  <button
                    type="button"
                    className="ghost-button subtle clear-button"
                    onClick={handleClear}
                    disabled={!message}
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

          </div>
        </aside>
        </main>
      ) : (
        <main className="files-layout">
          <section className="file-viewer-column">
            <div className="section-head section-head-compact tight">
              <div className="panel-title">
                <FileText size={15} />
                <h2>Viewer</h2>
              </div>
              <span className="meta-tag">{projectLabel(selectedFilePath)}</span>
            </div>

            <div className="file-viewer-panel">
              <div className="file-viewer-meta">
                <strong>{selectedFileName}</strong>
                <button
                  type="button"
                  className="ghost-button subtle"
                  onClick={() => void handleCopySelectedFile()}
                  disabled={!selectedFilePath || !selectedFileContent}
                >
                  <Copy size={15} />
                  {isFileContentCopied ? "Copied" : "Copy"}
                </button>
              </div>

              {isFileContentLoading ? (
                <div className="empty-state">
                  <LoaderCircle size={18} className="spin" />
                  <p>Loading file...</p>
                </div>
              ) : selectedFilePath ? (
                <pre className="file-viewer-content">{selectedFileContent}</pre>
              ) : (
                <div className="empty-state">
                  <FilesIcon size={22} />
                  <p>Select a file from the tree to preview it.</p>
                </div>
              )}
            </div>
          </section>

          <aside className="file-tree-column">
            <section className="file-tree-panel">
              <div className="section-head section-head-compact tight">
                <div className="panel-title">
                  <FolderKanban size={15} />
                  <h2>Projects</h2>
                </div>
                <span className="meta-tag">/projects</span>
              </div>

              <div className="file-tree-list">
                {isFileTreeLoading ? (
                  <div className="empty-state compact-empty">
                    <LoaderCircle size={18} className="spin" />
                    <p>Loading file tree...</p>
                  </div>
                ) : (
                  renderFileTree()
                )}
              </div>
            </section>
          </aside>
        </main>
      )}

      {archiveTarget ? (
        <div className="modal-backdrop" onClick={() => setArchiveTarget(null)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Download folder as zip</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setArchiveTarget(null)}
                aria-label="Close archive modal"
              >
                <CircleX size={16} />
              </button>
            </div>

            <p className="modal-copy">
              Download <strong>{archiveTarget.name}</strong> as a zip archive. `node_modules` is always excluded.
            </p>

            <label className="archive-checkbox">
              <input
                type="checkbox"
                checked={includeEnvInArchive}
                onChange={(event) => setIncludeEnvInArchive(event.target.checked)}
              />
              <span>Include `.env` files in the zip</span>
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="ghost-button subtle"
                onClick={() => setArchiveTarget(null)}
                disabled={isArchiveDownloading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="solid-button"
                onClick={() => void handleDownloadArchive()}
                disabled={isArchiveDownloading}
              >
                <Download size={16} />
                {isArchiveDownloading ? "Preparing..." : "Download zip"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {notifications.length ? (
        <div className="notification-stack" aria-live="polite" aria-label="Notifications">
          {notifications.map((notification) => (
            <article key={notification.id} className={`notification-card notification-${notification.kind}`}>
              <div className="notification-icon">{notificationIcon(notification.kind)}</div>
              <p>{notification.message}</p>
              <button
                type="button"
                className="message-icon-button"
                onClick={() => dismissNotification(notification.id)}
                aria-label="Dismiss notification"
              >
                <CircleX size={14} />
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {isQuickPromptsOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setIsQuickPromptsOpen(false);
            resetQuickPromptEditor();
          }}
        >
          <section className="modal-card modal-card-wide quick-prompts-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Quick prompts</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => {
                  setIsQuickPromptsOpen(false);
                  resetQuickPromptEditor();
                }}
                aria-label="Close modal"
              >
                <CircleX size={16} />
              </button>
            </div>

            <p className="modal-copy">
              Create reusable messages, insert them into the composer, or send them immediately.
            </p>

            <div className="quick-prompts-layout">
              <div className="quick-prompts-list">
                {quickPrompts.map((prompt, index) => (
                  <article key={prompt.id} className="quick-prompt-row">
                    <div className="quick-prompt-copy">
                      <strong>{prompt.title}</strong>
                      <span>{prompt.content}</span>
                    </div>

                    <div className="quick-prompt-toolbar">
                      <button
                        type="button"
                        className="ghost-button subtle icon-button"
                        onClick={() => handleMoveQuickPrompt(prompt.id, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${prompt.title} up`}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        className="ghost-button subtle icon-button"
                        onClick={() => handleMoveQuickPrompt(prompt.id, 1)}
                        disabled={index === quickPrompts.length - 1}
                        aria-label={`Move ${prompt.title} down`}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        type="button"
                        className="ghost-button subtle"
                        onClick={() => handleInsertQuickPrompt(prompt.content)}
                      >
                        Insert
                      </button>
                      <button
                        type="button"
                        className="ghost-button subtle"
                        onClick={() => void handleSendQuickPrompt(prompt.content)}
                        disabled={!currentThread || isPosting}
                      >
                        Send now
                      </button>
                      <button
                        type="button"
                        className="ghost-button subtle"
                        onClick={() => handleEditQuickPrompt(prompt)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost-button subtle danger"
                        onClick={() => handleDeleteQuickPrompt(prompt.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}

                {!quickPrompts.length ? (
                  <div className="empty-state compact-empty">
                    <p>No quick prompts yet.</p>
                  </div>
                ) : null}
              </div>

              <div className="quick-prompts-editor">
                <div className="section-head section-head-compact tight">
                  <div className="panel-title">
                    <Sparkles size={15} />
                    <h2>{editingQuickPromptId ? "Edit prompt" : "New prompt"}</h2>
                  </div>
                </div>

                <input
                  value={quickPromptTitle}
                  onChange={(event) => setQuickPromptTitle(event.target.value)}
                  placeholder="Title"
                />
                <textarea
                  className="quick-prompt-textarea"
                  value={quickPromptContent}
                  onChange={(event) => setQuickPromptContent(event.target.value)}
                  placeholder="Message content"
                />
                <div className="modal-actions">
                  <button type="button" className="ghost-button subtle" onClick={resetQuickPromptEditor}>
                    Clear
                  </button>
                  <button type="button" className="solid-button" onClick={handleSaveQuickPrompt}>
                    {editingQuickPromptId ? "Save changes" : "Add prompt"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

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

            <input
              value={newSessionPath}
              onChange={(event) => setNewSessionPath(event.target.value)}
              placeholder="/projects/my-workspace"
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

      {isSessionsOverlayOpen ? (
        <div className="modal-backdrop" onClick={() => setIsSessionsOverlayOpen(false)}>
          <section className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>Manage sessions</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setIsSessionsOverlayOpen(false)}
                aria-label="Close sessions overlay"
              >
                <CircleX size={16} />
              </button>
            </div>

            <div className="session-admin-list">
              {sessions.length ? (
                sessions.map((entry) => (
                  <article key={entry.id} className="session-admin-row">
                    <div className="session-admin-copy">
                      <strong>{deriveSessionTitle(entry)}</strong>
                      <span>
                        {formatSessionDate(entry.updatedAt)} · {entry.cwd}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="ghost-button danger"
                      onClick={() => void handleDeleteSession(entry)}
                      disabled={deletingSessionId === entry.id}
                    >
                      <Trash2 size={15} />
                      {deletingSessionId === entry.id ? "Deleting..." : "Delete"}
                    </button>
                  </article>
                ))
              ) : (
                <div className="empty-state compact-empty">
                  <p>No sessions available.</p>
                </div>
              )}
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
                      {renderMarkdown(entry.text)}
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
