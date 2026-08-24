import { FolderOpen, MonitorUp, Pause, Play, ScrollText, Settings, Swords, Upload } from "lucide-react";
import type { TrackerStatus } from "../types";

export type MainView = "home" | "tracker" | "card-library" | "deck-tools" | "match-history" | "arena-insights" | "collection-insights" | "settings";

interface TopBarProps {
  status: TrackerStatus;
  isTracking: boolean;
  isBusy: boolean;
  onToggleTracking: () => void;
  onChooseLogDirectory: () => void;
  onImportDeck: () => void;
  onEnsureLogConfig: () => void;
  onToggleOverlay: () => void;
  onToggleOpponentOverlay: () => void;
  onMinimize: () => void;
}

export const trackerStatusLabels: Record<TrackerStatus["state"], string> = {
  ready: "待开始",
  tracking: "监听中",
  paused: "已暂停",
  offline: "未连接"
};

export function TopBar({
  status,
  isTracking,
  isBusy,
  onToggleTracking,
  onChooseLogDirectory,
  onImportDeck,
  onEnsureLogConfig,
  onToggleOverlay,
  onToggleOpponentOverlay
}: TopBarProps) {
  return (
    <header className="top-bar" aria-label="记牌器工具栏">
      <section className="brand-block" aria-label="日志状态">
        <div className="brand-mark">
          <ScrollText aria-hidden="true" size={20} />
        </div>
        <div>
          <h1>实时日志</h1>
          <p title={status.logPath}>
            {status.logPath} · {status.watchedFiles} 个文件 · 事件 {status.eventCount.toLocaleString("zh-CN")}
          </p>
        </div>
      </section>

      <section className="status-strip" aria-label="当前读取状态">
        <span className={`status-dot status-${status.state}`} aria-hidden="true" />
        <strong>{status.isLoading ? "正在读取" : trackerStatusLabels[status.state]}</strong>
        <span>同步 {status.lastSyncedAt}</span>
      </section>

      <nav className="top-actions" aria-label="主要操作">
        <button className="primary-action" type="button" onClick={onToggleTracking} disabled={isBusy} aria-busy={isBusy}>
          {isTracking ? <Pause aria-hidden="true" size={17} /> : <Play aria-hidden="true" size={17} />}
          {isBusy ? "处理中" : isTracking ? "暂停" : "开始"}
        </button>
        <button type="button" onClick={onChooseLogDirectory} disabled={isBusy} title="选择日志目录" aria-label="选择日志目录">
          <FolderOpen aria-hidden="true" size={17} />
          选择日志目录
        </button>
        <button
          className={`repair-action${status.state === "offline" ? " is-recommended" : ""}`}
          type="button"
          onClick={onEnsureLogConfig}
          disabled={isBusy}
          title="修复日志"
          aria-label="修复日志"
        >
          <Settings aria-hidden="true" size={17} />
          修复日志
        </button>
        <button type="button" onClick={onToggleOverlay} disabled={isBusy} title="打开记牌小窗" aria-label="打开记牌小窗">
          <MonitorUp aria-hidden="true" size={17} />
          小窗
        </button>
        <button
          className="icon-action"
          type="button"
          onClick={onToggleOpponentOverlay}
          disabled={isBusy}
          title="打开对手出牌小窗"
          aria-label="打开对手出牌小窗"
        >
          <Swords aria-hidden="true" size={17} />
        </button>
        <button type="button" onClick={onImportDeck} disabled={isBusy} title="手动导入卡组" aria-label="手动导入卡组">
          <Upload aria-hidden="true" size={17} />
          手动导入
        </button>
      </nav>
    </header>
  );
}
