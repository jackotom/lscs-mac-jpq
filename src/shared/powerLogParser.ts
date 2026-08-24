import type {
  EntitySnapshot,
  MatchFlowLogEvent,
  MatchFlowTag,
  MatchResult,
  ParsedLogEvent,
  Zone
} from "./types.js";

const KNOWN_ZONES = new Set(["DECK", "HAND", "PLAY", "GRAVEYARD", "REMOVEDFROMGAME", "SETASIDE", "SECRET"]);
const MATCH_FLOW_TAGS = new Set<MatchFlowTag>([
  "TURN",
  "STEP",
  "NEXT_STEP",
  "CURRENT_PLAYER",
  "RESOURCES",
  "RESOURCES_USED"
]);
const START_OF_GAME_GLOBAL_EFFECT_CARD_IDS = new Set([
  "GIL_692", "CORE_GIL_692",
  "GIL_826", "CORE_GIL_826",
  "SW_448", "CORE_SW_448",
  "YOG_530", "EDR_845",
  "REV_018", "CORE_REV_018",
  "JAIL_397"
]);
const PLAYED_GLOBAL_EFFECT_CARD_IDS = new Set([
  "BAR_539", "BAR_546", "BAR_881",
  "BOT_257", "BT_002",
  "CORE_CS3_029", "CS3_029",
  "DMF_108", "DMF_534", "DRG_315",
  "ETC_330", "ETC_417",
  "GDB_467", "OG_118", "SCH_609",
  "JAIL_122",
  "TLC_828", "TOY_805", "TOY_877",
  "TSC_944", "YOG_505"
]);
const TRIGGERED_GLOBAL_EFFECT_CARD_IDS = new Map([
  ["EDR_895E", "EDR_895"]
]);

export interface FriendlyDeckSnapshot {
  /** Total cards actually present in the local deck after game-start effects resolve. */
  readonly initialDeckSize: number;
  readonly remainingDeckSize: number;
  /** Original collection-deck cards before game-start effects added extra deck entities. */
  readonly baseDeckSize?: number;
}

