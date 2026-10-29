const rules = [
  { type: "input", field: "apiKey" as const, title: "API Key", value: "", props: { type: "password", showPassword: true, autocomplete: "off" } },
  { type: "input", field: "baseUrl" as const, title: "网关地址", value: "https://api.shugando.jp/v1" },
  { type: "input", field: "uploadUrl" as const, title: "参考图上传地址", value: "", props: { placeholder: "https://媒体服务/api/media" } },
  { type: "input", field: "uploadUser" as const, title: "媒体服务用户名", value: "" },
  { type: "input", field: "uploadToken" as const, title: "媒体服务令牌", value: "", props: { type: "password", showPassword: true, autocomplete: "off" } },
] as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Shugando 响应格式错误");
  return value as Record<string, unknown>;
}

function endpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("服务地址须为不含凭据和查询参数的 HTTPS 地址");
  return url.href.replace(/\/+$/, "");
}

async function json(context: ProviderContext, response: Response, stage: string) {
  if (!response.ok) throw new Error(`Shugando ${stage}失败：HTTP ${response.status} ${context.tool.errorMessage(await response.text())}`);
  const result = object(await response.json());
  if (result.error || result.success === false) throw new Error(context.tool.errorMessage(result) || "Shugando 请求失败");
  return result;
}

