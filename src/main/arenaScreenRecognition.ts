import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { getFrontmostAppName, isHearthstoneFrontmost } from "./frontmostApp.js";

export interface ArenaScreenText {
  readonly text: string;
  readonly confidence: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ArenaScreenRecognitionResult {
  readonly status: "ok" | "permission-denied" | "window-not-found" | "capture-failed" | "failed";
  readonly message?: string;
  readonly texts: readonly ArenaScreenText[];
}

export interface ArenaScreenRecognitionOptions {
  readonly requireHearthstoneFrontmost?: boolean;
  readonly profile?: "arena" | "constructed";
}

export class ScreenCaptureError extends Error {
  constructor(
    readonly status: "permission-denied" | "capture-failed",
    message: string
  ) {
    super(message);
    this.name = "ScreenCaptureError";
  }
}

interface ArenaOcrPayload {
  readonly status?: unknown;
  readonly message?: unknown;
  readonly observations?: unknown;
}

const SCREEN_CAPTURE_DIRECTORY_PREFIX = "hearthstone-screen-";
const STALE_SCREEN_CAPTURE_AGE_MS = 10 * 60 * 1_000;

export async function cleanupStaleScreenCaptures(
  temporaryRoot = tmpdir(),
  olderThanMs = Date.now() - STALE_SCREEN_CAPTURE_AGE_MS
) {
  const entries = await readdir(temporaryRoot, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(SCREEN_CAPTURE_DIRECTORY_PREFIX))
    .map(async (entry) => {
      const directory = path.join(temporaryRoot, entry.name);
      const metadata = await stat(directory);
      if (metadata.mtimeMs <= olderThanMs) {
        await rm(directory, { recursive: true, force: true });
      }
    }));
}

export class ArenaScreenRecognizer {
  private staleCaptureCleanup: Promise<void> | undefined;
  private staleCaptureCleanupComplete = false;

  constructor(
    private readonly helperPath = resolveArenaOcrHelperPath(),
    private readonly captureScreenImage?: () => Promise<Buffer>,
    private readonly getFrontmostApplication = getFrontmostAppName,
    private readonly cleanupStaleCaptures = cleanupStaleScreenCaptures
  ) {}

