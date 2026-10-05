import { useEffect, useState } from "react";
import type { PublicTrackerState } from "../shared/types";
import { toOverlayPanelViewModel } from "./overlayView";
import { useDisplayState } from "./useDisplayState";
import { BoardAttackOverlay } from "./components/BoardAttackOverlay";
import { SingleAttackOverlay } from "./components/SingleAttackOverlay";
import { HealthOverlay } from "./components/HealthOverlay";
import { SecretOverlay } from "./components/SecretOverlay";
import { SmartCounterOverlay } from "./components/SmartCounterOverlay";
import { ArenaChoiceOverlayPanel } from "./components/ArenaChoiceOverlayPanel";
import "./boardAttackOverlayStyles.css";
import "./secretOverlayStyles.css";
import "./smartCounterOverlayStyles.css";
import "./arenaChoiceOverlayStyles.css";
import "./lightOverlayStyles.css";

function smartCountersFromState(state: PublicTrackerState) {
  return state.smartCounters ?? [];
}

export default function AuxiliaryOverlayEntry() {
  const params = new URLSearchParams(window.location.search);
  const state = useDisplayState();
  const [secretCollapsed, setSecretCollapsed] = useState(false);

  useEffect(() => {
    if (!params.get("secret-overlay") || !window.hearthstoneTracker?.getSecretOverlayCollapsed) return;
    let disposed = false;
    void window.hearthstoneTracker.getSecretOverlayCollapsed().then((collapsed) => {
      if (!disposed) setSecretCollapsed(collapsed);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [params.toString()]);

  if (!state) return null;
  if (params.get("board-attack-overlay") === "1") {
    if (!state.gameActive) return null;
    return <BoardAttackOverlay attack={state.boardAttack} showFriendly={params.get("show-friendly-attack") !== "0"} showOpponent={params.get("show-opponent-attack") !== "0"} />;
  }
  if (params.get("friendly-attack-overlay") === "1" || params.get("opponent-attack-overlay") === "1") {
    if (!state.gameActive) return null;
    const side = params.get("friendly-attack-overlay") === "1" ? "friendly" : "opponent";
    return <SingleAttackOverlay side={side} value={state.boardAttack?.[side] ?? 0} />;
  }
  if (params.get("friendly-health-overlay") === "1" || params.get("opponent-health-overlay") === "1") {
    if (!state.gameActive) return null;
    const side = params.get("friendly-health-overlay") === "1" ? "friendly" : "opponent";
    const value = state.heroHealthLimit?.[side];
    return value === undefined ? null : <HealthOverlay side={side} value={value} />;
  }
  if (params.get("secret-overlay") === "1") {
    const view = toOverlayPanelViewModel(state, { maxDeckRows: 0, maxRecentRows: 0, side: "opponent", showSecretCandidates: true });
    return <SecretOverlay slots={view.cardTracking.secretSlots} isCollapsed={secretCollapsed} onCollapsedChange={(collapsed) => {
      setSecretCollapsed(collapsed);
      const save = window.hearthstoneTracker?.setSecretOverlayCollapsed?.(collapsed);
      if (save) void save.catch(() => setSecretCollapsed(!collapsed));
    }} />;
  }
  if (params.get("smart-counter-overlay") === "1") {
    const counterId = params.get("smart-counter-id")?.trim();
    const counters = smartCountersFromState(state);
    return <SmartCounterOverlay counters={counterId ? counters.filter((counter) => counter.id === counterId) : counters} />;
  }
  if (params.get("arena-choice-overlay") === "1") return <ArenaChoiceOverlayPanel arena={state.arena} />;
  return null;
}