export function parseLogLine(line: string): ParsedLogEvent[] {
  if (!line.trim()) {
    return [];
  }

  const playerIdentity = line.match(/\bPlayerID=(\d+),\s*PlayerName=(.+?)\s*$/i);
  if (playerIdentity) {
    return [{
      type: "player-identity",
      playerId: Number(playerIdentity[1]),
      playerName: playerIdentity[2].trim(),
      raw: line
    }];
  }

  if (line.includes("CREATE_GAME")) {
    return [{ type: "game-start", timestamp: parseLogTimestamp(line), raw: line }];
  }

  if (isGameEndLine(line)) {
    return [{ type: "game-end", raw: line }];
  }

  const deckShuffle = line.match(/\bSHUFFLE_DECK\s+PlayerID=(\d+)\b/i);
  if (deckShuffle) {
    return [{
      type: "deck-shuffle",
      playerId: Number(deckShuffle[1]),
      raw: line
    }];
  }

  if (/\bTAG_CHANGE\b.*tag=(?:STEP|NEXT_STEP)\s+value=(?:MAIN_READY|MAIN_ACTION)\b/i.test(line)) {
    const matchFlow = parseMatchFlowEvent(line);
    return [
      { type: "game-setup-complete", raw: line },
      ...(matchFlow ? [matchFlow] : [])
    ];
  }

  if (/BLOCK_END\b/.test(line)) {
    return [
      { type: "block-boundary", phase: "end", raw: line },
      { type: "action-boundary", phase: "end", action: "other", raw: line },
      { type: "causal-trigger", phase: "end", raw: line }
    ];
  }

  if (/BLOCK_START\b.*BlockType=TRIGGER\b/.test(line)) {
    const entity = parseEntity(line);
    const events: ParsedLogEvent[] = [{
      type: "block-boundary",
      phase: "start",
      blockType: "TRIGGER",
      entity,
      raw: line
    }];
    if (/TriggerKeyword=DEATHRATTLE\b/i.test(line) && entity.id) {
      events.push({
        type: "causal-trigger",
        phase: "start",
        trigger: "deathrattle",
        entity,
        raw: line
      });
    }
    const normalizedCardId = entity.cardId?.toLocaleUpperCase();
    if (
      normalizedCardId &&
      /TriggerKeyword=START_OF_GAME_KEYWORD\b/.test(line) &&
      START_OF_GAME_GLOBAL_EFFECT_CARD_IDS.has(normalizedCardId)
    ) {
      events.push({ type: "global-effect", source: "start-of-game", entity, raw: line });
      return events;
    }
    const sourceCardId = normalizedCardId
      ? TRIGGERED_GLOBAL_EFFECT_CARD_IDS.get(normalizedCardId)
      : undefined;
    if (sourceCardId) {
      events.push({
        type: "global-effect",
        source: "played",
        entity: { ...entity, cardId: sourceCardId },
        raw: line
      });
    }
    return events;
  }

  if (/BLOCK_START\b.*BlockType=PLAY\b/.test(line)) {
    const entity = parseEntity(line);
    const target = parseTarget(line);
    const events: ParsedLogEvent[] = [
      { type: "block-boundary", phase: "start", blockType: "PLAY", entity, target, raw: line },
      { type: "action-boundary", phase: "start", action: "play", entity, target, raw: line }
    ];
    if (entity.cardId && PLAYED_GLOBAL_EFFECT_CARD_IDS.has(entity.cardId.toLocaleUpperCase())) {
      events.push({ type: "global-effect", source: "played", entity, raw: line });
    }
    return events;
  }

  const blockStart = line.match(/\bBLOCK_START\b.*?\bBlockType=([A-Z_]+)\b/i);
  if (blockStart) {
    const entity = parseEntity(line);
    const target = parseTarget(line);
    const events: ParsedLogEvent[] = [{
      type: "block-boundary",
      phase: "start",
      blockType: blockStart[1].toUpperCase(),
      entity,
      target,
      raw: line
    }];
    if (blockStart[1].toUpperCase() === "ATTACK") {
      events.push({
        type: "action-boundary",
        phase: "start",
        action: "attack",
        entity,
        target,
        raw: line
      });
    }
    return events;
  }

  const events: ParsedLogEvent[] = [];
  const entity = parseEntity(line);
  const matchFlow = parseMatchFlowEvent(line, entity);
  if (matchFlow) {
    events.push(matchFlow);
  }
  const playerCounter = parsePlayerCounter(line, entity);
  if (playerCounter) {
    events.push(playerCounter);
  }

  const forged = line.match(/\btag=(?:FORGE|FORGED)\s+value=([01])\b/i);
  if (forged) {
    events.push({
      type: "card-forged",
      entityId: entity.id,
      forged: forged[1] === "1",
      raw: line
    });
  }

  if (line.includes("FULL_ENTITY") || line.includes("SHOW_ENTITY")) {
    if (entity.id || entity.name || entity.cardId) {
      events.push({
        type: "entity",
        entity,
        creating: /\bFULL_ENTITY\s+-\s+Creating\b/.test(line),
        raw: line
      });
    }
  }

  const entityReference = line.match(/\btag=(ATTACHED|TAG_SCRIPT_DATA_NUM_1)\s+value=(\d+)\b/i);
  if (entityReference) {
    events.push({
      type: "entity-reference",
      entityId: entity.id,
      relation: entityReference[1].toUpperCase() === "ATTACHED" ? "attached" : "stored-entity",
      referencedEntityId: entityReference[2],
      raw: line
    });
  }

  const scriptData = line.match(/\btag=TAG_SCRIPT_DATA_NUM_(\d+)\s+value=(-?\d+)\b/i);
  if (scriptData) {
    events.push({
      type: "entity-script-data",
      entity,
      index: Number(scriptData[1]),
      value: Number(scriptData[2]),
      raw: line
    });
  }

  const displayedCreator = parseTagValueNumber(line, "DISPLAYED_CREATOR");
  if (displayedCreator !== undefined) {
    events.push({
      type: "generated-entity",
      entityId: entity.id,
      creatorEntityId: String(displayedCreator),
      raw: line
    });
  }

  const controller = parseTagValueNumber(line, "CONTROLLER");
  if (controller !== undefined) {
    events.push({
      type: "controller",
      entityId: entity.id,
      controller,
      raw: line
    });
  }

  const cardClass = parseTagValue(line, "CLASS");
  if (cardClass) {
    events.push({
      type: "entity-class",
      entityId: entity.id,
      cardClass,
      raw: line
    });
  }

  const zone = parseTagValue(line, "ZONE");
  if (zone) {
    events.push({
      type: "zone-change",
      entityId: entity.id,
      cardName: entity.name,
      cardId: entity.cardId,
      fromZone: entity.zone,
      toZone: normalizeZone(zone),
      controller: entity.controller,
      raw: line
    });
  }

  const zonePosition = parseTagValueNumber(line, "ZONE_POSITION");
  if (zonePosition !== undefined) {
    events.push({
      type: "zone-position",
      entityId: entity.id,
      controller: entity.controller,
      position: zonePosition,
      raw: line
    });
  }

  const attack = parseTagValueNumber(line, "ATK");
  if (attack !== undefined) events.push({ type: "attack-change", entityId: entity.id, attack, raw: line });

  return events;
}

