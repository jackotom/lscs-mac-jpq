import { useState, type ReactNode } from "react";
import {
  cardArtworkSources,
  type CardDetails,
  type CardOutcomeNode,
  type RelatedCardInfo
} from "../../shared/cardDatabase";
import type { PublicCardContextDetails } from "../../shared/types";

const CARD_POOL_BATCH_SIZE = 12;

interface CardDetailBodyProps {
  readonly details?: CardDetails & PublicCardContextDetails;
  readonly className?: string;
  readonly mode: "summary" | "interactive";
}

export function CardDetailBody({ details, className, mode }: CardDetailBodyProps) {
  if (!details) {
    return <div className="card-detail-empty">暂无卡牌资料</div>;
  }

  const typeLabel = details.isSpell ? "法术" : details.cardType ?? "卡牌";
  const stats = [
    details.manaCost === undefined ? undefined : `费用 ${details.manaCost}`,
    !details.isSpell && details.attack !== undefined && details.attack > 0 ? `攻击 ${details.attack}` : undefined,
    !details.isSpell && details.health !== undefined && details.health > 0 ? `生命 ${details.health}` : undefined
  ].filter((value): value is string => value !== undefined);
  const spellContext = details;
  const playedSpells = spellContext.playedSpellsThisGame;
  const hasStructuredPlayedSpellContext =
    spellContext.playedSpellsThisGameCount !== undefined ||
    spellContext.playedSpellsThisGameIncomplete !== undefined;
  const hasPlayedSpellContext =
    hasStructuredPlayedSpellContext ||
    playedSpells !== undefined;
  const relatedCards = mergeRelatedCards(details.relatedCards, details.synergyCards ?? []);
  const cardPoolSections = details.cardPoolSections ?? [];
  const cardOutcomeSections = details.cardOutcomeSections ?? [];
  const gameContextSections = hasPlayedSpellContext
    ? (details.gameContextSections ?? []).filter((section) => section.key !== "played-spells")
    : details.gameContextSections ?? [];
  const resurrectionCount = gameContextSections.find(
    (section) => section.key === "kelthuzad-resurrection-count"
  )?.totalCount;
  const displayText = resurrectionCount === undefined
    ? details.text?.replace(/（\s*复活\s*个\s*）/u, "（复活数量未知）")
    : details.text?.replace(/（\s*复活\s*个\s*）/u, `（复活 ${resurrectionCount} 个）`);

  return (
    <div className={`card-detail-body${className ? ` ${className}` : ""}`}>
      <CardDetailArtwork details={details} />
      <div className="card-detail-copy">
        <div className="card-detail-heading">
          <strong title={details.name}>{details.name}</strong>
          <span>{typeLabel}</span>
        </div>
        {stats.length > 0 ? <div className="card-detail-stats">{stats.join(" · ")}</div> : null}
        {details.spellSchool ? <div className="card-detail-meta">法术派系：{details.spellSchool}</div> : null}
        {displayText ? <p className="card-detail-text">{displayText}</p> : null}
      </div>
      {hasPlayedSpellContext ? (
        <PlayedSpellsSection
          cards={playedSpells ?? []}
          incomplete={spellContext.playedSpellsThisGameIncomplete === true}
          totalCount={
            spellContext.playedSpellsThisGameCount ??
            (spellContext.playedSpellsThisGameIncomplete === true ? undefined : playedSpells?.length)
          }
        />
      ) : null}
      {relatedCards.length > 0 || (
        !hasPlayedSpellContext &&
        gameContextSections.length === 0 &&
        cardPoolSections.length === 0 &&
        cardOutcomeSections.length === 0
      ) ? (
        <CardListSection
          cards={relatedCards}
          className="card-detail-related"
          emptyText={details.isSpell ? "暂无生成或关联法术资料" : "暂无关联牌资料"}
          title={details.isSpell ? "生成/关联法术" : "关联牌"}
          showText
        />
      ) : null}
      {cardPoolSections.map((section) => mode === "interactive" ? (
        <CardPoolSection
          cards={section.cards}
          emptyText={section.emptyText}
          key={`${details.cardId ?? details.dbfId}:${section.key}`}
          title={section.title}
        />
      ) : (
        <CardPoolSummarySection
          cards={section.cards}
          emptyText={section.emptyText}
          key={`${details.cardId ?? details.dbfId}:${section.key}`}
          title={section.title}
        />
      ))}
      {cardOutcomeSections.map((section) => (
        <CardOutcomeSection
          cards={section.cards}
          emptyText={section.emptyText}
          key={section.key}
          title={section.title}
        />
      ))}
      {gameContextSections.map((section) => (
        <CardListSection
          cards={section.cards}
          className="card-game-context"
          emptyText={section.emptyText}
          key={section.key}
          title={section.title}
          totalCount={section.totalCount}
        />
      ))}
    </div>
  );
}

