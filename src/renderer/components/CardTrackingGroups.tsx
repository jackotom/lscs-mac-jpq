import {
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import { ChevronDown, ChevronRight, ImageOff } from "lucide-react";
import { cardArtworkSources } from "../../shared/cardDatabase";
import type { PublicCardZone } from "../../shared/types";
import {
  resolveFriendlyDefault,
  resolveOpponentDefault,
  trackingLayoutModeForHeight,
  type SelectionOrigin,
  type TrackingGroupKey,
  type TrackingLayoutMode,
  type TrackingPage,
  type TrackingSelection
} from "../cardTrackingLayout";
import type {
  OverlayCardHistoryView,
  OverlayCardItem,
  OverlaySecretCandidate,
  OverlayCardTrackingView,
  OverlayCardZoneView
} from "../types";
import { CardHoverPreview } from "./CardHoverPreview";

const currentKeys: readonly PublicCardZone[] = [
  "deck",
  "hand",
  "play",
  "secret",
  "graveyard",
  "removed"
];
const historyKeys = ["burned", "used"] as const;
const labels: Record<TrackingGroupKey, string> = {
  deck: "牌库",
  hand: "手牌",
  play: "场上",
  secret: "奥秘",
  graveyard: "墓地",
  removed: "移除",
  burned: "疑似烧毁",
  used: "已使用"
};

export function CardTrackingGroups({
  view,
  opponent = false,
  hideSecret = false,
  unknownDeck
}: {
  readonly view: OverlayCardTrackingView;
  readonly opponent?: boolean;
  readonly hideSecret?: boolean;
  readonly unknownDeck?: {
    readonly label: "待识别" | "识别中" | "不可用";
    readonly emptyLabel: string;
  };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialMode = opponent
    ? "opponent"
    : trackingLayoutModeForHeight(window.innerHeight) ?? "tall";
  const [layoutMode, setLayoutMode] = useState<TrackingLayoutMode>(initialMode);
  const initial = initialSelection(view, initialMode);
  const [page, setPage] = useState<TrackingPage>(initial.page);
  const [expanded, setExpanded] = useState<ReadonlySet<TrackingGroupKey>>(initial.expanded);
  const [origin, setOrigin] = useState<SelectionOrigin>("system");
  const [activeCardId, setActiveCardId] = useState<string>();
  const lastActivatedRef = useRef<TrackingGroupKey>(firstExpanded(initial.expanded, initial.page));
  const previousModeRef = useRef<TrackingLayoutMode>(initialMode);
  const previousGameKeyRef = useRef(view.gameKey);
  const previousSecretCountRef = useRef(view.secretSlots.length);
  const currentCards = currentKeys.flatMap((key) => view.current[key].cards);
  const activeCard = currentCards.find((card) => card.id === activeCardId);

  useEffect(() => {
    if (activeCardId && !activeCard) {
      setActiveCardId(undefined);
    }
  }, [activeCard, activeCardId]);

  useEffect(() => {
    if (opponent || typeof ResizeObserver === "undefined") return;
    const root = rootRef.current;
    if (!root) return;
    const observedElement = root.closest(".overlay-shell") ?? root;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0;
      const nextMode = trackingLayoutModeForHeight(height);
      if (nextMode) setLayoutMode(nextMode);
    });
    observer.observe(observedElement);
    return () => observer.disconnect();
  }, [opponent]);

  useEffect(() => {
    if (previousGameKeyRef.current === view.gameKey) return;
    previousGameKeyRef.current = view.gameKey;
    const secretCount = view.secretSlots.length;
    previousSecretCountRef.current = secretCount;
    const next = secretCount > 0
      ? { page: "current" as const, expanded: new Set<TrackingGroupKey>(["secret"]) }
      : initialSelection(view, layoutMode);
    setPage(next.page);
    setExpanded(next.expanded);
    setOrigin("system");
    lastActivatedRef.current = firstExpanded(next.expanded, next.page);
  }, [layoutMode, view]);

  useEffect(() => {
    const previousMode = previousModeRef.current;
    if (previousMode === layoutMode) return;
    previousModeRef.current = layoutMode;
    if (layoutMode === "short") {
      const preferred = belongsToPage(lastActivatedRef.current, page)
        ? lastActivatedRef.current
        : firstExpanded(expanded, page);
      setExpanded(new Set([preferred]));
      return;
    }
    if (previousMode === "short" && layoutMode === "tall" && origin === "system") {
      setExpanded(resolveFriendlyDefault("tall", page).expanded);
    }
  }, [expanded, layoutMode, origin, page]);

  useEffect(() => {
    const secretCount = view.secretSlots.length;
    const gainedFirstSecret = previousSecretCountRef.current === 0 && secretCount > 0;
    previousSecretCountRef.current = secretCount;
    if (!gainedFirstSecret || origin === "user") return;
    setPage("current");
    setExpanded(new Set(["secret"]));
    lastActivatedRef.current = "secret";
  }, [origin, view.secretSlots.length]);

  useEffect(() => {
    const root = rootRef.current;
    const main = root?.querySelector<HTMLElement>(".card-tracking-main");
    const activeKey = firstExpanded(expanded, page);
    const activeGroup = root?.querySelector<HTMLElement>(`[data-group-key="${activeKey}"]`);
    if (!main || !activeGroup) return;
    main.scrollTop = Math.max(0, activeGroup.offsetTop - main.offsetTop);
  }, [expanded, page]);

  const handlePageChange = (nextPage: TrackingPage) => {
    setOrigin("user");
    if (nextPage === page) return;
    const mode = layoutMode === "opponent" ? "short" : layoutMode;
    const next = resolveFriendlyDefault(mode, nextPage);
    setPage(nextPage);
    setExpanded(next.expanded);
    lastActivatedRef.current = firstExpanded(next.expanded, nextPage);
  };

  const handleGroupToggle = (key: TrackingGroupKey) => {
    setOrigin("user");
    lastActivatedRef.current = key;
    if (layoutMode !== "tall") {
      setExpanded(new Set([key]));
      return;
    }
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const visibleKeys: readonly TrackingGroupKey[] = page === "current"
    ? (hideSecret ? currentKeys.filter((key) => key !== "secret") : currentKeys)
    : historyKeys;

  return (
    <div
      ref={rootRef}
      className="card-tracking-layout"
      data-layout-mode={layoutMode}
      data-tracking-page={page}
    >
      <main className="card-tracking-main" data-scroll-owner="card-tracking-main">
        {visibleKeys.map((key) => (
          <TrackingGroup
            key={key}
            groupKey={key}
            view={view}
            expanded={expanded.has(key)}
            onToggle={() => handleGroupToggle(key)}
            showHistoryArtwork={opponent && key === "used"}
            unknownDeck={unknownDeck}
            activeCard={activeCard}
            onActiveCardChange={(card) => setActiveCardId(card?.id)}
          />
        ))}
      </main>
      <footer className="card-tracking-footer" aria-label="记牌页面">
        <button
          type="button"
          className={page === "current" ? "is-active" : undefined}
          aria-pressed={page === "current"}
          onClick={() => handlePageChange("current")}
        >
          当前
        </button>
        <button
          type="button"
          className={page === "history" ? "is-active" : undefined}
          aria-pressed={page === "history"}
          onClick={() => handlePageChange("history")}
        >
          历史
        </button>
      </footer>
    </div>
  );
}

function TrackingGroup({
  groupKey,
  view,
  expanded,
  onToggle,
  showHistoryArtwork,
  unknownDeck,
  activeCard,
  onActiveCardChange
}: {
  readonly groupKey: TrackingGroupKey;
  readonly view: OverlayCardTrackingView;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly showHistoryArtwork: boolean;
  readonly unknownDeck?: {
    readonly label: "待识别" | "识别中" | "不可用";
    readonly emptyLabel: string;
  };
  readonly activeCard?: OverlayCardItem;
  readonly onActiveCardChange: (card: OverlayCardItem | undefined) => void;
}) {
  const contentId = useId();
  const group = groupKey === "burned" || groupKey === "used"
    ? view[groupKey]
    : view.current[groupKey];
  const deckPresentation = groupKey === "deck" && "status" in group && group.status === "unknown"
    ? unknownDeck
    : undefined;
  const countLabel = deckPresentation?.label ?? group.countLabel;
  return (
    <section
      className="overlay-card-group"
      aria-label={`${labels[groupKey]} ${countLabel}`}
      data-group-key={groupKey}
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="overlay-card-group-toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <span>{labels[groupKey]} <em>({countLabel})</em></span>
        {expanded
          ? <ChevronDown aria-hidden="true" size={13} />
          : <ChevronRight aria-hidden="true" size={13} />}
      </button>
      {expanded ? (
        <div id={contentId} className="overlay-card-group-content">
          {groupKey === "burned" || groupKey === "used"
            ? <HistoryItems
                group={group as OverlayCardHistoryView}
                showArtwork={showHistoryArtwork}
              />
            : <CurrentItems
                group={group as OverlayCardZoneView}
                secretSlots={groupKey === "secret" ? view.secretSlots : []}
                deckInsertions={groupKey === "deck" ? view.deckInsertions : undefined}
                emptyLabel={deckPresentation?.emptyLabel}
                activeCard={activeCard}
                onActiveCardChange={onActiveCardChange}
              />}
        </div>
      ) : null}
    </section>
  );
}

function CurrentItems({
  group,
  secretSlots,
  deckInsertions,
  emptyLabel,
  activeCard,
  onActiveCardChange
}: {
  readonly group: OverlayCardZoneView;
  readonly secretSlots: OverlayCardTrackingView["secretSlots"];
  readonly deckInsertions?: OverlayCardTrackingView["deckInsertions"];
  readonly emptyLabel?: string;
  readonly activeCard?: OverlayCardItem;
  readonly onActiveCardChange: (card: OverlayCardItem | undefined) => void;
}) {
  const undisclosed = group.key === "hand" && group.totalCount !== undefined
    ? Math.max(0, group.totalCount - group.knownCount)
    : 0;
  const hasContent = group.cards.length > 0 ||
    undisclosed > 0 ||
    secretSlots.length > 0 ||
    Boolean(deckInsertions?.groups.length || deckInsertions?.placements.length);
  return (
    <>
      {deckInsertions ? <DeckInsertionSummary tracking={deckInsertions} /> : null}
      <CardRows
        items={group.cards}
        activeCard={activeCard}
        onActiveCardChange={onActiveCardChange}
      />
      {undisclosed > 0 ? <p className="overlay-undisclosed-row">未公开 ×{undisclosed}</p> : null}
      {secretSlots.map((slot, index) => (
        <section key={slot.id} className="opponent-secret-slot" aria-label={`奥秘 ${index + 1} 候选`}>
          <strong className="opponent-secret-slot-label">奥秘 {index + 1}</strong>
          {slot.candidates.length > 0 ? (
            <ul className="opponent-secret-candidates" aria-label={`${slot.label} 候选奥秘`}>
              {slot.candidates.map((candidate) => {
                const status = secretCandidateStatus(candidate);
                return (
                  <li key={candidate.id} className={`secret-candidate-${candidate.status}`}>
                    <CardHoverPreview
                      details={candidate.details}
                      className="opponent-secret-candidate-preview"
                    >
                      <SecretCandidateArtwork candidate={candidate} />
                      <strong>{candidate.name}</strong>
                      <span title={status.title} aria-label={status.accessibleLabel}>{status.label}</span>
                    </CardHoverPreview>
                  </li>
                );
              })}
            </ul>
          ) : <span className="overlay-secret-hidden">候选未显示</span>}
        </section>
      ))}
      {!hasContent ? <p className="overlay-card-group-empty">{emptyLabel ?? "暂无记录"}</p> : null}
    </>
  );
}

type SecretExclusionReason = NonNullable<OverlaySecretCandidate["exclusionReason"]>;

const secretExclusionLabels: Readonly<Record<SecretExclusionReason, {
  readonly label: string;
  readonly description: string;
}>> = {
  "spell-played-without-trigger": {
    label: "法术未触发",
    description: "已排除：我方施放法术后未触发"
  },
  "minion-played-without-trigger": {
    label: "随从未触发",
    description: "已排除：我方打出随从后未触发"
  },
  "hero-attacked-without-trigger": {
    label: "攻击英雄未触发",
    description: "已排除：我方攻击对方英雄后未触发"
  }
};

function secretCandidateStatus(candidate: OverlaySecretCandidate): {
  readonly label: string;
  readonly title?: string;
  readonly accessibleLabel?: string;
} {
  if (candidate.status !== "excluded") {
    return { label: "可能" };
  }

  const reason = candidate.exclusionReason;
  const explanation = typeof reason === "string"
    ? secretExclusionLabels[reason as SecretExclusionReason]
    : undefined;
  if (!explanation) {
    return { label: "已排除", title: "已排除", accessibleLabel: "已排除" };
  }

  return {
    label: explanation.label,
    title: explanation.description,
    accessibleLabel: explanation.description
  };
}

function SecretCandidateArtwork({
  candidate
}: {
  readonly candidate: OverlaySecretCandidate;
}) {
  const sources = cardArtworkSources({
    cardId: candidate.details?.cardId ?? candidate.id,
    cropImageUrl: candidate.details?.cropImageUrl,
    imageUrl: candidate.details?.imageUrl
  }, "image-first");
  const sourcesKey = sources.join("\n");
  const [sourceState, setSourceState] = useState({ key: sourcesKey, index: 0 });
  const sourceIndex = sourceState.key === sourcesKey ? sourceState.index : 0;
  const source = sources[sourceIndex];

  return source ? (
    <img
      className="opponent-secret-candidate-thumb"
      src={source}
      alt={`${candidate.name}卡图`}
      loading="lazy"
      onError={() => setSourceState((current) => ({
        key: sourcesKey,
        index: (current.key === sourcesKey ? current.index : 0) + 1
      }))}
    />
  ) : (
    <span
      aria-label={`${candidate.name}无卡图`}
      className="opponent-secret-candidate-thumb is-empty"
    >
      <ImageOff aria-hidden="true" size={13} />
    </span>
  );
}

function DeckInsertionSummary({
  tracking
}: {
  readonly tracking: NonNullable<OverlayCardTrackingView["deckInsertions"]>;
}) {
  return (
    <>
      {tracking.groups.length > 0 ? (
        <div className="overlay-deck-insertion-groups" aria-label="牌库生成记录">
          {tracking.groups.map((group) => (
            <div className="overlay-deck-insertion-group" key={group.sourceEntityId}>
              <strong title={group.sourceName}>{group.sourceName}</strong>
              <span>{group.remainingCount}张卡牌</span>
            </div>
          ))}
        </div>
      ) : null}
      {tracking.placements.length > 0 ? (
        <div className="overlay-deck-placements" aria-label="牌库位置记录">
          {tracking.placements.map((placement) => (
            <p key={placement.entityId}>
              <span>{placement.position === "top" ? "置顶" : "置底"}：</span>
              <strong>{placement.cardName?.trim() || "未知卡牌"}</strong>
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}

function HistoryItems({
  group,
  showArtwork
}: {
  readonly group: OverlayCardHistoryView;
  readonly showArtwork: boolean;
}) {
  if (group.items.length === 0) {
    return <p className="overlay-card-group-empty">暂无记录</p>;
  }
  return (
    <ul className="overlay-compact-card-list">
      {group.items.map((item) => (
        <li key={item.id}>
          <CardHoverPreview details={item.details} className="overlay-compact-card-row overlay-history-card-row">
            <span className="overlay-card-cost" aria-label="顺序">{item.sequence}</span>
            <span className="overlay-card-art">
              {showArtwork ? <HistoryArtwork item={item} /> : null}
              <strong>{item.hidden ? "未公开记录" : item.displayName}</strong>
            </span>
            {item.turn === undefined ? null : (
              <span className="overlay-history-turn">第{item.turn}回合</span>
            )}
            <span className="overlay-history-confidence">
              {item.confidence === "confirmed" ? "确认" : "推断"}
            </span>
          </CardHoverPreview>
        </li>
      ))}
    </ul>
  );
}

function HistoryArtwork({
  item
}: {
  readonly item: OverlayCardHistoryView["items"][number];
}) {
  const sources = item.hidden
    ? []
    : cardArtworkSources({
        cardId: item.cardId ?? item.details?.cardId,
        cropImageUrl: item.details?.cropImageUrl,
        imageUrl: item.details?.imageUrl
      });
  const sourcesKey = sources.join("\n");
  const [sourceState, setSourceState] = useState({ key: sourcesKey, index: 0 });
  const sourceIndex = sourceState.key === sourcesKey ? sourceState.index : 0;
  const source = sources[sourceIndex];

  useEffect(() => {
    setSourceState((current) => current.key === sourcesKey
      ? current
      : { key: sourcesKey, index: 0 });
  }, [sourcesKey]);

  return source ? (
    <img
      aria-hidden="true"
      className="overlay-card-art-image"
      src={source}
      alt=""
      loading="lazy"
      onError={() => setSourceState((current) => ({
        key: sourcesKey,
        index: (current.key === sourcesKey ? current.index : 0) + 1
      }))}
    />
  ) : null;
}

function CardRows({
  items,
  activeCard,
  onActiveCardChange
}: {
  readonly items: readonly OverlayCardItem[];
  readonly activeCard?: OverlayCardItem;
  readonly onActiveCardChange: (card: OverlayCardItem | undefined) => void;
}) {
  return (
    <ul className="overlay-compact-card-list">
      {items.map((item) => {
        const cost = item.cost ?? item.details?.manaCost;
        const count = item.count ?? 1;
        const isRelated = activeCard ? areCardsRelated(activeCard, item) : false;
        return (
          <li key={item.id}>
            <CardHoverPreview
              details={item.details}
              className={`overlay-compact-card-row${isRelated ? " is-synergy-related" : ""}`}
              isRelated={isRelated}
              onActiveChange={(isActive) => onActiveCardChange(isActive ? item : undefined)}
            >
              <span className="overlay-card-cost" aria-label={`费用 ${cost ?? "?"}`}>
                {cost ?? "?"}
              </span>
              <span className="overlay-card-art">
                {item.thumbnailUrl
                  ? <img className="overlay-card-art-image" src={item.thumbnailUrl} alt="" loading="lazy" />
                  : null}
                <strong title={item.name}>{item.name}</strong>
              </span>
              {count > 1 ? <span className="overlay-card-quantity" aria-label={`数量 ${count}`}>{count}</span> : null}
            </CardHoverPreview>
          </li>
        );
      })}
    </ul>
  );
}

function areCardsRelated(activeCard: OverlayCardItem, candidateCard: OverlayCardItem): boolean {
  const activeDetails = activeCard.details;
  const candidateDetails = candidateCard.details;
  if (!activeDetails || !candidateDetails || activeDetails.dbfId === candidateDetails.dbfId) {
    return false;
  }
  return referencesCard(activeDetails, candidateDetails) || referencesCard(candidateDetails, activeDetails);
}

function referencesCard(
  details: NonNullable<OverlayCardItem["details"]>,
  candidate: NonNullable<OverlayCardItem["details"]>
): boolean {
  return details.relatedCards.some((card) => isSameCard(card, candidate)) ||
    details.synergyCards?.some((card) => isSameCard(card, candidate)) === true;
}

function isSameCard(
  referenced: NonNullable<OverlayCardItem["details"]>["relatedCards"][number],
  candidate: NonNullable<OverlayCardItem["details"]>
): boolean {
  if (referenced.dbfId === candidate.dbfId) {
    return true;
  }
  const referencedCardId = normalizeCardIdentity(referenced.cardId);
  const candidateCardId = normalizeCardIdentity(candidate.cardId);
  return Boolean(referencedCardId && candidateCardId && referencedCardId === candidateCardId);
}

function normalizeCardIdentity(cardId: string | undefined): string | undefined {
  return cardId?.trim().toLocaleUpperCase().replace(/^CORE_/, "");
}

function initialSelection(
  view: OverlayCardTrackingView,
  layoutMode: TrackingLayoutMode
): TrackingSelection {
  if (layoutMode === "opponent") return resolveOpponentDefault(view);
  return resolveFriendlyDefault(layoutMode);
}

function firstExpanded(
  expanded: ReadonlySet<TrackingGroupKey>,
  page: TrackingPage
): TrackingGroupKey {
  return expanded.values().next().value ?? (page === "current" ? "deck" : "burned");
}

function belongsToPage(key: TrackingGroupKey, page: TrackingPage) {
  return page === "current"
    ? key !== "burned" && key !== "used"
    : key === "burned" || key === "used";
}
