export type ThreadStatusType = "notLoaded" | "idle" | "systemError" | "active";

export type SessionSummary = {
  id: string;
  name: string | null;
  preview: string;
  updatedAt: number;
  createdAt: number;
  status: ThreadStatusType;
  cwd: string;
};

export type UiMessage = {
  id: string;
  kind: "user" | "assistant" | "plan" | "reasoning" | "command" | "file" | "tool" | "system";
  role: "user" | "assistant" | "system";
  title: string;
  text: string;
  phase?: "commentary" | "final_answer" | null;
  status?: string;
  meta?: Record<string, string | number | boolean | null>;
};

export type LiveStatus = {
  tone: "idle" | "running" | "waiting" | "error" | "done";
  label: string;
  detail: string;
  updatedAt: number;
};

export type SessionDetail = {
  summary: SessionSummary;
  messages: UiMessage[];
  liveStatus: LiveStatus;
  currentTurnId: string | null;
};

export type BootstrapResponse = {
  sessions: SessionSummary[];
  selectedThread: SessionDetail | null;
};

export type AccountInfo = {
  planLabel: string;
  accountLabel: string;
  remaining5hLabel: string;
  reset5hLabel: string;
  remaining7dLabel: string;
  reset7dLabel: string;
  updatedAt: number;
};

export type CodexConfigInfo = {
  path: string;
  content: string;
};

export type Theme = {
  id: string;
  label: string;
  description: string;
};
