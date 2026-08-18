import { listCardInfos, normalizeHeroClass, toCardDetails, type CardDatabase } from "./cardDatabase.js";
import type { OpponentSecretSlot, SecretCandidate } from "./types.js";

export type SupportedSecretAction =
  | "friendly-spell"
  | "friendly-minion"
  | "friendly-attack-opponent-hero"
  | "other";

export interface SecretActionObservation {
  readonly kind: SupportedSecretAction;
  readonly canBeCountered?: boolean;
  readonly opponentBoardHasSpace?: boolean;
}

type SecretExclusionReason = NonNullable<SecretCandidate["exclusionReason"]>;

interface SecretNonTriggerRule {
  readonly action: SupportedSecretAction;
  readonly reason: SecretExclusionReason;
  readonly requiresCounterableCard?: boolean;
  readonly requiresOpponentBoardSpace?: boolean;
}

const SUPPORTED_NON_TRIGGER_RULES: Readonly<Record<string, SecretNonTriggerRule>> = {
  EX1_287: {
    action: "friendly-spell",
    reason: "spell-played-without-trigger",
    requiresCounterableCard: true
  },
  DMF_236: {
    action: "friendly-spell",
    reason: "spell-played-without-trigger"
  },
  AV_226: {
    action: "friendly-spell",
    reason: "spell-played-without-trigger"
  },
  KAR_004: {
    action: "friendly-spell",
    reason: "spell-played-without-trigger",
    requiresOpponentBoardSpace: true
  },
  REV_827: {
    action: "friendly-spell",
    reason: "spell-played-without-trigger",
    requiresOpponentBoardSpace: true
  },
  EX1_294: {
    action: "friendly-minion",
    reason: "minion-played-without-trigger",
    requiresOpponentBoardSpace: true
  },
  LOOT_101: {
    action: "friendly-minion",
    reason: "minion-played-without-trigger"
  },
  BT_707: {
    action: "friendly-minion",
    reason: "minion-played-without-trigger",
    requiresOpponentBoardSpace: true
  },
  MAW_006: {
    action: "friendly-minion",
    reason: "minion-played-without-trigger",
    requiresCounterableCard: true
  },
  EX1_289: {
    action: "friendly-attack-opponent-hero",
    reason: "hero-attacked-without-trigger"
  },
  EX1_610: {
    action: "friendly-attack-opponent-hero",
    reason: "hero-attacked-without-trigger"
  },
  EX1_130: {
    action: "friendly-attack-opponent-hero",
    reason: "hero-attacked-without-trigger",
    requiresOpponentBoardSpace: true
  },
  LOOT_079: {
    action: "friendly-attack-opponent-hero",
    reason: "hero-attacked-without-trigger",
    requiresOpponentBoardSpace: true
  }
};

export class SecretTracker {
  private readonly slots = new Map<string, {
    candidates: SecretCandidate[];
    revealedCardId?: string;
    cardClass?: string;
  }>();
  private opponentClass?: string;
  private readonly actions: Array<{
    observation: SecretActionObservation;
    slotIds: ReadonlySet<string>;
    hadSecretActivity: boolean;
  }> = [];

  constructor(private readonly database?: CardDatabase) {}

  setOpponentClass(heroClass?: string) {
    this.opponentClass = normalizeHeroClass(heroClass);
    for (const slot of this.slots.values()) {
      this.rebuildCandidates(slot);
    }
  }

  enterSecret(entityId: string, cardClass?: string) {
    const normalizedClass = normalizeHeroClass(cardClass);
    const slot = this.slots.get(entityId);
    if (!slot) {
      this.slots.set(entityId, {
        candidates: this.buildCandidates(normalizedClass),
        ...(normalizedClass ? { cardClass: normalizedClass } : {})
      });
      return;
    }
    if (normalizedClass && slot.cardClass !== normalizedClass) {
      slot.cardClass = normalizedClass;
      this.rebuildCandidates(slot);
    }
  }

  setSecretClass(entityId: string, cardClass?: string) {
    const slot = this.slots.get(entityId);
    const normalizedClass = normalizeHeroClass(cardClass);
    if (!slot || !normalizedClass || slot.cardClass === normalizedClass) return;
    slot.cardClass = normalizedClass;
    this.rebuildCandidates(slot);
  }

