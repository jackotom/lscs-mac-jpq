export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const collapsedWidth = 52;
const collapsedHeight = 38;

export class OpponentOverlayWindowState {
  private collapsed: boolean;

  constructor(private expandedBounds: WindowBounds, collapsed = false) {
    this.collapsed = collapsed;
  }

  static fromPersisted(value: unknown): OpponentOverlayWindowState {
    if (!isWindowBounds(value)) {
      throw new Error("对手悬浮窗位置无效");
    }
    const { x, y, width, height } = value;
    return new OpponentOverlayWindowState({ x, y, width, height }, value.collapsed === true);
  }

  toPersisted(): WindowBounds & { readonly collapsed: boolean } {
    return { ...this.expandedBounds, collapsed: this.collapsed };
  }

  expanded(): WindowBounds {
    return this.expandedBounds;
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  updateExpandedBounds(bounds: WindowBounds): void {
    if (!this.collapsed) {
      this.expandedBounds = bounds;
    }
  }

  collapse(): WindowBounds {
    this.collapsed = true;
    return this.currentBounds();
  }

  expand(): WindowBounds {
    this.collapsed = false;
    return this.currentBounds();
  }

  currentBounds(): WindowBounds {
    return this.collapsed
      ? { x: this.expandedBounds.x, y: this.expandedBounds.y, width: collapsedWidth, height: collapsedHeight }
      : this.expandedBounds;
  }
}

function isWindowBounds(value: unknown): value is WindowBounds & { readonly collapsed?: unknown } {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Record<string, unknown>;
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite);
}
