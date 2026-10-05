import { listCardInfos, type CardDatabase, type CardInfo } from "./cardDatabase.js";
import { toFirestoneClassSlug } from "./arenaRatings.js";
import type { DecisionOffer, MatchDetails, MulliganObservation } from "./decisionInsights.js";
import { isGameEndLine, normalizeZone, parseEntity } from "./powerLogParser.js";
import type { EntitySnapshot } from "./types.js";

type Entity = EntitySnapshot & { cardClass?: string };
interface Mulligan {
  phase: "input" | "resolving" | "done";
  original: Set<string>;
  replaced: Set<string>;
  final?: Set<string>;
  result?: MulliganObservation[];
}
interface Choice {
  id: string;
  kind: DecisionOffer["kind"];
  player: string;
  cards: Map<number, string>;
  answered: boolean;
}

/** Only observations from the current Power game; no identity, hand or result inference. */
export class MatchTelemetry {
  private cards = new Map<string, CardInfo>();
  private entities = new Map<string, Entity>();
  private players = new Map<string, number>();
  private names = new Map<string, number>();
  private mulligans = new Map<number, Mulligan>();
  private pendingEntity: string | undefined;
  private friendly: number | undefined;
  private firstPlayer: number | undefined;
  private heroClasses = new Map<number, string>();
  private arenaMode: "arena" | "underground" | undefined;
  private startTimestamp: string | undefined;
  private startSeconds: number | undefined;
  private durationSeconds: number | undefined;
  private turns: number | undefined;
  private choice: Choice | undefined;
  private active = false;

  reset() {
    this.entities.clear();
    this.players.clear();
    this.names.clear();
    this.mulligans.clear();
    this.pendingEntity = undefined;
    this.friendly = undefined;
    this.firstPlayer = undefined;
    this.heroClasses.clear();
    this.arenaMode = undefined;
    this.startTimestamp = undefined;
    this.startSeconds = undefined;
    this.durationSeconds = undefined;
    this.turns = undefined;
    this.choice = undefined;
    this.active = false;
  }

  setCardDatabase(database: CardDatabase) {
    this.cards = new Map(listCardInfos(database).flatMap(card => card.cardId ? [[card.cardId, card] as const] : []));
    for (const entity of this.entities.values()) this.rememberHeroClass(entity);
  }

  getArenaMode() { return this.arenaMode; }

  setPlayerNames(names: ReadonlyMap<number, string>) {
    this.names = new Map([...names].map(([id, name]) => [name, id]));
  }

