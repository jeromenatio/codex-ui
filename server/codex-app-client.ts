import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import WebSocket from "ws";

type JsonRpcId = number;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type JsonRpcNotification = {
  jsonrpc?: "2.0";
  method: string;
  params?: unknown;
  id?: JsonRpcId;
};

export class CodexAppClient extends EventEmitter {
  private readonly cwd: string;
  private readonly listenUrl: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private socket: WebSocket | null = null;
  private requestId = 1;
  private ready = false;
  private initialized = false;
  private pending = new Map<
    JsonRpcId,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  constructor(options: { cwd: string; port?: number }) {
    super();
    this.cwd = options.cwd;
    const port = options.port ?? 4317;
    this.listenUrl = `ws://127.0.0.1:${port}`;
  }

  async start() {
    this.child = spawn(
      "codex",
      ["app-server", "--listen", this.listenUrl],
      {
        cwd: this.cwd,
        env: process.env,
        stdio: "pipe"
      }
    );

    this.child.stderr.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        this.emit("log", message);
      }
    });

    this.child.on("exit", (code, signal) => {
      this.ready = false;
      this.emit("exit", { code, signal });
    });

    await this.connectWithRetry();
    await this.initialize();
  }

  async stop() {
    this.socket?.close();
    this.child?.kill("SIGTERM");
    this.child = null;
    this.socket = null;
    this.ready = false;
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureReady();

    const id = this.requestId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });
      this.socket?.send(JSON.stringify(payload), (error?: Error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private async ensureReady() {
    if (this.ready && this.initialized && this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (!this.child) {
      await this.start();
    }
  }

  private async connectWithRetry() {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await this.connect();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    throw lastError ?? new Error("Unable to connect to codex app-server.");
  }

  private connect() {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.listenUrl);

      const onError = (error: Error) => {
        socket.removeAllListeners();
        reject(error);
      };

      socket.once("error", onError);
      socket.once("open", () => {
        socket.removeListener("error", onError);
        this.socket = socket;
        this.ready = true;
        this.attachSocketHandlers(socket);
        resolve();
      });
    });
  }

  private attachSocketHandlers(socket: WebSocket) {
    socket.on("message", (raw: WebSocket.RawData) => {
      const text = raw.toString();
      const message = JSON.parse(text) as JsonRpcResponse | JsonRpcNotification;

      if ("id" in message && typeof message.id === "number" && ("result" in message || "error" in message)) {
        this.handleResponse(message as JsonRpcResponse);
        return;
      }

      this.handleIncoming(message as JsonRpcNotification);
    });

    socket.on("close", () => {
      this.ready = false;
      this.initialized = false;
    });
  }

  private handleResponse(message: JsonRpcResponse) {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  private handleIncoming(message: JsonRpcNotification) {
    if ("id" in message && typeof message.id === "number") {
      void this.handleServerRequest(message);
      return;
    }

    this.emit("notification", message);
  }

  private async initialize() {
    if (this.initialized) {
      return;
    }

    await this.request("initialize", {
      clientInfo: {
        name: "codex-ui",
        title: "Codex UI",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });

    this.initialized = true;
  }

  private async handleServerRequest(message: JsonRpcNotification) {
    const id = message.id as JsonRpcId;
    const method = message.method;

    let result: unknown;

    if (method === "item/commandExecution/requestApproval") {
      result = { decision: "acceptForSession" };
    } else if (method === "item/fileChange/requestApproval") {
      result = { decision: "acceptForSession" };
    } else if (method === "item/permissions/requestApproval") {
      result = { permissions: {}, scope: "session" };
    } else if (method === "item/tool/requestUserInput") {
      const params = (message.params ?? {}) as {
        questions?: Array<{ id: string; options?: Array<{ value?: string; label?: string }> | null }>;
      };
      const answers = Object.fromEntries(
        (params.questions ?? []).map((question) => {
          const first = question.options?.[0];
          const value = first?.value ?? first?.label ?? "";
          return [question.id, { answers: value ? [value] : [] }];
        })
      );
      result = { answers };
    } else if (method === "item/tool/call") {
      result = { contentItems: [], success: false };
    } else if (method === "applyPatchApproval") {
      result = { decision: "approved_for_session" };
    } else if (method === "execCommandApproval") {
      result = { decision: "approved_for_session" };
    } else {
      result = {};
    }

    this.socket?.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result
      })
    );
  }
}
