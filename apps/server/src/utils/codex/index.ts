import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getCodexMcpRuntime } from "@/utils/mcp/runtime";

type JsonObject = Record<string, unknown>;
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type CodexStreamEvent =
  | { type: "status"; message: string }
  | { type: "session"; threadId: string }
  | { type: "turn"; turnId: string }
  | { type: "text" | "thinking"; blockId: string; delta: string }
  | { type: "plan"; explanation?: string; steps: Array<{ step: string; status: string }> }
  | { type: "tool"; blockId: string; status: "started" | "completed"; name: string; detail?: unknown }
  | { type: "stats"; input: number; output: number; cachedInput: number; reasoningOutput: number }
  | { type: "error"; message: string }
  | { type: "done" };

type TurnSubscriber = { send: (event: CodexStreamEvent) => void; resolve: () => void; reject: (error: Error) => void };

const workflowInstructions = `你是耀好原创工作室里的 Codex 画布代理。你必须优先通过 toonflow MCP 读取和修改当前工作区的画布、节点与项目文件。不要用 shell 或直接文件写入修改画布。工作流必须透明：每一阶段都在对应画布留下可查看、可修改、可局部重跑的节点和依赖连线。付费媒体生成前先展示提示词、参考图绑定和参数；除非用户明确要求执行，否则不要提交付费生成。`;

class CodexAppServer {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private startPromise?: Promise<void>;
  private pending = new Map<number, PendingRequest>();
  private threads = new Map<string, string>();
  private turns = new Map<string, TurnSubscriber>();
  private pendingTurn?: { threadId: string; subscriber: TurnSubscriber };

