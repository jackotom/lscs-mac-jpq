import { useEffect, useId, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Layers3, Minus } from "lucide-react";
import type { OpponentOverlayPanelProps, OverlayCardItem, OverlayStatusTone, OpponentHandTimelineEntry, OpponentTurnTimer } from "../types";
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
          <OpponentTurnTimerView timer={view.turnTimer} />
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
          <CardTrackingGroups
            view={view.cardTracking}
            opponent
            hideSecret
            afterCurrentGroups={({ expanded, onToggle }) => (
              <OpponentHandTimeline
                entries={view.opponentHand}
                expanded={expanded}
                onToggle={onToggle}
              />
            )}
          />
        </>
      )}
    </section>
  );
}

function OpponentHandTimeline({
  entries,
  expanded,
  onToggle
}: {
  entries?: readonly OpponentHandTimelineEntry[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const contentId = useId();
  const byEntityId = new Map<string, OpponentHandTimelineEntry & { entityId: string }>();
  const legacyEntries: OpponentHandTimelineEntry[] = [];
  for (const entry of entries ?? []) {
    if (typeof entry.entityId === "string" && entry.entityId.trim()) {
      byEntityId.set(entry.entityId, entry as OpponentHandTimelineEntry & { entityId: string });
    } else {
      legacyEntries.push(entry);
    }
  }
  const confirmedEntries = [...byEntityId.values()];
  const count = confirmedEntries.length + legacyEntries.reduce(
    (total, entry) => total + Math.max(1, entry.count ?? 1),
    0
  );
  return (
    <section
      className="overlay-card-group opponent-hand-timeline"
      aria-label="对手手牌时间线"
      data-group-key="confirmed-hand"
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="overlay-card-group-toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <span>已确认手牌 <em>({count})</em></span>
        {expanded
          ? <ChevronDown aria-hidden="true" size={13} />
          : <ChevronRight aria-hidden="true" size={13} />}
      </button>
      {expanded ? (
        <div id={contentId} className="overlay-card-group-content">
          {confirmedEntries.length || legacyEntries.length ? (
            <ul className="opponent-hand-list">
              {confirmedEntries.map((entry) => (
                <li
                  className={`opponent-hand-row${entry.name ? "" : " opponent-hand-unknown"}${entry.created ? " is-created" : ""}${entry.forged ? " is-forged" : ""}`}
                  key={entry.entityId}
                >
                  <span>{entry.name ?? "未知手牌"}</span>
                  <small>{entry.drawnTurn ? `第 ${entry.drawnTurn} 回合抽取` : "抽取回合未知"}</small>
                  {entry.created ? <em>创建</em> : null}
                  {entry.forged ? <em>已锻造</em> : null}
                  {(entry.buffs ?? []).map((buff) => <em key={buff}>{buff}</em>)}
                </li>
              ))}
              {legacyEntries.map((entry, index) => (
                <li
                  className="opponent-hand-row opponent-hand-legacy"
                  key={`legacy-${entry.cardId ?? entry.name ?? "unknown"}-${index}`}
                >
                  <span>{entry.name ? `${entry.name} ×${entry.count ?? 1}` : "旧版未知手牌记录"}</span>
                  <small>缺少实体标识，不能纳入抽取时间线</small>
                </li>
              ))}
            </ul>
          ) : <p className="overlay-card-group-empty">暂无确认记录</p>}
        </div>
      ) : null}
    </section>
  );
}

function OpponentTurnTimerView({ timer }: { timer?: OpponentTurnTimer }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer?.startedAt || !Number.isFinite(Date.parse(timer.startedAt))) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [timer?.startedAt]);
  if (!timer?.turn) return null;
  const startedAt = timer.startedAt ? Date.parse(timer.startedAt) : Number.NaN;
  const hasReliableStart = Number.isFinite(startedAt);
  const elapsedSeconds = hasReliableStart ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const remainingSeconds = Math.max(0, timer.durationSeconds - elapsedSeconds);
  return (
    <section className={`opponent-turn-timer${hasReliableStart ? "" : " is-unavailable"}`} aria-label="回合计时">
      <strong>第 {timer.turn} 回合</strong>
      <span>{timer.activeSide === "opponent" ? "对手行动" : timer.activeSide === "friendly" ? "我方行动" : "行动方未知"}</span>
      {hasReliableStart ? <span>剩余 {formatSeconds(remainingSeconds)}</span> : null}
    </section>
  );
}

function formatSeconds(value: number): string {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
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
