import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeAtomic } from "@toonflow/file";
import { z } from "zod";

const modelSpecs = [
  { name: "faceDetectionYuNet.onnx", url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx", size: 232589, hash: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4" },
  { name: "faceRecognitionSFace.onnx", url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx", size: 38696353, hash: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79" },
] as const;

const resultSchema = z.strictObject({
  passed: z.boolean(), sampledFrames: z.number().int().nonnegative(), detectedFrames: z.number().int().nonnegative(),
  unknownFaces: z.number().int().nonnegative(), duplicateFrames: z.number().int().nonnegative(),
  characterCoverage: z.record(z.string(), z.number().finite().min(0).max(1)),
  averageScores: z.record(z.string(), z.number().finite().min(-1).max(1)), reasons: z.array(z.string()),
});

export type FaceQaResult = z.infer<typeof resultSchema>;
let prepared: Promise<{ python: string; detector: string; recognizer: string }> | undefined;

const pythonScript = String.raw`
import cv2, json, math, numpy, sys

payload = json.load(sys.stdin)
detector = cv2.FaceDetectorYN.create(payload["detector"], "", (320, 320), 0.75, 0.3, 5000)
recognizer = cv2.FaceRecognizerSF.create(payload["recognizer"], "")

def features(image, score_threshold=0.75):
    if image is None or image.size == 0:
        return []
    height, width = image.shape[:2]
    if max(height, width) > 1024:
        scale = 1024.0 / max(height, width)
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        height, width = image.shape[:2]
    detector.setScoreThreshold(score_threshold)
    detector.setInputSize((width, height))
    faces = detector.detect(image)[1]
    if faces is None:
        return []
    result = []
    for face in faces:
        try:
            crop = recognizer.alignCrop(image, face)
            result.append((float(face[2] * face[3]), recognizer.feature(crop)))
        except cv2.error:
            pass
    return result

references = {}
for item in payload["references"]:
    found = features(cv2.imdecode(numpy.fromfile(item["path"], dtype=numpy.uint8), cv2.IMREAD_COLOR))
    if not found:
        raise RuntimeError("角色资产未检测到可用于锁定身份的正面人脸：" + item["id"])
    references[item["id"]] = max(found, key=lambda value: value[0])[1]

capture = cv2.VideoCapture(payload["video"])
if not capture.isOpened():
    raise RuntimeError("无法读取待质检视频")
fps = capture.get(cv2.CAP_PROP_FPS)
if not math.isfinite(fps) or fps <= 0:
    fps = 30.0
interval = max(1, round(fps * 0.5))
sampled = detected = unknown = duplicates = total_faces = 0
matched_frames = {key: 0 for key in references}
scores = {key: [] for key in references}
frame_index = 0
while True:
    ok, frame = capture.read()
    if not ok:
        break
    if frame_index % interval:
        frame_index += 1
        continue
    frame_index += 1
    sampled += 1
    found = features(frame)
    if found:
        detected += 1
    frame_matches = []
    for _, feature in found:
        total_faces += 1
        candidates = [(key, float(recognizer.match(reference, feature, cv2.FaceRecognizerSF_FR_COSINE))) for key, reference in references.items()]
        key, score = max(candidates, key=lambda value: value[1])
        if score >= payload["threshold"]:
            frame_matches.append(key)
            scores[key].append(score)
        else:
            unknown += 1
    for key in set(frame_matches):
        matched_frames[key] += 1
    if len(frame_matches) != len(set(frame_matches)):
        duplicates += 1
capture.release()

coverage = {key: (value / sampled if sampled else 0.0) for key, value in matched_frames.items()}
averages = {key: (sum(value) / len(value) if value else -1.0) for key, value in scores.items()}
reasons = []
if sampled == 0:
    reasons.append("视频没有可抽取的画面")
elif detected / sampled < 0.35:
    reasons.append("可检测人脸的画面少于 35%")
for key, value in coverage.items():
    if value < 0.10:
        reasons.append("角色 " + key + " 的同人脸画面少于 10%")
if total_faces and unknown / total_faces > 0.25:
    reasons.append("陌生或无法匹配的人脸超过 25%")
if sampled and duplicates / sampled > 0.15:
    reasons.append("同一角色在单帧内重复出现的比例超过 15%")
print(json.dumps({"passed": len(reasons) == 0, "sampledFrames": sampled, "detectedFrames": detected, "unknownFaces": unknown, "duplicateFrames": duplicates, "characterCoverage": coverage, "averageScores": averages, "reasons": reasons}, ensure_ascii=False))
`;

async function modelPath(directory: string, spec: typeof modelSpecs[number]) {
  const path = join(directory, spec.name);
  try {
    const info = await stat(path);
    if (info.isFile() && info.size === spec.size && createHash("sha256").update(await readFile(path)).digest("hex") === spec.hash) return path;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const response = await fetch(spec.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`下载人脸质检模型失败（HTTP ${response.status}）`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== spec.size || createHash("sha256").update(bytes).digest("hex") !== spec.hash) throw new Error(`人脸质检模型校验失败：${spec.name}`);
  await writeAtomic(path, bytes, { mode: 0o600 });
  return path;
}

export async function prepareFaceQa() {
  if (prepared) return prepared;
  prepared = (async () => {
    const python = Bun.which("python") || Bun.which("python3");
    if (!python) throw new Error("人物一致性质检需要 Python 3 与 OpenCV（cv2）");
    const check = Bun.spawn([python, "-c", "import cv2; print(cv2.__version__)"], { stdout: "pipe", stderr: "pipe", windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    const [code, error] = await Promise.all([check.exited, new Response(check.stderr).text()]);
    if (code !== 0) throw new Error(`人物一致性质检无法加载 OpenCV：${error.trim() || "请安装 opencv-python"}`);
    const directory = resolve(process.env.TOONFLOW_DATA_DIR || join(process.cwd(), "data"), "faceQa");
    await mkdir(directory, { recursive: true });
    const [detector, recognizer] = await Promise.all(modelSpecs.map(spec => modelPath(directory, spec)));
    return { python, detector, recognizer };
  })();
  try { return await prepared; }
  catch (error) { prepared = undefined; throw error; }
}

export async function inspectVideoFaces(video: string, references: { id: string; path: string }[], threshold: number): Promise<FaceQaResult> {
  const environment = await prepareFaceQa();
  let temporary: string | undefined;
  try {
    let input = video;
    if (/[^\x20-\x7e]/.test(video)) {
      temporary = await mkdtemp(join(tmpdir(), "toonflowFaceQa"));
      input = join(temporary, `video${extname(video) || ".mp4"}`);
      await copyFile(video, input);
    }
    const child = Bun.spawn([environment.python, "-c", pythonScript], { stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    child.stdin.write(JSON.stringify({ detector: environment.detector, recognizer: environment.recognizer, video: input, references, threshold }));
    child.stdin.end();
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(error.trim() || "人物一致性质检进程失败");
    return resultSchema.parse(JSON.parse(output));
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }).catch(error => console.warn("人脸质检临时文件清理失败", error)); }
}
