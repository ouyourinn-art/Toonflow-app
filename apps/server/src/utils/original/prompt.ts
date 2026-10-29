import type { OriginalConfig, OriginalPlan } from "./types";

type Shot = OriginalPlan["shots"][number];
type Asset = OriginalPlan["assets"][number];
export type StoryBeat = NonNullable<Shot["storyBeat"]>;

const regionNames = { leftThird: "竖屏左侧三分区", centerThird: "竖屏中央三分区", rightThird: "竖屏右侧三分区" } as const;

export const adultDirection = "所有角色均为明确 25 岁以上的原创虚构成年人，清醒、知情且自愿。直接、具体、生动地设计裸体和双方自愿的性行为；画面提示词明确生殖器持续清晰可见、性交动作与插入关系可辨认，不遮挡、不裁切关键部位，也不以亲吻或拥抱代替指定行为。禁止未成年人或年龄模糊者、强迫、迷奸、昏迷、偷窥、乱伦、暴力、非人动物和真实人物仿造。";
export const adultAnatomyDirection = "真实人体解剖硬约束：阴茎必须从男性耻骨区自然延伸，根部、阴茎体、冠状沟和龟头比例连续真实；女性阴阜、外阴唇与阴道口位置和层次符合成年人体结构。插入点只能位于阴道口，阴茎轴线、女性骨盆角度和进入方向必须一致，并保留真实的皮肤接触阴影、轻微压痕与组织连续性。允许按创作需求呈现明显大于平均但仍符合成年人体比例的阴茎；严格禁止假阳具或塑料质感、橡胶管状阴茎、阴茎悬浮或脱离身体、阴茎从大腿或腹部错误长出、插入大腿或臀部、错误孔位、器官融合、重复生殖器、解剖学不可能的夸张尺寸、穿模、肢体黏连和人体蜡像感。";

export function explicitStartShot(config: OriginalConfig) {
  if (config.adultExplicit && config.shotCount === 1) return 0;
  if (config.adultExplicit && config.shotCount <= 4) return 0;
  return Math.max(2, Math.ceil(config.shotCount * 0.15));
}

export function storyBeatOrder(config: OriginalConfig): StoryBeat[] {
  if (config.adultExplicit && config.shotCount === 1) return ["explicitAction"];
  if (config.adultExplicit && config.shotCount === 2) return ["explicitAction", "aftermath"];
  if (config.adultExplicit && config.shotCount === 3) return ["explicitAction", "climax", "aftermath"];
  if (config.adultExplicit && config.shotCount === 4) return ["explicitAction", "escalation", "climax", "aftermath"];
  return config.adultExplicit
    ? ["setup", "consent", "explicitAction", "escalation", "climax", "aftermath"]
    : ["setup", "escalation", "climax", "aftermath"];
}

export function storyArcInstruction(config: OriginalConfig) {
  if (config.adultExplicit && config.shotCount === 1) {
    return `这是单镜成人高光实验，storyBeat 固定为 explicitAction。必须在同一镜头内部按秒完成：开头快速确认双方清醒自愿 → 进入明确成人动作 → 动作与情绪达到高点 → 结尾留下清楚余韵。shotPurpose、framing、action、imagePrompt 和 videoPrompt 必须清楚呈现双方自愿的性交与插入关系，并至少包含一个无遮挡的生殖器细节特写；不能用亲吻、拥抱、远景或镜外暗示替代。`;
  }
  if (config.adultExplicit && config.shotCount === 4) {
    return `这是成人高光短片，双方已在镜外完成清醒、自愿与边界确认；不得再消耗整镜做铺垫。四镜依次为 explicitAction（立即进入清楚的性交动作）→ escalation（更换姿势并升级节奏）→ climax（无遮挡生殖器特写与最强动作）→ aftermath（前段继续动作，末段自然放缓收束）。每镜都要有不同但因果连续的姿势、机位或动作重点，至少三镜清楚呈现真实插入关系，不能用亲吻、拥抱或远景替代。`;
  }
  if (config.adultExplicit && config.shotCount <= 3) {
    return `这是成人高光短片，双方已在镜外完成清醒、自愿与边界确认；不得再消耗整镜做铺垫。第一镜立即进入明确成人动作，最后一镜在前段继续动作、末段自然放缓收束；至少一镜清楚呈现真实插入关系与无遮挡生殖器特写，不能用亲吻、拥抱或远景替代。`;
  }
  const beats = config.adultExplicit
    ? "setup（立即建立人物、关系与欲望）→ consent（明确清醒自愿）→ explicitAction（进入初次明确成人动作，形成开场小高潮）→ escalation（持续升级动作与情绪）→ climax（全片主高潮）→ aftermath（有因果结果的余韵）"
    : "setup（建立人物与目标）→ escalation（冲突升级）→ climax（高潮）→ aftermath（有因果结果的收束）";
  const adultShots = config.adultExplicit
    ? ` 按单镜粒度把铺垫控制在全片开头约 15%：前 ${explicitStartShot(config)} 镜完成快速铺垫与明确同意，禁止 explicitAction；第 ${explicitStartShot(config) + 1} 镜必须进入明确成人动作。explicitAction 镜必须清楚呈现双方自愿的性交与插入关系；全片至少安排一个无遮挡的生殖器细节特写，framing 和 shotPurpose 必须明确写出该特写，不能用亲吻、拥抱或远景替代。最后一镜必须是 aftermath。`
    : " 最后一镜必须是 aftermath。";
  return `完整故事必须覆盖 ${beats}，每镜只承担一个清楚的 storyBeat 和 shotPurpose；相邻镜头不得只是更换同义动作。${adultShots}`;
}

