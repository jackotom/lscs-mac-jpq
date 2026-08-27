import type { CardDetails, CardInfo, RelatedCardInfo } from "./cardDatabase.js";

export interface CardCandidateSelector {
  readonly source: "deck" | "visible";
  readonly cardTypes?: readonly string[];
  readonly manaCost?: { readonly min?: number; readonly max?: number; readonly exact?: number };
  readonly racesAny?: readonly string[];
  readonly mechanicsAll?: readonly string[];
}

const CARD_TYPES = ["随从", "法术", "武器", "英雄", "地标"] as const;
const DECK_ACTION_PATTERN = /从你的牌库(?:中|里)?\s*(?:抽(?:取)?|召唤|检索|发现|置入|获取|获得|复制|选择)[^。；;！!?？\n，,]{0,80}?法力值消耗(?:小于或等于|不高于|大于或等于|不低于|等于|为)\s*\(?\s*(\d+)\s*\)?(?:点)?[^。；;！!?？\n，,]{0,32}?(随从|法术|武器|英雄|地标)/u;

export function inferCardCandidateSelectors(card: CardInfo): readonly CardCandidateSelector[] {
  const text = normalizeCardText(card.text);
  const selector = text
    .split(/[。；;！!?？\n]/u)
    .map(inferDeckCandidateSelector)
    .find((candidate): candidate is CardCandidateSelector => candidate !== undefined);
  return selector ? [selector] : [];
}

export function areCardDetailsRelated(
  active: CardDetails,
  candidate: CardDetails,
  candidateGroup: "deck" | "hand" | "board" | "other"
): boolean {
  if (active.dbfId === candidate.dbfId) {
    return false;
  }

  if (referencesCard(active, candidate) || referencesCard(candidate, active)) {
    return true;
  }

  return active.relationSelectors?.some((selector) => matchesSelector(selector, candidate, candidateGroup)) === true;
}

function normalizeCardText(text: string | undefined): string {
  return (text ?? "")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/[（]/gu, "(")
    .replace(/[）]/gu, ")")
    .replace(/\s+/gu, " ")
    .trim();
}

function inferDeckCandidateSelector(fragment: string): CardCandidateSelector | undefined {
  const match = fragment.match(DECK_ACTION_PATTERN);
  const cardType = CARD_TYPES.find((type) => type === match?.[2]);
  const manaCost = match ? inferManaCost(match[0]) : undefined;
  if (!match || !cardType || !manaCost) return undefined;
  return { source: "deck", cardTypes: [cardType], manaCost };
}

function inferManaCost(text: string): CardCandidateSelector["manaCost"] | undefined {
  const comparison = text.match(/法力值消耗(?:小于或等于|不高于)\s*\(?\s*(\d+)\s*\)?(?:点)?/u);
  if (comparison) return { max: Number(comparison[1]) };
  const minimum = text.match(/法力值消耗(?:大于或等于|不低于)\s*\(?\s*(\d+)\s*\)?(?:点)?/u);
  if (minimum) return { min: Number(minimum[1]) };
  const exact = text.match(/法力值消耗(?:等于|为)\s*\(?\s*(\d+)\s*\)?(?:点)?/u);
  return exact ? { exact: Number(exact[1]) } : undefined;
}

function matchesSelector(
  selector: CardCandidateSelector,
  candidate: CardDetails,
  candidateGroup: "deck" | "hand" | "board" | "other"
): boolean {
  if (selector.source === "deck" ? candidateGroup !== "deck" : candidateGroup === "deck") {
    return false;
  }
  if (selector.cardTypes && (!candidate.cardType || !selector.cardTypes.includes(candidate.cardType))) {
    return false;
  }
  if (selector.manaCost && !matchesManaCost(candidate.manaCost, selector.manaCost)) {
    return false;
  }
  if (selector.racesAny && (!candidate.races || !selector.racesAny.some((race) => candidate.races?.includes(race)))) {
    return false;
  }
  return !selector.mechanicsAll || (candidate.mechanics !== undefined && selector.mechanicsAll.every((mechanic) => candidate.mechanics?.includes(mechanic)));
}

function matchesManaCost(
  candidateCost: number | undefined,
  selector: NonNullable<CardCandidateSelector["manaCost"]>
): boolean {
  return candidateCost !== undefined &&
    (selector.min === undefined || candidateCost >= selector.min) &&
    (selector.max === undefined || candidateCost <= selector.max) &&
    (selector.exact === undefined || candidateCost === selector.exact);
}

function referencesCard(details: CardDetails, candidate: CardDetails): boolean {
  return details.relatedCards.some((card) => isSameCard(card, candidate)) ||
    details.synergyCards?.some((card) => isSameCard(card, candidate)) === true;
}

function isSameCard(referenced: RelatedCardInfo, candidate: CardDetails): boolean {
  if (referenced.dbfId === candidate.dbfId) return true;
  const referencedCardId = normalizeCardIdentity(referenced.cardId);
  const candidateCardId = normalizeCardIdentity(candidate.cardId);
  return Boolean(referencedCardId && candidateCardId && referencedCardId === candidateCardId);
}

function normalizeCardIdentity(cardId: string | undefined): string | undefined {
  return cardId?.trim().toLocaleUpperCase().replace(/^CORE_/, "");
}