function parseMatchFlowEvent(
  line: string,
  entity = parseEntity(line)
): MatchFlowLogEvent | undefined {
  const match = line.match(/\btag=(TURN|STEP|NEXT_STEP|CURRENT_PLAYER|RESOURCES|RESOURCES_USED)\s+value=([^\s]+)/i);
  const tag = match?.[1]?.toUpperCase() as MatchFlowTag | undefined;
  if (!tag || !MATCH_FLOW_TAGS.has(tag) || match?.[2] === undefined) {
    return undefined;
  }

  return {
    type: "match-flow",
    tag,
    value: match[2],
    entity,
    raw: line
  };
}

function parsePlayerCounter(
  line: string,
  entity: EntitySnapshot
): Extract<ParsedLogEvent, { type: "player-counter" }> | undefined {
  const match = line.match(
    /\bTAG_CHANGE\s+Entity=(.+?)\s+tag=(FATIGUE|CORPSES|NUM_SPELLS_PLAYED_THIS_GAME)\s+value=(-?\d+)\b/i
  );
  if (!match) {
    return undefined;
  }

  const counter = match[2].toUpperCase() === "FATIGUE"
    ? "fatigue"
    : match[2].toUpperCase() === "CORPSES"
      ? "corpses"
      : "spells-played";
  const rawEntity = match[1].trim();
  const playerName = rawEntity.startsWith("[") || /^\d+$/.test(rawEntity) || rawEntity === "GameEntity"
    ? undefined
    : rawEntity;

  return {
    type: "player-counter",
    playerId: entity.controller,
    playerName,
    counter,
    value: Number(match[3]),
    raw: line
  };
}

function parseLogTimestamp(line: string) {
  return line.match(/^\s*[A-Z]\s+([0-9:.]+)/)?.[1];
}

export function parseEntity(line: string): EntitySnapshot {
  const sourceWithBrackets = extractEntitySource(line);
  const source =
    sourceWithBrackets.startsWith("[") && sourceWithBrackets.endsWith("]")
      ? sourceWithBrackets.slice(1, -1)
      : sourceWithBrackets;

  const id = firstMatch(source, [/\bid=(\d+)/, /\bID=(\d+)/, /\bEntity=(\d+)/, /^\s*(\d+)\s*$/]);
  const rawName = firstMatch(source, [/\bentityName=(.+?)\s+id=/, /^\s*([^\s=]+(?:\s+[^\s=]+)*)\s*$/]);
  const cardId = firstMatch(line, [/\bCardID=([A-Za-z0-9_]+)/, /\bcardId=([A-Za-z0-9_]+)/]);
  const rawZone = firstMatch(source, [/\bzone=([A-Z]+)/]);
  const rawController = firstMatch(source, [/\bcontroller=(\d+)/, /\bplayer=(\d+)/]);
  const cardType = firstMatch(source, [/\bcardType=([A-Z_]+)/i]);

  const name = rawName === id ? undefined : normalizeName(rawName);
  return {
    id,
    name,
    cardId,
    zone: rawZone ? normalizeZone(rawZone) : undefined,
    controller: rawController ? Number(rawController) : undefined,
    cardType
  };
}

