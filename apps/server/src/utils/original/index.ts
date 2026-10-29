import { z } from "zod";
import { dirname } from "node:path";
import { mkdir, readFile, stat } from "@toonflow/file";
import type { GeneratedMedia, MediaGenerationRequest, MediaModel } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { getConfiguredModel, readAiReferences, streamAi } from "@/utils/ai";
import { generateMedia, listMediaModels } from "@/utils/media/generation";
import { getMediaProvider, loadMediaProviderSource } from "@/utils/media/provider";
import { createWorkspaceFfmpeg, prepareWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { lockWorkspaceFiles, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";
import { inspectVideoFaces, prepareFaceQa } from "./faceQa";
import { buildLongBiblePrompt, buildLongMediaTasks, buildLongScenePrompt, composeLongPlan, validateLongBible, validateLongScene } from "./longProduction";
import { longBibleSchema, longScenePlanSchema, type LongScenePlan } from "./longTypes";
import { adultDirection, buildAssetPrompt, buildFaceCorrectionPrompt, buildImagePrompt, buildVideoPrompt, explicitStartShot, faceQaApplicable, storyArcInstruction, storyBeatOrder, timingInstruction } from "./prompt";
import { originalPlanSchema, originalRunSchema, type OriginalConfig, type OriginalPlan, type OriginalRun, type OriginalTask } from "./types";

type Control = { state: OriginalRun; pause: boolean; saving: Promise<void> };
const active = new Map<string, Control>();
const changing = new Set<string>();
const stageNames = { story: "stage01Story.json", script: "stage02Script.json", assets: "stage03Assets.json", storyboard: "stage04Storyboard.json", images: "stage05Images.json", videos: "stage06Videos.json", export: "stage07Export.json" };
const key = (cwd: string) => process.platform === "win32" ? cwd.toLowerCase() : cwd;
const runDirectory = (state: OriginalRun) => `originalRuns/${state.id}`;
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
const adultImageQaSchema = z.strictObject({
  passed: z.boolean(),
  anatomy: z.number().int().min(0).max(100), connection: z.number().int().min(0).max(100),
  realism: z.number().int().min(0).max(100), visibility: z.number().int().min(0).max(100),
  reasons: z.array(z.string().trim().min(1).max(1000)).max(20),
  correctionPrompt: z.string().trim().max(4000),
});

async function readJson(cwd: string, file: string) {
  const { path } = await resolveWorkspacePath(cwd, file);
  const info = await stat(path);
  if (!info.isFile() || info.size > 5 * 1024 * 1024) fail("项目数据文件无效或超过 5 MB");
  return JSON.parse(await readFile(path, "utf8"));
}

async function write(cwd: string, file: string, value: string, exclusive = false) {
  const target = await resolveWorkspacePath(cwd, file, true);
  const release = lockWorkspaceFiles([target.path]);
  try {
    await mkdir(dirname(target.path), { recursive: true });
    const checked = await resolveWorkspacePath(cwd, file);
    await writeWorkspaceFile(checked.path, value, exclusive);
  } finally { release(); }
}

function save(cwd: string, control: Control) {
  control.state.updatedAt = Date.now();
  const snapshot = JSON.stringify(control.state, null, 2);
  const saving = control.saving.then(() => write(cwd, "originalRun.json", snapshot));
  control.saving = saving.catch(() => {});
  return saving;
}

export async function status(cwd: string): Promise<OriginalRun | null> {
  const running = active.get(key(cwd));
  if (running) return structuredClone(running.state);
  try {
    const state = originalRunSchema.parse(await readJson(cwd, "originalRun.json"));
    if (state.status === "running" || state.status === "pausing") {
      state.status = "interrupted";
      state.error = "服务已重启，上次进行中的请求结果待核对；已完成步骤保留。";
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function videoMode(model: MediaModel): MediaGenerationRequest["mode"] {
  const modes = Array.isArray(model.mode) ? model.mode : [];
  for (const mode of ["startFrameOptional", "endFrameOptional", "singleImage"] as const) if (modes.includes(mode)) return mode;
  const references = modes.find(item => Array.isArray(item) && item.some(value => typeof value === "string" && /^imageReference:[1-9]\d*$/.test(value)));
  if (references) return references;
  return fail("视频模型需要声明首帧或图片参考能力，请选择图生视频模型");
}

async function preflight(config: OriginalConfig) {
  const language = getConfiguredModel(config.language.providerId, config.language.modelId);
  if (!language.provider.apiKey.trim()) fail("请先配置语言模型 API Key");
  if (config.productionMode === "long") {
    if (config.shotCount * config.duration !== config.targetDurationMinutes * 60) fail("长片镜头数与目标分钟数不一致");
    if (config.sceneCount > config.shotCount) fail("长片场景数不能超过镜头数");
    if (Math.ceil(config.shotCount / config.sceneCount) > 12) fail("每场最多 12 镜，请增加长片场景数");
  }
  if (config.planningOnly) return { image: undefined, video: undefined };
  if (config.adultExplicit && [config.image, config.video].some(selection => !selection || selection.providerId !== "shugando" || !/(?:^|[-_.])white$/i.test(selection.modelId.trim()))) {
    fail("露骨成人模式必须同时使用 Shugando 开白图片模型和开白视频模型，不能回落到普通媒体模型");
  }
  if (config.productionMode === "long" && config.costLimit > 0 && config.shotCount * config.costPerVideo > config.costLimit) fail(`预算上限不足：首轮视频预计 ${Number((config.shotCount * config.costPerVideo).toFixed(2))} USD`);
  if (config.faceQaEnabled) await prepareFaceQa();
  const models = await listMediaModels();
  if (!config.image || !config.video) return fail("完整制作需要同时配置图片和视频模型；只生成 JSON 可不配置媒体模型");
  const image = models.find(model => model.type === "image" && model.providerId === config.image!.providerId && model.modelId === config.image!.modelId);
  const video = models.find(model => model.type === "video" && model.providerId === config.video!.providerId && model.modelId === config.video!.modelId);
  if (!image || !video) return fail("图片或视频模型已不存在，请重新选择");
  if (!Array.isArray(image.mode) || !image.mode.includes("text") || !image.mode.includes("multiReference")) fail("人物资产与分镜图需要文生图和多参考图能力，请选择同时支持 text、multiReference 的图片模型");
  if (image.imageRatios?.length && !image.imageRatios.includes(config.ratio)) fail("图片模型不支持所选画幅");
  videoMode(video);
  if (!video.durationResolutionMap?.some(item => item.duration.includes(config.duration) && item.resolution.includes(config.resolution))) fail("视频模型不支持所选时长和分辨率组合，请按模型实际能力选择");
  for (const selection of [config.image, config.video]) {
    const info = await getMediaProvider(selection.providerId);
    const configs = conf.get("settings", {}).mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
    const provider = await loadMediaProviderSource(info.source, configs?.[info.id] ?? {});
    if (provider.rules?.some(rule => rule.field === "apiKey") && (typeof provider.config.apiKey !== "string" || !provider.config.apiKey.trim())) fail(`请先配置媒体供应商 ${info.label} 的 API Key`);
  }
  if (config.stitch || config.continuousShots) await prepareWorkspaceFfmpeg();
  return { image, video };
}

function validatePlan(plan: OriginalPlan, config: OriginalConfig) {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const asset of plan.assets) {
    if (ids.has(asset.id)) fail(`资产 ID 重复：${asset.id}`);
    ids.add(asset.id);
    if (asset.kind === "character") {
      for (const name of new Set([asset.name, ...asset.aliases].map(value => value.trim().toLowerCase()))) {
        if (names.has(name)) fail(`角色姓名或别名重复：${name}。请核对剧本角色表。`);
        names.add(name);
      }
    }
  }
  if (plan.assets.filter(asset => asset.kind === "character").length !== config.characterCount) fail("剧本角色数量与锁定数量不一致，已在生图前停止");
  if (plan.shots.length !== config.shotCount) fail("分镜数量与指定数量不一致，已在生图前停止");
  const shotIds = new Set<string>();
  for (const shot of plan.shots) {
    if (shotIds.has(shot.id)) fail(`分镜 ID 重复：${shot.id}`);
    shotIds.add(shot.id);
    if (!plan.assets.some(asset => asset.id === shot.sceneId && asset.kind === "scene")) fail(`分镜 ${shot.id} 引用了不存在的场景`);
    if (new Set(shot.characterIds).size !== shot.characterIds.length || shot.characterIds.length > 3 || shot.characterIds.some(id => !plan.assets.some(asset => asset.id === id && asset.kind === "character"))) fail(`分镜 ${shot.id} 的角色引用无效或超过 3 人`);
    if (shot.startSecond !== plan.shots.indexOf(shot) * config.duration || shot.endSecond !== shot.startSecond + config.duration) fail(`分镜 ${shot.id} 的绝对时间轴不连续`);
    if (!shot.storyBeat || !shot.shotPurpose || !shot.framing) fail(`分镜 ${shot.id} 缺少剧情节拍、镜头目的或景别`);
    const layout = shot.characterLayout ?? fail(`分镜 ${shot.id} 缺少人物区域`);
    const layoutIds = layout.map(item => item.characterId);
    if (layoutIds.length !== shot.characterIds.length || new Set(layoutIds).size !== layoutIds.length || layoutIds.some(id => !shot.characterIds.includes(id)) || new Set(layout.map(item => item.screenRegion)).size !== layout.length) fail(`分镜 ${shot.id} 的人物区域未与实际出场角色一一绑定`);
  }
  const requiredBeats = storyBeatOrder(config);
  const beats = new Set(plan.shots.map(shot => shot.storyBeat));
  const missingBeats = requiredBeats.filter(beat => !beats.has(beat));
  if (missingBeats.length) fail(`完整剧情缺少必要节拍：${missingBeats.join("、")}`);
  const beatOrder = storyBeatOrder(config);
  let previousBeat = -1;
  for (const [index, shot] of plan.shots.entries()) {
    const currentBeat = beatOrder.indexOf(shot.storyBeat!);
    if (currentBeat < 0) fail(`分镜 ${shot.id} 使用了当前模式不允许的剧情节拍：${shot.storyBeat}`);
    if (currentBeat < previousBeat) fail(`分镜 ${shot.id} 的剧情节拍倒退；必须按 ${beatOrder.join(" → ")} 推进`);
    previousBeat = currentBeat;
    if (config.adultExplicit && index < explicitStartShot(config) && shot.storyBeat === "explicitAction") fail(`分镜 ${shot.id} 过早进入明确成人动作；前 ${explicitStartShot(config)} 镜必须先完成铺垫与明确同意`);
  }
  for (const [index, beat] of beatOrder.entries()) {
    const first = plan.shots.findIndex(shot => shot.storyBeat === beat);
    const previous = index > 0 ? plan.shots.findIndex(shot => shot.storyBeat === beatOrder[index - 1]) : -1;
    if (index > 0 && first <= previous) fail(`剧情节拍顺序错误：${beatOrder.join(" → ")}`);
  }
  if (config.adultExplicit && plan.shots.findIndex(shot => shot.storyBeat === "explicitAction") !== explicitStartShot(config)) fail(`明确成人动作必须从第 ${explicitStartShot(config) + 1} 镜开始，使铺垫按单镜粒度控制在开头约 15%`);
  if (config.shotCount > 1 && plan.shots.at(-1)?.storyBeat !== "aftermath") fail("最后一镜必须是 aftermath，完成剧情收束");
  if (config.adultExplicit) {
    const text = plan.shots.map(shot => `${shot.shotPurpose} ${shot.framing} ${shot.action} ${shot.imagePrompt} ${shot.videoPrompt}`).join("\n");
    if (!/(生殖器|阴茎|阴道|外阴|genital).{0,40}(特写|近景|close[ -]?up)|(特写|近景|close[ -]?up).{0,40}(生殖器|阴茎|阴道|外阴|genital)/i.test(text)) fail("露骨成人剧情缺少无遮挡的生殖器细节特写");
    if (!/(性交|插入|交合|penetrat|intercourse)/i.test(text)) fail("露骨成人剧情缺少明确的双方自愿性交镜头");
  }
  if (config.continuousShots) {
    for (const [index, shot] of plan.shots.entries()) {
      if (!shot.startState || !shot.endState || index > 0 && !shot.continuity) fail(`分镜 ${shot.id} 缺少连续状态，已在生图前停止`);
    }
  }
  const used = new Set(plan.shots.flatMap(shot => [...shot.characterIds, shot.sceneId]));
  if (plan.assets.some(asset => !used.has(asset.id))) fail("资产表包含未在任何镜头出场的人物或场景，已在生图前停止");
}

function reinforceAdultSingleShot(plan: OriginalPlan, config: OriginalConfig) {
  if (!config.adultExplicit || config.shotCount !== 1) return;
  const shot = plan.shots[0]!;
  shot.storyBeat = "explicitAction";
  shot.shotPurpose = "以真实成年人体解剖为最高优先级，完整呈现无遮挡的阴茎插入阴道特写与连续性交动作；不得以亲吻、拥抱、远景、腿部遮挡或镜外暗示替代。";
  shot.framing = "竖屏 9:16，摄影机固定在床面骨盆高度，15 秒全程保持下腹部、耻骨区、大腿根部和交合部位的极近景；不向上移动到脸部，不切镜，不改变拍摄轴线，阴茎根部、阴茎体、龟头、女性外阴与阴道口始终处于清晰焦平面。";
  shot.action = "0-3 秒：两名明确成年且自愿的角色保持骨盆贴合，阴茎从男性耻骨区自然延伸，龟头已通过女性外阴唇进入阴道口，插入点和骨盆方向清楚可见。3-12 秒：男性骨盆沿阴茎轴线做小幅、稳定、连续的前后运动，后撤时保留部分插入，前推时沿同一阴道口进入；女性骨盆自然迎合，皮肤接触阴影和轻微压痕随动作连续变化。12-15 秒：动作逐渐放缓，在仍保持部分插入的真实贴合状态结束。全程不得发生器官悬浮、脱体、穿模、错误孔位、肢体黏连或形态突变。";
  shot.dialogue = "";
  shot.startState = "双方已在镜外完成明确同意确认。画面从床面骨盆高度的交合极近景开始：男性位于左侧、女性位于右侧，阴茎根部与男性耻骨区连续，龟头已真实进入女性阴道口，双方下腹部和大腿根部自然贴合。";
  shot.endState = "保持同一骨盆近景、同一左右位置和同一插入轴线；动作放缓后阴茎仍部分位于阴道内，生殖器结构、皮肤纹理和身体连接保持真实稳定。";
  shot.continuity = "镜头全程锁定骨盆与交合部位，不移动到脸部；固定人物左右关系、阴茎来源、阴道口位置、骨盆角度、光线和床单位置。每一帧都保持器官与各自身体自然连接，动作只沿同一真实插入轴线连续变化。";
  shot.imagePrompt = "竖屏 9:16、电影级写实摄影、床面骨盆高度的极近景。画面只覆盖两名原创虚构成年人的下腹部、耻骨区、大腿根部和交合部位，不出现脸。男性位于左侧，阴茎从男性耻骨区自然延伸，根部与腹股沟皮肤连续，阴茎体、冠状沟和龟头比例真实；女性位于右侧，阴阜、外阴唇和阴道口结构自然清楚。龟头与部分阴茎体已经通过外阴唇真实进入阴道口，插入点位准确，阴茎轴线与女性骨盆角度一致。真实皮肤纹理、毛发分布、接触阴影和轻微组织压痕，交合部位准确对焦、无遮挡、未裁切。严格排除假阳具或塑料质感、橡胶管状阴茎、阴茎悬浮或脱离身体、阴茎从大腿或腹部错误长出、错误孔位、器官融合、重复生殖器、异常尺寸、穿模、额外肢体、腿部遮挡和人体蜡像感。";
  shot.videoPrompt = `严格生成 ${config.duration} 秒竖屏 9:16 单镜连续写实视频。首帧及全段均为床面骨盆高度的交合极近景，只显示两名原创虚构成年人的下腹部、耻骨区、大腿根部和阴茎插入阴道的真实连接，不移动到脸部。${shot.action} 真实人体解剖优先于动作幅度；宁可动作小而稳定，也不能改变阴茎来源、阴道口位置或插入轴线。真实皮肤、毛发、接触阴影、组织压痕和床单摩擦连续变化。禁止假体感、塑料或橡胶质感、器官悬浮、脱体、错误生长位置、错误孔位、重复生殖器、异常膨胀、穿模、融合、突然消失、突然出现、遮挡关键部位、镜头切换、拉远或上移。`;
}

function buildShortMediaTasks(plan: OriginalPlan, config: OriginalConfig): OriginalTask[] {
  const tasks: OriginalTask[] = plan.assets.map(asset => ({
    id: `asset:${asset.id}`, kind: "asset", label: `${asset.kind === "character" ? "角色" : "场景"}：${asset.name}`, status: "pending",
    sceneId: asset.kind === "scene" ? asset.id : undefined, prompt: buildAssetPrompt(asset, config),
  }));
  const previousShot = (shot: OriginalPlan["shots"][number]) => {
    const index = plan.shots.indexOf(shot);
    return config.continuousShots ? plan.shots.slice(0, index).findLast(item => item.sceneId === shot.sceneId) : undefined;
  };
  tasks.push(...plan.shots.map<OriginalTask>(shot => {
    const previous = previousShot(shot);
    const references = [...shot.characterIds.map(id => `asset:${id}`), previous ? `image:${previous.id}` : `asset:${shot.sceneId}`];
    return { id: `image:${shot.id}`, kind: "image", label: `分镜图：${shot.title}`, status: "pending", sceneId: shot.sceneId, prompt: buildImagePrompt(plan, shot, config, references), references };
  }));
  tasks.push(...plan.shots.map<OriginalTask>(shot => ({ id: `video:${shot.id}`, kind: "video", label: `镜头视频：${shot.title}`, status: "pending", sceneId: shot.sceneId, attempts: 0, prompt: buildVideoPrompt(plan, shot, config), references: [`image:${shot.id}`] })));
  if (config.faceQaEnabled) tasks.push(...plan.shots.filter(shot => shot.characterIds.length && faceQaApplicable(shot)).map<OriginalTask>(shot => ({
    id: `qa:${shot.id}`, kind: "qa", label: `人物一致性质检：${shot.title}`, status: "pending", sceneId: shot.sceneId,
    references: [`video:${shot.id}`, ...shot.characterIds.map(id => `asset:${id}`)],
  })));
  if (config.stitch) tasks.push({ id: "export", kind: "export", label: "合成完整视频", status: "pending" });
  return tasks;
}

function buildMediaTasks(plan: OriginalPlan, config: OriginalConfig) {
  return config.productionMode === "long" ? buildLongMediaTasks(plan, config) : buildShortMediaTasks(plan, config);
}

async function planStory(cwd: string, state: OriginalRun) {
  const config = state.config;
  const identity = config.characterLock
    ? `为每个角色建立不可变身份指纹：${config.adultExplicit ? "明确 25 岁以上的年龄" : "明确具体年龄"}、脸型、五官、发型、发色、肤色、身高、体型、身体比例、痣或纹身等唯一特征；所有资产和镜头逐字复用这些特征，不因称呼、衣着、姿势或镜头变化创建新角色。`
    : "保持角色身份与称呼统一，不因衣着、姿势或镜头变化创建新角色。";
  const continuity = config.continuousShots
    ? `这 ${config.shotCount} 镜不是独立短片，而是同一条连续剧情，总时长严格为 ${config.shotCount * config.duration} 秒。每镜必须填写 startState、endState、continuity：startState 写镜头第一帧中人物精确位置、朝向、姿势、衣物状态、手脚位置、道具、环境和光线；endState 写最后一帧的同类信息；第 2 镜起的 startState 必须无缝继承上一镜 endState，continuity 明确说明动作、空间、视线、情绪与因果如何接续。完整剧情须有开端、推进、高潮和结尾，不能每 15 秒重新开场。`
    : "保持镜头间的身份、服装、空间、视线、动作和前后因果连续。";
  const adult = config.adultExplicit
    ? adultDirection
    : "内容强度严格跟随用户创作需求，不自行添加露骨成人内容。";
  const prompt = `根据创作需求写出连贯完整的短片剧本与可直接制作的分镜方案。\n需求：${config.brief}\n视觉风格：${config.style || "电影写实"}\n严格锁定 ${config.characterCount} 个角色、${config.shotCount} 个镜头；每镜 ${config.duration} 秒，画幅 ${config.ratio}。系统配置的 ${config.ratio} 是唯一有效画幅，需求文字中的冲突画幅视为旧信息并忽略。\n${adult}\n${storyArcInstruction(config)}\n${timingInstruction(config)}\n${identity}\n${continuity}\n先完成剧本，再从完整剧本整理唯一角色和场景资产；同一人的称呼、衣着或年龄变化不能拆成新角色，别名统一归入同一 ID。每镜最多 3 人，必须仅引用资产表中实际出场的角色 ID 和一个场景 ID。每镜填写 storyBeat、shotPurpose、framing 和 characterLayout；characterLayout 必须与 characterIds 完全相同且每人绑定不同的 leftThird / centerThird / rightThird 竖屏区域，写明位置、姿势、朝向与视线。\nscript 按场次写动作、台词、转场和因果结果；assets 的 description 写固定外观和服装或场景布局，imagePrompt 写资产图构图与光照。shots 的 imagePrompt 写本镜第一帧的静态构图；videoPrompt 按 0-${config.duration} 秒写从 startState 到 endState 的连续动作、运镜、节奏和声音。不要把未出场角色、拼贴、字幕或提示词文字画进图。台词写在 dialogue 中。\n只输出符合下列 JSON Schema 的一个 JSON 对象，不加代码围栏或解释：\n${JSON.stringify(z.toJSONSchema(originalPlanSchema))}`;
  state.tasks[0]!.prompt = prompt;
  await write(cwd, `${runDirectory(state)}/languagePrompt.txt`, prompt);
  const configured = getConfiguredModel(config.language.providerId, config.language.modelId);
  const stream = streamAi(configured, { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] }, AbortSignal.timeout(10 * 60 * 1000));
  for await (const _event of stream) { /* 消费流后读取最终结构，不把推理内容持久化。 */ }
  const message = await stream.result();
  const text = message.content.filter(part => part.type === "text").map(part => part.text).join("");
  await write(cwd, `${runDirectory(state)}/planResponse.txt`, text);
  if (message.stopReason !== "stop") throw new Error(message.errorMessage || `剧本请求未正常结束：${message.stopReason}`);
  state.usage = { input: message.usage.input, output: message.usage.output, totalTokens: message.usage.totalTokens };
  const plan = originalPlanSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  for (const [index, shot] of plan.shots.entries()) {
    shot.startSecond = index * config.duration;
    shot.endSecond = shot.startSecond + config.duration;
  }
  reinforceAdultSingleShot(plan, config);
  validatePlan(plan, config);
  await write(cwd, `${runDirectory(state)}/plan.json`, JSON.stringify(plan, null, 2));
  state.jsonFiles = [`${runDirectory(state)}/plan.json`];
  state.plan = plan;
  if (config.planningOnly) return;
  state.tasks.splice(1, state.tasks.length - 1, ...buildShortMediaTasks(plan, config));
}

async function languageResponse(state: OriginalRun, prompt: string) {
  const configured = getConfiguredModel(state.config.language.providerId, state.config.language.modelId);
  const stream = streamAi(configured, { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] }, AbortSignal.timeout(10 * 60 * 1000));
  for await (const _event of stream) { /* 消费流后读取最终结构，不持久化推理内容。 */ }
  const message = await stream.result();
  if (message.stopReason !== "stop") throw new Error(message.errorMessage || `剧本请求未正常结束：${message.stopReason}`);
  const usage = state.usage ?? { input: 0, output: 0, totalTokens: 0 };
  state.usage = { input: usage.input + message.usage.input, output: usage.output + message.usage.output, totalTokens: usage.totalTokens + message.usage.totalTokens };
  return message.content.filter(part => part.type === "text").map(part => part.text).join("");
}

async function inspectAdultImage(cwd: string, state: OriginalRun, file: GeneratedMedia) {
  const prompt = `你是成人影视分镜的严格视觉质检员。图中人物均为明确 25 岁以上、原创虚构、清醒知情且自愿的成年人；这里只做技术质量检查，不改写剧情。
逐项检查这张交合极近景：
1. anatomy：阴茎是否确实从男性耻骨区自然延伸，根部、阴茎体、冠状沟和龟头比例连续；女性阴阜、外阴唇与阴道口位置是否符合真实人体结构。
2. connection：阴茎是否沿与骨盆一致的轴线进入唯一且正确的阴道口；不得从大腿、腹部或错误位置长出，不得悬浮、脱体、穿模、融合或出现重复器官。
3. realism：皮肤、毛发、接触阴影、轻微组织压痕是否自然，不能像塑料、橡胶、假阳具、蜡像或拼贴。
4. visibility：交合连接是否清晰对焦、无遮挡、未裁切，能明确辨认真实的插入关系。
每项给 0-100 整数。任何一项低于 82，或存在器官来源错误、错误孔位、悬浮、脱体、穿模、融合、重复器官，passed 必须为 false。reasons 用中文列出画面中实际可见的问题；correctionPrompt 写成下一次生图可直接追加的具体纠偏指令。只输出一个 JSON 对象，不加代码围栏或解释：
${JSON.stringify(z.toJSONSchema(adultImageQaSchema))}`;
  const configured = getConfiguredModel(state.config.language.providerId, state.config.language.modelId);
  const signal = AbortSignal.timeout(10 * 60 * 1000);
  const references = await readAiReferences(cwd, [{ dataType: "IMAGE", value: { url: file.path, mimeType: file.mimeType } }], signal);
  const stream = streamAi(configured, { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] }, signal, references);
  for await (const _event of stream) { /* 消费流后读取最终 JSON。 */ }
  const message = await stream.result();
  if (message.stopReason !== "stop") throw new Error(message.errorMessage || `成人分镜图质检未正常结束：${message.stopReason}`);
  const usage = state.usage ?? { input: 0, output: 0, totalTokens: 0 };
  state.usage = { input: usage.input + message.usage.input, output: usage.output + message.usage.output, totalTokens: usage.totalTokens + message.usage.totalTokens };
  const text = message.content.filter(part => part.type === "text").map(part => part.text).join("");
  return adultImageQaSchema.parse(parseJsonResponse(text));
}

function needsAdultImageQa(state: OriginalRun, task: OriginalTask) {
  return state.config.adultExplicit && task.kind === "image" && /(性交|交合|插入|阴茎|阴道|外阴|penetrat|intercourse)/i.test(task.prompt ?? "");
}

function parseJsonResponse(text: string) {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

async function planLongBible(cwd: string, state: OriginalRun, task: OriginalTask) {
  const prompt = buildLongBiblePrompt(state.config);
  task.prompt = prompt;
  await write(cwd, `${runDirectory(state)}/longBiblePrompt.txt`, prompt);
  const text = await languageResponse(state, prompt);
  await write(cwd, `${runDirectory(state)}/longBibleResponse.txt`, text);
  const bible = longBibleSchema.parse(parseJsonResponse(text));
  validateLongBible(bible, state.config);
  state.longBible = bible;
  state.scenePlans = {};
  await write(cwd, `${runDirectory(state)}/longBible.json`, JSON.stringify(bible, null, 2));
  state.jsonFiles = [`${runDirectory(state)}/longBible.json`];
  state.tasks.splice(1, state.tasks.length - 1, ...bible.scenes.map<OriginalTask>(scene => ({
    id: `scenePlan:${scene.id}`, kind: "scenePlan", label: `展开分场：${scene.title}`, status: "pending", sceneId: scene.id,
  })));
}

function parsedLongState(state: OriginalRun) {
  const bible = longBibleSchema.parse(state.longBible);
  const scenePlans = Object.fromEntries(Object.entries(state.scenePlans ?? {}).map(([id, value]) => [id, longScenePlanSchema.parse(value)])) as Record<string, LongScenePlan>;
  return { bible, scenePlans };
}

async function planLongScene(cwd: string, state: OriginalRun, task: OriginalTask) {
  const { bible, scenePlans } = parsedLongState(state);
  const sceneIndex = bible.scenes.findIndex(scene => scene.id === task.sceneId);
  const scene = bible.scenes[sceneIndex];
  if (!scene) fail("分场任务引用了不存在的场景");
  const previous = sceneIndex > 0 ? scenePlans[bible.scenes[sceneIndex - 1]!.id] : undefined;
  if (sceneIndex > 0 && !previous) fail("上一场尚未完成，不能展开当前分场");
  const startShot = bible.scenes.slice(0, sceneIndex).reduce((total, item) => total + item.shotCount, 0);
  const previousBeat = previous?.shots.at(-1)?.storyBeat;
  const prompt = buildLongScenePrompt(state.config, bible, scene, startShot, previous?.shots.at(-1)?.endState, previousBeat);
  task.prompt = prompt;
  await write(cwd, `${runDirectory(state)}/scenePrompts/${scene.id}.txt`, prompt);
  const text = await languageResponse(state, prompt);
  await write(cwd, `${runDirectory(state)}/sceneResponses/${scene.id}.txt`, text);
  const plan = longScenePlanSchema.parse(parseJsonResponse(text));
  for (const [index, shot] of plan.shots.entries()) {
    shot.startSecond = (startShot + index) * state.config.duration;
    shot.endSecond = shot.startSecond + state.config.duration;
  }
  plan.shots[0]!.startState = previous?.shots.at(-1)?.endState ?? scene.startState;
  for (let index = 1; index < plan.shots.length; index++) plan.shots[index]!.startState = plan.shots[index - 1]!.endState;
  plan.shots.at(-1)!.endState = scene.endState;
  const usedShotIds = new Set(Object.values(scenePlans).flatMap(item => item.shots.map(shot => shot.id)));
  validateLongScene(plan, bible, scene, usedShotIds, state.config, previousBeat);
  scenePlans[scene.id] = plan;
  state.scenePlans = scenePlans;
  await write(cwd, `${runDirectory(state)}/scenes/${scene.id}.json`, JSON.stringify(plan, null, 2));
  state.jsonFiles = [...new Set([...(state.jsonFiles ?? []), `${runDirectory(state)}/scenes/${scene.id}.json`])];
  if (Object.keys(scenePlans).length !== bible.scenes.length) return;
  const complete = composeLongPlan(bible, scenePlans);
  validatePlan(complete, state.config);
  state.plan = complete;
  await write(cwd, `${runDirectory(state)}/plan.json`, JSON.stringify(complete, null, 2));
  state.jsonFiles = [...new Set([...(state.jsonFiles ?? []), `${runDirectory(state)}/plan.json`])];
  const planningTasks = 1 + bible.scenes.length;
  if (state.config.planningOnly) {
    state.tasks.splice(planningTasks, state.tasks.length - planningTasks);
    return;
  }
  state.tasks.splice(planningTasks, state.tasks.length - planningTasks, ...buildLongMediaTasks(complete, state.config));
}

async function inspectFaces(cwd: string, state: OriginalRun, task: OriginalTask) {
  const [videoId, ...assetIds] = task.references ?? [];
  const videoTask = state.tasks.find(item => item.id === videoId && item.kind === "video") ?? fail("质检任务缺少镜头视频");
  const video = videoTask.files?.[0] ?? fail("质检任务的镜头视频尚未完成");
  const videoPath = (await resolveWorkspacePath(cwd, video.path)).path;
  const references = [];
  for (const id of assetIds) {
    const asset = state.tasks.find(item => item.id === id && item.kind === "asset") ?? fail(`质检任务缺少角色资产：${id}`);
    const file = asset.files?.[0] ?? fail(`角色资产尚未完成：${id}`);
    references.push({ id: id.slice("asset:".length), path: (await resolveWorkspacePath(cwd, file.path)).path });
  }
  const result = await inspectVideoFaces(videoPath, references, state.config.faceThreshold);
  task.qa = result;
  await write(cwd, `${runDirectory(state)}/qa/${task.id.slice("qa:".length)}.json`, JSON.stringify(result, null, 2));
  return { result, videoTask };
}

async function verifyFiles(cwd: string, files: GeneratedMedia[]) {
  for (const file of files) {
    const { path } = await resolveWorkspacePath(cwd, file.path);
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) fail(`已生成素材缺失或为空：${file.path}。请核对文件后继续。`);
  }
}

async function extractLastFrame(cwd: string, state: OriginalRun, video: GeneratedMedia, shotId: string) {
  const output: GeneratedMedia = { path: `${runDirectory(state)}/continuity/${shotId}.png`, mimeType: "image/png", mediaType: "image" };
  try {
    await verifyFiles(cwd, [output]);
    return output;
  } catch { /* 上次中断可能留下空文件，下面重新提取。 */ }
  await mkdir((await resolveWorkspacePath(cwd, `${runDirectory(state)}/continuity`, true)).path, { recursive: true });
  const ffmpeg = await createWorkspaceFfmpeg(cwd);
  const media = await new Promise<import("@toonflow/ffmpeg").FfprobeData>((resolve, reject) => ffmpeg(video.path).ffprobe((error, data) => error ? reject(error) : resolve(data)));
  const duration = Number(media.format.duration);
  if (!media.streams.some(stream => stream.codec_type === "video") || !Number.isFinite(duration) || duration <= 0) fail(`上一镜视频无法提取连续帧：${video.path}`);
  const command = ffmpeg(video.path).seekInput(Math.max(0, duration - 0.05)).noAudio().frames(1).outputOptions("-y").output(output.path);
  await new Promise<void>((resolve, reject) => { command.on("error", reject).on("end", () => resolve()).run(); });
  await verifyFiles(cwd, [output]);
  return output;
}

async function mergeVideos(cwd: string, state: OriginalRun) {
  const ffmpeg = await createWorkspaceFfmpeg(cwd);
  const videos = state.tasks.filter(task => task.kind === "video").map(task => task.files?.[0] ?? fail("尚有镜头视频未生成"));
  await verifyFiles(cwd, videos);
  const filters: string[] = [];
  const [ratioWidth, ratioHeight] = state.config.ratio.split(":").map(Number) as [number, number];
  let width = 0;
  let height = 0;
  for (const [index, video] of videos.entries()) {
    const media = await new Promise<import("@toonflow/ffmpeg").FfprobeData>((resolve, reject) => ffmpeg(video.path).ffprobe((error, data) => error ? reject(error) : resolve(data)));
    const duration = Number(media.format.duration);
    const videoStream = media.streams.find(stream => stream.codec_type === "video");
    if (!videoStream || !Number.isFinite(duration) || duration <= 0) return fail(`镜头视频无法读取：${video.path}`);
    if (index === 0) {
      const scale = Math.min(Number(videoStream.width) / ratioWidth, Number(videoStream.height) / ratioHeight);
      if (!Number.isFinite(scale) || scale <= 0) fail("首个镜头缺少有效画面尺寸，无法合成");
      width = Math.max(2, Math.floor(ratioWidth * scale / 2) * 2);
      height = Math.max(2, Math.floor(ratioHeight * scale / 2) * 2);
    }
    const targetDuration = state.config.duration;
    filters.push(`[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,trim=duration=${targetDuration},tpad=stop_mode=clone:stop_duration=${targetDuration},trim=duration=${targetDuration},setpts=PTS-STARTPTS[v${index}]`);
    filters.push(media.streams.some(stream => stream.codec_type === "audio")
      ? `[${index}:a:0]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${targetDuration},asetpts=PTS-STARTPTS[a${index}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${targetDuration},asetpts=PTS-STARTPTS[a${index}]`);
  }
  filters.push(`${videos.map((_, index) => `[v${index}][a${index}]`).join("")}concat=n=${videos.length}:v=1:a=1[vout][aout]`);
  const output = `${runDirectory(state)}/final${crypto.randomUUID()}.mp4`;
  const command = ffmpeg();
  for (const video of videos) command.input(video.path);
  command.complexFilter(filters, ["vout", "aout"]).videoCodec("libx264").audioCodec("aac").outputOptions("-preset", "fast", "-crf", "20", "-movflags", "+faststart").output(output);
  await new Promise<void>((resolve, reject) => { command.on("error", reject).on("end", () => resolve()).run(); });
  const files: GeneratedMedia[] = [{ path: output, mimeType: "video/mp4", mediaType: "video" }];
  await verifyFiles(cwd, files);
  const result = await new Promise<import("@toonflow/ffmpeg").FfprobeData>((resolve, reject) => ffmpeg(output).ffprobe((error, data) => error ? reject(error) : resolve(data)));
  const finalDuration = Number(result.format.duration);
  const expectedDuration = state.config.duration * videos.length;
  if (!result.streams.some(stream => stream.codec_type === "video") || !Number.isFinite(finalDuration) || Math.abs(finalDuration - expectedDuration) > 0.5) fail(`成片时长校验失败：应为 ${expectedDuration} 秒，实际为 ${finalDuration || 0} 秒`);
  return files;
}

async function publishCanvas(cwd: string, state: OriginalRun, stage: keyof typeof stageNames, title: string, text: string, tasks: OriginalTask[] = []) {
  if (state.canvases[stage]) return;
  const base = runDirectory(state);
  const file = `${base}/${stageNames[stage]}`;
  const nodeId = `${state.id}${stage}`;
  const textPath = `assets/${nodeId}/content.md`;
  try { await write(cwd, `${base}/${stage}.md`, text, true); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  try { await write(cwd, textPath, text, true); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const nodes: object[] = [{ id: nodeId, type: "remote-textNode", position: { x: 80, y: 80 }, data: { label: title, textPath } }];
  for (const [index, task] of tasks.entries()) {
    const media = task.files?.[0];
    if (!media) continue;
    const type = media.mediaType;
    nodes.push({ id: `${state.id}${index}${stage}`, type: type === "image" ? "remote-imageNode" : "remote-videoNode", position: { x: 520 + index % 3 * 480, y: 80 + Math.floor(index / 3) * 420 }, data: { label: task.label, outputs: { [type]: { dataType: type.toUpperCase(), value: { url: media.path, mimeType: media.mimeType } } } } });
  }
  try { await write(cwd, file, JSON.stringify({ toonflowCanvas: true, yaohaoRunId: state.id, nodes, edges: [], viewport: { x: 0, y: 0, zoom: 0.8 } }, null, 2), true); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || (await readJson(cwd, file))?.yaohaoRunId !== state.id) throw error;
  }
  state.canvases[stage] = file;
}

async function publishCompleted(cwd: string, state: OriginalRun) {
  const plan = state.plan;
  if (!plan) return;
  await publishCanvas(cwd, state, "story", "故事方案", `# ${plan.title}\n\n${plan.synopsis}`);
  await publishCanvas(cwd, state, "script", "完整剧本", `# ${plan.title}\n\n${plan.script}`);
  await publishCanvas(cwd, state, "storyboard", "导演分镜", plan.shots.map((shot, index) => `## ${index + 1}. ${shot.title}\n\n绝对时间：${shot.startSecond}-${shot.endSecond}s · 剧情节拍：${shot.storyBeat} · 镜头目的：${shot.shotPurpose}\n\n场景：${shot.sceneId} · 角色：${shot.characterIds.join("、") || "空镜"} · 景别：${shot.framing}\n\n人物区域：${shot.characterLayout?.map(item => `${item.characterId}=${item.screenRegion}`).join("、") || "空镜"}\n\n开始状态：${shot.startState || "未单独记录"}\n\n结束状态：${shot.endState || "未单独记录"}\n\n衔接说明：${shot.continuity || (index === 0 ? "全片开场" : "按剧本承接")}\n\n${shot.action}\n\n对白：${shot.dialogue}\n\n生图提示词：${shot.imagePrompt}\n\n视频提示词：${shot.videoPrompt}`).join("\n\n"));
  for (const [kind, stage, title] of [["asset", "assets", "人物与场景资产"], ["image", "images", "分镜图"], ["video", "videos", "镜头视频"], ["export", "export", "最终视频"]] as const) {
    const tasks = state.tasks.filter(task => task.kind === kind);
    if (tasks.length && tasks.every(task => task.status === "completed")) await publishCanvas(cwd, state, stage, title, tasks.map(task => `## ${task.label}\n\n${task.prompt || "按镜头顺序合成"}\n\n参考任务：${task.references?.join("、") || "无"}\n\n${task.files?.map(file => `素材：${file.path}`).join("\n") || ""}`).join("\n\n"), tasks);
  }
}

function previousVideoTask(state: OriginalRun, task: OriginalTask) {
  const shotId = task.id.slice("video:".length);
  const shotIndex = state.plan?.shots.findIndex(shot => shot.id === shotId) ?? -1;
  if (shotIndex <= 0) return undefined;
  const current = state.plan!.shots[shotIndex]!;
  const previous = state.plan!.shots.slice(0, shotIndex).findLast(shot => shot.sceneId === current.sceneId);
  return previous ? state.tasks.find(item => item.id === `video:${previous.id}`) : undefined;
}

function taskDependencies(state: OriginalRun, task: OriginalTask) {
  if (task.kind === "export") return state.tasks.filter(item => item !== task && !["plan", "bible", "scenePlan"].includes(item.kind));
  const dependencies = (task.references ?? []).map(id => state.tasks.find(item => item.id === id)).filter((item): item is OriginalTask => !!item);
  if (task.kind === "video" && state.config.continuousShots) {
    const previous = previousVideoTask(state, task);
    if (previous) {
      dependencies.push(previous);
      const qa = state.tasks.find(item => item.id === previous.id.replace(/^video:/, "qa:"));
      if (qa) dependencies.push(qa);
    }
  }
  return [...new Set(dependencies)];
}

function ready(state: OriginalRun, task: OriginalTask) {
  return task.status === "pending" && taskDependencies(state, task).every(item => item.status === "completed");
}

async function runTask(cwd: string, control: Control, models: Awaited<ReturnType<typeof preflight>>, task: OriginalTask) {
  const state = control.state;
  if (task.kind === "plan") await planStory(cwd, state);
  else if (task.kind === "bible") await planLongBible(cwd, state, task);
  else if (task.kind === "scenePlan") await planLongScene(cwd, state, task);
  else if (task.kind === "export") task.files = await mergeVideos(cwd, state);
  else if (task.kind === "qa") {
    const { result, videoTask } = await inspectFaces(cwd, state, task);
    if (!result.passed) {
      const attempts = videoTask.attempts ?? 1;
      if (attempts > state.config.maxRetries) fail(`人物一致性质检未通过，已用完 ${state.config.maxRetries} 次重试：${result.reasons.join("；")}`);
      const shotId = videoTask.id.slice("video:".length);
      const shot = state.plan?.shots.find(item => item.id === shotId) ?? fail(`人物一致性质检找不到分镜：${shotId}`);
      const correctionMarker = "\n\n【人物身份纠偏重试】";
      videoTask.prompt = `${videoTask.prompt?.split(correctionMarker)[0] ?? buildVideoPrompt(state.plan!, shot, state.config)}${buildFaceCorrectionPrompt(state.plan!, shot, attempts, result.reasons)}`;
      task.status = "pending";
      videoTask.status = "pending";
      delete videoTask.files;
      delete videoTask.referenceFrame;
      delete task.qa;
      return;
    }
  } else {
    const config = state.config;
    const model = task.kind === "video" ? models.video : models.image;
    const selection = task.kind === "video" ? config.video : config.image;
    const mediaModel = model ?? fail("媒体任务缺少已配置的图片或视频模型");
    const mediaSelection = selection ?? fail("媒体任务缺少已配置的图片或视频模型");
    const references = (task.references ?? []).map(id => state.tasks.find(item => item.id === id && item.status === "completed")?.files?.[0] ?? fail(`参考资产尚未完成：${id}`));
    await verifyFiles(cwd, references);
    const request: MediaGenerationRequest = {
      ...mediaSelection, prompt: task.prompt!, ratio: config.ratio,
      outputDirectory: `${runDirectory(state)}/${task.kind}`,
      other: Object.fromEntries((mediaModel.rules ?? []).map(rule => [rule.field, rule.value])),
    };
    if (task.kind === "video") {
      if (config.productionMode === "long") {
        const nextCost = Number(((state.estimatedCost ?? 0) + config.costPerVideo).toFixed(2));
        if (config.costLimit > 0 && nextCost > config.costLimit) fail(`已到预算上限 ${config.costLimit} USD，停止提交新的付费视频任务`);
        state.estimatedCost = nextCost;
      }
      task.attempts = (task.attempts ?? 0) + 1;
      await save(cwd, control);
      request.duration = config.duration;
      request.resolution = config.resolution;
      request.mode = videoMode(mediaModel);
      let referenceMedia = references[0];
      if (config.continuousShots) {
        const previousTask = previousVideoTask(state, task);
        if (previousTask) {
          const previous = previousTask.files?.[0] ?? fail("同场上一镜视频尚未完成，无法建立连续首帧");
          referenceMedia = await extractLastFrame(cwd, state, previous, task.id.slice("video:".length));
        }
      }
      if (referenceMedia) {
        task.referenceFrame = referenceMedia.path;
        const reference = { path: referenceMedia.path, mimeType: referenceMedia.mimeType };
        if (Array.isArray(request.mode) || request.mode === "singleImage") request.images = [reference];
        else request.firstFrame = reference;
      } else delete task.referenceFrame;
      await save(cwd, control);
      if (mediaModel.audio === "optional") request.generateAudio = true;
    } else {
      request.size = mediaModel.imageSizes?.[0];
      if (references.length) request.images = references.map(file => ({ path: file.path, mimeType: file.mimeType }));
    }
    if (!needsAdultImageQa(state, task)) {
      task.files = await generateMedia(cwd, task.kind === "video" ? "video" : "image", request, AbortSignal.timeout(30 * 60 * 1000));
      await verifyFiles(cwd, task.files);
    } else {
      const basePrompt = request.prompt;
      const maximumAttempts = state.config.maxRetries + 1;
      for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
        task.attempts = attempt;
        request.prompt = attempt === 1 ? basePrompt : `${basePrompt}\n\n【成人分镜图解剖纠偏重试 ${attempt}/${maximumAttempts}】\n${task.imageQa?.correctionPrompt || task.imageQa?.reasons.join("；") || "严格纠正人体解剖与真实插入连接"}`;
        task.prompt = request.prompt;
        await save(cwd, control);
        task.files = await generateMedia(cwd, "image", request, AbortSignal.timeout(30 * 60 * 1000));
        await verifyFiles(cwd, task.files);
        try {
          task.imageQa = await inspectAdultImage(cwd, state, task.files[0]!);
        } catch (error) {
          fail(`成人分镜图已生成，但自动解剖质检无法完成；为避免把未审核首帧送入视频模型，已停止：${error instanceof Error ? error.message : "质检返回无效"}`);
        }
        const imageQa = task.imageQa ?? fail("成人分镜图质检结果缺失");
        await write(cwd, `${runDirectory(state)}/imageQa/${task.id.slice("image:".length)}-attempt${attempt}.json`, JSON.stringify(imageQa, null, 2));
        await save(cwd, control);
        if (imageQa.passed) break;
        if (attempt === maximumAttempts) fail(`成人分镜图解剖质检未通过，已用完 ${state.config.maxRetries} 次重试：${imageQa.reasons.join("；")}`);
      }
    }
  }
  if (task.status === "running") task.status = "completed";
}

async function execute(cwd: string, control: Control, models: Awaited<ReturnType<typeof preflight>>) {
  const state = control.state;
  try {
    for (const task of state.tasks) if (task.status === "completed" && task.files) await verifyFiles(cwd, task.files);
    await publishCompleted(cwd, state);
    while (!control.pause) {
      const planning = state.tasks.find(task => ["plan", "bible", "scenePlan"].includes(task.kind) && task.status === "pending");
      if (planning) {
        planning.status = "running";
        delete planning.error;
        await save(cwd, control);
        try { await runTask(cwd, control, models, planning); }
        catch (error) {
          planning.status = "failed";
          planning.error = error instanceof Error ? error.message : "规划任务失败";
          break;
        }
        await save(cwd, control);
        await publishCompleted(cwd, state);
        continue;
      }
      const imageTasks = state.tasks.filter(task => ["asset", "image"].includes(task.kind) && ready(state, task)).slice(0, state.config.imageConcurrency);
      const videoTasks = state.tasks.filter(task => task.kind === "video" && ready(state, task)).slice(0, state.config.videoConcurrency);
      const qaTasks = state.tasks.filter(task => task.kind === "qa" && ready(state, task)).slice(0, state.config.videoConcurrency);
      const exportTask = state.tasks.find(task => task.kind === "export" && ready(state, task));
      const batch = exportTask ? [exportTask] : [...imageTasks, ...videoTasks, ...qaTasks];
      if (!batch.length) break;
      for (const task of batch) { task.status = "running"; delete task.error; }
      await save(cwd, control);
      const results = await Promise.allSettled(batch.map(task => runTask(cwd, control, models, task)));
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") continue;
        const task = batch[index]!;
        task.status = "failed";
        task.error = result.reason instanceof Error ? result.reason.message : "生成任务失败";
      }
      await save(cwd, control);
      await publishCompleted(cwd, state);
      await save(cwd, control);
    }
    await publishCompleted(cwd, state);
    const failed = state.tasks.filter(task => task.status === "failed");
    const pending = state.tasks.filter(task => task.status === "pending");
    if (state.tasks.every(task => task.status === "completed")) {
      state.status = "completed";
      delete state.error;
    } else if (control.pause) {
      state.status = "paused";
    } else {
      state.status = "failed";
      state.error = failed.length
        ? failed.map(task => `${task.label}：${task.error || "失败"}`).join("\n")
        : `有 ${pending.length} 个任务因前置任务未完成而阻塞`;
    }
    await save(cwd, control);
  } catch (error) {
    state.status = "failed";
    state.error = error instanceof Error ? error.message : "工作流执行失败";
    for (const task of state.tasks.filter(item => item.status === "running")) { task.status = "failed"; task.error = state.error; }
    await save(cwd, control).catch(cause => console.error("原创工作流保存失败", cause));
  } finally { active.delete(key(cwd)); }
}

