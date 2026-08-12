import {
  createCardIdNameLookup,
  listCardInfos,
  normalizeCardId,
  toCardDetails,
  type CardDatabase,
  type CardInfo
} from "./cardDatabase.js";
import { ArenaChoiceParser, type ArenaPowerChoiceEvent } from "./arenaChoiceParser.js";
import { parseArenaLogLine, type ArenaLogEvent } from "./arenaLogParser.js";
import {
  getArenaCardRating,
  getArenaScoreQuality,
  getArenaScoreSourceLabel,
  type ArenaRatingTable
} from "./arenaRatings.js";
import type {
  ArenaCardChoice,
  ArenaHero,
  ArenaPick,
  ArenaState,
  DeckCard
} from "./types.js";

interface CardReference {
  readonly cardId?: string;
  readonly cardName?: string;
  readonly entityId?: string;
}

interface RecognizedCardMatch {
  readonly card: CardInfo;
  readonly confidence: "exact" | "fuzzy";
}

interface PendingFuzzyScreenChoice {
  readonly identity: string;
  readonly observations: number;
}

const ARENA_SCREEN_CARD_TYPES = new Set(["随从", "法术", "武器", "地标"]);

export class ArenaDraftEngine {
  private readonly choiceParser = new ArenaChoiceParser();
  private cardNameByCardId = new Map<string, string>();
  private cardInfoByCardId = new Map<string, CardInfo>();
  private cardInfoByName = new Map<string, CardInfo[]>();
  private cardInfoByOcrName = new Map<string, CardInfo[]>();
  private cardDatabase: CardDatabase | undefined;
  private ratings: ArenaRatingTable | undefined;
  private status: ArenaState["status"] = "inactive";
  private draftDeckId: string | undefined;
  private pendingContentsDeckId: string | undefined;
  private redraftGenerationId: string | undefined;
  private hero: ArenaHero | undefined;
  private currentChoices: ArenaCardChoice[] = [];
  private currentChoiceSource: "log" | "ocr" | undefined;
  private screenChoicesBySlot: Array<ArenaCardChoice | undefined> = [];
  private pendingFuzzyScreenChoices: Array<PendingFuzzyScreenChoice | undefined> = [];
  private picks: ArenaPick[] = [];
  private confirmedDeck: DeckCard[] = [];
  private redraftContentsPicks: ArenaPick[] = [];
  private pendingRedraftChoices: ArenaCardChoice[] = [];
  private redraftSnapshotIncludedChoiceCount = 0;
  private seenRedraftPickEvents = new Set<string>();
  private awaitingExactDeck = false;
  private pendingDraftContents: ArenaLogEvent[] = [];
  private pendingTeamCore: CardReference | undefined;
  private teamBonusCount = 0;
  private acceptingTeamPreview = false;
  private preferArenaLogPicks: boolean;
  private lastPick: { cardId?: string; name: string; source: string } | undefined;
  private lastUpdated: string | undefined;
  private error: string | undefined;

  constructor(options: { cardDatabase?: CardDatabase; ratings?: ArenaRatingTable; preferArenaLogPicks?: boolean } = {}) {
    this.preferArenaLogPicks = options.preferArenaLogPicks ?? false;
    if (options.cardDatabase) {
      this.setCardDatabase(options.cardDatabase);
    }
    if (options.ratings) {
      this.setRatings(options.ratings);
    }
  }

  setPreferArenaLogPicks(value: boolean) {
    this.preferArenaLogPicks = value;
  }

  setCardDatabase(cardDatabase?: CardDatabase) {
    this.cardDatabase = cardDatabase;
    this.cardNameByCardId = cardDatabase ? new Map(createCardIdNameLookup(cardDatabase)) : new Map();
    this.cardInfoByCardId = new Map();
    this.cardInfoByName = new Map();
    this.cardInfoByOcrName = new Map();
    for (const card of cardDatabase ? listCardInfos(cardDatabase) : []) {
      if (card.cardId ?? card.id) {
        this.cardInfoByCardId.set(normalizeCardId(card.cardId ?? card.id!), card);
      }
      const name = normalizeCardName(card.name);
      const matches = this.cardInfoByName.get(name) ?? [];
      matches.push(card);
      this.cardInfoByName.set(name, matches);
      const ocrName = normalizeOcrCardName(card.name);
      const ocrMatches = this.cardInfoByOcrName.get(ocrName) ?? [];
      ocrMatches.push(card);
      this.cardInfoByOcrName.set(ocrName, ocrMatches);
    }
    this.rebuildScores();
  }

