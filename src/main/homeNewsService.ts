import {
  HOME_NEWS_SOURCE_LABEL,
  OFFICIAL_HOME_NEWS_URL,
  type HomeNewsItem,
  type HomeNewsResult
} from "../shared/homeNews.js";

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_NEWS_ITEMS = 12;
const MAX_TITLE_LENGTH = 180;
const MAX_SUMMARY_LENGTH = 420;
const MAX_ID_LENGTH = 120;
const OFFICIAL_ARTICLE_HOSTS = new Set(["hs.blizzard.cn", "hearthstone.blizzard.com", "playhearthstone.com"]);
const OFFICIAL_IMAGE_HOSTS = new Set([
  "nie.res.netease.com",
  "hs.res.netease.com",
  "hearthstone.blizzard.com",
  "bnetcmsus-a.akamaihd.net",
  "blz-contentstack-images.akamaized.net"
]);
const OFFICIAL_IMAGE_PATH_PATTERN = /\.(?:avif|gif|jpe?g|png|webp)$/i;

const FALLBACK_ITEMS: readonly HomeNewsItem[] = Object.freeze([
  Object.freeze({
    id: "official-news-temporarily-unavailable",
    title: "暴雪炉石新闻暂时无法更新",
    summary: "网络恢复后会自动显示最新官方资讯，也可以稍后前往暴雪炉石官网查看。",
    url: OFFICIAL_HOME_NEWS_URL,
    publishedAt: "2026-01-01T00:00:00.000Z"
  })
]);

interface HomeNewsServiceOptions {
  readonly sourceUrl?: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}

interface HomeNewsCache {
  readonly items: readonly HomeNewsItem[];
  readonly fetchedAt: string;
  readonly expiresAt: number;
}

export class HomeNewsService {
  private readonly sourceUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cache: HomeNewsCache | undefined;
  private refreshInFlight: Promise<HomeNewsResult> | undefined;

  constructor(options: HomeNewsServiceOptions = {}) {
    this.sourceUrl = parseConfiguredSourceUrl(options.sourceUrl ?? OFFICIAL_HOME_NEWS_URL);
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = parsePositiveLimit(options.timeoutMs, DEFAULT_TIMEOUT_MS, 30_000);
    this.maxResponseBytes = parsePositiveLimit(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      2 * 1024 * 1024
    );
    this.cacheTtlMs = parsePositiveLimit(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS, 60 * 60 * 1000);
    this.now = options.now ?? Date.now;
  }

  async load(): Promise<HomeNewsResult> {
    const now = this.now();
    if (this.cache && now < this.cache.expiresAt) {
      return this.createResult("cached", this.cache.items, this.cache.fetchedAt);
    }

    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    const refresh = this.refresh();
    this.refreshInFlight = refresh;
    try {
      return await refresh;
    } finally {
      if (this.refreshInFlight === refresh) {
        this.refreshInFlight = undefined;
      }
    }
  }

  private async refresh(): Promise<HomeNewsResult> {
    try {
      const { body, contentType } = await this.fetchOfficialPage();
      const items = contentType.includes("application/json")
        ? parseHomeNewsPayload(JSON.parse(body) as unknown)
        : parseOfficialHomeNewsHtml(body);
      if (items.length === 0) {
        throw new Error("官网新闻页没有可用资讯");
      }

      const fetchedAt = new Date(this.now()).toISOString();
      this.cache = {
        items,
        fetchedAt,
        expiresAt: this.now() + this.cacheTtlMs
      };
      return this.createResult("fresh", items, fetchedAt);
    } catch {
      return this.createResult(
        "fallback",
        FALLBACK_ITEMS,
        new Date(this.now()).toISOString(),
        "官方新闻暂时无法更新，请检查网络后稍后再试。"
      );
    }
  }

