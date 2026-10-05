import { CardThumbnail } from "./CardThumbnail";
import { Check, Crown, Star } from "lucide-react";
import { getArenaScoreQuality } from "../../shared/arenaRatings";
import type { ArenaCardChoice, ArenaState } from "../../shared/types";
import { ArenaChoiceMetrics } from "./ArenaChoiceMetrics";
import { CardDetailBody } from "./CardDetailBody";

interface ArenaPanelProps {
  state: ArenaState;
}

export function ArenaPanel({ state }: ArenaPanelProps) {
  const latestChoices = state.currentChoices;
  const recommendedChoiceIndex = latestChoices.length === 3 ? findRecommendedChoiceIndex(latestChoices) : -1;
  const latestPick = state.pendingRedraftChoices?.at(-1)
    ? { chosen: state.pendingRedraftChoices.at(-1)! }
    : state.picks[state.picks.length - 1];
  const statusLabel = state.awaitingExactDeck
    ? state.status === "redrafting" ? "重选中" : "等待确认替换"
    : state.status === "drafting" ? "选牌中" : state.status === "redrafting" ? "重选中" : state.status === "playing" ? "对局中" : "牌库已生成";
  const confirmedCount = 30 - state.unresolvedCount;
  const hasUnresolvedCards = state.unresolvedCount > 0;
  const visibleDeck = state.deck.filter((card) => !card.unresolved);
  const pendingRedraftDeck = aggregateChoices(state.pendingRedraftChoices ?? []);
  const pendingRedraftCount = pendingRedraftDeck.reduce((total, card) => total + card.count, 0);
  const sourceLabel = state.error ?? state.scoreSource ?? "评分数据待更新";

  return (
    <aside className="panel arena-panel" aria-label="竞技场选牌评分">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">竞技场</span>
          <h2>{statusLabel}</h2>
        </div>
        <div className="panel-icon arena-icon">
          <Crown aria-hidden="true" size={20} />
        </div>
      </div>

      <div className="arena-progress">
        <strong>{confirmedCount}/30</strong>
        <span>{hasUnresolvedCards ? `已确认 ${confirmedCount}/30` : state.hero?.name ?? "等待职业"}</span>
        <small title={hasUnresolvedCards ? `${state.unresolvedCount} 张待识别 · ${state.hero?.name ?? "等待职业"} · ${sourceLabel}` : sourceLabel}>
          {hasUnresolvedCards ? (
            <>
              <span role="status">{state.unresolvedCount} 张待识别</span>
              {` · ${state.hero?.name ?? "等待职业"} · ${sourceLabel}`}
            </>
          ) : sourceLabel}
        </small>
      </div>

      {latestChoices.length > 0 ? (
        <section className="arena-choices" aria-label="当前候选牌">
          <div className="subheading">
            <h3>当前三选一</h3>
            <span>{latestChoices.length === 3 ? "自动评分" : `已识别 ${latestChoices.length}/3`}</span>
          </div>
          <ul>
            {latestChoices.map((choice, index) => (
              <li key={`${choice.cardId ?? choice.name}-${choice.entityId ?? "choice"}`}>
                <details className="card-detail-disclosure arena-choice-disclosure">
                  <summary className="arena-choice-row">
                    {choice.details?.cropImageUrl || choice.details?.imageUrl ? (
                      <CardThumbnail className="card-thumb" card={choice.details} />
                    ) : null}
                    <div>
                      <strong title={choice.name} aria-label={choice.name}>{choice.name}</strong>
                      <small>{choice.cardId ?? "卡牌编号待解析"}</small>
                      {choice.rating ? <small className="arena-rating-breakdown">{formatRating(choice)}</small> : null}
                    </div>
                    <Score
                      score={choice.score}
                      quality={choice.quality}
                      isRecommended={index === recommendedChoiceIndex}
                    />
                    <ArenaChoiceMetrics choice={choice} />
                  </summary>
                  <CardDetailBody details={choice.details} mode="interactive" />
                </details>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="arena-waiting" role="status">
          <Star aria-hidden="true" size={16} />
          等待下一轮候选牌
        </div>
      )}

      <section className="arena-deck" aria-label="当前竞技场牌库">
        <div className="subheading">
          <h3>当前牌库</h3>
          <span>{confirmedCount} 张</span>
        </div>
        <ul>
          {visibleDeck.map((card) => (
            <li key={card.cardId ?? card.name}>
              {card.details?.cropImageUrl || card.details?.imageUrl ? (
                <CardThumbnail className="card-thumb" card={card.details} />
              ) : null}
              <span title={card.name}>{card.name}</span>
              <strong>x{card.count}</strong>
            </li>
          ))}
          {visibleDeck.length === 0 ? (
            <li className="arena-empty-deck" role="status">
              {hasUnresolvedCards
                ? `暂无可确认卡牌，${state.unresolvedCount} 张牌仍待识别。`
                : "尚未选择牌，完成选牌后会生成竞技场牌库。"}
            </li>
          ) : null}
        </ul>
      </section>

      {pendingRedraftCount > 0 ? (
        <section className="arena-deck arena-pending-deck" aria-label="本轮新选牌">
          <div className="subheading">
            <h3>待确认新牌</h3>
            <span>{pendingRedraftCount} 张</span>
          </div>
          <ul>
            {pendingRedraftDeck.map((card) => (
              <li key={card.cardId ?? card.name}>
                {card.details?.cropImageUrl || card.details?.imageUrl ? (
                  <CardThumbnail className="card-thumb" card={card.details} />
                ) : null}
                <span title={card.name}>{card.name}</span>
                <strong>x{card.count}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {latestPick ? (
        <div className="arena-last-pick">
          <Check aria-hidden="true" size={15} />
          <span title={latestPick.chosen.name}>最近选择：{latestPick.chosen.name}</span>
          <Score score={latestPick.chosen.score} quality={latestPick.chosen.quality} />
        </div>
      ) : null}
    </aside>
  );
}

function aggregateChoices(choices: readonly ArenaCardChoice[]): ArenaCardChoice[] {
  const cards = new Map<string, ArenaCardChoice>();
  for (const choice of choices) {
    const identity = choice.cardId ?? choice.name;
    const current = cards.get(identity);
    cards.set(identity, current ? { ...current, count: current.count + choice.count } : { ...choice });
  }
  return [...cards.values()];
}

function findRecommendedChoiceIndex(choices: readonly ArenaCardChoice[]): number {
  let recommendedIndex = -1;
  let recommendedScore = Number.NEGATIVE_INFINITY;
  choices.forEach((choice, index) => {
    if (choice.score !== undefined && choice.score > recommendedScore) {
      recommendedIndex = index;
      recommendedScore = choice.score;
    }
  });
  return recommendedIndex;
}

function Score({
  score,
  quality,
  isRecommended = false
}: {
  score: number | undefined;
  quality?: ArenaCardChoice["quality"];
  isRecommended?: boolean;
}) {
  const resolvedQuality = quality ?? getArenaScoreQuality(score);
  return (
    <span
      className={`arena-score arena-score-${resolvedQuality.tier}`}
      title={score === undefined ? "暂无评分" : `评分 ${score}，质量：${resolvedQuality.label}`}
    >
      {isRecommended ? <small className="arena-recommendation">首选</small> : null}
      <strong>{score === undefined ? "—" : score}</strong>
      <small>{resolvedQuality.label}</small>
    </span>
  );
}

function formatRating(choice: ArenaCardChoice): string {
  const rating = choice.rating;
  if (!rating) {
    return "";
  }

  const parts = [rating.hearthArena === undefined ? undefined : `HA ${rating.hearthArena}`];
  if (rating.firestone?.includedWinrate !== undefined) {
    const sample =
      rating.firestone.sampleSize === undefined
        ? ""
        : rating.firestone.sampleSize < 2000
          ? ` · 样本偏少 ${formatSampleSize(rating.firestone.sampleSize)}`
          : ` · ${formatSampleSize(rating.firestone.sampleSize)}样本`;
    parts.push(`入选胜率 ${rating.firestone.includedWinrate.toFixed(1)}%${sample}`);
  }
  if (rating.firestone?.playedWinrate !== undefined) {
    parts.push(`出牌 ${rating.firestone.playedWinrate.toFixed(1)}%`);
  }
  if (rating.highWinPickRate !== undefined) {
    const label = rating.highWinThreshold === undefined ? "高胜选取" : `${rating.highWinThreshold}+胜选取`;
    parts.push(`${label} ${rating.highWinPickRate.toFixed(1)}%`);
  }
  if (rating.twelveWinRate !== undefined) {
    parts.push(`实际12胜 ${rating.twelveWinRate.toFixed(1)}%`);
  }
  return parts.filter((part): part is string => part !== undefined).join(" · ");
}

function formatSampleSize(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return Math.round(value).toString();
}
