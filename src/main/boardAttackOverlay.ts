import { isHearthstoneFrontmost } from "./frontmostApp.js";
import {
  configureOverlayWorkspaceWindow,
  getOverlayWindowPlatformOptions
} from "./overlayWindowWorkspace.js";

export interface DisplayBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface IconBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BoardAttackOverlayWindowOptions extends DisplayBounds {
  readonly type?: "panel";
  readonly show: false;
  readonly frame: false;
  readonly transparent: true;
  readonly alwaysOnTop: true;
  readonly skipTaskbar: true;
  readonly focusable: false;
  readonly resizable: false;
  readonly hasShadow: false;
  readonly backgroundColor: "#00000000";
  readonly webPreferences: {
    readonly preload: string;
    readonly contextIsolation: true;
    readonly nodeIntegration: false;
    readonly sandbox: true;
    readonly backgroundThrottling: true;
  };
}

export interface BoardAttackOverlayWindowLike {
  setVisibleOnAllWorkspaces(visible: boolean, options: {
    visibleOnFullScreen: boolean;
    skipTransformProcessType: boolean;
  }): void;
  setAlwaysOnTop(alwaysOnTop: boolean, level: "screen-saver"): void;
  setIgnoreMouseEvents(ignore: boolean, options: { forward: boolean }): void;
}

const iconSize = 44;
const horizontalRatio = 0.255;
const opponentVerticalRatio = 0.2239;
const friendlyVerticalRatio = 0.6762;

export type AuxiliaryOverlayKind = "friendly-attack" | "opponent-attack" | "secret" | "smart-counter";

export function getBoardAttackIconBounds(display: DisplayBounds): { opponent: IconBounds; friendly: IconBounds } {
  const x = display.x + Math.round(display.width * horizontalRatio);
  return {
    opponent: { x, y: display.y + Math.round(display.height * opponentVerticalRatio), width: iconSize, height: iconSize },
    friendly: { x, y: display.y + Math.round(display.height * friendlyVerticalRatio), width: iconSize, height: iconSize }
  };
}

export function getAuxiliaryOverlayBounds(display: DisplayBounds, kind: AuxiliaryOverlayKind): IconBounds {
  const attack = getBoardAttackIconBounds(display);
  if (kind === "friendly-attack") return attack.friendly;
  if (kind === "opponent-attack") return attack.opponent;
  if (kind === "secret") return getSecretOverlayBounds(display, []);
  return {
    x: display.x + Math.round(display.width * 0.245),
    y: display.y + Math.round(display.height * 0.62),
    width: 60,
    height: 62
  };
}

export function getSecretOverlayBounds(
  display: DisplayBounds,
  possibleCandidateCounts: readonly number[]
): IconBounds {
  const y = display.y + Math.round(display.height * 0.075);
  const candidateRows = possibleCandidateCounts.reduce(
    (total, count) => total + Math.max(1, Math.ceil(Math.max(0, count) / 2)),
    0
  );
  const desiredHeight = 27 + possibleCandidateCounts.length * 32 + candidateRows * 32;
  const maxHeight = Math.max(120, Math.min(640, display.y + display.height - y - 24));
  return {
    x: display.x + Math.round(display.width * 0.275),
    y,
    width: 240,
    height: Math.min(Math.max(190, desiredHeight), maxHeight)
  };
}

export function getSmartCounterOverlayBounds(display: DisplayBounds, index: number): IconBounds {
  const base = getAuxiliaryOverlayBounds(display, "smart-counter");
  return {
    ...base,
    x: base.x + Math.max(0, index) * 58
  };
}

export function getBoardAttackOverlayWindowOptions(
  bounds: DisplayBounds,
  preload: string
): BoardAttackOverlayWindowOptions {
  return {
    ...bounds,
    ...getOverlayWindowPlatformOptions(),
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true
    }
  };
}

export function configureBoardAttackOverlayWindow(window: BoardAttackOverlayWindowLike): void {
  configureOverlayWorkspaceWindow(window, true);
  window.setAlwaysOnTop(true, "screen-saver");
  window.setIgnoreMouseEvents(true, { forward: true });
}

export function getBoardAttackOverlayQuery(
  qaDemo: boolean,
  visibility: { showFriendly?: boolean; showOpponent?: boolean } = {}
): Record<string, string> {
  const effectiveVisibility = qaDemo
    ? { showFriendly: true, showOpponent: true }
    : visibility;
  return {
    "board-attack-overlay": "1",
    ...(effectiveVisibility.showFriendly === undefined
      ? {}
      : { "show-friendly-attack": effectiveVisibility.showFriendly ? "1" : "0" }),
    ...(effectiveVisibility.showOpponent === undefined
      ? {}
      : { "show-opponent-attack": effectiveVisibility.showOpponent ? "1" : "0" }),
    ...(qaDemo ? { "qa-opponent-demo": "1" } : {})
  };
}

export function shouldShowBoardAttackOverlay(gameActive: boolean, frontmostAppName: string | undefined): boolean {
  return gameActive && isHearthstoneFrontmost(frontmostAppName);
}