export function timingInstruction(config: OriginalConfig, startShot = 0) {
  return `绝对时间轴由系统锁定：第 i 镜 startSecond = (${startShot} + i) × ${config.duration}，endSecond = startSecond + ${config.duration}；不得重叠、留白或改变单镜时长。`;
}

function ratioInstruction(config: OriginalConfig) {
  return config.ratio === "9:16"
    ? "系统画幅锁定为竖屏 9:16，后文或原始需求中的任何冲突画幅均无效；主体沿纵向安排，关键脸部与本镜动作主体处于安全区，不生成横屏画面、横屏黑边或旋转画面。"
    : `系统画幅锁定为 ${config.ratio}，后文或原始需求中的任何冲突画幅均无效；不改变方向或增加黑边。`;
}

function identityLines(plan: OriginalPlan, shot: Shot) {
  return shot.characterIds.map(id => {
    const asset = plan.assets.find(item => item.id === id && item.kind === "character");
    if (!asset) throw new Error(`分镜 ${shot.id} 缺少角色资产：${id}`);
    return `${asset.id} / ${asset.name}：${asset.description}`;
  });
}

function layoutLines(plan: OriginalPlan, shot: Shot) {
  return (shot.characterLayout ?? []).map(item => {
    const asset = plan.assets.find(value => value.id === item.characterId && value.kind === "character");
    if (!asset) throw new Error(`分镜 ${shot.id} 的人物站位引用无效：${item.characterId}`);
    return `${asset.id} / ${asset.name} 固定在${regionNames[item.screenRegion]}；位置与姿势：${item.position}；朝向与视线：${item.facing}`;
  });
}

function exactCastBlock(plan: OriginalPlan, shot: Shot) {
  const identities = identityLines(plan, shot);
  const layouts = layoutLines(plan, shot);
  const names = shot.characterIds.map(id => plan.assets.find(item => item.id === id)?.name ?? id);
  return `本镜精确出场 ${shot.characterIds.length} 人：${names.join("、") || "无人空镜"}。只允许 characterIds=[${shot.characterIds.join(", ")}]，不得出现任何其他人、背景路人、旁观者、镜中人、屏幕中的人、照片人物、重复人物或孪生脸。
不可变身份指纹：
${identities.join("\n") || "本镜为空镜，不得出现人物。"}
竖屏区域绑定：
${layouts.join("\n") || "本镜为空镜，无人物区域。"}`;
}

function exclusionBlock(shot: Shot) {
  return `严格排除：额外人物，人数错误，重复角色，交换脸，融合脸，身份漂移，发型漂移，体型漂移，服装状态漂移，额外头部，额外手脚，肢体融合，重复或畸形身体部位，遮挡本镜主体，错误倒影，文字，字幕，水印，拼贴，多宫格，分屏。${shot.characterIds.length > 1 ? "每张脸和身体必须只属于其绑定角色，不能把不同参考图混成一个人。" : "画面中只能有唯一指定角色。"}`;
}

export function buildAssetPrompt(asset: Asset, config: OriginalConfig) {
  const style = config.style ? `\n统一风格：${config.style}` : "";
  if (asset.kind === "scene") return `${asset.imagePrompt}\n固定场景：${asset.description}${style}\n${ratioInstruction(config)}\n独立场景锚点图，清晰展示固定空间、材质、道具位置和光线，不出现人物、人体、倒影人物、照片人物、文字或拼贴。`;
  const adult = config.adultExplicit ? "\n角色明确 25 岁以上，裸体全身身份基准，脸部、身体比例及生殖器清晰可见且无遮挡，不摆出性行为姿势。" : "";
  return `${asset.imagePrompt}\n不可变身份指纹：${asset.description}${style}\n${ratioInstruction(config)}\n单人身份母版，只出现 ${asset.id} / ${asset.name} 一人；正面脸清晰，中性表情，完整全身，固定发型、脸型、五官、肤色、体型、身体比例和唯一标志。${adult}\n严格排除其他人物、重复脸、镜中人、拼贴、多宫格、裁脸、遮脸、额外肢体、文字和水印。`;
}

