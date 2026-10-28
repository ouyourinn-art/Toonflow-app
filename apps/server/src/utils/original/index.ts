import { z } from "zod";
import { dirname } from "node:path";
import { mkdir, readFile, stat } from "@toonflow/file";
import type { GeneratedMedia, MediaGenerationRequest, MediaModel } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { getConfiguredModel, streamAi } from "@/utils/ai";
import { generateMedia, listMediaModels } from "@/utils/media/generation";
import { getMediaProvider, loadMediaProviderSource } from "@/utils/media/provider";
import { createWorkspaceFfmpeg, prepareWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { lockWorkspaceFiles, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";
import { originalPlanSchema, originalRunSchema, type OriginalConfig, type OriginalPlan, type OriginalRun, type OriginalTask } from "./types";

type Control = { state: OriginalRun; pause: boolean; saving: Promise<void> };
const active = new Map<string, Control>();
const changing = new Set<string>();
const stageNames = { story: "stage01Story.json", script: "stage02Script.json", assets: "stage03Assets.json", storyboard: "stage04Storyboard.json", images: "stage05Images.json", videos: "stage06Videos.json", export: "stage07Export.json" };
const key = (cwd: string) => process.platform === "win32" ? cwd.toLowerCase() : cwd;
const runDirectory = (state: OriginalRun) => `originalRuns/${state.id}`;
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };

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
  const models = await listMediaModels();
  const image = models.find(model => model.type === "image" && model.providerId === config.image.providerId && model.modelId === config.image.modelId);
  const video = models.find(model => model.type === "video" && model.providerId === config.video.providerId && model.modelId === config.video.modelId);
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
    if (new Set(shot.characterIds).size !== shot.characterIds.length || shot.characterIds.some(id => !plan.assets.some(asset => asset.id === id && asset.kind === "character"))) fail(`分镜 ${shot.id} 的角色引用无效`);
  }
  if (config.continuousShots) {
    for (const [index, shot] of plan.shots.entries()) {
      if (!shot.startState || !shot.endState || index > 0 && !shot.continuity) fail(`分镜 ${shot.id} 缺少连续状态，已在生图前停止`);
    }
  }
  const used = new Set(plan.shots.flatMap(shot => [...shot.characterIds, shot.sceneId]));
  if (plan.assets.some(asset => !used.has(asset.id))) fail("资产表包含未在任何镜头出场的人物或场景，已在生图前停止");
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
    ? "本项目是仅含虚构成年人（所有角色均明确 25 岁以上）、清醒、知情并自愿参与的露骨成人作品。按需求直接、具体、生动地设计裸体和双方自愿的性行为；生图与视频提示词必须明确生殖器持续清晰可见、性交动作与插入关系可辨认，不用腿、手、床单、阴影、家具或景别遮挡，不裁切腰部以下，也不用亲吻或拥抱替代剧情指定的性行为。禁止加入未成年人或年龄模糊者、强迫、迷奸、昏迷、偷窥、乱伦、暴力或非人动物。所有人物均为原创虚构形象，不仿照真实人物。"
    : "内容强度严格跟随用户创作需求，不自行添加露骨成人内容。";
  const prompt = `根据创作需求写出连贯完整的短片剧本与可直接制作的分镜方案。\n需求：${config.brief}\n视觉风格：${config.style || "电影写实"}\n严格锁定 ${config.characterCount} 个角色、${config.shotCount} 个镜头；每镜 ${config.duration} 秒，画幅 ${config.ratio}。\n${adult}\n${identity}\n${continuity}\n先完成剧本，再从完整剧本整理唯一角色和场景资产；同一人的称呼、衣着或年龄变化不能拆成新角色，别名统一归入同一 ID。每镜必须仅引用资产表中实际出场的角色 ID 和一个场景 ID。\nscript 按场次写动作、台词、转场；assets 的 description 写固定外观和服装或场景布局，imagePrompt 写资产图构图与光照。shots 的 imagePrompt 写本镜第一帧的静态构图、人物位置、景别和光照；videoPrompt 写从 startState 到 endState 的连续动作、运镜、节奏和声音。不要把未出场角色、拼贴、字幕或提示词文字画进图。台词写在 dialogue 中。\n只输出符合下列 JSON Schema 的一个 JSON 对象，不加代码围栏或解释：\n${JSON.stringify(z.toJSONSchema(originalPlanSchema))}`;
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
  validatePlan(plan, config);
  await write(cwd, `${runDirectory(state)}/plan.json`, JSON.stringify(plan, null, 2));
  state.plan = plan;
  const style = config.style ? `\n统一风格：${config.style}` : "";
  const adultVisual = config.adultExplicit ? "\n露骨成人画面要求：所有人物均为 25 岁以上的原创虚构成年人且清醒、自愿；生殖器持续清晰可见，性交动作和插入关系可辨认；不用腿、手、床单、阴影、家具或景别遮挡，不裁切腰部以下，不用亲吻或拥抱替代指定性行为。" : "";
  const adultCharacterAsset = config.adultExplicit ? "\n成人角色资产要求：原创虚构且明确 25 岁以上，裸体全身身份基准，生殖器与身体比例清晰可见且无遮挡，不摆出性行为姿势，不加入其他人物。" : "";
  const characterIdentity = config.characterLock ? "\n人物锁定：严格保持角色脸型、五官、发型、发色、肤色、身高、体型、身体比例、痣或纹身等身份特征，不生成相似但不同的人。" : "";
  state.tasks.splice(1, state.tasks.length - 1,
    ...plan.assets.map<OriginalTask>(asset => ({ id: `asset:${asset.id}`, kind: "asset", label: `${asset.kind === "character" ? "角色" : "场景"}：${asset.name}`, status: "pending", prompt: `${asset.imagePrompt}\n固定特征：${asset.description}${style}${asset.kind === "character" ? `${characterIdentity}${adultCharacterAsset}\n单人角色资产图，只出现此角色，完整展示固定外观，不拼贴，不添加其他人物。` : "\n独立场景资产图，清晰展示空间与光照，不出现人物。"}` })),
    ...plan.shots.map<OriginalTask>(shot => ({ id: `image:${shot.id}`, kind: "image", label: `分镜图：${shot.title}`, status: "pending", prompt: `${shot.imagePrompt}${style}${characterIdentity}${adultVisual}\n本镜开始状态：${shot.startState || "按完整剧本承接"}\n参考图按以下顺序提供：\n${[...shot.characterIds, shot.sceneId].map((id, index) => { const asset = plan.assets.find(item => item.id === id)!; return `${index + 1}. ${asset.name}（${asset.id}，${asset.kind === "character" ? "角色身份与服装" : "场景空间与光照"}）`; }).join("\n")}\n仅描绘以上实际出场角色，保持参考人物身份与服装一致，不添加其他人物。`, references: [...shot.characterIds, shot.sceneId].map(id => `asset:${id}`) })),
    ...plan.shots.map<OriginalTask>((shot, index) => ({ id: `video:${shot.id}`, kind: "video", label: `镜头视频：${shot.title}`, status: "pending", prompt: `${shot.videoPrompt}\n动作：${shot.action}\n对白：${shot.dialogue || "无对白"}\n开始状态：${shot.startState || "按分镜图开始"}\n结束状态：${shot.endState || "按完整剧本结束"}\n与上一镜衔接：${shot.continuity || (index === 0 ? "全片开场" : "无缝承接上一镜最后一帧")}${style}${characterIdentity}${adultVisual}\n${config.continuousShots && index > 0 ? "以所附上一镜最后一帧为本镜第一帧，直接延续其中全部人物、姿势、空间、物件和光线，不得重新开场或重置人物。" : "以所附分镜图为画面依据，保持人物身份、服装与场景连续。"}`, references: [`image:${shot.id}`] })),
    ...(config.stitch ? [{ id: "export", kind: "export" as const, label: "合成完整视频", status: "pending" as const }] : []),
  );
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
  await publishCanvas(cwd, state, "storyboard", "导演分镜", plan.shots.map((shot, index) => `## ${index + 1}. ${shot.title}\n\n场景：${shot.sceneId} · 角色：${shot.characterIds.join("、") || "空镜"} · ${state.config.duration}s\n\n开始状态：${shot.startState || "未单独记录"}\n\n结束状态：${shot.endState || "未单独记录"}\n\n衔接说明：${shot.continuity || (index === 0 ? "全片开场" : "按剧本承接")}\n\n${shot.action}\n\n对白：${shot.dialogue}\n\n生图提示词：${shot.imagePrompt}\n\n视频提示词：${shot.videoPrompt}`).join("\n\n"));
  for (const [kind, stage, title] of [["asset", "assets", "人物与场景资产"], ["image", "images", "分镜图"], ["video", "videos", "镜头视频"], ["export", "export", "最终视频"]] as const) {
    const tasks = state.tasks.filter(task => task.kind === kind);
    if (tasks.length && tasks.every(task => task.status === "completed")) await publishCanvas(cwd, state, stage, title, tasks.map(task => `## ${task.label}\n\n${task.prompt || "按镜头顺序合成"}\n\n参考任务：${task.references?.join("、") || "无"}\n\n${task.files?.map(file => `素材：${file.path}`).join("\n") || ""}`).join("\n\n"), tasks);
  }
}

