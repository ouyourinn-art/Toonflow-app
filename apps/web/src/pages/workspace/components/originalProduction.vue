<template>
  <el-button class="productionButton" type="primary" size="large" :disabled="!ready" @click="visible = true">
    {{ run ? `制作进度 · ${statusLabels[run.status]}` : '一键制作成片' }}
  </el-button>
  <el-dialog v-model="visible" title="一键制作" width="min(960px, calc(100vw - 32px))" appendToBody alignCenter>
    <div class="originalProduction">
      <p class="workflowDescription">短片：完整剧本后直接制作。长片：全片圣经 → 分场剧本 → 角色与场景锚点 → 逐镜生成与人脸质检 → 合成成片。关闭面板不停止后台制作。</p>
      <div v-if="statusError" class="errorBox" role="alert">{{ statusError }}<el-button text @click="refreshStatus">重新读取进度</el-button></div>
      <template v-if="editing">
        <div class="presetGrid">
          <div class="presetBar">
            <div><strong>韩国成人露骨 2 分钟竖屏短片</strong><span>原创虚构韩国成年人，8 镜 × 15 秒，人物母版锁定，图片 3 路、视频 2 路并发。</span></div>
            <el-button type="danger" size="large" :disabled="busy || !statusReady" @click="applyAdult120Preset">套用 2 分钟</el-button>
          </div>
          <div class="presetBar longPreset">
            <div><strong>韩国成人露骨 10 分钟竖屏长片</strong><span>原创虚构韩国成年人，40 镜 × 15 秒，分场锚定、逐镜验脸、跨场并发。</span></div>
            <el-button type="danger" size="large" :disabled="busy || !statusReady" @click="applyAdultLongPreset">套用 10 分钟</el-button>
          </div>
        </div>
        <el-form labelPosition="top" :disabled="busy || !statusReady">
          <el-form-item label="制作模式">
            <el-radio-group v-model="form.productionMode"><el-radio-button value="short">短片模式</el-radio-button><el-radio-button value="long">长片模式</el-radio-button></el-radio-group>
          </el-form-item>
          <el-form-item label="创作需求 / 小说原文">
            <el-input v-model="form.brief" type="textarea" :rows="4" :maxlength="50000" placeholder="填写故事、人物关系、剧情与结局；小说改编可粘贴原文。" />
          </el-form-item>
          <div class="configGrid">
            <el-form-item label="剧本与分镜模型">
              <el-select v-model="languageValue" filterable placeholder="选择已配置的 5.6sol 模型">
                <el-option v-for="model in modelChoices" :key="model.value" :value="model.value" :label="`${model.label} · ${model.providerId} / ${model.modelId}`" />
              </el-select>
            </el-form-item>
            <el-form-item label="统一视觉风格"><el-input v-model="form.style" :maxlength="1000" placeholder="例如：电影写实、暖色自然光" /></el-form-item>
            <el-form-item label="图片模型（文生图 + 多参考图）">
              <el-select v-model="imageValue" filterable placeholder="选择人物、场景及分镜图片模型">
                <el-option v-for="model in imageModels" :key="modelValue(model)" :value="modelValue(model)" :label="`${model.label} · ${model.providerLabel}`" />
              </el-select>
            </el-form-item>
            <el-form-item label="视频模型（图生视频）">
              <el-select v-model="videoValue" filterable placeholder="选择支持图片参考的视频模型">
                <el-option v-for="model in videoModels" :key="modelValue(model)" :value="modelValue(model)" :label="`${model.label} · ${model.providerLabel}`" />
              </el-select>
            </el-form-item>
            <el-form-item label="固定角色数"><el-input-number v-model="form.characterCount" :min="1" :max="20" :precision="0" /></el-form-item>
            <el-form-item label="镜头数"><el-input-number v-model="form.shotCount" :min="1" :max="form.productionMode === 'long' ? 240 : 60" :precision="0" :disabled="form.productionMode === 'long'" /></el-form-item>
            <template v-if="form.productionMode === 'long'">
              <el-form-item label="目标片长">
                <el-select v-model="form.targetDurationMinutes"><el-option v-for="minutes in [10, 20, 30]" :key="minutes" :value="minutes" :label="`${minutes} 分钟`" /></el-select>
              </el-form-item>
              <el-form-item label="场景数"><el-input-number v-model="form.sceneCount" :min="1" :max="60" :precision="0" /></el-form-item>
              <el-form-item label="单镜失败重试"><el-input-number v-model="form.maxRetries" :min="0" :max="5" :precision="0" /></el-form-item>
              <el-form-item label="视频预算上限（USD）"><el-input-number v-model="form.costLimit" :min="0" :max="100000" :step="10" :precision="2" /></el-form-item>
              <el-form-item label="单段视频估算（USD）"><el-input-number v-model="form.costPerVideo" :min="0.01" :max="10000" :step="0.01" :precision="2" /></el-form-item>
            </template>
            <el-form-item label="图片并发数"><el-input-number v-model="form.imageConcurrency" :min="1" :max="8" :precision="0" /></el-form-item>
            <el-form-item label="视频并发数"><el-input-number v-model="form.videoConcurrency" :min="1" :max="4" :precision="0" /></el-form-item>
            <el-form-item label="人物一致性质检"><el-switch v-model="form.faceQaEnabled" activeText="YuNet + SFace 抽帧验脸" /></el-form-item>
            <el-form-item label="同人脸阈值"><el-input-number v-model="form.faceThreshold" :min="-1" :max="1" :step="0.01" :precision="3" :disabled="!form.faceQaEnabled" /></el-form-item>
            <el-form-item label="露骨成人模式"><el-switch v-model="form.adultExplicit" activeText="生图、视频和分镜均使用明确成人表达" /></el-form-item>
            <el-form-item label="人物身份锁定"><el-switch v-model="form.characterLock" activeText="固定脸型、发型、体型与标志特征" /></el-form-item>
            <el-form-item label="全片连续模式"><el-switch v-model="form.continuousShots" activeText="上一镜尾帧作为下一镜首帧" /></el-form-item>
            <el-form-item label="画幅">
              <el-select v-model="form.ratio"><el-option v-for="ratio in ratios" :key="ratio" :value="ratio" :label="ratio" /></el-select>
            </el-form-item>
            <el-form-item label="单镜时长（以所选视频模型声明为准）">
              <el-select v-model="form.duration" :disabled="!durations.length"><el-option v-for="duration in durations" :key="duration" :value="duration" :label="`${duration} 秒`" /></el-select>
            </el-form-item>
            <el-form-item label="视频分辨率">
              <el-select v-model="form.resolution" :disabled="!resolutions.length"><el-option v-for="resolution in resolutions" :key="resolution" :value="resolution" :label="resolution" /></el-select>
            </el-form-item>
            <el-form-item label="最终合成"><el-switch v-model="form.stitch" activeText="按镜头顺序自动合成 MP4" /></el-form-item>
          </div>
        </el-form>
        <p v-if="form.adultExplicit" class="adultNotice">成人模式仅构建 25 岁以上、原创虚构、清醒且自愿的角色。系统会发送无遮挡的明确提示词；最终画面仍可能被所选上游模型自行弱化。</p>
        <div class="modelHelp">
          <span>语言、图片与视频分别调用所选供应商；语言 Key 不会自动用于媒体服务。</span>
          <el-button text :loading="loadingModels" @click="loadModels">刷新模型列表</el-button>
          <el-button text @click="openSettings">配置模型</el-button>
        </div>
        <p v-if="modelError || validationError" class="errorText" role="alert">{{ modelError || validationError }}</p>
        <p class="costNotice">预计 {{ form.shotCount * form.duration }} 秒{{ form.stitch ? '，合成后按目标时长精确裁切' : '' }}；图片至少 {{ form.characterCount + form.sceneCount + form.shotCount }} 张；视频首轮 {{ form.shotCount }} 段；图片并发 {{ form.imageConcurrency }}，视频并发 {{ form.videoConcurrency }}。<template v-if="form.productionMode === 'long'">首轮估算 {{ firstPassCost }} USD，全部重试上限估算 {{ retryCost }} USD，实际提交受 {{ form.costLimit || '不限' }} USD 预算约束。</template> 生成按供应商实际规则计费。</p>
        <div class="actions">
          <el-button v-if="newVersion" :disabled="busy" @click="newVersion = false">返回当前进度</el-button>
          <el-button type="primary" size="large" :loading="busy" :disabled="!canStart" @click="startProduction">{{ run ? '新建一版并开始制作' : '开始一键制作' }}</el-button>
        </div>
      </template>
      <template v-else-if="run">
        <div class="progressHeading"><strong>{{ run.plan?.title || (run.config.productionMode === 'long' ? '正在构建全片圣经与分场剧本' : '正在编写完整剧本') }}</strong><span>{{ statusLabels[run.status] }} · {{ completedCount }}/{{ run.tasks.length }} 步</span></div>
        <el-progress :percentage="progress" :status="run.status === 'completed' ? 'success' : run.status === 'failed' ? 'exception' : undefined" />
        <p class="runSummary">{{ run.config.productionMode === 'long' ? `${run.config.targetDurationMinutes} 分钟长片 · ${run.config.sceneCount} 场` : '短片' }} · {{ run.config.characterCount }} 个角色 · {{ run.config.shotCount }} 个镜头 · {{ run.config.ratio }} · 每镜 {{ run.config.duration }} 秒 · {{ run.config.characterLock ? '人物锁定' : '普通身份一致' }} · {{ run.config.continuousShots ? '同场尾帧连续' : '身份分镜首帧' }} · 图片并发 {{ run.config.imageConcurrency }} / 视频并发 {{ run.config.videoConcurrency }} · {{ run.config.adultExplicit ? '露骨成人' : '常规内容' }} · 语言模型 {{ run.config.language.modelId }}<template v-if="run.config.productionMode === 'long'"> · 视频估算已用 {{ run.estimatedCost || 0 }} / {{ run.config.costLimit || '不限' }} USD</template></p>
        <p v-if="run.status === 'pausing'" class="runSummary">当前请求完成并保存后暂停。</p>
        <div v-if="run.error" class="errorBox" role="alert">{{ run.error }}</div>
        <div class="actions">
          <el-button v-if="run.status === 'running'" :loading="busy" @click="controlProduction('pause')">完成当前步骤后暂停</el-button>
          <el-button v-if="canResume" type="primary" :loading="busy" :disabled="!statusReady" @click="resumeProduction">继续未完成步骤</el-button>
          <el-button v-if="!running" :disabled="busy || !statusReady" @click="prepareNewVersion">新建一版</el-button>
          <el-button v-if="run.canvases.export" type="success" :disabled="!ready" @click="openCanvas(run.canvases.export)">查看成片</el-button>
        </div>
        <p class="runSummary">已完成素材会复用。失败后手动继续；上次结果不明的请求，需核对上游记录再重试。</p>
        <div class="taskList" aria-label="制作步骤">
          <details v-for="task in run.tasks" :key="task.id" class="taskItem" :open="task.status === 'running' || task.status === 'failed'">
            <summary><span :class="['taskStatus', task.status]">{{ taskLabels[task.status] }}</span><span>{{ task.label }}</span></summary>
            <p v-if="task.error" class="errorText">{{ task.error }}</p>
            <p v-if="task.references?.length" class="runSummary">参考资产：{{ task.references.join('、') }}</p>
            <p v-if="task.referenceFrame" class="runSummary">实际视频首帧：{{ task.referenceFrame }}</p>
            <p v-if="task.attempts" class="runSummary">已提交 {{ task.attempts }} 次</p>
            <p v-if="task.qa" :class="task.qa.passed ? 'qaPassed' : 'errorText'">人脸 QA：{{ task.qa.passed ? '通过' : task.qa.reasons.join('；') }} · 抽帧 {{ task.qa.sampledFrames }} · 检出 {{ task.qa.detectedFrames }}</p>
            <pre v-if="task.prompt" class="promptText">{{ task.prompt }}</pre>
            <div v-for="file in task.files" :key="file.path" class="resultFile">{{ file.path }}</div>
          </details>
        </div>
        <p v-if="run.usage" class="runSummary">剧本请求用量：输入 {{ run.usage.input }} / 输出 {{ run.usage.output }} / 总计 {{ run.usage.totalTokens }} tokens。</p>
      </template>
      <div v-if="actionError" class="errorBox" role="alert">{{ actionError }}</div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from "vue";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import type { MediaModel } from "@toonflow/tools-scaffold/runtime";
