export type AdultStoryCard = {
  id: string;
  title: string;
  relationship: string;
  premise: string;
  desire: string;
  obstacle: string;
  consentGate: string;
  storyBeats: string[];
  adultProgression: string[];
  cameraPlan: string[];
  climax: string;
  aftermath: string;
  tags: string[];
};

const cards: AdultStoryCard[] = [
  {
    id: "secretReunion", title: "雨夜秘密重逢", relationship: "两名 25 岁以上、曾经相恋的原创虚构成年人",
    premise: "久别后的两人在雨夜酒店重逢，先处理当年突然分开的误会，再决定是否重新开始。",
    desire: "确认彼此仍有感情，并在不留下新的谎言前提下恢复亲密关系。", obstacle: "旧误会、再次分开的期限与被熟人撞见的风险。",
    consentGate: "双方明确说出今晚的意愿、边界和可以随时停止，随后由两人共同关门并主动靠近。",
    storyBeats: ["雨中重逢与回避", "旧误会被说破", "明确确认双方意愿", "主动接触升级", "关系选择被身体行动落实", "约定天亮后的去向"],
    adultProgression: ["克制的亲吻与脱衣", "互相触碰和口交", "面对面性交", "换位后的连续性交", "高潮后相拥"],
    cameraPlan: ["雨窗双人中景建立秘密感", "手部与表情交叉近景", "骨盆高度的无遮挡动作近景", "侧面双人全身镜交代体位与身份", "床边双人脸部中近景收束"],
    climax: "两人在高潮前再次确认不把这次相遇当作告别，动作和关系选择在同一节拍完成。", aftermath: "两人穿回部分衣物坐在雨窗前，决定第二天一起离开。",
    tags: ["久别重逢", "秘密关系", "雨夜", "酒店", "双人", "剧情优先"],
  },
  {
    id: "affairCountdown", title: "偷情倒计时", relationship: "两名 30 岁以上、清醒自愿并各自为选择负责的原创虚构成年人",
    premise: "两人在出差酒店秘密见面，却收到同事提前返回的消息，必须在有限时间里决定继续隐瞒还是结束关系。",
    desire: "确认这段关系究竟是短暂欲望还是愿意承担后果的真实选择。", obstacle: "被发现的倒计时、各自现有关系以及对承诺的逃避。",
    consentGate: "两人先明确这次见面由双方主动选择、任何时刻都可停止，并再次确认房间内没有第三人和拍摄设备。",
    storyBeats: ["秘密抵达与清场", "同事提前返回的消息", "争论是否继续", "明确同意并锁门", "倒计时中的亲密升级", "结束后决定不再维持双重生活"],
    adultProgression: ["急促亲吻与脱衣", "站立前戏", "床边口交", "面对面性交", "换位后的主高潮", "高潮后整理现场"],
    cameraPlan: ["门牌与走廊的风险建立镜", "手机倒计时和双人反应", "人物身份清楚的脱衣中景", "无遮挡成人动作近景与侧面全身镜", "离开前的双人静止近景"],
    climax: "动作高潮与关系选择同时到达：两人决定停止只靠偷情维持关系，并在天亮后分别处理现实。", aftermath: "整理房间时不再说下次偷偷见，而是约定各自先诚实结束旧关系。",
    tags: ["偷情", "出差", "酒店", "倒计时", "秘密关系", "双人", "风险"],
  },
  {
    id: "officeAfterHours", title: "加班后的主动选择", relationship: "两名 28 岁以上、无上下级权力关系的成年合伙人",
    premise: "共同创业的两人在项目上线夜终于承认长期压抑的吸引，但必须先决定是否让关系影响公司。",
    desire: "从工作伙伴变成恋人，同时保住彼此平等和坦诚。", obstacle: "失败项目留下的紧张、办公室玻璃墙与第二天仍要共同工作的现实。",
    consentGate: "两人暂停工作，逐条确认关系、隐私和停止信号，主动关闭门锁并互相说出同意。",
    storyBeats: ["上线成功后的释放", "暧昧被直说", "平等关系与边界确认", "办公桌边的接触升级", "转入休息室完成关系转折", "清晨共同修改合伙协议"],
    adultProgression: ["领带与衬衫的脱衣动作", "站立前戏", "桌边口交", "休息室性交", "高潮后清理与拥抱"],
    cameraPlan: ["办公室灯光和城市夜景大全景", "双人对话中近景", "手与衣物动作特写", "无遮挡成人动作近景与身份清楚的侧面中景交替", "清晨双人同框"],
    climax: "项目成功的庆祝转化为两人主动选择关系的主高潮，而不是无因果动作。", aftermath: "两人并肩坐在地毯上讨论以后如何公开关系。",
    tags: ["办公室", "合伙人", "加班", "都市", "双人", "慢热"],
  },
  {
    id: "neighborPowerOutage", title: "停电夜的越界与回头", relationship: "两名 25 岁以上、长期互有好感的成年邻居",
    premise: "整栋楼停电，一人来借充电宝，两人在烛光里承认一直借小事靠近对方。",
    desire: "把试探变成明确关系。", obstacle: "害怕误读对方、走廊随时来电以及过去失败恋情造成的不信任。",
    consentGate: "亲吻前停下询问，双方说出想继续并确认门已反锁、没有其他人在场。",
    storyBeats: ["借物进入", "停电制造近距离", "承认长期试探", "明确同意", "卧室升级", "来电后仍选择留下"],
    adultProgression: ["烛光亲吻与脱衣", "手部前戏", "口交", "床上性交", "高潮后共同洗澡"],
    cameraPlan: ["门口纵深构图", "烛光脸部双人近景", "身体接触的连续中景", "床沿和骨盆轴线清楚的动作近景", "来电瞬间的双人反应镜"],
    climax: "突然来电照亮房间，两人没有退开，反而用明确选择完成情感与身体高潮。", aftermath: "恢复供电后仍一起吃夜宵，关系从借口式往来转为公开约会。",
    tags: ["邻居", "停电", "烛光", "卧室", "双人", "生活感"],
  },
  {
    id: "firstDateSuite", title: "约会后的套房告白", relationship: "两名 25 岁以上、已在线交往数月的成年人",
    premise: "第一次线下旅行约会结束，两人回到套房后要把文字中的亲密变成现实。",
    desire: "确认线上建立的信任能否在现实中成立。", obstacle: "紧张、理想化期待与对身体的不自信。",
    consentGate: "双方轮流说出想尝试和暂时不想尝试的内容，确认保护措施和停止词。",
    storyBeats: ["约会回房", "交换真实的不安", "边界清单", "第一次裸体面对", "亲密动作逐步升级", "共同记录旅行第二天计划"],
    adultProgression: ["慢速脱衣与身体欣赏", "互相手淫", "口交", "面对面性交", "高潮后的安抚"],
    cameraPlan: ["套房门口跟拍", "沙发双人谈话近景", "镜前双人全身镜", "动作建立中景后切无遮挡细节近景", "床头稳定双人脸部镜"],
    climax: "一方坦白身体焦虑，另一方用语言和动作确认吸引，性爱成为信任兑现而非独立插曲。", aftermath: "两人躺在同一镜位回看白天照片，约好下一次见面。",
    tags: ["初次约会", "旅行", "酒店", "信任", "双人", "温柔"],
  },
  {
    id: "marriedRoleplay", title: "纪念日角色游戏", relationship: "两名 30 岁以上、长期稳定婚姻中的原创虚构成年人",
    premise: "结婚纪念日，两人用事先写好的陌生人角色游戏重新制造初见的紧张。",
    desire: "摆脱日常疲惫，重新确认仍被对方渴望。", obstacle: "工作压力与角色游戏中一度出现的尴尬。",
    consentGate: "开场展示双方共同写下的玩法、边界和停止信号；任何升级都由双方再次确认。",
    storyBeats: ["酒吧假装初见", "角色游戏失误而笑场", "脱离角色坦诚疲惫", "重新确认玩法", "回房完成纪念日愿望", "互送真正的礼物"],
    adultProgression: ["调情与脱衣", "口交", "床边性交", "更换体位", "高潮后按摩"],
    cameraPlan: ["酒吧双人交叉镜", "笑场的脸部近景", "酒店门口连续跟拍", "成人动作中景与关键无遮挡近景", "礼物和双人拥抱特写"],
    climax: "两人不再扮演陌生人，而是以真实身份说出仍然渴望彼此后完成高潮。", aftermath: "交换写有未来一年愿望的信封。",
    tags: ["婚姻", "纪念日", "角色游戏", "酒店", "双人", "成熟关系"],
  },
  {
    id: "photographerMuse", title: "拍摄结束后的表白", relationship: "两名 27 岁以上、彼此平等的独立摄影师与成年模特",
    premise: "商业拍摄收工后，双方确认长期合作中的吸引不是表演，并决定把镜头彻底关掉后继续。",
    desire: "区分工作中的身体呈现与真实私密关系。", obstacle: "职业边界、误把表演当真以及相机造成的被观看感。",
    consentGate: "清楚展示相机断电、存储卡封存和现场清空，随后双方口头确认私下关系和边界。",
    storyBeats: ["完成最后一张工作照", "关闭所有设备", "讨论职业边界", "双向表白", "私人空间中的主动亲密", "决定以后更换合作规则"],
    adultProgression: ["卸妆与换下造型服", "亲吻和手部前戏", "口交", "沙发性交", "高潮后穿上浴袍"],
    cameraPlan: ["摄影棚大全景证明设备状态", "封存存储卡特写", "双人边界对话", "不模拟偷拍视角的稳定成人动作镜", "浴袍双人收束"],
    climax: "真正的亲密只在拍摄结束且镜头关闭后发生，职业边界成为剧情转折。", aftermath: "两人在白板上重写下一次合作条款。",
    tags: ["摄影棚", "模特", "职业边界", "表白", "双人", "都市"],
  },
  {
    id: "chefClosingTime", title: "打烊后的秘密菜单", relationship: "两名 29 岁以上、共同经营餐厅的成年伴侣",
    premise: "新店首日打烊后，两人在厨房复盘争执，决定用一份只属于彼此的夜宵和坦白修复关系。",
    desire: "在事业压力中重新找回亲密。", obstacle: "开业争执、疲惫与害怕继续把工作情绪带进关系。",
    consentGate: "清理完刀具与热源后，两人明确停止工作、确认门锁和意愿，再进入私人休息室。",
    storyBeats: ["打烊清场", "复盘争执", "共同做夜宵", "道歉与同意", "休息室亲密升级", "第二天菜单出现两人的和解菜"],
    adultProgression: ["围裙与衬衫脱下", "亲吻与互相触碰", "口交", "沙发性交", "高潮后分享甜点"],
    cameraPlan: ["厨房纵深大全景", "食物与手部特写", "休息室门口关系转折", "侧面双人动作中景与无遮挡近景", "同吃甜点收束"],
    climax: "两人把当天最伤人的一句话改成真实道歉，关系修复与性爱高潮同步完成。", aftermath: "并肩尝试新甜点，讨论第二天共同面对客人。",
    tags: ["餐厅", "伴侣", "打烊", "和解", "双人", "生活剧情"],
  },
  {
    id: "exhibitionSecret", title: "闭馆后的选择", relationship: "两名 26 岁以上、已互相表白但尚未确定关系的成年策展人",
    premise: "展览闭馆后，两人在最后一件作品前讨论是否接受异地工作，从而必须在当晚做出关系选择。",
    desire: "在离别前确认这段关系值得继续。", obstacle: "异地机会、公共空间规则和害怕承诺。",
    consentGate: "两人先离开展馆进入已预订的私人公寓，在无监控、无旁人的环境中确认意愿和边界。",
    storyBeats: ["闭馆倒计时", "异地消息揭露", "争执与冷静", "转入私人公寓", "确认关系并亲密升级", "共同购买下一次见面的车票"],
    adultProgression: ["门后拥抱与脱衣", "前戏", "口交", "床上性交", "高潮后拥抱谈计划"],
    cameraPlan: ["空展馆对称大全景", "作品与两人反应的交叉镜", "公寓门口连续转场", "身份清楚的双人中景和成人细节近景", "手机车票与相握的手"],
    climax: "一方主动订下下一次见面的日期后，两人以身体行动确认异地关系。", aftermath: "天亮前完成车票订单并在同一张床上睡去。",
    tags: ["展览", "异地", "告白", "私人公寓", "双人", "选择"],
  },
];

