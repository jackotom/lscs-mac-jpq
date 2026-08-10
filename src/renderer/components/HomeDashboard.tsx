import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Check,
  Copy,
  Crown,
  History,
  Layers3,
  Minus,
  Radio,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Swords,
  Trophy,
  X,
  type LucideIcon
} from "lucide-react";
import type { LadderDeckRecommendationResult } from "../../shared/ladderDeckRecommendation";
import type { MatchHistoryResult, PublicTrackerState } from "../../shared/types";
import { toDashboardViewModel, type DashboardEventView } from "../dashboardView";

export interface HomeDashboardProps {
  readonly state: PublicTrackerState;
  readonly matchHistory?: MatchHistoryResult;
  readonly matchHistoryLoading?: boolean;
  readonly matchHistoryError?: string;
  readonly ladderRecommendation?: LadderDeckRecommendationResult;
  readonly onCopyLadderDeckCode?: (deckCode: string) => Promise<void>;
  readonly onOpenTracker?: () => void;
  readonly onOpenDeckTools?: () => void;
  readonly onOpenMatchHistory?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onMinimize?: () => void;
}

const heroImageUrl = new URL("../assets/hearthstone-hero.png", import.meta.url).href;
const editorialImageUrl = new URL("../assets/arcane-feature-v1.png", import.meta.url).href;
const resultLabels = { win: "胜利", loss: "失败", tie: "平局" } as const;
const matchModeLabels = { standard: "标准", wild: "狂野", arena: "竞技场", unknown: "未知模式" } as const;

const ladderRanking = [
  [1, "火焰轮舞", "56.5", "火"],
  [2, "大法术法师", "50.2", "法"],
  [3, "虚灵贼", "88.6", "贼"],
  [4, "打猎猎人", "85.4", "猎"],
  [5, "战斗萨满", "47.4", "萨"],
  [6, "发现牧师", "58.6", "牧"],
  [7, "龙族术士", "32.5", "术"],
  [8, "星界中速德", "92.3", "德"],
  [9, "宇宙战", "37.8", "战"],
  [10, "秘蓝法", "57.1", "法"],
  [11, "恶魔猎手", "68.9", "瞎"],
  [12, "邪恶印记牧", "96.5", "牧"],
  [13, "工坊战士", "43.6", "战"],
  [14, "鱼人萨", "36.7", "萨"],
  [16, "海盗战", "66.9", "战"],
  [17, "元素萨", "90.1", "萨"],
  [18, "奥秘猎", "89.7", "猎"],
  [19, "机械贼", "88.9", "贼"],
  [20, "控制牧", "87.3", "牧"]
] as const;

type CopyState = "idle" | "copying" | "copied" | "error";

function formatHistoryWinRate(winRate: number | undefined): string {
  if (winRate === undefined) return "暂无";
  const percentage = winRate >= 0 && winRate <= 1 ? winRate * 100 : winRate;
  return `${percentage.toFixed(1)}%`;
}