function mergeRelatedCards(
  explicitCards: readonly RelatedCardInfo[],
  inferredCards: readonly RelatedCardInfo[]
): readonly RelatedCardInfo[] {
  const cards = [...explicitCards];
  const existingKeys = new Set(explicitCards.map(relatedCardKey));
  for (const card of inferredCards) {
    const key = relatedCardKey(card);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    cards.push(card);
  }
  return cards;
}

function relatedCardKey(card: RelatedCardInfo): string {
  return card.cardId ? `id:${card.cardId.toLocaleLowerCase()}` : `dbf:${card.dbfId}`;
}

function CardDetailArtwork({ details }: { readonly details: CardDetails }) {
  const sources = cardArtworkSources(details, "image-first");
  const sourcesKey = sources.join("\n");
  const [sourceState, setSourceState] = useState({ key: sourcesKey, index: 0 });
  const sourceIndex = sourceState.key === sourcesKey ? sourceState.index : 0;
  const source = sources[sourceIndex];

  return source ? (
    <img
      className="card-detail-image"
      src={source}
      alt={`${details.name} 卡牌图`}
      loading="eager"
      onError={() => setSourceState((current) => ({
        key: sourcesKey,
        index: (current.key === sourcesKey ? current.index : 0) + 1
      }))}
    />
  ) : (
    <div className="card-detail-image card-detail-image-empty">无图片</div>
  );
}

