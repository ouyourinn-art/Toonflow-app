import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/);
const characterSchema = z.strictObject({
  id: identifier, name: z.string().trim().min(1).max(100), aliases: z.array(z.string().trim().min(1).max(100)).max(30),
  description: z.string().trim().min(1).max(4000), imagePrompt: z.string().trim().min(1).max(8000),
});
const sceneSchema = z.strictObject({
  id: identifier, title: z.string().trim().min(1).max(200), characterIds: z.array(identifier).max(20),
  shotCount: z.number().int().min(1).max(12), purpose: z.string().trim().min(1).max(4000),
  synopsis: z.string().trim().min(1).max(10000), startState: z.string().trim().min(1).max(6000),
  endState: z.string().trim().min(1).max(6000), description: z.string().trim().min(1).max(4000),
  imagePrompt: z.string().trim().min(1).max(8000),
});

export const longBibleSchema = z.strictObject({
  title: z.string().trim().min(1).max(200), synopsis: z.string().trim().min(1).max(10000),
  storyArc: z.string().trim().min(1).max(30000), characters: z.array(characterSchema).min(1).max(20),
  scenes: z.array(sceneSchema).min(1).max(60),
});

export const longScenePlanSchema = z.strictObject({
  sceneId: identifier, script: z.string().trim().min(1).max(30000),
  shots: z.array(z.strictObject({
    id: identifier, title: z.string().trim().min(1).max(200), sceneId: identifier,
    characterIds: z.array(identifier).max(3), action: z.string().trim().min(1).max(6000),
    dialogue: z.string().max(6000), startState: z.string().trim().min(1).max(6000),
    endState: z.string().trim().min(1).max(6000), continuity: z.string().trim().min(1).max(6000),
    imagePrompt: z.string().trim().min(1).max(8000), videoPrompt: z.string().trim().min(1).max(8000),
  })).min(1).max(12),
});

export type LongBible = z.infer<typeof longBibleSchema>;
export type LongScenePlan = z.infer<typeof longScenePlanSchema>;
