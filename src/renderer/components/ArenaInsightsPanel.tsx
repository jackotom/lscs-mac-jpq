import { useState, type ReactNode } from "react";
import { parseArenaRuns, type ArenaInsightsResult, type ArenaReward, type ArenaRunRecord } from "../../shared/arenaInsights";

export interface ArenaInsightsPanelProps {
  readonly result?: ArenaInsightsResult;
  readonly loading: boolean;
  readonly error?: string;
  readonly onRefresh?: () => void;
  readonly onRecordRewards?: (runId: string, rewards: readonly ArenaReward[]) => Promise<void> | void;
  readonly onImportRuns?: (runs: readonly ArenaRunRecord[]) => Promise<void> | void;
  readonly onExportRuns?: () => Promise<void> | void;
}

const unavailableMeta = { source: "来源未读取", updatedAt: "更新时间未读取" } as const;

export function ArenaInsightsPanel({ result, loading, error, onRefresh, onRecordRewards, onImportRuns, onExportRuns }: ArenaInsightsPanelProps) {
  const [rewardJson, setRewardJson] = useState("[]");
  const [runsJson, setRunsJson] = useState("[]");
  const [writeError, setWriteError] = useState<string>();
  const [isWriting, setIsWriting] = useState(false);
  const meta = result ? { source: result.source, updatedAt: result.updatedAt } : unavailableMeta;
  const runs = result?.status === "ok" ? result.runs : [];
  const currentRuns = runs.filter((run) => !run.endedAt);
  const historicalRuns = runs.filter((run) => run.endedAt);
  const rewardRunId = currentRuns[0]?.id;

  async function saveRewards() {
    if (!onRecordRewards || !rewardRunId) return;
    try {
      setWriteError(undefined);
      setIsWriting(true);
      await onRecordRewards(rewardRunId, parseRewards(rewardJson));
      setRewardJson("[]");
    } catch (nextError) {
      setWriteError(toMessage(nextError, "竞技场奖励格式无效。"));
    } finally {
      setIsWriting(false);
    }
  }

  async function importRuns() {
    if (!onImportRuns) return;
    try {
      setWriteError(undefined);
      setIsWriting(true);
      await onImportRuns(parseArenaRuns(JSON.parse(runsJson) as unknown));
      setRunsJson("[]");
    } catch (nextError) {
      setWriteError(toMessage(nextError, "竞技场档案格式无效。"));
    } finally {
      setIsWriting(false);
    }
  }

  return (
    <section className="arena-insights-panel" aria-label="竞技场中心">
      <Header meta={meta} onRefresh={onRefresh} disabled={loading} />
      {loading ? <State>正在读取竞技场档案…</State> : error ? <State alert>{error}</State> : result?.status === "error" ? <State alert>{result.error}</State> : !result || runs.length === 0 ? <State>暂无竞技场档案。完成一轮后会自动保存在本机。</State> : (
        <div className="arena-insights-content">
          {result.summary ? <section className="arena-insights-summary" aria-label="个人统计"><span>轮次 <strong>{result.summary.runCount}</strong></span><span>胜负 <strong>{result.summary.totalWins}-{result.summary.totalLosses}</strong></span><span>胜率 <strong>{formatPercent(result.summary.winRate)}</strong></span></section> : null}
          <Section title="当前轮次"><Runs runs={currentRuns} empty="暂无进行中的竞技场轮次。" /></Section>
          <Section title="历史轮次"><Runs runs={historicalRuns} empty="暂无已完成的竞技场轮次。" /></Section>
          <Section title="10 胜套牌">{result.highWinDecks.length ? <Runs runs={result.highWinDecks} /> : <p>暂无本机 10 胜套牌。</p>}</Section>
          <Section title="留牌统计">{result.mulliganStats.length ? <ul className="arena-insights-mulligan">{result.mulliganStats.map((stat) => <li key={stat.cardId ?? stat.cardName}>{stat.cardName} · 留牌 {stat.kept} 次 · 起手后保留 {stat.inHandAfterMulligan} 次 · 胜率 {formatPercent(stat.winRate)}</li>)}</ul> : <p>暂无足够的真实留牌记录。</p>}<p>本机日志未确认时留牌暂无；可导入结构化真实竞技场档案补全。</p></Section>
        </div>
      )}
      <section className="arena-insights-section" aria-label="竞技场档案录入">
        <div className="arena-insights-section-header"><h2>本机录入</h2></div>
        {rewardRunId ? <label>竞技场奖励 JSON<textarea aria-label="竞技场奖励 JSON" value={rewardJson} onChange={(event) => setRewardJson(event.target.value)} /><button type="button" disabled={isWriting || !onRecordRewards} onClick={() => { void saveRewards(); }}>保存竞技场奖励</button></label> : <p>当前没有可录入奖励的进行中轮次。</p>}
        <label>竞技场档案 JSON<textarea aria-label="竞技场档案 JSON" value={runsJson} onChange={(event) => setRunsJson(event.target.value)} /><button type="button" disabled={isWriting || !onImportRuns} onClick={() => { void importRuns(); }}>导入竞技场档案</button></label>
        <button type="button" disabled={isWriting || !onExportRuns} onClick={() => { if (onExportRuns) void onExportRuns(); }}>导出竞技场档案</button>
        {writeError ? <p role="alert">{writeError}</p> : null}
      </section>
    </section>
  );
}