  applyLine(line: string, friendlyController?: number) {
    if (!line.trim()) return;
    if (line.includes("CREATE_GAME")) {
      const timestamp = line.match(/^\s*[A-Z]\s+([\d:.]+)/)?.[1];
      if (!timestamp || timestamp !== this.startTimestamp) {
        this.reset();
        this.startTimestamp = timestamp;
        this.startSeconds = logSeconds(line);
        this.active = true;
      }
      this.friendly = friendlyController;
      this.readArenaMode(line);
      return;
    }
    this.friendly = friendlyController;
    this.readArenaMode(line);
    const identity = line.match(/\bPlayerID=(\d+),\s*PlayerName=(.+?)\s*$/);
    if (identity) this.names.set(identity[2]!, Number(identity[1]));
    const player = line.match(/\bPlayer\s+EntityID=(\d+)\s+PlayerID=(\d+)/);
    const game = line.match(/\bGameEntity\s+EntityID=(\d+)/);
    if (player) {
      this.players.set(player[1]!, Number(player[2]));
      this.pendingEntity = player[1];
      return;
    }
    if (game) { this.pendingEntity = game[1]; return; }

    const header = line.match(/GameState\.DebugPrintEntityChoices\(\).*?\bid=(\d+)\s+Player=(.+?)\s+TaskList=.*?ChoiceType=(\w+)/);
    if (header) {
      this.choice = undefined;
      const type = header[3]!.toUpperCase();
      if (this.active && (type === "MULLIGAN" || ((type === "GENERAL" || type === "DISCOVER") && /CountMin=1\s+CountMax=1\b/.test(line)))) {
        this.choice = { id: header[1]!, player: header[2]!, kind: type === "MULLIGAN" ? "mulligan" : "discover", cards: new Map(), answered: false };
      }
      this.pendingEntity = undefined;
      return;
    }
    const response = line.match(/GameState\.(?:SendChoices|DebugPrintEntitiesChosen)\(\).*?\bid=(\d+)/);
    if (response) {
      if (this.choice?.id === response[1]) {
        this.choice.answered = true;
        const owner = this.choiceController(this.choice);
        const mulligan = owner === undefined ? undefined : this.mulligans.get(owner);
        if (this.choice.kind === "mulligan" && mulligan) mulligan.phase = "resolving";
      }
      return;
    }

    const parsed = parseEntity(line);
    const continuation = /-\s+tag=\w+\s+value=/.test(line);
    const entityStart = /\b(?:FULL_ENTITY|SHOW_ENTITY|CHANGE_ENTITY)\b/.test(line);
    if (entityStart) this.pendingEntity = parsed.id;
    else if (!continuation) this.pendingEntity = undefined;
    const id = parsed.id ?? (continuation ? this.pendingEntity : undefined);
    const previous = id ? this.entities.get(id) : undefined;
    let entity: Entity | undefined;
    if (id) {
      entity = { ...previous, id };
      for (const [key, value] of Object.entries(parsed)) {
        if (value !== undefined) Object.assign(entity, { [key]: value });
      }
      this.entities.set(id, entity);
    }
    const tag = line.match(/\btag=(\w+)\s+value=([^\s]+)/);
    const tagName = tag?.[1];
    const value = tag?.[2];
    if (entity && value !== undefined) {
      if (tagName === "CONTROLLER") entity.controller = positiveInt(value);
      if (tagName === "CARDTYPE") entity.cardType = value === "3" ? "HERO" : value;
      if (tagName === "CLASS") entity.cardClass = normalizeClass(value);
      if (tagName === "ZONE") entity.zone = normalizeZone(({ 1: "PLAY", 2: "DECK", 3: "HAND", 4: "GRAVEYARD", 5: "REMOVEDFROMGAME", 6: "SETASIDE", 7: "SECRET" } as Record<string, string>)[value] ?? value);
    }
    if (entity) this.rememberHeroClass(entity);
    const owner = (id ? this.players.get(id) : undefined) ?? entity?.controller ?? this.namedTagController(line);
    if (tagName === "FIRST_PLAYER" && value === "1" && owner !== undefined) this.firstPlayer = owner;
    if (tagName === "TURN" && value !== undefined && /Entity=(?:GameEntity|1)\s/.test(line)) {
      const turn = positiveInt(value);
      if (turn !== undefined) this.turns = Math.max(turn, this.turns ?? 0);
    }
    if (tagName === "MULLIGAN_STATE" && owner !== undefined) {
      if (value === "INPUT" || value === "1") {
        this.active = true;
        if (!this.mulligans.has(owner)) this.mulligans.set(owner, { phase: "input", original: this.handIds(owner), replaced: new Set() });
      } else if (value === "DONE" || value === "4") {
        this.finishMulligan(owner);
      } else if (value === "DEALING" || value === "2") {
        const mulligan = this.mulligans.get(owner);
        if (mulligan?.phase === "input") mulligan.phase = "resolving";
      }
    }
    if (entity && id && entity.controller !== undefined) {
      const mulligan = this.mulligans.get(entity.controller);
      if (mulligan && !mulligan.final) {
        if (mulligan.original.has(id) && tagName === "ZONE" && entity.zone === "DECK") {
          mulligan.replaced.add(id);
          if (mulligan.phase !== "done") mulligan.phase = "resolving";
        } else if (mulligan.phase === "input" && entity.zone === "HAND" && this.isHandCard(entity)) {
          mulligan.original.add(id);
        }
      }
      if (this.choice?.kind === "discover" && tagName === "ZONE" && entity.zone !== "SETASIDE" && [...this.choice.cards.values()].includes(id)) {
        this.choice.answered = true;
      }
    }

    const indexed = line.match(/\b(Entities|m_chosenEntities)\[(\d+)\]=/);
    if (indexed && id && this.choice) {
      if (indexed[1] === "m_chosenEntities" || this.choice.answered) {
        const controller = this.choiceController(this.choice);
        if (controller !== undefined && this.choice.kind === "mulligan") this.mulligans.get(controller)?.replaced.add(id);
      } else {
        this.choice.cards.set(Number(indexed[2]), id);
        if (this.choice.kind === "mulligan") {
          const controller = this.choiceController(this.choice);
          if (controller !== undefined) {
            let mulligan = this.mulligans.get(controller);
            if (!mulligan) {
              mulligan = { phase: "input", original: new Set(), replaced: new Set() };
              this.mulligans.set(controller, mulligan);
            }
            if (mulligan.phase === "input") mulligan.original.add(id);
          }
        }
      }
    }
    if ((tagName === "STEP" || tagName === "NEXT_STEP") && /^(?:MAIN_READY|MAIN_BEGIN|MAIN_ACTION)$/.test(value ?? "")) {
      for (const controller of this.mulligans.keys()) this.finishMulligan(controller, true);
    }
    if (isGameEndLine(line) || (tagName === "PLAYSTATE" && /^(?:4|5|6|8)$/.test(value ?? ""))) {
      this.active = false;
      this.choice = undefined;
      const ended = logSeconds(line);
      if (this.durationSeconds === undefined && this.startSeconds !== undefined && ended !== undefined) {
        this.durationSeconds = Math.round((ended - this.startSeconds + 86_400) % 86_400);
      }
    }
  }

