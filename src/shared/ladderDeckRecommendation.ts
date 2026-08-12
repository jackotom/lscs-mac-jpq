import { decode } from "deckstrings";

export type LadderMode = "standard" | "wild";

export interface LadderDeckCard { readonly name: string; readonly count: number; readonly cost?: number }
export interface LadderDeckRecommendation {
  readonly id: string; readonly mode: LadderMode; readonly region: "CN" | "GLOBAL"; readonly patch: string;
  readonly name: string; readonly className: string; readonly winRate: number; readonly games: number;
  readonly deckCode: string; readonly cards: readonly LadderDeckCard[];
  readonly source: { readonly name: string; readonly url: string }; readonly updatedAt: string;
}
export type LadderDeckRecommendationErrorCode =
  | "installation-not-found" | "version-unreadable" | "region-unverified" | "source-unconfigured"
  | "network-failed" | "feed-invalid" | "patch-unavailable";
export type LadderDeckRecommendationResult =
  | {
      readonly status: "ready";
      readonly recommendation: LadderDeckRecommendation;
      readonly stale: boolean;
      readonly source?: LadderDeckRecommendation["source"];
      readonly fetchedAt?: string;
      readonly sample?: number;
      readonly gameVersion?: string;
      readonly message?: string;
    }
  | { readonly status: "unavailable"; readonly errorCode?: LadderDeckRecommendationErrorCode; readonly message: string; readonly gameVersion?: string };

interface ParseOptions { readonly now?: () => number; readonly maxFutureSkewMs?: number; readonly maxDataAgeMs?: number }

export function parseLadderDeckRecommendations(input: unknown, options: ParseOptions = {}): LadderDeckRecommendation[] {
  if (!isRecord(input) || input.schemaVersion !== 1) throw new Error("schemaVersion 必须为 1");
  if (input.region !== "CN") throw new Error("数据顶层未明确标记为国服");
  const patch = requiredString(input.patch, "数据版本");
  const generatedAt = validDate(input.generatedAt, "生成时间");
  const now = (options.now ?? Date.now)();
  if (generatedAt > now + (options.maxFutureSkewMs ?? 5 * 60_000)) throw new Error("数据生成时间不能在未来");
  const maxDataAgeMs = options.maxDataAgeMs ?? 48 * 60 * 60_000;
  if (now - generatedAt > maxDataAgeMs) throw new Error("数据生成时间已过期");
  parseSource(input.source);
  if (!Array.isArray(input.decks)) throw new Error("卡组统计必须包含 decks 数组");
  const valid: LadderDeckRecommendation[] = [];
  const errors: Error[] = [];
  for (const item of input.decks) {
    try {
      const parsed = parseRecommendation(item, now, options.maxFutureSkewMs ?? 5 * 60_000, maxDataAgeMs);
      if (parsed.patch !== patch) throw new Error("卡组版本与数据顶层版本不一致");
      valid.push(parsed);
    } catch (error) { errors.push(error instanceof Error ? error : new Error(String(error))); }
  }
  if (valid.length === 0 && errors.length > 0) throw errors[0];
  return valid;
}

export function selectTopLadderDeck(items: readonly LadderDeckRecommendation[], mode: LadderMode, minGames: number): LadderDeckRecommendation | undefined {
  if (!Number.isInteger(minGames) || minGames < 1) throw new Error("最低统计场次必须是正整数");
  return [...items].filter((item) => item.mode === mode && item.games >= minGames)
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
}

function parseRecommendation(value: unknown, now: number, maxFutureSkewMs: number, maxDataAgeMs: number): LadderDeckRecommendation {
  if (!isRecord(value)) throw new Error("卡组统计记录格式无效");
  if (value.mode !== "standard" && value.mode !== "wild") throw new Error("卡组模式无效");
  if (value.region !== "CN") throw new Error("统计记录未明确标记为国服数据");
  const winRate = finiteNumber(value.winRate, "胜率");
  if (winRate < 0 || winRate > 100) throw new Error("胜率必须在 0 到 100 之间");
  const games = finiteNumber(value.games, "统计场次");
  if (!Number.isInteger(games) || games < 1) throw new Error("统计场次必须是正整数");
  const source = parseSource(value.source);
  const updatedAt = validDate(value.updatedAt, "更新时间");
  if (updatedAt > now + maxFutureSkewMs) throw new Error("卡组更新时间不能在未来");
  if (now - updatedAt > maxDataAgeMs) throw new Error("卡组更新时间已过期");
  if (!Array.isArray(value.cards ?? [])) throw new Error("卡牌列表无效");
  const cards = (value.cards as unknown[] | undefined ?? []).map((card) => {
    if (!isRecord(card)) throw new Error("卡牌记录无效");
    const count = finiteNumber(card.count, "卡牌数量");
    if (!Number.isInteger(count) || count < 1) throw new Error("卡牌数量无效");
    const cost = card.cost === undefined ? undefined : finiteNumber(card.cost, "卡牌费用");
    return { name: requiredString(card.name, "卡牌名称"), count, ...(cost === undefined ? {} : { cost }) };
  });
  const deckCode = requiredString(value.deckCode, "卡组代码");
  try {
    const decoded = decode(deckCode);
    const cardCount = decoded.cards.reduce((sum, [, count]) => sum + count, 0);
    if (cardCount < 1) throw new Error("empty");
  } catch { throw new Error("卡组代码无法解码"); }
  return {
    id: requiredString(value.id, "记录编号"), mode: value.mode, region: "CN", patch: requiredString(value.patch, "游戏版本"),
    name: requiredString(value.name, "卡组名称"), className: requiredString(value.className, "职业"), winRate, games, deckCode, cards,
    source, updatedAt: requiredString(value.updatedAt, "更新时间")
  };
}

function parseSource(value: unknown): { name: string; url: string } {
  if (!isRecord(value)) throw new Error("数据来源无效");
  const url = requiredString(value.url, "来源地址");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("来源地址无效"); }
  if (parsed.protocol !== "https:") throw new Error("来源地址必须使用 HTTPS");
  return { name: requiredString(value.name, "来源名称"), url };
}
function validDate(value: unknown, label: string): number {
  const text = requiredString(value, label); const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error(`${label}无效`); return timestamp;
}
function requiredString(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label}缺失`); return value.trim(); }
function finiteNumber(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}缺失或无效`); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
