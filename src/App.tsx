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
import type {
  AccountInfo,
  AvailableModel,
  BootstrapResponse,
  CodexConfigInfo,
  MessageAttachment,
  SessionDetail,
  SessionSummary,
  Theme,
  UploadedAttachment
} from "./types";
import { translate, type Locale } from "./i18n";

const THEMES: Theme[] = [
  {
    id: "paper",
    label: "theme.paper",
    description: "theme.paper"
  },
  {
    id: "glacier",
    label: "theme.glacier",
    description: "theme.glacier"
  },
  {
    id: "moss",
    label: "theme.moss",
    description: "theme.moss"
  },
  {
    id: "ember",
    label: "theme.ember",
    description: "theme.ember"
  },
  {
    id: "rose",
    label: "theme.rose",
    description: "theme.rose"
  },
  {
    id: "solar",
    label: "theme.solar",
    description: "theme.solar"
  },
  {
    id: "cobalt",
    label: "theme.cobalt",
    description: "theme.cobalt"
  },
  {
    id: "mono",
    label: "theme.mono",
    description: "theme.mono"
  }
];

const THREAD_KEY = "codex-ui-current-thread";
const THEME_KEY = "codex-ui-theme";
const QUICK_PROMPTS_KEY = "codex-ui-quick-prompts";
const LANGUAGE_KEY = "codex-ui-language";
const DEFAULT_THEME = "paper";
const DEFAULT_LANGUAGE: Locale = "en";

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
type PendingAttachment = UploadedAttachment & {
  previewUrl: string | null;
};

function isImageFile(file: File) {
  if (file.type.startsWith("image/")) {
    return true;
  }

  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}
type QuickPrompt = {
  id: string;
  title: string;
  content: string;
};

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

function resolveStoredLanguage(): Locale {
  const storedLanguage = window.localStorage.getItem(LANGUAGE_KEY);
  return storedLanguage === "en" || storedLanguage === "fr" ? storedLanguage : DEFAULT_LANGUAGE;
}

function defaultQuickPrompts(locale: Locale): QuickPrompt[] {
  return locale === "fr"
    ? [
        { id: "commit-push", title: "Commit et push", content: "Commit et push stp" },
        { id: "restart-server", title: "Relance le serveur", content: "Relance le serveur stp" },
        { id: "build-check", title: "Build", content: "Lance un build et dis-moi s'il y a des erreurs" }
      ]
    : [
        { id: "commit-push", title: "Commit and push", content: "Commit and push please" },
        { id: "restart-server", title: "Restart server", content: "Restart the server please" },
        { id: "build-check", title: "Build", content: "Run a build and tell me if there are any errors" }
      ];
}

function loadQuickPrompts(locale: Locale) {
  try {
    const raw = window.localStorage.getItem(QUICK_PROMPTS_KEY);
    if (!raw) {
      return defaultQuickPrompts(locale);
    }

    const parsed = JSON.parse(raw) as QuickPrompt[];
    if (!Array.isArray(parsed)) {
      return defaultQuickPrompts(locale);
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

    return valid.length ? valid : defaultQuickPrompts(locale);
  } catch {
    return defaultQuickPrompts(locale);
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
  const locale = typeof window !== "undefined" ? resolveStoredLanguage() : DEFAULT_LANGUAGE;
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: translate(locale, "error.unknown") }));
    throw new Error(error.error ?? translate(locale, "error.request_failed"));
  }

  return (await response.json()) as T;
}

function formatSessionDate(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(timestamp * 1000);
}

