import { CardThumbnail } from "./CardThumbnail";
import { AlertTriangle, Library, Sparkles } from "lucide-react";
import type { DeckCard, DeckSummary } from "../types";
import { CardDetailBody } from "./CardDetailBody";

interface DeckLogIssue {
  title: string;
  message: string;
  detail: string;
  actions: readonly string[];
}

interface DeckPanelProps {
  summary: DeckSummary;
  cards: DeckCard[];
  logIssue?: DeckLogIssue;
}

export function DeckPanel({ summary, cards, logIssue }: DeckPanelProps) {
  const remainingPercent = summary.totalCards > 0
    ? Math.min(100, Math.max(0, Math.round((summary.remainingCards / summary.totalCards) * 100)))
    : 0;
  const visibleRemainingCards = cards.reduce((total, card) => total + card.copiesRemaining, 0);
  const remainingCardDifference = summary.remainingCards - visibleRemainingCards;
  const integrityMessage = remainingCardDifference > 0
    ? `还有 ${remainingCardDifference} 张未识别或未显示`
    : remainingCardDifference < 0
      ? `明细比摘要多 ${Math.abs(remainingCardDifference)} 张`
      : undefined;

  return (
    <aside className="panel deck-panel" aria-label="我方牌库">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">我方牌库</span>
          <h2>{summary.deckName}</h2>
        </div>
        <div className="panel-icon">
          <Library aria-hidden="true" size={20} />
        </div>
      </div>

      {logIssue ? (
        <div className="deck-log-issue" role="status">
          <AlertTriangle aria-hidden="true" size={22} />
          <h3>{logIssue.title}</h3>
          <p>{logIssue.message}</p>
          <ol>
            {logIssue.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ol>
          <small>{logIssue.detail}</small>
        </div>
      ) : null}

      <div className="deck-summary" aria-label="牌库剩余统计">
        <strong>{summary.remainingCards}</strong>
        <span>/ {summary.totalCards} 剩余</span>
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${remainingPercent}%` }} />
        </div>
      </div>

      {!logIssue && integrityMessage ? (
        <div className="hint-line is-warning deck-data-integrity-warning" role="status" aria-label="牌库明细不完整">
          <AlertTriangle aria-hidden="true" size={15} />
          {integrityMessage}
        </div>
      ) : null}

      {logIssue ? null : cards.length === 0 ? (
        <div className="empty-state" role="status">
          <Library aria-hidden="true" size={18} />
          <strong>{summary.totalCards > 0 ? "牌库暂时为空" : "等待自动识别卡组"}</strong>
          <span>
            {summary.totalCards > 0 ? "日志同步后会在这里显示剩余卡牌。" : "进入一局后，软件会优先匹配炉石收藏中的套牌。"}
          </span>
        </div>
      ) : (
        <ul className="card-list">
          {cards.map((card) => {
            const isGone = card.copiesRemaining === 0;

            return (
              <li className={isGone ? "is-gone" : ""} key={card.id}>
                <details className="card-detail-disclosure">
                  <summary className="deck-card-row">
                    {card.details?.cropImageUrl || card.details?.imageUrl ? (
                      <CardThumbnail className="card-thumb" card={card.details} />
                    ) : (
                      <span className="mana-cost">{card.cost ?? "—"}</span>
                    )}
                    <div className="card-main">
                      <span title={card.name} aria-label={card.name}>
                        {card.unresolved ? `${card.name} ×${card.copiesRemaining}` : card.name}
                      </span>
                      <small>
                        {card.cardType} · 已抽 {card.drawn}
                        {card.details?.attack !== undefined && card.details.health !== undefined
                          ? ` · ${card.details.attack}/${card.details.health}`
                          : ""}
                      </small>
                    </div>
                    <strong aria-label={`${card.name} 剩余 ${card.copiesRemaining} 张`}>
                      {card.copiesRemaining}/{card.copiesTotal}
                    </strong>
                  </summary>
                  <CardDetailBody details={card.details} mode="interactive" />
                </details>
              </li>
            );
          })}
        </ul>
      )}

      <div className={`hint-line ${logIssue ? "is-warning" : ""}`}>
        <Sparkles aria-hidden="true" size={15} />
        {logIssue ? "Power.log 生效前，卡组区不会展示默认示例数据。" : "这里会按抽牌和发现牌实时更新。"}
      </div>
    </aside>
  );
}