  getDetails(): MatchDetails {
    const friendlyClass = this.friendly === undefined ? undefined : this.heroClasses.get(this.friendly);
    const opponentClass = this.friendly === undefined ? undefined : [...this.heroClasses].find(([controller]) => controller !== this.friendly)?.[1];
    const mulligan = this.friendly === undefined ? undefined : this.mulligans.get(this.friendly);
    const observations = mulligan?.result;
    return {
      ...(friendlyClass ? { friendlyClass } : {}), ...(opponentClass ? { opponentClass } : {}),
      ...(this.friendly !== undefined && this.firstPlayer !== undefined ? { initiative: this.friendly === this.firstPlayer ? "first" as const : "second" as const } : {}),
      ...(this.durationSeconds !== undefined ? { durationSeconds: this.durationSeconds } : {}),
      ...(this.turns !== undefined ? { turns: this.turns } : {}),
      ...(observations?.length ? { mulligan: observations } : {})
    };
  }

  getOffer(): DecisionOffer | undefined {
    if (!this.active || this.friendly === undefined) return undefined;
    if (this.choice && !this.choice.answered && this.choiceController(this.choice) === this.friendly) {
      const cards = [...this.choice.cards.entries()].sort(([a], [b]) => a - b).flatMap(([, id]) => {
        const entity = this.entities.get(id);
        return entity?.cardId ? [{ entityId: id, cardId: entity.cardId, name: this.cardName(entity) }] : [];
      });
      if (cards.length) return { id: `${this.startTimestamp ?? "observed"}:${this.choice.id}`, kind: this.choice.kind, cards };
    }
    const mulligan = this.mulligans.get(this.friendly);
    if (mulligan?.phase !== "input") return undefined;
    const cards = [...mulligan.original].flatMap(id => {
      const entity = this.entities.get(id);
      return entity?.cardId ? [{ entityId: id, cardId: entity.cardId, name: this.cardName(entity) }] : [];
    });
    return cards.length ? { id: `${this.startTimestamp ?? "observed"}:mulligan`, kind: "mulligan", cards } : undefined;
  }