  async run(cwd: string, prompt: string, send: TurnSubscriber["send"], signal?: AbortSignal) {
    await this.start();
    const threadId = await this.getThread(cwd, send);
    await new Promise<void>((resolve, reject) => {
      const subscriber = { send, resolve, reject };
      this.pendingTurn = { threadId, subscriber };
      void this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      }).then(value => {
        const response = value as { turn?: { id?: string } };
        const turnId = String(response.turn?.id || "");
        if (!turnId) throw new Error("Codex 没有返回 turn id");
        const stillPending = this.pendingTurn?.subscriber === subscriber;
        if (stillPending) this.pendingTurn = undefined;
        if (stillPending && !this.turns.has(this.turnKey(threadId, turnId))) this.turns.set(this.turnKey(threadId, turnId), subscriber);
        send({ type: "turn", turnId });
        const abort = () => {
          void this.request("turn/interrupt", { threadId, turnId }).catch(() => {});
          this.finishTurn(threadId, turnId, signal?.reason instanceof Error ? signal.reason : new DOMException("已停止 Codex", "AbortError"));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      }).catch(error => {
        if (this.pendingTurn?.subscriber === subscriber) this.pendingTurn = undefined;
        reject(error);
      });
    });
  }

  private async getThread(cwd: string, send: TurnSubscriber["send"]) {
    const key = process.platform === "win32" ? cwd.toLowerCase() : cwd;
    const current = this.threads.get(key);
    if (current) {
      send({ type: "session", threadId: current });
      return current;
    }
    const mcp = getCodexMcpRuntime();
    if (!mcp) throw new Error("Toonflow MCP 运行时尚未就绪，请重启应用后重试。");
    send({ type: "status", message: "正在连接 Codex 与 Toonflow 画布…" });
    const response = await this.request("thread/start", {
      cwd,
      threadSource: "user",
      approvalPolicy: "never",
      sandbox: "read-only",
      developerInstructions: workflowInstructions,
      config: {
        model_reasoning_summary: "auto",
        mcp_servers: {
          toonflow: {
            command: mcp.command,
            args: mcp.args,
            env: mcp.env,
            default_tools_approval_mode: "approve",
            startup_timeout_sec: 20,
            tool_timeout_sec: 1800,
          },
        },
      },
    }) as { thread?: { id?: string } };
    const threadId = String(response.thread?.id || "");
    if (!threadId) throw new Error("Codex 没有返回 thread id");
    this.threads.set(key, threadId);
    send({ type: "session", threadId });
    return threadId;
  }

  private async start() {
    if (this.child && !this.child.killed) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<void>((resolve, reject) => {
      const child = spawn(codexExecutable(), ["app-server", "--stdio"], { stdio: "pipe", windowsHide: true });
      this.child = child;
      child.stdout.on("data", chunk => this.read(String(chunk)));
      child.stderr.on("data", chunk => console.warn("Codex app-server:", String(chunk).trim()));
      child.once("error", error => { this.fail(error); reject(error); });
      child.once("exit", code => this.fail(new Error(`Codex app-server 已退出（${code ?? 0}）`)));
      this.request("initialize", {
        clientInfo: { name: "toonflow", title: "Toonflow Codex Agent", version: "1.0.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }).then(() => {
        this.notify("initialized", {});
        resolve();
      }, reject);
    }).finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  private read(chunk: string) {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try { this.receive(JSON.parse(line) as JsonObject); }
      catch (error) { console.warn("无法解析 Codex app-server 消息：", error); }
    }
  }

  private receive(message: JsonObject) {
    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(errorMessage(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.id === "number" && typeof message.method === "string") {
      this.respond(message.id, { decision: "decline" });
      return;
    }
    if (typeof message.method !== "string") return;
    this.notification(message.method, (message.params ?? {}) as JsonObject);
  }

  private notification(method: string, params: JsonObject) {
    const threadId = String(params.threadId || "");
    const turn = (params.turn ?? {}) as JsonObject;
    const turnId = String(params.turnId || turn.id || "");
    if (method === "turn/started" && threadId && turnId && this.pendingTurn?.threadId === threadId) {
      this.turns.set(this.turnKey(threadId, turnId), this.pendingTurn.subscriber);
      this.pendingTurn = undefined;
    }
    const subscriber = this.turns.get(this.turnKey(threadId, turnId));
    if (!subscriber) return;
    if (method === "item/agentMessage/delta") {
      subscriber.send({ type: "text", blockId: String(params.itemId || "answer"), delta: String(params.delta || "") });
    } else if (method === "item/reasoning/summaryTextDelta") {
      subscriber.send({ type: "thinking", blockId: String(params.itemId || "reasoning"), delta: String(params.delta || "") });
    } else if (method === "turn/plan/updated") {
      subscriber.send({ type: "plan", explanation: typeof params.explanation === "string" ? params.explanation : undefined, steps: Array.isArray(params.plan) ? params.plan as Array<{ step: string; status: string }> : [] });
    } else if (method === "item/started" || method === "item/completed") {
      const item = (params.item ?? {}) as JsonObject;
      if (String(item.type || "").includes("mcp")) subscriber.send({
        type: "tool",
        blockId: String(item.id || crypto.randomUUID()),
        status: method === "item/started" ? "started" : "completed",
        name: String(item.tool || item.name || item.type || "Toonflow MCP"),
        detail: method === "item/completed" ? item.result : item.arguments,
      });
    } else if (method === "thread/tokenUsage/updated") {
      const last = (((params.tokenUsage ?? {}) as JsonObject).last ?? {}) as JsonObject;
      subscriber.send({ type: "stats", input: number(last.inputTokens), output: number(last.outputTokens), cachedInput: number(last.cachedInputTokens), reasoningOutput: number(last.reasoningOutputTokens) });
    } else if (method === "error") {
      const error = (params.error ?? {}) as JsonObject;
      subscriber.send({ type: "error", message: String(error.message || "Codex 运行失败") });
    } else if (method === "turn/completed") {
      const error = turn.error as JsonObject | undefined;
      this.finishTurn(threadId, turnId, error ? new Error(String(error.message || "Codex 运行失败")) : undefined);
    }
  }

  private finishTurn(threadId: string, turnId: string, error?: Error) {
    const key = this.turnKey(threadId, turnId);
    const subscriber = this.turns.get(key);
    if (!subscriber) return;
    this.turns.delete(key);
    if (error) subscriber.reject(error);
    else subscriber.resolve();
  }

  private request(method: string, params: JsonObject) {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  private notify(method: string, params: JsonObject) { this.write({ method, params }); }
  private respond(id: number, result: JsonObject) { this.write({ id, result }); }
  private write(message: JsonObject) {
    if (!this.child?.stdin.writable) throw new Error("Codex app-server 尚未启动");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  private turnKey(threadId: string, turnId: string) { return `${threadId}\0${turnId}`; }
  private fail(error: Error) {
    this.child = undefined;
    this.threads.clear();
    this.pending.forEach(pending => pending.reject(error));
    this.turns.forEach(turn => turn.reject(error));
    this.pending.clear();
    this.turns.clear();
    this.pendingTurn = undefined;
  }
}

function codexExecutable() {
  if (process.env.CODEX_BIN && existsSync(process.env.CODEX_BIN)) return process.env.CODEX_BIN;
  if (process.platform !== "win32") return "codex";
  const root = join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin");
  if (!existsSync(root)) return "codex.exe";
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(root, entry.name, "codex.exe"))
    .filter(existsSync);
  return candidates.at(-1) || "codex.exe";
}

function errorMessage(value: unknown) {
  if (value && typeof value === "object" && "message" in value) return String((value as { message: unknown }).message);
  return String(value || "Codex 请求失败");
}

function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

export const codex = new CodexAppServer();
export type { CodexStreamEvent };