  revealSecret(entityId: string, cardId: string) {
    const slot = this.slots.get(entityId);
    if (!slot) return;
    const knownCard = this.database
      ? listCardInfos(this.database).find((card) =>
          canonicalSecretCardId(card.cardId ?? card.id ?? "") === canonicalSecretCardId(cardId)
        )
      : undefined;
    if (knownCard && !isSecretCard(knownCard)) {
      this.slots.delete(entityId);
      return;
    }
    slot.revealedCardId = cardId;
    this.markSecretActivity(entityId);
  }

  leaveSecret(entityId: string) {
    this.markSecretActivity(entityId);
    this.slots.delete(entityId);
  }

  observeSecretActivity(entityId: string) {
    this.markSecretActivity(entityId);
  }

  beginAction(action: SupportedSecretAction | SecretActionObservation) {
    this.actions.push({
      observation: typeof action === "string" ? { kind: action } : action,
      slotIds: new Set(this.slots.keys()),
      hadSecretActivity: false
    });
  }

  endAction() {
    const frame = this.actions.pop();
    if (!frame || frame.hadSecretActivity) return;
    for (const slotId of frame.slotIds) {
      const slot = this.slots.get(slotId);
      if (!slot) continue;
      slot.candidates = slot.candidates.map((candidate) => {
        const rule = SUPPORTED_NON_TRIGGER_RULES[canonicalSecretCardId(candidate.cardId)];
        if (
          rule?.action !== frame.observation.kind ||
          (rule.requiresCounterableCard && frame.observation.canBeCountered === false) ||
          (rule.requiresOpponentBoardSpace && frame.observation.opponentBoardHasSpace !== true)
        ) {
          return candidate;
        }
        return {
          ...candidate,
          status: "excluded",
          exclusionReason: rule.reason
        };
      });
    }
  }

  reset() {
    this.slots.clear();
    this.actions.length = 0;
    this.opponentClass = undefined;
  }

  getSlots(): OpponentSecretSlot[] {
    return [...this.slots].map(([entityId, slot]) => ({ entityId, candidates: slot.candidates, revealedCardId: slot.revealedCardId }));
  }

  private buildCandidates(cardClass = this.opponentClass): SecretCandidate[] {
    if (!this.database) return [];
    const cardsByCanonicalId = new Map<string, ReturnType<typeof listCardInfos>[number]>();
    for (const card of listCardInfos(this.database)
      .filter((candidate) => candidate.collectible === true && isSecretCard(candidate) && Boolean(candidate.cardId))
      .filter((card) => !cardClass || !card.heroClasses?.length || card.heroClasses.includes(cardClass))
    ) {
      const canonicalId = canonicalSecretCardId(card.cardId!);
      const previous = cardsByCanonicalId.get(canonicalId);
      if (!previous || secretVariantPriority(card.cardId!) < secretVariantPriority(previous.cardId!)) {
        cardsByCanonicalId.set(canonicalId, card);
      }
    }
    return [...cardsByCanonicalId.values()].map((card) => ({
      cardId: card.cardId!,
      name: card.name,
      status: "possible",
      details: toCardDetails(this.database!, card)
    }));
  }

  private rebuildCandidates(slot: {
    candidates: SecretCandidate[];
    cardClass?: string;
  }) {
    const previous = new Map(slot.candidates.map((candidate) => [canonicalSecretCardId(candidate.cardId), candidate]));
    slot.candidates = this.buildCandidates(slot.cardClass).map((candidate) => {
      const prior = previous.get(canonicalSecretCardId(candidate.cardId));
      return prior
        ? {
            ...candidate,
            status: prior.status,
            ...(prior.exclusionReason ? { exclusionReason: prior.exclusionReason } : {})
          }
        : candidate;
    });
  }

  private markSecretActivity(entityId: string) {
    for (const frame of this.actions) {
      if (frame.slotIds.has(entityId)) {
        frame.hadSecretActivity = true;
      }
    }
  }
}

function canonicalSecretCardId(cardId: string): string {
  return cardId.trim().toUpperCase().replace(/^(?:CORE_|VAN_)+/u, "");
}

function secretVariantPriority(cardId: string): number {
  const normalized = cardId.trim().toUpperCase();
  if (normalized.startsWith("CORE_")) return 0;
  if (normalized.startsWith("VAN_")) return 2;
  return 1;
}

function isSecretCard(card: ReturnType<typeof listCardInfos>[number]): boolean {
  return card.mechanics?.includes("SECRET") === true || /奥秘\s*[:：]/u.test(card.text ?? "");
}