  private finishMulligan(controller: number, finalize = false) {
    const mulligan = this.mulligans.get(controller);
    if (!mulligan || mulligan.final) return;
    mulligan.phase = "done";
    if (this.choice?.kind === "mulligan" && this.choiceController(this.choice) === controller) this.choice.answered = true;
    // DONE is the player's acknowledgement; replacement entities may arrive later.
    if (!finalize) return;
    mulligan.final = this.handIds(controller);
    for (const id of mulligan.replaced) mulligan.final.delete(id);
    mulligan.result = [...new Set([...mulligan.original, ...mulligan.final])].flatMap(id => {
      const entity = this.entities.get(id);
      if (!entity?.cardId || !this.isHandCard(entity)) return [];
      return [{ cardId: entity.cardId, cardName: this.cardName(entity), drawnBeforeMulligan: mulligan.original.has(id), keptInMulligan: mulligan.original.has(id) && !mulligan.replaced.has(id) && mulligan.final!.has(id), inHandAfterMulligan: mulligan.final!.has(id) }];
    });
  }

  private handIds(controller: number) {
    return new Set([...this.entities.entries()].filter(([, entity]) => entity.controller === controller && entity.zone === "HAND" && this.isHandCard(entity)).map(([id]) => id));
  }

  private isHandCard(entity: Entity) { return Boolean(entity.cardId && entity.cardId !== "GAME_005"); }
  private cardName(entity: Entity) { return this.cards.get(entity.cardId ?? "")?.name ?? entity.name ?? entity.cardId!; }
  private rememberHeroClass(entity: Entity) {
    if (entity.controller === undefined || this.heroClasses.has(entity.controller)) return;
    if (entity.cardType !== "HERO" && !/^HERO_\d+(?:[a-z]\d*)?$/i.test(entity.cardId ?? "")) return;
    const cardClass = normalizeClass(entity.cardClass ?? (entity.cardId ? this.cards.get(entity.cardId)?.heroClass : undefined));
    if (cardClass) this.heroClasses.set(entity.controller, cardClass);
  }
  private readArenaMode(line: string) {
    const mode = line.match(/\bGameType=(GT_[A-Z_]+|\d+)\b/)?.[1] ?? line.match(/\btag=GAME_TYPE\s+value=(\w+)/)?.[1];
    if (mode !== undefined) this.arenaMode = /^(?:GT_ARENA|5)$/.test(mode) ? "arena" : /^(?:GT_UNDERGROUND_ARENA|42)$/.test(mode) ? "underground" : undefined;
  }
  private namedTagController(line: string) {
    const name = line.match(/\bTAG_CHANGE Entity=(.+?)\s+tag=/)?.[1];
    return name ? this.names.get(name) : undefined;
  }
  private choiceController(choice: Choice): number | undefined {
    if (/^\d+$/.test(choice.player)) return positiveInt(choice.player);
    if (/^local$/i.test(choice.player)) return this.friendly;
    if (/^opponent$/i.test(choice.player)) return undefined;
    const explicit = this.names.get(choice.player) ?? parseEntity(`Entity=${choice.player}`).controller;
    if (explicit !== undefined) return explicit;
    const controllers = new Set([...choice.cards.values()].map(id => this.entities.get(id)?.controller));
    return controllers.size === 1 ? [...controllers][0] : undefined;
  }
}

function positiveInt(value: string): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}
function logSeconds(line: string): number | undefined {
  const time = line.match(/^\s*[A-Z]\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!time || Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3]) > 59) return undefined;
  return Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) + Number(`0.${time[4] ?? 0}`);
}
function normalizeClass(value?: string) {
  if (!value) return undefined;
  return ({ 1: "DEATHKNIGHT", 2: "DRUID", 3: "HUNTER", 4: "MAGE", 5: "PALADIN", 6: "PRIEST", 7: "ROGUE", 8: "SHAMAN", 9: "WARLOCK", 10: "WARRIOR", 12: "DEMONHUNTER", 死亡骑士: "DEATHKNIGHT", 德鲁伊: "DRUID", 猎人: "HUNTER", 法师: "MAGE", 圣骑士: "PALADIN", 牧师: "PRIEST", 盗贼: "ROGUE", 萨满: "SHAMAN", 萨满祭司: "SHAMAN", 术士: "WARLOCK", 战士: "WARRIOR", 恶魔猎手: "DEMONHUNTER" } as Record<string, string>)[value.trim()] ?? toFirestoneClassSlug(value)?.toUpperCase();
}
