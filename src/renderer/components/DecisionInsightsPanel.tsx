import type { DecisionInsight } from "../../shared/decisionInsights";
import "../decisionInsightsStyles.css";

export function DecisionInsightsPanel({ insight }: { insight?: DecisionInsight }) {
  if (!insight) return null;
  const title = insight.kind === "mulligan" ? "起手留牌参考" : "发现 / 选牌参考";
  const updatedAt = insight.updatedAt ? new Date(insight.updatedAt) : undefined;
  const hasTime = updatedAt && Number.isFinite(updatedAt.getTime());
  return (
    <section className="decision-insights" aria-label={title} aria-busy={insight.status === "loading"}>
      <h2>{title}</h2>
      {insight.status !== "ready" ? (
        <p role="status">{insight.status === "loading" ? "正在读取统计…" : "统计暂不可用"}</p>
      ) : (
        <ul className="decision-insights-options">
          {insight.cards.map((card) => {
            const stats = insight.stats.find((item) => item.cardId === card.cardId);
            const metric = stats?.metric ?? (insight.kind === "mulligan" ? "mulligan" : "discovered");
            const smallSample = stats && (stats.samples < 200 || (metric === "mulligan" && stats.keepSamples !== undefined && stats.keepSamples < 200));
            const label = metric === "mulligan" ? "起手后胜率" : metric === "drawn" ? "抽到后胜率参考" : "发现后胜率";
            const keepHint = metric === "mulligan" && stats && !smallSample && (stats.keepSamples ?? 0) >= 200 && stats.keepRate !== undefined
              ? stats.keepRate >= 60 ? "常见保留" : stats.keepRate <= 40 ? "常见换走" : undefined
              : undefined;
            return (
              <li key={card.entityId} data-entity-id={card.entityId}>
                <strong className="decision-insights-card-name">{card.name || "未知卡牌"}</strong>
                {stats ? (
                  <>
                    <span>{label} <b>{stats.winRate.toFixed(1)}%</b></span>
                    {metric === "mulligan" && stats.keepRate !== undefined ? <span>保留率 <b>{stats.keepRate.toFixed(1)}%</b></span> : null}
                    {metric === "mulligan" && stats.keepSamples !== undefined ? <small>换牌前样本 {stats.keepSamples.toLocaleString("zh-CN")}</small> : null}
                    <span className="decision-insights-sample">样本 {stats.samples.toLocaleString("zh-CN")}{smallSample ? <> · <em>小样本</em></> : null}</span>
                    {keepHint ? <span className="decision-insights-hint">{keepHint}</span> : null}
                    {metric === "drawn" ? <small>按抽到该牌的对局计算，并非发现统计。</small> : null}
                  </>
                ) : <span className="decision-insights-sample">暂无统计</span>}
              </li>
            );
          })}
        </ul>
      )}
      {insight.note ? <p className="decision-insights-note">{insight.note}</p> : null}
      <details className="decision-insights-details">
        <summary>来源与统计口径</summary>
        <p>来源：{insight.source || "来源未提供"}</p>
        {hasTime ? <p>更新：<time dateTime={insight.updatedAt}>{updatedAt.toLocaleString("zh-CN", { hour12: false })}</time></p> : <p>更新时间未提供</p>}
        <p>统计不代表此局最优选择；请结合套牌、对手与当前场面。小样本波动较大。</p>
      </details>
    </section>
  );
}
