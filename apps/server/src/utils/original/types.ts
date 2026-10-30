import { z } from "zod";

const modelSelection = z.strictObject({ providerId: z.string().min(1).max(96), modelId: z.string().min(1).max(256) });
export const originalConfigSchema = z.strictObject({
  language: modelSelection, image: modelSelection.optional(), video: modelSelection.optional(),
  productionMode: z.enum(["short", "long"]).default("short"),
  brief: z.string().trim().min(1).max(50000),
  style: z.string().trim().max(1000),
  characterCount: z.number().int().min(1).max(20),
  shotCount: z.number().int().min(1).max(240),
  targetDurationMinutes: z.number().int().min(1).max(60).default(10),
  sceneCount: z.number().int().min(1).max(60).default(8),
  maxRetries: z.number().int().min(0).max(5).default(0),
  costLimit: z.number().finite().min(0).max(100000).default(0),
  costPerVideo: z.number().finite().positive().max(10000).default(2.01),
  faceQaEnabled: z.boolean().default(false),
  faceThreshold: z.number().finite().min(-1).max(1).default(0.363),
  ratio: z.enum(["16:9", "9:16", "1:1"]),
  duration: z.number().int().positive().max(60),
  resolution: z.string().min(1).max(64),
  qualityTier: z.enum(["draft", "final"]).default("draft"),
  stitch: z.boolean(),
  adultExplicit: z.boolean().default(false),
  characterLock: z.boolean().default(true),
  continuousShots: z.boolean().default(false),
  planningOnly: z.boolean().default(false),
  imageConcurrency: z.number().int().min(1).max(12).default(6),
  videoConcurrency: z.number().int().min(1).max(8).default(4),
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
    startSecond: z.number().finite().nonnegative().optional(), endSecond: z.number().finite().positive().optional(),
    storyBeat: z.enum(["setup", "consent", "escalation", "explicitAction", "climax", "aftermath"]).optional(),
    shotPurpose: z.string().trim().min(1).max(2000).optional(), timingReason: z.string().trim().min(1).max(2000).optional(),
    cameraId: identifier.optional(), parentShotId: identifier.optional(),
    atomicAction: z.string().trim().min(1).max(2000).optional(),
    framing: z.string().trim().min(1).max(1000).optional(),
    characterLayout: z.array(z.strictObject({
      characterId: identifier, screenRegion: z.enum(["leftThird", "centerThird", "rightThird"]),
      position: z.string().trim().min(1).max(1000), facing: z.string().trim().min(1).max(1000),
    })).max(3).optional(),
    action: z.string().trim().min(1).max(6000), dialogue: z.string().max(6000),
    startState: z.string().trim().min(1).max(6000).optional(),
    endState: z.string().trim().min(1).max(6000).optional(),
    continuity: z.string().trim().min(1).max(6000).optional(),
    imagePrompt: z.string().trim().min(1).max(8000), videoPrompt: z.string().trim().min(1).max(8000),
  })).min(1).max(240),
});

const generatedFile = z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().min(1).max(128), mediaType: z.enum(["image", "video", "audio"]), taskId: z.string().min(1).max(512).optional() });
const taskSchema = z.strictObject({
  id: z.string().min(1).max(128), kind: z.enum(["plan", "bible", "scenePlan", "asset", "image", "video", "qa", "contentQa", "export"]), label: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]), prompt: z.string().optional(),
  references: z.array(z.string()).optional(), referenceFrame: z.string().max(2048).optional(), files: z.array(generatedFile).optional(), error: z.string().optional(),
  sceneId: identifier.optional(), attempts: z.number().int().nonnegative().optional(), qaAttempts: z.number().int().nonnegative().optional(), contentQaAttempts: z.number().int().nonnegative().optional(),
  qa: z.strictObject({
    passed: z.boolean(), sampledFrames: z.number().int().nonnegative(), detectedFrames: z.number().int().nonnegative(),
    unknownFaces: z.number().int().nonnegative(), duplicateFrames: z.number().int().nonnegative(),
    characterCoverage: z.record(identifier, z.number().finite().min(0).max(1)),
    averageScores: z.record(identifier, z.number().finite().min(-1).max(1)), reasons: z.array(z.string()),
  }).optional(),
  imageQa: z.strictObject({
    passed: z.boolean(),
    anatomy: z.number().int().min(0).max(100), connection: z.number().int().min(0).max(100),
    realism: z.number().int().min(0).max(100), visibility: z.number().int().min(0).max(100),
    reasons: z.array(z.string().trim().min(1).max(1000)).max(20),
    correctionPrompt: z.string().trim().max(4000),
  }).optional(),
  contentQa: z.strictObject({
    passed: z.boolean(), sampledFrames: z.number().int().min(1).max(24),
    explicitActionVisible: z.number().int().min(0).max(100),
    genitalVisibility: z.number().int().min(0).max(100),
    insertionVisibility: z.number().int().min(0).max(100),
    motionEvidence: z.number().int().min(0).max(100),
    anatomy: z.number().int().min(0).max(100),
    storyMatch: z.number().int().min(0).max(100),
    reasons: z.array(z.string().trim().min(1).max(1000)).max(20),
    correctionPrompt: z.string().trim().max(4000),
  }).optional(),
});
export const originalRunSchema = z.strictObject({
  version: z.literal(1), id: z.uuid(),
  status: z.enum(["running", "pausing", "paused", "failed", "completed", "interrupted"]),
  config: originalConfigSchema,
  createdAt: z.number(), updatedAt: z.number(),
  plan: originalPlanSchema.optional(), tasks: z.array(taskSchema).max(1000),
  longBible: z.unknown().optional(), scenePlans: z.record(identifier, z.unknown()).optional(),
  canvases: z.record(z.string(), z.string()), jsonFiles: z.array(z.string().min(1).max(2048)).max(20).optional(), error: z.string().optional(),
  usage: z.object({ input: z.number(), output: z.number(), totalTokens: z.number() }).optional(),
  estimatedCost: z.number().finite().nonnegative().optional(),
});

export type OriginalConfig = z.infer<typeof originalConfigSchema>;
export type OriginalPlan = z.infer<typeof originalPlanSchema>;
export type OriginalRun = z.infer<typeof originalRunSchema>;
export type OriginalTask = OriginalRun["tasks"][number];