export async function start(cwd: string, id: string, config: OriginalConfig, previousRunId?: string) {
  const directoryKey = key(cwd);
  const running = active.get(directoryKey);
  if (running?.state.id === id) return structuredClone(running.state);
  if (changing.has(directoryKey) || running) return fail("该项目已有工作流运行中，请勿重复启动", 409);
  changing.add(directoryKey);
  try {
    const previous = await status(cwd);
    if (previous?.id === id) return previous;
    if (previous && previous.id !== previousRunId) fail("项目已有制作记录，请刷新后选择继续或新建一版", 409);
    const project = await readJson(cwd, "originalProject.json");
    if (project?.yaohaoOriginal !== true || project.version !== 1 || !["original", "adaptation"].includes(project.mode)) fail("当前工作区不是受支持的原创项目");
    const reusePlan = previous?.status === "completed" && previous.config.planningOnly && !config.planningOnly && previous.plan;
    if (reusePlan && config.productionMode !== previous.config.productionMode) fail("继续媒体制作时不能切换短片或长片模式，请新建一版重新规划");
    const models = await preflight(config);
    const initialTask: OriginalTask = config.productionMode === "long"
      ? { id: "bible", kind: "bible", label: "全片圣经、唯一角色库与分场规划", status: "pending" }
      : { id: "plan", kind: "plan", label: "完整剧本、唯一角色表与导演分镜", status: "pending" };
    const state: OriginalRun = {
      version: 1, id, status: "running", config, createdAt: Date.now(), updatedAt: Date.now(),
      tasks: reusePlan ? buildMediaTasks(reusePlan, config) : [initialTask], canvases: {},
      ...(reusePlan ? { plan: reusePlan, jsonFiles: [`originalRuns/${id}/plan.json`] } : {}),
      ...(config.productionMode === "long" ? { scenePlans: reusePlan ? previous?.scenePlans : {}, longBible: reusePlan ? previous?.longBible : undefined, estimatedCost: 0 } : {}),
    };
    const control: Control = { state, pause: false, saving: Promise.resolve() };
    await mkdir((await resolveWorkspacePath(cwd, "originalRuns", true)).path, { recursive: true });
    try { await mkdir((await resolveWorkspacePath(cwd, runDirectory(state), true)).path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("该制作版本目录已存在，请使用新的版本 ID", 409);
      throw error;
    }
    if (reusePlan) await write(cwd, `${runDirectory(state)}/plan.json`, JSON.stringify(reusePlan, null, 2));
    await save(cwd, control);
    active.set(directoryKey, control);
    void execute(cwd, control, models);
    return structuredClone(state);
  } finally { changing.delete(directoryKey); }
}

export async function control(cwd: string, id: string, action: "pause" | "resume", acceptUncertain = false) {
  const directoryKey = key(cwd);
  if (changing.has(directoryKey)) return fail("工作流状态正在更新，请稍后重试", 409);
  changing.add(directoryKey);
  try {
    const running = active.get(directoryKey);
    const state = running?.state ?? await status(cwd);
    if (!state || state.id !== id) return fail("工作流记录已变化，请刷新页面", 409);
    if (action === "pause") {
      if (running) { running.pause = true; state.status = "pausing"; await save(cwd, running); }
      return structuredClone(state);
    }
    if (running) return fail("当前步骤仍在执行，完成后才能继续", 409);
    if (state.status === "completed") return state;
    if ((state.status === "interrupted" || state.tasks.some(task => task.status === "running")) && !acceptUncertain) fail("上次进行中的请求可能已计费，请核对上游记录后确认重试", 409);
    const models = await preflight(state.config);
    for (const task of state.tasks) if (task.status !== "completed") { task.status = "pending"; delete task.error; }
    state.status = "running";
    delete state.error;
    const current: Control = { state, pause: false, saving: Promise.resolve() };
    await save(cwd, current);
    active.set(directoryKey, current);
    void execute(cwd, current, models);
    return structuredClone(state);
  } finally { changing.delete(directoryKey); }
}