import type { OriginalConfig, OriginalRun } from "@toonflow/server/original";
import { modelChoices } from "@/stores/settings";

const props = defineProps<{ directory: string; brief: string; ready: boolean; activate: (file: string) => Promise<void> }>();
const emit = defineEmits<{ update: [value: OriginalRun | null]; openSettings: [] }>();
const visible = ref(false);
const run = ref<OriginalRun | null>(null);
const newVersion = ref(false);
const busy = ref(false);
const statusReady = ref(false);
const statusError = ref("");
const actionError = ref("");
const modelError = ref("");
const loadingModels = ref(false);
const models = shallowRef<MediaModel[]>([]);
const languageValue = ref("");
const imageValue = ref("");
const videoValue = ref("");
type ProductionForm = Omit<OriginalConfig, "language" | "image" | "video">;
const form = reactive<ProductionForm>({
  productionMode: "short", brief: props.brief, style: "电影写实", characterCount: 3, shotCount: 6,
  targetDurationMinutes: 10, sceneCount: 1, maxRetries: 0, costLimit: 0, costPerVideo: 2.01,
  faceQaEnabled: false, faceThreshold: 0.363, ratio: "9:16", duration: 15, resolution: "", stitch: true,
  adultExplicit: false, characterLock: true, continuousShots: false, imageConcurrency: 3, videoConcurrency: 2,
});
const statusLabels = { running: "进行中", pausing: "等待暂停", paused: "已暂停", failed: "执行失败", completed: "已完成", interrupted: "服务中断，待恢复" };
const taskLabels = { pending: "待执行", running: "进行中", completed: "已完成", failed: "失败" };
const headers = { "x-toonflow-workspace": "1" };
const lifetime = new AbortController();
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
const modelValue = (model: MediaModel) => JSON.stringify([model.providerId, model.modelId]);
const editing = computed(() => !run.value || newVersion.value);
const running = computed(() => run.value?.status === "running" || run.value?.status === "pausing");
const canResume = computed(() => !!run.value && ["paused", "failed", "interrupted"].includes(run.value.status));
const completedCount = computed(() => run.value?.tasks.filter(task => task.status === "completed").length ?? 0);
const progress = computed(() => run.value?.tasks.length ? Math.floor(completedCount.value / run.value.tasks.length * 100) : 0);
const firstPassCost = computed(() => Number((form.shotCount * form.costPerVideo).toFixed(2)));
const retryCost = computed(() => Number((form.shotCount * (form.maxRetries + 1) * form.costPerVideo).toFixed(2)));
const imageModels = computed(() => models.value.filter(model => model.type === "image" && Array.isArray(model.mode) && model.mode.includes("text") && model.mode.includes("multiReference")));
const videoModels = computed(() => models.value.filter(model => model.type === "video" && model.durationResolutionMap?.length && Array.isArray(model.mode) && model.mode.some(mode => ["singleImage", "startFrameOptional", "endFrameOptional"].includes(mode) || Array.isArray(mode) && mode.some(value => typeof value === "string" && /^imageReference:[1-9]\d*$/.test(value)))));
const selectedImage = computed(() => imageModels.value.find(model => modelValue(model) === imageValue.value));
const selectedVideo = computed(() => videoModels.value.find(model => modelValue(model) === videoValue.value));
const ratios = computed(() => (["16:9", "9:16", "1:1"] as const).filter(ratio => !selectedImage.value?.imageRatios?.length || selectedImage.value.imageRatios.includes(ratio)));
const durations = computed(() => [...new Set(selectedVideo.value?.durationResolutionMap?.flatMap(item => item.resolution.length ? item.duration : []).filter(value => Number.isInteger(value) && value > 0 && value <= 60) ?? [])].sort((a, b) => a - b));
const resolutions = computed(() => [...new Set(selectedVideo.value?.durationResolutionMap?.filter(item => item.duration.includes(form.duration)).flatMap(item => item.resolution) ?? [])]);
const validationError = computed(() => {
  if (!modelChoices.value.some(model => model.value === languageValue.value)) return "请先配置并选择剧本模型，使用上游真实模型 ID。";
  if (!selectedImage.value) return "请选择支持文生图与多参考图的图片模型。";
  if (!selectedVideo.value) return "请选择支持图片参考、并声明时长和分辨率的视频模型。";
  if (!ratios.value.includes(form.ratio) || !durations.value.includes(form.duration) || !resolutions.value.includes(form.resolution)) return "请按所选模型支持的范围选择画幅、时长与分辨率。";
  if (!form.brief.trim()) return "请填写创作需求。";
  if (!Number.isInteger(form.characterCount) || form.characterCount < 1 || form.characterCount > 20 || !Number.isInteger(form.shotCount) || form.shotCount < 1 || form.shotCount > (form.productionMode === "long" ? 240 : 60)) return "角色数和镜头数须在允许范围内。";
  if (form.productionMode === "long") {
    if (form.shotCount * form.duration !== form.targetDurationMinutes * 60) return "长片镜头数必须精确覆盖目标片长。";
    if (!Number.isInteger(form.sceneCount) || form.sceneCount < 1 || form.sceneCount > form.shotCount) return "长片场景数须小于或等于镜头数。";
    if (Math.ceil(form.shotCount / form.sceneCount) > 12) return "每场最多 12 镜，请增加长片场景数。";
    if (form.costLimit > 0 && firstPassCost.value > form.costLimit) return `预算上限至少需要覆盖首轮估算 ${firstPassCost.value} USD。`;
  }
  return "";
});
const canStart = computed(() => props.ready && statusReady.value && !busy.value && !running.value && !loadingModels.value && !modelError.value && !validationError.value);

