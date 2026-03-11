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

export type UiMessageKind =
  | "user"
  | "assistant"
  | "plan"
  | "reasoning"
  | "command"
  | "file"
  | "tool"
  | "system";

export type UiMessage = {
  id: string;
  kind: UiMessageKind;
  role: "user" | "assistant" | "system";
  title: string;
  text: string;
  phase?: "commentary" | "final_answer" | null;
  status?: string;
  meta?: Record<string, string | number | boolean | null>;
};

export type LiveStatusTone = "idle" | "running" | "waiting" | "error" | "done";

export type LiveStatus = {
  tone: LiveStatusTone;
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
