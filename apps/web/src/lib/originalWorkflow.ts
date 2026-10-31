import useWorkspaceFiles from "@/lib/workspaceFiles";

export type OriginalMode = "original" | "adaptation";
export const originalModes = [
  { id: "original" as const, label: "原创短剧", description: "从一个灵感开始，建立故事、角色和镜头。" },
  { id: "adaptation" as const, label: "小说改编", description: "导入小说或章节，先整理剧情再改编剧本。" },
];

export const originalStages = [
  { id: "story", label: "故事与结构", file: "stage01Story.json", brief: "锁定前提、戏核、结局、主要转折、人物目标与阻力，形成可检验的节拍结构。小说改编需核对原文并列出保留与改动。" },
  { id: "script", label: "完整剧本", file: "stage02Script.json", brief: "根据确认的结构，按场次写出时间、地点、出场角色、动作、台词、转场和因果；每场必须发生价值变化。" },
  { id: "assets", label: "人物/场景/道具资产", file: "stage03Assets.json", brief: "先合并角色别名并建立唯一角色 ID，再建立人物三视图、场景锚点与叙事道具。资产确认后才允许生成分镜图，禁止先出图再合并人物。" },
  { id: "storyboard", label: "导演分镜", file: "stage04Storyboard.json", brief: "把剧本拆成不超过模型上限的生成段，每段再拆 2–5 秒镜头，记录角色 ID、构图、动作、运镜、对白、声音、时长和连续性接点。" },
  { id: "images", label: "分镜关键帧", file: "stage05Images.json", brief: "逐镜绑定人物、场景资产和参考图，保留生图提示词、负面词、种子与模型参数；主关键帧和转场关键帧都必须可见、可替换。" },
  { id: "videos", label: "分段视频与 QA", file: "stage06Videos.json", brief: "使用关键帧、人物和场景参考分段生成；上一段尾帧连接下一段。逐段检查人脸、人数、服装、空间、动作和时长，失败时只重跑失败节点。" },
  { id: "export", label: "合成导出", file: "stage07Export.json", brief: "只接纳 QA 通过的片段，核对镜头顺序、配音、字幕、音轨和转场后合成；保留采用版本、替换记录和最终验收结果。" },
] as const;

export type OriginalProject = { yaohaoOriginal: true; version: 1; mode: OriginalMode; brief: string };

export async function createOriginalProject(directory: string, mode: OriginalMode, brief: string) {
  const files = useWorkspaceFiles(directory);
  const created: string[] = [];
  try {
    for (const stage of originalStages) {
      const text = `# ${stage.label}\n\n${stage.brief}\n\n${stage.id === "story" ? `## 创作需求\n\n${brief.trim() || "在此填写故事灵感或小说改编要求。"}\n\n` : ""}## 创作内容\n\n`;
      await files.writeJson(stage.file, {
        toonflowCanvas: true,
        nodes: [{ id: crypto.randomUUID(), type: "remote-textNode", position: { x: 100, y: 220 }, data: { label: stage.label, outputs: { text: { dataType: "STRING", value: text } } } }],
        edges: [], viewport: { x: 0, y: 0, zoom: 1 },
      }, true);
      created.push(stage.file);
    }
    await files.writeJson("originalProject.json", { yaohaoOriginal: true, version: 1, mode, brief } satisfies OriginalProject, true);
  } catch (error) {
    const rollback = await Promise.allSettled(created.map(path => files.remove(path)));
    if (rollback.some(result => result.status === "rejected")) throw new Error("项目初始化失败，部分文件未能清理；请检查所选目录后重试。", { cause: error });
    throw error;
  }
}

export function originalAgentPrompt(mode: OriginalMode, brief: string) {
  return `这是耀好原创工作室的${mode === "adaptation" ? "小说改编" : "原创短剧"}项目。\n创作需求：${brief}\n\n工作目录已有 originalProject.json 和七个阶段画布。先读取它们。创作顺序为：${originalStages.map(stage => stage.label).join(" → ")}。本轮先完善故事与结构，保存到 stage01Story.json 的文本节点，然后给出待确认方案。后续阶段必须引用已确认的前序内容。完整剧本确认后先合并角色别名并建立唯一角色 ID，再生成资产；禁止先出图再合并。每阶段的提示词、参考绑定、参数和 QA 必须保留在画布中。工作流可以一键连续推进，但必须透明、可暂停、可修改、可局部重跑。不要自动提交付费生图、生视频或覆盖已确认的后续内容。`;
}

export function originalCodexWorkflowPrompt() {
  return `通过 toonflow MCP 读取当前工作区状态、originalProject.json、workflow skill 和现有七个阶段画布。按照“${originalStages.map(stage => stage.label).join(" → ")}”检查并搭建完整做剧工作流。要求：\n1. 复用现有阶段与已完成节点，不重复重建。\n2. 每个阶段都在对应画布保留可查看、可修改的成果节点、提示词、参数、参考图绑定和依赖连线。\n3. 剧本确认后先合并角色别名、建立唯一角色 ID，再生成人物三视图、场景与道具资产。\n4. 分镜按模型上限拆成生成段，段内镜头 2–5 秒；锁定人物、人脸、场景、服装、时间与空间方向。\n5. 上一镜尾帧连接下一镜；生成后逐段执行人脸、人数、角色、场景、动作、时长和连续性 QA。\n6. QA 失败只重跑失败节点，不重跑整片；只有通过的片段才能进入合成。\n7. 不直接生成整段长视频。未经明确要求，不提交付费媒体生成。\n先汇报读取到的当前阶段和缺口，然后直接在画布中补全工作流骨架。`;
}
