import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Check,
  Copy,
  Crown,
  History,
  Image as ImageIcon,
  Layers3,
  ShieldCheck,
  Swords,
  Trophy,
  type LucideIcon
} from "lucide-react";
import type { LadderDeckRecommendationResult } from "../../shared/ladderDeckRecommendation";
import type { HomeNewsResult } from "../../shared/homeNews";
import type { ArenaHeroWinRateRankingResult } from "../../shared/arenaHeroStats";
import type { MatchHistoryResult, MatchRecord, PublicTrackerState } from "../../shared/types";
import { toDashboardViewModel, type DashboardEventView } from "../dashboardView";

export interface HomeDashboardProps {
  readonly state: PublicTrackerState;
  readonly matchHistory?: MatchHistoryResult;
  readonly matchHistoryLoading?: boolean;
  readonly matchHistoryError?: string;
  readonly homeNews?: HomeNewsResult;
  readonly homeNewsLoading?: boolean;
  readonly homeNewsError?: string;
  readonly ladderRecommendation?: LadderDeckRecommendationResult;
  readonly arenaHeroRanking?: ArenaHeroWinRateRankingResult;
  readonly arenaHeroRankingLoading?: boolean;
  readonly onCopyLadderDeckCode?: (deckCode: string) => Promise<void>;
  readonly onOpenNewsItem?: (itemId: string) => Promise<void>;
  readonly onOpenTracker?: () => void;
  readonly onOpenDeckTools?: () => void;
  readonly onOpenMatchHistory?: () => void;
}

const heroImageUrl = new URL("../assets/home-emerald-hero-v1.png", import.meta.url).href;
const appIconUrl = new URL("../../../assets/icons/hearthstone-deck-tracker-icon-v1.png", import.meta.url).href;
const resultLabels = { win: "胜利", loss: "失败", tie: "平局" } as const;
const matchModeLabels = { standard: "标准", wild: "狂野", arena: "竞技场", unknown: "未知模式" } as const;
const modeOrder = ["standard", "wild", "arena", "unknown"] as const;

type CopyState = "idle" | "copying" | "copied" | "error";

