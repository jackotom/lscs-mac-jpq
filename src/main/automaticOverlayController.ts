import type { PublicTrackerState } from "../shared/types.js";
import { isHearthstoneOrTrackerFrontmost } from "./frontmostApp.js";

export interface AutomaticOverlayHost {
  readonly getState: () => PublicTrackerState;
  readonly getFrontmostAppName: () => Promise<string | undefined>;
  readonly hasOverlayWindow: () => boolean;
  readonly isOverlayVisible: () => boolean;
  readonly isOverlayFocused: () => boolean;
  readonly isOverlayInteractionActive?: () => boolean;
  readonly isFrontmostAppAllowed?: (appName: string | undefined) => boolean;
  readonly createOverlayWindow: () => Promise<void>;
  readonly showOverlayWindow: () => void;
  readonly hideOverlayWindow: () => void | Promise<void>;
  readonly isEnabled?: (state: PublicTrackerState) => boolean;
  readonly shouldHideWhenDisabled?: () => boolean;
}

export class AutomaticOverlayController {
  private monitor: NodeJS.Timeout | undefined;
  private refreshPromise: Promise<void> | undefined;
  private contextKey: string | undefined;
  private suppressedContextKey: string | undefined;
  private lastPresentedKey: string | undefined;
  private lifecycleGeneration = 0;

  constructor(private readonly host: AutomaticOverlayHost) {}

  start(intervalMs = 350) {
    if (this.monitor) {
      return;
    }

    void this.refresh();
    this.monitor = setInterval(() => {
      void this.refresh();
    }, intervalMs);
    this.monitor.unref();
  }

  stop() {
    this.lifecycleGeneration += 1;
    this.lastPresentedKey = undefined;
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = undefined;
    }
  }

  refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const generation = this.lifecycleGeneration;
    this.refreshPromise = this.refreshOnce(generation).finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  suppressCurrentContext() {
    this.suppressedContextKey = resolveAutomaticOverlayContext(this.host.getState());
  }

  clearSuppression() {
    this.suppressedContextKey = undefined;
  }

  private async refreshOnce(generation: number) {
    const frontmostAppName = await this.host.getFrontmostAppName();
    if (generation !== this.lifecycleGeneration) return;
    const state = this.host.getState();
    const enabled = this.host.isEnabled?.(state) !== false;
    const nextContextKey = enabled ? resolveAutomaticOverlayContext(state) : undefined;
    if (nextContextKey !== this.contextKey) {
      this.contextKey = nextContextKey;
      if (!matchesSuppressedContext(this.suppressedContextKey, nextContextKey)) {
        this.suppressedContextKey = undefined;
      }
    }

    if (!enabled) {
      this.lastPresentedKey = undefined;
      if (this.host.shouldHideWhenDisabled?.() !== false && this.host.hasOverlayWindow()) {
        await this.host.hideOverlayWindow();
      }
      return;
    }

    const shouldShow = Boolean(
      nextContextKey &&
      !matchesSuppressedContext(this.suppressedContextKey, nextContextKey) &&
      (
        (this.host.isFrontmostAppAllowed ?? isHearthstoneOrTrackerFrontmost)(frontmostAppName) ||
        this.host.isOverlayFocused() ||
        this.host.isOverlayInteractionActive?.()
      )
    );

    if (!shouldShow) {
      this.lastPresentedKey = undefined;
      if (this.host.hasOverlayWindow()) {
        await this.host.hideOverlayWindow();
      }
      return;
    }

    if (!this.host.hasOverlayWindow()) {
      this.lastPresentedKey = undefined;
      try {
        await this.host.createOverlayWindow();
      } catch (error) {
        if (generation !== this.lifecycleGeneration) return;
        throw error;
      }
    }
    if (generation !== this.lifecycleGeneration) {
      return;
    }
    const latestState = this.host.getState();
    const latestContextKey = this.host.isEnabled?.(latestState) === false
      ? undefined
      : resolveAutomaticOverlayContext(latestState);
    if (
      latestContextKey !== nextContextKey ||
      matchesSuppressedContext(this.suppressedContextKey, latestContextKey)
    ) {
      if (this.host.hasOverlayWindow()) {
        await this.host.hideOverlayWindow();
      }
      return;
    }
    const latestPresentedKey = `${latestContextKey}:game-${latestState.gameActive === true ? "active" : "inactive"}`;
    if (!this.host.isOverlayVisible() || this.lastPresentedKey !== latestPresentedKey) {
      this.host.showOverlayWindow();
      this.lastPresentedKey = latestPresentedKey;
    }
  }
}

export function resolveAutomaticOverlayContext(state: PublicTrackerState): string | undefined {
  if (state.status !== "watching") {
    return undefined;
  }

  if (!state.trackerMode) {
    return "watching:waiting-for-mode";
  }

  if (state.trackerMode === "arena" && state.arena?.status && state.arena.status !== "inactive") {
    return "arena";
  }

  if (state.trackerMode !== "ladder") return undefined;

  if (state.autoMatchedDeckId) {
    return `constructed-deck:${state.constructedScreenMode ?? "unknown"}:${state.autoMatchedDeckId}`;
  }

  if (state.constructedScreenMode) {
    return `constructed-waiting:${state.constructedScreenMode}`;
  }

  return state.gameActive ? "constructed-game:waiting" : "constructed:waiting-for-screen";
}

function matchesSuppressedContext(suppressedKey: string | undefined, nextKey: string | undefined) {
  if (!suppressedKey || !nextKey) {
    return false;
  }
  if (suppressedKey === nextKey) {
    return true;
  }

  const suppressedDeck = parseConstructedDeckContext(suppressedKey);
  const nextDeck = parseConstructedDeckContext(nextKey);
  return Boolean(
    suppressedDeck &&
    nextDeck &&
    suppressedDeck.deckId === nextDeck.deckId &&
    (suppressedDeck.mode === "unknown" || nextDeck.mode === "unknown")
  );
}

function parseConstructedDeckContext(key: string) {
  const match = key.match(/^constructed-deck:(standard|wild|casual|unknown):(.+)$/);
  return match?.[1] && match[2]
    ? { mode: match[1] as "standard" | "wild" | "casual" | "unknown", deckId: match[2] }
    : undefined;
}
