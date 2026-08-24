import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { DEFAULT_TRACKER_SETTINGS } from "../src/main/trackerSettingsStore";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(window, "requestAnimationFrame");
const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(window, "cancelAnimationFrame");

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  Reflect.deleteProperty(target, key);
}

function installTrackerApi() {
  const trackerState = createPublicTrackerState({
    status: "watching",
    gameActive: false,
    deck: [],
    events: [],
    summary: {
      totalCards: 0,
      remainingCards: 0,
      drawnCards: 0,
      opponentPlayedCount: 0,
    },
  });

  window.hearthstoneTracker = {
    discoverLogs: vi.fn(async () => []),
    getState: vi.fn(async () => trackerState),
    onUpdate: vi.fn(() => () => undefined),
    getTrackerSettings: vi.fn(async () => structuredClone(DEFAULT_TRACKER_SETTINGS)),
  } as unknown as Window["hearthstoneTracker"];
}

afterEach(() => {
  delete window.hearthstoneTracker;
  restoreProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  restoreProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  restoreProperty(window, "requestAnimationFrame", originalRequestAnimationFrame);
  restoreProperty(window, "cancelAnimationFrame", originalCancelAnimationFrame);
});

describe("workbench navigation regressions", () => {
  it("switches settings navigation without calling page-level scrollIntoView", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    installTrackerApi();

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开二级工作台" }));

    const destinations = [
      { navigation: "权限管理", heading: "权限管理" },
      { navigation: "悬浮窗设置", heading: "悬浮窗设置" },
      { navigation: "插件与其他设置", heading: "其他设置" },
      { navigation: "数据、备份与隐私", heading: "数据与隐私" },
      { navigation: "关于我们", heading: "关于我们" },
    ];

    for (const destination of destinations) {
      const navigation = await screen.findByRole("button", { name: destination.navigation });
      fireEvent.click(navigation);

      await waitFor(() => {
        expect(navigation).toHaveAttribute("aria-current", "page");
        expect(screen.getByRole("heading", { name: destination.heading })).toBeInTheDocument();
      });
    }

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("workbench page backgrounds", () => {
  it("keeps every workbench route explicitly pure white", () => {
    const styles = readFileSync(join(process.cwd(), "src/renderer/homeNewsStyles.css"), "utf8");
    const rules = Array.from(styles.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
      selector: match[1],
      declarations: match[2],
    }));
    const pureWhiteBackground = /(?:^|;)\s*background(?:-color)?\s*:\s*(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))\s*(?:!important\s*)?(?:;|$)/i;
    const workbenchRoutes = [
      ".app-shell.view-tracker",
      ".app-shell.view-card-library",
      ".app-shell.view-deck-tools",
      ".app-shell.view-match-history",
      ".app-shell.view-settings",
    ];

    for (const route of workbenchRoutes) {
      const hasPureWhiteRule = rules.some(
        (rule) => {
          if (!pureWhiteBackground.test(rule.declarations)) {
            return false;
          }

          return rule.selector.split(",").some((selector) => {
            const normalizedSelector = selector.trim();
            const targetsRouteDirectly = normalizedSelector.includes(route);
            const targetsEveryWorkbenchRoute = normalizedSelector.includes(":not(:has(.app-shell.view-home))")
              && normalizedSelector.endsWith(".app-shell");

            return targetsRouteDirectly || targetsEveryWorkbenchRoute;
          });
        },
      );

      expect(hasPureWhiteRule, `${route} 缺少纯白背景规则`).toBe(true);
    }
  });
});
