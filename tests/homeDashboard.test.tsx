import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeDashboard } from "../src/renderer/components/HomeDashboard";
import type { LadderDeckRecommendationResult } from "../src/shared/ladderDeckRecommendation";
import type { ArenaHeroWinRateRankingResult } from "../src/shared/arenaHeroStats";
import type { MatchHistoryResult, PublicTrackerState } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

const liveState = createPublicTrackerState({
  status: "watching",
  gameActive: true,
  trackerMode: "arena",
  deckName: "真实竞技场套牌",
  deck: [
    { name: "火球术", cardId: "CS2_029", count: 2, remaining: 1, drawn: 1, played: 0 },
    { name: "寒冰箭", cardId: "CS2_024", count: 2, remaining: 2, drawn: 0, played: 0 }
  ],
  events: [],
  summary: { totalCards: 30, remainingCards: 27, drawnCards: 3, opponentPlayedCount: 2 },
  arena: {
    status: "drafting",
    hero: { name: "法师" },
    currentChoices: [],
    picks: [],
    deck: [{ name: "已确认牌", count: 18 }],
    draftCount: 18,
    unresolvedCount: 12,
    scoreSource: "HearthArena 简中"
  }
});

const history: MatchHistoryResult = {
  status: "ok",
  matches: [
    { id: "older", result: "loss", mode: "wild", deckName: "奥秘法", endedAt: "2026-07-21T10:00:00.000Z" },
    { id: "newer", result: "win", mode: "arena", deckName: "上一副竞技场套牌", endedAt: "2026-07-22T04:00:00.000Z" }
  ],
  summary: { total: 2, wins: 1, losses: 1, ties: 0, winRate: 0.5 }
};

const ladder: LadderDeckRecommendationResult = {
  status: "ready",
  stale: false,
  gameVersion: "31.2.2",
  recommendation: {
    id: "real-standard",
    mode: "standard",
    region: "CN",
    patch: "31.2.2",
    name: "当前版本真实推荐",
    className: "死亡骑士",
    winRate: 56.3,
    games: 1248,
    deckCode: "REAL-DECK-CODE",
    cards: [],
    source: { name: "国服天梯统计", url: "https://example.com/source" },
    updatedAt: "2026-07-22T03:00:00.000Z"
  }
};

const arenaRanking: ArenaHeroWinRateRankingResult = {
  status: "ok",
  source: "Firestone",
  updatedAt: "2026-07-22T03:00:00.000Z",
  entries: [
    { rank: 1, heroName: "法师", heroClass: "mage", games: 2450, winRate: 61.2 },
    { rank: 2, heroName: "猎人", heroClass: "hunter", games: 1980, winRate: 59.3 }
  ]
};