  async recognize(options: ArenaScreenRecognitionOptions = {}): Promise<ArenaScreenRecognitionResult> {
    await this.ensureStaleCaptureCleanup();

    if (options.requireHearthstoneFrontmost !== false && !isHearthstoneFrontmost(await this.getFrontmostApplication())) {
      return {
        status: "window-not-found",
        message: "炉石不在前台，已暂停竞技场画面识别。",
        texts: []
      };
    }

    try {
      await access(this.helperPath);
    } catch {
      return {
        status: "failed",
        message: "竞技场识别组件不可用。请重新安装最新版炉石记牌器。",
        texts: []
      };
    }

    let captureDirectory: string | undefined;
    try {
      captureDirectory = await mkdtemp(path.join(tmpdir(), SCREEN_CAPTURE_DIRECTORY_PREFIX));
      const imagePath = path.join(captureDirectory, "screen.png");
      try {
        if (!this.captureScreenImage) {
          throw new ScreenCaptureError("capture-failed", "主进程截图功能不可用。");
        }
        await writeFile(imagePath, await this.captureScreenImage());
      } catch (error) {
        const status = error instanceof ScreenCaptureError ? error.status : "permission-denied";
        if (status === "permission-denied") {
          return screenCapturePermissionDeniedResult();
        }
        return {
          status: "capture-failed",
          message: error instanceof Error && error.message
            ? error.message
            : "暂时无法读取炉石画面，正在自动重试。",
          texts: []
        };
      }
      return parseArenaOcrPayload(await runHelper(this.helperPath, imagePath, options.profile));
    } catch (error) {
      return {
        status: "failed",
        message: `竞技场画面识别失败：${error instanceof Error ? error.message : String(error)}`,
        texts: []
      };
    } finally {
      if (captureDirectory) {
        await rm(captureDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private async ensureStaleCaptureCleanup(): Promise<void> {
    if (this.staleCaptureCleanupComplete) return;
    if (!this.staleCaptureCleanup) {
      const cleanup = this.cleanupStaleCaptures()
        .then(() => {
          this.staleCaptureCleanupComplete = true;
        })
        .catch(() => undefined)
        .finally(() => {
          if (this.staleCaptureCleanup === cleanup) {
            this.staleCaptureCleanup = undefined;
          }
        });
      this.staleCaptureCleanup = cleanup;
    }
    await this.staleCaptureCleanup;
  }
}

function screenCapturePermissionDeniedResult(): ArenaScreenRecognitionResult {
  return {
    status: "permission-denied",
    message: "需要允许炉石记牌器录制屏幕，才能自动识别当前模式和套牌。授权后会自动继续识别。",
    texts: []
  };
}

export function selectArenaChoiceTexts(texts: readonly ArenaScreenText[]) {
  const titleCandidates = texts.filter((text) =>
    text.x >= 0.12 &&
    text.x <= 0.66 &&
    text.y >= 0.58 &&
    text.y <= 0.635 &&
    Boolean(text.text.trim())
  );
  const lanes = [
    { minX: 0.12, maxX: 0.295, centerX: 0.215 },
    { minX: 0.295, maxX: 0.45, centerX: 0.375 },
    { minX: 0.45, maxX: 0.66, centerX: 0.535 }
  ] as const;

  return lanes.map((lane) => {
    const best = titleCandidates
      .filter((text) => text.x >= lane.minX && text.x < lane.maxX)
      .sort((left, right) =>
        arenaTitleCandidateDistance(left, lane.centerX) - arenaTitleCandidateDistance(right, lane.centerX)
      )[0];
    return best?.text.trim() ?? "";
  });
}

function arenaTitleCandidateDistance(text: ArenaScreenText, laneCenterX: number) {
  const textCenterX = text.x + text.width / 2;
  return Math.abs(text.y - 0.61) * 4 + Math.abs(textCenterX - laneCenterX);
}

export function parseArenaOcrPayload(raw: string): ArenaScreenRecognitionResult {
  let payload: ArenaOcrPayload;
  try {
    payload = JSON.parse(raw) as ArenaOcrPayload;
  } catch {
    return { status: "failed", message: "竞技场识别组件返回了无效数据。", texts: [] };
  }

  const status = parseStatus(payload.status);
  const texts = Array.isArray(payload.observations)
    ? payload.observations.flatMap(parseText)
    : [];
  return {
    status,
    message: typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : undefined,
    texts
  };
}

export function resolveArenaOcrHelperPath(
  resourcesPath = process.resourcesPath,
  moduleUrl = import.meta.url,
  isPackaged = Boolean(app?.isPackaged)
) {
  if (isPackaged && resourcesPath) {
    return path.resolve(resourcesPath, "../MacOS/arena-ocr");
  }
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../../native/bin/arena-ocr");
}

function parseText(value: unknown): ArenaScreenText[] {
  if (!isRecord(value) || typeof value.text !== "string" || !value.text.trim()) {
    return [];
  }
  const confidence = numberValue(value.confidence);
  const x = numberValue(value.x);
  const y = numberValue(value.y);
  const width = numberValue(value.width);
  const height = numberValue(value.height);
  if ([confidence, x, y, width, height].some((number) => number === undefined)) {
    return [];
  }
  return [{ text: value.text, confidence: confidence!, x: x!, y: y!, width: width!, height: height! }];
}

function parseStatus(value: unknown): ArenaScreenRecognitionResult["status"] {
  return value === "ok" || value === "permission-denied" || value === "window-not-found" || value === "capture-failed"
    ? value
    : "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function runHelper(helperPath: string, imagePath: string, profile: ArenaScreenRecognitionOptions["profile"]) {
  return runProcess(helperPath, ["--image", imagePath, ...(profile ? ["--profile", profile] : [])]);
}

function runProcess(executablePath: string, args: readonly string[], timeoutMs = 8000) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executablePath, [...args], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      reject(new Error(`识别组件运行超时（${timeoutMs}ms）。`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!timedOut) {
        reject(error);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return;
      }
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `识别组件已退出（${code ?? "未知状态"}）。`));
    });
  });
}
