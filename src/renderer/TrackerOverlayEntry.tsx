import { useEffect, useRef, useState } from "react";
import { toOverlayPanelViewModel } from "./overlayView";
import { OverlayPanel } from "./components/OverlayPanel";
import { OpponentOverlayPanel } from "./components/OpponentOverlayPanel";
import { useDisplayState } from "./useDisplayState";
import { parseTrackerSettings } from "./runtimeValidation";
import "./overlayStyles.css";
import "./opponentOverlayStyles.css";
import "./cardHoverStyles.css";
import "./lightOverlayStyles.css";

export default function TrackerOverlayEntry() {
  const params = new URLSearchParams(window.location.search);
  const state = useDisplayState();
  const isOpponent = params.get("opponent-overlay") === "1";
  const [collapsed, setCollapsed] = useState(false);
  const [showMulliganGuide, setShowMulliganGuide] = useState(true);
  const changeVersion = useRef(0);
  const settingsVersion = useRef(0);

  useEffect(() => {
    const api = window.hearthstoneTracker;
    if (!api?.getTrackerSettings) return;
    let disposed = false;
    const apply = (value: unknown) => {
      try {
        const next = parseTrackerSettings(value);
        if (!disposed) setShowMulliganGuide(next.overlay.mulliganGuide);
      } catch {
        // Invalid cross-window settings are ignored; the main settings screen reports the error.
      }
    };
    const unsubscribe = api.onTrackerSettingsUpdate?.((value) => {
      settingsVersion.current += 1;
      apply(value);
    });
    const initialVersion = settingsVersion.current;
    void api.getTrackerSettings().then((value) => {
      if (settingsVersion.current === initialVersion) apply(value);
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!isOpponent || !window.hearthstoneTracker?.getOpponentOverlayCollapsed) return;
    let disposed = false;
    const unsubscribe = window.hearthstoneTracker.onOpponentOverlayCollapsedChange?.((next) => {
      if (!disposed) { changeVersion.current += 1; setCollapsed(next); }
    });
    const snapshotVersion = changeVersion.current;
    void window.hearthstoneTracker.getOpponentOverlayCollapsed().then((next) => {
      if (!disposed && changeVersion.current === snapshotVersion) setCollapsed(next);
    }).catch(() => undefined);
    return () => { disposed = true; unsubscribe?.(); };
  }, [isOpponent]);

  if (!state) return null;
  if (!isOpponent) {
    return <OverlayPanel view={toOverlayPanelViewModel(state, { maxDeckRows: 40, maxRecentRows: 3 })}
      showMulliganGuide={showMulliganGuide}
      onClose={window.hearthstoneTracker?.closeFriendlyOverlay ? () => { void window.hearthstoneTracker?.closeFriendlyOverlay?.(); } : undefined}
      onOpenSettings={window.hearthstoneTracker?.openSettings ? () => { void window.hearthstoneTracker?.openSettings?.(); } : undefined} />;
  }
  const raw = toOverlayPanelViewModel(state, { maxDeckRows: 40, maxRecentRows: 40, side: "opponent", showSecretCandidates: false });
  const view = { ...raw, cardTracking: { ...raw.cardTracking, secretSlots: [] }, opponentHand: state.opponentHand, turnTimer: state.turnTimer };
  return <OpponentOverlayPanel view={view} isCollapsed={collapsed} onCollapsedChange={(next) => {
    const version = ++changeVersion.current;
    setCollapsed(next);
    const save = window.hearthstoneTracker?.setOpponentOverlayCollapsed?.(next);
    if (save) void save.then((confirmed) => { if (changeVersion.current === version) setCollapsed(confirmed); }).catch(() => { if (changeVersion.current === version) setCollapsed(!next); });
  }} />;
}