  private async fetchOfficialPage(): Promise<{ readonly body: string; readonly contentType: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.sourceUrl, {
        method: "GET",
        headers: {
          accept: "text/html, application/json;q=0.9",
          "accept-language": "zh-CN,zh;q=0.9"
        },
        redirect: "error",
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      validateFinalResponseUrl(response.url, this.sourceUrl);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/json")) {
        throw new Error("官网新闻响应类型无效");
      }
      const body = await readResponseWithLimit(response, this.maxResponseBytes);
      return { body, contentType };
    } finally {
      clearTimeout(timeout);
    }
  }

  private createResult(
    status: HomeNewsResult["status"],
    items: readonly HomeNewsItem[],
    fetchedAt: string,
    message?: string
  ): HomeNewsResult {
    return {
      status,
      items,
      source: HOME_NEWS_SOURCE_LABEL,
      sourceUrl: this.sourceUrl,
      fetchedAt,
      sample: items.length,
      ...(message ? { message } : {})
    };
  }
}

export function parseOfficialHomeNewsHtml(html: string): readonly HomeNewsItem[] {
  const articles: unknown[] = [];
  articles.push(...parseChineseOfficialNewsList(html));
  articles.push(...parseStickyBlogList(html));
  articles.push(...parseJsonLdNewsArticles(html));
  return parseHomeNewsPayload({ articles });
}

function parseChineseOfficialNewsList(html: string): readonly unknown[] {
  const starts = [...html.matchAll(/<div\s+class=["']article-item["']\s*>/gi)];
  const articles: unknown[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]?.index;
    if (start === undefined) continue;
    const end = starts[index + 1]?.index ?? html.length;
    const block = html.slice(start, end);
    const url = block.match(/<a\s+href=["']([^"']+)["']/i)?.[1];
    const image = block.match(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/i);
    const imageUrl = image?.[1];
    const imageTag = image?.[0] ?? "";
    const imageAlt = imageTag.match(/\balt=["']([^"']+)["']/i)?.[1];
    const heading = block.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1];
    const title = decodeHtmlText(heading ?? imageAlt);
    const publishedAt = block.match(/\bdata-time=["']([^"']+)["']/i)?.[1]
      ?? block.match(/\bdata-timestamp=["'](\d+)["']/i)?.[1];
    articles.push({
      id: extractArticleId(url),
      title,
      summary: title ? `查看《${title}》的官方完整内容。` : undefined,
      url,
      imageUrl,
      publishedAt
    });
  }
  return articles;
}

export function parseHomeNewsPayload(payload: unknown): readonly HomeNewsItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.articles)) {
    return [];
  }

  const byId = new Map<string, HomeNewsItem>();
  for (const value of payload.articles) {
    const item = parseHomeNewsItem(value);
    if (!item || byId.has(item.id)) {
      continue;
    }
    byId.set(item.id, item);
  }

  return [...byId.values()]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, MAX_NEWS_ITEMS);
}

function parseStickyBlogList(html: string): readonly unknown[] {
  const match = html.match(/\bvar\s+stickyBlogList\s*=\s*(\[[\s\S]*?\]);\s*window\.category\s*=/i);
  if (!match?.[1]) {
    return [];
  }

  try {
    const payload = JSON.parse(match[1]) as unknown;
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload.map((value) => {
      if (!isRecord(value)) return value;
      return {
        id: value.id,
        title: value.title,
        summary: value.summary,
        url: value.defaultUrl,
        imageUrl: findFirstOfficialImageUrl([value.thumbnail, value.header]),
        publishedAt: typeof value.publish === "number"
          ? new Date(value.publish).toISOString()
          : value.publish_details && isRecord(value.publish_details)
            ? value.publish_details.time
            : undefined
      };
    });
  } catch {
    return [];
  }
}

function parseJsonLdNewsArticles(html: string): readonly unknown[] {
  const articles: unknown[] = [];
  const scriptPattern = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    if (!match[1]) continue;
    try {
      collectJsonLdArticles(JSON.parse(match[1]) as unknown, articles, 0);
    } catch {
      // Ignore one malformed metadata block and continue with other official page data.
    }
  }
  return articles;
}

