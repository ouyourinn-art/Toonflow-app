<template>
  <section class="codexAgent">
    <header class="agentMenu">
      <div class="agentIdentity">
        <strong>Codex 代理</strong>
        <span class="statusDot" :class="{ active: loading }" aria-hidden="true" />
        <small>{{ status }}</small>
      </div>
      <div class="menuActions">
        <slot name="mode" />
        <slot name="actions" />
        <el-button text circle aria-label="关闭 Codex" title="关闭" @click="emit('close')"><icon-x :size="16" /></el-button>
      </div>
    </header>

    <main ref="messageView" class="messageView" aria-live="polite">
      <div v-if="!messages.length" class="emptyState">
        <icon-sparkles :size="26" />
        <strong>让 Codex 直接搭建和修改当前画布</strong>
        <p>它会通过 Toonflow MCP 操作节点。做剧流程会保留每阶段成果、依赖、提示词和 QA，不再黑盒直跑。</p>
        <el-button type="primary" @click="sendWorkflowPrompt">搭建透明做剧流程</el-button>
      </div>
      <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
        <div class="messageLabel">{{ message.role === "user" ? "你" : "Codex" }}</div>
        <div class="messageContent">{{ message.content || (message.role === "assistant" && loading ? "正在处理…" : "") }}</div>
        <details v-if="message.thinking" class="thinking">
          <summary>思考过程</summary>
          <pre>{{ message.thinking }}</pre>
        </details>
        <ol v-if="message.plan?.length" class="plan">
          <li v-for="step in message.plan" :key="step.step" :data-status="step.status">{{ step.step }}</li>
        </ol>
        <div v-if="message.tools?.length" class="toolList">
          <span v-for="tool in message.tools" :key="tool.id" class="toolItem" :class="tool.status">
            <icon-loader-2 v-if="tool.status === 'started'" class="spin" :size="13" />
            <icon-circle-check v-else :size="13" />
            {{ tool.name }}
          </span>
        </div>
      </article>
    </main>

    <footer class="composer">
      <div class="quickActions">
        <el-button size="small" plain :disabled="loading" @click="sendWorkflowPrompt">搭建做剧流程</el-button>
        <el-button size="small" plain :disabled="loading" @click="draft = '检查当前做剧画布的断点、人物重复、参考图绑定和连续性 QA；列出问题后只修复失败节点，不重建已完成阶段。'">检查流程</el-button>
      </div>
      <el-input
        v-model="draft"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 7 }"
        resize="none"
        placeholder="让 Codex 读取或修改当前画布…"
        :disabled="loading"
        @keydown.ctrl.enter.prevent="send" />
      <div class="composerFooter">
        <span>Ctrl + Enter 发送 · 画布写入经 Toonflow MCP</span>
        <el-button v-if="loading" type="danger" plain @click="stop">停止</el-button>
        <el-button v-else type="primary" :disabled="!draft.trim()" @click="send">发送</el-button>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { IconCircleCheck, IconLoader2, IconSparkles, IconX } from "@tabler/icons-vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { originalCodexWorkflowPrompt } from "@/lib/originalWorkflow";

type PlanStep = { step: string; status: string };
type ToolState = { id: string; name: string; status: "started" | "completed" };
type Message = { id: string; role: "user" | "assistant"; content: string; thinking?: string; plan?: PlanStep[]; tools?: ToolState[] };
type CodexEvent =
  | { type: "status"; message: string }
  | { type: "session"; threadId: string }
  | { type: "turn"; turnId: string }
  | { type: "text" | "thinking"; blockId: string; delta: string }
  | { type: "plan"; explanation?: string; steps: PlanStep[] }
  | { type: "tool"; blockId: string; status: "started" | "completed"; name: string }
  | { type: "stats"; input: number; output: number; cachedInput: number; reasoningOutput: number }
  | { type: "error"; message: string }
  | { type: "done" };

const emit = defineEmits<{ close: [] }>();
const workspaceStore = useWorkspaceStore();
const messages = ref<Message[]>([]);
const draft = ref("");
const loading = ref(false);
const status = ref("待命");
const messageView = ref<HTMLElement>();
let controller: AbortController | undefined;

function sendWorkflowPrompt() {
  draft.value = originalCodexWorkflowPrompt();
  void send();
}

