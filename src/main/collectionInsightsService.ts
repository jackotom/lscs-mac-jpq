import {
  parseCollectionSnapshot,
  parseCollectionCsv,
  parsePackOpeningRecord,
  type CollectionInsightsResult,
  type CollectionSnapshot,
  type PackOpeningRecord,
  type PackPityCounter
} from "../shared/collectionInsights.js";
import { CollectionInsightsStore } from "./collectionInsightsStore.js";

export const EPIC_PITY_TIMER = 10;
export const LEGENDARY_PITY_TIMER = 40;
export const MAX_COLLECTION_CSV_BYTES = 5 * 1024 * 1024;

export function parseCollectionCsvIpcInput(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_COLLECTION_CSV_BYTES) {
    throw new Error("收藏 CSV 无效或超过 5 MB 上限");
  }
  return value;
}

export class CollectionInsightsService {
  private mutationChain: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: CollectionInsightsStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getInsights(): Promise<CollectionInsightsResult> {
    try {
      await this.mutationChain.catch(() => undefined);
      const snapshot = await this.store.read() ?? this.emptySnapshot();
      return { status: "ok", ...snapshot };
    } catch (error) {
      return { status: "error", error: formatError(error), updatedAt: this.now().toISOString() };
    }
  }

  async importSnapshot(value: unknown) {
    return this.mutate(async () => {
      const snapshot = parseCollectionSnapshot(value);
      return this.store.replace({ ...snapshot, source: "import", pity: calculatePity(snapshot.packs) });
    });
  }

  async importCollectionCsv(csvText: string) {
    return this.importSnapshot(parseCollectionCsv(csvText));
  }

  async recordPackOpening(value: unknown, source: "manual" | "log" = "manual") {
    return this.mutate(async () => {
      const pack = parsePackOpeningRecord(value);
      const current = await this.store.read() ?? this.emptySnapshot(source);
      if (current.packs.some((entry) => entry.id === pack.id)) return current;
      const packs = [...current.packs, pack].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
      return this.store.replace({ ...current, packs, pity: calculatePity(packs), source, updatedAt: this.now().toISOString() });
    });
  }

  async updateCosmetics(value: unknown) {
    return this.mutate(async () => {
      if (!isRecord(value)) throw new Error("装饰品更新必须是对象");
      const current = await this.store.read() ?? this.emptySnapshot("manual");
      return this.store.replace({
        ...current,
        ...(value.cardBacks !== undefined ? { cardBacks: value.cardBacks } : {}),
        ...(value.heroSkins !== undefined ? { heroSkins: value.heroSkins } : {}),
        ...(value.coins !== undefined ? { coins: value.coins } : {}),
        source: "manual",
        updatedAt: this.now().toISOString()
      });
    });
  }

  private emptySnapshot(source: CollectionSnapshot["source"] = "manual"): CollectionSnapshot {
    return { cards: [], packs: [], pity: [], cardBacks: [], heroSkins: [], coins: [], updatedAt: this.now().toISOString(), source };
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationChain.catch(() => undefined).then(operation);
    this.mutationChain = result;
    return result;
  }
}

export function calculatePity(packs: readonly PackOpeningRecord[]): PackPityCounter[] {
  const bySet = new Map<string, PackOpeningRecord[]>();
  for (const pack of packs) bySet.set(pack.set, [...(bySet.get(pack.set) ?? []), pack]);
  return [...bySet.entries()].map(([set, records]) => {
    let packsSinceEpic = 0;
    let packsSinceLegendary = 0;
    for (const pack of [...records].sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt))) {
      const legendary = pack.cards.some((card) => card.rarity === "legendary");
      const epic = legendary || pack.cards.some((card) => card.rarity === "epic");
      packsSinceLegendary = legendary ? 0 : packsSinceLegendary + 1;
      packsSinceEpic = epic ? 0 : packsSinceEpic + 1;
    }
    return { set, packsSinceEpic, packsSinceLegendary, epicLimit: EPIC_PITY_TIMER, legendaryLimit: LEGENDARY_PITY_TIMER, partial: true } satisfies PackPityCounter;
  }).sort((a, b) => a.set.localeCompare(b.set));
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function formatError(error: unknown) { return error instanceof Error ? error.message : String(error); }
