import { isHearthstoneOrTrackerFrontmost } from "./frontmostApp.js";
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
const healthOverlayWidth = 72;
const healthOverlayHeight = 42;
const horizontalRatio = 0.255;
const opponentVerticalRatio = 0.2239;
const friendlyVerticalRatio = 0.6762;
const smartCounterWidth = 60;
const smartCounterHeight = 62;
const smartCounterStartGap = 8;
const smartCounterRightInset = 8;
const smartCounterHorizontalStep = 64;
const smartCounterVerticalStep = 66;

export type HeroHealthOverlayKind = "friendly-health" | "opponent-health";
export type AuxiliaryOverlayKind =
  | "friendly-attack"
  | "opponent-attack"
  | HeroHealthOverlayKind
  | "secret"
  | "smart-counter";

export function getBoardAttackIconBounds(display: DisplayBounds): { opponent: IconBounds; friendly: IconBounds } {
  const x = display.x + Math.round(display.width * horizontalRatio);
  return {
    opponent: { x, y: display.y + Math.round(display.height * opponentVerticalRatio), width: iconSize, height: iconSize },
    friendly: { x, y: display.y + Math.round(display.height * friendlyVerticalRatio), width: iconSize, height: iconSize }
  };
}

export function getHeroHealthOverlayBounds(
  display: DisplayBounds,
  kind: HeroHealthOverlayKind
): IconBounds {
  return {
    x: display.x + Math.round(display.width * (kind === "friendly-health" ? 0.19 : 0.625)),
    y: display.y + Math.round(display.height * (kind === "friendly-health" ? 0.64 : 0.278)),
    width: healthOverlayWidth,
    height: healthOverlayHeight
  };
}

export function getAuxiliaryOverlayBounds(display: DisplayBounds, kind: AuxiliaryOverlayKind): IconBounds {
  const attack = getBoardAttackIconBounds(display);
  if (kind === "friendly-attack") return attack.friendly;
  if (kind === "opponent-attack") return attack.opponent;
  if (kind === "friendly-health" || kind === "opponent-health") {
    return getHeroHealthOverlayBounds(display, kind);
  }
  if (kind === "secret") return getSecretOverlayBounds(display, []);
  const preferredX = attack.friendly.x + attack.friendly.width + smartCounterStartGap;
  const maximumX = display.x + Math.max(0, display.width - smartCounterRightInset - smartCounterWidth);
  return {
    x: Math.min(preferredX, maximumX),
    y: display.y + Math.round(display.height * 0.62),
    width: smartCounterWidth,
    height: smartCounterHeight
  };
}

export function getSecretOverlayBounds(
  display: DisplayBounds,
  possibleCandidateCounts: readonly number[]
): IconBounds {
  const y = display.y + Math.round(display.height * 0.075);
  const candidateRows = possibleCandidateCounts.reduce((total, count) => (
    total + Math.max(1, Math.max(0, count))
  ), 0);
  const slotLabelHeight = possibleCandidateCounts.length > 1
    ? possibleCandidateCounts.length * 14
    : 0;
  const desiredHeight = 2 + 18 + slotLabelHeight + candidateRows * 17;
  const maxHeight = Math.max(37, Math.min(640, display.y + display.height - y - 24));
  return {
    x: display.x + Math.round(display.width * 0.275) - 20,
    y,
    width: 144,
    height: Math.min(Math.max(37, desiredHeight), maxHeight)
  };
}

export function getSmartCounterOverlayBounds(
  display: DisplayBounds,
  index: number,
  workArea: DisplayBounds = display
): IconBounds {
  const base = getAuxiliaryOverlayBounds(display, "smart-counter");
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const friendly = getBoardAttackIconBounds(display).friendly;
  const preferredX = friendly.x + friendly.width + smartCounterStartGap;
  const availableHorizontalSpace = Math.max(0, workArea.width - smartCounterWidth);
  const horizontalInset = availableHorizontalSpace >= smartCounterRightInset * 2
    ? smartCounterRightInset
    : 0;
  const minimumX = workArea.x + horizontalInset;
  const maximumX = Math.max(
    minimumX,
    workArea.x + availableHorizontalSpace - horizontalInset
  );
  const startX = Math.min(Math.max(preferredX, minimumX), maximumX);
  const availableVerticalSpace = Math.max(0, workArea.height - smartCounterHeight);
  const verticalInset = availableVerticalSpace >= smartCounterRightInset * 2
    ? smartCounterRightInset
    : 0;
  const minimumY = workArea.y + verticalInset;
  const maximumY = Math.max(
    minimumY,
    workArea.y + availableVerticalSpace - verticalInset
  );
  const startY = Math.min(Math.max(base.y, minimumY), maximumY);
  const columns = Math.max(
    1,
    Math.floor((maximumX - startX) / smartCounterHorizontalStep) + 1
  );
  const column = safeIndex % columns;
  const row = Math.floor(safeIndex / columns);
  const upwardRows = Math.floor((startY - minimumY) / smartCounterVerticalStep) + 1;
  const y = row < upwardRows
    ? startY - row * smartCounterVerticalStep
    : startY + (row - upwardRows + 1) * smartCounterVerticalStep;
  return {
    ...base,
    x: startX + column * smartCounterHorizontalStep,
    y
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
  setAuxiliaryOverlayMouseInteractive(window, false);
}

export function setAuxiliaryOverlayMouseInteractive(
  window: Pick<BoardAttackOverlayWindowLike, "setIgnoreMouseEvents">,
  interactive: boolean
): void {
  window.setIgnoreMouseEvents(!interactive, { forward: true });
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

export function shouldShowBoardAttackOverlay(
  gameActive: boolean,
  frontmostAppName: string | undefined,
  auxiliaryInteractionActive = false
): boolean {
  return gameActive && (
    auxiliaryInteractionActive ||
    isHearthstoneOrTrackerFrontmost(frontmostAppName)
  );
}
