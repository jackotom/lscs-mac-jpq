export type CollectionSource = "log" | "import" | "manual";
export type CardRarity = "common" | "rare" | "epic" | "legendary";

export interface OwnedCard {
  readonly cardId: string;
  readonly name?: string;
  readonly normal: number;
  readonly golden: number;
}
export interface OpenedPackCard {
  readonly cardId?: string;
  readonly name?: string;
  readonly rarity: CardRarity;
  readonly golden?: boolean;
}
export interface PackOpeningRecord {
  readonly id: string;
  readonly set: string;
  readonly openedAt: string;
  readonly cards: readonly OpenedPackCard[];
}
export interface PackPityCounter {
  readonly set: string;
  readonly packsSinceEpic?: number;
  readonly packsSinceLegendary: number;
  readonly epicLimit?: 10;
  readonly legendaryLimit?: 40;
  readonly partial: boolean;
}
export interface CosmeticItem { readonly id: string; readonly name: string; }
export interface CollectionSnapshot {
  readonly cards: readonly OwnedCard[];
  readonly packs: readonly PackOpeningRecord[];
  readonly pity: readonly PackPityCounter[];
  readonly cardBacks: readonly CosmeticItem[];
  readonly heroSkins: readonly CosmeticItem[];
  readonly coins: readonly CosmeticItem[];
  readonly updatedAt: string;
  readonly source: CollectionSource;
}
export type CollectionInsightsResult =
  | ({ readonly status: "ok" } & CollectionSnapshot)
  | ({ readonly status: "error"; readonly error: string } & Partial<CollectionSnapshot>);

const COLLECTION_CSV_HEADER = [
  "type", "id", "name", "normal", "golden", "set", "openedAt", "rarity", "packId"
] as const;

export function parseCollectionCsv(text: string): CollectionSnapshot {
  if (typeof text !== "string" || !text.trim()) throw new Error("CSV 内容为空");
  const rows = parseCsvRows(text);
  const header = rows.shift();
  if (!header) throw new Error("CSV 缺少表头");
  if (header[0]?.charCodeAt(0) === 0xfeff) header[0] = header[0].slice(1);
  if (header.length !== COLLECTION_CSV_HEADER.length || header.some((value, index) => value !== COLLECTION_CSV_HEADER[index])) {
    throw new Error(`CSV 表头必须为 ${COLLECTION_CSV_HEADER.join(",")}`);
  }

  const cards: OwnedCard[] = [];
  const cardBacks: CosmeticItem[] = [];
  const heroSkins: CosmeticItem[] = [];
  const coins: CosmeticItem[] = [];
  const packs = new Map<string, { id: string; set: string; openedAt: string; cards: OpenedPackCard[] }>();

  for (const [index, row] of rows.entries()) {
    if (row.every((field) => field === "")) continue;
    if (row.length !== COLLECTION_CSV_HEADER.length) throw new Error(`CSV 第 ${index + 2} 行列数无效`);
    const [type, id, name, normal, golden, set, openedAt, rarity, packId] = row;
    if (type === "card") {
      requireFields(index, { id, name, normal, golden });
      requireEmptyFields(index, { set, openedAt, rarity, packId });
      cards.push({ cardId: id!, name: name!, normal: parseCsvCount(normal!, index), golden: parseCsvCount(golden!, index) });
      continue;
    }
    if (type === "card_back" || type === "hero_skin" || type === "coin") {
      requireFields(index, { id, name });
      requireEmptyFields(index, { normal, golden, set, openedAt, rarity, packId });
      const item = { id: id!, name: name! };
      if (type === "card_back") cardBacks.push(item);
      else if (type === "hero_skin") heroSkins.push(item);
      else coins.push(item);
      continue;
    }
    if (type === "pack_card") {
      requireFields(index, { id, name, golden, set, openedAt, rarity, packId });
      requireEmptyFields(index, { normal });
      if (!isCardRarity(rarity)) throw new Error(`CSV 第 ${index + 2} 行稀有度无效`);
      if (!Number.isFinite(Date.parse(openedAt!))) throw new Error(`CSV 第 ${index + 2} 行开包时间无效`);
      const isGolden = parseCsvBoolean(golden!, index);
      const current = packs.get(packId!);
      if (current && (current.set !== set || current.openedAt !== openedAt)) {
        throw new Error(`CSV 第 ${index + 2} 行的卡包分组信息冲突`);
      }
      const pack = current ?? { id: packId!, set: set!, openedAt: openedAt!, cards: [] };
      pack.cards.push({ cardId: id!, name: name!, rarity, golden: isGolden });
      packs.set(packId!, pack);
      continue;
    }
    throw new Error(`CSV 第 ${index + 2} 行 type 无效`);
  }

  return parseCollectionSnapshot({
    cards,
    packs: [...packs.values()],
    pity: [],
    cardBacks,
    heroSkins,
    coins,
    updatedAt: new Date().toISOString(),
    source: "import"
  });
}

export function parseCollectionSnapshot(value: unknown): CollectionSnapshot {
  if (!isRecord(value)) throw new Error("收藏快照必须是对象");
  if (!Array.isArray(value.cards) || !Array.isArray(value.packs) || !Array.isArray(value.pity) ||
      !Array.isArray(value.cardBacks) || !Array.isArray(value.heroSkins) || !Array.isArray(value.coins)) {
    throw new Error("收藏快照列表无效");
  }
  if (!isoDate(value.updatedAt) || !["log", "import", "manual"].includes(String(value.source))) {
    throw new Error("收藏快照来源或时间无效");
  }
  return {
    cards: mergeCards(value.cards.map(parseOwnedCard)),
    packs: dedupe(value.packs.map(parsePack), (entry) => entry.id).sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)),
    pity: dedupe(value.pity.map(parsePity), (entry) => entry.set),
    cardBacks: dedupe(value.cardBacks.map(parseCosmetic), (entry) => entry.id),
    heroSkins: dedupe(value.heroSkins.map(parseCosmetic), (entry) => entry.id),
    coins: dedupe(value.coins.map(parseCosmetic), (entry) => entry.id),
    updatedAt: value.updatedAt,
    source: value.source as CollectionSource
  };
}

