import { z } from "zod";

const modelSelection = z.strictObject({ providerId: z.string().min(1).max(96), modelId: z.string().min(1).max(256) });
export const originalConfigSchema = z.strictObject({
  language: modelSelection, image: modelSelection, video: modelSelection,
  brief: z.string().trim().min(1).max(50000),
  style: z.string().trim().max(1000),
  characterCount: z.number().int().min(1).max(20),
  shotCount: z.number().int().min(1).max(60),
  ratio: z.enum(["16:9", "9:16", "1:1"]),
  duration: z.number().int().positive().max(60),
  resolution: z.string().min(1).max(64),
  stitch: z.boolean(),
});

const identifier = z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/);
export const originalPlanSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  synopsis: z.string().trim().min(1).max(10000),
  script: z.string().trim().min(1).max(100000),
  assets: z.array(z.strictObject({
    id: identifier, kind: z.enum(["character", "scene"]), name: z.string().trim().min(1).max(100),
    aliases: z.array(z.string().trim().min(1).max(100)).max(30),
    description: z.string().trim().min(1).max(4000), imagePrompt: z.string().trim().min(1).max(8000),
  })).min(2).max(80),
  shots: z.array(z.strictObject({
    id: identifier, title: z.string().trim().min(1).max(200), sceneId: identifier,
    characterIds: z.array(identifier).max(20),
    action: z.string().trim().min(1).max(6000), dialogue: z.string().max(6000),
    imagePrompt: z.string().trim().min(1).max(8000), videoPrompt: z.string().trim().min(1).max(8000),
  })).min(1).max(60),
});

const generatedFile = z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().min(1).max(128), mediaType: z.enum(["image", "video", "audio"]), taskId: z.string().min(1).max(512).optional() });
const taskSchema = z.strictObject({
  id: z.string().min(1).max(128), kind: z.enum(["plan", "asset", "image", "video", "export"]), label: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]), prompt: z.string().optional(),
  references: z.array(z.string()).optional(), files: z.array(generatedFile).optional(), error: z.string().optional(),
});
export const originalRunSchema = z.strictObject({
  version: z.literal(1), id: z.uuid(),
  status: z.enum(["running", "pausing", "paused", "failed", "completed", "interrupted"]),
  config: originalConfigSchema,
  createdAt: z.number(), updatedAt: z.number(),
  plan: originalPlanSchema.optional(), tasks: z.array(taskSchema).max(220),
  canvases: z.record(z.string(), z.string()), error: z.string().optional(),
  usage: z.object({ input: z.number(), output: z.number(), totalTokens: z.number() }).optional(),
});

export type OriginalConfig = z.infer<typeof originalConfigSchema>;
export type OriginalPlan = z.infer<typeof originalPlanSchema>;
export type OriginalRun = z.infer<typeof originalRunSchema>;
export type OriginalTask = OriginalRun["tasks"][number];
