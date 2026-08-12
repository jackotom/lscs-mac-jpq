import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type JsonCacheParser<T> = (value: unknown) => T | undefined;

export interface ValidatedJsonCacheRead<T> {
  readonly value?: T;
  readonly source?: "primary" | "backup";
  readonly mtimeMs?: number;
  readonly warning?: string;
}

interface ValidatedCacheFile<T> {
  readonly value: T;
  readonly raw: string;
  readonly mtimeMs: number;
}

export function getJsonCacheBackupPath(cachePath: string): string {
  return `${cachePath}.backup`;
}

export async function readValidatedJsonCache<T>(
  cachePath: string,
  parse: JsonCacheParser<T>,
  label: string
): Promise<ValidatedJsonCacheRead<T>> {
  let primaryError: unknown;
  try {
    const primary = await readValidatedCacheFile(cachePath, parse);
    return { value: primary.value, source: "primary", mtimeMs: primary.mtimeMs };
  } catch (error) {
    primaryError = error;
  }

  const primaryMissing = isNodeError(primaryError) && primaryError.code === "ENOENT";
  try {
    const backup = await readValidatedCacheFile(getJsonCacheBackupPath(cachePath), parse);
    return {
      value: backup.value,
      source: "backup",
      mtimeMs: backup.mtimeMs,
      warning: primaryMissing
        ? `${label}正式缓存缺失，已退回上次有效备份`
        : `${label}正式缓存损坏，已退回上次有效备份：${formatError(primaryError)}`
    };
  } catch (backupError) {
    const backupMissing = isNodeError(backupError) && backupError.code === "ENOENT";
    if (primaryMissing && backupMissing) {
      return {};
    }

    if (primaryMissing) {
      return { warning: `${label}正式缓存缺失，备份也不可用：${formatError(backupError)}` };
    }

    return {
      warning: backupMissing
        ? `${label}正式缓存损坏且没有可用备份：${formatError(primaryError)}`
        : `${label}正式缓存损坏，备份也不可用：${formatError(primaryError)}；${formatError(backupError)}`
    };
  }
}

export async function writeValidatedJsonCache<T>(
  cachePath: string,
  value: unknown,
  parse: JsonCacheParser<T>
): Promise<void> {
  const raw = JSON.stringify(value);
  if (raw === undefined) {
    throw new Error("JSON 缓存序列化失败");
  }
  validateRawJson(raw, parse);

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  let current: ValidatedCacheFile<T> | undefined;
  try {
    current = await readValidatedCacheFile(cachePath, parse);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT") && !isValidationError(error)) {
      throw error;
    }
    // Invalid primary caches never replace the last known-good backup.
  }
  if (current) {
    await stageAndReplace(getJsonCacheBackupPath(cachePath), current.raw, parse);
  }

  await stageAndReplace(cachePath, raw, parse);
}

async function readValidatedCacheFile<T>(cachePath: string, parse: JsonCacheParser<T>): Promise<ValidatedCacheFile<T>> {
  const raw = await fs.readFile(cachePath, "utf8");
  const value = validateRawJson(raw, parse);
  const stat = await fs.stat(cachePath);
  return { value, raw, mtimeMs: stat.mtimeMs };
}

async function stageAndReplace<T>(targetPath: string, raw: string, parse: JsonCacheParser<T>): Promise<void> {
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(raw, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;

    await readValidatedCacheFile(temporaryPath, parse);
    await fs.rename(temporaryPath, targetPath);
    await syncDirectory(path.dirname(targetPath));
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function validateRawJson<T>(raw: string, parse: JsonCacheParser<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new JsonCacheValidationError(`JSON 解析失败：${formatError(error)}`);
  }

  const parsed = parse(value);
  if (parsed === undefined) {
    throw new JsonCacheValidationError("JSON 缓存校验失败");
  }
  return parsed;
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directoryPath, "r");
    await handle.sync();
  } catch (error) {
    if (!isNodeError(error) || !["EINVAL", "ENOTSUP", "EISDIR"].includes(error.code ?? "")) {
      throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

class JsonCacheValidationError extends Error {}

function isValidationError(error: unknown): error is JsonCacheValidationError {
  return error instanceof JsonCacheValidationError;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