function deriveSessionTitle(
  session: Pick<SessionSummary, "name" | "preview"> | null | undefined,
  untitledLabel = translate(typeof window !== "undefined" ? resolveStoredLanguage() : DEFAULT_LANGUAGE, "session.untitled")
) {
  if (!session) {
    return untitledLabel;
  }

  const explicit = session.name?.trim();
  if (explicit) {
    return explicit;
  }

  const fallback = session.preview.replace(/\s+/g, " ").trim();
  return fallback ? fallback.slice(0, 72) : untitledLabel;
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
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionPath, setNewSessionPath] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPosting, setIsPosting] = useState(false);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [theme, setTheme] = useState<string>(() => resolveTheme(window.localStorage.getItem(THEME_KEY)));
  const [language, setLanguage] = useState<Locale>(() => resolveStoredLanguage());
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
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
  const [isModelOverlayOpen, setIsModelOverlayOpen] = useState(false);
  const [isImageOverlayOpen, setIsImageOverlayOpen] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>(() => loadQuickPrompts(resolveStoredLanguage()));
  const [editingQuickPromptId, setEditingQuickPromptId] = useState<string | null>(null);
  const [quickPromptTitle, setQuickPromptTitle] = useState("");
  const [quickPromptContent, setQuickPromptContent] = useState("");
  const [fileTree, setFileTree] = useState<Record<string, FileTreeEntry[]>>({});
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>({});
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectedFileContent, setSelectedFileContent] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [isFileTreeLoading, setIsFileTreeLoading] = useState(false);
  const [isFileContentLoading, setIsFileContentLoading] = useState(false);
  const [isFileContentCopied, setIsFileContentCopied] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<FileTreeEntry | null>(null);
  const [includeEnvInArchive, setIncludeEnvInArchive] = useState(false);
  const [isArchiveDownloading, setIsArchiveDownloading] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(false);
  const [isModelSaving, setIsModelSaving] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingAutoScrollRef = useRef(false);
  const scrollTimerRef = useRef<number | null>(null);
  const notificationIdRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastScrollStateRef = useRef<{ threadId: string | null; count: number }>({
    threadId: null,
    count: 0
  });
  const selectedThreadId = currentThread?.summary.id ?? null;
  const selectedSessionModel =
    currentThread?.summary.model ??
    sessions.find((entry) => entry.id === selectedThreadId)?.model ??
    null;
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
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const localizedLiveStatusLabel = currentThread?.liveStatus.label
    ? localizeKnownUiText(currentThread.liveStatus.label, t)
    : t("status.ready");
  const localizedLiveStatusDetail = currentThread?.liveStatus.detail
    ? localizeKnownUiText(currentThread.liveStatus.detail, t)
    : t("status.select_session");

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

  function localizeKnownUiText(text: string, translator: typeof t) {
    const known: Record<string, string> = {
      Ready: "status.ready",
      "Prêt": "status.ready",
      "Select or create a session.": "status.select_session",
      "Sélectionne ou crée une session.": "status.select_session",
      Queued: "status.queued",
      "En file": "status.queued",
      "Message sent to Codex.": "status.message_sent",
      "Message envoyé à Codex.": "status.message_sent",
      Stopping: "status.stopping",
      "Arrêt en cours": "status.stopping",
      "Interrupt requested.": "status.interrupt_requested",
      "Interruption demandée.": "status.interrupt_requested",
      You: "message.you",
      Vous: "message.you"
    };

    const key = known[text];
    return key ? translator(key) : text;
  }

  function messageTurnId(message: SessionDetail["messages"][number]) {
    const turnId = message.meta?.turnId;
    return typeof turnId === "string" ? turnId : null;
  }

  const activityByAnchorMessageId = useMemo(() => {
    const grouped: Record<string, SessionDetail["messages"]> = {};
    if (!currentThread) {
      return grouped;
    }

    const turnBuckets = new Map<
      string,
      {
        userId: string | null;
        assistantId: string | null;
        activities: SessionDetail["messages"];
      }
    >();
    let fallbackUserId: string | null = null;

    for (const entry of currentThread.messages) {
      const isConversationEntry = entry.role === "user" || (entry.role === "assistant" && entry.phase !== "commentary");
      const turnId = messageTurnId(entry);
      const bucket =
        turnId
          ? (turnBuckets.get(turnId) ??
            (() => {
              const next = { userId: null, assistantId: null, activities: [] as SessionDetail["messages"] };
              turnBuckets.set(turnId, next);
              return next;
            })())
          : null;

      if (entry.role === "user") {
        fallbackUserId = entry.id;
        grouped[entry.id] = grouped[entry.id] ?? [];
        if (bucket) {
          bucket.userId = entry.id;
        }
        continue;
      }

      if (entry.role === "assistant" && entry.phase !== "commentary") {
        if (bucket) {
          bucket.assistantId = entry.id;
          grouped[entry.id] = grouped[entry.id] ?? [];
        }
        continue;
      }

      if (isConversationEntry) {
        continue;
      }

      if (bucket) {
        bucket.activities.push(entry);
        continue;
      }

      if (!fallbackUserId) {
        continue;
      }

      grouped[fallbackUserId] = grouped[fallbackUserId] ?? [];
      grouped[fallbackUserId].push(entry);
    }

    for (const bucket of turnBuckets.values()) {
      if (!bucket.activities.length) {
        continue;
      }

      const anchorId = bucket.assistantId ?? bucket.userId;
      if (!anchorId) {
        continue;
      }

      grouped[anchorId] = grouped[anchorId] ?? [];
      grouped[anchorId].push(...bucket.activities);
    }

    return grouped;
  }, [currentThread]);

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

  async function readFileAsBase64(file: File) {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const [, contentBase64 = ""] = result.split(",", 2);
        resolve(contentBase64);
      };
      reader.onerror = () => reject(reader.error ?? new Error(t("error.read_file")));
      reader.readAsDataURL(file);
    });
  }

  async function handleAttachmentSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    const imageFiles = files.filter(isImageFile);
    if (!imageFiles.length) {
      notifyWarning(t("notify.images_only"));
      event.target.value = "";
      return;
    }

    if (imageFiles.length !== files.length) {
      notifyInfo(t("notify.images_filtered"));
    }

    setIsUploadingAttachments(true);

    try {
      const payload = await Promise.all(
        imageFiles.map(async (file) => ({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64: await readFileAsBase64(file),
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null
        }))
      );

      const data = await fetchJson<{ attachments: UploadedAttachment[] }>("/api/attachments", {
        method: "POST",
        body: JSON.stringify({
          attachments: payload.map(({ name, mimeType, contentBase64 }) => ({ name, mimeType, contentBase64 }))
        })
      });

      setPendingAttachments((previous) => [
        ...previous,
        ...data.attachments.map((attachment, index) => ({
          ...attachment,
          previewUrl: payload[index]?.previewUrl ?? null
        }))
      ]);
      notifySuccess(t(imageFiles.length === 1 ? "notify.image_added" : "notify.images_added"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("error.add_attachments"));
    } finally {
      setIsUploadingAttachments(false);
      event.target.value = "";
    }
  }

  async function loadAvailableModels() {
    setIsModelsLoading(true);
    try {
      const data = await fetchJson<{ models: AvailableModel[] }>("/api/models");
      setAvailableModels(data.models);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("error.load_models"));
    } finally {
      setIsModelsLoading(false);
    }
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
      setError(nextError instanceof Error ? nextError.message : t("error.load_tree"));
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
      setSelectedFileName(filePath.split("/").pop() || t("error.unknown_file"));
      setSelectedFileContent("");
      setError(nextError instanceof Error ? nextError.message : t("error.load_file"));
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
      setError(nextError instanceof Error ? nextError.message : t("error.load_ui"));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void bootstrap();
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
    window.localStorage.setItem(LANGUAGE_KEY, language);
  }, [language]);

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
      pendingAttachments.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
    };
  }, [pendingAttachments]);

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
      setError(nextError instanceof Error ? nextError.message : t("error.create_session"));
    } finally {
      setIsCreating(false);
    }
  }

  async function submitMessageText(submitted: string) {
    if (!currentThread || (!submitted.trim() && !pendingAttachments.length)) {
      if (!currentThread) {
        notifyWarning(t("notify.select_session_before_prompt"));
      }
      return;
    }

    const nextMessage = submitted.trim();
    const nextAttachments = pendingAttachments;
    setMessage("");
    setPendingAttachments([]);
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
                title: t("message.you"),
                text: [nextMessage, ...nextAttachments.map((attachment) => `[${t("label.attached")}: ${attachment.name}]`)]
                  .filter(Boolean)
                  .join("\n\n"),
                attachments: nextAttachments.map((attachment) => ({
                  id: attachment.id,
                  name: attachment.name,
                  path: attachment.path,
                  mimeType: attachment.mimeType,
                  size: attachment.size,
                  kind: attachment.kind,
                  url: attachment.previewUrl ?? `/api/attachments/content?path=${encodeURIComponent(attachment.path)}`
                })),
                status: "queued"
              }
            ],
            liveStatus: {
              tone: "running",
              label: t("status.queued"),
              detail: t("status.message_sent"),
              updatedAt: Date.now()
            }
          }
        : previous
    );

    try {
      await fetchJson(`/api/sessions/${currentThread.summary.id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          text: nextMessage,
          attachments: nextAttachments.map(({ id, name, path, mimeType, size, kind }) => ({
            id,
            name,
            path,
            mimeType,
            size,
            kind
          }))
        })
      });
      await refreshSessions();
      setError(null);
    } catch (nextError) {
      setMessage(nextMessage);
      setPendingAttachments(nextAttachments);
      setError(nextError instanceof Error ? nextError.message : t("error.send_message"));
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
                label: t("status.stopping"),
                detail: t("status.interrupt_requested"),
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
      setError(nextError instanceof Error ? nextError.message : t("error.stop_turn"));
    }
  }

  function handleClear() {
    setMessage("");
    setPendingAttachments((previous) => {
      previous.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
      return [];
    });
    setIsImageOverlayOpen(false);
    setError(null);
  }

  function handleRemoveAttachment(attachmentId: string) {
    setPendingAttachments((previous) => {
      const next = previous.filter((attachment) => attachment.id !== attachmentId);
      const removed = previous.find((attachment) => attachment.id === attachmentId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return next;
    });
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
      notifyWarning(t("notify.prompt_requires_title"));
      return;
    }

    if (editingQuickPromptId) {
      setQuickPrompts((previous) =>
        previous.map((entry) => (entry.id === editingQuickPromptId ? { ...entry, title, content } : entry))
      );
      notifySuccess(t("notify.quick_prompt_updated"));
    } else {
      setQuickPrompts((previous) => [...previous, { id: `prompt-${Date.now()}`, title, content }]);
      notifySuccess(t("notify.quick_prompt_created"));
    }

    resetQuickPromptEditor();
  }

  function handleDeleteQuickPrompt(promptId: string) {
    setQuickPrompts((previous) => previous.filter((entry) => entry.id !== promptId));
    if (editingQuickPromptId === promptId) {
      resetQuickPromptEditor();
    }
    notifyInfo(t("notify.quick_prompt_removed"));
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
    notifyInfo(t("notify.quick_prompt_inserted"));
  }

  async function handleSendQuickPrompt(content: string) {
    setIsQuickPromptsOpen(false);
    await submitMessageText(content);
  }

  async function handleCopyMessage(messageId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      notifySuccess(t("notify.copied_message"));
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1200);
    } catch {
      setError(t("error.copy_message"));
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
      notifySuccess(t("notify.copied_code"));
      window.setTimeout(() => {
        setCopiedCodeId((current) => (current === codeId ? null : current));
      }, 1200);
    } catch {
      setError(t("error.copy_code"));
    }
  }

  async function handleCopySelectedFile() {
    if (!selectedFilePath || !selectedFileContent) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedFileContent);
      setIsFileContentCopied(true);
      notifySuccess(t("notify.copied_file"));
      window.setTimeout(() => {
        setIsFileContentCopied(false);
      }, 1200);
    } catch {
      setError(t("error.copy_file"));
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
        const error = await response.json().catch(() => ({ error: t("error.create_archive") }));
        throw new Error(error.error ?? t("error.create_archive"));
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
      notifySuccess(t("notify.archive_started"));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("error.download_archive"));
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
                  <span>{language || t("label.code")}</span>
                  <button
                    type="button"
                    className="message-icon-button"
                    onClick={() => void handleCopyCode(codeId, codeText)}
                    aria-label={t("aria.copy_code_block")}
                    title={copiedCodeId === codeId ? t("button.copied") : t("aria.copy_code")}
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
                aria-label={t("aria.download_zip", { name: entry.name })}
                title={t("button.download_zip")}
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

  function renderMessageAttachments(attachments: MessageAttachment[] | undefined) {
    if (!attachments?.length) {
      return null;
    }

    return (
      <div className="conversation-attachments">
        {attachments.map((attachment) => (
          <article key={attachment.id} className="conversation-attachment">
            <img src={attachment.url} alt={attachment.name} className="conversation-attachment-image" />

            <div className="conversation-attachment-copy">
              <strong>{attachment.name}</strong>
              <span>{attachment.mimeType || t("label.image")}</span>
            </div>

            <a
              className="ghost-button subtle"
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
            >
              {t("button.open")}
            </a>
          </article>
        ))}
      </div>
    );
  }

  function renderInlineActivity(anchorMessageId: string) {
    const activities = activityByAnchorMessageId[anchorMessageId] ?? [];
    if (!activities.length) {
      return null;
    }

    const isExpanded = Boolean(expandedMessages[`activity:${anchorMessageId}`]);

    return (
      <div className="inline-activity">
        <button
          type="button"
          className="ghost-button subtle inline-activity-toggle"
          onClick={() => toggleMessageExpanded(`activity:${anchorMessageId}`)}
        >
          <Activity size={15} />
          {t("button.activity")}
          <span className="meta-tag">{t("label.activity_count", { count: activities.length })}</span>
        </button>

        {isExpanded ? (
          <div className="activity-list inline-activity-list">
            {activities.map((entry) => (
              <article key={entry.id} className="activity-card">
                <div className="message-head">
                  <strong>{localizeKnownUiText(entry.title, t)}</strong>
                  <div className="message-toolbar">
                    {isExpandable(entry.text) ? (
                      <button
                        type="button"
                        className="message-icon-button"
                        onClick={() => toggleMessageExpanded(entry.id)}
                        aria-label={expandedMessages[entry.id] ? t("aria.collapse_activity") : t("aria.expand_activity")}
                      >
                        {expandedMessages[entry.id] ? <Minimize2 size={14} /> : <Expand size={14} />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="message-icon-button"
                      onClick={() => void handleCopyMessage(entry.id, entry.text)}
                      aria-label={t("aria.copy_activity")}
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
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  async function handleOpenConfig() {
    await refreshConfig();
    setIsConfigOpen(true);
  }

  async function handleOpenModelOverlay() {
    if (!currentThread) {
      return;
    }

    setIsModelOverlayOpen(true);
    if (!availableModels.length) {
      await loadAvailableModels();
    }
  }

  async function handleChangeSessionModel(model: string) {
    if (!currentThread) {
      return;
    }

    setIsModelSaving(true);
    try {
      const data = await fetchJson<{ thread: SessionDetail; sessions: SessionSummary[] }>(
        `/api/sessions/${currentThread.summary.id}/model`,
        {
          method: "POST",
          body: JSON.stringify({ model })
        }
      );
      setCurrentThread(data.thread);
      setSessions(data.sessions);
      notifySuccess(t("notify.model_changed", { model }));
      setIsModelOverlayOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("error.change_model"));
    } finally {
      setIsModelSaving(false);
    }
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
      notifySuccess(restart ? t("notify.config_saved_relaunched") : t("notify.config_saved"));
      setIsConfigOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("error.save_config"));
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
    const confirmed = window.confirm(
      t("confirm.delete_session", { title: deriveSessionTitle(session, t("session.untitled")) })
    );
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
      setError(nextError instanceof Error ? nextError.message : t("error.delete_session"));
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
            <span>{t("brand.subtitle")}</span>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="topbar-nav" aria-label={t("aria.app_pages")}>
            <button
              type="button"
              className={`ghost-button nav-button ${activePage === "chat" ? "active" : ""}`}
              onClick={() => handlePageChange("chat")}
            >
              <MessagesSquare size={16} />
              {t("nav.chat")}
            </button>
            <button
              type="button"
              className={`ghost-button nav-button ${activePage === "files" ? "active" : ""}`}
              onClick={() => handlePageChange("files")}
            >
              <FilesIcon size={16} />
              {t("nav.files")}
            </button>
          </div>

          <button className="ghost-button" type="button" onClick={() => void handleOpenConfig()}>
            <Settings2 size={16} />
            {t("nav.configs")}
          </button>

          <button className="ghost-button" type="button" onClick={() => setIsSessionsOverlayOpen(true)}>
            <FolderOpen size={16} />
            {t("nav.sessions")}
          </button>

          <label className="theme-switcher">
            <span>{t("language.label")}</span>
            <select
              value={language}
              onChange={(event) => {
                setLanguage(event.target.value as Locale);
                event.target.blur();
              }}
            >
              <option value="fr">{t("language.fr")}</option>
              <option value="en">{t("language.en")}</option>
            </select>
          </label>

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
                  {t(entry.label)}
                </option>
              ))}
            </select>
          </label>

          <button className="ghost-button" type="button" onClick={() => void handleRefresh()} disabled={isRefreshing}>
            <RefreshCw size={16} />
            {isRefreshing ? t("nav.refreshing") : t("nav.refresh")}
          </button>
        </div>
      </nav>

      {activePage === "chat" ? (
        <main className="layout">
        <section className="conversation-column">
          <div className="section-head section-head-compact tight">
            <div className="panel-title">
              <MessagesSquare size={15} />
              <h2>{t("section.conversation")}</h2>
            </div>
          </div>

          <div className="conversation-panel" ref={scrollRef}>
            {isLoading ? (
              <div className="empty-state">
                <LoaderCircle size={18} className="spin" />
                <p>{t("empty.loading_sessions")}</p>
              </div>
            ) : currentThread ? (
              conversationMessages.length ? (
                conversationMessages.map((entry) => (
                  <article key={entry.id} className={`message-card message-${entry.role} message-kind-${entry.kind}`}>
                    <div className="message-head">
                      <strong className="message-title">
                        {messageIdentityIcon(entry.role)}
                        <span>{localizeKnownUiText(entry.title, t)}</span>
                      </strong>
                      <div className="message-toolbar">
                        {isExpandable(entry.text) ? (
                          <button
                            type="button"
                            className="message-icon-button"
                            onClick={() => toggleMessageExpanded(entry.id)}
                            aria-label={expandedMessages[entry.id] ? t("aria.collapse_message") : t("aria.expand_message")}
                          >
                            {expandedMessages[entry.id] ? <Minimize2 size={14} /> : <Expand size={14} />}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="message-icon-button"
                          onClick={() => void handleCopyMessage(entry.id, entry.text)}
                          aria-label={t("aria.copy_message")}
                          title={copiedMessageId === entry.id ? t("button.copied") : t("button.copy")}
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                    <div className={`markdown-message ${expandedMessages[entry.id] ? "expanded" : ""}`}>
                      {renderMarkdown(entry.text)}
                    </div>
                    {renderMessageAttachments(entry.attachments)}
                    {entry.role === "assistant" && entry.phase !== "commentary" ? renderInlineActivity(entry.id) : null}
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <MessageSquareMore size={22} />
                  <p>{t("empty.no_messages")}</p>
                </div>
              )
            ) : (
              <div className="empty-state">
                <Plus size={22} />
                <p>{t("empty.no_session")}</p>
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
                  <h2>{t("section.sessions")}</h2>
                </div>
                <div className="session-head-meta">
                  {selectedSessionModel ? (
                    <button
                      type="button"
                      className="meta-tag meta-tag-button"
                      onClick={() => void handleOpenModelOverlay()}
                      disabled={!currentThread}
                    >
                      {selectedSessionModel}
                    </button>
                  ) : null}
                  <span className="meta-tag">{t("label.msg_count", { count: visibleConversationCount })}</span>
                </div>
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
                      {t("input.select_session")}
                    </option>
                    {sessions.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {formatSessionDate(entry.updatedAt, language)} - {deriveSessionTitle(entry, t("session.untitled"))}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="solid-button icon-button"
                  onClick={() => setIsCreateModalOpen(true)}
                  aria-label={t("aria.create_session")}
                >
                  <Plus size={16} />
                </button>
              </div>
            </section>

            <section className="sidebar-panel composer-panel">
              <div className="section-head section-head-compact tight">
                <div className="panel-title">
                  <SquarePen size={15} />
                  <h2>{t("section.composer")}</h2>
                </div>
                <button
                  type="button"
                  className="ghost-button subtle"
                  onClick={() => setIsQuickPromptsOpen(true)}
                >
                  <MessageSquareMore size={15} />
                  {t("button.quick_prompts")}
                </button>
              </div>

              <form className="composer" onSubmit={handleSubmit}>
                <input
                  id="composer-image-input"
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="visually-hidden"
                  onChange={(event) => void handleAttachmentSelection(event)}
                  disabled={!currentThread || isUploadingAttachments || isPosting}
                />

                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={t("input.post_message")}
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
                    {t("button.stop")}
                  </button>

                  <button
                    type="button"
                    className={`ghost-button subtle ${!currentThread || isUploadingAttachments || isPosting ? "is-disabled" : ""}`}
                    onClick={() => {
                      if (!currentThread || isUploadingAttachments || isPosting) {
                        return;
                      }
                      setIsImageOverlayOpen(true);
                    }}
                  >
                    <Image size={15} />
                    {isUploadingAttachments ? t("button.add_images") : t("button.attach")}
                    {pendingAttachments.length ? <span className="attach-badge">{pendingAttachments.length}</span> : null}
                  </button>

                  <button
                    type="button"
                    className="ghost-button subtle clear-button"
                    onClick={handleClear}
                    disabled={!message && !pendingAttachments.length}
                  >
                    <Eraser size={15} />
                    {t("button.clear")}
                  </button>

                  <button
                    type="submit"
                    className="solid-button send-button"
                    disabled={!currentThread || isPosting || (!message.trim() && !pendingAttachments.length)}
                  >
                    <SendHorizonal size={16} />
                    {isPosting ? t("button.sending") : t("button.send")}
                  </button>
                </div>
              </form>
            </section>

            <section className="sidebar-panel sidebar-account-panel">
              <div className="section-head section-head-compact tight">
                <div className="panel-title">
                  <Gauge size={15} />
                  <h2>{t("section.quota")}</h2>
                </div>
                <span className="meta-tag">{account?.planLabel ?? "..."}</span>
              </div>

              <div className="quota-row">
                <div className="quota-pill">
                  <span>5h</span>
                  <strong className="account-value-ok">{account?.remaining5hLabel ?? t("label.loading")}</strong>
                </div>
                <div className="quota-pill">
                  <span>{t("label.reset")}</span>
                  <strong>{account?.reset5hLabel ?? t("label.loading")}</strong>
                </div>
                <div className="quota-pill">
                  <span>7d</span>
                  <strong className="account-value-ok">{account?.remaining7dLabel ?? t("label.loading")}</strong>
                </div>
                <div className="quota-pill">
                  <span>{t("label.reset")}</span>
                  <strong>{account?.reset7dLabel ?? t("label.loading")}</strong>
                </div>
              </div>
            </section>

            <section className="sidebar-panel sidebar-status-panel">
              <div className={`status-pill status-${currentThread?.liveStatus.tone ?? "idle"}`}>
                {isBusy ? <LoaderCircle size={16} className="spin" /> : <SquarePen size={15} />}
                <strong>{localizedLiveStatusLabel}</strong>
                <span>{localizedLiveStatusDetail}</span>
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
                <h2>{t("section.viewer")}</h2>
              </div>
              <span className="meta-tag">{projectLabel(selectedFilePath)}</span>
            </div>

            <div className="file-viewer-panel">
              <div className="file-viewer-meta">
                <strong>{selectedFileName || t("label.no_file_selected")}</strong>
                <button
                  type="button"
                  className="ghost-button subtle"
                  onClick={() => void handleCopySelectedFile()}
                  disabled={!selectedFilePath || !selectedFileContent}
                >
                  <Copy size={15} />
                  {isFileContentCopied ? t("button.copied") : t("button.copy")}
                </button>
              </div>

              {isFileContentLoading ? (
                <div className="empty-state">
                  <LoaderCircle size={18} className="spin" />
                  <p>{t("empty.loading_file")}</p>
                </div>
              ) : selectedFilePath ? (
                <pre className="file-viewer-content">{selectedFileContent}</pre>
              ) : (
                <div className="empty-state">
                  <FilesIcon size={22} />
                  <p>{t("empty.select_file")}</p>
                </div>
              )}
            </div>
          </section>

          <aside className="file-tree-column">
            <section className="file-tree-panel">
              <div className="section-head section-head-compact tight">
                <div className="panel-title">
                  <FolderKanban size={15} />
                  <h2>{t("section.projects")}</h2>
                </div>
                <span className="meta-tag">/projects</span>
              </div>

              <div className="file-tree-list">
                {isFileTreeLoading ? (
                  <div className="empty-state compact-empty">
                    <LoaderCircle size={18} className="spin" />
                    <p>{t("empty.loading_tree")}</p>
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
              <h3>{t("modal.archive_title")}</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setArchiveTarget(null)}
                aria-label={t("aria.close_archive_modal")}
              >
                <CircleX size={16} />
              </button>
            </div>

            <p className="modal-copy">{t("modal.archive_copy", { name: archiveTarget.name })}</p>

            <label className="archive-checkbox">
              <input
                type="checkbox"
                checked={includeEnvInArchive}
                onChange={(event) => setIncludeEnvInArchive(event.target.checked)}
              />
              <span>{t("modal.include_env")}</span>
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="ghost-button subtle"
                onClick={() => setArchiveTarget(null)}
                disabled={isArchiveDownloading}
              >
                {t("button.cancel")}
              </button>
              <button
                type="button"
                className="solid-button"
                onClick={() => void handleDownloadArchive()}
                disabled={isArchiveDownloading}
              >
                <Download size={16} />
                {isArchiveDownloading ? t("button.preparing") : t("button.download_zip")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {notifications.length ? (
        <div className="notification-stack" aria-live="polite" aria-label={t("aria.notifications")}>
          {notifications.map((notification) => (
            <article key={notification.id} className={`notification-card notification-${notification.kind}`}>
              <div className="notification-icon">{notificationIcon(notification.kind)}</div>
              <p>{notification.message}</p>
              <button
                type="button"
                className="message-icon-button"
                onClick={() => dismissNotification(notification.id)}
                aria-label={t("aria.dismiss_notification")}
              >
                <CircleX size={14} />
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {isImageOverlayOpen ? (
        <div className="modal-backdrop" onClick={() => setIsImageOverlayOpen(false)}>
          <section className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{t("modal.images_title")}</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setIsImageOverlayOpen(false)}
                aria-label={t("aria.close_images_modal")}
              >
                <CircleX size={16} />
              </button>
            </div>

            <p className="modal-copy">{t("modal.images_copy")}</p>

            <div className="modal-actions">
              <label
                className={`ghost-button subtle ${!currentThread || isUploadingAttachments || isPosting ? "is-disabled" : ""}`}
                htmlFor={!currentThread || isUploadingAttachments || isPosting ? undefined : "composer-image-input"}
                onClick={(event) => {
                  if (!currentThread || isUploadingAttachments || isPosting) {
                    event.preventDefault();
                  }
                }}
              >
                <Image size={15} />
                {isUploadingAttachments ? t("button.add_images") : t("button.add_images")}
              </label>
            </div>

            <div className="attachment-list attachment-list-modal">
              {pendingAttachments.length ? (
                pendingAttachments.map((attachment) => (
                  <article key={attachment.id} className="attachment-chip">
                    <img src={attachment.previewUrl ?? attachment.path} alt={attachment.name} className="attachment-preview" />
                    <div className="attachment-copy">
                      <strong>{attachment.name}</strong>
                      <span>{t("label.image")}</span>
                    </div>
                    <button
                      type="button"
                      className="message-icon-button"
                      onClick={() => handleRemoveAttachment(attachment.id)}
                      aria-label={t("aria.remove_image", { name: attachment.name })}
                    >
                      <CircleX size={14} />
                    </button>
                  </article>
                ))
              ) : (
                <div className="empty-state compact-empty">
                  <p>{t("empty.no_images")}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {isModelOverlayOpen ? (
        <div className="modal-backdrop" onClick={() => setIsModelOverlayOpen(false)}>
          <section className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{t("modal.model_title")}</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setIsModelOverlayOpen(false)}
                aria-label={t("aria.close_model_modal")}
              >
                <CircleX size={16} />
              </button>
            </div>

            <p className="modal-copy">{t("modal.model_copy")}</p>

            <div className="model-list">
              {isModelsLoading ? (
                <div className="empty-state compact-empty">
                  <LoaderCircle size={18} className="spin" />
                  <p>{t("empty.loading_models")}</p>
                </div>
              ) : availableModels.length ? (
                availableModels.map((entry) => {
                  const isActive = entry.model === selectedSessionModel;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`model-option ${isActive ? "active" : ""}`}
                      onClick={() => void handleChangeSessionModel(entry.model)}
                      disabled={isModelSaving}
                    >
                      <div className="model-option-copy">
                        <strong>{entry.displayName}</strong>
                        <span>{entry.description}</span>
                      </div>
                      <div className="model-option-meta">
                        {entry.isDefault ? <span className="meta-tag">{t("label.default")}</span> : null}
                        <span className="meta-tag">{entry.model}</span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="empty-state compact-empty">
                  <p>{t("empty.no_models")}</p>
                </div>
              )}
            </div>
          </section>
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
              <h3>{t("modal.quick_prompts_title")}</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => {
                  setIsQuickPromptsOpen(false);
                  resetQuickPromptEditor();
                }}
                aria-label={t("aria.close_quick_prompts_modal")}
              >
                <CircleX size={16} />
              </button>
            </div>

            <p className="modal-copy">{t("modal.quick_prompts_copy")}</p>

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
                        aria-label={t("aria.move_prompt_up", { title: prompt.title })}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        className="ghost-button subtle icon-button"
                        onClick={() => handleMoveQuickPrompt(prompt.id, 1)}
                        disabled={index === quickPrompts.length - 1}
                        aria-label={t("aria.move_prompt_down", { title: prompt.title })}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        type="button"
                        className="ghost-button subtle"
                        onClick={() => handleInsertQuickPrompt(prompt.content)}
                      >
                        {t("button.insert")}
                      </button>
                      <button
                        type="button"
                        className="ghost-button subtle"
                        onClick={() => void handleSendQuickPrompt(prompt.content)}
                        disabled={!currentThread || isPosting}
                      >
                        {t("button.send_now")}
                      </button>
                      <button
                        type="button"
                        className="ghost-button subtle"
                        onClick={() => handleEditQuickPrompt(prompt)}
                      >
                        {t("button.edit")}
                      </button>
                      <button
                        type="button"
                        className="ghost-button subtle danger"
                        onClick={() => handleDeleteQuickPrompt(prompt.id)}
                      >
                        {t("button.delete")}
                      </button>
                    </div>
                  </article>
                ))}

                {!quickPrompts.length ? (
                  <div className="empty-state compact-empty">
                    <p>{t("empty.no_quick_prompts")}</p>
                  </div>
                ) : null}
              </div>

              <div className="quick-prompts-editor">
                <div className="section-head section-head-compact tight">
                  <div className="panel-title">
                    <Sparkles size={15} />
                    <h2>{editingQuickPromptId ? t("quick_prompt.edit") : t("quick_prompt.new")}</h2>
                  </div>
                </div>

                <input
                  value={quickPromptTitle}
                  onChange={(event) => setQuickPromptTitle(event.target.value)}
                  placeholder={t("input.prompt_title")}
                />
                <textarea
                  className="quick-prompt-textarea"
                  value={quickPromptContent}
                  onChange={(event) => setQuickPromptContent(event.target.value)}
                  placeholder={t("input.prompt_content")}
                />
                <div className="modal-actions">
                  <button type="button" className="ghost-button subtle" onClick={resetQuickPromptEditor}>
                    {t("quick_prompt.clear")}
                  </button>
                  <button type="button" className="solid-button" onClick={handleSaveQuickPrompt}>
                    {editingQuickPromptId ? t("quick_prompt.save_changes") : t("quick_prompt.add")}
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
              <h3>{t("modal.new_session_title")}</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setIsCreateModalOpen(false)}
                aria-label={t("aria.close_create_session_modal")}
              >
                <CircleX size={16} />
              </button>
            </div>

            <p className="modal-copy">{t("modal.new_session_copy")}</p>

            <input
              value={newSessionName}
              onChange={(event) => setNewSessionName(event.target.value)}
              placeholder={t("input.session_title")}
              autoFocus
            />

            <input
              value={newSessionPath}
              onChange={(event) => setNewSessionPath(event.target.value)}
              placeholder={t("input.workspace_path")}
            />

            <div className="modal-actions">
              <button
                type="button"
                className="ghost-button subtle"
                onClick={() => setIsCreateModalOpen(false)}
              >
                {t("button.cancel")}
              </button>
              <button
                type="button"
                className="solid-button"
                onClick={() => void handleCreateSession()}
                disabled={isCreating}
              >
                <Plus size={16} />
                {isCreating ? t("button.creating") : t("button.create")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isSessionsOverlayOpen ? (
        <div className="modal-backdrop" onClick={() => setIsSessionsOverlayOpen(false)}>
          <section className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{t("modal.sessions_title")}</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setIsSessionsOverlayOpen(false)}
                aria-label={t("aria.close_sessions_modal")}
              >
                <CircleX size={16} />
              </button>
            </div>

            <div className="session-admin-list">
              {sessions.length ? (
                sessions.map((entry) => (
                  <article key={entry.id} className="session-admin-row">
                    <div className="session-admin-copy">
                      <strong>{deriveSessionTitle(entry, t("session.untitled"))}</strong>
                      <span>
                        {formatSessionDate(entry.updatedAt, language)} · {entry.cwd}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="ghost-button danger"
                      onClick={() => void handleDeleteSession(entry)}
                      disabled={deletingSessionId === entry.id}
                    >
                      <Trash2 size={15} />
                      {deletingSessionId === entry.id ? t("button.deleting") : t("button.delete")}
                    </button>
                  </article>
                ))
              ) : (
                <div className="empty-state compact-empty">
                  <p>{t("empty.no_sessions")}</p>
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
              <h3>{t("modal.config_title")}</h3>
              <button
                type="button"
                className="ghost-button subtle icon-button"
                onClick={() => setIsConfigOpen(false)}
                aria-label={t("aria.close_config_modal")}
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
                {t("button.apply_full_access")}
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
                {t("button.save")}
              </button>
              <button
                type="button"
                className="solid-button"
                onClick={() => void handleSaveConfig(true)}
                disabled={isConfigSaving}
              >
                <Settings2 size={16} />
                {isConfigSaving ? t("button.saving") : t("button.save_relaunch")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