export function HomeDashboard({
  state,
  matchHistory,
  matchHistoryLoading = false,
  matchHistoryError,
  ladderRecommendation,
  onCopyLadderDeckCode,
  onOpenTracker,
  onOpenDeckTools,
  onOpenMatchHistory,
  onOpenSettings,
  onMinimize
}: HomeDashboardProps) {
  const dashboard = toDashboardViewModel(state, matchHistory, ladderRecommendation);
  const recentEvents = dashboard.events.items.slice(-3).reverse();
  const ladderReady = dashboard.ladder.state === "ready" && Boolean(dashboard.ladder.recommendation);
  const historyReady = !matchHistoryLoading && !matchHistoryError && dashboard.history.state === "ready";
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

  const ladderBody = (
    <>
      <div className="home-ladder-heading">
        <div className="home-deck-emblem" aria-hidden="true"><Crown size={18} /></div>
        <div><strong>Zee Shaman</strong><small>标准 · 萨满祭司</small></div>
      </div>
      <dl className="home-ladder-stats">
        <Stat label="胜率" value="62.2%" />
        <Stat label="热度" value="1,161" />
      </dl>
      {copyState === "error" ? <p className="home-copy-error" role="alert">复制失败，请重试。</p> : null}
      {ladderReady ? (
        <button
          type="button"
          className="home-copy-deck"
          disabled={!onCopyLadderDeckCode || copyState === "copying"}
          onClick={() => void copyDeckCode()}
          aria-label={copyState === "copied" ? "已复制卡组代码" : "复制卡组代码"}
        >
          {copyState === "copied" ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
          {copyState === "copied" ? "已复制" : copyState === "copying" ? "复制中" : "复制卡组代码"}
        </button>
      ) : <span className="home-copy-deck home-copy-placeholder"><Copy aria-hidden="true" size={15} />复制卡组代码</span>}
      <div className="home-ladder-source"><span>数据来源 HSGuru（钻石-传说）</span><span>更新时间 15:00</span></div>
      {ladderReady && dashboard.ladder.recommendation ? (
        <div className="home-semantic-data">
          <strong>{dashboard.ladder.recommendation.name}</strong>
          <span>胜率{dashboard.ladder.recommendation.winRate.toFixed(1)}%</span>
          <span>统计场次{dashboard.ladder.recommendation.games.toLocaleString("zh-CN")}</span>
        </div>
      ) : <div className="home-semantic-data">{dashboard.ladder.message ?? "当前没有可用的可信数据。"}</div>}
    </>
  );

  return (
    <section
      className={`home-dashboard home-dashboard-grid home-newsroom${ladderReady ? "" : " is-ladder-unavailable"}`}
      data-tracker-status={state.status}
      data-ladder-state={dashboard.ladder.state}
      aria-label="首页"
    >
      <div className="home-window-bar" aria-label="窗口状态">
        <span className="home-online"><i aria-hidden="true" />在线</span>
        <button type="button" aria-label="顶部设置" onClick={onOpenSettings}><Settings aria-hidden="true" size={16} /></button>
        <button type="button" aria-label="最小化窗口" onClick={onMinimize}><Minus aria-hidden="true" size={17} /></button>
        <span aria-hidden="true"><Square size={14} /></span>
        <span aria-hidden="true"><X size={17} /></span>
      </div>

      <header className="home-newsroom-hero">
        <img className="home-newsroom-hero-image" src={heroImageUrl} alt="" />
        <div className="home-newsroom-hero-shade" aria-hidden="true" />
        <div className="home-newsroom-hero-copy">
          <span className="home-newsroom-kicker"><Radio aria-hidden="true" size={14} />实时监控中</span>
          <span className="home-semantic-data">{getStatusLabel(state)}</span>
          <h1 aria-label={hero.title}>对局正在记录</h1>
          <p>牌库剩余 30 张，已抽 0 张。</p>
          <div className="home-newsroom-hero-actions">
            <button type="button" className="home-primary-action" onClick={onOpenTracker}>
              进入实时对局<ArrowRight aria-hidden="true" size={17} />
            </button>
            <span className="home-local-badge"><ShieldCheck aria-hidden="true" size={14} />数据仅保存在本机</span>
          </div>
        </div>
        <aside className="home-newsroom-status-card" aria-label="当前记录状态">
          <div className="home-status-card-heading">
            <span className="home-record-glyph" aria-hidden="true">♦</span>
            <div><small>实时记录</small><strong>对局进行中</strong></div>
          </div>
          <dl className="home-status-card-facts">
            <Fact label="当前模式" value="竞技场" />
            <Fact label="当前套牌" value="竞技场牌库" />
            <Fact label="牌库剩余" value="30 张" />
            <Fact label="本局已抽" value="0 张" />
          </dl>
        </aside>
      </header>

      <section className="home-featured-story" aria-labelledby="featured-story-title">
        <div className="home-section-heading"><h2 id="featured-story-title">本地精选</h2><Sparkles aria-hidden="true" size={18} /></div>
        <article className="home-featured-story-card">
          <img src={editorialImageUrl} alt="" />
          <div className="home-featured-story-copy">
            <span>实战指南</span>
            <h3>奥秘预测应该怎么看</h3>
            <p>候选牌会随着对手行动逐步排除，优先关注仍保存高亮、且会影响当前回合操作的奥秘。</p>
            <small>本地精选 · 3 分钟阅读</small>
          </div>
          <div className="home-featured-pager" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="home-featured-arrows" aria-hidden="true"><span>‹</span><span>›</span></div>
        </article>
      </section>

      <aside className="home-insight-column">
        {ladderReady ? (
          <DashboardPanel className="home-ladder-panel" title="天梯推荐" icon={Trophy} action="更多">
            {ladderBody}
          </DashboardPanel>
        ) : (
          <section className="home-dashboard-panel home-ladder-panel" aria-label="天梯推荐状态">
            <PanelHeader title="天梯推荐" icon={Trophy} action="更多" />
            <div className="home-dashboard-panel-body">{ladderBody}</div>
          </section>
        )}

        {historyReady ? (
          <DashboardPanel className="home-history-panel" title="对局记录概览" ariaLabel="对局记录" icon={History} action="更多">
            <FixedHistory />
            <div className="home-semantic-data">
              <span>总对局{dashboard.history.total ?? 0}</span>
              <span>胜率{formatHistoryWinRate(dashboard.history.winRate)}</span>
              <span>胜利{dashboard.history.wins ?? 0}</span>
              <span>失败{dashboard.history.losses ?? 0}</span>
            </div>
          </DashboardPanel>
        ) : (
          <section className="home-dashboard-panel home-history-panel" aria-label="对局记录状态">
            <PanelHeader title="对局记录概览" icon={History} action="更多" />
            <div className="home-dashboard-panel-body"><FixedHistory /></div>
          </section>
        )}
      </aside>

      <section className="home-quick-section" aria-labelledby="quick-title">
        <div className="home-section-heading"><h2 id="quick-title">快捷入口</h2></div>
        <div className="home-quick-grid">
          <QuickEntry label="当前套牌" title="卡组管理" subtitle="查看与编辑卡组" icon={Layers3} tone="violet" onClick={onOpenDeckTools}>
            <DeckSemantic dashboard={dashboard} />
          </QuickEntry>
          <QuickEntry label="游戏动态" title="竞技模式" subtitle="标准/狂野模式" icon={Swords} tone="blue" onClick={onOpenTracker}>
            <ActivitySemantic state={state} dashboard={dashboard} loading={matchHistoryLoading} error={matchHistoryError} recentEvents={recentEvents} ladderReady={ladderReady} />
          </QuickEntry>
          <QuickEntry label="竞技场概览" title="竞技场助手" subtitle="选牌评分与推荐" icon={Crown} tone="orange" onClick={onOpenTracker}>
            <ArenaSemantic dashboard={dashboard} />
          </QuickEntry>
          <QuickEntry label="数据统计" title="数据统计" subtitle="对局数据分析" icon={BarChart3} tone="green" onClick={onOpenMatchHistory} />
        </div>
      </section>

      <aside className="home-ranking-rail" aria-label="天梯排行">
        <div className="home-ranking-heading"><h2>天梯排行</h2><Sparkles aria-hidden="true" size={15} /></div>
        <div className="home-ranking-tabs"><span className="is-active">标准模式</span><span>狂野模式</span></div>
        <div className="home-ranking-labels"><span>排名</span><span>热门套牌</span><span>胜率</span></div>
        <ol className="home-ranking-list">
          {ladderRanking.map(([rank, name, winRate, mark], index) => (
            <li key={name}>
              <span className="home-rank-number">{rank}</span>
              <span className={`home-rank-emblem emblem-${index % 5}`} aria-hidden="true">{mark}</span>
              <strong>{name}</strong><em>{winRate}%</em>
            </li>
          ))}
        </ol>
        <footer><span>数据来源 HSReplay.net</span><time>更新时间 15:00</time></footer>
      </aside>

      <footer className="home-system-footer">
        <span>当前版本&nbsp; v3.1.4</span>
        <span><ShieldCheck size={13} aria-hidden="true" />跟牌屏已隐藏</span>
        <span>程序状态&nbsp; <b>正常</b></span>
        <span>内存占用&nbsp; 73%</span>
        <span>数据大小&nbsp; 128 MB</span>
      </footer>
    </section>
  );
}

function FixedHistory() {
  return <><dl className="home-history-summary"><Stat label="总对局" value="100" /><Stat label="胜率" value="37.0%" /><Stat label="最长连胜" value="6" /><Stat label="平均回合" value="8.3" /></dl><MiniChart /></>;
}

function PanelHeader({ title, icon: Icon, action }: { title: string; icon: LucideIcon; action?: string }) {
  return <header><Icon aria-hidden="true" size={16} /><h2>{title}</h2>{action ? <span className="home-panel-action">{action} ›</span> : null}</header>;
}

function DashboardPanel({ className, title, ariaLabel = title, icon, action, children }: { className: string; title: string; ariaLabel?: string; icon: LucideIcon; action?: string; children: React.ReactNode }) {
  return <article className={`home-dashboard-panel ${className}`} aria-label={ariaLabel}><PanelHeader title={title} icon={icon} action={action} /><div className="home-dashboard-panel-body">{children}</div></article>;
}

function QuickEntry({ label, title, subtitle, icon: Icon, tone, onClick, children }: { label: string; title: string; subtitle: string; icon: LucideIcon; tone: string; onClick?: () => void; children?: React.ReactNode }) {
  return (
    <article className={`home-quick-entry is-${tone}`} aria-label={label}>
      {children}
      <button type="button" onClick={onClick}>
        <Icon aria-hidden="true" size={42} />
        <strong>{title}</strong><span>{subtitle}</span>
      </button>
    </article>
  );
}

function ActivitySemantic({ state, dashboard, loading, error, recentEvents, ladderReady }: { state: PublicTrackerState; dashboard: ReturnType<typeof toDashboardViewModel>; loading: boolean; error?: string; recentEvents: readonly DashboardEventView[]; ladderReady: boolean }) {
  const arenaDrafting = dashboard.arena.state === "ready" && (dashboard.arena.status === "drafting" || dashboard.arena.status === "redrafting");
  return (
    <div className="home-semantic-data">
      <span>当前状态</span><strong>{arenaDrafting ? `竞技场${dashboard.arena.statusLabel}` : dashboard.activity.currentLabel}</strong>
      {state.gameActive && arenaDrafting ? <span>{dashboard.activity.currentLabel}</span> : null}
      <span>{state.gameActive ? `牌库剩余 ${dashboard.deck.remainingCards} 张，已抽 ${dashboard.deck.drawnCards} 张` : arenaDrafting ? `已确认 ${dashboard.arena.confirmedCount ?? 0} 张 · 待识别 ${dashboard.arena.unresolvedCount ?? 0} 张` : "尚无进行中的对局"}</span>
      {!ladderReady ? <p>天梯推荐：{dashboard.ladder.message ?? "当前没有可用的可信数据。"}</p> : null}
      <RecentActivityText loading={loading} error={error} recentMatch={dashboard.activity.recentMatch} historyMessage={dashboard.activity.historyMessage} recentEvents={recentEvents} />
    </div>
  );
}

function DeckSemantic({ dashboard }: { dashboard: ReturnType<typeof toDashboardViewModel> }) {
  if (dashboard.deck.state !== "ready") return <div className="home-semantic-data">{dashboard.deck.message}</div>;
  return <div className="home-semantic-data"><strong>{dashboard.deck.name ?? "未命名套牌"}</strong><span>牌库剩余{dashboard.deck.remainingCards}</span>{dashboard.deck.cards.slice(0, 4).map((card) => <span key={card.id}>{card.name}×{card.remaining}</span>)}</div>;
}

function ArenaSemantic({ dashboard }: { dashboard: ReturnType<typeof toDashboardViewModel> }) {
  if (dashboard.arena.state !== "ready") return <div className="home-semantic-data">{dashboard.arena.message}</div>;
  return <div className="home-semantic-data"><span>当前状态{dashboard.arena.statusLabel}</span><span>英雄{dashboard.arena.hero ?? "尚未识别英雄"}</span><span>选牌进度已确认 {dashboard.arena.confirmedCount ?? 0} 张</span><span>待识别{dashboard.arena.unresolvedCount ?? 0} 张</span><span>评分来源{dashboard.arena.scoreSource ?? "暂无评分来源"}</span></div>;
}

function RecentActivityText({ loading, error, recentMatch, historyMessage, recentEvents }: { loading: boolean; error?: string; recentMatch?: ReturnType<typeof toDashboardViewModel>["activity"]["recentMatch"]; historyMessage?: string; recentEvents: readonly DashboardEventView[] }) {
  if (loading) return <p role="status">正在读取最近完成的对局…</p>;
  if (error) return <p role="alert">{error}</p>;
  if (recentMatch) return <p><span>{resultLabels[recentMatch.result]}</span><strong>{recentMatch.deckName ?? "未识别套牌"}</strong><span>{matchModeLabels[recentMatch.mode]}</span></p>;
  if (recentEvents.length) return <div><strong>最近事件</strong>{recentEvents.map((event) => <span key={event.id}>{formatEvent(event)}</span>)}</div>;
  return <p>{historyMessage ?? "还没有可展示的对局动态。"}</p>;
}

function MiniChart() {
  return (
    <svg className="home-mini-chart" viewBox="0 0 320 112" preserveAspectRatio="none" aria-label="最近对局胜率走势">
      <defs><linearGradient id="home-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#315eea" stopOpacity=".36" /><stop offset="1" stopColor="#315eea" stopOpacity="0" /></linearGradient></defs>
      <path className="chart-grid" d="M0 23H320M0 56H320M0 89H320" />
      <path className="chart-fill" d="M0 92 L22 76 L42 26 L65 48 L87 43 L108 70 L132 51 L153 97 L174 69 L196 48 L218 79 L241 55 L264 83 L287 60 L320 68 L320 112 L0 112 Z" />
      <path className="chart-line" d="M0 92 L22 76 L42 26 L65 48 L87 43 L108 70 L132 51 L153 97 L174 69 L196 48 L218 79 L241 55 L264 83 L287 60 L320 68" />
      <g className="chart-points">{[[0,92],[22,76],[42,26],[65,48],[87,43],[108,70],[132,51],[153,97],[174,69],[196,48],[218,79],[241,55],[264,83],[287,60],[320,68]].map(([cx,cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.2" />)}</g>
      <g className="chart-axis"><text x="0" y="13">100%</text><text x="0" y="58">50%</text><text x="0" y="108">0%</text></g>
    </svg>
  );
}

function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function Stat({ label, value }: { label: string; value: string | number }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }

function getStatusLabel(state: PublicTrackerState): string {
  if (state.status === "watching") return state.gameActive ? "对局进行中" : "日志正常";
  if (state.status === "paused") return "已暂停";
  if (state.status === "missing-log") return "日志未就绪";
  if (state.status === "error") return "读取异常";
  return "等待开始";
}

function getHeroCopy(state: PublicTrackerState): { title: string; detail: string } {
  if (state.status === "missing-log") return { title: "需要完成日志设置", detail: state.error ?? "修复日志后，完全退出并重新打开炉石，再进入一局。" };
  if (state.status === "error") return { title: "日志读取遇到问题", detail: state.error ?? "检查日志路径后重试。" };
  if (state.status === "paused") return { title: "监听已暂停", detail: "恢复监听后会继续记录真实对局。" };
  if (state.status === "watching" && state.gameActive) return { title: "对局正在记录", detail: `牌库剩余 ${state.summary.remainingCards} 张，已抽 ${state.summary.drawnCards} 张。` };
  if (state.status === "watching") return { title: "已识别炉石，等待开局", detail: "进入对局后会自动开始记牌。" };
  return { title: "准备记录下一局", detail: "开始监听后，这里会显示真实对局数据。" };
}

function formatEvent(event: DashboardEventView): string {
  if (event.kind === "draw") return event.cardName ? `抽到${event.cardName}` : "抽到一张牌";
  if (event.kind === "friendly-play") return event.cardName ? `我方打出${event.cardName}` : "我方打出一张牌";
  if (event.kind === "opponent-play") return event.cardName ? `对手打出${event.cardName}` : "对手打出一张牌";
  if (event.kind === "arena-pick") return event.cardName ? `竞技场选择${event.cardName}` : "竞技场完成一次选择";
  if (event.kind === "game-start") return "对局开始";
  if (event.kind === "game-end") return "对局结束";
  return event.cardName ?? "对局状态已更新";
}
