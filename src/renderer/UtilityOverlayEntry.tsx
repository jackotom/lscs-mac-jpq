import { useEffect, useRef, useState } from "react";
import type { ArenaHeroWinRateRankingResult } from "../shared/arenaHeroStats";
import type { CardDetails } from "../shared/cardDatabase";
import type { LadderDeckRecommendationResult, LadderMode } from "../shared/ladderDeckRecommendation";
import { LadderDeckRecommendationPanel } from "./components/LadderDeckRecommendationPanel";
import { ArenaHeroWinRateRankingPanel } from "./components/ArenaHeroWinRateRankingPanel";
import { CardDetailBody } from "./components/CardDetailBody";
import "./ladderDeckRecommendationStyles.css";
import "./arenaHeroRankingStyles.css";
import "./cardHoverStyles.css";
import "./lightOverlayStyles.css";

export default function UtilityOverlayEntry() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("ladder-deck-overlay") === "1") return <LadderRecommendation />;
  if (params.get("arena-hero-ranking-overlay") === "1") return <ArenaRanking />;
  return <CardPreview />;
}

function LadderRecommendation() {
  const api = window.hearthstoneTracker;
  const [mode, setMode] = useState<LadderMode>(() => new URLSearchParams(window.location.search).get("mode") === "wild" ? "wild" : "standard");
  const [result, setResult] = useState<LadderDeckRecommendationResult>();
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);
  useEffect(() => {
    const onPopState = () => setMode(new URLSearchParams(window.location.search).get("mode") === "wild" ? "wild" : "standard");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    let disposed = false;
    const serial = ++requestVersion.current;
    const unsubscribe = api?.onLadderDeckRecommendationUpdate?.((nextMode, next) => {
      if (!disposed && nextMode === mode) { requestVersion.current += 1; setResult(next); setLoading(false); }
    });
    const request = api?.getLadderDeckRecommendation?.(mode);
    if (request) void request.then((next) => { if (!disposed && requestVersion.current === serial) { setResult(next); setLoading(false); } }).catch(() => { if (!disposed && requestVersion.current === serial) setLoading(false); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [api, mode]);
  const ready = result?.status === "ready" ? result : undefined;
  return <LadderDeckRecommendationPanel mode={mode} recommendation={ready?.recommendation} isCached={ready?.stale} isLoading={loading}
    unavailable={result?.status === "unavailable" ? result : undefined}
    onCopyDeckCode={(deckCode) => api?.copyLadderDeckCode?.(deckCode) ?? Promise.reject(new Error("复制功能不可用"))}
    onClose={() => { void api?.closeLadderDeckOverlay?.(); }} />;
}

function ArenaRanking() {
  const api = window.hearthstoneTracker;
  const [result, setResult] = useState<ArenaHeroWinRateRankingResult>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false, updates = 0;
    const unsubscribe = api?.onArenaHeroWinRateRankingUpdate?.((next) => { updates += 1; if (!disposed) { setResult(next); setLoading(false); } });
    const version = updates;
    const request = api?.getArenaHeroWinRateRanking?.();
    if (request) void request.then((next) => { if (!disposed && updates === version) { setResult(next); setLoading(false); } }).catch(() => { if (!disposed && updates === version) setLoading(false); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [api]);
  return <ArenaHeroWinRateRankingPanel result={result} isLoading={loading} onClose={() => { void api?.closeArenaHeroWinRateRanking?.(); }} />;
}

function CardPreview() {
  const [details, setDetails] = useState<CardDetails>();
  const [pinned, setPinned] = useState(false);
  useEffect(() => window.hearthstoneTracker?.onCardPreviewUpdate?.(setDetails), []);
  useEffect(() => window.hearthstoneTracker?.onCardPreviewPinnedChange?.(setPinned), []);
  return <section className="card-preview-window-shell" data-pinned={pinned} aria-label={details ? `卡牌说明：${details.name}` : "卡牌说明"}>
    {details ? <CardDetailBody details={details} className="card-detail-body-hover" mode={pinned ? "interactive" : "summary"} /> : null}
    {details ? <div className="card-preview-hint">{pinned ? "已固定 · ⌥Q 取消" : "⌥Q 固定 · 滚轮查看"}</div> : null}
  </section>;
}