function PlayedSpellsSection({
  cards,
  incomplete,
  totalCount
}: {
  readonly cards: readonly RelatedCardInfo[];
  readonly incomplete: boolean;
  readonly totalCount?: number;
}) {
  const trustedTotal = Number.isInteger(totalCount) && (totalCount ?? -1) >= cards.length
    ? totalCount!
    : undefined;
  const groups = groupPlayedSpellsByCost(cards);
  const title = trustedTotal === undefined
    ? `本局已识别 ${cards.length} 个法术`
    : `本局已施放 ${trustedTotal} 个法术`;
  return (
    <div aria-label={title} className="card-related-list card-spell-history card-game-context played-spells-context" role="region">
      <span>{title}</span>
      {trustedTotal !== undefined && cards.length < trustedTotal ? (
        <small className="played-spells-progress">已识别 {cards.length}/{trustedTotal}</small>
      ) : incomplete && trustedTotal === undefined ? (
        <small className="played-spells-progress">完整数量未知</small>
      ) : null}
      {cards.length === 0 ? (
        <div className="card-spell-history-empty">
          {trustedTotal === 0 ? "本局还没有施放过法术" : "本局还没有识别到法术名单"}
        </div>
      ) : (
        <div className="played-spells-groups">
          {groups.map((group) => (
            <section className="played-spells-cost-group" key={group.key}>
              <strong>{group.label}</strong>
              <div className="card-related-cards" role="list">
                {group.cards.map((card, index) => (
                  <RelatedCardRow
                    card={card}
                    key={`${card.cardId ?? card.dbfId}-${index}`}
                    role="listitem"
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function groupPlayedSpellsByCost(cards: readonly RelatedCardInfo[]) {
  const groups = new Map<number | "unknown", RelatedCardInfo[]>();
  cards.forEach((card) => {
    const key = Number.isInteger(card.manaCost) && (card.manaCost ?? -1) >= 0
      ? card.manaCost!
      : "unknown";
    groups.set(key, [...(groups.get(key) ?? []), card]);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === "unknown") return right === "unknown" ? 0 : 1;
      if (right === "unknown") return -1;
      return left - right;
    })
    .map(([cost, groupedCards]) => ({
      key: String(cost),
      label: cost === "unknown" ? "费用未知" : `${cost}费`,
      cards: groupedCards
    }));
}

function CardPoolSection({
  cards,
  emptyText,
  title
}: {
  readonly cards: readonly RelatedCardInfo[];
  readonly emptyText: string;
  readonly title: string;
}) {
  const [visibleCount, setVisibleCount] = useState(CARD_POOL_BATCH_SIZE);
  const visibleCards = cards.slice(0, visibleCount);
  const remainingCount = cards.length - visibleCards.length;
  const nextBatchCount = Math.min(CARD_POOL_BATCH_SIZE, remainingCount);

  return (
    <details className="card-related-list card-spell-history card-pool-section">
      <summary>{title}（{cards.length}）</summary>
      <div aria-label={`${title}，共 ${cards.length} 张`} role="region">
        {visibleCards.length > 0 ? (
          <div className="card-related-cards" role="list">
            {visibleCards.map((card, index) => (
              <RelatedCardRow
                card={card}
                key={`${card.cardId ?? card.dbfId}-${index}`}
                role="listitem"
                showText
              />
            ))}
          </div>
        ) : (
          <div className="card-spell-history-empty">{emptyText}</div>
        )}
        {remainingCount > 0 ? (
          <button
            className="card-pool-load-more"
            onClick={() => setVisibleCount((current) => current + CARD_POOL_BATCH_SIZE)}
            type="button"
          >
            继续显示 {nextBatchCount} 张（剩余 {remainingCount} 张）
          </button>
        ) : null}
      </div>
    </details>
  );
}

function CardPoolSummarySection({
  cards,
  emptyText,
  title
}: {
  readonly cards: readonly RelatedCardInfo[];
  readonly emptyText: string;
  readonly title: string;
}) {
  const visibleCards = cards.slice(0, CARD_POOL_BATCH_SIZE);
  return (
    <div
      aria-label={`${title}，共 ${cards.length} 张，当前显示 ${visibleCards.length} 张`}
      className="card-related-list card-spell-history card-pool-section card-pool-summary-section"
      role="region"
    >
      <span>{title}（{cards.length}）</span>
      {visibleCards.length > 0 ? (
        <div className="card-related-cards" role="list">
          {visibleCards.map((card, index) => (
            <RelatedCardRow
              card={card}
              key={`${card.cardId ?? card.dbfId}-${index}`}
              role="listitem"
              showText
            />
          ))}
        </div>
      ) : (
        <div className="card-spell-history-empty">{emptyText}</div>
      )}
      {cards.length > visibleCards.length ? (
        <small className="card-pool-summary-note">固定卡牌说明后可查看其余 {cards.length - visibleCards.length} 张</small>
      ) : null}
    </div>
  );
}

function CardListSection({
  cards,
  className,
  emptyText,
  footer,
  title,
  showText = false,
  totalCount = cards.length
}: {
  readonly cards: readonly RelatedCardInfo[];
  readonly className: string;
  readonly emptyText: string;
  readonly footer?: ReactNode;
  readonly title: string;
  readonly showText?: boolean;
  readonly totalCount?: number;
}) {
  return (
    <div
      aria-label={`${title}，共 ${totalCount} 张`}
      className={`card-related-list card-spell-history ${className}`}
      role="region"
    >
      <span>{title}（{totalCount}）</span>
      {cards.length > 0 ? (
        <div className="card-related-cards" role="list">
          {cards.map((card, index) => (
            <RelatedCardRow
              card={card}
              key={`${card.cardId ?? card.dbfId}-${index}`}
              role="listitem"
              showText={showText}
            />
          ))}
        </div>
      ) : (
        <div className="card-spell-history-empty">{emptyText}</div>
      )}
      {footer}
    </div>
  );
}

function CardOutcomeSection({
  cards,
  emptyText,
  title
}: {
  readonly cards: readonly CardOutcomeNode[];
  readonly emptyText: string;
  readonly title: string;
}) {
  return (
    <div
      aria-label={`${title}，共 ${cards.length} 张`}
      className="card-related-list card-spell-history card-outcome-section"
      role="region"
    >
      <span>{title}（{cards.length}）</span>
      {cards.length > 0 ? (
        <div className="card-outcome-tree" role="list">
          {cards.map((node) => <CardOutcomeNodeView key={node.key} node={node} />)}
        </div>
      ) : (
        <div className="card-spell-history-empty">{emptyText}</div>
      )}
    </div>
  );
}

function CardOutcomeNodeView({ node }: { readonly node: CardOutcomeNode }) {
  const children = node.children ?? [];
  const childLabel = `由「${node.card.name}」触发`;

  return (
    <div className="card-outcome-node" role="listitem">
      <RelatedCardRow card={node.card} />
      {children.length > 0 ? (
        <div
          aria-label={`${childLabel}，共 ${children.length} 张`}
          className="card-outcome-children"
          role="group"
        >
          <span>{childLabel}（{children.length}）</span>
          <div className="card-outcome-tree" role="list">
            {children.map((child) => <CardOutcomeNodeView key={child.key} node={child} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RelatedCardRow({
  card,
  role,
  showText = false
}: {
  readonly card: RelatedCardInfo;
  readonly role?: "listitem";
  readonly showText?: boolean;
}) {
  return (
    <div className="card-related-card" role={role}>
      <div className="card-related-art">
        {card.cropImageUrl || card.imageUrl ? (
          <img src={card.cropImageUrl ?? card.imageUrl} alt="" loading="eager" />
        ) : (
          <span aria-label={`${card.name}无卡图`}>无图</span>
        )}
      </div>
      <div>
        <strong title={card.name}>{card.name}</strong>
        <small>
          {card.manaCost === undefined ? "" : `${card.manaCost} 费`}
          {card.cardType ? `${card.manaCost === undefined ? "" : " · "}${card.cardType}` : ""}
        </small>
        {showText && card.text ? <p>{card.text}</p> : null}
      </div>
    </div>
  );
}
