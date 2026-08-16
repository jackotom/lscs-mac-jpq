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

  it("binds each smart counter sender to its own persisted drag target", () => {
    const createSource = functionSource("createSmartCounterOverlayWindow");
    const releaseSource = functionSource("releaseSmartCounterOverlayWindow");
    const resolveSource = functionSource("resolveMovableAuxiliaryOverlayKind");
    const windowSource = functionSource("getMovableAuxiliaryOverlayWindow");

    expect(createSource).toContain("getSmartCounterOverlayKind(counterId)");
    expect(createSource).toMatch(/resolveAuxiliaryOverlayBounds\(\s*kind/u);
    expect(createSource).toMatch(/createAuxiliaryOverlayWindow\(\s*kind/u);
    expect(releaseSource).toContain("auxiliaryOverlayDragSessions.delete(kind)");
    expect(resolveSource).toContain("return registered");
    expect(windowSource).toContain("getSmartCounterIdFromOverlayKind(kind)");
    expect(windowSource).toContain("smartCounterOverlayWindows.get(counterId)");
    expect(windowSource).toContain('if (kind === "secret") return secretOverlayWindow;');
  });

  it("resolves saved smart-counter placement before every refresh update", () => {
    const createSource = functionSource("createSmartCounterOverlayWindow");
    const resolveIndex = createSource.indexOf("resolveAuxiliaryOverlayBounds");
    const updateIndex = createSource.indexOf("updateAuxiliaryOverlayBounds");

    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThan(resolveIndex);
  });

  it("does not refresh an existing smart-counter window while that counter is being dragged", () => {
    const createSource = functionSource("createSmartCounterOverlayWindow");
    const existingBranch = createSource.slice(
      createSource.indexOf("if (existing && !existing.isDestroyed())"),
      createSource.indexOf("const generation")
    );

    expect(existingBranch).toContain("if (!auxiliaryOverlayDragSessions.has(kind))");
    expect(existingBranch).toContain("updateAuxiliaryOverlayBounds(existing, bounds)");
  });

  it("clears only the matching smart-counter drag session after an unexpected close", () => {
    const createSource = functionSource("createSmartCounterOverlayWindow");

    expect(createSource).toContain("auxiliaryOverlayDragSessions.get(kind)?.window === createdWindow");
    expect(createSource).toContain("auxiliaryOverlayDragSessions.delete(kind)");
  });

  it("passes the matched display work area into smart-counter default layout", () => {
    const refreshVisibilitySource = functionSource("refreshBoardAttackOverlayWindow");
    const refreshSmartSource = functionSource("refreshSmartCounterOverlayWindows");
    const createSource = functionSource("createSmartCounterOverlayWindow");

    expect(refreshVisibilitySource).toMatch(
      /refreshSmartCounterOverlayWindows\(\s*state\.smartCounters \?\? \[\],\s*display\.bounds,\s*display\.workArea\s*\)/u
    );
    expect(refreshSmartSource).toContain("workArea");
    expect(createSource).toContain("options.workArea ?? displayBounds");
  });
});
