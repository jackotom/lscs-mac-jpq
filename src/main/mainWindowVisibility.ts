export function isQaOverlayCapture(environment: Readonly<Record<string, string | undefined>>) {
  return (
    environment.QA_OPEN_OVERLAY === "1" ||
    environment.QA_OPEN_OPPONENT_OVERLAY === "1" ||
    environment.QA_OPEN_ARENA_CHOICE_OVERLAY === "1" ||
    environment.QA_OPEN_LADDER_DECK_OVERLAY === "1" ||
    environment.QA_OPEN_BOARD_ATTACK_OVERLAY === "1" ||
    environment.QA_OPEN_FRIENDLY_ATTACK_OVERLAY === "1" ||
    environment.QA_OPEN_OPPONENT_ATTACK_OVERLAY === "1" ||
    environment.QA_OPEN_FRIENDLY_HEALTH_OVERLAY === "1" ||
    environment.QA_OPEN_OPPONENT_HEALTH_OVERLAY === "1" ||
    environment.QA_OPEN_SECRET_OVERLAY === "1" ||
    environment.QA_OPEN_SMART_COUNTER_OVERLAY === "1" ||
    environment.QA_OPEN_ARENA_HERO_RANKING_OVERLAY === "1" ||
    environment.QA_OPEN_THREE_WINDOW_LAYOUT === "1"
  );
}

export function shouldRunBoardAttackOverlayMonitor(
  environment: Readonly<Record<string, string | undefined>>,
  showAnyAuxiliaryOverlay: boolean
) {
  return showAnyAuxiliaryOverlay && !isQaOverlayCapture(environment);
}

export function shouldShowMainWindowOnLaunch(
  environment: Readonly<Record<string, string | undefined>>,
  startMinimized = false
) {
  const capturesMainWindow = Boolean(environment.QA_SCREENSHOT_PATH || environment.QA_INSPECT_PATH);
  if (isQaOverlayCapture(environment)) return false;
  return capturesMainWindow && environment.QA_EXIT_AFTER_SCREENSHOT === "1" || !startMinimized;
}

export function shouldFocusMainWindowOnLaunch(
  environment: Readonly<Record<string, string | undefined>>,
  focusOnOpen: boolean
) {
  const automatedCapture = environment.QA_EXIT_AFTER_SCREENSHOT === "1" &&
    Boolean(environment.QA_SCREENSHOT_PATH || environment.QA_INSPECT_PATH);
  return focusOnOpen && !automatedCapture;
}

export function shouldPreventAutomatedCaptureClose(
  environment: Readonly<Record<string, string | undefined>>,
  shutdownRequested: boolean
) {
  const automatedCapture = environment.QA_EXIT_AFTER_SCREENSHOT === "1" &&
    Boolean(environment.QA_SCREENSHOT_PATH || environment.QA_INSPECT_PATH);
  return automatedCapture && !shutdownRequested;
}

export interface MainWindowPresentationTarget {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  showInactive(): void;
  focus(): void;
}

export function presentMainWindow(
  window: MainWindowPresentationTarget,
  focusOnOpen: boolean,
  focusApplication: () => void
): void {
  if (window.isMinimized()) window.restore();
  if (!focusOnOpen) {
    window.showInactive();
    return;
  }
  focusApplication();
  window.show();
  window.focus();
}

export function shouldHandleAppActivate(
  initialBackgroundWindowReady: boolean,
  initialLaunchActivateObserved: boolean,
  nowMs: number,
  userActivationAllowedAfterMs: number,
  qaOverlayCapture = false
) {
  return (
    !qaOverlayCapture &&
    initialBackgroundWindowReady &&
    (initialLaunchActivateObserved || nowMs >= userActivationAllowedAfterMs)
  );
}
