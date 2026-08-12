export interface OverlayWorkspaceWindowLike {
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options: { visibleOnFullScreen: boolean; skipTransformProcessType: boolean }
  ): void;
}

const appliedVisibility = new WeakMap<object, boolean>();

export function configureOverlayWorkspaceWindow(
  window: OverlayWorkspaceWindowLike,
  visibleOnFullScreen: boolean
): boolean {
  if (appliedVisibility.get(window as object) === visibleOnFullScreen) return false;
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