function errorMessage(error: unknown) {
  return axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "操作失败，请重试";
}

function applyRun(value: OriginalRun | null) {
  if (value && run.value && value.updatedAt < run.value.updatedAt) return;
  if (value && value.id !== run.value?.id && !newVersion.value) {
    Object.assign(form, value.config);
    languageValue.value = JSON.stringify([value.config.language.providerId, value.config.language.modelId]);
    imageValue.value = JSON.stringify([value.config.image.providerId, value.config.image.modelId]);
    videoValue.value = JSON.stringify([value.config.video.providerId, value.config.video.modelId]);
  }
  run.value = value;
  emit("update", value);
}

async function refreshStatus() {
  if (polling || lifetime.signal.aborted) return;
  polling = true;
  const requestedId = run.value?.id;
  try {
    const { data } = await axios.post<{ code: number; data: OriginalRun | null; message: string }>("/api/original/status", { directory: props.directory }, { headers, signal: lifetime.signal });
    if (data.code !== 200) throw new Error(data.message);
    if (lifetime.signal.aborted) return;
    if (data.data === null && run.value?.id !== requestedId) return;
    applyRun(data.data);
    statusReady.value = true;
    statusError.value = "";
  } catch (error) {
    if (!lifetime.signal.aborted) { statusError.value = errorMessage(error); statusReady.value = false; }
  } finally { polling = false; }
}

