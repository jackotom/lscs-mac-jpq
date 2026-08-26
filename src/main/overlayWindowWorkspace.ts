export interface OverlayWorkspaceWindowLike {
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options: { visibleOnFullScreen: boolean; skipTransformProcessType: boolean }
  ): void;
}

export interface OverlayPresentationWindowLike extends OverlayWorkspaceWindowLike {
  setAlwaysOnTop(alwaysOnTop: boolean, level: "screen-saver"): void;
  showInactive(): void;
}

const appliedVisibility = new WeakMap<object, boolean>();

export function configureOverlayWorkspaceWindow(
  window: OverlayWorkspaceWindowLike,
  visibleOnFullScreen: boolean
): boolean {
  return applyOverlayWorkspaceWindow(window, visibleOnFullScreen, false);
}

export function reassertOverlayWindowPresentation(
  window: OverlayPresentationWindowLike,
  visibleOnFullScreen: boolean
): void {
  applyOverlayWorkspaceWindow(window, visibleOnFullScreen, true);
  window.setAlwaysOnTop(true, "screen-saver");
  window.showInactive();
}

function applyOverlayWorkspaceWindow(
  window: OverlayWorkspaceWindowLike,
  visibleOnFullScreen: boolean,
  force: boolean
): boolean {
  if (!force && appliedVisibility.get(window as object) === visibleOnFullScreen) return false;
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen,
    skipTransformProcessType: true
  });
  appliedVisibility.set(window as object, visibleOnFullScreen);
  return true;
}

export function getOverlayWindowPlatformOptions(platform = process.platform) {
  return platform === "darwin" ? { type: "panel" as const } : {};
}