function Header({ meta, onRefresh, disabled }: { meta: { source: string; updatedAt: string }; onRefresh?: () => void; disabled: boolean }) {
  return <header className="arena-insights-header"><div><h1>竞技场中心</h1><div className="arena-insights-meta"><span className="arena-insights-source">{meta.source}</span><span className="arena-insights-updated">{formatTime(meta.updatedAt)}</span></div></div><button type="button" aria-label="刷新竞技场档案" onClick={onRefresh} disabled={disabled || !onRefresh}>刷新</button></header>;
}

function Runs({ runs, empty }: { runs: readonly ArenaRunRecord[]; empty?: string }) {
  return runs.length ? <ul className="arena-insights-runs">{runs.map((run) => <li className="arena-insights-run" key={run.id}><div><h3>{run.hero ?? "英雄未知"} · {run.wins} 胜 {run.losses} 负</h3><p>{run.deck.length ? `套牌：${run.deck.map((card) => `${card.name} ×${card.count}`).join("、")}` : "套牌暂无"}</p><p>{run.rewards.length ? `奖励：${formatRewards(run.rewards)}` : "奖励暂无"}</p></div><strong className="arena-insights-run-score">{run.deckScore === undefined ? "评分暂无" : `评分 ${run.deckScore}`}</strong></li>)}</ul> : (empty ? <p>{empty}</p> : null);
}

function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="arena-insights-section"><div className="arena-insights-section-header"><h2>{title}</h2></div>{children}</section>; }
function State({ alert = false, children }: { alert?: boolean; children: ReactNode }) { return <div className="arena-insights-content"><div className="arena-insights-state" role={alert ? "alert" : "status"}>{children}</div></div>; }

function parseRewards(text: string): ArenaReward[] {
  const value = JSON.parse(text) as unknown;
  if (!Array.isArray(value)) throw new Error("奖励必须是列表");
  return value.map((reward) => {
    const amount = isRecord(reward) && typeof reward.amount === "number" ? reward.amount : undefined;
    if (!isRecord(reward) || !["gold", "dust", "pack", "card", "other"].includes(String(reward.type)) || (reward.amount !== undefined && (amount === undefined || !Number.isSafeInteger(amount) || amount < 0)) || (reward.name !== undefined && typeof reward.name !== "string") || (reward.cardId !== undefined && typeof reward.cardId !== "string")) throw new Error("奖励字段无效");
    return { type: reward.type as ArenaReward["type"], ...(amount === undefined ? {} : { amount }), ...(typeof reward.name === "string" ? { name: reward.name } : {}), ...(typeof reward.cardId === "string" ? { cardId: reward.cardId } : {}) };
  });
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function toMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN"); }
function formatPercent(value: number): string { return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%`; }
function formatRewards(rewards: readonly ArenaReward[]): string { return rewards.map((reward) => reward.name ?? `${reward.type}${reward.amount === undefined ? "" : ` ${reward.amount}`}`).join("、"); }
