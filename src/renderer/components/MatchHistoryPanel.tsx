import type { ReactNode } from "react";
import type { MatchHistoryResult } from "../../shared/types";

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

  const records = [...result.matches].sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt));
  const stats = [
    ["总局数", result.summary.total],
    ["胜", result.summary.wins],
    ["负", result.summary.losses],
    ["平", result.summary.ties],
    ["胜率", formatWinRate(result.summary.winRate)]
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

function formatWinRate(value: number): string {
  return `${((value >= 0 && value <= 1 ? value * 100 : value)).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%`;
}
