import type { CSSProperties } from "react";
import { Layers3, Minus } from "lucide-react";
import type { OpponentOverlayPanelProps, OverlayCardItem, OverlayStatusTone } from "../types";
import { CollapsibleCardGroup } from "./OverlayPanel";
import { CardTrackingGroups } from "./CardTrackingGroups";
import { PublicMatchCounters } from "./PublicMatchCounters";
import { MatchPulse } from "./MatchPulse";

export function OpponentOverlayPanel({
  view,
  className = "overlay-shell opponent-overlay-shell",
  style,
  isCollapsed,
  onCollapsedChange,
  isLoading = false,
  loadError
}: OpponentOverlayPanelProps) {
  const needsLogRepair = view.status.tone === "offline";
  if (isCollapsed) {
    return (
      <section className={`${className} opponent-overlay-collapsed`} style={style} aria-label="对手记牌器置顶小窗">
        <button
          type="button"
          className="opponent-overlay-restore"
          onClick={() => onCollapsedChange?.(false)}
          aria-label="恢复对手记牌小窗"
        >
          <Layers3 aria-hidden="true" size={18} />
        </button>
      </section>
    );
  }

  return (
    <section className={className} style={style} aria-label="对手记牌器置顶小窗" aria-busy={isLoading}>
      <header className="overlay-header">
        <div>
          <strong>对手记牌器</strong>
          <span>{isLoading ? "正在读取本机状态" : view.status.detail}</span>
        </div>
        <StatusPill tone={isLoading ? "offline" : view.status.tone} label={isLoading ? "读取中" : view.status.label} />
        <button type="button" onClick={() => onCollapsedChange?.(true)} aria-label="折叠对手小窗" title="折叠对手小窗">
          <Minus aria-hidden="true" size={14} />
        </button>
      </header>

      {isLoading ? (
        <section className="overlay-repair-prompt" role="status">
          <strong>正在读取对局状态</strong>
          <p>正在扫描炉石日志，请稍候。</p>
        </section>
      ) : loadError ? (
        <section className="overlay-repair-prompt" role="alert">
          <strong>读取失败</strong>
          <p>{loadError}</p>
          <span>请关闭并重新打开记牌器。</span>
        </section>
      ) : needsLogRepair ? (
        <section className="overlay-repair-prompt" role="status">
          <strong>{view.status.label}</strong>
          <p>先点修复日志，完全退出并重新打开炉石，然后进入一局。</p>
        </section>
      ) : (
        <>
          <MatchPulse pulse={view.matchPulse} variant="actor" />
          <section className="opponent-tracking-summary" aria-label="对手概览">
            <span>牌库 <strong>{view.cardTracking.current.deck.countLabel}</strong></span>
            <span>手牌 <strong>{view.cardTracking.current.hand.countLabel}</strong></span>
          </section>
          <PublicMatchCounters side="opponent" counters={view.opponentCounters} />
          {view.opponentGlobalEffects?.length ? (
            <CollapsibleCardGroup
              label="影响全局"
              count={countCards(view.opponentGlobalEffects)}
              items={view.opponentGlobalEffects}
              emptyLabel="暂无全局影响"
            />
          ) : null}
          <CardTrackingGroups view={view.cardTracking} opponent hideSecret />
        </>
      )}
    </section>
  );
}

function StatusPill({ tone, label }: { tone: OverlayStatusTone; label: string }) {
  return (
    <span className={`overlay-status overlay-status-${tone}`} style={statusToneStyles[tone]}>
      {label}
    </span>
  );
}

function countCards(items: readonly OverlayCardItem[]): number {
  return items.reduce((total, item) => total + (item.count ?? 1), 0);
}

const statusToneStyles: Record<OverlayStatusTone, CSSProperties> = {
  ready: { borderColor: "rgba(201, 209, 217, 0.22)", color: "#e5edf6" },
  tracking: { borderColor: "rgba(94, 234, 212, 0.28)", color: "#b9fff3" },
  paused: { borderColor: "rgba(250, 204, 21, 0.32)", color: "#fff3ad" },
  offline: { borderColor: "rgba(251, 146, 60, 0.32)", color: "#ffd7b8" },
  error: { borderColor: "rgba(248, 113, 113, 0.34)", color: "#ffd0d0" }
};
