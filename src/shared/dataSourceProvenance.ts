export type DataSourceAuthorizationStatus = "authorized" | "pending-confirmation" | "unknown";

export interface DataSourceProvenance {
  readonly id: string;
  readonly label: string;
  readonly urls: readonly string[];
  readonly authorization: {
    readonly status: DataSourceAuthorizationStatus;
    readonly note: string;
  };
}

export const CARD_SOURCE_PROVENANCE = {
  blizzardCn: pending("blizzard-cn-cards", "国服炉石卡牌站", [
    "https://hs.blizzard.cn/cards/",
    "https://webapi.blizzard.cn/hs-cards-api-server/api/web/cards/constructed"
  ], "国服网页与 Web API 的桌面 App 分发范围待确认。"),
  hearthstoneJson: pending("hearthstonejson-cards", "HearthstoneJSON", [
    "https://api.hearthstonejson.com/v1/latest/zhCN/cards.json",
    "https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json",
    "https://art.hearthstonejson.com/"
  ], "服务访问许可不等于底层炉石内容的 App 分发许可，待确认。"),
  firestoneCards: pending("firestone-card-data", "Firestone 中文卡牌库", [
    "https://static.zerotoheroes.com/data/cards/no_audio/cards_zhCN.gz.json",
    "https://static.firestoneapp.com/data/cards/no_audio/cards_zhCN.gz.json"
  ], "现有 Firestone 同意仅覆盖竞技场统计；卡牌 JSON 的独立 App 使用范围待确认。")
} as const;

export const ARENA_SOURCE_PROVENANCE = {
  arenaTracker: pending("arena-tracker-heartharena-json", "Arena-Tracker / HearthArena JSON", [
    "https://raw.githubusercontent.com/supertriodo/Arena-Tracker/master/HearthArena/haVersion.json",
    "https://raw.githubusercontent.com/supertriodo/Arena-Tracker/master/HearthArena/hearthArena.json"
  ], "评分数据的第三方 App 展示与分发范围待确认。"),
  hearthArenaWeb: pending("heartharena-web-tierlist", "HearthArena 网页评分", [
    "https://www.heartharena.com/zh-cn/tierlist",
    "https://www.heartharena.com/zh-tw/tierlist"
  ], "网页评分的第三方 App 展示与缓存范围待确认。"),
  firestoneArena: {
    id: "firestone-arena-statistics",
    label: "Firestone 竞技场统计",
    urls: ["https://static.zerotoheroes.com/api/arena/"] as const,
    authorization: {
      status: "authorized" as const,
      note: "提供方邮件同意当前免费无广告 macOS 记牌器用途；未来可能调整条件，需保留来源和撤销处理。"
    }
  }
} as const;

export function mergeSourceProvenance(sources: readonly DataSourceProvenance[]): readonly DataSourceProvenance[] {
  return [...new Map(sources.map((source) => [source.id, source])).values()];
}

export function formatSourceLabel(sources: readonly DataSourceProvenance[]): string | undefined {
  if (sources.length === 0) return undefined;
  const labels = sources.map((source) => source.label);
  return labels.length === 1 ? labels[0] : `混合来源：${labels.join(" + ")}`;
}

function pending(id: string, label: string, urls: readonly string[], note: string): DataSourceProvenance {
  return { id, label, urls, authorization: { status: "pending-confirmation", note } };
}
