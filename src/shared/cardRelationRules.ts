import type { CardDetails, CardInfo, RelatedCardInfo } from "./cardDatabase.js";

export interface CardCandidateSelector {
  readonly source: "deck" | "visible";
  readonly cardTypes?: readonly string[];
  readonly manaCost?: { readonly min?: number; readonly max?: number; readonly exact?: number };
  readonly racesAny?: readonly string[];
  readonly mechanicsAll?: readonly string[];
}

const CARD_TYPES = ["随从", "法术", "武器", "英雄", "地标"] as const;

export function inferCardCandidateSelectors(card: CardInfo): readonly CardCandidateSelector[] {
  const text = normalizeCardText(card.text);
  const source = inferSource(text);
  const cardType = CARD_TYPES.find((value) => text.includes(value));
  const manaCost = inferManaCost(text);

  if (!source || !cardType || !manaCost) {
    return [];
  }

  return [{ source, cardTypes: [cardType], manaCost }];
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

function inferSource(text: string): CardCandidateSelector["source"] | undefined {
  if (/(?:从|在)你的牌库(?:中|里)?/u.test(text)) {
    return "deck";
  }
  if (/(?:从|在)你的手牌(?:中|里)?/u.test(text)) {
    return "visible";
  }
  return undefined;
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
