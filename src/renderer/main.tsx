import React from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import App from "./App";
import { markRendererReady } from "./rendererReady";
import { parseTrackerSettings } from "./runtimeValidation";
import { resolveTrackerTheme } from "./trackerTheme";
import "./styles.css";
import "./overlayStyles.css";
import "./arenaChoiceOverlayStyles.css";
import "./cardHoverStyles.css";
import "./opponentOverlayStyles.css";
import "./boardAttackOverlayStyles.css";
import "./ladderDeckRecommendationStyles.css";
import "./matchHistoryStyles.css";
import "./desktopReplicaStyles.css";
import "./homeNewsStyles.css";
import "./arenaHeroRankingStyles.css";
import "./lightOverlayStyles.css";

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
        <App />
      </React.StrictMode>
    );
  });
  markRendererReady(document);
}
