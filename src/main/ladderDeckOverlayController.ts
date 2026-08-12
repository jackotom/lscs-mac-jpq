import type { PublicTrackerState } from "../shared/types.js";
import type { LadderMode } from "../shared/ladderDeckRecommendation.js";
import { isHearthstoneOrTrackerFrontmost } from "./frontmostApp.js";

export interface LadderDeckOverlayHost {
  readonly getState: () => PublicTrackerState;
  readonly getFrontmostAppName: () => Promise<string | undefined>;
  readonly hasWindow: () => boolean;
  readonly isVisible: () => boolean;
  readonly isAnyOverlayFocused?: () => boolean;
  readonly isAnyOverlayInteractionActive?: () => boolean;
  readonly isFrontmostAppAllowed?: (appName: string | undefined) => boolean;
  readonly createWindow: () => Promise<void>;
  readonly updateMode: (mode: LadderMode) => Promise<void>;
  readonly showInactive: () => void;
  readonly hide: () => void;
}

export class LadderDeckOverlayController {
  private monitor: NodeJS.Timeout | undefined;
  private refreshPromise: Promise<void> | undefined;
  private displayedMode: LadderMode | undefined;
  private suppressedMode: LadderMode | undefined;
  private lifecycleGeneration = 0;

  constructor(private readonly host: LadderDeckOverlayHost) {}

  start(intervalMs = 350) {
    if (this.monitor) return;
    void this.refresh();
    this.monitor = setInterval(() => void this.refresh(), intervalMs);
    this.monitor.unref();
  }

  stop() {
    this.lifecycleGeneration += 1;
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = undefined;
    }
  }

  refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    const generation = this.lifecycleGeneration;
    this.refreshPromise = this.refreshOnce(generation).finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  suppressCurrentMode() {
    this.suppressedMode = resolveLadderDeckMode(this.host.getState());
  }

  private async refreshOnce(generation: number) {
    const mode = resolveLadderDeckMode(this.host.getState());
    const frontmostAppName = await this.host.getFrontmostAppName();
    if (generation !== this.lifecycleGeneration) return;
    if (!mode) {
      if (this.host.hasWindow()) this.host.hide();
      return;
    }

    if (this.suppressedMode && this.suppressedMode !== mode) this.suppressedMode = undefined;
    if (this.suppressedMode === mode) {
      if (this.host.hasWindow()) this.host.hide();
      return;
    }

    if (!this.canRemainVisible(frontmostAppName)) {
      if (this.host.hasWindow()) this.host.hide();
      return;
    }

    if (!this.host.hasWindow()) {
      try {
        await this.host.createWindow();
      } catch (error) {
        if (generation !== this.lifecycleGeneration) return;
        throw error;
      }
    }
    if (generation !== this.lifecycleGeneration) {
      return;
    }
    if (mode !== this.displayedMode) {
      await this.host.updateMode(mode);
      if (generation !== this.lifecycleGeneration) return;
      if (resolveLadderDeckMode(this.host.getState()) !== mode) return;
      this.displayedMode = mode;
    }
    const latestFrontmostAppName = await this.host.getFrontmostAppName();
    if (generation !== this.lifecycleGeneration) return;
    if (!this.canRemainVisible(latestFrontmostAppName) || resolveLadderDeckMode(this.host.getState()) !== mode) return;
    if (!this.host.isVisible()) this.host.showInactive();
  }

  private canRemainVisible(frontmostAppName: string | undefined) {
    return Boolean(
      (this.host.isFrontmostAppAllowed ?? isHearthstoneOrTrackerFrontmost)(frontmostAppName) ||
      this.host.isAnyOverlayFocused?.() ||
      this.host.isAnyOverlayInteractionActive?.()
    );
  }
}

export function resolveLadderDeckMode(state: PublicTrackerState): LadderMode | undefined {
  if (state.status !== "watching" || (state.arena?.status && state.arena.status !== "inactive")) {
    return undefined;
  }
  return state.constructedScreenMode;
}