  setRatings(ratings?: ArenaRatingTable) {
    this.ratings = ratings;
    if (ratings) {
      this.error = undefined;
    }
    this.rebuildScores();
  }

  setError(error?: string) {
    this.error = error;
    this.touch();
  }

  reset() {
    this.choiceParser.reset();
    this.status = "inactive";
    this.draftDeckId = undefined;
    this.pendingContentsDeckId = undefined;
    this.redraftGenerationId = undefined;
    this.hero = undefined;
    this.clearCurrentChoices();
    this.picks = [];
    this.confirmedDeck = [];
    this.redraftContentsPicks = [];
    this.pendingRedraftChoices = [];
    this.redraftSnapshotIncludedChoiceCount = 0;
    this.seenRedraftPickEvents.clear();
    this.awaitingExactDeck = false;
    this.pendingDraftContents = [];
    this.pendingTeamCore = undefined;
    this.teamBonusCount = 0;
    this.acceptingTeamPreview = false;
    this.lastPick = undefined;
    this.lastUpdated = undefined;
    this.error = undefined;
  }

  applyArenaLine(line: string) {
    for (const event of parseArenaLogLine(line)) {
      this.applyArenaEvent(event);
    }
  }

  applyArenaText(text: string) {
    for (const line of text.split(/\r?\n/)) {
      this.applyArenaLine(line);
    }
  }

  applyPowerLine(line: string) {
    if (!isArenaChoosingStatus(this.status)) {
      return;
    }
    for (const event of this.choiceParser.applyLine(line)) {
      this.applyPowerChoiceEvent(event);
    }
  }

  applyPowerText(text: string) {
    if (!isArenaChoosingStatus(this.status)) {
      this.choiceParser.reset();
      return;
    }
    for (const line of text.split(/\r?\n/)) {
      this.applyPowerLine(line);
    }

    for (const event of this.choiceParser.flush()) {
      this.applyPowerChoiceEvent(event);
    }
  }

  applyScreenChoices(names: readonly string[]) {
    if (!isArenaChoosingStatus(this.status) || names.length !== 3) {
      return false;
    }

    if (this.currentChoiceSource === "log" && this.currentChoices.length > 0) {
      return false;
    }

    const nonEmptyNames = names.filter((name) => normalizeCardName(name));
    if (new Set(nonEmptyNames.map(normalizeCardName)).size !== nonEmptyNames.length) {
      this.pendingFuzzyScreenChoices = [];
      return false;
    }

    names.forEach((name, screenSlot) => {
      const match = name ? this.findCardInfoByRecognizedName(name) : undefined;
      if (!match) {
        this.pendingFuzzyScreenChoices[screenSlot] = undefined;
        return;
      }

      const choice = this.scoreChoice({
        name: match.card.name,
        count: 1,
        screenSlot,
        cardId: match.card.cardId ?? match.card.id
      });
      if (match.confidence === "exact") {
        this.pendingFuzzyScreenChoices[screenSlot] = undefined;
        this.screenChoicesBySlot[screenSlot] = choice;
        return;
      }

      const identity = normalizeCardName(choice.name);
      const pending = this.pendingFuzzyScreenChoices[screenSlot];
      const observations = pending?.identity === identity ? pending.observations + 1 : 1;
      this.pendingFuzzyScreenChoices[screenSlot] = { identity, observations };
      if (observations >= 2) {
        this.screenChoicesBySlot[screenSlot] = choice;
      }
    });

    const choices = this.screenChoicesBySlot.filter((choice): choice is ArenaCardChoice => choice !== undefined);
    if (choices.length < 2) {
      return false;
    }

    const nextSignature = choices.map((choice) => `${choice.screenSlot}:${choice.cardId ?? choice.name}`).join("|");
    const currentSignature = this.currentChoices.map((choice) => `${choice.screenSlot}:${choice.cardId ?? choice.name}`).join("|");
    if (nextSignature === currentSignature) {
      return false;
    }

    this.currentChoices = choices;
    this.currentChoiceSource = "ocr";
    this.touch();
    return true;
  }

