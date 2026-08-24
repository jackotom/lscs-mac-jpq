import { useState, type ReactNode } from "react";
import { parseCollectionSnapshot, parsePackOpeningRecord, type CollectionInsightsResult, type CollectionSnapshot, type CosmeticItem, type PackOpeningRecord } from "../../shared/collectionInsights";

export interface CollectionInsightsPanelProps {
  readonly result?: CollectionInsightsResult;
  readonly loading: boolean;
  readonly error?: string;
  readonly onRefresh?: () => void;
  readonly onImportSnapshot?: (snapshot: CollectionSnapshot) => Promise<void> | void;
  readonly onImportCsv?: (csvText: string) => Promise<void> | void;
  readonly onRecordPack?: (pack: PackOpeningRecord) => Promise<void> | void;
  readonly onUpdateCosmetics?: (cosmetics: { readonly cardBacks?: readonly CosmeticItem[]; readonly heroSkins?: readonly CosmeticItem[]; readonly coins?: readonly CosmeticItem[] }) => Promise<void> | void;
}

const sourceLabels = { log: "日志", import: "导入", manual: "手动录入" } as const;
const unavailableMeta = { source: "来源未读取", updatedAt: "更新时间未读取" } as const;

export function CollectionInsightsPanel({ result, loading, error, onRefresh, onImportSnapshot, onImportCsv, onRecordPack, onUpdateCosmetics }: CollectionInsightsPanelProps) {
  const [snapshotJson, setSnapshotJson] = useState("{}");
  const [packJson, setPackJson] = useState("{}");
  const [cosmeticsJson, setCosmeticsJson] = useState("{}");
  const [writeError, setWriteError] = useState<string>();
  const [isWriting, setIsWriting] = useState(false);
  const meta = result && "source" in result && result.source && result.updatedAt ? { source: sourceLabels[result.source], updatedAt: result.updatedAt } : unavailableMeta;
  const snapshot = result?.status === "ok" ? result : undefined;
  const missingCards = snapshot?.cards.filter((card) => card.normal + card.golden === 0) ?? [];

  async function write<T>(action: () => T | Promise<T>) {
    try { setWriteError(undefined); setIsWriting(true); await action(); }
    catch (nextError) { setWriteError(toMessage(nextError, "录入数据格式无效。")); }
    finally { setIsWriting(false); }
  }

  return (
    <section className="collection-insights-panel" aria-label="收藏中心">
      <Header meta={meta} onRefresh={onRefresh} disabled={loading} />
      {loading ? <State>正在读取收藏记录…</State> : error ? <State alert>{error}</State> : result?.status === "error" ? <State alert>{result.error}</State> : !snapshot || !hasCollectionData(snapshot) ? <State>暂无收藏记录。导入本机数据或记录开包后会显示在这里。</State> : (
        <div className="collection-insights-content">
          <section className="collection-insights-completion" aria-label="完成度"><strong>完成度</strong><span>已记录 {ownedCount(snapshot.cards)} 张 · {snapshot.cards.length} 种卡牌。没有完整总卡表，不能声称账号完整完成度。</span></section>
          <Section title="缺卡列表">{missingCards.length ? <ul className="collection-insights-packs">{missingCards.map((card) => <li key={card.cardId}>{card.name ?? card.cardId}</li>)}</ul> : <p>暂无可确认缺卡；未导入完整卡表时不猜测缺卡。</p>}</Section>
          <Section title="开包历史">{snapshot.packs.length ? <ul className="collection-insights-packs">{snapshot.packs.map((pack) => <li key={pack.id}>{pack.set} · {formatTime(pack.openedAt)} · {pack.cards.length} 张</li>)}</ul> : <p>暂无可确认开包记录。</p>}</Section>
          <Section title="保底进度">{snapshot.pity.length ? <ul className="collection-insights-pity">{snapshot.pity.map((item) => <li className={item.partial ? "collection-insights-pity-partial" : undefined} key={item.set}>{item.set} · 距上张传说 {item.packsSinceLegendary} 包{item.partial ? " · 从本次记录起" : ""}</li>)}</ul> : <p>暂无可确认保底记录。</p>}</Section>
          <Section title="装饰品"><div className="collection-insights-cosmetics"><Cosmetics label="卡背" items={snapshot.cardBacks} /><Cosmetics label="皮肤" items={snapshot.heroSkins} /><Cosmetics label="硬币" items={snapshot.coins} /></div></Section>
        </div>
      )}
      <section className="collection-insights-section" aria-label="收藏本机录入">
        <h2>本机录入</h2>
        <label>收藏快照 JSON / CSV<textarea aria-label="收藏快照 JSON" value={snapshotJson} onChange={(event) => setSnapshotJson(event.target.value)} /><small>以 {"{"} 开头按 JSON 导入；其他内容按 CSV 导入。</small><button type="button" disabled={isWriting || (!onImportSnapshot && !onImportCsv)} onClick={() => { const text = snapshotJson.trim(); if (text.startsWith("{")) { if (onImportSnapshot) void write(() => onImportSnapshot(parseCollectionSnapshot(JSON.parse(text) as unknown))); } else if (onImportCsv) { void write(() => onImportCsv(text)); } else { setWriteError("当前桌面版尚未提供 CSV 收藏导入。"); } }}>导入收藏快照</button></label>
        <label>开包记录 JSON<textarea aria-label="开包记录 JSON" value={packJson} onChange={(event) => setPackJson(event.target.value)} /><button type="button" disabled={isWriting || !onRecordPack} onClick={() => { if (onRecordPack) void write(() => onRecordPack(parsePackOpeningRecord(JSON.parse(packJson) as unknown))); }}>记录开包</button></label>
        <label>装饰品 JSON<textarea aria-label="装饰品 JSON" value={cosmeticsJson} onChange={(event) => setCosmeticsJson(event.target.value)} /><button type="button" disabled={isWriting || !onUpdateCosmetics} onClick={() => { if (onUpdateCosmetics) void write(() => onUpdateCosmetics(parseCosmetics(JSON.parse(cosmeticsJson) as unknown))); }}>更新装饰品</button></label>
        {writeError ? <p role="alert">{writeError}</p> : null}
      </section>
    </section>
  );
}

