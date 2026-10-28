<template>
  <section v-if="project || loadError" class="originalNavigation" aria-label="原创制作流程">
    <template v-if="project">
      <div class="workflowHeading">
        <strong>{{ project.mode === 'adaptation' ? '小说改编' : '原创短剧' }}</strong><span>阶段画布 · 内容自动保存</span>
        <originalProduction :key="directory" :directory="directory" :brief="project.brief" :ready="ready" :activate="activate" @update="production = $event" @openSettings="emit('openSettings')" />
      </div>
      <nav class="stageList" aria-label="制作阶段">
        <button v-for="(stage, index) in originalStages" :key="stage.id" class="stageButton" :class="{ active: currentCanvas === stageFile(stage.id, stage.file), completed: !!production?.canvases[stage.id] }" type="button" :aria-current="currentCanvas === stageFile(stage.id, stage.file) ? 'step' : undefined" :disabled="!ready || !!opening" :title="stage.brief" @click="openStage(stageFile(stage.id, stage.file))">
          <span>{{ production?.canvases[stage.id] ? '✓' : index + 1 }}</span>{{ stage.label }}
        </button>
      </nav>
    </template>
    <div v-if="loadError" class="workflowError" role="alert">{{ loadError }}<el-button size="small" text @click="loadProject">重新读取</el-button></div>
  </section>
</template>

<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import { originalStages, type OriginalProject } from "@/lib/originalWorkflow";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import type { OriginalRun } from "@toonflow/server/original";
import originalProduction from "./originalProduction.vue";

const props = defineProps<{ directory: string; currentCanvas: string; ready: boolean; activate: (file: string) => Promise<void> }>();
const emit = defineEmits<{ openSettings: [] }>();
const project = ref<OriginalProject>();
const production = ref<OriginalRun | null>(null);
const loadError = ref("");
const opening = ref("");
let request: AbortController | undefined;

async function loadProject() {
  request?.abort();
  const controller = request = new AbortController();
  project.value = undefined;
  production.value = null;
  loadError.value = "";
  if (!props.directory) return;
  try {
    const files = useWorkspaceFiles(props.directory);
    const { entries } = await files.list("", controller.signal);
    if (!entries.some(entry => entry.path === "originalProject.json" && entry.type === "file")) return;
    const value = await files.readJson<OriginalProject>("originalProject.json", controller.signal);
    if (value?.yaohaoOriginal !== true || value.version !== 1 || !["original", "adaptation"].includes(value.mode)) throw new Error("原创项目配置格式不受支持，请检查 originalProject.json");
    if (!controller.signal.aborted) project.value = value;
  } catch (error) {
    if (!controller.signal.aborted) loadError.value = axios.isAxiosError(error) ? error.response?.data?.message || "原创项目配置读取失败" : error instanceof Error ? error.message : "原创项目配置读取失败";
  }
}

const stageFile = (stage: string, fallback: string) => production.value?.canvases[stage] || fallback;

async function openStage(file: string) {
  if (opening.value || !props.ready) return;
  opening.value = file;
  try { await props.activate(file); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "阶段画布打开失败，请重试"); }
  finally { opening.value = ""; }
}

watch(() => props.directory, loadProject, { immediate: true });
onScopeDispose(() => request?.abort());
</script>

<style lang="scss" scoped>
.originalNavigation {
  position: absolute; top: 62px; left: 15px; z-index: 5;
  max-width: calc(100% - var(--agentWidth, 0px) - 30px);
  padding: 10px 12px; border: 1px solid var(--el-border-color); border-radius: var(--ui-radius);
  background: var(--el-bg-color-overlay); box-shadow: var(--el-box-shadow-light);
  .workflowHeading { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 12px; margin-bottom: 8px; span { color: var(--el-text-color-secondary); } }
  .stageList { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 2px; }
  .stageButton {
    display: flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 7px 9px; font: inherit; font-size: 12px;
    color: var(--el-text-color-regular); background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer;
    span { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--el-fill-color); }
    &.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); border-color: var(--el-color-primary); }
    &.completed span { color: var(--el-color-success); }
    &:focus-visible { outline: 2px solid var(--el-color-primary); }
    &:disabled { cursor: wait; opacity: .6; }
  }
  .workflowError { font-size: 12px; color: var(--el-color-danger); }
}
</style>