  private findCardInfoByRecognizedName(name: string): RecognizedCardMatch | undefined {
    const normalized = normalizeCardName(name);
    const exact = this.findArenaScreenCardInfo(this.cardInfoByName.get(normalized));
    const fuzzyName = normalizeOcrCardName(name);
    const normalizedExact = this.findArenaScreenCardInfo(this.cardInfoByOcrName.get(fuzzyName));
    if (exact || normalizedExact || fuzzyName.length < 3) {
      const card = exact ?? normalizedExact;
      return card ? { card, confidence: "exact" } : undefined;
    }

    const maxDistance = fuzzyName.length <= 5
      ? 1
      : Math.min(5, Math.max(3, Math.floor(fuzzyName.length / 2)));
    let best: { card: CardInfo; distance: number } | undefined;
    let bestDistanceMatches = 0;
    for (const [cardName] of this.cardInfoByName) {
      const distance = boundedLevenshteinDistance(fuzzyName, normalizeOcrCardName(cardName), maxDistance);
      if (distance === undefined) {
        continue;
      }
      const card = this.findArenaScreenCardInfo(this.cardInfoByName.get(cardName));
      if (!card) {
        continue;
      }
      if (!best || distance < best.distance) {
        best = { card, distance };
        bestDistanceMatches = 1;
      } else if (distance === best.distance) {
        bestDistanceMatches += 1;
      }
    }

    return best && bestDistanceMatches === 1
      ? { card: best.card, confidence: "fuzzy" }
      : undefined;
  }

  private findArenaScreenCardInfo(matches: readonly CardInfo[] | undefined): CardInfo | undefined {
    const candidates = matches?.filter((card) => this.isArenaScreenCardCandidate(card));
    return candidates?.find((card) =>
      getArenaCardRating(this.ratings, card.cardId ?? card.id, this.hero?.className) !== undefined
    )
      ?? candidates?.find((card) => card.collectible === true)
      ?? candidates?.[0];
  }

  private isArenaScreenCardCandidate(card: CardInfo): boolean {
    const cardId = (card.cardId ?? card.id ?? "").toUpperCase();
    if (cardId.startsWith("HERO_")) {
      return false;
    }
    if (card.cardType && !ARENA_SCREEN_CARD_TYPES.has(card.cardType)) {
      return false;
    }
    if (getArenaCardRating(this.ratings, card.cardId ?? card.id, this.hero?.className) !== undefined) {
      return true;
    }
    if (card.collectible === true) {
      return true;
    }
    return card.collectible === undefined && card.cardType === undefined;
  }

  private findCardInfoByName(name: string): CardInfo | undefined {
    const matches = this.cardInfoByName.get(normalizeCardName(name));
    return matches?.find((card) => getArenaCardRating(this.ratings, card.cardId ?? card.id, this.hero?.className) !== undefined)
      ?? matches?.find((card) => card.collectible === true)
      ?? matches?.[0];
  }

  markPlaying() {
    if (this.status === "complete") {
      this.status = "playing";
      this.touch();
    }
  }

  applyExactDeck(cards: readonly DeckCard[], deckId?: string) {
    const total = cards.reduce((sum, card) => sum + card.count, 0);
    if (
      total !== 30 ||
      (this.draftDeckId !== undefined && deckId !== this.draftDeckId) ||
      cards.some((card) =>
        card.unresolved ||
        /^Unknown card\s+\d+$/i.test(card.name.trim()) ||
        !card.name.trim() ||
        !Number.isInteger(card.count) ||
        card.count <= 0
      )
    ) {
      return false;
    }

    this.picks = cards.flatMap((card) => Array.from({ length: card.count }, () => {
      const chosen = this.scoreChoice({
        name: card.name,
        count: 1,
        cardId: card.cardId,
        details: card.details
      });
      return {
        slot: 0,
        chosen,
        offered: [],
        at: new Date().toISOString()
      };
    })).map((pick, index) => ({ ...pick, slot: index + 1 }));
    this.confirmedDeck = aggregateDeck(this.picks);
    this.redraftContentsPicks = [];
    this.pendingRedraftChoices = [];
    this.redraftSnapshotIncludedChoiceCount = 0;
    this.seenRedraftPickEvents.clear();
    this.awaitingExactDeck = false;
    this.pendingTeamCore = undefined;
    this.draftDeckId = deckId ?? this.draftDeckId;
    this.teamBonusCount = 0;
    this.acceptingTeamPreview = false;
    this.clearCurrentChoices();
    const last = this.picks.at(-1)?.chosen;
    this.lastPick = last ? { cardId: last.cardId, name: last.name, source: "exact-arena-deck" } : undefined;
    this.touch();
    return true;
  }

