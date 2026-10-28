import useWorkspaceFiles from "@/lib/workspaceFiles";

export type OriginalMode = "original" | "adaptation";
export const originalModes = [
  { id: "original" as const, label: "原创短剧", description: "从一个灵感开始，建立故事、角色和镜头。" },
  { id: "adaptation" as const, label: "小说改编", description: "导入小说或章节，先整理剧情再改编剧本。" },
];

export const originalStages = [
  { id: "story", label: "故事构思", file: "stage01Story.json", brief: "确定题材、受众、篇幅、主线冲突、开端与结局。小说改编需先核对原文，列出保留与改动。" },
  { id: "script", label: "完整剧本", file: "stage02Script.json", brief: "根据确认的故事，按场次写出时间、地点、出场角色、动作、台词和转场，检查前后因果。" },
  { id: "assets", label: "人物与资产", file: "stage03Assets.json", brief: "先从完整剧本建立唯一角色表，再整理场景与道具。角色使用固定 ID、姓名、别名、外貌及服装；同一人的不同称呼必须归到同一 ID。确认后才生成资产图。" },
  { id: "storyboard", label: "导演分镜", file: "stage04Storyboard.json", brief: "以完整剧本和唯一角色表为依据，逐镜列出场次、镜号、出场角色 ID、景别、构图、动作、运镜、对白、声音和时长，检查视线、服装与空间连续性。" },
  { id: "images", label: "分镜图", file: "stage05Images.json", brief: "引用已确认的人物、场景资产和分镜，逐镜整理可见的生图提示词、参考图与模型参数。先确认资产引用和提示词，再逐镜生成。" },
  { id: "videos", label: "视频", file: "stage06Videos.json", brief: "引用对应分镜图、角色资产和镜头描述，整理视频提示词、动作、运镜、时长与画幅。时长和参考图数量以实际所选模型能力为准，逐镜生成并记录结果。" },
  { id: "export", label: "导出", file: "stage07Export.json", brief: "核对镜头顺序、成片比例、配音、字幕和音轨，检查缺失素材，再通过现有视频处理工具合成、导出。" },
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
  return `这是耀好原创工作室的${mode === "adaptation" ? "小说改编" : "原创短剧"}项目。\n创作需求：${brief}\n\n工作目录已有 originalProject.json 和七个阶段画布。先读取它们。创作顺序为：${originalStages.map(stage => stage.label).join(" → ")}。本轮只完善故事构思，保存到 stage01Story.json 的文本节点，然后给出待确认的故事方案。后续剧本、人物与分镜应引用已确认的前序内容，不从零重复猜测角色。完整剧本确认后先合并角色别名、建立唯一角色 ID，再安排资产图。每阶段的提示词应保留在对应画布中供查看和修改。不要自动提交付费生图、生视频或覆盖已确认的后续内容。`;
}
