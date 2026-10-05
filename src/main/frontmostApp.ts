import { execFile } from "node:child_process";
import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { HearthstoneCaptureContext } from "./hearthstoneScreenCapture.js";

const execFileAsync = promisify(execFile);
let cachedHelperPath: string | undefined;
let cachedName: string | undefined;
let cacheExpiresAt = 0;
let pendingRead: { readonly helperPath: string; readonly promise: Promise<string | undefined> } | undefined;

export async function getFrontmostAppName(helperPath = resolveFrontmostAppHelperPath()): Promise<string | undefined> {
  if (process.platform !== "darwin") {
    return undefined;
  }

  if (pendingRead?.helperPath === helperPath) return pendingRead.promise;
  if (cachedHelperPath === helperPath && Date.now() < cacheExpiresAt) return cachedName;
  const promise = readFrontmostName(helperPath).then((name) => {
    cachedHelperPath = helperPath;
    cachedName = name;
    cacheExpiresAt = Date.now() + 200;
    return name;
  }).finally(() => { if (pendingRead?.promise === promise) pendingRead = undefined; });
  pendingRead = { helperPath, promise };
  return promise;
}

async function readFrontmostName(helperPath: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync(helperPath, [], { timeout: 800 });
    return result.stdout.trim() || undefined;
  } catch { return undefined; }
}

/** Capture checks bypass the monitor cache and include the native window owner. */
export async function getHearthstoneCaptureContext(helperPath = resolveFrontmostAppHelperPath()): Promise<HearthstoneCaptureContext | undefined> {
  if (process.platform !== "darwin") return undefined;
  try {
    const result = await execFileAsync(helperPath, ["--capture-context"], { timeout: 800 });
    const value = JSON.parse(result.stdout) as Partial<HearthstoneCaptureContext>;
    const bounds = value.bounds;
    if (value.applicationName !== "Hearthstone" || !Number.isInteger(value.ownerPid) || (value.ownerPid ?? 0) <= 0 ||
        !Number.isInteger(value.windowId) || (value.windowId ?? 0) <= 0 || !bounds ||
        ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width < 200 || bounds.height < 200) return undefined;
    return value as HearthstoneCaptureContext;
  } catch { return undefined; }
}

export async function getHearthstoneWindowImage(
  context: HearthstoneCaptureContext,
  helperPath = resolveFrontmostAppHelperPath()
): Promise<Buffer | undefined> {
  if (process.platform !== "darwin") return undefined;
  try {
    const result = await execFileAsync(
      helperPath,
      ["--capture-window", String(context.windowId), String(context.ownerPid)],
      { timeout: 3_000, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" }
    );
    const image = Buffer.from(result.stdout);
    return image.length > 0 ? image : undefined;
  } catch {
    return undefined;
  }
}

export function resolveFrontmostAppHelperPath(
  resourcesPath = process.resourcesPath,
  moduleUrl = import.meta.url,
  isPackaged = Boolean(app?.isPackaged)
) {
  if (isPackaged && resourcesPath) {
    return path.resolve(resourcesPath, "../MacOS/frontmost-app");
  }
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../../native/bin/frontmost-app");
}

export function isHearthstoneFrontmost(appName: string | undefined): boolean {
  return appName?.trim().toLowerCase() === "hearthstone";
}

export function isHearthstoneOrTrackerFrontmost(appName: string | undefined): boolean {
  const normalized = appName?.trim().toLowerCase();
  return normalized === "hearthstone" || normalized === "炉石记牌器" || normalized === "hearthstone mac tracker";
}