  getState(): ArenaState {
    const candidateDeck = aggregateDeck(this.picks);
    const candidateCount = candidateDeck.reduce((total, card) => total + card.count, 0);
    const hasAmbiguousCandidates = candidateCount > 30;
    const confirmedDeckCount = this.confirmedDeck.reduce((total, card) => total + card.count, 0);
    const hasConfirmedDeck = confirmedDeckCount === 30;
    const deck = this.awaitingExactDeck
      ? hasConfirmedDeck ? this.confirmedDeck.map(cloneDeckCard) : []
      : hasAmbiguousCandidates ? [] : candidateDeck;
    const pendingChoicesAfterSnapshot = this.pendingRedraftChoices.slice(this.redraftSnapshotIncludedChoiceCount);
    const pendingRedraftDeck = aggregateDeck(this.pendingRedraftChoices.map((chosen, index) => ({
      slot: index + 1,
      chosen,
      offered: [],
      at: this.lastUpdated ?? new Date(0).toISOString()
    })));
    const snapshotRedraftCandidates = aggregateDeck([
      ...this.redraftContentsPicks,
      ...pendingChoicesAfterSnapshot.map((chosen, index) => ({
        slot: this.redraftContentsPicks.length + index + 1,
        chosen,
        offered: [],
        at: this.lastUpdated ?? new Date(0).toISOString()
      }))
    ]);
    const redraftCandidates = hasConfirmedDeck
      ? mergeDeckCards([...this.confirmedDeck, ...pendingRedraftDeck])
      : snapshotRedraftCandidates;
    const snapshotRedraftCandidateCount = snapshotRedraftCandidates.reduce(
      (total, card) => total + card.count,
      0
    );
    const redraftTrackerDeck = this.awaitingExactDeck
      ? snapshotRedraftCandidateCount > 0 && snapshotRedraftCandidateCount <= 30
        ? snapshotRedraftCandidates
        : pendingRedraftDeck
      : undefined;
    const confirmedCardCount = deck.reduce((total, card) => total + card.count, 0);
    const draftCount = this.awaitingExactDeck
      ? hasConfirmedDeck ? 30 : Math.min(30, this.redraftContentsPicks.length + pendingChoicesAfterSnapshot.length)
      : Math.min(30, this.picks.length + this.teamBonusCount);
    return {
      status: this.status,
      deckId: this.draftDeckId,
      redraftGenerationId: this.redraftGenerationId,
      hero: this.hero,
      currentChoices: this.currentChoices.map((choice) => ({ ...choice })),
      picks: this.picks.map((pick) => ({
        ...pick,
        chosen: { ...pick.chosen },
        offered: pick.offered.map((choice) => ({ ...choice }))
      })),
      deck,
      redraftPool: this.awaitingExactDeck && redraftCandidates.length > 0
        ? redraftCandidates
        : this.status === "redrafting" && hasAmbiguousCandidates ? candidateDeck : undefined,
      redraftTrackerDeck: redraftTrackerDeck?.length
        ? redraftTrackerDeck.map(cloneDeckCard)
        : undefined,
      awaitingExactDeck: this.awaitingExactDeck,
      pendingRedraftChoices: this.pendingRedraftChoices.map((choice) => ({ ...choice })),
      draftCount,
      unresolvedCount: this.status === "inactive" ? 0 : Math.max(0, 30 - confirmedCardCount),
      scoreSource: getArenaScoreSourceLabel(this.ratings),
      ratingsVersion: this.ratings?.version,
      lastUpdated: this.lastUpdated,
      error: this.error
    };
  }