async function send() {
  const directory = workspaceStore.project?.directory;
  const prompt = draft.value.trim();
  if (!directory || !prompt || loading.value) return;
  const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: prompt };
  const answer: Message = { id: crypto.randomUUID(), role: "assistant", content: "", tools: [] };
  messages.value.push(userMessage, answer);
  draft.value = "";
  loading.value = true;
  status.value = "正在连接";
  controller = new AbortController();
  await scrollToEnd();
  try {
    const response = await fetch("/api/codex", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({ directory, prompt }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error((await response.text()) || `Codex 请求失败（${response.status}）`);
    for await (const event of readEvents(response.body, controller.signal)) {
      if (event.type === "status") status.value = event.message;
      else if (event.type === "session") status.value = `已连接 · ${event.threadId.slice(0, 8)}`;
      else if (event.type === "turn") status.value = "正在执行";
      else if (event.type === "text") answer.content += event.delta;
      else if (event.type === "thinking") answer.thinking = `${answer.thinking || ""}${event.delta}`;
      else if (event.type === "plan") answer.plan = event.steps;
      else if (event.type === "tool") {
        const tool = answer.tools?.find(item => item.id === event.blockId);
        if (tool) Object.assign(tool, { name: event.name, status: event.status });
        else answer.tools?.push({ id: event.blockId, name: event.name, status: event.status });
      } else if (event.type === "error") throw new Error(event.message);
      else if (event.type === "done") status.value = "已完成";
      await scrollToEnd();
    }
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      const message = error instanceof Error ? error.message : "Codex 运行失败";
      answer.content ||= `运行失败：${message}`;
      status.value = "运行失败";
      ElMessage.error(message);
    }
  } finally {
    loading.value = false;
    controller = undefined;
    if (status.value === "正在执行" || status.value === "正在连接") status.value = "已停止";
  }
}

function stop() {
  controller?.abort();
  status.value = "正在停止";
}

async function* readEvents(stream: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) yield JSON.parse(line) as CodexEvent;
      if (done) break;
    }
    if (buffer.trim()) yield JSON.parse(buffer) as CodexEvent;
  } finally { reader.releaseLock(); }
}

async function scrollToEnd() {
  await nextTick();
  if (messageView.value) messageView.value.scrollTop = messageView.value.scrollHeight;
}

watch(() => workspaceStore.project?.directory, () => {
  stop();
  messages.value = [];
  status.value = "待命";
});
onBeforeUnmount(stop);
</script>

<style scoped lang="scss">
.codexAgent { height: 100%; display: flex; flex-direction: column; overflow: hidden; border-radius: inherit; background: var(--el-bg-color-overlay); }
.agentMenu { min-height: 52px; padding: 0 10px 0 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--el-border-color-lighter); }
.agentIdentity { min-width: 0; display: flex; align-items: center; gap: 7px; }
.agentIdentity small { max-width: 170px; overflow: hidden; color: var(--el-text-color-secondary); text-overflow: ellipsis; white-space: nowrap; }
.statusDot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--el-color-success); }
.statusDot.active { background: var(--el-color-primary); box-shadow: 0 0 0 4px var(--el-color-primary-light-9); }
.menuActions { display: flex; align-items: center; }
.messageView { flex: 1; overflow: auto; padding: 18px 14px; }
.emptyState { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; color: var(--el-text-color-primary); }
.emptyState p { max-width: 330px; margin: 0; line-height: 1.6; color: var(--el-text-color-secondary); }
.message { margin-bottom: 16px; }
.message.user { margin-left: 12%; }
.messageLabel { margin: 0 0 5px 4px; font-size: 12px; color: var(--el-text-color-secondary); }
.messageContent { padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--el-fill-color-light); }
.message.user .messageContent { background: var(--el-color-primary-light-9); border-color: var(--el-color-primary-light-7); }
.thinking { margin-top: 7px; padding: 7px 10px; border-left: 2px solid var(--el-border-color); color: var(--el-text-color-secondary); }
.thinking pre { white-space: pre-wrap; font: inherit; }
.plan { margin: 8px 0 0; padding: 9px 12px 9px 30px; border-radius: 9px; background: var(--el-fill-color-lighter); }
.plan li[data-status="completed"] { text-decoration: line-through; opacity: .65; }
.toolList { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.toolItem { display: inline-flex; align-items: center; gap: 4px; padding: 4px 7px; border: 1px solid var(--el-border-color-lighter); border-radius: 999px; font-size: 12px; color: var(--el-text-color-secondary); }
.toolItem.completed { color: var(--el-color-success); }
.spin { animation: spin 1s linear infinite; }
.composer { padding: 10px 12px 12px; border-top: 1px solid var(--el-border-color-lighter); background: var(--el-bg-color-overlay); }
.quickActions { display: flex; gap: 6px; margin-bottom: 7px; }
.composerFooter { margin-top: 8px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.composerFooter span { font-size: 11px; color: var(--el-text-color-placeholder); }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
