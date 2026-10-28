import React from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { markRendererReady } from "./rendererReady";
import { parseTrackerSettings } from "./runtimeValidation";
import { resolveTrackerTheme } from "./trackerTheme";
import "./windowBaseStyles.css";

export function TrackerThemeBridge() {
  const api = window.hearthstoneTracker;
  const [settings, setSettings] = React.useState<ReturnType<typeof parseTrackerSettings>>();
  const liveUpdateVersion = React.useRef(0);

  React.useEffect(() => {
    if (!api?.getTrackerSettings) return;
    let disposed = false;
    const apply = (value: unknown) => {
      try {
        const next = parseTrackerSettings(value);
        if (!disposed) setSettings(next);
      } catch {
        // Invalid cross-window settings are ignored; the main settings screen reports the error.
      }
    };
    const unsubscribe = api.onTrackerSettingsUpdate?.((value) => {
      liveUpdateVersion.current += 1;
      apply(value);
    });
    const initialVersion = liveUpdateVersion.current;
    void api.getTrackerSettings().then((value) => {
      if (liveUpdateVersion.current === initialVersion) apply(value);
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [api]);

  React.useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const apply = () => {
      root.dataset.trackerTheme = resolveTrackerTheme(settings, window.location.search, media?.matches === true);
    };
    apply();
    media?.addEventListener?.("change", apply);
    root.dataset.trackerFontSize = settings.appearance.fontSize;
    root.dataset.trackerAnimations = settings.appearance.animations ? "on" : "off";
    root.dataset.trackerCardQuality = settings.appearance.cardImageQuality;
    root.style.setProperty("--tracker-accent", settings.appearance.accentColor);
    return () => media?.removeEventListener?.("change", apply);
  }, [settings]);

  return null;
}

const rootElement = document.getElementById("root");
const overlaySearchParams = new URLSearchParams(window.location.search);
const isBoardAttackOverlay = overlaySearchParams.get("board-attack-overlay") === "1";
const isSingleAttackOverlay = overlaySearchParams.get("friendly-attack-overlay") === "1" ||
  overlaySearchParams.get("opponent-attack-overlay") === "1";
const isHealthOverlay = overlaySearchParams.get("friendly-health-overlay") === "1" ||
  overlaySearchParams.get("opponent-health-overlay") === "1";
const isSecretOverlay = overlaySearchParams.get("secret-overlay") === "1";
const isSmartCounterOverlay = overlaySearchParams.get("smart-counter-overlay") === "1";
const isQaRoute = [...overlaySearchParams.keys()].some((key) => key.startsWith("qa-"));
const isAuxiliaryOverlay = !isQaRoute && (
  isBoardAttackOverlay || isSingleAttackOverlay || isHealthOverlay || isSecretOverlay || isSmartCounterOverlay ||
  overlaySearchParams.get("arena-choice-overlay") === "1"
);
const isTrackerOverlay = !isQaRoute && (
  overlaySearchParams.get("overlay") === "1" || overlaySearchParams.get("opponent-overlay") === "1"
);
const isUtilityOverlay = !isQaRoute && (
  overlaySearchParams.get("ladder-deck-overlay") === "1" ||
  overlaySearchParams.get("arena-hero-ranking-overlay") === "1" ||
  overlaySearchParams.get("card-preview") === "1"
);
const Renderer = React.lazy(() => isAuxiliaryOverlay
  ? import("./AuxiliaryOverlayEntry")
  : isTrackerOverlay
    ? import("./TrackerOverlayEntry")
    : isUtilityOverlay
      ? import("./UtilityOverlayEntry")
      : import("./App"));

function MarkRendererReadyAfterMount() {
  React.useEffect(() => {
    queueMicrotask(() => markRendererReady(document));
  }, []);
  return null;
}

if (isBoardAttackOverlay) {
  document.documentElement.classList.add("board-attack-overlay-document");
}

if (isSingleAttackOverlay) {
  document.documentElement.classList.add("single-attack-overlay-document");
}

if (isHealthOverlay) {
  document.documentElement.classList.add("health-overlay-document");
}

if (isSecretOverlay) {
  document.documentElement.classList.add("secret-overlay-document");
}

if (isSmartCounterOverlay) {
  document.documentElement.classList.add("smart-counter-overlay-document");
}

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  flushSync(() => {
    root.render(
      <React.StrictMode>
        <TrackerThemeBridge />
        <React.Suspense fallback={null}>
          <Renderer />
          <MarkRendererReadyAfterMount />
        </React.Suspense>
      </React.StrictMode>
    );
  });
}
