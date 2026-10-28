import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

const schema = z.strictObject({ directory: z.string().min(1).max(4096), runId: z.uuid(), action: z.enum(["pause", "resume"]), acceptUncertain: z.boolean().optional() });
export default Router().post("/", validateFields(schema.shape), async (req, res) => {
  const input = schema.parse(req.body);
  const cwd = await u.workspace.resolveWorkspace(req, input.directory);
  res.set("Cache-Control", "no-store").json(success(await u.original.control(cwd, input.runId, input.action, input.acceptUncertain)));
});