export const adultStorySources = [
  { name: "OpenErotica erotica-analysis", url: "https://huggingface.co/datasets/openerotica/erotica-analysis", license: "Apache-2.0", use: "仅研究情节摘要、行为标签和分类方式；不保存或复用小说原文。" },
  { name: "Slate", url: "https://github.com/coracoo/Slate", license: "MIT", use: "参考以单一 storyboard JSON 驱动剧本、资产、镜头和预演的结构。" },
  { name: "ai-novel-screenplay-analyzer", url: "https://github.com/ops120/ai-novel-screenplay-analyzer", license: "MIT", use: "参考人物关系、章节节拍和关系演化分析方式。" },
  { name: "longform", url: "https://github.com/kevboh/longform", license: "MIT", use: "参考长篇母题、场次和连续性组织方式。" },
] as const;

const blocked = /未成年|年龄不明|幼女|幼男|高中生|初中生|小学生|校服|强迫|迷奸|昏迷|偷窥|乱伦|兄妹|父女|母子|兽交|人与动物发生|尸体|真实人物仿造|偷拍/i;

export function selectAdultStoryCards(brief: string, limit = 4) {
  if (blocked.test(brief)) throw new Error("成人剧情库只支持明确成年、原创虚构、清醒知情且自愿的角色关系");
  const query = brief.toLowerCase();
  return cards
    .map((card, index) => ({ card, index, score: card.tags.reduce((score, tag) => score + (query.includes(tag.toLowerCase()) ? 3 : 0), 0) + (query.includes(card.title.toLowerCase()) ? 5 : 0) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, Math.min(limit, cards.length)))
    .map(item => item.card);
}

export function adultStoryLibraryInstruction(brief: string) {
  const selected = selectAdultStoryCards(brief);
  return `以下是从公开、可追溯来源的方法论中归纳并人工重写的原创成人剧情结构卡。它们只提供关系、冲突、同意节点、升级节拍、镜头策略和余韵，不是原文；选择最贴合需求的一张作为骨架，也可组合两张，但不得照抄标题或人物：\n${JSON.stringify(selected)}`;
}

export function adultStoryLibrarySnapshot(brief: string) {
  return { version: 1, policy: "仅保存衍生结构卡；过滤年龄模糊、非自愿、乱伦、兽交、偷拍、真实人物仿造等内容。", sources: adultStorySources, selected: selectAdultStoryCards(brief) };
}
