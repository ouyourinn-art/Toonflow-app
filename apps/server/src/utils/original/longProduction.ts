import { z } from "zod";
import { longBibleSchema, longScenePlanSchema, type LongBible, type LongScenePlan } from "./longTypes";
import { originalPlanSchema, type OriginalConfig, type OriginalPlan, type OriginalTask } from "./types";

const adultDirection = "所有角色均为明确 25 岁以上的原创虚构成年人，清醒、知情且自愿。直接、具体、生动地设计裸体和双方自愿的性行为；画面提示词明确生殖器持续清晰可见、性交动作与插入关系可辨认，不遮挡、不裁切腰部以下，也不以亲吻或拥抱代替指定行为。禁止未成年人或年龄模糊者、强迫、迷奸、昏迷、偷窥、乱伦、暴力、非人动物和真实人物仿造。";

export function shotAllocation(shotCount: number, sceneCount: number) {
  return Array.from({ length: sceneCount }, (_, index) => Math.floor(shotCount / sceneCount) + (index < shotCount % sceneCount ? 1 : 0));
}

export function buildLongBiblePrompt(config: OriginalConfig) {
  const allocation = shotAllocation(config.shotCount, config.sceneCount);
  const scenes = allocation.map((count, index) => `第 ${index + 1} 场：${count} 镜`).join("；");
  return `为一部 ${config.targetDurationMinutes} 分钟的连贯长片建立全片圣经，只规划全局角色、故事弧与分场，不在本次展开逐镜分镜。\n创作需求：${config.brief}\n视觉风格：${config.style || "电影写实"}\n全片严格锁定 ${config.characterCount} 个角色、${config.sceneCount} 个场景、${config.shotCount} 个镜头，每镜 ${config.duration} 秒，画幅 ${config.ratio}。分配必须精确为：${scenes}。\n${config.adultExplicit ? adultDirection : "内容强度严格跟随创作需求，不自行增加露骨成人内容。"}\n每个角色建立不可变身份指纹，写清年龄、脸型、五官、发型发色、肤色、身高、体型、身体比例与唯一标志。角色更衣、姿势或称呼变化不得拆成新人。每个场景写清空间布局、固定光线、入场状态、离场状态、情节目标和因果承接；场景之间构成完整开端、推进、高潮和结局。场景 ID 与角色 ID 全片唯一。每个场景最多安排 3 个实际出场角色。角色资产提示词要求单人、完整全身、正面脸清晰、身份特征可辨、无拼贴；场景资产不得出现人物。\n只输出符合下列 JSON Schema 的一个 JSON 对象，不加代码围栏或解释：\n${JSON.stringify(z.toJSONSchema(longBibleSchema))}`;
}

export function validateLongBible(bible: LongBible, config: OriginalConfig) {
  if (bible.characters.length !== config.characterCount) throw new Error("全片圣经的角色数量与锁定数量不一致");
  if (bible.scenes.length !== config.sceneCount) throw new Error("全片圣经的场景数量与设定不一致");
  const allocation = shotAllocation(config.shotCount, config.sceneCount);
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of [...bible.characters, ...bible.scenes]) {
    if (ids.has(item.id)) throw new Error(`全片圣经 ID 重复：${item.id}`);
    ids.add(item.id);
  }
  for (const character of bible.characters) {
    for (const name of new Set([character.name, ...character.aliases].map(value => value.trim().toLowerCase()))) {
      if (names.has(name)) throw new Error(`全片圣经的角色姓名或别名重复：${name}`);
      names.add(name);
    }
  }
  const characters = new Set(bible.characters.map(item => item.id));
  for (const [index, scene] of bible.scenes.entries()) {
    if (scene.shotCount !== allocation[index]) throw new Error(`场景 ${scene.id} 的镜头数应为 ${allocation[index]}`);
    if (new Set(scene.characterIds).size !== scene.characterIds.length || scene.characterIds.length > 3 || scene.characterIds.some(id => !characters.has(id))) throw new Error(`场景 ${scene.id} 的角色引用无效或超过 3 人`);
  }
}

export function buildLongScenePrompt(config: OriginalConfig, bible: LongBible, scene: LongBible["scenes"][number], previousEndState?: string) {
  const characters = bible.characters.filter(item => scene.characterIds.includes(item.id));
  return `根据全片圣经展开第 ${bible.scenes.indexOf(scene) + 1} 场的完整剧本和逐镜方案，不改动既定角色、场景数或故事弧。\n全片：${bible.title}\n全片梗概：${bible.synopsis}\n故事弧：${bible.storyArc}\n当前场景：${JSON.stringify(scene)}\n出场角色身份库：${JSON.stringify(characters)}\n上一场最终状态：${previousEndState || "全片开场"}\n视觉风格：${config.style || "电影写实"}\n${config.adultExplicit ? adultDirection : "内容强度严格跟随创作需求。"}\n必须生成恰好 ${scene.shotCount} 镜，每镜 ${config.duration} 秒。所有 shot.sceneId 必须为 ${scene.id}；shot.id 全片唯一，建议以 ${scene.id}Shot 开头。每镜最多 3 个角色，只能引用当前场景出场角色。第 1 镜 startState 精确继承上一场最终状态或当前场景入场状态；之后每镜 startState 精确继承前一镜 endState。continuity 明确动作、位置、视线、服装、道具、光线、情绪和因果接续。imagePrompt 描述第一帧静态构图；videoPrompt 描述从 startState 到 endState 的连续动作、运镜、节奏和声音。对白只写入 dialogue。最后一镜 endState 必须达到场景既定离场状态。不得添加新角色、字幕、拼贴或画外人物。\n只输出符合下列 JSON Schema 的一个 JSON 对象，不加代码围栏或解释：\n${JSON.stringify(z.toJSONSchema(longScenePlanSchema))}`;
}