  private applyArenaEvent(event: ArenaLogEvent) {
    if (event.type === "deck-id") {
      if (event.source === "redraft") {
        this.redraftGenerationId = event.deckId;
      } else {
        this.pendingContentsDeckId = event.deckId;
      }
      this.touch();
      return;
    }

    if (isDraftContentsRestoreEvent(event)) {
      this.pendingDraftContents.push(event);
      return;
    }

    if (event.type !== "mode" && this.pendingDraftContents.length > 0) {
      const status = this.status;
      this.restorePendingDraftContents();
      this.status = status;
    }

    if (event.type === "mode") {
      if (event.mode === "drafting") {
        const pendingDraftContents = this.pendingDraftContents;
        const pendingContentsDeckId = this.pendingContentsDeckId;
        this.pendingDraftContents = [];
        if (this.status !== "drafting" || pendingDraftContents.length > 0) {
          this.resetDraft();
        }
        this.draftDeckId = pendingContentsDeckId ?? this.draftDeckId;
        this.pendingContentsDeckId = undefined;
        this.status = "drafting";
        this.restoreDraftContents(pendingDraftContents);
      } else if (event.mode === "redrafting") {
        if (!this.awaitingExactDeck) {
          const currentDeck = aggregateDeck(this.picks);
          if (
            this.confirmedDeck.reduce((total, card) => total + card.count, 0) !== 30 &&
            currentDeck.reduce((total, card) => total + card.count, 0) === 30
          ) {
            this.confirmedDeck = currentDeck.map(cloneDeckCard);
          }
          this.redraftContentsPicks = [];
          this.pendingRedraftChoices = [];
          this.redraftSnapshotIncludedChoiceCount = 0;
          this.seenRedraftPickEvents.clear();
          this.awaitingExactDeck = true;
        }
        this.status = "redrafting";
        this.restorePendingDraftContents();
        this.clearCurrentChoices();
      } else if (event.mode === "complete") {
        this.restorePendingDraftContents();
        this.status = "complete";
        this.clearCurrentChoices();
      } else if (event.mode === "playing") {
        this.restorePendingDraftContents();
        this.status = "playing";
        this.clearCurrentChoices();
      } else {
        this.pendingDraftContents = [];
        this.pendingContentsDeckId = undefined;
        this.status = "inactive";
        this.draftDeckId = undefined;
        this.redraftGenerationId = undefined;
        this.hero = undefined;
        this.clearCurrentChoices();
        this.picks = [];
        this.confirmedDeck = [];
        this.redraftContentsPicks = [];
        this.pendingRedraftChoices = [];
        this.redraftSnapshotIncludedChoiceCount = 0;
        this.seenRedraftPickEvents.clear();
        this.awaitingExactDeck = false;
        this.pendingTeamCore = undefined;
        this.teamBonusCount = 0;
        this.acceptingTeamPreview = false;
        this.lastPick = undefined;
      }
      this.touch();
      return;
    }

    if (!isArenaChoosingStatus(this.status)) {
      return;
    }

    if (event.type === "hero-selected") {
      this.hero = this.toHero(event);
      this.rebuildScores();
      this.touch();
      return;
    }

    const reference: CardReference = {
      cardId: event.cardId,
      cardName: event.cardName
    };

    if (event.type === "card-picked" && this.awaitingExactDeck) {
      const eventKey = event.raw.trim();
      if (this.seenRedraftPickEvents.has(eventKey)) {
        return;
      }
      this.seenRedraftPickEvents.add(eventKey);
    }

    if (event.type === "deck-card") {
      this.acceptingTeamPreview = false;
      this.pendingTeamCore = undefined;
      this.recordPick(reference, this.currentChoices, "deck-card");
      return;
    }

    if (reference.cardId?.toUpperCase().startsWith("HERO_")) {
      this.recordPick(reference, this.currentChoices, "arena-log");
      return;
    }

    if (this.acceptingTeamPreview && this.isLegendary(reference)) {
      this.pendingTeamCore = reference;
      this.touch();
      return;
    }

    if (this.acceptingTeamPreview) {
      this.commitPendingTeamCore();
      this.acceptingTeamPreview = false;
    }
    this.recordPick(reference, this.currentChoices, "arena-log");
  }

  private applyPowerChoiceEvent(event: ArenaPowerChoiceEvent) {
    if (!isArenaChoosingStatus(this.status)) {
      return;
    }

    if (event.type === "offered") {
      this.setLogChoices(event.offered);
      this.touch();
      return;
    }

    if (event.chosen.length === 0) {
      return;
    }

    this.setLogChoices(event.offered);
    if (!this.preferArenaLogPicks) {
      const chosen = event.chosen[0];
      this.recordPick(chosen, this.currentChoices, "power-log");
    }
  }

