import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { translateError } from "@/lib/i18n";
import u from "@/utils";

const inputSchema = z.object({
  directory: z.string().min(1),
  prompt: z.string().trim().min(1).max(100000),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  const { directory, prompt } = req.body as z.infer<typeof inputSchema>;
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  const controller = new AbortController();
  const close = () => controller.abort(new DOMException("Codex 连接已关闭", "AbortError"));
  req.once("aborted", close);
  res.once("close", close);
  res.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (event: unknown) => {
    if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  try {
    await u.codex.codex.run(cwd, prompt, send, controller.signal);
    send({ type: "done" });
  } catch (error) {
    if (!controller.signal.aborted) send({ type: "error", message: translateError(error) });
  } finally {
    req.off("aborted", close);
    res.off("close", close);
    if (!res.writableEnded) res.end();
  }
});