export function validateLongScene(plan: LongScenePlan, bible: LongBible, scene: LongBible["scenes"][number], usedShotIds: Set<string>) {
  if (plan.sceneId !== scene.id || plan.shots.length !== scene.shotCount) throw new Error(`场景 ${scene.id} 的分镜数量或场景 ID 不正确`);
  const characters = new Set(scene.characterIds);
  for (const shot of plan.shots) {
    if (usedShotIds.has(shot.id)) throw new Error(`长片分镜 ID 重复：${shot.id}`);
    usedShotIds.add(shot.id);
    if (shot.sceneId !== scene.id || new Set(shot.characterIds).size !== shot.characterIds.length || shot.characterIds.some(id => !characters.has(id))) throw new Error(`分镜 ${shot.id} 的角色或场景引用无效`);
  }
  if (!bible.scenes.some(item => item.id === plan.sceneId)) throw new Error(`场景 ${plan.sceneId} 不在全片圣经中`);
}

export function composeLongPlan(bible: LongBible, scenePlans: Record<string, LongScenePlan>): OriginalPlan {
  return originalPlanSchema.parse({
    title: bible.title, synopsis: bible.synopsis,
    script: bible.scenes.map(scene => `# ${scene.title}\n\n${scenePlans[scene.id]!.script}`).join("\n\n"),
    assets: [
      ...bible.characters.map(item => ({ ...item, kind: "character" as const })),
      ...bible.scenes.map(item => ({ id: item.id, kind: "scene" as const, name: item.title, aliases: [], description: item.description, imagePrompt: item.imagePrompt })),
    ],
    shots: bible.scenes.flatMap(scene => scenePlans[scene.id]!.shots),
  });
}

export function buildLongMediaTasks(plan: OriginalPlan, config: OriginalConfig): OriginalTask[] {
  const style = config.style ? `\n统一风格：${config.style}` : "";
  const adultVisual = config.adultExplicit ? `\n${adultDirection}` : "";
  const identity = "\n人物锁定：严格保持角色脸型、五官、发型、发色、肤色、身高、体型、身体比例与唯一标志，不生成相似但不同的人。";
  const tasks: OriginalTask[] = plan.assets.map(asset => ({
    id: `asset:${asset.id}`, kind: "asset", label: `${asset.kind === "character" ? "角色" : "场景"}：${asset.name}`, status: "pending",
    sceneId: asset.kind === "scene" ? asset.id : undefined,
    prompt: `${asset.imagePrompt}\n固定特征：${asset.description}${style}${asset.kind === "character" ? `${identity}\n单人完整全身身份基准，正面脸部清晰且细节充分，只出现此角色，不拼贴、不添加其他人物。${config.adultExplicit ? "角色明确 25 岁以上，裸体全身，生殖器与身体比例清晰可见且无遮挡，不摆出性行为姿势。" : ""}` : "\n独立场景锚点图，清晰展示固定空间、道具与光照，不出现人物。"}`,
  }));
  for (const scene of [...new Set(plan.shots.map(shot => shot.sceneId))]) {
    const sceneShots = plan.shots.filter(shot => shot.sceneId === scene);
    for (const [index, shot] of sceneShots.entries()) {
      const previous = index > 0 ? sceneShots[index - 1] : undefined;
      const imageReferences = previous ? [...shot.characterIds.map(id => `asset:${id}`), `image:${previous.id}`] : [...shot.characterIds.map(id => `asset:${id}`), `asset:${shot.sceneId}`];
      tasks.push({
        id: `image:${shot.id}`, kind: "image", label: `分镜图：${shot.title}`, status: "pending", sceneId: shot.sceneId,
        prompt: `${shot.imagePrompt}${style}${identity}${adultVisual}\n本镜开始状态：${shot.startState}\n${previous ? "以前一镜分镜图保持场景构图连续，并用角色资产锁定身份。" : "以本场景锚点图建立空间与光照，并用角色资产锁定身份。"}\n仅描绘实际出场角色，不添加其他人物。`,
        references: imageReferences,
      });
      tasks.push({
        id: `video:${shot.id}`, kind: "video", label: `镜头视频：${shot.title}`, status: "pending", sceneId: shot.sceneId, attempts: 0,
        prompt: `${shot.videoPrompt}\n动作：${shot.action}\n对白：${shot.dialogue || "无对白"}\n开始状态：${shot.startState}\n结束状态：${shot.endState}\n衔接：${shot.continuity}${style}${identity}${adultVisual}\n${index > 0 && config.continuousShots ? "以同场上一镜最后一帧为本镜第一帧，无缝延续动作、位置、物件和光线。" : index > 0 ? "以本镜分镜图为首帧依据，保持同场角色身份与空间连续。" : "这是本场第一镜，以场景锚点和分镜图重新校准人物与空间，避免继承上一场累积误差。"}`,
        references: [`image:${shot.id}`],
      });
      if (config.faceQaEnabled && shot.characterIds.length) tasks.push({
        id: `qa:${shot.id}`, kind: "qa", label: `人物一致性质检：${shot.title}`, status: "pending", sceneId: shot.sceneId,
        references: [`video:${shot.id}`, ...shot.characterIds.map(id => `asset:${id}`)],
      });
    }
  }
  if (config.stitch) tasks.push({ id: "export", kind: "export", label: "合成长片", status: "pending" });
  return tasks;
}
