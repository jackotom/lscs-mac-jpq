import type { CollectionDeck } from "../shared/types.js";

export interface ScreenTextObservation {
  readonly text: string;
  readonly confidence: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ConstructedDeckScreenInspection {
  readonly mode: "standard" | "wild" | "casual" | undefined;
  readonly selectedName: string | undefined;
  readonly selectedDeck: CollectionDeck | undefined;
}

export function inspectConstructedDeckScreen(
  observations: readonly ScreenTextObservation[],
  decks: readonly CollectionDeck[]
): ConstructedDeckScreenInspection {
  const mode = detectConstructedMode(observations);
  const selectedName = detectSelectedDeckName(observations);
  const matches = mode && selectedName ? findMatchingDecks(selectedName, mode, decks) : [];

  return {
    mode,
    selectedName,
    selectedDeck: matches.length === 1 ? matches[0] : undefined
  };
}

export function findScreenSelectedCollectionDeck(
  observations: readonly ScreenTextObservation[],
  decks: readonly CollectionDeck[]
): CollectionDeck | undefined {
  return inspectConstructedDeckScreen(observations, decks).selectedDeck;
}

function detectConstructedMode(observations: readonly ScreenTextObservation[]): "standard" | "wild" | "casual" | undefined {
  for (const observation of observations) {
    const text = normalizeText(observation.text);
    if (/标准(?:对)?战/.test(text)) {
      return "standard";
    }
    if (/狂野(?:对)?战/.test(text)) {
      return "wild";
    }
    if (/休闲模式/.test(text)) {
      return "casual";
    }
  }
  return undefined;
}

function detectSelectedDeckName(observations: readonly ScreenTextObservation[]): string | undefined {
  const candidates = observations
    .filter((observation) => observation.confidence >= 0.25)
    .filter((observation) => observation.x >= 0.66 && observation.x <= 0.86 && observation.y >= 0.27 && observation.y <= 0.42)
    .map((observation) => observation.text.trim())
    .filter((text) => text.length >= 2)
    .filter((text) => !/^(?:获胜局数|奖励|开始|返回|场对战|再赢得|\d+|\d+\/\d+)/.test(text));

  return candidates.sort((left, right) => right.length - left.length)[0];
}

function deckMatchesMode(deck: CollectionDeck, mode: "standard" | "wild" | "casual") {
  if (mode === "casual") {
    return true;
  }
  const format = normalizeText(deck.format ?? deck.mode ?? "");
  if (mode === "standard") {
    return format.includes("标准") || format.includes("standard");
  }
  return format.includes("狂野") || format.includes("wild");
}

function findMatchingDecks(selectedName: string, mode: "standard" | "wild" | "casual", decks: readonly CollectionDeck[]) {
  const normalizedSelectedName = normalizeText(selectedName);
  const exactAcrossModes = decks.filter((deck) => normalizeText(deck.name ?? "") === normalizedSelectedName);
  if (exactAcrossModes.length === 1) {
    return exactAcrossModes;
  }
  const modeDecks = decks.filter((deck) => deckMatchesMode(deck, mode));
  const exact = modeDecks.filter((deck) => normalizeText(deck.name ?? "") === normalizedSelectedName);
  if (exact.length > 0) {
    return exact;
  }

  const displayAlias = normalizedSelectedName.replace(/^备阵/, "");
  if (displayAlias !== normalizedSelectedName) {
    return modeDecks.filter((deck) => normalizeText(deck.name ?? "") === displayAlias);
  }
  if (normalizedSelectedName.length < 4) {
    return [];
  }

  const maxDistance = normalizedSelectedName.length <= 5 ? 1 : 2;
  let bestDistance = maxDistance + 1;
  let best: CollectionDeck[] = [];
  for (const deck of modeDecks) {
    const distance = boundedLevenshteinDistance(normalizedSelectedName, normalizeText(deck.name ?? ""), maxDistance);
    if (distance === undefined) {
      continue;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [deck];
    } else if (distance === bestDistance) {
      best.push(deck);
    }
  }
  return best;
}

function boundedLevenshteinDistance(left: string, right: string, maxDistance: number): number | undefined {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  if (Math.abs(leftChars.length - rightChars.length) > maxDistance) {
    return undefined;
  }

  let previous = Array.from({ length: rightChars.length + 1 }, (_value, index) => index);
  for (let leftIndex = 0; leftIndex < leftChars.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    let rowMinimum = current[0]!;
    for (let rightIndex = 0; rightIndex < rightChars.length; rightIndex += 1) {
      const substitutionCost = leftChars[leftIndex] === rightChars[rightIndex] ? 0 : 1;
      const next = Math.min(
        previous[rightIndex + 1]! + 1,
        current[rightIndex]! + 1,
        previous[rightIndex]! + substitutionCost
      );
      current.push(next);
      rowMinimum = Math.min(rowMinimum, next);
    }
    if (rowMinimum > maxDistance) {
      return undefined;
    }
    previous = current;
  }

  const distance = previous[rightChars.length]!;
  return distance <= maxDistance ? distance : undefined;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").trim().toLocaleLowerCase();
}
