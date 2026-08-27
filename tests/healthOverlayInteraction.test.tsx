import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthOverlay } from "../src/renderer/components/HealthOverlay";

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "hearthstoneTracker", {
    configurable: true,
    value: undefined
  });
});

function dispatchPointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: MouseEventInit & { readonly pointerId: number }
) {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  fireEvent(target, event);
}

function installDragApi() {
  const api = {
    setAuxiliaryOverlayMouseInteractive: vi.fn(async () => undefined),
    beginAuxiliaryOverlayDrag: vi.fn(async () => undefined),
    moveAuxiliaryOverlayDrag: vi.fn(async () => undefined),
    endAuxiliaryOverlayDrag: vi.fn(async () => undefined)
  };
  Object.defineProperty(window, "hearthstoneTracker", {
    configurable: true,
    value: api
  });
  return api;
}

describe("HealthOverlay interaction", () => {
  it("renders zero health as a real value", () => {
    render(<HealthOverlay side="opponent" value={0} />);

    expect(screen.getByLabelText("对手总血量上限 0")).toBeInTheDocument();
  });

  it("reads only the total-health-limit state field", () => {
    const appSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/App.tsx"),
      "utf8"
    );

    expect(appSource).toContain("healthState.heroHealthLimit?.[side]");
    expect(appSource).not.toContain("healthState.heroHealth?.[side]");
    expect(appSource).toContain("return value === undefined ? null : <HealthOverlay side={side} value={value} />;");
  });

  it("keeps the transparent shell click-through and makes only the health pill interactive", () => {
    const css = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/boardAttackOverlayStyles.css"),
      "utf8"
    );

    expect(css).toMatch(/\.health-overlay\s*\{[^}]*pointer-events:\s*none/su);
    expect(css).toMatch(/\.health-counter\s*\{[^}]*pointer-events:\s*auto/su);
  });

  it("supports the saved light overlay appearance and keeps compact corners", () => {
    const css = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/boardAttackOverlayStyles.css"),
      "utf8"
    );

    expect(css).toMatch(/\.health-counter\s*\{[^}]*border-radius:\s*8px/su);
    expect(css).toMatch(/html\[data-tracker-theme="light"\][^{]*\.health-counter\s*\{/u);
  });

  it("marks both health routes as transparent health documents", () => {
    const bootstrap = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/main.tsx"),
      "utf8"
    );

    expect(bootstrap).toContain('overlaySearchParams.get("friendly-health-overlay") === "1"');
    expect(bootstrap).toContain('overlaySearchParams.get("opponent-health-overlay") === "1"');
    expect(bootstrap).toContain('document.documentElement.classList.add("health-overlay-document")');
  });

  it("uses the auxiliary drag contract and restores click-through on release", () => {
    const api = installDragApi();
    render(<HealthOverlay side="friendly" value={37} />);
    const counter = screen.getByLabelText("我方总血量上限 37");

    fireEvent.mouseMove(counter);
    dispatchPointer(counter, "pointerdown", { pointerId: 9, button: 0, screenX: 100, screenY: 200 });
    dispatchPointer(counter, "pointermove", { pointerId: 9, buttons: 1, screenX: 120, screenY: 220 });
    dispatchPointer(counter, "pointerup", { pointerId: 9, button: 0, screenX: 120, screenY: 220 });

    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(1, true);
    expect(api.beginAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 100, y: 200 });
    expect(api.moveAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 120, y: 220 });
    expect(api.endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 120, y: 220 });
    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
  });
});