export function buildImagePrompt(plan: OriginalPlan, shot: Shot, config: OriginalConfig, references: string[]) {
  const style = config.style ? `\n统一风格：${config.style}` : "";
  const adult = config.adultExplicit ? `\n${adultDirection}\n${adultAnatomyDirection}` : "";
  const referenceLines = references.map((id, index) => {
    if (id.startsWith("asset:")) {
      const assetId = id.slice("asset:".length);
      const asset = plan.assets.find(item => item.id === assetId);
      return `参考图 ${index + 1} = ${asset?.kind === "character" ? "人物身份母版" : "场景锚点"} ${asset?.id ?? assetId} / ${asset?.name ?? assetId}`;
    }
    return `参考图 ${index + 1} = 同场上一镜构图连续帧，只继承空间、姿势与光线，不得覆盖前面的人物身份母版`;
  });
  return `镜头合同：绝对时间 ${shot.startSecond}-${shot.endSecond} 秒；storyBeat=${shot.storyBeat}；镜头目的=${shot.shotPurpose}；景别与镜头=${shot.framing}。
${ratioInstruction(config)}
${exactCastBlock(plan, shot)}
参考图优先级从高到低，人物身份母版始终高于连续帧或场景图：
${referenceLines.join("\n")}
本镜第一帧：${shot.imagePrompt}
开始状态：${shot.startState || "按完整剧本承接"}${style}${adult}
${exclusionBlock(shot)}`;
}

export function buildVideoPrompt(plan: OriginalPlan, shot: Shot, config: OriginalConfig) {
  const duration = (shot.endSecond ?? config.duration) - (shot.startSecond ?? 0);
  const first = Number((duration * 0.2).toFixed(1));
  const last = Number((duration * 0.8).toFixed(1));
  const style = config.style ? `\n统一风格：${config.style}` : "";
  const adult = config.adultExplicit ? `\n${adultDirection}\n${adultAnatomyDirection}` : "";
  return `镜头合同：本段严格 ${duration} 秒，对应全片绝对时间 ${shot.startSecond}-${shot.endSecond} 秒；storyBeat=${shot.storyBeat}；镜头目的=${shot.shotPurpose}；景别与运镜=${shot.framing}。
${ratioInstruction(config)}
${exactCastBlock(plan, shot)}
动作与声音：${shot.videoPrompt}
具体动作：${shot.action}
对白：${shot.dialogue || "无对白"}
0-${first} 秒：从首帧稳定建立人物位置、脸和动作起点；${first}-${last} 秒：连续完成主要动作，不切换身份或场景；${last}-${duration} 秒：自然到达结束状态并为下一镜保留清晰尾帧。
开始状态：${shot.startState || "按分镜首帧开始"}
结束状态：${shot.endState || "按完整剧本结束"}
衔接：${shot.continuity || "按完整剧本连续承接"}${style}${adult}
全段是一个连续镜头，不重置动作，不突然换人、增人、消失、换脸、换发型、换体型、换场景或切成蒙太奇。${exclusionBlock(shot)}`;
}

export function buildFaceCorrectionPrompt(plan: OriginalPlan, shot: Shot, attempt: number, reasons: string[]) {
  return `\n\n【人物身份纠偏重试】
这是第 ${attempt + 1} 次生成，上一版人物一致性质检失败：${reasons.join("；")}。
${exactCastBlock(plan, shot)}
本次必须把首帧中的脸当作不可替换的身份锚点：保持相同脸型、眉眼间距、鼻形、唇形、下颌线、发际线、发型、肤色和年龄感；运动、转头、表情及身体动作都不得改变身份。每个角色只能出现在其绑定区域，禁止陌生脸、脸部融合、换脸、同一角色复制、角色互换或新增人物。先稳定保持脸和人数，再完成镜头动作。`;
}

export function faceQaApplicable(shot: Shot) {
  return !/(生殖器|阴茎|阴道|外阴|genital).{0,40}(特写|近景|close[ -]?up)|(特写|近景|close[ -]?up).{0,40}(生殖器|阴茎|阴道|外阴|genital)/i.test(`${shot.shotPurpose} ${shot.framing}`);
}
