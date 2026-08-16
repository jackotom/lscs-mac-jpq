import path from "node:path";
import { readValidatedJsonCache, writeValidatedJsonCache } from "./atomicJsonCache.js";

export type SmartCounterAuxiliaryOverlayKind = `smart-counter:${string}`;
export type MovableAuxiliaryOverlayKind =
  | "friendly-attack"
  | "opponent-attack"
  | "secret"
  | SmartCounterAuxiliaryOverlayKind;

const smartCounterOverlayKindPrefix = "smart-counter:";
const smartCounterIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export interface AuxiliaryOverlayPoint {
  readonly x: number;
  readonly y: number;
}

export interface AuxiliaryOverlayBounds extends AuxiliaryOverlayPoint {
  readonly width: number;
  readonly height: number;
}

export interface AuxiliaryOverlayWorkArea extends AuxiliaryOverlayBounds {}

export interface SecretOverlayPlacementTransition {
  readonly currentBounds: AuxiliaryOverlayBounds;
  readonly expandedBounds: AuxiliaryOverlayBounds;
  readonly workArea: AuxiliaryOverlayWorkArea;
}

interface RelativeAuxiliaryOverlayPosition {
  readonly xRatio: number;
  readonly yRatio: number;
}

export interface AuxiliaryOverlayWindowState {
  readonly positions: Partial<Record<MovableAuxiliaryOverlayKind, RelativeAuxiliaryOverlayPosition>>;
  readonly secretCollapsed: boolean;
}

const defaultState: AuxiliaryOverlayWindowState = {
  positions: {},
  secretCollapsed: false
};

const workAreaEdgeInset = 8;

export class AuxiliaryOverlayWindowStateStore {
  private readonly filePath: string;
  private statePromise: Promise<AuxiliaryOverlayWindowState> | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, "auxiliary-overlay-window-state.json");
  }

  async read(): Promise<AuxiliaryOverlayWindowState> {
    return cloneState(await this.load());
  }

  async saveBounds(
    kind: MovableAuxiliaryOverlayKind,
    bounds: AuxiliaryOverlayBounds,
    workArea: AuxiliaryOverlayWorkArea
  ): Promise<void> {
    const position = getRelativePosition(bounds, workArea);
    await this.update((current) => ({
      ...current,
      positions: { ...current.positions, [kind]: position }
    }));
  }

  async resolveBounds(
    kind: MovableAuxiliaryOverlayKind,
    defaultBounds: AuxiliaryOverlayBounds,
    workArea: AuxiliaryOverlayWorkArea
  ): Promise<AuxiliaryOverlayBounds> {
    const position = (await this.load()).positions[kind];
    return position
      ? getBoundsFromRelativePosition(defaultBounds, workArea, position)
      : clampBoundsToWorkArea(defaultBounds, workArea);
  }

  async getSecretCollapsed(): Promise<boolean> {
    return (await this.load()).secretCollapsed;
  }

  async setSecretCollapsed(collapsed: boolean): Promise<void>;
  async setSecretCollapsed(
    collapsed: boolean,
    placement: SecretOverlayPlacementTransition
  ): Promise<AuxiliaryOverlayBounds>;
  async setSecretCollapsed(
    collapsed: boolean,
    placement?: SecretOverlayPlacementTransition
  ): Promise<AuxiliaryOverlayBounds | void> {
    let visibleBounds: AuxiliaryOverlayBounds | undefined;
    await this.update((current) => {
      if (!placement) return { ...current, secretCollapsed: collapsed };
      visibleBounds = getAnchoredSecretOverlayBounds(
        placement.currentBounds,
        placement.expandedBounds,
        collapsed,
        placement.workArea
      );
      return {
        ...current,
        positions: {
          ...current.positions,
          secret: getRelativePosition(visibleBounds, placement.workArea)
        },
        secretCollapsed: collapsed
      };
    });
    return visibleBounds;
  }

  private async update(
    change: (current: AuxiliaryOverlayWindowState) => AuxiliaryOverlayWindowState
  ): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const current = await this.load();
      const next = change(current);
      await writeValidatedJsonCache(this.filePath, next, parseAuxiliaryOverlayWindowState);
      this.statePromise = Promise.resolve(next);
    });
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
  }

  private load(): Promise<AuxiliaryOverlayWindowState> {
    if (!this.statePromise) {
      this.statePromise = readValidatedJsonCache(
        this.filePath,
        parseAuxiliaryOverlayWindowState,
        "辅助悬浮窗位置"
      ).then((result) => result.value ?? defaultState);
    }
    return this.statePromise;
  }
}

export function parseAuxiliaryOverlayWindowState(value: unknown): AuxiliaryOverlayWindowState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.secretCollapsed !== "boolean") return undefined;
  if (!record.positions || typeof record.positions !== "object") return undefined;
  const savedPositions = record.positions as Record<string, unknown>;
  const positions: Partial<Record<MovableAuxiliaryOverlayKind, RelativeAuxiliaryOverlayPosition>> = {};
  for (const kind of Object.keys(savedPositions)) {
    if (!isMovableAuxiliaryOverlayKind(kind)) continue;
    const position = savedPositions[kind];
    if (position !== undefined && !isRelativePosition(position)) return undefined;
    if (isRelativePosition(position)) positions[kind] = { ...position };
  }
  return { positions, secretCollapsed: record.secretCollapsed };
}

