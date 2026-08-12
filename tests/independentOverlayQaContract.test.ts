import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("independent overlay QA contract", () => {
  it("builds fresh renderer and Electron output before opening QA windows", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:independent-overlays-ui"])
      .toBe("npm run build && node scripts/verify-independent-overlays-ui.mjs");
  });

  it("uses dense secret data to verify every candidate is visible without mouse input", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../scripts/verify-independent-overlays-ui.mjs"),
      "utf8"
    );

    expect(source).toContain('"qa-secret-dense": "1"');
    expect(source).not.toContain('type: "mouseWheel"');
    expect(source).toContain("secretHeaderStayedFixed");
    expect(source).toContain("secretSlotLabelStayedVisible");
    expect(source).toContain("secretAllCandidatesVisible");
    expect(source).toContain("secretLastCandidateVisible");
  });
});