async function poll() {
  if (!busy.value) await refreshStatus();
  if (!lifetime.signal.aborted) pollTimer = setTimeout(poll, running.value ? 2000 : 5000);
}

async function loadModels() {
  if (loadingModels.value) return;
  loadingModels.value = true;
  modelError.value = "";
  try {
    const { data } = await axios.get<{ code: number; data: MediaModel[]; message: string }>("/api/ai/media/models", { headers, signal: lifetime.signal });
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "媒体模型列表无效");
    if (!lifetime.signal.aborted) models.value = data.data;
  } catch (error) { if (!lifetime.signal.aborted) modelError.value = errorMessage(error); }
  finally { loadingModels.value = false; }
}

function selection(value: string) {
  const [providerId, modelId] = JSON.parse(value) as [string, string];
  return { providerId, modelId };
}

function applyAdult120Preset() {
  Object.assign(form, {
    productionMode: "short",
    style: "原创虚构韩国成年人，现代韩国人物造型与环境细节，不仿照真实人物；成熟二次元成人动画，电影级柔光，稳定一致的角色设计，连贯空间与镜头语言",
    characterCount: 3, shotCount: 8, ratio: "9:16", duration: 15, stitch: true,
    targetDurationMinutes: 10, sceneCount: 1, maxRetries: 2, costLimit: 0, costPerVideo: 2.01,
    faceQaEnabled: true, faceThreshold: 0.363, adultExplicit: true, characterLock: true, continuousShots: false,
    imageConcurrency: 3, videoConcurrency: 2,
  } satisfies Partial<ProductionForm>);
  selectAdultModels();
}

