import { execFile } from "node:child_process";
import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getFrontmostAppName(helperPath = resolveFrontmostAppHelperPath()): Promise<string | undefined> {
  if (process.platform !== "darwin") {
    return undefined;
  }

  try {
    const result = await execFileAsync(helperPath, [], { timeout: 800 });
    const name = result.stdout.trim();
    return name ? name : undefined;
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
