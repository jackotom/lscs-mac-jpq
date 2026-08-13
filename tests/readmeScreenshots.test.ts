import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("README screenshot generation", () => {
  it("builds current source before running the isolated generator", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["screenshots:readme"]).toBe(
      "npm run build:native && npm run build && node scripts/generate-readme-screenshots.mjs"
    );
  });

  it("reuses the clean QA environment and owns one detached process group", () => {
    const source = read("scripts/generate-readme-screenshots.mjs");
    expect(source).toContain("createChildEnvironment");
    expect(source).toContain("createNodeEnvironmentUnsetArguments");
    expect(source).toContain("detached: true");
    expect(source).toContain("process.kill(-processGroupId, signal)");
    expect(source).toContain('signalProcessGroup(processGroupId, "SIGTERM")');
    expect(source).toContain('signalProcessGroup(processGroupId, "SIGKILL")');
    expect(source).not.toMatch(/\bpkill\b|\bkillall\b/);
  });

  it("stages every image in a temporary directory before replacing the public set", () => {
    const source = read("scripts/generate-readme-screenshots.mjs");
    expect(source).toContain("mkdtemp(join(tmpdir()");
    expect(source).toContain("publishScreenshotSet");
    expect(source).toContain("rename(stagingDirectory, screenshotDirectory)");
    expect(source).toContain("inheritedNodeEnvironmentKeys");
    expect(source).toContain("assertPngHasNoTextMetadata");
  });

  it("uses a dedicated friendly demo flag without changing release replay behavior", () => {
    const main = read("src/main/main.ts");
    expect(main).toContain('process.env.QA_FRIENDLY_OVERLAY_DEMO === "1"');
    expect(main).toContain("createOverlayWindow({ qaDemo: friendlyOverlayQaDemo })");
  });

  it("keeps the complete public screenshot set linked from the README", () => {
    const readme = read("README.md");
    const screenshots = [
      "friendly-overlay.png",
      "home-dashboard.png",
      "live-workbench.png",
      "opponent-overlay.png"
    ];

    for (const screenshot of screenshots) {
      expect(readme).toContain(`docs/screenshots/${screenshot}`);
      expect(existsSync(`docs/screenshots/${screenshot}`)).toBe(true);
    }
    expect(readdirSync("docs/screenshots").sort()).toEqual([...screenshots, "SHA256SUMS"].sort());
  });
});
