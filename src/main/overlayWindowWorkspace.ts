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
  visibleOnFullScreen: boolean,
  skipTransformProcessType = false
): boolean {
  return applyOverlayWorkspaceWindow(
    window,
    visibleOnFullScreen,
    skipTransformProcessType,
    false
  );
}

export function reassertOverlayWindowPresentation(
  window: OverlayPresentationWindowLike,
  visibleOnFullScreen: boolean,
  skipTransformProcessType = false
): void {
  applyOverlayWorkspaceWindow(
    window,
    visibleOnFullScreen,
    skipTransformProcessType,
    true
  );
  window.setAlwaysOnTop(true, "screen-saver");
  window.showInactive();
}

function applyOverlayWorkspaceWindow(
  window: OverlayWorkspaceWindowLike,
  visibleOnFullScreen: boolean,
  skipTransformProcessType: boolean,
  force: boolean
): boolean {
  const configurationKey = `${visibleOnFullScreen}:${skipTransformProcessType}`;
  if (!force && appliedConfiguration.get(window as object) === configurationKey) return false;
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen,
    skipTransformProcessType
  });
  appliedConfiguration.set(window as object, configurationKey);
  return true;
}

export function getOverlayWindowPlatformOptions(platform = process.platform) {
  return platform === "darwin" ? { type: "panel" as const } : {};
}