function selectAdultModels() {
  const video = videoModels.value.find(model => model.modelId.trim().toLowerCase() === "seedance-2.0-white")
    ?? videoModels.value.find(model => /(?:^|\s)seedance[-_. ]?2\.0(?:[-_. ]?white)?(?:\s|$)/i.test(`${model.modelId} ${model.label}`));
  if (video) {
    videoValue.value = modelValue(video);
    const choices = video.durationResolutionMap?.filter(item => item.duration.includes(15)).flatMap(item => item.resolution) ?? [];
    form.resolution = choices.includes("480p") ? "480p" : choices[0] ?? "";
  }
  const image = imageModels.value.find(model => model.modelId.trim().toLowerCase() === "seedream-5.0-white")
    ?? imageModels.value.find(model => /seedream[-_. ]?5\.0.*white/i.test(`${model.modelId} ${model.label}`))
    ?? imageModels.value.find(model => /gpt[-_. ]?image[-_. ]?2\.5/i.test(`${model.modelId} ${model.label}`));
  if (image) imageValue.value = modelValue(image);
}

function applyAdultLongPreset() {
  Object.assign(form, {
    productionMode: "long",
    style: "原创虚构韩国成年人，现代韩国人物造型与环境细节，不仿照真实人物；成熟二次元成人动画，电影级柔光，固定角色设计，分场连续的专业长片镜头语言",
    characterCount: 3, shotCount: 40, targetDurationMinutes: 10, sceneCount: 8,
    ratio: "9:16", duration: 15, stitch: true, maxRetries: 2, costLimit: 150, costPerVideo: 2.01,
    faceQaEnabled: true, faceThreshold: 0.363, adultExplicit: true, characterLock: true, continuousShots: true,
    imageConcurrency: 3, videoConcurrency: 2,
  } satisfies Partial<ProductionForm>);
  selectAdultModels();
}