  private recordPick(reference: CardReference, offered: readonly ArenaCardChoice[], source: string) {
    const chosen = this.scoreChoice({
      name: reference.cardName ?? reference.cardId ?? "未知卡牌",
      count: 1,
      cardId: reference.cardId,
      entityId: reference.entityId
    });

    if (chosen.cardId?.toUpperCase().startsWith("HERO_")) {
      this.hero = this.toHero(chosen);
      this.clearCurrentChoices();
      this.rebuildScores();
      this.touch();
      return;
    }

    if (
      this.lastPick &&
      sameCard(this.lastPick, chosen) &&
      isLivePickSource(this.lastPick.source) &&
      isLivePickSource(source) &&
      this.lastPick.source !== source &&
      offered.length === 0
    ) {
      return;
    }

    const pick = {
      slot: this.picks.length + 1,
      chosen,
      offered: offered.map((choice) => this.scoreChoice(choice)),
      at: new Date().toISOString()
    };
    if (this.awaitingExactDeck) {
      this.pendingRedraftChoices.push(chosen);
      this.lastPick = { cardId: chosen.cardId, name: chosen.name, source };
      this.clearCurrentChoices();
      this.touch();
      return;
    }

    this.picks.push(pick);
    this.lastPick = { cardId: chosen.cardId, name: chosen.name, source };
    this.clearCurrentChoices();
    if (this.status === "drafting" && this.picks.length + this.teamBonusCount >= 30) {
      this.status = "complete";
    }
    this.touch();
  }

  private isLegendary(reference: CardReference) {
    const card = (reference.cardId ? this.cardInfoByCardId.get(normalizeCardId(reference.cardId)) : undefined)
      ?? (reference.cardName ? this.findCardInfoByName(reference.cardName) : undefined);
    return card?.rarity === "LEGENDARY";
  }

  private commitPendingTeamCore() {
    if (!this.pendingTeamCore) {
      return;
    }
    const chosen = this.scoreChoice({
      name: this.pendingTeamCore.cardName ?? this.pendingTeamCore.cardId ?? "未知卡牌",
      count: 1,
      cardId: this.pendingTeamCore.cardId
    });
    this.picks.push({
      slot: this.picks.length + 1,
      chosen,
      offered: [],
      at: new Date().toISOString()
    });
    this.lastPick = { cardId: chosen.cardId, name: chosen.name, source: "arena-team" };
    this.pendingTeamCore = undefined;
    this.teamBonusCount = 2;
  }

  private restoreDraftContents(events: readonly ArenaLogEvent[]) {
    for (const event of events) {
      if (event.type === "hero-selected") {
        this.hero = this.toHero(event);
        this.rebuildScores();
        this.touch();
        continue;
      }

      if (event.type === "deck-card") {
        this.recordPick({
          cardId: event.cardId,
          cardName: event.cardName
        }, this.currentChoices, "deck-card");
      }
    }
  }

  private restorePendingDraftContents() {
    const pendingDraftContents = this.pendingDraftContents;
    const nextDeckId = this.pendingContentsDeckId ?? this.draftDeckId;
    const nextRedraftGenerationId = this.redraftGenerationId;
    this.pendingDraftContents = [];
    this.pendingContentsDeckId = undefined;
    if (pendingDraftContents.length === 0) {
      return;
    }

    if (this.awaitingExactDeck) {
      this.draftDeckId = nextDeckId;
      this.redraftGenerationId = nextRedraftGenerationId;
      this.redraftContentsPicks = [];
      this.redraftSnapshotIncludedChoiceCount = this.pendingRedraftChoices.length;
      for (const event of pendingDraftContents) {
        if (event.type === "hero-selected") {
          this.hero = this.toHero(event);
          this.rebuildScores();
          continue;
        }
        if (event.type !== "deck-card") {
          continue;
        }
        const chosen = this.scoreChoice({
          name: event.cardName ?? event.cardId ?? "未知卡牌",
          count: 1,
          cardId: event.cardId
        });
        this.redraftContentsPicks.push({
          slot: this.redraftContentsPicks.length + 1,
          chosen,
          offered: [],
          at: new Date().toISOString()
        });
      }
      this.touch();
      return;
    }

    this.resetDraft();
    this.draftDeckId = nextDeckId;
    this.redraftGenerationId = nextRedraftGenerationId;
    this.status = "drafting";
    this.restoreDraftContents(pendingDraftContents);
  }

