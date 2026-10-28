import { CardThumbnail } from "./CardThumbnail";
import { CircleHelp, Flame, Hand, ShieldQuestion, Swords, Timer } from "lucide-react";
import type { OpponentOverview, OpponentPlayedCard } from "../types";
import { CardDetailBody } from "./CardDetailBody";

interface OpponentPanelProps {
  overview: OpponentOverview;
  playedCards: OpponentPlayedCard[];
}

export function OpponentPanel({ overview, playedCards }: OpponentPanelProps) {
  return (
    <aside className="panel opponent-panel" aria-label="对手概览">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">对手</span>
          <h2>{overview.heroClass}</h2>
        </div>
        <div className="panel-icon danger">
          <CircleHelp aria-hidden="true" size={20} />
        </div>
      </div>

      {[
        overview.currentTurn,
        overview.handSize,
        overview.deckRemaining,
        overview.secretsInPlay
      ].some((value) => value !== undefined) ? (
        <div className="overview-grid" aria-label="对手回合概览">
          {overview.currentTurn === undefined ? null : <StatTile icon={Timer} label="当前回合" value={String(overview.currentTurn)} />}
          {overview.handSize === undefined ? null : <StatTile icon={Hand} label="手牌" value={String(overview.handSize)} />}
          {overview.deckRemaining === undefined ? null : <StatTile icon={Swords} label="牌库" value={String(overview.deckRemaining)} />}
          {overview.secretsInPlay === undefined ? null : <StatTile icon={ShieldQuestion} label="奥秘" value={String(overview.secretsInPlay)} />}
        </div>
      ) : null}

      {overview.fatigueDamage === undefined ? null : <div className="fatigue-block">
        <Flame aria-hidden="true" size={18} />
        <span>疲劳伤害</span>
        <strong>{overview.fatigueDamage}</strong>
      </div>}

      <section className="last-action" aria-label="对手最近动作">
        <span>最近动作</span>
        <p>{overview.lastAction}</p>
      </section>

      <section aria-label="对手已出牌">
        <div className="subheading">
          <h3>已出牌</h3>
          <span>{playedCards.reduce((total, card) => total + card.count, 0)} 张</span>
        </div>
        <ul className="played-list">
          {playedCards.length === 0 ? (
            <li className="empty-state" role="status">
              <Swords aria-hidden="true" size={18} />
              <strong>暂无对手出牌</strong>
              <span>识别到对手打牌后会自动记录。</span>
            </li>
          ) : playedCards.map((card) => {
            const displayName = card.hidden ? "身份未公开" : card.name ?? "身份未公开";
            return (
              <li key={card.id}>
                <details className="card-detail-disclosure">
                  <summary className="played-card-row">
                    {card.details?.cropImageUrl || card.details?.imageUrl ? (
                      <CardThumbnail className="card-thumb" card={card.details} />
                    ) : (
                      <span className="mana-cost">{card.cost ?? "—"}</span>
                    )}
                    <div>
                      <strong title={displayName} aria-label={displayName}>{displayName}</strong>
                      {card.turn !== undefined || (card.details?.attack !== undefined && card.details.health !== undefined) ? <small>
                        {card.turn === undefined ? null : `第${card.turn}回合`}
                        {card.details?.attack !== undefined && card.details.health !== undefined
                          ? `${card.turn === undefined ? "" : " · "}${card.details.attack}/${card.details.health}`
                          : ""}
                      </small> : null}
                    </div>
                    <em>x{card.count}</em>
                  </summary>
                  <CardDetailBody details={card.details} mode="interactive" />
                </details>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

interface StatTileProps {
  icon: typeof Timer;
  label: string;
  value: string;
}

function StatTile({ icon: Icon, label, value }: StatTileProps) {
  return (
    <div className="stat-tile">
      <Icon aria-hidden="true" size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