export function parsePackOpeningRecord(value: unknown): PackOpeningRecord {
  return parsePack(value);
}

function parseOwnedCard(value: unknown): OwnedCard {
  if (!isRecord(value) || !nonEmpty(value.cardId) || !count(value.normal) || !count(value.golden)) {
    throw new Error("卡牌数量或标识无效");
  }
  if (value.name !== undefined && typeof value.name !== "string") throw new Error("卡牌名称无效");
  return { cardId: value.cardId, ...(value.name ? { name: value.name } : {}), normal: value.normal, golden: value.golden };
}
function parsePack(value: unknown): PackOpeningRecord {
  if (!isRecord(value) || !nonEmpty(value.id) || !nonEmpty(value.set) || !isoDate(value.openedAt) || !Array.isArray(value.cards)) {
    throw new Error("开包记录无效");
  }
  return { id: value.id, set: value.set, openedAt: value.openedAt, cards: value.cards.map(parseOpenedCard) };
}
function parseOpenedCard(value: unknown): OpenedPackCard {
  if (!isRecord(value) || !["common", "rare", "epic", "legendary"].includes(String(value.rarity))) throw new Error("开包稀有度无效");
  if (value.cardId !== undefined && typeof value.cardId !== "string") throw new Error("开包卡牌 ID 无效");
  if (value.name !== undefined && typeof value.name !== "string") throw new Error("开包卡牌名称无效");
  if (value.golden !== undefined && typeof value.golden !== "boolean") throw new Error("开包金色标记无效");
  return { rarity: value.rarity as CardRarity, ...(value.cardId ? { cardId: value.cardId } : {}), ...(value.name ? { name: value.name } : {}), ...(value.golden !== undefined ? { golden: value.golden } : {}) };
}
function parsePity(value: unknown): PackPityCounter {
  if (!isRecord(value) || !nonEmpty(value.set) || !count(value.packsSinceLegendary) || typeof value.partial !== "boolean") throw new Error("保底计数无效");
  if (value.packsSinceEpic !== undefined && !count(value.packsSinceEpic)) throw new Error("史诗保底计数无效");
  if (value.epicLimit !== undefined && value.epicLimit !== 10) throw new Error("史诗保底上限无效");
  if (value.legendaryLimit !== undefined && value.legendaryLimit !== 40) throw new Error("传说保底上限无效");
  return { set: value.set, ...(value.packsSinceEpic !== undefined ? { packsSinceEpic: value.packsSinceEpic } : {}), packsSinceLegendary: value.packsSinceLegendary, ...(value.epicLimit !== undefined ? { epicLimit: 10 } : {}), ...(value.legendaryLimit !== undefined ? { legendaryLimit: 40 } : {}), partial: value.partial };
}
function parseCosmetic(value: unknown): CosmeticItem {
  if (!isRecord(value) || !nonEmpty(value.id) || !nonEmpty(value.name)) throw new Error("装饰品无效");
  return { id: value.id, name: value.name };
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (quoteClosed && character !== "," && character !== "\r" && character !== "\n") {
      throw new Error("CSV 引号后包含非法字符");
    }
    if (character === '"') {
      if (field !== "" || quoteClosed) throw new Error("CSV 引号位置无效");
      quoted = true;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      quoteClosed = false;
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      quoteClosed = false;
      continue;
    }
    field += character;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  if (field !== "" || row.length > 0 || quoteClosed) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function requireFields(rowIndex: number, fields: Record<string, string | undefined>) {
  const missing = Object.entries(fields).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`CSV 第 ${rowIndex + 2} 行缺少 ${missing.join(",")}`);
}
function requireEmptyFields(rowIndex: number, fields: Record<string, string | undefined>) {
  const unexpected = Object.entries(fields).filter(([, value]) => value !== "").map(([key]) => key);
  if (unexpected.length) throw new Error(`CSV 第 ${rowIndex + 2} 行不应包含 ${unexpected.join(",")}`);
}
function parseCsvCount(value: string, rowIndex: number) {
  if (!/^\d+$/.test(value)) throw new Error(`CSV 第 ${rowIndex + 2} 行卡牌数量无效`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`CSV 第 ${rowIndex + 2} 行卡牌数量无效`);
  return parsed;
}
function parseCsvBoolean(value: string, rowIndex: number) {
  if (value.toLocaleLowerCase() === "true") return true;
  if (value.toLocaleLowerCase() === "false") return false;
  throw new Error(`CSV 第 ${rowIndex + 2} 行布尔值无效`);
}
function isCardRarity(value: string | undefined): value is CardRarity {
  return value === "common" || value === "rare" || value === "epic" || value === "legendary";
}
function mergeCards(cards: readonly OwnedCard[]): OwnedCard[] {
  const merged = new Map<string, OwnedCard>();
  for (const card of cards) {
    const current = merged.get(card.cardId);
    merged.set(card.cardId, current
      ? { cardId: card.cardId, name: card.name ?? current.name, normal: current.normal + card.normal, golden: current.golden + card.golden }
      : card);
  }
  return [...merged.values()].sort((a, b) => a.cardId.localeCompare(b.cardId));
}
function dedupe<T>(values: readonly T[], key: (value: T) => string): T[] { return [...new Map(values.map((value) => [key(value), value])).values()]; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isoDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