async function startProduction() {
  if (!canStart.value) return;
  busy.value = true;
  actionError.value = "";
  try {
    const config: OriginalConfig = { ...form, language: selection(languageValue.value), image: selection(imageValue.value), video: selection(videoValue.value) };
    const { data } = await axios.post<{ code: number; data: OriginalRun; message: string }>("/api/original/start", { directory: props.directory, runId: crypto.randomUUID(), previousRunId: run.value?.id, config }, { headers, signal: lifetime.signal });
    if (data.code !== 200) throw new Error(data.message);
    if (!lifetime.signal.aborted) { newVersion.value = false; applyRun(data.data); }
  } catch (error) { if (!lifetime.signal.aborted) { actionError.value = errorMessage(error); await refreshStatus(); } }
  finally { busy.value = false; }
}

async function controlProduction(action: "pause" | "resume", acceptUncertain = false) {
  if (busy.value || !run.value) return;
  busy.value = true;
  actionError.value = "";
  try {
    const { data } = await axios.post<{ code: number; data: OriginalRun; message: string }>("/api/original/control", { directory: props.directory, runId: run.value.id, action, acceptUncertain }, { headers, signal: lifetime.signal });
    if (data.code !== 200) throw new Error(data.message);
    if (!lifetime.signal.aborted) applyRun(data.data);
  } catch (error) { if (!lifetime.signal.aborted) { actionError.value = errorMessage(error); await refreshStatus(); } }
  finally { busy.value = false; }
}

async function resumeProduction() {
  let acceptUncertain = false;
  if (run.value?.status === "interrupted" || run.value?.tasks.some(task => task.status === "running")) {
    try {
      await ElMessageBox.confirm("服务器中断前的请求可能已经提交并计费。请先核对供应商任务记录；继续会重试未保存结果的步骤，可能再次计费。", "恢复制作", { type: "warning", confirmButtonText: "已核对，重试未完成步骤", cancelButtonText: "暂不重试" });
      acceptUncertain = true;
    } catch { return; }
  }
  if (!lifetime.signal.aborted) await controlProduction("resume", acceptUncertain);
}

