import { useState, type ReactNode } from "react";
import type { MatchHistoryResult } from "../../shared/types";
import { normalizeHeroClass } from "../../shared/cardDatabase";
import { analyzeMatches, filterMatches, type MatchFilters, type MatchGroup } from "../../shared/matchAnalytics";

export interface MatchHistoryPanelProps {
  readonly result?: MatchHistoryResult;
  readonly loading: boolean;
  readonly error?: string;
}

const resultLabels = {
  win: "胜利",
  loss: "失败",
  tie: "平局"
} as const;

const modeLabels = {
  standard: "标准",
  wild: "狂野",
  casual: "休闲",
  arena: "竞技场",
  unknown: "未知模式"
} as const;

export function MatchHistoryPanel({ result, loading, error }: MatchHistoryPanelProps) {
  const [filters, setFilters] = useState<MatchFilters>({});
  if (loading) {
    return <HistoryState>正在读取对局历史…</HistoryState>;
  }

  if (error) {
    return <HistoryState alert>{error}</HistoryState>;
  }

  if (result?.status === "error") {
    return <HistoryState alert>{result.error}</HistoryState>;
  }

  if (!result || result.matches.length === 0) {
    return <HistoryState>还没有已完成的对局记录。完成一局后会自动显示在这里。</HistoryState>;
  }

  const records = filterMatches(result.matches, filters).sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt));
  const analysis = analyzeMatches(records);
  const deckKeys = [...new Set(result.matches.flatMap((match) => match.details?.deckKey ? [match.details.deckKey] : []))].sort();
  const deckLabels = new Map(deckKeys.map((key) => [key, `${result.matches.find((match) => match.details?.deckKey === key)?.deckName ?? "未命名套牌"} · 版本 ${key.slice(0, 12)}`]));
  const opponentClasses = [...new Set(result.matches.flatMap((match) => match.details?.opponentClass ? [match.details.opponentClass] : []))].sort();
  const stats = [
    ["总局数", analysis.summary.total],
    ["胜", analysis.summary.wins],
    ["负", analysis.summary.losses],
    ["平", analysis.summary.ties],
    ["胜率", formatWinRate(analysis.summary.winRate)]
  ] as const;

  return (
    <section className="match-history-panel" aria-label="对局历史">
      <div className="match-history-summary" aria-label="对局汇总">
        {stats.map(([label, value]) => (
          <div className="match-history-stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="match-history-content">
        <div className="match-history-filters" role="group" aria-label="筛选对局">
          <label>对局模式<select value={filters.mode ?? ""} onChange={(event) => setFilters({ ...filters, mode: event.target.value as MatchFilters["mode"] || undefined })}>
            <option value="">全部模式</option>
            {Object.entries(modeLabels).map(([key, label]) => <option key={key} value={key}>{label.endsWith("模式") ? `仅${label}` : `${label}模式`}</option>)}
          </select></label>
          <label>起始日期<input type="date" value={filters.from ?? ""} onChange={(event) => setFilters({ ...filters, from: event.target.value || undefined })} /></label>
          <label>结束日期<input type="date" value={filters.to ?? ""} onChange={(event) => setFilters({ ...filters, to: event.target.value || undefined })} /></label>
          <label>套牌版本<select value={filterValue(filters.deckKey)} onChange={(event) => setFilters({ ...filters, deckKey: parseFilterValue(event.target.value) })}>
            <option value="">全部套牌</option><option value="?">未知版本</option>
            {deckKeys.map((key) => <option key={key} value={`v:${key}`} title={key}>{deckLabels.get(key)}</option>)}
          </select></label>
          <label>对手职业<select value={filterValue(filters.opponentClass)} onChange={(event) => setFilters({ ...filters, opponentClass: parseFilterValue(event.target.value) })}>
            <option value="">全部职业</option><option value="?">未知职业</option>
            {opponentClasses.map((heroClass) => <option key={heroClass} value={`v:${heroClass}`}>{normalizeHeroClass(heroClass)}</option>)}
          </select></label>
          <label>先后手<select value={filterValue(filters.initiative)} onChange={(event) => setFilters({ ...filters, initiative: parseFilterValue(event.target.value) as MatchFilters["initiative"] })}>
            <option value="">全部先后手</option><option value="v:first">仅先手</option><option value="v:second">仅后手</option><option value="?">未知先后手</option>
          </select></label>
          <button type="button" onClick={() => setFilters({})}>重置筛选</button>
        </div>
        <p className="match-history-note">胜率 = 获胜局数 / 全部筛选对局（含平局）。旧记录缺失的资料记为未知。日期按本机时区。</p>
        {filters.from && filters.to && filters.from > filters.to && <p className="match-history-note" role="alert">起始日期晚于结束日期，请调整日期范围。</p>}
        <div className="match-history-averages">
          <span>平均时长：{analysis.duration.value === undefined ? "未知" : `${formatNumber(analysis.duration.value / 60)} 分钟`}（已知 {analysis.duration.samples} / {records.length} 局）</span>
          <span>平均回合：{analysis.turns.value === undefined ? "未知" : formatNumber(analysis.turns.value)}（已知 {analysis.turns.samples} / {records.length} 局）</span>
        </div>
        {records.length === 0 ? <p className="match-history-note" role="status">当前筛选没有对局记录。调整条件后重试。</p> : <>
          <ol className="match-history-list" aria-label="最近对局">
            {records.map((record) => (
              <li className="match-history-row" key={record.id}>
                <span title={modeLabels[record.mode]}>{modeLabels[record.mode]}</span>
                <span title={record.deckName ?? "未识别套牌"}>{record.deckName ?? "未识别套牌"}</span>
                <span className={`match-result-${record.result}`}>{resultLabels[record.result]}</span>
                <time dateTime={record.endedAt}>{formatLocalTime(record.endedAt)}</time>
              </li>
            ))}
          </ol>
          <div className="match-history-analysis">
            <AnalysisTable title="先后手表现" rows={analysis.initiative} label={(key) => key === "first" ? "先手" : key === "second" ? "后手" : "未知"} />
            <AnalysisTable title="对阵职业" rows={analysis.opponents} label={(key) => key ? normalizeHeroClass(key) ?? key : "未知"} />
            <AnalysisTable title="套牌表现" rows={analysis.decks} label={(key) => key ? deckLabels.get(key) ?? key : "未知版本"} />
            <AnalysisTable title="每日趋势" rows={analysis.days} label={(key) => key ?? "未知日期"} />
          </div>
        </>}
      </div>
    </section>
  );
}

function HistoryState({ alert = false, children }: { alert?: boolean; children: ReactNode }) {
  return (
    <section className="match-history-panel" aria-label="对局历史">
      <div className="match-history-state" role={alert ? "alert" : "status"}>{children}</div>
    </section>
  );
}

function formatLocalTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatWinRate(value: number | undefined): string {
  return value === undefined ? "—" : `${formatNumber(value * 100)}%`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function filterValue(value: string | null | undefined): string {
  return value === undefined ? "" : value === null ? "?" : `v:${value}`;
}

function parseFilterValue(value: string): string | null | undefined {
  return value === "" ? undefined : value === "?" ? null : value.slice(2);
}

function AnalysisTable({ title, rows, label }: { title: string; rows: readonly MatchGroup[]; label: (key: string | null) => string }) {
  return <div className="match-analysis-table-wrap">
    <table className="match-analysis-table" aria-label={title}>
      <caption>{title}</caption>
      <thead><tr><th scope="col">分组</th><th scope="col">胜 / 负 / 平</th><th scope="col">获胜 / 对局 · 胜率</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key === null ? "?" : `v:${row.key}`}>
        <th scope="row" title={row.key ?? "未采集"}>{label(row.key)}</th>
        <td>{row.wins} / {row.losses} / {row.ties}</td>
        <td>{row.wins} / {row.total} · {formatWinRate(row.winRate)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