function parseTarget(line: string): EntitySnapshot | undefined {
  const targetIndex = line.indexOf("Target=");
  if (targetIndex < 0) return undefined;
  const value = readEntityValue(line.slice(targetIndex + "Target=".length));
  if (!value || value === "0") return undefined;
  const target = parseEntity(value);
  return target.id || target.name || target.cardId ? target : undefined;
}

function extractEntitySource(line: string): string {
  const entityIndex = line.indexOf("Entity=");
  if (entityIndex >= 0) {
    const entityValue = readEntityValue(line.slice(entityIndex + "Entity=".length));
    if (entityValue) {
      return entityValue;
    }
  }

  const indexedEntityMatch = line.match(/(?:Entities|m_chosenEntities)\[\d+\]=/);
  if (indexedEntityMatch?.index !== undefined) {
    const entityValue = readEntityValue(line.slice(indexedEntityMatch.index + indexedEntityMatch[0].length));
    if (entityValue) {
      return entityValue;
    }
  }

  return line;
}

function readEntityValue(value: string): string | undefined {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("[")) {
    return trimmed.match(/^([^\s]+)/)?.[1];
  }

  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(0, index + 1);
      }
    }
  }

  return undefined;
}

function parseTagValue(line: string, tag: string): string | undefined {
  const match = line.match(new RegExp(`tag=${tag}\\s+value=([^\\s]+)`));
  return match?.[1];
}

