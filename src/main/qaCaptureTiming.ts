export type QaJavaScriptExecutor = (script: string) => Promise<unknown>;

export function shouldApplyTrackerSettingsEffectsDuringQaCapture(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  const automatedCapture = environment.QA_EXIT_AFTER_SCREENSHOT === "1" && Boolean(
    environment.QA_SCREENSHOT_PATH || environment.QA_INSPECT_PATH
  );
  return !automatedCapture || environment.QA_APPLY_TRACKER_SETTINGS_EFFECTS === "1";
}

export function shouldSkipLaunchAtLoginUpdateDuringQaCapture(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  return environment.QA_APPLY_TRACKER_SETTINGS_EFFECTS === "1";
}

export function requestQaQuit(quit: () => void): Promise<never> {
  quit();
  return new Promise<never>(() => undefined);
}

export async function waitForQaRendererSettled(
  executeJavaScript: QaJavaScriptExecutor,
  timeoutMs = 1_000
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  await Promise.race([
    executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))"),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    })
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}