function Header({ meta, onRefresh, disabled }: { meta: { source: string; updatedAt: string }; onRefresh?: () => void; disabled: boolean }) { return <header className="collection-insights-header"><div><h1>收藏中心</h1><div className="collection-insights-meta"><span className="collection-insights-source">{meta.source}</span><span className="collection-insights-updated">{formatTime(meta.updatedAt)}</span></div></div><button type="button" aria-label="刷新收藏记录" onClick={onRefresh} disabled={disabled || !onRefresh}>刷新</button></header>; }
function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="collection-insights-section"><h2>{title}</h2>{children}</section>; }
function State({ alert = false, children }: { alert?: boolean; children: ReactNode }) { return <div className="collection-insights-content"><div className="collection-insights-state" role={alert ? "alert" : "status"}>{children}</div></div>; }
function Cosmetics({ label, items }: { label: string; items: readonly CosmeticItem[] }) { return <section className="collection-insights-cosmetic"><strong>{label}</strong><p>{items.length ? items.map((item) => item.name).join("、") : "暂无"}</p></section>; }
function hasCollectionData(result: Extract<CollectionInsightsResult, { status: "ok" }>): boolean { return result.cards.length > 0 || result.packs.length > 0 || result.pity.length > 0 || result.cardBacks.length > 0 || result.heroSkins.length > 0 || result.coins.length > 0; }
function ownedCount(cards: readonly { normal: number; golden: number }[]): number { return cards.reduce((total, card) => total + card.normal + card.golden, 0); }
function parseCosmetics(value: unknown): { cardBacks?: CosmeticItem[]; heroSkins?: CosmeticItem[]; coins?: CosmeticItem[] } { if (!isRecord(value)) throw new Error("装饰品必须是对象"); const result: { cardBacks?: CosmeticItem[]; heroSkins?: CosmeticItem[]; coins?: CosmeticItem[] } = {}; for (const key of ["cardBacks", "heroSkins", "coins"] as const) { if (value[key] === undefined) continue; if (!Array.isArray(value[key]) || !value[key].every(isCosmetic)) throw new Error("装饰品字段无效"); result[key] = value[key] as CosmeticItem[]; } return result; }
function isCosmetic(value: unknown): value is CosmeticItem { return isRecord(value) && typeof value.id === "string" && Boolean(value.id.trim()) && typeof value.name === "string" && Boolean(value.name.trim()); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function toMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback; }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN"); }
