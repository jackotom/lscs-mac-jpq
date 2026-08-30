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

const appliedConfiguration = new WeakMap<object, string>();

export function configureOverlayWorkspaceWindow(
  window: OverlayWorkspaceWindowLike,
  visibleOnFullScreen: boolean
): boolean {
  return applyOverlayWorkspaceWindow(
    window,
    visibleOnFullScreen
  );
}

export function reassertOverlayWindowPresentation(
  window: OverlayPresentationWindowLike,
  visibleOnFullScreen: boolean
): void {
  applyOverlayWorkspaceWindow(
    window,
    visibleOnFullScreen
  );
  window.setAlwaysOnTop(true, "screen-saver");
  window.showInactive();
}

function applyOverlayWorkspaceWindow(
  window: OverlayWorkspaceWindowLike,
  visibleOnFullScreen: boolean
): boolean {
  const configurationKey = String(visibleOnFullScreen);
  if (appliedConfiguration.get(window as object) === configurationKey) return false;
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen,
    skipTransformProcessType: true
  });
  appliedConfiguration.set(window as object, configurationKey);
  return true;
}

export function getOverlayWindowPlatformOptions(platform = process.platform) {
  return platform === "darwin" ? { type: "panel" as const } : {};
}
