import { describe, expect, it, vi } from "vitest";
import {
  HomeNewsService,
  parseHomeNewsPayload,
  parseOfficialHomeNewsHtml
} from "../src/main/homeNewsService.js";

const sourceUrl = "https://example.com/hearthstone-news.json";

describe("home news service", () => {
  it("parses the official Chinese mainland news list with Chinese titles and images", () => {
    const html = `
      <div class="article-item">
        <a href="https://hs.blizzard.cn/news/24290432/index.html">
          <div class="article-img">
            <img src="https://nie.res.netease.com/r/pic/20260804/official.jpg" alt="36.2补丁说明" />
          </div>
          <div class="article-title"><h4>36.2补丁说明</h4></div>
          <div class="preDate" data-time="2026-08-04"></div>
        </a>
      </div>
    `;

    expect(parseOfficialHomeNewsHtml(html)).toEqual([
      expect.objectContaining({
        id: "24290432",
        title: "36.2补丁说明",
        url: "https://hs.blizzard.cn/news/24290432/index.html",
        imageUrl: "https://nie.res.netease.com/r/pic/20260804/official.jpg",
        publishedAt: "2026-08-04T00:00:00.000Z"
      })
    ]);
  });

  it("parses valid news, drops unsafe records, and sorts newest first", () => {
    const result = parseHomeNewsPayload({
      articles: [
        {
          id: "older",
          title: "  竞技场更新说明  ",
          summary: "  新赛季已经开始。  ",
          url: "https://hearthstone.blizzard.com/zh-cn/news/older",
          imageUrl: "https://images.example.com/older.jpg",
          publishedAt: "2026-08-09T08:00:00.000Z"
        },
        {
          id: "unsafe",
          title: "不安全链接",
          summary: "不应进入首页。",
          url: "javascript:alert(1)",
          publishedAt: "2026-08-11T08:00:00.000Z"
        },
        {
          id: "newer",
          title: "全新扩展包现已上线",
          summary: "查看新卡与活动。",
          url: "https://hearthstone.blizzard.com/zh-cn/news/newer",
          publishedAt: "2026-08-10T08:00:00.000Z"
        }
      ]
    });

    expect(result).toEqual([
      expect.objectContaining({ id: "newer", title: "全新扩展包现已上线" }),
      expect.objectContaining({
        id: "older",
        title: "竞技场更新说明",
        summary: "新赛季已经开始。",
        url: "https://hearthstone.blizzard.com/zh-cn/news/older"
      })
    ]);
    expect(result.find((item) => item.id === "older")?.imageUrl).toBeUndefined();
  });

  it("extracts the current official thumbnail field and propagates its trusted URL", () => {
    const html = `
      <script>
        var stickyBlogList = ${JSON.stringify([
          {
            id: "24290432",
            title: "36.2 Patch Notes",
            summary: "A new Hearthstone balance update.",
            defaultUrl: "https://playhearthstone.com/en-us/blog/24290432",
            thumbnail: {
              url: "https://bnetcmsus-a.akamaihd.net/cms/blog_thumbnail/m6/official.jpg"
            },
            header: {
              url: "https://bnetcmsus-a.akamaihd.net/cms/blog_header/lo/header.jpg"
            },
            publish: 1_785_776_100_000
          }
        ])};
        window.category = "news";
      </script>
    `;

    expect(parseOfficialHomeNewsHtml(html)).toEqual([
      expect.objectContaining({
        id: "24290432",
        imageUrl: "https://bnetcmsus-a.akamaihd.net/cms/blog_thumbnail/m6/official.jpg"
      })
    ]);
  });

  it("falls back from an unsafe thumbnail to the trusted official header image", () => {
    const html = `
      <script>
        var stickyBlogList = ${JSON.stringify([
          {
            id: "24290433",
            title: "Arena Update",
            summary: "Arena changes are live.",
            defaultUrl: "https://playhearthstone.com/en-us/blog/24290433",
            thumbnail: { url: "https://tracking.example.com/news.jpg" },
            header: {
              url: "https://bnetcmsus-a.akamaihd.net/cms/blog_header/aa/fallback.png"
            },
            publish: 1_785_776_100_000
          }
        ])};
        window.category = "news";
      </script>
    `;

    expect(parseOfficialHomeNewsHtml(html)[0]?.imageUrl).toBe(
      "https://bnetcmsus-a.akamaihd.net/cms/blog_header/aa/fallback.png"
    );
  });

  it("uses the first trusted JSON-LD image and ignores unsafe candidates", () => {
    const html = `
      <script type="application/ld+json">
        ${JSON.stringify({
          "@type": "NewsArticle",
          url: "https://playhearthstone.com/en-us/blog/24290434",
          headline: "Official Tournament News",
          description: "Tournament details.",
          image: [
            "javascript:alert(1)",
            { url: "https://bnetcmsus-a.akamaihd.net/cms/blog_header/bb/tournament.webp" }
          ],
          datePublished: "2026-08-12T00:00:00.000Z"
        })}
      </script>
    `;

    expect(parseOfficialHomeNewsHtml(html)[0]?.imageUrl).toBe(
      "https://bnetcmsus-a.akamaihd.net/cms/blog_header/bb/tournament.webp"
    );
  });

  it("passes a trusted image URL through the service result", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          articles: [
            {
              id: "24290435",
              title: "Trusted Image News",
              summary: "Official image propagation.",
              url: "https://playhearthstone.com/en-us/blog/24290435",
              imageUrl:
                "https://blz-contentstack-images.akamaized.net/v3/assets/news/official.avif",
              publishedAt: "2026-08-12T01:00:00.000Z"
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    const service = new HomeNewsService({ sourceUrl, fetcher: fetcher as typeof fetch });

    await expect(service.load()).resolves.toMatchObject({
      status: "fresh",
      sample: 1,
      items: [
        expect.objectContaining({
          id: "24290435",
          imageUrl: "https://blz-contentstack-images.akamaized.net/v3/assets/news/official.avif"
        })
      ]
    });
  });

  it("returns explicit local fallback news when the remote request fails", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    const service = new HomeNewsService({ sourceUrl, fetcher: fetcher as typeof fetch });

    await expect(service.load()).resolves.toMatchObject({
      status: "fallback",
      items: expect.arrayContaining([
        expect.objectContaining({
          title: expect.any(String),
          summary: expect.any(String)
        })
      ]),
      message: expect.stringMatching(/新闻|更新|网络/)
    });
    expect(fetcher).toHaveBeenCalledWith(sourceUrl, expect.anything());
  });
});