async function bytes(context: ProviderContext, input: MediaInput, signal: AbortSignal) {
  if (input.type === "binary") return new Uint8Array(input.data);
  if (input.type === "base64") return new Uint8Array(Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ""), "base64"));
  const response = await context.tool.fetch(input.url, { signal });
  if (!response.ok) throw new Error(`参考图读取失败：HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function multipart(context: ProviderContext, fields: Record<string, string>, images: MediaInput[], signal: AbortSignal) {
  const boundary = `----shugando${Date.now()}${Math.random().toString(16).slice(2)}`;
  const parts: NonNullable<ConstructorParameters<typeof Blob>[0]> = [];
  for (const [key, value] of Object.entries(fields)) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
  for (const [index, input] of images.entries()) {
    const mime = input.mimeType || "image/png";
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mime];
    if (!extension) throw new Error("参考图仅支持 PNG、JPEG 或 WebP");
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="reference${index}.${extension}"\r\nContent-Type: ${mime}\r\n\r\n`, await bytes(context, input, signal), "\r\n");
  }
  parts.push(`--${boundary}--\r\n`);
  return { body: new Blob(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function referenceUrl(context: ProviderContext<ProviderConfig<typeof rules>>, input: MediaInput, signal: AbortSignal) {
  if (input.type === "url") {
    const url = new URL(input.url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("参考图必须是 HTTPS 图片地址");
    return url.href;
  }
  if (!context.config.uploadUrl || !context.config.uploadUser || !context.config.uploadToken) throw new Error("开白图片参考需要配置参考图上传地址、用户名与令牌");
  const response = await context.tool.fetch(endpoint(context.config.uploadUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${context.config.uploadToken}`, "X-Username": context.config.uploadUser, "Content-Type": input.mimeType },
    body: await bytes(context, input, signal), signal,
  });
  const result = await json(context, response, "参考图上传");
  if (typeof result.url !== "string" || !/^https:\/\//.test(result.url)) throw new Error("上传服务未返回 HTTPS 参考图地址");
  return result.url;
}

function wait(signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 5000);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export default {
  id: "shugando",
  label: "Shugando",
  icon: "",
  version: "1.0.0",
  readme: "使用现有 Shugando 网关 Key。GPT Image 参考图通过 multipart 编辑接口提交；Seedream 开白模型先上传参考图，再以 HTTPS 地址调用 JSON 编辑接口。Seedance 支持首帧和最多 9 张附加参考图，均使用已登录媒体服务。视频仅提交一次，随后查询同一任务；错误显示任务编号供核对。",
  rules,
  models: [
    { id: "gpt-image-2.5", label: "GPT Image 2.5", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1K"], imageRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"] },
    { id: "seedream-5.0-white", label: "Seedream 5.0 开白", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1K"], imageRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"] },
    { id: "Dola-Seedream-5.0-Pro-white", label: "Dola Seedream 5.0 Pro 开白", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1K"], imageRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"] },
    { id: "seedance-2.0-white", label: "Seedance 2.0", type: "video", mode: ["text", "startFrameOptional", ["imageReference:9"]], durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p", "1080p"] }] },
  ] satisfies ProviderModel[],
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey.trim();
    if (!apiKey) throw new Error("请填写 Shugando API Key");
    if (!["gpt-image-2.5", "seedream-5.0-white", "Dola-Seedream-5.0-Pro-white"].includes(request.model)) throw new Error("此适配器尚未接入所选图片模型");
    const sizes: Record<string, string> = { "16:9": "1792x1024", "9:16": "1024x1792", "1:1": "1024x1024", "4:3": "1344x1024", "3:4": "1024x1344" };
    const size = sizes[request.ratio || "1:1"];
    if (!size || request.size && request.size !== "1K") throw new Error("图片画幅或尺寸不受支持");
    if (request.mask || (request.n ?? 1) !== 1) throw new Error("当前连接仅支持单张无蒙版生成");
    const images = request.images ?? [];
    const imageLimit = request.model === "gpt-image-2.5" ? 4 : request.model === "Dola-Seedream-5.0-Pro-white" ? 10 : 14;
    if (images.length > imageLimit) throw new Error(`当前 Shugando 图片模型最多支持 ${imageLimit} 张参考图`);
    const signal = AbortSignal.any([AbortSignal.timeout(15 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const fields = { model: request.model, prompt: request.prompt, size, n: "1", response_format: "url" };
    const whiteSeedream = request.model === "seedream-5.0-white" || request.model === "Dola-Seedream-5.0-Pro-white";
    const urls = images.length && whiteSeedream ? await Promise.all(images.map(input => referenceUrl(this, input, signal))) : [];
    const form = images.length && !whiteSeedream ? await multipart(this, fields, images, signal) : undefined;
    const response = await this.tool.fetch(`${endpoint(this.config.baseUrl)}/images/${images.length ? "edits" : "generations"}`, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": form?.contentType ?? "application/json" },
      body: form?.body ?? JSON.stringify(urls.length ? { ...fields, n: 1, image: urls[0], images: urls, image_urls: urls } : { ...fields, n: 1 }), signal,
    });
    const result = await json(this, response, "图片生成");
    if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error("图片接口未返回唯一结果");
    const image = object(result.data[0]);
    if (typeof image.url === "string" && /^https:\/\//.test(image.url)) return [{ mediaType: "image", type: "url", url: image.url }];
    if (typeof image.b64_json === "string" && image.b64_json) return [{ mediaType: "image", type: "base64", data: image.b64_json, mimeType: "image/png" }];
    throw new Error("图片接口未返回图片地址或数据");
  },
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey.trim();
    if (!apiKey) throw new Error("请填写 Shugando API Key");
    if (request.model !== "seedance-2.0-white") throw new Error("此适配器尚未接入所选视频模型");
    const supportedMode = !request.mode
      || typeof request.mode === "string" && ["text", "startFrameOptional"].includes(request.mode)
      || Array.isArray(request.mode) && request.mode.every(value => value === "imageReference:9");
    if (request.lastFrame || request.videos?.length || request.audios?.length || !supportedMode) throw new Error("当前 Shugando 视频连接已接入首帧和最多 9 张图片参考；视频与音频参考需等待网关字段实测后启用");
    const references = request.images ?? [];
    if (references.length > 9) throw new Error("Seedance 2.0 视频最多支持 9 张附加参考图");
    const duration = request.duration ?? 4;
    const resolution = request.resolution ?? "480p";
    const ratios: Record<string, [number, number]> = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1] };
    const ratio = request.ratio ?? "16:9";
    const dimensions = ratios[ratio];
    const short = { "480p": 480, "720p": 720, "1080p": 1080 }[resolution];
    if (!Number.isInteger(duration) || duration < 4 || duration > 15 || !dimensions || !short) throw new Error("视频仅支持 4–15 整数秒、16:9 / 9:16 / 1:1、480p / 720p / 1080p");
    const signal = AbortSignal.any([AbortSignal.timeout(25 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const image = request.firstFrame ? await referenceUrl(this, request.firstFrame, signal) : undefined;
    const referenceImages = await Promise.all(references.map(input => referenceUrl(this, input, signal)));
    const images = [...(image ? [image] : []), ...referenceImages];
    const long = { "480p": 864, "720p": 1280, "1080p": 1920 }[resolution]!;
    const width = dimensions[0] > dimensions[1] ? long : short;
    const height = dimensions[1] > dimensions[0] ? long : short;
    const baseUrl = endpoint(this.config.baseUrl);
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    const submitted = await json(this, await this.tool.fetch(`${baseUrl}/videos`, {
      method: "POST", headers, signal,
      body: JSON.stringify({
        model: request.model, prompt: request.prompt, text: request.prompt, seconds: String(duration), duration,
        ratio, aspect_ratio: ratio, resolution, width, height, size: `${width}x${height}`, videoType: images.length ? 2 : 1,
        ...(image ? { image, firstFrame: image, first_frame: image } : {}),
        ...(images.length ? { images, imageUrls: images, image_urls: images } : {}),
        ...(referenceImages.length ? { referenceImages, reference_images: referenceImages } : {}),
      }),
    }), "视频提交");
    const task = submitted.data && typeof submitted.data === "object" ? object(submitted.data) : submitted;
    const taskId = task.id ?? task.task_id;
    if (typeof taskId !== "string" || !taskId) throw new Error("视频提交未返回任务编号，请核对上游记录后再操作");
    try {
      while (true) {
        const result = await json(this, await this.tool.fetch(`${baseUrl}/videos/${encodeURIComponent(taskId)}`, { headers, signal }), "视频查询");
        const current = result.data && typeof result.data === "object" ? object(result.data) : result;
        if (["failed", "failure", "error", "canceled", "cancelled", "expired"].includes(String(current.status))) throw new Error(this.tool.errorMessage(current) || "视频生成失败");
        if (["completed", "succeeded", "success", "done", "finished"].includes(String(current.status))) {
          const response = await this.tool.fetch(`${baseUrl}/videos/${encodeURIComponent(taskId)}/content`, { headers, signal });
          if (!response.ok) throw new Error(`视频下载失败：HTTP ${response.status}`);
          return [{ mediaType: "video", type: "binary", data: new Uint8Array(await response.arrayBuffer()), mimeType: "video/mp4", taskId }];
        }
        await wait(signal);
      }
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}（视频任务 ${taskId}，请查询此任务，不要重复提交）`);
    }
  },
} satisfies ProviderDefinition<typeof rules>;
