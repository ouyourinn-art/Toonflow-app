import type { OriginalConfig, OriginalPlan } from "./types";

type Shot = OriginalPlan["shots"][number];
type Asset = OriginalPlan["assets"][number];
export type StoryBeat = NonNullable<Shot["storyBeat"]>;

const regionNames = { leftThird: "竖屏左侧三分区", centerThird: "竖屏中央三分区", rightThird: "竖屏右侧三分区" } as const;

export const adultDirection = "所有角色均为明确 25 岁以上的原创虚构成年人，清醒、知情且自愿。先建立人物关系、欲望、明确同意和因果，再逐步进入裸体、前戏与双方自愿的性行为；不得把完整故事退化成无剧情的动作循环。明确成人动作镜直接、具体、生动地呈现指定行为与情绪，不以亲吻、拥抱、远景或镜外暗示替代。禁止未成年人或年龄模糊者、强迫、迷奸、昏迷、偷窥、乱伦、暴力、非人动物和真实人物仿造。";
export const adultAnatomyDirection = "真实人体解剖硬约束：阴茎必须从男性耻骨区自然延伸，根部、阴茎体、冠状沟和龟头比例连续真实；根部至龟头的物理长度与粗细在同一镜头内始终固定，可见长度只能因为口腔、外阴或阴道的真实遮挡而改变，器官本身不得伸长、缩短、膨胀或收缩。女性阴阜、外阴唇与阴道口位置和层次符合成年人体结构。插入点只能位于阴道口，阴茎轴线、女性骨盆角度和进入方向必须一致，并保留真实的皮肤接触阴影、轻微压痕与组织连续性。允许按创作需求呈现明显大于平均但仍符合成年人体比例的阴茎；严格禁止假阳具或塑料质感、橡胶管状阴茎、望远镜式伸缩、阴茎悬浮或脱离身体、阴茎从大腿或腹部错误长出、插入大腿或臀部、错误孔位、器官融合、重复生殖器、解剖学不可能的夸张尺寸、穿模、肢体黏连和人体蜡像感。";
export const adultMotionDirection = "成人动作运动学硬约束：口交或性交的往复必须来自人物头部、躯干或骨盆整体沿固定轴线移动，阴茎根部与男性骨盆保持刚性连接，根部至龟头距离逐帧不变。后撤时因为口腔或阴道遮挡减少而露出更多同一根阴茎，推进时因为真实进入而遮挡增加；不得让阴茎自身像活塞、橡胶管或望远镜一样伸缩，不得用镜头变焦、画面缩放、身体漂移或局部形变冒充抽插。";

export const shortShotDurations = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

export function explicitStartShot(config: OriginalConfig) {
  if (config.adultExplicit && config.shotCount === 1) return 0;
  if (config.adultExplicit && config.shotCount === 2) return 0;
  if (config.adultExplicit && config.shotCount <= 4) return 1;
  return Math.max(2, Math.ceil(config.shotCount * 0.15));
}

export function storyBeatOrder(config: OriginalConfig): StoryBeat[] {
  if (config.adultExplicit && config.shotCount === 1) return ["explicitAction"];
  if (config.adultExplicit && config.shotCount === 2) return ["explicitAction", "aftermath"];
  if (config.adultExplicit && config.shotCount === 3) return ["setup", "explicitAction", "aftermath"];
  if (config.adultExplicit && config.shotCount === 4) return ["setup", "explicitAction", "climax", "aftermath"];
  return config.adultExplicit
    ? ["setup", "consent", "explicitAction", "escalation", "climax", "aftermath"]
    : ["setup", "escalation", "climax", "aftermath"];
}

