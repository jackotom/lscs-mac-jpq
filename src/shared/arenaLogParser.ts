import type { ArenaStatus } from "./types.js";

export type ArenaLogEvent =
  | {
      readonly type: "mode";
      readonly mode: ArenaStatus;
      readonly raw: string;
    }
  | {
      readonly type: "deck-id";
      readonly deckId: string;
      readonly source: "contents" | "redraft";
      readonly raw: string;
    }
  | {
      readonly type: "hero-selected" | "card-picked" | "deck-card";
      readonly cardId?: string;
      readonly cardName?: string;
      readonly raw: string;
    };

export function parseArenaLogLine(line: string): ArenaLogEvent[] {
  if (!line.trim()) {
    return [];
  }

  const modeMatch = line.match(/SetDraftMode\s*-\s*([A-Z_]+)/i);
  if (modeMatch?.[1]) {
    return [{ type: "mode", mode: arenaStatusForMode(modeMatch[1]), raw: line }];
  }

  const redraftDeckIdMatch = line.match(/OnRedraftBegin.*?new redraft deck with ID:\s*(\d+)/i);
  if (redraftDeckIdMatch?.[1]) {
    return [{ type: "deck-id", deckId: redraftDeckIdMatch[1], source: "redraft", raw: line }];
  }

  const heroMatch = line.match(/DraftManager\.OnChosen\(\).*?hero.*?(HERO_[A-Z0-9_]+)/i);
  if (heroMatch?.[1]) {
    return [{ type: "hero-selected", cardId: heroMatch[1], raw: line }];
  }

  const contentsHeroMatch = line.match(/OnChoicesAndContents.*?Hero\s+Card\s*=\s*(HERO_[A-Z0-9_]+)/i);
  if (contentsHeroMatch?.[1]) {
    const deckId = line.match(/Draft Deck ID:\s*(\d+)/i)?.[1];
    return [
      ...(deckId ? [{ type: "deck-id" as const, deckId, source: "contents" as const, raw: line }] : []),
      { type: "hero-selected", cardId: contentsHeroMatch[1], raw: line }
    ];
  }

  if (line.includes("Draft deck contains card")) {
    const reference = extractCardReference(line.split("Draft deck contains card").slice(1).join(" "));
    return reference ? [{ type: "deck-card", ...reference, raw: line }] : [];
  }

  if (line.includes("Client chooses:")) {
    const reference = extractCardReference(line.split("Client chooses:").slice(1).join(" "));
    return reference ? [{ type: "card-picked", ...reference, raw: line }] : [];
  }

  return [];
}

export function selectCurrentArenaLogText(content: string): string {
  const lines = content.split(/\r?\n/);
  const latestModeIndex = lines.map((line, index) => (/SetDraftMode\s*-\s*[A-Z_]+/i.test(line) ? index : -1)).filter((index) => index >= 0).at(-1) ?? -1;
  if (latestModeIndex < 0) {
    return "";
  }

  // The live client writes the draft contents immediately before SetDraftMode.
  // Keep that context so reopening the tracker can restore the hero and selected cards.
  const previousModeIndex = lines
    .slice(0, latestModeIndex)
    .map((line, index) => (/SetDraftMode\s*-\s*[A-Z_]+/i.test(line) ? index : -1))
    .filter((index) => index >= 0)
    .at(-1) ?? -1;
  const latestRestoreIndex = lines
    .slice(0, latestModeIndex + 1)
    .map((line, index) => (/DraftManager\.OnChoicesAndContents/i.test(line) ? index : -1))
    .filter((index) => index >= 0)
    .at(-1) ?? -1;
  if (latestRestoreIndex >= 0 && latestRestoreIndex < latestModeIndex) {
    let restoreStart = latestRestoreIndex;
    while (restoreStart > 0 && /DraftManager\.OnChoicesAndContents/i.test(lines[restoreStart - 1] ?? "")) {
      restoreStart -= 1;
    }
    const previousMode = lines[previousModeIndex] ?? "";
    if (previousModeIndex >= 0 && /SetDraftMode\s*-\s*REDRAFTING\b/i.test(previousMode)) {
      restoreStart = previousModeIndex;
    }
    return lines.slice(restoreStart).join("\n");
  }

  const currentDraftStart = lines
    .slice(previousModeIndex + 1, latestModeIndex + 1)
    .findIndex((line) => /DraftManager\.OnChoicesAndContents/i.test(line));
  const start = currentDraftStart >= 0 ? previousModeIndex + 1 + currentDraftStart : latestModeIndex;
  return start >= 0 ? lines.slice(start).join("\n") : "";
}

function arenaStatusForMode(mode: string): ArenaStatus {
  switch (mode.toUpperCase()) {
    case "DRAFTING":
      return "drafting";
    case "REDRAFTING":
      return "redrafting";
    case "ACTIVE_DRAFT_DECK":
      return "complete";
    case "IN_REWARDS":
      return "playing";
    case "NO_ACTIVE_DRAFT":
    default:
      return "inactive";
  }
}

function extractCardReference(input: string): { cardId?: string; cardName?: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  const bracketMatch = trimmed.match(/\[([^\]]+)\]/);
  const candidate = (bracketMatch?.[1] ?? trimmed)
    .replace(/^(?:Card(?:ID| Id)?|cardId)\s*[:=]\s*/i, "")
    .trim();
  const cardId = candidate.match(/\b[A-Z][A-Z0-9]*_[A-Za-z0-9_]+\b/)?.[0];

  if (cardId) {
    const localizedCardName = candidate.match(new RegExp(`^(.*?)\\s*\\(\\s*${escapeRegExp(cardId)}\\s*\\)\\s*$`, "i"))?.[1];
    const cardName = localizedCardName?.replace(/[\]\[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cardName ? { cardId, cardName } : { cardId };
  }

  const cardName = candidate.replace(/[\]\[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return cardName ? { cardName } : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
