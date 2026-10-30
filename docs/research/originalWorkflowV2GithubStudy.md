# 原创工作流 v2：GitHub 项目调研与落地设计

## 结论

当前低质量的主因不是提示词强度，而是制片链路把“剧本、身份、镜头状态、参考图和质检”压成了一次生成。原创视频应采用可审核、可恢复的逐阶段生产：

```text
创作需求
→ Story Bible / 角色关系 / 场景规则
→ episode / act / beat
→ 原子镜头合同 + camera tree
→ 单人身份母版及派生锚点
→ 分镜关键帧审核
→ 单镜视频预览与 QA
→ 批量生成
→ 合成与交付核验
```

一张九宫格或三视图拼贴不能直接充当视频时间轴。它会把同一人物的多个视图当成多个人物，增加复制身体、融合脸、换脸和身份污染。视频模型每镜只应接收有限且职责明确的参考。

## 一手项目与可复用设计

### ArcReel

- 仓库：https://github.com/ArcReel/ArcReel
- 重点：`docs/research/storyboard-to-video-industry-survey.md`
- 可复用结论：底层视频能力主要是 reference-to-video、first/last frame 和逐镜时间线编排；分镜板必须切成独立镜头后逐镜生成。
- 资产策略：approved canonical identity 派生 face、full body、costume、pose/expression variant；派生图保留父身份，不能每次重新文生图。
- 参考图数量应使用保守上限，不能因为上游允许九张就把所有邻近分镜全部塞入。

### ViMax

- 仓库：https://github.com/HKUDS/ViMax
- 重点：`pipelines/script2video_pipeline.py`、`agents/reference_image_selector.py`、`agents/storyboard_artist.py`
- 可复用结论：使用 camera tree，而非简单“上一镜串下一镜”。镜头拆成静态身份、动态服装/姿势、首帧人物和尾帧人物；父镜头先生成，子镜头沿同机位参考链派生。
- 角色肖像 registry 独立保存并复用，已有帧与肖像可跳过，支持真实断点续跑。

### DramaClaw

- 仓库：https://github.com/dramaclaw/dramaclaw
- 重点：`.hermes/skills/workflows/references/short-drama.md`
- 可复用结论：依赖关系应是故事 → 角色/场景 → beat → 分镜 → 图片 → 视频 → 音频 → 合成 → QA，不应把所有素材强行串成一条线。
- “试一段”应展开一至三个 beat 的完整闭环，而不是先生成全片低质量素材。

### OpenMontage

- 仓库：https://github.com/calesthio/OpenMontage
- 可复用结论：contact sheet 是付费视频生成前的 approval gate。每个 scene 展示 take、prompt、成本和 quality score；确认后才进入视频阶段。
- 视频生成后执行 ffprobe、抽帧、音量和交付条件核验；失败按阶段与错误类别恢复，而非无限重推同一个 prompt。

### 身份和动作控制

- StoryDiffusion：https://github.com/HVision-NKU/StoryDiffusion
- ConsisID：https://github.com/PKU-YuanGroup/ConsisID
- Stand-In：https://github.com/WeChatCV/Stand-In
- IP-Adapter：https://github.com/cubiq/ComfyUI_IPAdapter_plus
- PuLID：https://github.com/cubiq/PuLID_ComfyUI
- VACE：https://github.com/ali-vilab/VACE
- LTX-Video：https://github.com/Lightricks/LTX-Video
- FramePack：https://github.com/lllyasviel/FramePack

只写“同一张脸”不能形成模型层锁脸。本地路线应使用 FaceID/IP-Adapter/PuLID/ConsisID/Stand-In 等身份条件；动作与转场需要 pose、reference video、video-to-video、首尾帧或 multi-keyframe 条件。

## 当前工程根因

1. 480p 适合作为低成本剧情与节奏预览，但不能把它的细节上限误判成最终模型上限；当前产品按用户选择继续以 480p 为默认快速成片档。
2. 单张横屏三视图包含同一人物三次，视频模型容易理解成多人。
3. 五秒镜头同时要求走位、脱衣、换姿势、取道具和主要动作，超过单镜承载能力。
4. 当前镜头会同时携带本镜分镜、人物板、场景图、邻近分镜和上一镜尾帧，参考职责冲突。
5. 连续性只保存“上一镜尾帧”，没有 camera、parent shot、costume、pose、prop 和 scene geometry 状态。
6. QA 在昂贵视频生成后才发现问题，缺少故事、资产、关键帧和单镜预览关卡。
7. Shugando Seedance 适配器支持首帧和图片参考，但没有真正的 last frame 输入，无法把文本要求当作可靠的首尾帧插值。

## v2 数据合同

每镜至少保存：

```json
{
  "beatId": "beat03",
  "cameraId": "cameraBedroomA",
  "parentShotId": "shot04",
  "atomicAction": "角色从门边走到床边并停下",
  "startState": "人物、服装、姿势、道具、灯光和空间状态",
  "endState": "完成单一状态变化后的准确状态",
  "visibleCharacters": ["characterA"],
  "identityReferences": ["assetVariant:characterA:face"],
  "sceneReference": "asset:bedroom",
  "firstFrame": "image:shot05",
  "duration": 5,
  "resolution": "480p"
}
```

单镜规则：一个主要动作，最多一个位置、服装或道具状态转移。超过即在媒体提交前拒绝并要求拆镜。

## 本轮已落地

- 角色资产从“三视图拼贴”改为单人竖屏全身身份母版。
- 每名角色从母版派生一张单人正脸身份锚点，派生任务显式依赖父图。
- 分镜图参考预算：每人一张正脸锚点 + 一张场景锚点 + 最多一个同场前序关键帧。
- 视频参考预算：当前/连续首帧 + 每人一张正脸锚点 + 一张场景锚点；取消邻近分镜堆叠。
- 分镜合同新增 `cameraId`、`parentShotId` 和 `atomicAction`。
- 提交媒体前执行原子镜头验证，阻止把多次走位、换装、换姿势和道具操作塞进同一镜头。
- 快速成片默认 480p，最终质量档仍可按需选择 1080p。

## 后续路线

1. 在画布中增加 Story、Assets、Keyframes、Shot Preview 四级人工审核关卡。
2. 给每个 take 展示 prompt、参考图、成本、QA 分数和采用/重生成操作。
3. 将 costume、pose、prop、scene geometry 从自然语言拆成结构化状态。
4. 对支持 last frame / multi-keyframe 的模型新增真正的首尾帧调度；Seedance 保持“首帧 + 身份锚点”路径。
5. GPU 条件允许时接入 ComfyUI + IP-Adapter/PuLID/StoryDiffusion 生成关键帧，Stand-In/VACE 或 ConsisID 进行身份与动作控制。