export function HomeDashboard({
  state,
  matchHistory,
  matchHistoryLoading = false,
  matchHistoryError,
  homeNews,
  homeNewsLoading = false,
  homeNewsError,
  ladderRecommendation,
  arenaHeroRanking,
  arenaHeroRankingLoading = false,
  onCopyLadderDeckCode,
  onOpenNewsItem,
  onOpenTracker,
  onOpenDeckTools,
  onOpenMatchHistory
}: HomeDashboardProps) {
  const dashboard = toDashboardViewModel(state, matchHistory, ladderRecommendation);
  const history = useMemo(
    () => matchHistory?.status === "ok"
      ? [...matchHistory.matches].sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt))
      : [],
    [matchHistory]
  );
  const recentEvents = dashboard.events.items.slice(-4).reverse();
  const recentMatches = history.slice(0, 5);
  const todayMatches = history.filter((match) => isToday(match.endedAt)).length;
  const bestWinStreak = getBestWinStreak(history);
  const modeStats = getModeStats(history);
  const historyState = getHistoryState(matchHistory, matchHistoryLoading, matchHistoryError);
  const ladderReady = dashboard.ladder.state === "ready" && Boolean(dashboard.ladder.recommendation);
  const hero = getHeroCopy(state);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => setCopyState("idle"), [dashboard.ladder.recommendation?.deckCode]);

  async function copyDeckCode() {
    const deckCode = dashboard.ladder.recommendation?.deckCode;
    if (!deckCode || !onCopyLadderDeckCode || copyState === "copying") return;
    setCopyState("copying");
    try {
      await onCopyLadderDeckCode(deckCode);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <section
      className="home-dashboard home-reference-dashboard"
      data-tracker-status={state.status}
      data-ladder-state={dashboard.ladder.state}
      aria-label="首页"
    >
      <header className="home-product-header" aria-label="产品状态栏">
        <div className="home-product-brand">
          <span className="home-product-mark" aria-hidden="true">
            <img src={appIconUrl} alt="" />
          </span>
          <span>
            <strong>炉石记牌器</strong>
            <small className={`status-${state.status}`}><i aria-hidden="true" />{getServiceLabel(state)}</small>
          </span>
        </div>
      </header>

      <main className="home-reference-content">
        <section className="home-reference-primary" aria-label="当前概览">
          <article className="home-reference-hero">
            <img src={heroImageUrl} alt="" />
            <div className="home-reference-hero-shade" aria-hidden="true" />
            <div className="home-reference-hero-copy">
              <span>{dashboard.tracker.label}</span>
              <h1>{hero.title}</h1>
              <p>{hero.detail}</p>
              <button type="button" onClick={onOpenTracker}>查看详情<ArrowRight aria-hidden="true" size={16} /></button>
            </div>
          </article>

          <Panel className="home-current-deck" title="当前套牌" icon={Layers3}>
            {dashboard.deck.state === "ready" ? (
              <>
                <div className="home-current-deck-heading">
                  <span className="home-current-deck-emblem" aria-hidden="true"><Layers3 size={24} /></span>
                  <div><strong>{dashboard.deck.name ?? "未命名套牌"}</strong><small>{getCurrentModeLabel(state)}</small></div>
                </div>
                <dl className="home-current-deck-stats">
                  <Stat label="总计" value={dashboard.deck.totalCards} />
                  <Stat label="剩余" value={dashboard.deck.remainingCards} />
                  <Stat label="已抽" value={dashboard.deck.drawnCards} />
                </dl>
                <ul className="home-current-deck-cards" aria-label="当前套牌卡牌摘要">
                  {dashboard.deck.cards.slice(0, 3).map((card) => <li key={card.id}><span>{card.name}</span><strong>×{card.remaining}</strong></li>)}
                </ul>
              </>
            ) : <EmptyState>{dashboard.deck.message ?? "尚未识别当前套牌。"}</EmptyState>}
            <button type="button" className="home-panel-link" onClick={onOpenDeckTools}>查看套牌详情<ArrowRight aria-hidden="true" size={14} /></button>
          </Panel>
        </section>

        <section className="home-summary-strip" aria-label="对局汇总">
          <SummaryMetric label="今日对局" value={historyState === "ready" ? todayMatches : historyState} detail="本机记录" icon={Swords} />
          <SummaryMetric label="总对局" value={historyState === "ready" ? dashboard.history.total ?? 0 : historyState} detail="最近保留记录" icon={Activity} />
          <SummaryMetric label="总胜率" value={historyState === "ready" ? formatHistoryWinRate(dashboard.history.winRate) : historyState} detail="已完成对局" icon={Trophy} />
          <SummaryMetric label="最佳连胜" value={historyState === "ready" ? bestWinStreak : historyState} detail="当前记录范围" icon={Crown} />
          <SummaryMetric label="当前状态" value={getStatusLabel(state)} detail={getCurrentModeLabel(state)} icon={ShieldCheck} />
        </section>

        <section className="home-reference-middle" aria-label="首页信息">
          <Panel className="home-activity-panel" title="炉石资讯" icon={Activity}>
            {homeNewsError ? <EmptyState alert>{homeNewsError}</EmptyState> : null}
            {homeNews?.items.length ? (
              <NewsList news={homeNews} onOpenNewsItem={onOpenNewsItem} />
            ) : homeNewsLoading ? (
              <EmptyState>正在读取炉石官网资讯…</EmptyState>
            ) : homeNewsError ? (
              recentEvents.length ? <ActivityList events={recentEvents} /> : null
            ) : (
              <ActivityList events={recentEvents} message="官网资讯暂时不可用；这里显示本机实时动态。" />
            )}
            {!homeNews?.items.length ? (
              <button type="button" className="home-panel-link" onClick={onOpenTracker}>进入实时对局<ArrowRight aria-hidden="true" size={14} /></button>
            ) : null}
          </Panel>

          <Panel className="home-ladder-panel" title="天梯热门卡组" icon={Trophy}>
            {ladderReady && dashboard.ladder.recommendation ? (
              <div className="home-ladder-recommendation">
                <div><strong>{dashboard.ladder.recommendation.name}</strong><small>{dashboard.ladder.recommendation.className} · {dashboard.ladder.recommendation.mode === "wild" ? "狂野" : "标准"}</small></div>
                <dl>
                  <Stat label="胜率" value={`${dashboard.ladder.recommendation.winRate.toFixed(1)}%`} />
                  <Stat label="场次" value={dashboard.ladder.recommendation.games.toLocaleString("zh-CN")} />
                </dl>
                <DataProvenance
                  source={dashboard.ladder.recommendation.source.name}
                  updatedAt={dashboard.ladder.recommendation.updatedAt}
                  sampleSize={dashboard.ladder.recommendation.games}
                  statusLabel={ladderRecommendation?.status === "ready" && ladderRecommendation.stale ? "缓存数据" : "来源可追溯"}
                />
                <button type="button" onClick={() => void copyDeckCode()} disabled={!onCopyLadderDeckCode || copyState === "copying"}>
                  {copyState === "copied" ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
                  {copyState === "copied" ? "已复制" : copyState === "copying" ? "复制中" : "复制卡组代码"}
                </button>
                {copyState === "error" ? <p role="alert">复制失败，请重试。</p> : null}
              </div>
            ) : <EmptyState>{dashboard.ladder.message ?? "当前没有可用的可信天梯数据。"}</EmptyState>}
          </Panel>

          <Panel className="home-arena-panel" title="竞技场职业胜率排行" icon={Crown}>
            <ArenaHeroRanking result={arenaHeroRanking} loading={arenaHeroRankingLoading} />
            <button type="button" className="home-panel-link" onClick={onOpenTracker}>查看竞技场状态<ArrowRight aria-hidden="true" size={14} /></button>
          </Panel>
        </section>

        <section className="home-reference-bottom" aria-label="历史数据">
          <Panel className="home-recent-matches" title="最近对局" icon={History}>
            <RecentMatches matches={recentMatches} loading={matchHistoryLoading} error={matchHistoryError ?? (matchHistory?.status === "error" ? matchHistory.error : undefined)} />
            <button type="button" className="home-panel-link" onClick={onOpenMatchHistory}>查看全部对局<ArrowRight aria-hidden="true" size={14} /></button>
          </Panel>

          <Panel className="home-mode-stats" title="模式统计" icon={BarChart3}>
            {historyState === "读取失败" ? (
              <EmptyState alert>对局历史读取失败，模式统计暂不可用。</EmptyState>
            ) : history.length ? (
              <div className="home-mode-stat-list">
                <strong>总对局 {history.length}</strong>
                <ul>{modeStats.map((item) => <li key={item.mode}><span>{matchModeLabels[item.mode]}</span><strong>{item.count}</strong><small>{formatPercentage(item.count, history.length)}</small></li>)}</ul>
              </div>
            ) : <EmptyState>{matchHistoryLoading ? "正在读取对局统计…" : "完成对局后会显示真实模式统计。"}</EmptyState>}
            <button type="button" className="home-panel-link" onClick={onOpenMatchHistory}>查看详细统计<ArrowRight aria-hidden="true" size={14} /></button>
          </Panel>
        </section>
      </main>
    </section>
  );
}

function Panel({ className, title, icon: Icon, children }: { className: string; title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <article className={`home-reference-panel ${className}`} aria-label={title}>
      <header><div><Icon aria-hidden="true" size={17} /><h2>{title}</h2></div></header>
      <div className="home-reference-panel-body">{children}</div>
    </article>
  );
}

function SummaryMetric({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: LucideIcon }) {
  return <article className="home-summary-metric"><span aria-hidden="true"><Icon size={23} /></span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></article>;
}

function NewsList({ news, onOpenNewsItem }: { news: HomeNewsResult; onOpenNewsItem?: (itemId: string) => Promise<void> }) {
  return (
    <ol className="home-activity-list home-news-list" aria-label="炉石官网资讯">
      {news.items.slice(0, 4).map((item) => (
        <li key={item.id}>
          <button type="button" disabled={!onOpenNewsItem} onClick={() => { void onOpenNewsItem?.(item.id); }}>
            <NewsThumbnail imageUrl={item.imageUrl} title={item.title} />
            <span className="home-news-copy">
              <time dateTime={item.publishedAt}>{news.status === "fallback" ? "离线资讯" : formatNewsDate(item.publishedAt)}</time>
              <strong>{item.title}</strong>
              <small>{item.summary}</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function NewsThumbnail({ imageUrl, title }: { imageUrl?: string; title: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  if (!imageUrl || failed) {
    return (
      <span className="home-news-thumbnail is-placeholder" role="img" aria-label={`${title}资讯图片占位`}>
        <ImageIcon aria-hidden="true" size={17} />
      </span>
    );
  }

  return (
    <span className="home-news-thumbnail">
      <img src={imageUrl} alt={`${title} 新闻图片`} loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}

function ArenaHeroRanking({ result, loading }: { result?: ArenaHeroWinRateRankingResult; loading: boolean }) {
  if (loading) return <EmptyState>正在读取竞技场排行…</EmptyState>;
  if (!result) return <EmptyState>竞技场排行尚未加载。</EmptyState>;
  if (result.status !== "ok") return <EmptyState alert={result.status === "error"}>{result.message}</EmptyState>;
  if (!result.entries.length) return <EmptyState>当前没有可用的竞技场排行数据。</EmptyState>;
  const sampleSize = result.sample ?? result.entries.reduce((total, entry) => total + entry.games, 0);
  return (
    <div className="home-arena-ranking-content">
      <ol className="home-arena-ranking" aria-label="竞技场职业胜率排行">
        {result.entries.slice(0, 5).map((entry) => (
          <li key={entry.heroClass}>
            <span>{entry.rank}</span><strong>{entry.heroName}</strong><small>{entry.games.toLocaleString("zh-CN")} 场</small><em>{entry.winRate.toFixed(1)}%</em>
          </li>
        ))}
      </ol>
      <DataProvenance
        source={result.source}
        updatedAt={result.updatedAt}
        sampleSize={sampleSize}
        statusLabel="公开统计"
        warning={result.warning}
      />
    </div>
  );
}

function DataProvenance({
  source,
  updatedAt,
  sampleSize,
  statusLabel,
  warning
}: {
  source: string;
  updatedAt: string;
  sampleSize: number;
  statusLabel: string;
  warning?: string;
}) {
  return (
    <aside className="home-data-provenance" aria-label="数据说明">
      <div>
        <span title={source}>来源：{source}</span>
        <time dateTime={updatedAt}>更新：{formatDataUpdateTime(updatedAt)}</time>
      </div>
      <strong>{statusLabel} · 样本 {sampleSize.toLocaleString("zh-CN")} 场</strong>
      {warning ? <small role="note">{warning}</small> : null}
    </aside>
  );
}

function ActivityList({ events, message }: { events: readonly DashboardEventView[]; message?: string }) {
  if (!events.length) return <EmptyState>{message ?? "本局还没有可展示的事件。"}</EmptyState>;
  return <ol className="home-activity-list">{events.map((event) => <li key={event.id}><time dateTime={event.at}>{formatEventTime(event.at)}</time><span>{formatEvent(event)}</span></li>)}</ol>;
}

function RecentMatches({ matches, loading, error }: { matches: readonly MatchRecord[]; loading: boolean; error?: string }) {
  if (loading) return <EmptyState>正在读取最近对局…</EmptyState>;
  if (error) return <EmptyState alert>{error}</EmptyState>;
  if (!matches.length) return <EmptyState>还没有已完成的对局记录。</EmptyState>;
  return (
    <ol className="home-recent-match-list">
      {matches.map((match) => (
        <li key={match.id}>
          <time dateTime={match.endedAt}>{formatMatchTime(match.endedAt)}</time>
          <span>{matchModeLabels[match.mode]}</span>
          <strong title={match.deckName ?? "未识别套牌"}>{match.deckName ?? "未识别套牌"}</strong>
          <em className={`match-result-${match.result}`}>{resultLabels[match.result]}</em>
        </li>
      ))}
    </ol>
  );
}

function EmptyState({ alert = false, children }: { alert?: boolean; children: React.ReactNode }) {
  return <p className="home-empty-state" role={alert ? "alert" : "status"}>{children}</p>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function Stat({ label, value }: { label: string; value: string | number }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }

function getModeStats(matches: readonly MatchRecord[]) {
  return modeOrder.map((mode) => ({ mode, count: matches.filter((match) => match.mode === mode).length }));
}

function getBestWinStreak(matches: readonly MatchRecord[]): number {
  const chronological = [...matches].sort((left, right) => Date.parse(left.endedAt) - Date.parse(right.endedAt));
  let current = 0;
  let best = 0;
  for (const match of chronological) {
    current = match.result === "win" ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

function isToday(value: string): boolean {
  const date = new Date(value);
  const today = new Date();
  return !Number.isNaN(date.getTime())
    && date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
}

function formatHistoryWinRate(winRate: number | undefined): string {
  if (winRate === undefined) return "暂无";
  const percentage = winRate >= 0 && winRate <= 1 ? winRate * 100 : winRate;
  return `${percentage.toFixed(1)}%`;
}

function getHistoryState(
  result: MatchHistoryResult | undefined,
  loading: boolean,
  error: string | undefined
): "读取中" | "读取失败" | "暂无" | "ready" {
  if (loading) return "读取中";
  if (error || result?.status === "error") return "读取失败";
  if (!result) return "暂无";
  return "ready";
}

function formatPercentage(value: number, total: number): string {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0%";
}

function formatMatchTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatEventTime(value: string): string {
  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value);
  if (timeOnly) {
    const hour = Number(timeOnly[1]);
    const minute = Number(timeOnly[2]);
    const second = timeOnly[3] === undefined ? 0 : Number(timeOnly[3]);
    if (hour <= 23 && minute <= 59 && second <= 59) {
      return `${String(hour).padStart(2, "0")}:${timeOnly[2]}`;
    }
    return "时间未知";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatNewsDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "官网" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatDataUpdateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
}

function getServiceLabel(state: PublicTrackerState): string {
  if (state.status === "watching") return "服务正常";
  if (state.status === "error") return "服务异常";
  if (state.status === "missing-log") return "等待日志";
  if (state.status === "paused") return "服务已暂停";
  return "服务待启动";
}

function getStatusLabel(state: PublicTrackerState): string {
  if (state.status === "watching") return state.gameActive ? "监听中" : "待开局";
  if (state.status === "paused") return "已暂停";
  if (state.status === "missing-log") return "待修复";
  if (state.status === "error") return "异常";
  return "待启动";
}

function getCurrentModeLabel(state: PublicTrackerState): string {
  if (state.arena && state.arena.status !== "inactive") return "竞技场";
  if (state.constructedScreenMode === "wild") return "狂野模式";
  if (state.constructedScreenMode === "standard") return "标准模式";
  if (state.trackerMode === "arena") return "竞技场";
  if (state.trackerMode === "ladder") return "天梯模式";
  return "模式待识别";
}

function getHeroCopy(state: PublicTrackerState): { title: string; detail: string } {
  if (state.status === "missing-log") return { title: "需要完成日志设置", detail: state.error ?? "修复日志后，完全退出并重新打开炉石，再进入一局。" };
  if (state.status === "error") return { title: "日志读取遇到问题", detail: state.error ?? "检查日志路径后重试。" };
  if (state.status === "paused") return { title: "监听已暂停", detail: "恢复监听后会继续记录真实对局。" };
  if (state.status === "watching" && state.gameActive && state.deckIdentity && state.deckIdentity.status !== "confirmed") {
    return {
      title: "套牌仍在确认中",
      detail: state.deckIdentity && state.deckIdentity.candidateCount > 1
        ? `目前有 ${state.deckIdentity.candidateCount} 套可能，牌库剩余 ?。`
        : "继续对局后会自动确认，牌库剩余 ?。"
    };
  }
  if (state.status === "watching" && state.gameActive) return { title: "对局正在记录", detail: `牌库剩余 ${state.summary.remainingCards} 张，已抽 ${state.summary.drawnCards} 张。` };
  if (state.status === "watching") return { title: "已识别炉石，等待开局", detail: "进入对局后会自动开始记牌。" };
  return { title: "准备记录下一局", detail: "开始监听后，这里会显示真实对局数据。" };
}

function formatEvent(event: DashboardEventView): string {
  if (event.kind === "draw") return event.cardName ? `抽到 ${event.cardName}` : "抽到一张牌";
  if (event.kind === "friendly-play") return event.cardName ? `我方打出 ${event.cardName}` : "我方打出一张牌";
  if (event.kind === "opponent-play") return event.cardName ? `对手打出 ${event.cardName}` : "对手打出一张牌";
  if (event.kind === "arena-pick") return event.cardName ? `竞技场选择 ${event.cardName}` : "竞技场完成一次选择";
  if (event.kind === "game-start") return "对局开始";
  if (event.kind === "game-end") return "对局结束";
  return event.cardName ?? "对局状态已更新";
}
