import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = readFileSync(path.resolve(import.meta.dirname, "../src/main/main.ts"), "utf8");

function functionSource(name: string): string {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\b`, "u").exec(main);
  if (!match) return "";
  const tail = main.slice(match.index + match[0].length);
  const next = /\n(?:async\s+)?function\s+[A-Za-z0-9_]+\b/u.exec(tail);
  return main.slice(match.index, next ? match.index + match[0].length + next.index : undefined);
}

describe("auxiliary overlay main integration", () => {
  it.each([
    ["createFriendlyAttackOverlayWindow", "friendly-attack"],
    ["createOpponentAttackOverlayWindow", "opponent-attack"],
    ["createSecretOverlayWindow", "secret"]
  ])("restores saved placement before refreshing %s", (functionName, kind) => {
    const source = functionSource(functionName);

    expect(source).toMatch(new RegExp(`resolveAuxiliaryOverlayBounds\\(\\s*"${kind}"`, "u"));
    expect(source).toContain("updateAuxiliaryOverlayBounds");
  });

  it("keeps the collapsed secret renderer alive with a stable shell selector", () => {
    const source = functionSource("createSecretOverlayWindow");

    expect(source).toContain('".secret-overlay-shell"');
    expect(source).not.toMatch(/"\.secret-overlay"\s*\)/u);
  });

  it("opens the QA secret window with bounds for every demo slot", () => {
    expect(main).toContain("possibleCandidateCounts: [1, 1]");
  });

  it("registers sender-scoped interaction and resizes the secret BrowserWindow around its current anchor", () => {
    expect(main).toContain("registerAuxiliaryOverlayIpc");
    const collapseSource = functionSource("setSecretOverlayCollapsed");
    expect(collapseSource).toContain("const currentBounds = window.getBounds()");
    expect(collapseSource).toContain("setSecretCollapsed(collapsed, {");
    expect(collapseSource).toContain("updateAuxiliaryOverlayBounds");
    expect(collapseSource).not.toContain('resolveAuxiliaryOverlayBounds("secret"');
    expect(functionSource("moveAuxiliaryOverlayDrag")).toContain("moveAuxiliaryOverlayBounds");
    expect(functionSource("endAuxiliaryOverlayDrag")).toContain("saveBounds");
  });
});