async function execute(cwd: string, control: Control, models: Awaited<ReturnType<typeof preflight>>) {
  const state = control.state;
  try {
    for (const task of state.tasks) if (task.status === "completed" && task.files) await verifyFiles(cwd, task.files);
    await publishCompleted(cwd, state);
    // ACT: 串行执行，人物资产只生成一次；失败不自动重交付费请求，明确续跑才重试。
    for (let index = 0; index < state.tasks.length; index++) {
      const task = state.tasks[index]!;
      if (control.pause) break;
      if (task.status === "completed") continue;
      task.status = "running";
      delete task.error;
      await save(cwd, control);
      if (task.kind === "plan") await planStory(cwd, state);
      else if (task.kind === "export") task.files = await mergeVideos(cwd, state);
      else {
        const config = state.config;
        const model = task.kind === "video" ? models.video : models.image;
        const selection = task.kind === "video" ? config.video : config.image;
        const references = (task.references ?? []).map(id => state.tasks.find(item => item.id === id && item.status === "completed")?.files?.[0] ?? fail(`参考资产尚未完成：${id}`));
        await verifyFiles(cwd, references);
        const request: MediaGenerationRequest = {
          ...selection, prompt: task.prompt!, ratio: config.ratio,
          outputDirectory: `${runDirectory(state)}/${task.kind}`,
          other: Object.fromEntries((model.rules ?? []).map(rule => [rule.field, rule.value])),
        };
        if (task.kind === "video") {
          request.duration = config.duration;
          request.resolution = config.resolution;
          request.mode = videoMode(model);
          let referenceMedia = references[0]!;
          if (config.continuousShots) {
            const videoTasks = state.tasks.filter(item => item.kind === "video");
            const videoIndex = videoTasks.indexOf(task);
            if (videoIndex > 0) {
              const previous = videoTasks[videoIndex - 1]!.files?.[0] ?? fail("上一镜视频尚未完成，无法建立连续首帧");
              referenceMedia = await extractLastFrame(cwd, state, previous, task.id.slice("video:".length));
            }
          }
          task.referenceFrame = referenceMedia.path;
          await save(cwd, control);
          const reference = { path: referenceMedia.path, mimeType: referenceMedia.mimeType };
          if (Array.isArray(request.mode) || request.mode === "singleImage") request.images = [reference];
          else request.firstFrame = reference;
          if (model.audio === "optional") request.generateAudio = true;
        } else {
          request.size = model.imageSizes?.[0];
          if (references.length) request.images = references.map(file => ({ path: file.path, mimeType: file.mimeType }));
        }
        task.files = await generateMedia(cwd, task.kind === "video" ? "video" : "image", request, AbortSignal.timeout(30 * 60 * 1000));
        task.status = "completed";
        await verifyFiles(cwd, task.files);
      }
      task.status = "completed";
      await save(cwd, control);
      await publishCompleted(cwd, state);
      await save(cwd, control);
    }
    await publishCompleted(cwd, state);
    state.status = state.tasks.every(task => task.status === "completed") ? "completed" : "paused";
    await save(cwd, control);
  } catch (error) {
    state.status = "failed";
    state.error = error instanceof Error ? error.message : "工作流执行失败";
    const task = state.tasks.find(item => item.status === "running");
    if (task) { task.status = "failed"; task.error = state.error; }
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
    const models = await preflight(config);
    const state: OriginalRun = { version: 1, id, status: "running", config, createdAt: Date.now(), updatedAt: Date.now(), tasks: [{ id: "plan", kind: "plan", label: "完整剧本、唯一角色表与导演分镜", status: "pending" }], canvases: {} };
    const control: Control = { state, pause: false, saving: Promise.resolve() };
    await mkdir((await resolveWorkspacePath(cwd, "originalRuns", true)).path, { recursive: true });
    try { await mkdir((await resolveWorkspacePath(cwd, runDirectory(state), true)).path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("该制作版本目录已存在，请使用新的版本 ID", 409);
      throw error;
    }
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
