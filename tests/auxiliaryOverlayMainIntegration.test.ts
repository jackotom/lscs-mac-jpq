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
    ["createFriendlyHealthOverlayWindow", "friendly-health"],
    ["createOpponentHealthOverlayWindow", "opponent-health"],
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

  it("keeps every overlay visible throughout an auxiliary drag and its focus handoff", () => {
    expect(functionSource("beginAuxiliaryOverlayDrag")).toContain("markAuxiliaryOverlayInteraction");
    expect(functionSource("moveAuxiliaryOverlayDrag")).toContain("markAuxiliaryOverlayInteraction");
    expect(functionSource("endAuxiliaryOverlayDrag")).toContain("markAuxiliaryOverlayInteraction");
    expect(functionSource("isAnyOverlayInteractionActive")).toContain("isAuxiliaryOverlayInteractionActive()");

    const refreshSource = functionSource("refreshBoardAttackOverlayWindow");
    expect(refreshSource).toContain("isAuxiliaryOverlayInteractionActive()");
    expect(refreshSource).toMatch(
      /shouldShowBoardAttackOverlay\([\s\S]*?auxiliaryInteractionActive[\s\S]*?\)/u
    );
    expect(refreshSource).toContain("createFriendlyHealthOverlayWindow");
    expect(refreshSource).toContain("createOpponentHealthOverlayWindow");
    expect(functionSource("isAnyOverlayInteractionActive")).toContain(
      "isAuxiliaryOverlayInteractionActive()"
    );
  });

  it("owns, refreshes, releases, and styles two independent health windows", () => {
    expect(main).toContain("let friendlyHealthOverlayWindow");
    expect(main).toContain("let opponentHealthOverlayWindow");
    expect(functionSource("createFriendlyHealthOverlayWindow")).toContain(
      '"friendly-health-overlay": "1"'
    );
    expect(functionSource("createOpponentHealthOverlayWindow")).toContain(
      '"opponent-health-overlay": "1"'
    );
    expect(functionSource("stopBoardAttackOverlayMonitor")).toContain(
      "releaseFriendlyHealthOverlayWindow"
    );
    expect(functionSource("stopBoardAttackOverlayMonitor")).toContain(
      "releaseOpponentHealthOverlayWindow"
    );
    expect(functionSource("overlayWindows")).toContain("friendlyHealthOverlayWindow");
    expect(functionSource("overlayWindows")).toContain("opponentHealthOverlayWindow");

    const settingsEffects = functionSource("applyTrackerSettingsEffects");
    expect(settingsEffects).toContain("previous.overlay.healthChange");
    expect(settingsEffects).toContain("trackerSettings.overlay.healthChange");
    expect(settingsEffects).toContain("releaseFriendlyHealthOverlayWindow");
    expect(settingsEffects).toContain("releaseOpponentHealthOverlayWindow");
  });

  it("creates each health window only when that side has a total health limit, including zero", () => {
    const refreshSource = functionSource("refreshBoardAttackOverlayWindow");

    expect(refreshSource).toContain("state.heroHealthLimit?.friendly !== undefined");
    expect(refreshSource).toContain("state.heroHealthLimit?.opponent !== undefined");
    expect(refreshSource).not.toContain("state.heroHealth?.");
  });

  it("binds health senders to drag targets and clears only their own sessions on close", () => {
    const resolveSource = functionSource("resolveMovableAuxiliaryOverlayKind");
    const windowSource = functionSource("getMovableAuxiliaryOverlayWindow");
    const friendlyCreate = functionSource("createFriendlyHealthOverlayWindow");
    const opponentCreate = functionSource("createOpponentHealthOverlayWindow");

    expect(resolveSource).toContain('return "friendly-health"');
    expect(resolveSource).toContain('return "opponent-health"');
    expect(windowSource).toContain("friendlyHealthOverlayWindow");
    expect(windowSource).toContain("opponentHealthOverlayWindow");
    expect(friendlyCreate).toContain(
      'auxiliaryOverlayDragSessions.get("friendly-health")?.window === createdWindow'
    );
    expect(opponentCreate).toContain(
      'auxiliaryOverlayDragSessions.get("opponent-health")?.window === createdWindow'
    );
  });

  it("provides isolated QA launch routes for both health windows", () => {
    expect(main).toContain('process.env.QA_OPEN_FRIENDLY_HEALTH_OVERLAY === "1"');
    expect(main).toContain('process.env.QA_OPEN_OPPONENT_HEALTH_OVERLAY === "1"');
    expect(main).toContain("createFriendlyHealthOverlayWindow(screen.getPrimaryDisplay().bounds");
    expect(main).toContain("createOpponentHealthOverlayWindow(screen.getPrimaryDisplay().bounds");
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
