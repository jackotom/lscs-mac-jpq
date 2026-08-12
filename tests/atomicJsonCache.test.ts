import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("atomicJsonCache", () => {
  it("atomically replaces the primary cache and preserves the previous valid value", async () => {
    const { getJsonCacheBackupPath, writeValidatedJsonCache } = await import("../src/main/atomicJsonCache.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "atomic-json-cache-write-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "cache.json");
    const parse = (value: unknown) => isVersionedValue(value) ? value : undefined;

    await writeValidatedJsonCache(cachePath, { version: 1 }, parse);
    await writeValidatedJsonCache(cachePath, { version: 2 }, parse);

    expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual({ version: 2 });
    expect(JSON.parse(await readFile(getJsonCacheBackupPath(cachePath), "utf8"))).toEqual({ version: 1 });
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects an invalid staged value without replacing either valid cache", async () => {
    const { getJsonCacheBackupPath, writeValidatedJsonCache } = await import("../src/main/atomicJsonCache.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "atomic-json-cache-invalid-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "cache.json");
    const parse = (value: unknown) => isVersionedValue(value) ? value : undefined;

    await writeValidatedJsonCache(cachePath, { version: 1 }, parse);
    await writeValidatedJsonCache(cachePath, { version: 2 }, parse);
    await expect(writeValidatedJsonCache(cachePath, { broken: true }, parse)).rejects.toThrow("校验失败");

    expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual({ version: 2 });
    expect(JSON.parse(await readFile(getJsonCacheBackupPath(cachePath), "utf8"))).toEqual({ version: 1 });
  });

  it("ignores a half-written temporary file and falls back from a corrupt primary cache", async () => {
    const { getJsonCacheBackupPath, readValidatedJsonCache } = await import("../src/main/atomicJsonCache.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "atomic-json-cache-recovery-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "cache.json");
    await writeFile(cachePath, '{"version":', "utf8");
    await writeFile(`${cachePath}.interrupted.tmp`, '{"version":2', "utf8");
    await writeFile(getJsonCacheBackupPath(cachePath), JSON.stringify({ version: 1 }), "utf8");

    const result = await readValidatedJsonCache(
      cachePath,
      (value) => isVersionedValue(value) ? value : undefined,
      "测试"
    );

    expect(result.value).toEqual({ version: 1 });
    expect(result.source).toBe("backup");
    expect(result.warning).toContain("正式缓存损坏");
    expect(result.warning).toContain("上次有效备份");
  });
});

function isVersionedValue(value: unknown): value is { version: number } {
  return typeof value === "object"
    && value !== null
    && typeof (value as Record<string, unknown>).version === "number";
}