function collectJsonLdArticles(value: unknown, output: unknown[], depth: number): void {
  if (depth > 5 || output.length >= MAX_NEWS_ITEMS * 3) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdArticles(item, output, depth + 1);
    return;
  }
  if (!isRecord(value)) return;

  const type = value["@type"];
  if (type === "NewsArticle" || (Array.isArray(type) && type.includes("NewsArticle"))) {
    output.push({
      id: extractArticleId(value.url),
      title: value.headline,
      summary: value.description,
      url: value.url,
      imageUrl: findFirstOfficialImageUrl(value.image),
      publishedAt: value.datePublished
    });
    return;
  }

  for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
    if (key in value) collectJsonLdArticles(value[key], output, depth + 1);
  }
}

function parseHomeNewsItem(value: unknown): HomeNewsItem | undefined {
  if (!isRecord(value)) return undefined;

  const id = normalizeText(value.id, MAX_ID_LENGTH);
  const title = normalizeText(value.title, MAX_TITLE_LENGTH);
  const summary = normalizeText(value.summary, MAX_SUMMARY_LENGTH);
  const url = parseOfficialArticleUrl(value.url);
  const publishedAt = parsePublishedAt(value.publishedAt);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || !title || !summary || !url || !publishedAt) {
    return undefined;
  }

  const imageUrl = parseOfficialImageUrl(value.imageUrl);
  return {
    id,
    title,
    summary,
    url,
    ...(imageUrl ? { imageUrl } : {}),
    publishedAt
  };
}

function parseConfiguredSourceUrl(value: string): string {
  if (value.length > 2048) throw new Error("新闻来源地址过长");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw new Error("新闻来源地址无效");
  }
  return url.toString();
}

function validateFinalResponseUrl(responseUrl: string, requestedUrl: string): void {
  if (!responseUrl) return;
  const actual = parseConfiguredSourceUrl(responseUrl);
  const expected = parseConfiguredSourceUrl(requestedUrl);
  if (actual !== expected) {
    throw new Error("新闻来源发生了未授权跳转");
  }
}

function parseOfficialArticleUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !OFFICIAL_ARTICLE_HOSTS.has(url.hostname)
    ) {
      return undefined;
    }
    if (url.hostname === "hs.blizzard.cn") {
      if (!/^\/news(?:\/|$)/i.test(url.pathname)) return undefined;
    } else if (!/^\/[a-z]{2}-[a-z]{2}\/(?:news|blog)(?:\/|$)/i.test(url.pathname)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function parseOfficialImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !OFFICIAL_IMAGE_HOSTS.has(url.hostname) ||
      !OFFICIAL_IMAGE_PATH_PATTERN.test(url.pathname)
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function parsePublishedAt(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) return undefined;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return undefined;
  }
}

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maxLength) return undefined;
  return normalized;
}

function findFirstOfficialImageUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 3) return undefined;

  const directUrl = parseOfficialImageUrl(value);
  if (directUrl) return directUrl;

  if (Array.isArray(value)) {
    for (const candidate of value) {
      const imageUrl = findFirstOfficialImageUrl(candidate, depth + 1);
      if (imageUrl) return imageUrl;
    }
    return undefined;
  }

  if (!isRecord(value)) return undefined;
  for (const key of ["url", "contentUrl"]) {
    const imageUrl = findFirstOfficialImageUrl(value[key], depth + 1);
    if (imageUrl) return imageUrl;
  }
  return undefined;
}

function extractArticleId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const segments = new URL(value).pathname.split("/").filter(Boolean);
    const candidate = [...segments].reverse().find((segment) => /\d{5,}/.test(segment));
    return candidate?.match(/\d{5,}/)?.[0];
  } catch {
    return undefined;
  }
}

function decodeHtmlText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error("官网新闻响应超过大小限制");
    }
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error("官网新闻响应超过大小限制");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      throw new Error("官网新闻响应超过大小限制");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

function parsePositiveLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error("新闻服务限制参数无效");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
