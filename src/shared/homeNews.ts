export const OFFICIAL_HOME_NEWS_URL = "https://hs.blizzard.cn/news/";
export const HOME_NEWS_SOURCE_LABEL = "炉石传说国服官网";

export interface HomeNewsItem {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly url: string;
  readonly imageUrl?: string;
  readonly publishedAt: string;
}

export type HomeNewsStatus = "fresh" | "cached" | "fallback";

export interface HomeNewsResult {
  readonly status: HomeNewsStatus;
  readonly items: readonly HomeNewsItem[];
  readonly source: string;
  readonly sourceUrl: typeof OFFICIAL_HOME_NEWS_URL | string;
  readonly fetchedAt: string;
  readonly sample?: number;
  readonly message?: string;
}
