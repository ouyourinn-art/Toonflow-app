import { z } from "zod";
import { longBibleSchema, longScenePlanSchema, type LongBible, type LongScenePlan } from "./longTypes";
import { originalPlanSchema, type OriginalConfig, type OriginalPlan, type OriginalTask } from "./types";
import { adultDirection, buildAssetPrompt, buildImagePrompt, buildVideoPrompt, explicitStartShot, faceQaApplicable, imageReferenceIds, imageReferenceLimit, storyArcInstruction, storyBeatOrder, timingInstruction, videoReferenceIds, type StoryBeat } from "./prompt";

export function shotAllocation(shotCount: number, sceneCount: number) {
  return Array.from({ length: sceneCount }, (_, index) => Math.floor(shotCount / sceneCount) + (index < shotCount % sceneCount ? 1 : 0));
}

export function buildLongBiblePrompt(config: OriginalConfig) {
  const allocation = shotAllocation(config.shotCount, config.sceneCount);
  const scenes = allocation.map((count, index) => `第 ${index + 1} 场：${count} 镜`).join("；");
  return `为一部 ${config.targetDurationMinutes} 分钟的连贯长片建立全片圣经，只规划全局角色、故事弧与分场，不在本次展开逐镜分镜。\n创作需求：${config.brief}\n视觉风格：${config.style || "电影写实"}\n全片严格锁定 ${config.characterCount} 个角色、${config.sceneCount} 个场景、${config.shotCount} 个镜头，每镜 ${config.duration} 秒，画幅 ${config.ratio}。系统配置的 ${config.ratio} 是唯一有效画幅，需求文字中的冲突画幅视为旧信息并忽略。分配必须精确为：${scenes}。\n${config.adultExplicit ? adultDirection : "内容强度严格跟随创作需求，不自行增加露骨成人内容。"}\n${storyArcInstruction(config)}\n${timingInstruction(config)}\n每个角色建立不可变身份指纹，写清年龄、脸型、五官、发型发色、肤色、身高、体型、身体比例与唯一标志。角色更衣、姿势或称呼变化不得拆成新人。每个场景写清空间布局、固定光线、入场状态、离场状态、情节目标和因果承接；场景之间必须形成因果连续的完整故事而非动作清单。场景 ID 与角色 ID 全片唯一。每个场景最多安排 3 个实际出场角色。角色资产提示词要求单人、完整全身、正面脸清晰、身份特征可辨、无拼贴；场景资产不得出现人物。\n只输出符合下列 JSON Schema 的一个 JSON 对象，不加代码围栏或解释：\n${JSON.stringify(z.toJSONSchema(longBibleSchema))}`;
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

export function buildLongScenePrompt(config: OriginalConfig, bible: LongBible, scene: LongBible["scenes"][number], startShot: number, previousEndState?: string, previousStoryBeat?: StoryBeat) {
  const characters = bible.characters.filter(item => scene.characterIds.includes(item.id));
  const endShot = startShot + scene.shotCount - 1;
  const beatWindow = config.adultExplicit
    ? `本场覆盖全片第 ${startShot + 1}-${endShot + 1} 镜；explicitAction 的全片固定起点是第 ${explicitStartShot(config) + 1} 镜，早于该镜禁止 explicitAction，到达该镜必须进入 explicitAction。上一镜 storyBeat=${previousStoryBeat || "无（全片开场）"}，本场不得回退到更早的剧情节拍。`
    : `本场覆盖全片第 ${startShot + 1}-${endShot + 1} 镜；上一镜 storyBeat=${previousStoryBeat || "无（全片开场）"}，本场不得回退到更早的剧情节拍。`;
  return `根据全片圣经展开第 ${bible.scenes.indexOf(scene) + 1} 场的完整剧本和逐镜方案，不改动既定角色、场景数或故事弧。\n全片：${bible.title}\n全片梗概：${bible.synopsis}\n故事弧：${bible.storyArc}\n当前场景：${JSON.stringify(scene)}\n出场角色身份库：${JSON.stringify(characters)}\n上一场最终状态：${previousEndState || "全片开场"}\n${beatWindow}\n视觉风格：${config.style || "电影写实"}\n${config.adultExplicit ? adultDirection : "内容强度严格跟随创作需求。"}\n${storyArcInstruction(config)}\n${timingInstruction(config, startShot)}\n必须生成恰好 ${scene.shotCount} 镜，每镜 ${config.duration} 秒。所有 shot.sceneId 必须为 ${scene.id}；shot.id 全片唯一，建议以 ${scene.id}Shot 开头。每镜最多 3 个角色，只能引用当前场景出场角色。每镜必须填写 storyBeat、shotPurpose、framing 和 characterLayout；characterLayout 必须与 characterIds 完全相同且每人绑定不同的 leftThird / centerThird / rightThird 竖屏区域，明确位置、姿势、朝向和视线。第 1 镜 startState 精确继承上一场最终状态或当前场景入场状态；之后每镜 startState 精确继承前一镜 endState。continuity 明确动作、位置、视线、服装、道具、光线、情绪和因果接续。imagePrompt 描述第一帧静态构图；videoPrompt 按本镜 0-${config.duration} 秒描述从 startState 到 endState 的连续动作、运镜、节奏和声音。对白只写入 dialogue。最后一镜 endState 必须达到场景既定离场状态。不得添加新角色、字幕、拼贴或画外人物。\n只输出符合下列 JSON Schema 的一个 JSON 对象，不加代码围栏或解释：\n${JSON.stringify(z.toJSONSchema(longScenePlanSchema))}`;
}

export function validateLongScene(plan: LongScenePlan, bible: LongBible, scene: LongBible["scenes"][number], usedShotIds: Set<string>, config: OriginalConfig, previousStoryBeat?: StoryBeat) {
  if (plan.sceneId !== scene.id || plan.shots.length !== scene.shotCount) throw new Error(`场景 ${scene.id} 的分镜数量或场景 ID 不正确`);
  const characters = new Set(scene.characterIds);
  const sceneIndex = bible.scenes.indexOf(scene);
  const startShot = bible.scenes.slice(0, sceneIndex).reduce((total, item) => total + item.shotCount, 0);
  const beatOrder = storyBeatOrder(config);
  let previousBeat = previousStoryBeat ? beatOrder.indexOf(previousStoryBeat) : -1;
  for (const [index, shot] of plan.shots.entries()) {
    if (usedShotIds.has(shot.id)) throw new Error(`长片分镜 ID 重复：${shot.id}`);
    usedShotIds.add(shot.id);
    if (shot.sceneId !== scene.id || new Set(shot.characterIds).size !== shot.characterIds.length || shot.characterIds.some(id => !characters.has(id))) throw new Error(`分镜 ${shot.id} 的角色或场景引用无效`);
    if (shot.startSecond !== (startShot + index) * config.duration || shot.endSecond !== shot.startSecond + config.duration) throw new Error(`分镜 ${shot.id} 的时间轴未锁定为 ${config.duration} 秒`);
    if (!shot.storyBeat || !shot.shotPurpose || !shot.framing) throw new Error(`分镜 ${shot.id} 缺少剧情节拍、镜头目的或景别`);
    const currentBeat = beatOrder.indexOf(shot.storyBeat);
    if (currentBeat < 0 || currentBeat < previousBeat) throw new Error(`分镜 ${shot.id} 的剧情节拍倒退；必须按 ${beatOrder.join(" → ")} 推进`);
    previousBeat = currentBeat;
    const globalIndex = startShot + index;
    if (config.adultExplicit && (globalIndex < explicitStartShot(config) && shot.storyBeat === "explicitAction" || globalIndex === explicitStartShot(config) && shot.storyBeat !== "explicitAction")) throw new Error(`分镜 ${shot.id} 未遵守前 15% 快速铺垫与固定成人段落起点`);
    const layout = shot.characterLayout ?? (() => { throw new Error(`分镜 ${shot.id} 缺少人物区域`); })();
    const layoutIds = layout.map(item => item.characterId);
    if (layoutIds.length !== shot.characterIds.length || new Set(layoutIds).size !== layoutIds.length || layoutIds.some(id => !shot.characterIds.includes(id)) || new Set(layout.map(item => item.screenRegion)).size !== layout.length) throw new Error(`分镜 ${shot.id} 的人物区域未与实际出场角色一一绑定`);
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
  const tasks: OriginalTask[] = plan.assets.map(asset => ({
    id: `asset:${asset.id}`, kind: "asset", label: `${asset.kind === "character" ? "角色" : "场景"}：${asset.name}`, status: "pending",
    sceneId: asset.kind === "scene" ? asset.id : undefined,
    prompt: buildAssetPrompt(asset, config),
  }));
  for (const scene of [...new Set(plan.shots.map(shot => shot.sceneId))]) {
    const sceneShots = plan.shots.filter(shot => shot.sceneId === scene);
    for (const [index, shot] of sceneShots.entries()) {
      const previous = index > 0 ? sceneShots[index - 1] : undefined;
      const imageReferences = imageReferenceIds(shot, previous && config.continuousShots ? previous : undefined, imageReferenceLimit(config));
      tasks.push({
        id: `image:${shot.id}`, kind: "image", label: `分镜图：${shot.title}`, status: "pending", sceneId: shot.sceneId,
        prompt: buildImagePrompt(plan, shot, config, imageReferences),
        references: imageReferences,
      });
      tasks.push({
        id: `video:${shot.id}`, kind: "video", label: `镜头视频：${shot.title}`, status: "pending", sceneId: shot.sceneId, attempts: 0,
        prompt: `${buildVideoPrompt(plan, shot, config)}\n${index > 0 && config.continuousShots ? "以同场上一镜最后一帧为本镜第一帧，无缝延续动作、位置、物件和光线。" : "以本镜已锁身份的分镜图作为首帧，优先保持脸与人物数量。"}`,
        references: videoReferenceIds(shot),
      });
      if (config.faceQaEnabled && shot.characterIds.length && faceQaApplicable(shot)) tasks.push({
        id: `qa:${shot.id}`, kind: "qa", label: `人物一致性质检：${shot.title}`, status: "pending", sceneId: shot.sceneId,
        references: [`video:${shot.id}`, ...shot.characterIds.map(id => `asset:${id}`)],
      });
    }
  }
  if (config.stitch) tasks.push({ id: "export", kind: "export", label: "合成长片", status: "pending" });
  return tasks;
}