export function storyArcInstruction(config: OriginalConfig) {
  if (config.adultExplicit && config.shotCount === 1) {
    return `这是单镜成人高光实验，storyBeat 固定为 explicitAction。必须在同一镜头内部按秒完成：开头快速确认双方清醒自愿 → 进入明确成人动作 → 动作与情绪达到高点 → 结尾留下清楚余韵。shotPurpose、framing、action、imagePrompt 和 videoPrompt 必须清楚呈现双方自愿的性交与插入关系，并至少包含一个无遮挡的生殖器细节特写；不能用亲吻、拥抱、远景或镜外暗示替代。`;
  }
  if (config.adultExplicit && config.shotCount === 4) {
    return `这是有完整剧情的成人短片。四镜依次为 setup（建立人物、欲望与明确同意）→ explicitAction（进入清楚的成人动作）→ climax（用新的体位或机位达到主高潮）→ aftermath（动作结束后的亲密余韵）。每镜只承担一个因果连续的剧情任务，不能四镜共用同一首帧，也不能把故事退化成同一交合画面的重复裁切。`;
  }
  if (config.adultExplicit && config.shotCount === 3) {
    return `这是有完整剧情的成人短片。三镜依次为 setup（建立关系、欲望与明确同意）→ explicitAction（进入清楚的成人动作并完成高潮）→ aftermath（动作结束后的亲密余韵）。三镜必须使用各自匹配剧情的独立首帧，不能重复裁切同一画面。`;
  }
  if (config.adultExplicit && config.shotCount <= 3) {
    return `这是成人高光短片，双方已在镜外完成清醒、自愿与边界确认；不得再消耗整镜做铺垫。第一镜立即进入明确成人动作，最后一镜在前段继续动作、末段自然放缓收束；至少一镜清楚呈现真实插入关系与无遮挡生殖器特写，不能用亲吻、拥抱或远景替代。`;
  }
  const beats = config.adultExplicit
    ? "setup（立即建立人物、关系与欲望）→ consent（明确清醒自愿）→ explicitAction（进入初次明确成人动作，形成开场小高潮）→ escalation（持续升级动作与情绪）→ climax（全片主高潮）→ aftermath（有因果结果的余韵）"
    : "setup（建立人物与目标）→ escalation（冲突升级）→ climax（高潮）→ aftermath（有因果结果的收束）";
  const targetDuration = config.shotCount * config.duration;
  const adultShots = config.adultExplicit
    ? ` 先用人物处境、秘密或风险建立戏剧张力并完成明确同意，首次 explicitAction 应在全片开头约 10%-25% 之间发生（本片最迟 ${Math.max(8, Math.ceil(targetDuration * 0.25))} 秒前进入），不能一开场毫无关系铺垫，也不能拖到半片以后。explicitAction 镜必须清楚呈现双方自愿的性交与插入关系；全片至少安排一个无遮挡的生殖器细节特写，framing 和 shotPurpose 必须明确写出该特写，不能用亲吻、拥抱或远景替代。最后一镜必须是 aftermath。`
    : " 最后一镜必须是 aftermath。";
  return `完整故事必须覆盖 ${beats}，每镜只承担一个清楚的 storyBeat 和 shotPurpose；相邻镜头不得只是更换同义动作。${adultShots}`;
}

export function timingInstruction(config: OriginalConfig, startShot = 0) {
  if (config.productionMode === "long" || !config.adultExplicit) return `绝对时间轴由系统锁定：第 i 镜 startSecond = (${startShot} + i) × ${config.duration}，endSecond = startSecond + ${config.duration}；不得重叠、留白或改变单镜时长。`;
  const total = config.shotCount * config.duration;
  return `短片总时长严格为 ${total} 秒、共 ${config.shotCount} 镜；${config.duration} 秒只是目标平均镜长，不是每镜固定值。每镜时长必须从 [${shortShotDurations.join(", ")}] 秒中选择，第一镜从 0 秒开始，相邻镜头首尾精确相接，最后一镜必须在 ${total} 秒结束。按内容容量分配：单一反应或单一动作 4-5 秒；一句短对白加一个反应、或两个连续动作拍 6-8 秒；复杂换位、脱衣、转身、接触建立或有停顿的关键对白 9-12 秒；只有确实包含三个连续动作拍的关键场面才使用 13-15 秒。对白按普通语速约每秒 3 个汉字、低语约每秒 2 个汉字估算，并额外保留约 1 秒首尾安全余量。每镜填写 timingReason，说明动作拍数、对白容量和选择该时长的理由；不能把本应拆镜的多个动作硬塞进一镜。`;
}

export function screenplayInstruction(config: OriginalConfig) {
  const theme = config.adultExplicit
    ? "若需求未指定具体母题，从秘密关系、偷情风险、久别重逢、办公室秘密关系、初次约会中选择一个最适合的母题；偷情或秘密关系只能发生在原创虚构、25 岁以上、清醒知情且自愿的成年人之间。"
    : "若需求未指定具体母题，选择一个能在目标时长内完成起承转合的关系或目标冲突。";
  return `先按常规动漫本子写完整剧本，再拆导演分镜，禁止直接从动作清单开始。${theme}
script 必须严格采用下面的可读格式：
作品名 EP001：集标题
目标时长 / 画幅 / 视觉风格
剧情母题：一句话写清关系与风险
剧情梗概：写清主角欲望、阻碍、主动选择、关系变化、高潮与余韵
人物小传：每人写外在目标、隐藏欲望、边界和本集关系变化

1-1 场景名 日或夜/内或外
人物：本场实际出场者
场景目标：人物想得到什么
阻碍：什么妨碍他或她
△动作、环境、关键状态
人物名：台词
△对方反应与下一行动
转折/卡点：本场出现的新信息、选择或关系变化
场景结果：这一场如何因果推动下一场
[必要转场]
---
1-2 下一场景……
本集结束点：明确写出高潮后的关系结果和余韵。
每一场和每一镜都必须给观众新信息；卡点来自风险被发现、欲望被确认、边界被选择、关系发生变化或关键动作真正完成，不能只靠换姿势或换机位冒充剧情。`;
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
  const explicit = shot.storyBeat === "explicitAction" || shot.storyBeat === "escalation" || shot.storyBeat === "climax";
  const adult = config.adultExplicit ? `\n${adultDirection}${explicit ? `\n${adultAnatomyDirection}` : ""}` : "";
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
  const explicit = shot.storyBeat === "explicitAction" || shot.storyBeat === "escalation" || shot.storyBeat === "climax";
  const adult = config.adultExplicit ? `\n${adultDirection}${explicit ? `\n${adultAnatomyDirection}\n${adultMotionDirection}` : ""}` : "";
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
