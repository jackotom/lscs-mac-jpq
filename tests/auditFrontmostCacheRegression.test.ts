import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.doUnmock("node:child_process"); vi.unstubAllGlobals(); vi.resetModules(); });

it("audit regression shares one frontmost helper invocation across concurrent and adjacent monitors", async () => {
  vi.resetModules();
  vi.stubGlobal("process", { ...process, platform: "darwin" });
  const execFile = vi.fn();
  Object.assign(execFile, { [promisify.custom]: async () => { execFile(); return { stdout: "Hearthstone\n", stderr: "" }; } });
  vi.doMock("node:child_process", () => ({ execFile, default: { execFile } }));
  vi.doMock("electron", () => ({ app: { isPackaged: false } }));
  const { getFrontmostAppName } = await import("../src/main/frontmostApp");
  expect(await Promise.all([getFrontmostAppName("/audit/helper"), getFrontmostAppName("/audit/helper"), getFrontmostAppName("/audit/helper")])).toEqual(["Hearthstone", "Hearthstone", "Hearthstone"]);
  expect(await getFrontmostAppName("/audit/helper")).toBe("Hearthstone");
  expect(execFile).toHaveBeenCalledTimes(1);
});