function prepareNewVersion() {
  if (!run.value) return;
  Object.assign(form, run.value.config);
  languageValue.value = JSON.stringify([run.value.config.language.providerId, run.value.config.language.modelId]);
  imageValue.value = JSON.stringify([run.value.config.image.providerId, run.value.config.image.modelId]);
  videoValue.value = JSON.stringify([run.value.config.video.providerId, run.value.config.video.modelId]);
  newVersion.value = true;
  actionError.value = "";
  void loadModels();
}

async function openCanvas(file: string) {
  try { await props.activate(file); visible.value = false; }
  catch (error) { ElMessage.error(errorMessage(error)); }
}

function openSettings() { visible.value = false; emit("openSettings"); }

watch(visible, value => { if (value) { void refreshStatus(); void loadModels(); } });
watch(modelChoices, choices => {
  if (!languageValue.value) languageValue.value = choices.find(model => /5[.\-]?6.*sol|sol.*5[.\-]?6/i.test(`${model.modelId} ${model.label}`))?.value ?? "";
}, { immediate: true });
watch(ratios, values => { if (!values.includes(form.ratio) && values[0]) form.ratio = values[0]; });
watch(durations, values => { if (!values.includes(form.duration)) form.duration = values.includes(15) ? 15 : values[0] ?? 0; });
watch(resolutions, values => { if (!values.includes(form.resolution)) form.resolution = values[0] ?? ""; });
watch(() => [form.productionMode, form.targetDurationMinutes, form.duration] as const, ([mode, minutes, duration], previous) => {
  if (mode !== "long" || !duration) return;
  form.shotCount = Math.ceil(minutes * 60 / duration);
  if (!previous || previous[0] !== mode || previous[1] !== minutes || previous[2] !== duration) form.sceneCount = Math.min(60, Math.max(1, Math.ceil(form.shotCount / 5)));
});
void poll();
onScopeDispose(() => { lifetime.abort(); clearTimeout(pollTimer); });
</script>

<style lang="scss" scoped>
.productionButton { min-width: 150px; font-weight: 600; }
.originalProduction {
  max-height: 72vh; overflow-y: auto; padding: 0 6px 4px;
  .workflowDescription, .costNotice, .runSummary { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; margin: 8px 0 14px; }
  .presetGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0 18px; }
  .presetBar { display: flex; justify-content: space-between; align-items: center; gap: 18px; padding: 16px; border: 1px solid var(--el-color-danger-light-5); border-radius: 10px; background: var(--el-color-danger-light-9); div { display: flex; flex-direction: column; gap: 5px; } span { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; } &.longPreset { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); } }
  .adultNotice { color: var(--el-color-danger); background: var(--el-color-danger-light-9); border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.7; }
  .configGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
  .modelHelp, .actions, .progressHeading { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .modelHelp { font-size: 12px; color: var(--el-text-color-secondary); }
  .actions { margin: 16px 0; }
  .progressHeading { justify-content: space-between; margin: 16px 0; span { color: var(--el-text-color-secondary); } }
  .errorBox { border: 1px solid var(--el-color-danger-light-5); background: var(--el-color-danger-light-9); color: var(--el-color-danger); padding: 12px; border-radius: 8px; margin: 12px 0; overflow-wrap: anywhere; white-space: pre-wrap; }
  .errorText { color: var(--el-color-danger); font-size: 12px; white-space: pre-wrap; }
  .qaPassed { color: var(--el-color-success); font-size: 12px; }
  .taskList { border: 1px solid var(--el-border-color); border-radius: 8px; }
  .taskItem {
    border-bottom: 1px solid var(--el-border-color); padding: 12px;
    &:last-child { border-bottom: 0; }
    summary { display: flex; gap: 12px; align-items: center; cursor: pointer; font-size: 13px; }
    .taskStatus { color: var(--el-text-color-secondary); flex-shrink: 0; &.completed { color: var(--el-color-success); } &.running { color: var(--el-color-primary); } &.failed { color: var(--el-color-danger); } }
    .promptText { font: inherit; font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--el-fill-color-light); padding: 12px; border-radius: 6px; max-height: 300px; overflow-y: auto; }
    .resultFile { font-size: 12px; overflow-wrap: anywhere; margin: 8px 0; }
  }
  @media (max-width: 640px) { .configGrid, .presetGrid { grid-template-columns: 1fr; } .presetBar { align-items: stretch; flex-direction: column; } }
}
</style>