function parseTagValueNumber(line: string, tag: string): number | undefined {
  const value = parseTagValue(line, tag);
  if (!value) {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function firstMatch(input: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function normalizeName(name?: string): string | undefined {
  if (!name || /^\d+$/.test(name) || name.startsWith("UNKNOWN ENTITY") || name === "GameEntity") {
    return undefined;
  }
  return name.replace(/\s+/g, " ").trim();
}

export function normalizeZone(zone: string): Zone {
  const upper = zone.toUpperCase();
  return KNOWN_ZONES.has(upper) ? (upper as Zone) : "UNKNOWN";
}

export function isArenaGameStartLine(line: string) {
  return line.includes("CREATE_GAME") && detectPowerGameType(line) === "arena";
}

export function detectPowerGameType(text: string): "arena" | "constructed" | undefined {
  const gameType = text.match(/\bGameType=(GT_[A-Z_]+)\b/i)?.[1];
  if (!gameType) {
    return undefined;
  }
  return /ARENA/i.test(gameType) ? "arena" : "constructed";
}

export function isConstructedGameStartLine(line: string) {
  return line.includes("CREATE_GAME") && !isArenaGameStartLine(line);
}

export function isGameEndLine(line: string) {
  return (
    /tag=PLAYSTATE\s+value=(?:WON|LOST|TIED|CONCEDED)\b/i.test(line) ||
    /tag=(?:STEP|NEXT_STEP)\s+value=FINAL_GAMEOVER\b/i.test(line)
  );
}

export function parseMatchResultLine(
  line: string,
  friendlyController?: number,
  friendlyPlayerName?: string
): MatchResult | undefined {
  const playState = line.match(/tag=PLAYSTATE\s+value=(WON|LOST|TIED|CONCEDED)\b/i)?.[1]?.toUpperCase();
  const entity = parseEntity(line);
  const isFriendly = entity.controller !== undefined
    ? entity.controller === friendlyController
    : Boolean(friendlyPlayerName && entity.name === normalizeName(friendlyPlayerName));
  if (!playState || !isFriendly) {
    return undefined;
  }

  if (playState === "WON") return "win";
  if (playState === "TIED") return "tie";
  return "loss";
}

export function selectCurrentPowerGameText(content: string): string {
  const lines = content.split(/\r?\n/);
  let start = -1;
  let startTimestamp: string | undefined;
  lines.forEach((line, index) => {
    if (line.includes("CREATE_GAME")) {
      const timestamp = line.match(/^\s*[A-Z]\s+([0-9:.]+)/)?.[1];
      if (timestamp && timestamp === startTimestamp) {
        return;
      }
      start = index;
      startTimestamp = timestamp;
    }
  });
  return start >= 0 ? lines.slice(start).join("\n") : content;
}

/**
 * Uses the complete game snapshot to validate a collection deck before it is activated.
 * Hearthstone can keep an old `Finding Game With Deck` record in Decks.log, while
 * Power.log still exposes the authoritative number of local deck entities.
 */
export function inspectFriendlyDeckSnapshot(content: string, friendlyController?: number): FriendlyDeckSnapshot | undefined {
  if (friendlyController === undefined) {
    return undefined;
  }

  const zones = new Map<string, Zone>();
  const initialDeckEntityIds = new Set<string>();
  const generatedDeckEntityIds = new Set<string>();
  const runtimeGeneratedEntityIds = new Set<string>();
  let setupComplete = false;
  let pendingEntityDetail: EntitySnapshot | undefined;

  for (const line of selectCurrentPowerGameText(content).split(/\r?\n/)) {
    if (/tag=(?:STEP|NEXT_STEP)\s+value=(?:MAIN_READY|MAIN_ACTION)/i.test(line)) {
      setupComplete = true;
    }

    const parsedEntity = parseEntity(line);
    if (
      setupComplete &&
      parsedEntity.id &&
      /tag=DISPLAYED_CREATOR\s+value=/i.test(line)
    ) {
      runtimeGeneratedEntityIds.add(parsedEntity.id);
    }
    const startsEntityDetail = /(?:FULL_ENTITY|SHOW_ENTITY)\s+-\s+Updating\b/.test(line) && Boolean(parsedEntity.id);
    const continuesEntityDetail = /-\s+tag=[A-Z_]+\s+value=/i.test(line);
    if (startsEntityDetail) {
      pendingEntityDetail = parsedEntity;
    } else if (!continuesEntityDetail) {
      pendingEntityDetail = undefined;
    }

    if (continuesEntityDetail && pendingEntityDetail) {
      const controller = parseTagValueNumber(line, "CONTROLLER");
      const zone = parseTagValue(line, "ZONE");
      if (controller !== undefined || zone) {
        pendingEntityDetail = {
          ...pendingEntityDetail,
          ...(controller !== undefined ? { controller } : {}),
          ...(zone ? { zone: normalizeZone(zone) } : {})
        };
      }
    }

    const entity = parsedEntity.id ? parsedEntity : pendingEntityDetail;
    if (!entity) {
      continue;
    }
    if (!entity.id || entity.controller !== friendlyController) {
      continue;
    }

    const zoneChange = parseTagValue(line, "ZONE");
    const zone = zoneChange ? normalizeZone(zoneChange) : entity.zone;
    if (!zone || zone === "UNKNOWN") {
      continue;
    }

    zones.set(entity.id, zone);
    if (!setupComplete && zone === "DECK") {
      initialDeckEntityIds.add(entity.id);
    }

    if (!setupComplete && initialDeckEntityIds.has(entity.id) && /tag=DISPLAYED_CREATOR\s+value=/i.test(line)) {
      generatedDeckEntityIds.add(entity.id);
    }
  }

  const initialDeckSize = initialDeckEntityIds.size;
  if (initialDeckSize === 0) {
    return undefined;
  }

  const remainingDeckSize = [...zones.entries()].filter(
    ([entityId, zone]) => zone === "DECK" && !runtimeGeneratedEntityIds.has(entityId)
  ).length;
  const baseDeckSize = initialDeckSize - generatedDeckEntityIds.size;
  return {
    initialDeckSize,
    remainingDeckSize: Math.min(initialDeckSize, remainingDeckSize),
    ...(baseDeckSize > 0 && baseDeckSize < initialDeckSize ? { baseDeckSize } : {})
  };
}