export function getSmartCounterOverlayKind(counterId: string): SmartCounterAuxiliaryOverlayKind {
  if (!smartCounterIdPattern.test(counterId)) throw new Error("智能计数器标识无效");
  return `${smartCounterOverlayKindPrefix}${counterId}`;
}

export function getSmartCounterIdFromOverlayKind(kind: string): string | undefined {
  if (!kind.startsWith(smartCounterOverlayKindPrefix)) return undefined;
  const counterId = kind.slice(smartCounterOverlayKindPrefix.length);
  return smartCounterIdPattern.test(counterId) ? counterId : undefined;
}

export function getSecretOverlayVisibleBounds(
  expandedBounds: AuxiliaryOverlayBounds,
  collapsed: boolean
): AuxiliaryOverlayBounds {
  return collapsed
    ? { ...expandedBounds, width: 44, height: 44 }
    : expandedBounds;
}

export function getAnchoredSecretOverlayBounds(
  currentBounds: AuxiliaryOverlayBounds,
  expandedBounds: AuxiliaryOverlayBounds,
  collapsed: boolean,
  workArea: AuxiliaryOverlayWorkArea
): AuxiliaryOverlayBounds {
  return clampBoundsToWorkArea({
    ...getSecretOverlayVisibleBounds(expandedBounds, collapsed),
    x: currentBounds.x,
    y: currentBounds.y
  }, workArea);
}

export function moveAuxiliaryOverlayBounds(
  initialBounds: AuxiliaryOverlayBounds,
  initialPointer: AuxiliaryOverlayPoint,
  pointer: AuxiliaryOverlayPoint,
  workArea: AuxiliaryOverlayWorkArea
): AuxiliaryOverlayBounds {
  return clampBoundsToWorkArea({
    ...initialBounds,
    x: initialBounds.x + Math.round(pointer.x - initialPointer.x),
    y: initialBounds.y + Math.round(pointer.y - initialPointer.y)
  }, workArea);
}

export function clampBoundsToWorkArea(
  bounds: AuxiliaryOverlayBounds,
  workArea: AuxiliaryOverlayWorkArea
): AuxiliaryOverlayBounds {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const horizontalRange = getPlacementRange(workArea.x, workArea.width, width);
  const verticalRange = getPlacementRange(workArea.y, workArea.height, height);
  return {
    x: clamp(bounds.x, horizontalRange.minimum, horizontalRange.maximum),
    y: clamp(bounds.y, verticalRange.minimum, verticalRange.maximum),
    width,
    height
  };
}

function getRelativePosition(
  bounds: AuxiliaryOverlayBounds,
  workArea: AuxiliaryOverlayWorkArea
): RelativeAuxiliaryOverlayPosition {
  const clamped = clampBoundsToWorkArea(bounds, workArea);
  const horizontalRange = getPlacementRange(workArea.x, workArea.width, clamped.width);
  const verticalRange = getPlacementRange(workArea.y, workArea.height, clamped.height);
  const availableWidth = horizontalRange.maximum - horizontalRange.minimum;
  const availableHeight = verticalRange.maximum - verticalRange.minimum;
  return {
    xRatio: availableWidth === 0 ? 0 : (clamped.x - horizontalRange.minimum) / availableWidth,
    yRatio: availableHeight === 0 ? 0 : (clamped.y - verticalRange.minimum) / availableHeight
  };
}

function getBoundsFromRelativePosition(
  bounds: AuxiliaryOverlayBounds,
  workArea: AuxiliaryOverlayWorkArea,
  position: RelativeAuxiliaryOverlayPosition
): AuxiliaryOverlayBounds {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const horizontalRange = getPlacementRange(workArea.x, workArea.width, width);
  const verticalRange = getPlacementRange(workArea.y, workArea.height, height);
  return {
    x: horizontalRange.minimum + Math.round(
      (horizontalRange.maximum - horizontalRange.minimum) * position.xRatio
    ),
    y: verticalRange.minimum + Math.round(
      (verticalRange.maximum - verticalRange.minimum) * position.yRatio
    ),
    width,
    height
  };
}

function getPlacementRange(
  workAreaStart: number,
  workAreaSize: number,
  overlaySize: number
): { readonly minimum: number; readonly maximum: number } {
  const availableSpace = Math.max(0, workAreaSize - overlaySize);
  const inset = availableSpace >= workAreaEdgeInset * 2 ? workAreaEdgeInset : 0;
  return {
    minimum: workAreaStart + inset,
    maximum: workAreaStart + availableSpace - inset
  };
}

function isRelativePosition(value: unknown): value is RelativeAuxiliaryOverlayPosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Record<string, unknown>;
  return typeof position.xRatio === "number"
    && Number.isFinite(position.xRatio)
    && position.xRatio >= 0
    && position.xRatio <= 1
    && typeof position.yRatio === "number"
    && Number.isFinite(position.yRatio)
    && position.yRatio >= 0
    && position.yRatio <= 1;
}

function isMovableAuxiliaryOverlayKind(value: string): value is MovableAuxiliaryOverlayKind {
  return value === "friendly-attack"
    || value === "opponent-attack"
    || value === "secret"
    || getSmartCounterIdFromOverlayKind(value) !== undefined;
}

function cloneState(state: AuxiliaryOverlayWindowState): AuxiliaryOverlayWindowState {
  return {
    positions: Object.fromEntries(
      Object.entries(state.positions).map(([kind, point]) => [kind, point ? { ...point } : point])
    ),
    secretCollapsed: state.secretCollapsed
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