  private toHero(reference: CardReference | ArenaCardChoice): ArenaHero {
    const cardId = reference.cardId;
    const referenceName = "name" in reference ? reference.name : reference.cardName;
    const name = referenceName ?? (cardId ? this.cardNameByCardId.get(normalizeCardId(cardId)) : undefined) ?? cardId ?? "未知职业";
    return {
      name,
      cardId,
      className: cardId ? heroClassForCardId(cardId) : undefined
    };
  }

  private scoreChoice(choice: ArenaCardChoice): ArenaCardChoice {
    let cardId = choice.cardId;
    let card = (cardId ? this.cardInfoByCardId.get(normalizeCardId(cardId)) : undefined) ?? this.findCardInfoByName(choice.name);
    let rating = getArenaCardRating(this.ratings, cardId, this.hero?.className);
    if (rating === undefined) {
      const ratedCards = this.cardInfoByName.get(normalizeCardName(choice.name))?.filter((candidate) =>
        getArenaCardRating(this.ratings, candidate.cardId ?? candidate.id, this.hero?.className) !== undefined
      );
      const ratedCard = ratedCards?.length === 1 ? ratedCards[0] : undefined;
      if (ratedCard) {
        card = ratedCard;
        cardId = ratedCard.cardId ?? ratedCard.id;
        rating = getArenaCardRating(this.ratings, cardId, this.hero?.className);
      }
    }
    const name = card?.name ?? (cardId ? this.cardNameByCardId.get(normalizeCardId(cardId)) ?? choice.name : choice.name);
    const score = rating?.hearthArena;
    return {
      ...choice,
      cardId,
      name,
      score,
      scoreSource: score === undefined ? undefined : getArenaScoreSourceLabel(this.ratings),
      details: card && this.cardDatabase ? toCardDetails(this.cardDatabase, card) : choice.details,
      quality: getArenaScoreQuality(score),
      rating
    };
  }

  private rebuildScores() {
    this.currentChoices = this.currentChoices.map((choice) => this.scoreChoice(choice));
    this.screenChoicesBySlot = this.screenChoicesBySlot.map((choice) => choice ? this.scoreChoice(choice) : undefined);
    this.picks = this.picks.map((pick) => ({
      ...pick,
      chosen: this.scoreChoice(pick.chosen),
      offered: pick.offered.map((choice) => this.scoreChoice(choice))
    }));
    this.redraftContentsPicks = this.redraftContentsPicks.map((pick) => ({
      ...pick,
      chosen: this.scoreChoice(pick.chosen),
      offered: pick.offered.map((choice) => this.scoreChoice(choice))
    }));
    this.pendingRedraftChoices = this.pendingRedraftChoices.map((choice) => this.scoreChoice(choice));
    this.rebuildConfirmedDeckScores();
    if (this.hero?.cardId) {
      this.hero = this.toHero(this.hero);
    }
  }

  private rebuildConfirmedDeckScores() {
    if (this.confirmedDeck.reduce((total, card) => total + card.count, 0) !== 30) {
      return;
    }

    const scoredDeck = aggregateDeck(this.picks);
    if (scoredDeck.reduce((total, card) => total + card.count, 0) === 30) {
      this.confirmedDeck = scoredDeck;
    }
  }

  private resetDraft() {
    this.draftDeckId = undefined;
    this.pendingContentsDeckId = undefined;
    this.redraftGenerationId = undefined;
    this.hero = undefined;
    this.clearCurrentChoices();
    this.picks = [];
    this.confirmedDeck = [];
    this.redraftContentsPicks = [];
    this.pendingRedraftChoices = [];
    this.redraftSnapshotIncludedChoiceCount = 0;
    this.seenRedraftPickEvents.clear();
    this.awaitingExactDeck = false;
    this.pendingTeamCore = undefined;
    this.teamBonusCount = 0;
    this.acceptingTeamPreview = true;
    this.lastPick = undefined;
    this.error = undefined;
  }