describe("home dashboard", () => {
  it("keeps the reference home page's key visible copy", () => {
    render(<HomeDashboard state={liveState} />);

    const home = screen.getByRole("region", { name: "首页" });
    expect(within(home).getByText("炉石记牌器")).toBeInTheDocument();
    expect(within(home).getByText("服务正常")).toBeInTheDocument();
    expect(within(home).getByRole("heading", { name: "对局正在记录", level: 1 })).toBeInTheDocument();
    for (const title of ["当前套牌", "炉石资讯", "天梯热门卡组", "竞技场职业胜率排行", "最近对局", "模式统计"]) {
      expect(within(home).getByRole("heading", { name: title })).toBeInTheDocument();
    }
    for (const metric of ["今日对局", "总对局", "总胜率", "最佳连胜"]) {
      expect(within(home).getByText(metric)).toBeInTheDocument();
    }
    expect(within(home).getAllByText("当前状态").length).toBeGreaterThan(0);
    expect(within(home).getByRole("button", { name: "打开二级工作台" })).toBeInTheDocument();
  });

  it("reports a non-running tracker service as waiting to start", () => {
    render(<HomeDashboard state={createPublicTrackerState({ status: "idle" })} />);

    const home = screen.getByRole("region", { name: "首页" });
    expect(within(home).getByText("服务待启动")).toBeInTheDocument();
    expect(within(home).queryByText("服务正常")).not.toBeInTheDocument();
  });

  it("shows one calm waiting message after Hearthstone is recognized", () => {
    render(
      <HomeDashboard
        state={{
          ...liveState,
          gameActive: false,
          arena: undefined,
          error: "已识别炉石，等待开局。"
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "已识别炉石，等待开局" })).toBeInTheDocument();
    expect(screen.getByText("服务正常")).toBeInTheDocument();
    expect(screen.queryByText("需要完成日志设置")).not.toBeInTheDocument();
    expect(screen.queryByText(/先点修复日志/)).not.toBeInTheDocument();
  });

  it("renders four real data areas and copies the trusted recommendation code", async () => {
    const onCopy = vi.fn(async () => undefined);
    const onOpenTracker = vi.fn();
    render(
      <HomeDashboard
        state={liveState}
        matchHistory={history}
        ladderRecommendation={ladder}
        arenaHeroRanking={{ ...arenaRanking, sample: 947_488 }}
        onCopyLadderDeckCode={onCopy}
        onOpenTracker={onOpenTracker}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(onOpenTracker).toHaveBeenCalledOnce();

    for (const panelName of ["炉石资讯", "天梯热门卡组", "当前套牌", "竞技场职业胜率排行", "最近对局"]) {
      expect(screen.getByRole("heading", { name: panelName })).toBeInTheDocument();
    }

    const recentMatches = screen.getByRole("heading", { name: "最近对局" }).closest("article");
    expect(recentMatches).toHaveTextContent("竞技场上一副竞技场套牌胜利");

    const ladderPanel = screen.getByRole("heading", { name: "天梯热门卡组" }).closest("article")!;
    expect(ladderPanel).toHaveTextContent("当前版本真实推荐");
    expect(ladderPanel).toHaveTextContent("胜率56.3%");
    expect(ladderPanel).toHaveTextContent("场次1,248");
    expect(ladderPanel).toHaveTextContent("来源：国服天梯统计");
    expect(ladderPanel).toHaveTextContent("来源可追溯 · 样本 1,248 场");
    expect(within(ladderPanel).getByText(/更新：07\/22/)).toHaveAttribute("datetime", "2026-07-22T03:00:00.000Z");
    fireEvent.click(within(ladderPanel).getByRole("button", { name: "复制卡组代码" }));
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith("REAL-DECK-CODE"));
    expect(within(ladderPanel).getByRole("button", { name: "已复制" })).toBeInTheDocument();

    const arena = screen.getByRole("heading", { name: "竞技场职业胜率排行" }).closest("article")!;
    expect(arena).toHaveTextContent("法师2,450 场61.2%");
    expect(arena).toHaveTextContent("猎人1,980 场59.3%");
    expect(arena).toHaveTextContent("来源：Firestone");
    expect(arena).toHaveTextContent("公开统计 · 样本 947,488 场");
    expect(within(arena).getByText(/更新：07\/22/)).toHaveAttribute("datetime", "2026-07-22T03:00:00.000Z");

    const deck = screen.getByRole("heading", { name: "当前套牌" }).closest("article")!;
    expect(deck).toHaveTextContent("真实竞技场套牌");
    expect(deck).toHaveTextContent("剩余27");
    expect(deck).toHaveTextContent("火球术×1");
  });

  it("shows explicit empty and unavailable states without fake values", () => {
    const emptyState = createPublicTrackerState({
      status: "missing-log",
      error: "缺少 Power.log。",
      deck: [],
      events: [],
      summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 }
    });
    const unavailable: LadderDeckRecommendationResult = {
      status: "unavailable",
      errorCode: "patch-unavailable",
      message: "当前版本没有可信的国服数据。"
    };

    render(<HomeDashboard state={emptyState} ladderRecommendation={unavailable} />);

    expect(screen.getByRole("heading", { name: "需要完成日志设置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最近对局" }).closest("article")).toHaveTextContent("还没有已完成的对局记录。");
    expect(screen.getByRole("heading", { name: "天梯热门卡组" }).closest("article")).toHaveTextContent("当前版本没有可信的国服数据。");
    expect(screen.getByRole("heading", { name: "竞技场职业胜率排行" }).closest("article")).toHaveTextContent("竞技场排行尚未加载。");
    expect(screen.getByRole("heading", { name: "当前套牌" }).closest("article")).toHaveTextContent("还没有可用的 Power.log。");
    expect(screen.queryByRole("button", { name: "复制卡组代码" })).not.toBeInTheDocument();
  });

  it("distinguishes an initial history read from a failed read", () => {
    const preview = render(<HomeDashboard state={liveState} matchHistoryLoading />);
    const activity = screen.getByRole("heading", { name: "最近对局" }).closest("article")!;

    expect(within(activity).getByRole("status")).toHaveTextContent("正在读取最近对局…");
    expect(screen.queryByText("尚未读取对局历史。")).not.toBeInTheDocument();

    preview.rerender(<HomeDashboard state={liveState} matchHistoryError="读取对局历史失败，请稍后重试。" />);
    expect(within(activity).getByRole("alert")).toHaveTextContent("读取对局历史失败，请稍后重试。");
  });

  it("reports a failed history read in mode statistics", () => {
    render(<HomeDashboard state={liveState} matchHistoryError="读取对局历史失败，请稍后重试。" />);

    const modeStats = screen.getByRole("heading", { name: "模式统计" }).closest("article")!;
    expect(within(modeStats).getByRole("alert")).toHaveTextContent("对局历史读取失败，模式统计暂不可用。");
    expect(modeStats).not.toHaveTextContent("完成对局后会显示真实模式统计。");
  });

  it("uses current real tracker data instead of two large empty panels", () => {
    const emptyHistory: MatchHistoryResult = {
      status: "ok",
      matches: [],
      summary: { total: 0, wins: 0, losses: 0, ties: 0, winRate: 0 }
    };
    const unavailable: LadderDeckRecommendationResult = {
      status: "unavailable",
      errorCode: "source-unconfigured",
      message: "暂无经过验证的国服公开统计接口。"
    };

    render(
      <HomeDashboard
        state={{ ...liveState, gameActive: false }}
        matchHistory={emptyHistory}
        ladderRecommendation={unavailable}
        arenaHeroRanking={arenaRanking}
      />
    );

    expect(screen.getByRole("heading", { name: "竞技场职业胜率排行" }).closest("article")).toHaveTextContent("法师2,450 场61.2%");
    expect(screen.getByRole("heading", { name: "天梯热门卡组" }).closest("article")).toHaveTextContent("暂无经过验证的国服公开统计接口。");
  });

  it("shows an explicit empty state when the arena ranking has no entries", () => {
    render(
      <HomeDashboard
        state={liveState}
        arenaHeroRanking={{ ...arenaRanking, entries: [] }}
      />
    );

    const arenaPanel = screen.getByRole("heading", { name: "竞技场职业胜率排行" }).closest("article")!;
    expect(within(arenaPanel).getByRole("status")).toHaveTextContent("当前没有可用的竞技场排行数据。");
  });

  it("keeps source metadata readable with long labels and warnings", () => {
    render(
      <HomeDashboard
        state={liveState}
        ladderRecommendation={{
          ...ladder,
          stale: true,
          recommendation: {
            ...ladder.recommendation,
            source: { name: "经过校验的国服公开天梯统计数据", url: "https://example.com/source" }
          }
        }}
        arenaHeroRanking={{
          ...arenaRanking,
          source: "公开竞技场统计数据",
          warning: "部分低样本英雄仅供参考"
        }}
      />
    );

    const ladderPanel = screen.getByRole("heading", { name: "天梯热门卡组" }).closest("article")!;
    expect(ladderPanel).toHaveTextContent("来源：经过校验的国服公开天梯统计数据");
    expect(ladderPanel).toHaveTextContent("缓存数据 · 样本 1,248 场");

    const arenaPanel = screen.getByRole("heading", { name: "竞技场职业胜率排行" }).closest("article")!;
    expect(arenaPanel).toHaveTextContent("来源：公开竞技场统计数据");
    expect(within(arenaPanel).getByRole("note")).toHaveTextContent("部分低样本英雄仅供参考");
  });

  it("shows recent real tracker events when no completed match exists", () => {
    const emptyHistory: MatchHistoryResult = {
      status: "ok",
      matches: [],
      summary: { total: 0, wins: 0, losses: 0, ties: 0, winRate: 0 }
    };
    const state: PublicTrackerState = {
      ...liveState,
      events: [{ id: "draw-1", at: "12:03:00", kind: "draw", player: "friendly", cardName: "火球术" }]
    };

    render(<HomeDashboard state={state} matchHistory={emptyHistory} />);

    const activity = screen.getByRole("heading", { name: "炉石资讯" }).closest("article");
    expect(activity).toHaveTextContent("抽到 火球术");
    expect(within(activity!).getByText("12:03", { selector: "time" })).toBeInTheDocument();
  });

  it("formats valid event times and labels malformed times as unknown", () => {
    const state: PublicTrackerState = {
      ...liveState,
      events: [
        { id: "clock", at: "12:03:00", kind: "draw", player: "friendly", cardName: "时钟牌" },
        { id: "iso", at: "2026-08-11T03:04:00.000Z", kind: "draw", player: "friendly", cardName: "日期牌" },
        { id: "invalid", at: "not-a-time", kind: "draw", player: "friendly", cardName: "坏格式牌" },
        { id: "bad-seconds", at: "12:03:99", kind: "draw", player: "friendly", cardName: "坏秒数牌" }
      ]
    };

    render(<HomeDashboard state={state} />);

    const newsPanel = screen.getByRole("heading", { name: "炉石资讯" }).closest("article")!;
    const eventTimes = [...newsPanel.querySelectorAll("time")].map((element) => element.textContent);
    expect(eventTimes).toContain("12:03");
    expect(eventTimes.filter((value) => value === "时间未知")).toHaveLength(2);
    expect(eventTimes.filter((value) => /^\d{2}:\d{2}$/.test(value ?? ""))).toHaveLength(2);
  });

  it("shows a news read failure even when local tracker events are available", () => {
    const state: PublicTrackerState = {
      ...liveState,
      events: [{ id: "draw-1", at: "12:03:00", kind: "draw", player: "friendly", cardName: "火球术" }]
    };

    render(
      <HomeDashboard
        state={state}
        homeNewsError="炉石资讯读取失败，请稍后重试。"
      />
    );

    const newsPanel = screen.getByRole("heading", { name: "炉石资讯" }).closest("article")!;
    expect(within(newsPanel).getByRole("alert")).toHaveTextContent("炉石资讯读取失败，请稍后重试。");
    expect(newsPanel).toHaveTextContent("抽到 火球术");
  });

  it("keeps a news action failure visible beside already loaded news", () => {
    const onOpenNewsItem = vi.fn(async () => undefined);
    render(
      <HomeDashboard
        state={liveState}
        homeNews={{
          status: "fresh",
          source: "暴雪炉石官网",
          sourceUrl: "https://hearthstone.blizzard.com/en-us/news",
          fetchedAt: "2026-08-11T00:00:00.000Z",
          items: [{
            id: "official-news-1",
            title: "已加载的官网资讯",
            summary: "官网资讯摘要",
            url: "https://hearthstone.blizzard.com/en-us/news/1",
            imageUrl: "https://images.example.com/hearthstone-news.jpg",
            publishedAt: "2026-08-10T00:00:00.000Z"
          }]
        }}
        homeNewsError="打开资讯失败，请稍后重试。"
        onOpenNewsItem={onOpenNewsItem}
      />
    );

    const newsPanel = screen.getByRole("heading", { name: "炉石资讯" }).closest("article")!;
    expect(within(newsPanel).getByRole("alert")).toHaveTextContent("打开资讯失败，请稍后重试。");
    expect(newsPanel).toHaveTextContent("已加载的官网资讯");
    expect(within(newsPanel).getByRole("img", { name: "已加载的官网资讯 新闻图片" })).toHaveAttribute(
      "src",
      "https://images.example.com/hearthstone-news.jpg"
    );
    fireEvent.click(within(newsPanel).getByRole("button", { name: /已加载的官网资讯/ }));
    expect(onOpenNewsItem).toHaveBeenCalledWith("official-news-1");
    expect(newsPanel).not.toHaveTextContent("来源：暴雪炉石官网");
  });

  it("shows a visual fallback for news without an image", () => {
    render(
      <HomeDashboard
        state={liveState}
        homeNews={{
          status: "fallback",
          source: "暴雪炉石官网",
          sourceUrl: "https://hearthstone.blizzard.com/en-us/news",
          fetchedAt: "2026-08-11T00:00:00.000Z",
          items: [{
            id: "offline-news-1",
            title: "离线资讯",
            summary: "离线资讯摘要",
            url: "https://hearthstone.blizzard.com/en-us/news/offline",
            publishedAt: "2026-08-09T00:00:00.000Z"
          }]
        }}
      />
    );

    const newsPanel = screen.getByRole("heading", { name: "炉石资讯" }).closest("article")!;
    expect(within(newsPanel).getByRole("img", { name: "离线资讯资讯图片占位" })).toBeInTheDocument();
    expect(newsPanel).not.toHaveTextContent("来源：暴雪炉石官网");
  });

  it("formats history win-rate ratios as percentages while preserving percentage inputs", () => {
    const ratioHistory: MatchHistoryResult = {
      status: "ok",
      matches: history.matches,
      summary: { total: 17, wins: 6, losses: 11, ties: 0, winRate: 6 / 17 }
    };
    const preview = render(<HomeDashboard state={liveState} matchHistory={ratioHistory} />);

    expect(screen.getByText("总胜率").closest("article")).toHaveTextContent("35.3%");

    preview.rerender(
      <HomeDashboard
        state={liveState}
        matchHistory={{
          ...ratioHistory,
          summary: { ...ratioHistory.summary, winRate: 35.3 }
        }}
      />
    );
    expect(screen.getByText("总胜率").closest("article")).toHaveTextContent("35.3%");
  });
});
