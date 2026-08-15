import type {
  AuxiliaryOverlayPoint,
  MovableAuxiliaryOverlayKind
} from "./auxiliaryOverlayWindowState.js";

interface IpcEventLike {
  readonly sender: unknown;
}

type IpcHandler = (event: IpcEventLike, ...args: unknown[]) => unknown;

export interface AuxiliaryOverlayIpcMain {
  handle(channel: string, handler: IpcHandler): void;
}

export interface AuxiliaryOverlayIpcHost {
  resolveKind(sender: unknown): MovableAuxiliaryOverlayKind | undefined;
  getSecretCollapsed(): boolean | Promise<boolean>;
  setSecretCollapsed(collapsed: boolean): boolean | Promise<boolean>;
  setMouseInteractive(kind: MovableAuxiliaryOverlayKind, interactive: boolean): void | Promise<void>;
  beginDrag(kind: MovableAuxiliaryOverlayKind, point: AuxiliaryOverlayPoint): void | Promise<void>;
  moveDrag(kind: MovableAuxiliaryOverlayKind, point: AuxiliaryOverlayPoint): void | Promise<void>;
  endDrag(kind: MovableAuxiliaryOverlayKind, point: AuxiliaryOverlayPoint): void | Promise<void>;
}

export function registerAuxiliaryOverlayIpc(
  ipcMain: AuxiliaryOverlayIpcMain,
  host: AuxiliaryOverlayIpcHost
): void {
  ipcMain.handle("tracker:get-secret-overlay-collapsed", async (event) => {
    assertSecretSender(event.sender, host);
    return host.getSecretCollapsed();
  });

  ipcMain.handle("tracker:set-secret-overlay-collapsed", async (event, collapsed) => {
    assertSecretSender(event.sender, host);
    if (typeof collapsed !== "boolean") throw new Error("奥秘悬浮窗折叠状态无效");
    return host.setSecretCollapsed(collapsed);
  });

  ipcMain.handle("tracker:set-auxiliary-overlay-mouse-interactive", async (event, interactive) => {
    const kind = requireKind(event.sender, host);
    if (typeof interactive !== "boolean") throw new Error("辅助悬浮窗交互状态无效");
    await host.setMouseInteractive(kind, interactive);
  });

  registerDragHandler(ipcMain, host, "tracker:begin-auxiliary-overlay-drag", (kind, point) =>
    host.beginDrag(kind, point)
  );
  registerDragHandler(ipcMain, host, "tracker:move-auxiliary-overlay-drag", (kind, point) =>
    host.moveDrag(kind, point)
  );
  registerDragHandler(ipcMain, host, "tracker:end-auxiliary-overlay-drag", (kind, point) =>
    host.endDrag(kind, point)
  );
}

function registerDragHandler(
  ipcMain: AuxiliaryOverlayIpcMain,
  host: AuxiliaryOverlayIpcHost,
  channel: string,
  action: (kind: MovableAuxiliaryOverlayKind, point: AuxiliaryOverlayPoint) => void | Promise<void>
): void {
  ipcMain.handle(channel, async (event, value) => {
    const kind = requireKind(event.sender, host);
    const point = parsePoint(value);
    if (!point) throw new Error("拖动坐标无效");
    await action(kind, point);
  });
}

function requireKind(sender: unknown, host: AuxiliaryOverlayIpcHost): MovableAuxiliaryOverlayKind {
  const kind = host.resolveKind(sender);
  if (!kind) throw new Error("无权移动辅助悬浮窗");
  return kind;
}

function assertSecretSender(sender: unknown, host: AuxiliaryOverlayIpcHost): void {
  if (host.resolveKind(sender) !== "secret") throw new Error("无权修改奥秘悬浮窗");
}

function parsePoint(value: unknown): AuxiliaryOverlayPoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const point = value as Record<string, unknown>;
  if (typeof point.x !== "number" || !Number.isFinite(point.x)) return undefined;
  if (typeof point.y !== "number" || !Number.isFinite(point.y)) return undefined;
  return { x: point.x, y: point.y };
}