  private setLogChoices(choices: readonly ArenaCardChoice[]) {
    this.screenChoicesBySlot = [];
    this.pendingFuzzyScreenChoices = [];
    this.currentChoices = choices.map((choice) => this.scoreChoice(choice));
    this.currentChoiceSource = "log";
  }

  private clearCurrentChoices() {
    this.currentChoices = [];
    this.currentChoiceSource = undefined;
    this.screenChoicesBySlot = [];
    this.pendingFuzzyScreenChoices = [];
  }

  private touch() {
    this.lastUpdated = new Date().toISOString();
  }
}

function aggregateDeck(picks: readonly ArenaPick[]): DeckCard[] {
  const cards = new Map<string, DeckCard>();
  for (const pick of picks) {
    const key = pick.chosen.cardId ? `id:${normalizeCardId(pick.chosen.cardId)}` : `name:${pick.chosen.name.trim().toLocaleLowerCase()}`;
    const current = cards.get(key);
    if (current) {
      current.count += 1;
    } else {
      cards.set(key, {
        name: pick.chosen.name,
        count: 1,
        cardId: pick.chosen.cardId,
        details: pick.chosen.details,
        pickRate: pick.chosen.rating?.pickRate,
        deckImpact: pick.chosen.rating?.deckImpact
      });
    }
  }
  return [...cards.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function cloneDeckCard(card: DeckCard): DeckCard {
  return {
    ...card,
    details: card.details ? structuredClone(card.details) : undefined
  };
}

function mergeDeckCards(cards: readonly DeckCard[]): DeckCard[] {
  const merged = new Map<string, DeckCard>();
  for (const card of cards) {
    const identity = card.cardId ?? card.name;
    const current = merged.get(identity);
    if (current) {
      merged.set(identity, { ...current, count: current.count + card.count });
    } else {
      merged.set(identity, cloneDeckCard(card));
    }
  }
  return [...merged.values()];
}

function isArenaChoosingStatus(status: ArenaState["status"]) {
  return status === "drafting" || status === "redrafting";
}

function isDraftContentsRestoreEvent(event: ArenaLogEvent) {
  return (event.type === "hero-selected" || event.type === "deck-card") && /DraftManager\.OnChoicesAndContents/i.test(event.raw);
}

function sameCard(previous: { cardId?: string; name: string }, current: ArenaCardChoice) {
  if (previous.cardId && current.cardId) {
    return normalizeCardId(previous.cardId) === normalizeCardId(current.cardId);
  }
  return previous.name.trim().toLocaleLowerCase() === current.name.trim().toLocaleLowerCase();
}

function isLivePickSource(source: string) {
  return source === "arena-log" || source === "power-log";
}

function heroClassForCardId(cardId: string): string | undefined {
  const heroClasses: Record<string, string> = {
    HERO_01: "Warrior",
    HERO_02: "Shaman",
    HERO_03: "Rogue",
    HERO_04: "Paladin",
    HERO_05: "Hunter",
    HERO_06: "Druid",
    HERO_07: "Warlock",
    HERO_08: "Mage",
    HERO_09: "Priest",
    HERO_10: "Demon Hunter",
    HERO_11: "Death Knight"
  };
  const normalizedCardId = cardId.toUpperCase();
  const baseHeroCardId = normalizedCardId.match(/^HERO_(?:0[1-9]|1[01])/)?.[0];
  return heroClasses[normalizedCardId] ?? (baseHeroCardId ? heroClasses[baseHeroCardId] : undefined);
}

function normalizeCardName(name: string) {
  return name.trim().toLocaleLowerCase();
}

function normalizeOcrCardName(name: string) {
  const normalized = name.normalize("NFKC");
  const looksLikeStylizedCode = /[A-Z0-9]{3,}[\p{P}\p{S}][A-Z0-9]{3,}/u.test(normalized);
  const compact = normalized
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, "");

  if (!looksLikeStylizedCode && !/\d/.test(compact)) {
    return compact;
  }

  const digitNormalized = compact.replace(/[ilo]/g, (character) => character === "o" ? "0" : "1");
  return looksLikeStylizedCode
    ? digitNormalized.replace(/a/g, "4").replace(/s/g, "3")
    : digitNormalized;
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
