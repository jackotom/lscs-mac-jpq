import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen, CircleHelp, Database, History, Layers3, Minus, Puzzle, Settings, SlidersHorizontal, Swords, Upload, X } from "lucide-react";
import { DeckPanel } from "./components/DeckPanel";
import { EventFeed } from "./components/EventFeed";
import { ArenaPanel } from "./components/ArenaPanel";
import { ArenaChoiceOverlayPanel } from "./components/ArenaChoiceOverlayPanel";
import { ArenaHeroWinRateRankingPanel } from "./components/ArenaHeroWinRateRankingPanel";
import { CardDetailBody } from "./components/CardDetailBody";
import { CardLibraryPanel } from "./components/CardLibraryPanel";
import { MatchHistoryPanel } from "./components/MatchHistoryPanel";
import { HomeDashboard } from "./components/HomeDashboard";
import { SettingsPanel } from "./components/SettingsPanel";
import { OpponentPanel } from "./components/OpponentPanel";
import { OpponentOverlayPanel } from "./components/OpponentOverlayPanel";
import { BoardAttackOverlay } from "./components/BoardAttackOverlay";
import { SecretOverlay } from "./components/SecretOverlay";
import { SingleAttackOverlay } from "./components/SingleAttackOverlay";
import { SmartCounterOverlay } from "./components/SmartCounterOverlay";
import { OverlayPanel } from "./components/OverlayPanel";
import { LadderDeckRecommendationPanel } from "./components/LadderDeckRecommendationPanel";
import { TopBar, trackerStatusLabels } from "./components/TopBar";
import { MatchPulse } from "./components/MatchPulse";
import type { MainView } from "./components/TopBar";
import { toOverlayDeckIdentity, toOverlayPanelViewModel } from "./overlayView";
import { toDashboardOpponentView } from "./dashboardView";
import { shouldApplyInitialTrackerState } from "./stateInitialization";
import { createSynchronousActionLock, selectVisibleNotice, shouldRequestCardLibrary } from "./frontendStability";
import { preserveArenaChoiceStatistics } from "./arenaChoiceStability";
import { parseMatchHistoryResult, parsePublicTrackerState, parseTrackerSettings } from "./runtimeValidation";
import { resolveTrackerTheme } from "./trackerTheme";
import { toMatchPulseViewFromState } from "./matchPulse";
import {
  LEGACY_USED_COUNT_KEY,
  LEGACY_USED_ROWS_KEY,
  type ArenaState,
  type CardTrackerRow,
  type CollectionDeckScanResult,
  type CollectionDeckSummary,
  type LogCandidate,
  type MatchHistoryResult,
  type PublicCardTracking,
  type PublicTrackerState,
  type TrackerEvent,
  type TrackerSettings
} from "../shared/types";
/* card lifecycle migration: legacy payload keys remain only to construct shared-state compatibility objects. */
import type { CardDetails } from "../shared/cardDatabase";
import { HOME_NEWS_SOURCE_LABEL, OFFICIAL_HOME_NEWS_URL, type HomeNewsResult } from "../shared/homeNews";
import type { LadderDeckRecommendation, LadderDeckRecommendationResult, LadderMode } from "../shared/ladderDeckRecommendation";
import type { ArenaHeroWinRateRankingResult } from "../shared/arenaHeroStats";
import type {
  CardLibraryQuery,
  CardLibraryResult,
  DeckCard,
  DeckSummary,
  GameEvent,
  OpponentOverview,
  OpponentPlayedCard,
  OverlaySmartCounter,
  TrackerStatus
} from "./types";

function createAppCardTracking(gameKey: string): PublicCardTracking {
  const knownEmpty = () => ({
    status: "known" as const,
    knownCount: 0,
    totalCount: 0,
    cards: []
  });
  const unknownEmpty = () => ({
    status: "unknown" as const,
    knownCount: 0,
    cards: []
  });
  const player = (opponent: boolean) => ({
    current: {
      deck: opponent ? unknownEmpty() : knownEmpty(),
      hand: opponent ? unknownEmpty() : knownEmpty(),
      play: knownEmpty(),
      secret: knownEmpty(),
      graveyard: knownEmpty(),
      removed: knownEmpty()
    },
    burned: { totalCount: 0, items: [], truncated: false },
    used: { totalCount: 0, items: [], truncated: false }
  });
  return {
    schemaVersion: 1,
    gameKey,
    friendly: player(false),
    opponent: player(true),
    opponentSecretSlots: [],
    detailsByCardKey: {},
    contextDetailsBySideAndCardKey: {
      friendly: {},
      opponent: {}
    }
  };
}

function createQaOpponentCardTracking(): PublicCardTracking {
  const tracking = createAppCardTracking("qa-opponent-game");
  const qaFriendlyCards = [
    { cardId: "CS2_024", name: "寒冰箭", manaCost: 2, isSpell: true },
    { cardId: "CS2_029", name: "火球术", manaCost: 4, isSpell: true },
    { cardId: "CS2_023", name: "奥术智慧", manaCost: 3, isSpell: true },
    { cardId: "CS2_026", name: "冰霜新星", manaCost: 3, isSpell: true },
    { cardId: "CS2_028", name: "暴风雪", manaCost: 6, isSpell: true },
    { cardId: "CS2_032", name: "烈焰风暴", manaCost: 7, isSpell: true },
    { cardId: "CS2_033", name: "水元素", manaCost: 4, isSpell: false },
    { cardId: "EX1_295", name: "寒冰屏障", manaCost: 3, isSpell: true },
    { cardId: "EX1_287", name: "法术反制", manaCost: 3, isSpell: true },
    { cardId: "EX1_279", name: "炎爆术", manaCost: 10, isSpell: true },
    { cardId: "EX1_608", name: "巫师学徒", manaCost: 2, isSpell: false },
    { cardId: "EX1_612", name: "肯瑞托法师", manaCost: 3, isSpell: false },
    { cardId: "EX1_294", name: "镜像实体", manaCost: 3, isSpell: true },
    { cardId: "EX1_275", name: "冰锥术", manaCost: 4, isSpell: true }
  ] as const;
  const qaFriendlyHand = [
    { cardId: "QA_COLD_CASE", name: "冰冷案例", manaCost: 4, isSpell: true },
    { cardId: "QA_FIRST_FLAME", name: "初始之火", manaCost: 1, isSpell: true }
  ] as const;
  const friendlyDeckCards = qaFriendlyCards.map(({ cardId, name }) => ({
    cardKey: `id:${cardId.toLowerCase()}`,
    cardId,
    name,
    count: 2
  }));
  const detailsByCardKey = Object.fromEntries(
    [...qaFriendlyCards, ...qaFriendlyHand].map((card, index) => [
      `id:${card.cardId.toLowerCase()}`,
      {
        dbfId: 10_000 + index,
        cardId: card.cardId,
        name: card.name,
        manaCost: card.manaCost,
        isSpell: card.isSpell,
        relatedCards: []
      } satisfies CardDetails
    ])
  );
  return {
    ...tracking,
    detailsByCardKey,
    friendly: {
      ...tracking.friendly,
      current: {
        ...tracking.friendly.current,
        deck: {
          status: "known",
          knownCount: 28,
          totalCount: 28,
          cards: friendlyDeckCards
        },
        hand: {
          status: "known",
          knownCount: 2,
          totalCount: 2,
          cards: qaFriendlyHand.map(({ cardId, name }) => ({
            cardKey: `id:${cardId.toLowerCase()}`,
            cardId,
            name,
            count: 1
          }))
        }
      }
    },
    opponent: {
      ...tracking.opponent,
      current: {
        ...tracking.opponent.current,
        secret: {
          status: "partial",
          knownCount: 0,
          totalCount: 2,
          cards: []
        }
      },
      used: {
        totalCount: 1,
        truncated: false,
        items: [{
          id: "qa-opponent-use-1",
          sequence: 1,
          entityId: "qa-opponent-card-1",
          card: {
            cardKey: "id:ex1_145",
            cardId: "EX1_145",
            name: "伺机待发"
          },
          confidence: "confirmed"
        }]
      }
    },
    opponentSecretSlots: [
      {
        entityId: "qa-secret-1",
        candidates: [
          { cardId: "EX1_287", name: "法术反制", status: "possible" },
          {
            cardId: "EX1_289",
            name: "寒冰护体",
            status: "excluded",
            exclusionReason: "hero-attacked-without-trigger"
          }
        ]
      },
      {
        entityId: "qa-secret-2",
        candidates: [
          { cardId: "EX1_294", name: "镜像实体", status: "possible" },
          { cardId: "VAN_tt_010", name: "扰咒术", status: "excluded" }
        ]
      }
    ]
  };
}

const demoState: PublicTrackerState = {
  status: "missing-log",
  deck: [],
  [LEGACY_USED_ROWS_KEY]: [],
  events: [],
  summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, [LEGACY_USED_COUNT_KEY]: 0 },
  cardTracking: createAppCardTracking("app-demo"),
  error: "缺少 Power.log。先点“修复日志”，完全退出并重新打开炉石，然后进入一局。"
};

const defaultDeckText = "";

const qaArenaChoiceOverlayState: ArenaState = {
  status: "drafting",
  hero: { name: "德鲁伊", className: "Druid" },
  draftCount: 7,
  unresolvedCount: 23,
  currentChoices: [
    { name: "小蜘蛛", count: 1, score: 94, rating: { hearthArena: 94, drawnImpact: 1.85, deckImpact: -1.75, pickRate: 36.4, highWinPickRate: 40.2, highWinThreshold: 6 } },
    { name: "癫醉歌迷", count: 1, score: 121, rating: { hearthArena: 121, drawnImpact: -2.4, deckImpact: 3.1, pickRate: 44.8, highWinPickRate: 51.1, highWinThreshold: 6 } },
    { name: "致命配方", count: 1, score: 108, rating: { hearthArena: 108, drawnImpact: 0, deckImpact: 0, pickRate: 39.6, highWinPickRate: 43.8, highWinThreshold: 6 } }
  ],
  picks: [],
  deck: [{ name: "QA 已选牌", count: 7 }]
};

const qaOpponentOverlayState: PublicTrackerState = {
  status: "watching",
  gameActive: true,
  logPath: "/QA/Power.log",
  deck: [],
  [LEGACY_USED_ROWS_KEY]: [],
  boardAttack: { friendly: 7, opponent: 12 },
  matchCounters: {
    friendly: { nextFatigueDamage: 2, corpses: 6, spellsPlayed: 8 },
    opponent: { nextFatigueDamage: 3, corpses: 4, spellsPlayed: 5 }
  },
  events: [],
  summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, [LEGACY_USED_COUNT_KEY]: 1 },
  cardTracking: createQaOpponentCardTracking(),
  lastUpdated: "2026-07-12T12:00:00.000Z"
};

function qaSecretCandidate(
  cardId: string,
  name: string,
  dbfId: number,
  rarity: "COMMON" | "RARE" | "EPIC"
) {
  return {
    cardId,
    name,
    status: "possible" as const,
    details: {
      dbfId,
      cardId,
      name,
      manaCost: 3,
      rarity,
      isSpell: true,
      relatedCards: []
    }
  };
}

const qaDenseSecretOverlayState: PublicTrackerState = {
  ...qaOpponentOverlayState,
  cardTracking: {
    ...qaOpponentOverlayState.cardTracking,
    opponentSecretSlots: [{
      entityId: "qa-secret-dense",
      candidates: [
        qaSecretCandidate("EX1_287", "法术反制", 113, "RARE"),
        qaSecretCandidate("EX1_289", "寒冰护体", 621, "COMMON"),
        qaSecretCandidate("EX1_294", "镜像实体", 195, "COMMON"),
        qaSecretCandidate("tt_010", "扰咒术", 366, "EPIC"),
        qaSecretCandidate("EX1_295", "寒冰屏障", 192, "EPIC"),
        qaSecretCandidate("EX1_594", "蒸发", 286, "RARE"),
        qaSecretCandidate("CFM_620", "变形药水", 40373, "EPIC"),
        qaSecretCandidate("LOOT_101", "爆炸符文", 43407, "RARE"),
        qaSecretCandidate("ULD_239", "火焰结界", 53382, "RARE"),
        qaSecretCandidate("BAR_812", "绿洲盟军", 63132, "RARE")
      ]
    }]
  }
};

const qaSmartCounters: readonly OverlaySmartCounter[] = [
  { id: "qa-friendly-dragons", label: "已使用龙牌", value: 3, target: 5, side: "friendly", cardId: "TOY_385" },
  { id: "qa-opponent-void-souls", label: "对手虚空灵魂", value: 4, side: "opponent", cardId: "JAIL_732" }
];

function smartCountersFromState(state: PublicTrackerState): readonly OverlaySmartCounter[] {
  return state.smartCounters ?? [];
}

const qaHomeState: PublicTrackerState = {
  ...qaOpponentOverlayState,
  logPath: "炉石日志/Power.log",
  trackerMode: "ladder",
  constructedScreenMode: "standard",
  deckName: "冰霜法",
  deck: [
    { name: "传送门卫士", cardId: "QA_001", count: 2, remaining: 2, drawn: 0, played: 0 },
    { name: "冰冷案例", cardId: "QA_002", count: 2, remaining: 1, drawn: 1, played: 0 },
    { name: "初始之火", cardId: "QA_003", count: 2, remaining: 2, drawn: 0, played: 0 }
  ],
  summary: { totalCards: 30, remainingCards: 28, drawnCards: 2, [LEGACY_USED_COUNT_KEY]: 2 },
  events: [
    { id: "qa-home-draw", at: "2026-08-11T12:03:00.000Z", kind: "draw", player: "friendly", cardName: "冰冷案例" }
  ]
};

const qaFriendlyOverlayState: PublicTrackerState = {
  ...qaHomeState,
  deckIdentity: {
    status: "confirmed",
    source: "decks-log",
    deckId: "qa-frost-mage",
    observedDistinctCards: 14,
    candidateCount: 1,
    bestScore: 1,
    scoreLead: 1
  }
};

const qaHomeHistory: MatchHistoryResult = {
  status: "ok",
  matches: [
    { id: "qa-home-1", result: "win", mode: "standard", deckName: "冰霜法", endedAt: "2026-08-11T12:20:00.000Z" },
    { id: "qa-home-2", result: "win", mode: "standard", deckName: "冰霜法", endedAt: "2026-08-11T11:40:00.000Z" },
    { id: "qa-home-3", result: "loss", mode: "wild", deckName: "奥秘法", endedAt: "2026-08-10T18:12:00.000Z" },
    { id: "qa-home-4", result: "win", mode: "arena", deckName: "竞技场", endedAt: "2026-08-10T16:25:00.000Z" },
    { id: "qa-home-5", result: "loss", mode: "standard", deckName: "冰霜法", endedAt: "2026-08-09T21:08:00.000Z" }
  ],
  summary: { total: 5, wins: 3, losses: 2, ties: 0, winRate: 0.6 }
};

function createQaNewsArtwork(accent: string, label: string): string {
  const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#08141f"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>
    <rect width="320" height="180" rx="18" fill="url(#g)"/>
    <circle cx="160" cy="78" r="48" fill="none" stroke="#f6c66a" stroke-width="8" opacity=".9"/>
    <path d="M132 82c18-34 54-28 58-4-9-10-23-8-29 3 19-3 30 13 23 26-6-9-19-11-28-5-14 9-33-5-24-20Z" fill="#f6c66a"/>
    <text x="160" y="154" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="700" fill="#fff">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artwork)}`;
}

const qaNewsArtwork = [
  createQaNewsArtwork("#244f72", "版本更新"),
  createQaNewsArtwork("#6b3c2d", "全新赛季"),
  createQaNewsArtwork("#315b43", "活动日历")
] as const;

const qaHomeNews: HomeNewsResult = {
  status: "fresh",
  source: HOME_NEWS_SOURCE_LABEL,
  sourceUrl: OFFICIAL_HOME_NEWS_URL,
  fetchedAt: "2026-08-11T12:00:00.000Z",
  items: [
    { id: "qa-news-1", title: "36.2 版本更新说明", summary: "查看最新平衡调整与游戏内容。", url: OFFICIAL_HOME_NEWS_URL, imageUrl: qaNewsArtwork[0], publishedAt: "2026-08-11T08:00:00.000Z" },
    { id: "qa-news-2", title: "酒馆战棋全新赛季现已开启", summary: "新英雄、新饰品与赛季奖励登场。", url: OFFICIAL_HOME_NEWS_URL, imageUrl: qaNewsArtwork[1], publishedAt: "2026-08-10T08:00:00.000Z" },
    { id: "qa-news-3", title: "本周乱斗与活动日历", summary: "掌握本周游戏活动和奖励安排。", url: OFFICIAL_HOME_NEWS_URL, imageUrl: qaNewsArtwork[2], publishedAt: "2026-08-09T08:00:00.000Z" },
    { id: "qa-news-4", title: "竞技场轮换与卡池说明", summary: "了解当前竞技场环境变化。", url: OFFICIAL_HOME_NEWS_URL, publishedAt: "2026-08-08T08:00:00.000Z" }
  ]
};

const qaCardPreviewDetails: CardDetails = {
  dbfId: 315,
  name: "火球术",
  manaCost: 4,
  cardType: "法术",
  cardTypeId: 5,
  heroClass: "法师",
  text: "造成 6 点伤害。",
  isSpell: true,
  relatedCards: [
    { dbfId: 621, name: "炎爆术", manaCost: 10, cardType: "法术", text: "造成 10 点伤害。" },
    { dbfId: 1001, name: "奥术飞弹", manaCost: 1, cardType: "法术", text: "造成 3 点伤害，随机分配到所有敌人身上。" }
  ]
};

const logRepairActions = ["点“修复日志”", "完全退出并重新打开炉石", "进入一局"] as const;

interface LogIssueViewModel {
  title: string;
  message: string;
  detail: string;
  actions: readonly string[];
}

type PendingAction = "select-log" | "repair-log" | "toggle-overlay" | "tracking" | "import-deck" | "scan-collection" | "import-collection";
type LogRepairNotice = { message: string; role: "status" | "alert" };

const cardLibraryPageSize = 48;

const initialCardLibraryQuery: CardLibraryQuery = {
  query: "",
  page: 1,
  pageSize: cardLibraryPageSize
};

const emptyDeckSummary: DeckSummary = {
  deckName: "等待真实对局日志",
  totalCards: 0,
  remainingCards: 0
};

type AppView = MainView;

type WorkbenchNavId = "tracker" | "card-library" | "deck-tools" | "match-history" | "overlay-settings" | "plugin-settings" | "data-backup" | "about";

const workbenchItems = [
  { id: "tracker", view: "tracker", label: "实时对局", ariaLabel: "实时对局", icon: Swords },
  { id: "card-library", view: "card-library", label: "卡牌资料", ariaLabel: "打开卡牌资料", icon: BookOpen },
  { id: "deck-tools", view: "deck-tools", label: "卡组工具", ariaLabel: "卡组工具", icon: Upload },
  { id: "match-history", view: "match-history", label: "对局记录", ariaLabel: "对局记录", icon: History },
  { id: "overlay-settings", view: "settings", sectionId: "settings-overlay-title", label: "悬浮窗设置", ariaLabel: "悬浮窗设置", icon: SlidersHorizontal },
  { id: "plugin-settings", view: "settings", sectionId: "settings-other-title", label: "插件设置", ariaLabel: "插件与其他设置", icon: Puzzle },
  { id: "data-backup", view: "settings", sectionId: "settings-privacy-title", label: "数据与备份", ariaLabel: "数据、备份与隐私", icon: Database },
  { id: "about", view: "settings", sectionId: "settings-about-title", label: "关于我们", ariaLabel: "关于我们", icon: CircleHelp }
] as const satisfies ReadonlyArray<{
  id: WorkbenchNavId;
  view: Exclude<AppView, "home">;
  sectionId?: string;
  label: string;
  ariaLabel: string;
  icon: typeof Swords;
}>;

function DesktopWindowTitlebar({
  title,
  isHome,
  onMinimize,
  onOpenWorkbench,
  onReturnHome
}: {
  title: string;
  isHome: boolean;
  onMinimize: () => void;
  onOpenWorkbench: () => void;
  onReturnHome: () => void;
}) {
  return (
    <header className="desktop-window-titlebar" aria-label="窗口标题栏">
      <span className="desktop-window-controls-safe-area" aria-hidden="true" />
      <div className="desktop-window-drag-region">
        <span className="desktop-window-title">{title}</span>
      </div>
      <div className="desktop-window-actions">
        <button type="button" className="desktop-window-action" aria-label="最小化窗口" onClick={onMinimize}>
          <Minus aria-hidden="true" size={17} />
        </button>
        {isHome ? (
          <button type="button" className="desktop-window-action" aria-label="打开二级工作台" onClick={onOpenWorkbench}>
            <Settings aria-hidden="true" size={18} />
          </button>
        ) : (
          <button type="button" className="desktop-window-action" aria-label="关闭工作台，返回首页" onClick={onReturnHome}>
            <X aria-hidden="true" size={18} />
          </button>
        )}
      </div>
    </header>
  );
}

function App() {
  const api = window.hearthstoneTracker;
  const overlaySearchParams = new URLSearchParams(window.location.search);
  const isQaHomeDemo = overlaySearchParams.get("qa-home-demo") === "1";
  const isCardPreview = overlaySearchParams.get("card-preview") === "1";

  if (overlaySearchParams.get("ladder-deck-overlay") === "1") {
    return <LadderDeckRecommendationWindow searchParams={overlaySearchParams} />;
  }

  if (overlaySearchParams.get("arena-hero-ranking-overlay") === "1") {
    return <ArenaHeroWinRateRankingWindow searchParams={overlaySearchParams} />;
  }

  if (isCardPreview) {
    return <CardPreviewWindow />;
  }

  const isOpponentOverlay = overlaySearchParams.get("opponent-overlay") === "1";
  const isBoardAttackOverlay = overlaySearchParams.get("board-attack-overlay") === "1";
  const isFriendlyAttackOverlay = overlaySearchParams.get("friendly-attack-overlay") === "1";
  const isOpponentAttackOverlay = overlaySearchParams.get("opponent-attack-overlay") === "1";
  const isSecretOverlay = overlaySearchParams.get("secret-overlay") === "1";
  const isSmartCounterOverlay = overlaySearchParams.get("smart-counter-overlay") === "1";
  const isOverlay = overlaySearchParams.get("overlay") === "1";
  const isArenaChoiceOverlay = overlaySearchParams.get("arena-choice-overlay") === "1";
  const isQaArenaChoiceOverlay = overlaySearchParams.get("qa-arena-demo") === "1";
  const isQaOpponentOverlay = isOpponentOverlay && overlaySearchParams.get("qa-opponent-demo") === "1";
  const isQaBoardAttackOverlay = isBoardAttackOverlay && overlaySearchParams.get("qa-opponent-demo") === "1";
  const isQaFriendlyOverlay = isOverlay && overlaySearchParams.get("qa-opponent-demo") === "1";
  const [state, setState] = useState<PublicTrackerState>(isQaHomeDemo ? qaHomeState : demoState);
  const [hasAcceptedTrackerState, setHasAcceptedTrackerState] = useState(false);
  const [candidates, setCandidates] = useState<LogCandidate[]>([]);
  const [selectedLogPath, setSelectedLogPath] = useState<string | undefined>();
  const [deckText, setDeckText] = useState(defaultDeckText);
  const [isInitializing, setIsInitializing] = useState(Boolean(api));
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [initializationError, setInitializationError] = useState<string>();
  const [deckImported, setDeckImported] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [logRepairNotice, setLogRepairNotice] = useState<LogRepairNotice>();
  const [collectionScan, setCollectionScan] = useState<CollectionDeckScanResult | undefined>();
  const [collectionError, setCollectionError] = useState<string | undefined>();
  const [isScanningCollection, setIsScanningCollection] = useState(false);
  const [importingCollectionDeckId, setImportingCollectionDeckId] = useState<string | undefined>();
  const [activeView, setActiveView] = useState<AppView>("home");
  const [activeWorkbenchItem, setActiveWorkbenchItem] = useState<WorkbenchNavId>("tracker");
  const [cardLibraryQuery, setCardLibraryQuery] = useState<CardLibraryQuery>(initialCardLibraryQuery);
  const [debouncedCardSearch, setDebouncedCardSearch] = useState(initialCardLibraryQuery.query);
  const [cardLibraryResult, setCardLibraryResult] = useState<CardLibraryResult | undefined>();
  const [cardLibraryError, setCardLibraryError] = useState<string | undefined>();
  const [isCardLibraryLoading, setIsCardLibraryLoading] = useState(false);
  const [matchHistoryResult, setMatchHistoryResult] = useState<MatchHistoryResult | undefined>();
  const [matchHistoryError, setMatchHistoryError] = useState<string | undefined>();
  const [isMatchHistoryLoading, setIsMatchHistoryLoading] = useState(false);
  const [homeNews, setHomeNews] = useState<HomeNewsResult>();
  const [homeNewsError, setHomeNewsError] = useState<string>();
  const [isHomeNewsLoading, setIsHomeNewsLoading] = useState(false);
  const [homeLadderRecommendation, setHomeLadderRecommendation] = useState<LadderDeckRecommendationResult>();
  const [homeArenaHeroRanking, setHomeArenaHeroRanking] = useState<ArenaHeroWinRateRankingResult>();
  const [isHomeArenaHeroRankingLoading, setIsHomeArenaHeroRankingLoading] = useState(false);
  const [trackerSettings, setTrackerSettings] = useState<TrackerSettings>();
  const [settingsError, setSettingsError] = useState<string>();
  const [settingsNotice, setSettingsNotice] = useState<string>();
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [isOpponentOverlayCollapsed, setIsOpponentOverlayCollapsed] = useState(false);
  const [isSecretOverlayCollapsed, setIsSecretOverlayCollapsed] = useState(false);
  const actionLock = useRef(createSynchronousActionLock());
  const confirmedTrackerSettings = useRef<TrackerSettings>();
  const pendingTrackerSettingsSave = useRef<TrackerSettings>();
  const settingsSaveInFlight = useRef(false);
  const lastCardLibraryRequest = useRef<CardLibraryQuery>();
  const secretOverlayCollapseChangeVersion = useRef(0);
  const isBusy = isInitializing || pendingAction !== undefined;

  useEffect(() => {
    if (isQaHomeDemo) {
      setHasAcceptedTrackerState(true);
      setIsInitializing(false);
      setInitializationError(undefined);
      return;
    }

    if (!api) {
      setIsInitializing(false);
      return;
    }

    let disposed = false;
    let hasReceivedLiveState = false;
    setHasAcceptedTrackerState(false);
    setIsInitializing(true);
    setInitializationError(undefined);
    const unsubscribe = api.onUpdate((nextState) => {
      if (!disposed) {
        try {
          const parsedState = parsePublicTrackerState(nextState);
          hasReceivedLiveState = true;
          setState((current) => preserveArenaChoiceStatistics(current, parsedState));
          setHasAcceptedTrackerState(true);
          setInitializationError(undefined);
        } catch (error) {
          setInitializationError(toUserErrorMessage(error, "收到的记牌状态无效。"));
        }
      }
    });

    const candidateRequest = api.discoverLogs?.() ?? Promise.resolve<LogCandidate[]>([]);
    void Promise.allSettled([api.getState(), candidateRequest])
      .then(([stateResult, candidateResult]) => {
        if (disposed) {
          return;
        }

        if (stateResult.status === "fulfilled" && shouldApplyInitialTrackerState(hasReceivedLiveState)) {
          try {
            const parsedState = parsePublicTrackerState(stateResult.value);
            setState((current) => preserveArenaChoiceStatistics(current, parsedState));
            setHasAcceptedTrackerState(true);
            setInitializationError(undefined);
          } catch (error) {
            setInitializationError(toUserErrorMessage(error, "读取到的记牌状态无效。"));
          }
        }
        if (candidateResult.status === "fulfilled") {
          setCandidates(candidateResult.value);
        }

        if (stateResult.status === "rejected" && candidateResult.status === "rejected") {
          setInitializationError("读取本机状态失败，请重启记牌器后重试。");
        } else if (stateResult.status === "rejected") {
          setInitializationError("读取当前记牌状态失败，稍后可重试。");
        } else if (candidateResult.status === "rejected") {
          setInitializationError("扫描炉石日志失败，稍后可重试。");
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsInitializing(false);
        }
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api, isQaHomeDemo]);

  useEffect(() => api?.onOpenSettings?.(() => { void loadTrackerSettings(); }), [api]);

  useEffect(() => api?.onTrackerSettingsUpdate?.((value) => {
    try {
      const nextSettings = parseTrackerSettings(value);
      confirmedTrackerSettings.current = nextSettings;
      if (!settingsSaveInFlight.current) setTrackerSettings(nextSettings);
    } catch (error) {
      setSettingsError(toUserErrorMessage(error, "收到的设置数据无效。"));
    }
  }), [api]);

  useEffect(() => {
    if (!api?.getTrackerSettings) return;
    let disposed = false;
    void api.getTrackerSettings()
      .then((value) => {
        if (!disposed) {
          const nextSettings = parseTrackerSettings(value);
          confirmedTrackerSettings.current = nextSettings;
          if (!settingsSaveInFlight.current) setTrackerSettings(nextSettings);
        }
      })
      .catch(() => {
        // The settings page reports read failures when the user opens it.
      });
    return () => {
      disposed = true;
    };
  }, [api]);

  useEffect(() => {
    if (!trackerSettings) return;
    const root = document.documentElement;
    const appearance = trackerSettings.appearance;
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : undefined;
    const applyTheme = () => {
      root.dataset.trackerTheme = resolveTrackerTheme(trackerSettings, window.location.search, media?.matches === true);
    };
    applyTheme();
    media?.addEventListener?.("change", applyTheme);
    root.dataset.trackerFontSize = appearance.fontSize;
    root.dataset.trackerAnimations = appearance.animations ? "on" : "off";
    root.dataset.trackerCardQuality = appearance.cardImageQuality;
    root.style.setProperty("--tracker-accent", appearance.accentColor);
    return () => media?.removeEventListener?.("change", applyTheme);
  }, [trackerSettings]);

  useEffect(() => {
    if (activeView !== "settings") return;
    const item = workbenchItems.find((candidate) => candidate.id === activeWorkbenchItem);
    if (!item || !("sectionId" in item) || !item.sectionId) return;
    const animationFrame = window.requestAnimationFrame(() => {
      const section = document.getElementById(item.sectionId)?.closest<HTMLElement>(".settings-form-section");
      const scrollContainer = section?.closest<HTMLElement>(".settings-section-content");
      if (!section || !scrollContainer) return;

      const containerRect = scrollContainer.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      scrollContainer.scrollTo({
        top: Math.max(0, scrollContainer.scrollTop + sectionRect.top - containerRect.top - 12),
        behavior: "auto"
      });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeView, activeWorkbenchItem]);

  useEffect(() => {
    if (!isOpponentOverlay || !api) {
      return;
    }

    let disposed = false;
    let hasReceivedLiveState = false;
    const unsubscribe = api.onOpponentOverlayCollapsedChange?.((collapsed) => {
      if (!disposed) {
        hasReceivedLiveState = true;
        setIsOpponentOverlayCollapsed(collapsed);
      }
    });

    if (api.getOpponentOverlayCollapsed) {
      void api.getOpponentOverlayCollapsed().then((collapsed) => {
        if (!disposed && !hasReceivedLiveState) {
          setIsOpponentOverlayCollapsed(collapsed);
        }
      });
    }

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [api, isOpponentOverlay]);

  useEffect(() => {
    if (!isSecretOverlay || !api?.getSecretOverlayCollapsed) {
      return;
    }

    let disposed = false;
    const queryVersion = secretOverlayCollapseChangeVersion.current;
    void api.getSecretOverlayCollapsed()
      .then((collapsed) => {
        if (!disposed && secretOverlayCollapseChangeVersion.current === queryVersion) {
          setIsSecretOverlayCollapsed(collapsed);
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [api, isSecretOverlay]);

  useEffect(() => {
    const debounceTimer = window.setTimeout(() => {
      setDebouncedCardSearch((cardLibraryQuery.query ?? "").trim());
    }, 220);

    return () => window.clearTimeout(debounceTimer);
  }, [cardLibraryQuery.query]);

  useEffect(() => {
    if (activeView !== "card-library") {
      return;
    }

    if (!api?.listCardLibrary) {
      setCardLibraryResult(undefined);
      setCardLibraryError("当前版本还没有接入本地卡牌数据库，请更新记牌器后重试。");
      return;
    }

    let disposed = false;
    setIsCardLibraryLoading(true);
    setCardLibraryError(undefined);

    const query: CardLibraryQuery = {
      ...cardLibraryQuery,
      query: debouncedCardSearch
    };

    if (!shouldRequestCardLibrary(lastCardLibraryRequest.current, query)) {
      setIsCardLibraryLoading(false);
      return;
    }
    lastCardLibraryRequest.current = query;

    void api.listCardLibrary(query)
      .then((result) => {
        if (!disposed) {
          if (result.status === "error") {
            setCardLibraryError(result.error ?? result.warnings[0] ?? "读取本地卡牌数据库失败，请稍后重试。");
          } else {
            setCardLibraryResult(result);
          }
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setCardLibraryError(toUserErrorMessage(error, "读取本地卡牌数据库失败，请稍后重试。"));
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsCardLibraryLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [activeView, api, cardLibraryQuery.heroClass, cardLibraryQuery.cardType, cardLibraryQuery.page, cardLibraryQuery.pageSize, debouncedCardSearch]);

  useEffect(() => {
    if (activeView !== "home" && activeView !== "match-history") {
      return;
    }

    if (!api?.getMatchHistory) {
      setMatchHistoryResult(undefined);
      setMatchHistoryError("当前版本无法读取真实对局历史，请在桌面版更新后重试。");
      return;
    }

    let disposed = false;
    setIsMatchHistoryLoading(true);
    setMatchHistoryError(undefined);
    void api.getMatchHistory()
      .then((value) => {
        if (disposed) {
          return;
        }
        const result = parseMatchHistoryResult(value);
        if (result.status === "error") {
          setMatchHistoryResult(undefined);
          setMatchHistoryError(result.error ?? "读取对局历史失败，请稍后重试。");
          return;
        }
        setMatchHistoryResult(result);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setMatchHistoryResult(undefined);
          setMatchHistoryError(toUserErrorMessage(error, "读取对局历史失败，请稍后重试。"));
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsMatchHistoryLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [activeView, api, state.gameActive]);

  useEffect(() => {
    if (activeView !== "home") return;
    if (!api?.getLadderDeckRecommendation) {
      setHomeLadderRecommendation({ status: "unavailable", message: "当前版本未接入天梯推荐数据。" });
      return;
    }

    let disposed = false;
    const mode: LadderMode = state.constructedScreenMode === "wild" ? "wild" : "standard";
    setHomeLadderRecommendation(undefined);
    void api.getLadderDeckRecommendation(mode)
      .then((result) => {
        if (!disposed) setHomeLadderRecommendation(result);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setHomeLadderRecommendation({
            status: "unavailable",
            message: toUserErrorMessage(error, "天梯推荐读取失败，请稍后重试。")
          });
        }
      });

    return () => {
      disposed = true;
    };
  }, [activeView, api, state.constructedScreenMode]);

  useEffect(() => {
    if (activeView !== "home") return;
    if (!api?.getHomeNews) {
      setHomeNews(undefined);
      setHomeNewsError(undefined);
      return;
    }

    let disposed = false;
    setIsHomeNewsLoading(true);
    setHomeNewsError(undefined);
    void api.getHomeNews()
      .then((result) => {
        if (!disposed) setHomeNews(result);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setHomeNews(undefined);
          setHomeNewsError(toUserErrorMessage(error, "读取炉石官网资讯失败。"));
        }
      })
      .finally(() => {
        if (!disposed) setIsHomeNewsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [activeView, api]);

  useEffect(() => {
    if (activeView !== "home") return;
    if (!api?.getArenaHeroWinRateRanking) {
      setHomeArenaHeroRanking({ status: "unavailable", message: "桌面版将显示联网竞技场排行。" });
      return;
    }

    let disposed = false;
    setIsHomeArenaHeroRankingLoading(true);
    void api.getArenaHeroWinRateRanking()
      .then((result) => {
        if (!disposed) setHomeArenaHeroRanking(result);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setHomeArenaHeroRanking({
            status: "error",
            message: toUserErrorMessage(error, "竞技场排行读取失败，请稍后重试。")
          });
        }
      })
      .finally(() => {
        if (!disposed) setIsHomeArenaHeroRankingLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [activeView, api]);

  const trackerStatus = useMemo(
    () => toTrackerStatus(state, candidates, selectedLogPath, isInitializing),
    [candidates, isInitializing, selectedLogPath, state]
  );
  const logIssue = useMemo(() => toLogIssueViewModel(state), [state]);
  const deckIdentityView = useMemo(() => toOverlayDeckIdentity(state), [state]);
  const deckDisplayState = useMemo(
    () => hideUnconfirmedDeck(state),
    [state]
  );
  useEffect(() => {
    if (!logIssue) {
      setLogRepairNotice(undefined);
    }
  }, [logIssue]);
  const deckCards = useMemo(
    () => (
      logIssue
        ? []
        : toDeckCards(deckDisplayState.deck, !deckDisplayState.arena || deckDisplayState.arena.status === "inactive")
    ),
    [deckDisplayState.arena, deckDisplayState.deck, logIssue]
  );
  const deckSummary = useMemo(
    () => (logIssue ? emptyDeckSummary : toDeckSummary(deckDisplayState, deckImported)),
    [deckDisplayState, deckImported, logIssue]
  );
  const events = useMemo(() => (logIssue ? [] : toGameEvents(state.events)), [logIssue, state.events]);
  const opponentOverview = useMemo(() => toOpponentOverview(state), [state]);
  const opponentUsedCards = useMemo(
    () => (logIssue ? [] : toOpponentUsedCards(state)),
    [logIssue, state]
  );
  const publishedDeckIdentityNotice = !logIssue && !state.error && state.deckIdentity &&
    (!state.arena || state.arena.status === "inactive")
    ? { title: deckIdentityView.name, detail: deckIdentityView.detail }
    : undefined;
  const autoMatchNotice = !logIssue && !state.deckIdentity && state.autoMatchedDeckId
    ? `已自动匹配收藏套牌：${state.deckName ?? "当前卡组"}。`
    : undefined;

  function applyTrackerState(value: unknown): boolean {
    try {
      const parsedState = parsePublicTrackerState(value);
      setState((current) => preserveArenaChoiceStatistics(current, parsedState));
      return true;
    } catch (error) {
      setNotice(toUserErrorMessage(error, "收到的记牌状态无效。"));
      return false;
    }
  }

  async function runAction<T>(
    action: PendingAction,
    task: () => Promise<T>,
    fallback: string,
    onError: (message: string) => void = setNotice
  ): Promise<T | undefined> {
    if (isBusy || actionLock.current.isLocked()) {
      return undefined;
    }

    setPendingAction(action);
    return actionLock.current.run(async () => {
      try {
        return await task();
      } catch (error) {
        onError(toUserErrorMessage(error, fallback));
        return undefined;
      } finally {
        setPendingAction(undefined);
      }
    });
  }

  async function selectPath() {
    if (!api) {
      const mockPath = "/Applications/Hearthstone/Logs/2026_07_10";
      setSelectedLogPath(mockPath);
      setState((current) => ({ ...current, logPath: mockPath, lastUpdated: new Date().toISOString() }));
      return;
    }

    const path = await runAction("select-log", () => api.selectLogPath(), "选择日志目录失败，请重试。");
    if (path) {
      setSelectedLogPath(path);
    }
  }

  async function ensureLogConfig() {
    if (!api) {
      setNotice("浏览器预览不能写入炉石日志配置，请在桌面版里操作。");
      return;
    }

    setLogRepairNotice(undefined);
    const status = await runAction(
      "repair-log",
      () => api.ensureLogConfig(),
      "修复日志失败，请重试。",
      (message) => setLogRepairNotice({ message, role: "alert" })
    );
    if (!status) {
      return;
    }
    const backupText = status.backupPath ? "，旧配置已备份" : "";
    setLogRepairNotice({
      message: `日志配置已就绪：${status.path}${backupText}。完全退出并重新打开炉石，然后进入一局。`,
      role: "status"
    });
  }

  async function toggleOverlay() {
    if (!api?.toggleOverlay) {
      setNotice("浏览器预览不能打开桌面小窗，请在桌面版里操作。");
      return;
    }

    const visible = await runAction("toggle-overlay", () => api.toggleOverlay(), "打开置顶小窗失败，请重试。");
    if (visible === undefined) {
      return;
    }
    setNotice(visible ? "置顶小窗已打开。" : "置顶小窗已关闭。");
  }

  async function closeFriendlyOverlay() {
    if (!api?.closeFriendlyOverlay) return;
    try {
      await api.closeFriendlyOverlay();
    } catch (error) {
      setInitializationError(toUserErrorMessage(error, "关闭置顶小窗失败，请重试。"));
    }
  }

  async function toggleOpponentOverlay() {
    if (!api?.toggleOpponentOverlay) {
      setNotice("浏览器预览不能打开对手出牌小窗，请在桌面版里操作。");
      return;
    }

    const visible = await runAction(
      "toggle-overlay",
      () => api.toggleOpponentOverlay!(),
      "打开对手出牌小窗失败，请重试。"
    );
    if (visible === undefined) {
      return;
    }
    setNotice(visible ? "对手出牌小窗已打开。" : "对手出牌小窗已关闭。");
  }

  async function openSettingsInMainWindow() {
    if (!api?.openSettings) {
      setInitializationError("当前版本无法打开软件设置，请更新后重试。");
      return;
    }
    try {
      await api.openSettings();
    } catch (error) {
      setInitializationError(toUserErrorMessage(error, "打开软件设置失败，请重试。"));
    }
  }

  async function loadTrackerSettings(workbenchItem: WorkbenchNavId = "overlay-settings") {
    setActiveWorkbenchItem(workbenchItem);
    setActiveView("settings");
    setSettingsError(undefined);
    setSettingsNotice(undefined);
    if (!api?.getTrackerSettings) {
      setTrackerSettings(undefined);
      setSettingsError("当前版本无法读取软件设置，请更新后重试。");
      return;
    }
    setIsSettingsLoading(true);
    try {
      const nextSettings = parseTrackerSettings(await api.getTrackerSettings());
      confirmedTrackerSettings.current = nextSettings;
      if (!settingsSaveInFlight.current) setTrackerSettings(nextSettings);
    } catch (error) {
      setTrackerSettings(undefined);
      setSettingsError(toUserErrorMessage(error, "读取软件设置失败，请重试。"));
    } finally {
      setIsSettingsLoading(false);
    }
  }

  async function saveTrackerSettings(nextSettings: TrackerSettings) {
    if (!api?.setTrackerSettings) {
      setSettingsError("当前版本无法保存软件设置，请更新后重试。");
      return;
    }

    const optimisticSettings = parseTrackerSettings(nextSettings);
    setTrackerSettings(optimisticSettings);
    pendingTrackerSettingsSave.current = optimisticSettings;
    if (settingsSaveInFlight.current) return;

    settingsSaveInFlight.current = true;
    setIsSettingsSaving(true);
    setSettingsError(undefined);
    setSettingsNotice(undefined);
    try {
      while (pendingTrackerSettingsSave.current) {
        const settingsToSave = pendingTrackerSettingsSave.current;
        pendingTrackerSettingsSave.current = undefined;
        try {
          const savedSettings = parseTrackerSettings(await api.setTrackerSettings(settingsToSave));
          confirmedTrackerSettings.current = savedSettings;
          setSettingsError(undefined);
          if (!pendingTrackerSettingsSave.current) setTrackerSettings(savedSettings);
        } catch (error) {
          setSettingsError(toUserErrorMessage(error, "保存软件设置失败，请重试。"));
          if (!pendingTrackerSettingsSave.current && confirmedTrackerSettings.current) {
            setTrackerSettings(confirmedTrackerSettings.current);
          }
        }
      }
    } finally {
      settingsSaveInFlight.current = false;
      setIsSettingsSaving(false);
    }
  }

  async function openSettingsLogFolder() {
    if (!api?.openLogFolder) return;
    setSettingsError(undefined);
    setSettingsNotice(undefined);
    try {
      await api.openLogFolder();
      setSettingsNotice("已打开日志目录。");
    } catch (error) {
      setSettingsError(toUserErrorMessage(error, "打开日志目录失败。"));
    }
  }

  async function refreshSettingsCardDatabase() {
    if (!api?.refreshCardDatabase || isSettingsSaving) return;
    setIsSettingsSaving(true);
    setSettingsError(undefined);
    setSettingsNotice(undefined);
    try {
      const result = await api.refreshCardDatabase();
      if (result.status === "error") {
        setSettingsError(result.error);
      } else if (result.status === "stale") {
        setSettingsNotice(`更新未完成，继续使用本地卡牌库（${result.cardCount.toLocaleString("zh-CN")} 张）。`);
      } else {
        setSettingsNotice(`卡牌库已更新，共 ${result.cardCount.toLocaleString("zh-CN")} 张。`);
      }
    } catch (error) {
      setSettingsError(toUserErrorMessage(error, "更新卡牌库失败。"));
    } finally {
      setIsSettingsSaving(false);
    }
  }

  async function restoreSettingsDefaults() {
    if (!api?.restoreDefaultSettings || isSettingsSaving) return;
    setIsSettingsSaving(true);
    setSettingsError(undefined);
    setSettingsNotice(undefined);
    try {
      const defaultSettings = parseTrackerSettings(await api.restoreDefaultSettings());
      confirmedTrackerSettings.current = defaultSettings;
      setTrackerSettings(defaultSettings);
      setSettingsNotice("已恢复默认设置。");
    } catch (error) {
      setSettingsError(toUserErrorMessage(error, "恢复默认设置失败。"));
    } finally {
      setIsSettingsSaving(false);
    }
  }

  async function minimizeMain() {
    if (!api?.minimizeMain) {
      setNotice("浏览器预览不能最小化主程序，请在桌面版里操作。");
      return;
    }

    const minimized = await api.minimizeMain();
    if (!minimized) {
      setNotice("最小化主程序失败，请重试。");
    }
  }

  async function copyHomeLadderDeckCode(deckCode: string) {
    if (!api?.copyLadderDeckCode) {
      throw new Error("当前版本无法复制卡组代码。");
    }
    await api.copyLadderDeckCode(deckCode);
  }

  async function openHomeNewsItem(itemId: string) {
    if (!api?.openHomeNewsItem) {
      setHomeNewsError("请在桌面版中打开资讯详情。");
      return;
    }
    try {
      await api.openHomeNewsItem(itemId);
    } catch (error) {
      setHomeNewsError(toUserErrorMessage(error, "打开资讯失败，请稍后重试。"));
    }
  }

  function navigateTo(view: AppView) {
    if (view === "home") {
      setActiveView("home");
      return;
    }
    if (view === "settings") {
      void loadTrackerSettings("plugin-settings");
      return;
    }
    setActiveWorkbenchItem(view);
    setActiveView(view);
  }

  function navigateToWorkbench(itemId: WorkbenchNavId) {
    const item = workbenchItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setActiveWorkbenchItem(item.id);
    if (item.view === "settings") {
      void loadTrackerSettings(item.id);
      return;
    }
    setActiveView(item.view);
  }

  function updateCardLibraryQuery(update: Partial<CardLibraryQuery>) {
    setCardLibraryQuery((current) => ({
      ...current,
      ...update,
      page: "page" in update ? Math.max(1, update.page ?? 1) : 1
    }));
  }

  async function start() {
    if (!api) {
      setState((current) => ({
        ...current,
        status: "watching",
        logPath: selectedLogPath ?? current.logPath,
        lastUpdated: new Date().toISOString()
      }));
      return;
    }

    const nextState = await runAction("tracking", () => api.start({ logPath: selectedLogPath, deckText }), "开始监听失败，请重试。");
    if (nextState) {
      applyTrackerState(nextState);
    }
  }

  async function pause() {
    if (!api) {
      setState((current) => ({ ...current, status: "paused", lastUpdated: new Date().toISOString() }));
      return;
    }

    const nextState = await runAction("tracking", () => api.pause(), "暂停监听失败，请重试。");
    if (nextState) {
      applyTrackerState(nextState);
    }
  }

  async function toggleTracking() {
    if (isBusy) {
      return;
    }

    if (state.status === "watching" && !logIssue) {
      await pause();
      return;
    }

    await start();
  }

  async function importDeck() {
    if (!deckText.trim()) {
      return;
    }

    const nextState = await runAction(
      "import-deck",
      () => api ? api.importDeck(deckText) : Promise.resolve(withImportedDeck(state, deckText)),
      "导入卡组失败，请检查内容后重试."
    );
    if (!nextState) {
      return;
    }

    if (!applyTrackerState(nextState)) return;
    setDeckImported(true);
    setNotice("卡组已导入，实时对局会使用这套牌。");
  }

  async function scanCollectionDecks() {
    setCollectionError(undefined);

    if (!api?.scanCollectionDecks) {
      setCollectionScan(undefined);
      setCollectionError("浏览器预览不能读取炉石收藏，请在桌面版里操作。");
      return;
    }

    if (isBusy) {
      return;
    }

    setIsScanningCollection(true);
    const scan = await runAction(
      "scan-collection",
      () => api.scanCollectionDecks!(),
      "读取收藏失败，请确认炉石已打开并重试。",
      setCollectionError
    );
    setIsScanningCollection(false);
    if (scan) {
      setCollectionScan(scan);
    }
  }

  async function importCollectionDeck(deckId: string) {
    setCollectionError(undefined);

    if (!api?.importCollectionDeck) {
      setCollectionError("当前环境不能导入收藏卡组，请在桌面版里操作。");
      return;
    }

    if (isBusy) {
      return;
    }

    setImportingCollectionDeckId(deckId);
    const nextState = await runAction(
      "import-collection",
      () => api.importCollectionDeck!(deckId),
      "导入收藏卡组失败，请重试。",
      setCollectionError
    );
    setImportingCollectionDeckId(undefined);
    if (nextState) {
      if (!applyTrackerState(nextState)) return;
      setDeckImported(true);
      setNotice("收藏套牌已导入，实时对局会使用这套牌。");
    }
  }

  if (isOpponentOverlay) {
    const retainedStateError = !isQaOpponentOverlay && hasAcceptedTrackerState
      ? initializationError
      : undefined;
    return (
      <>
        <style>{rendererStyles}</style>
        {retainedStateError ? <div className="notice" role="alert">{retainedStateError}</div> : null}
        <OpponentOverlayWindow
          state={isQaOpponentOverlay ? qaOpponentOverlayState : state}
          isCollapsed={isOpponentOverlayCollapsed}
          onCollapsedChange={api?.setOpponentOverlayCollapsed
            ? (collapsed) => { void api.setOpponentOverlayCollapsed!(collapsed); }
            : undefined}
          isLoading={isQaOpponentOverlay ? false : isInitializing}
          loadError={isQaOpponentOverlay || hasAcceptedTrackerState ? undefined : initializationError}
        />
      </>
    );
  }

  if (isFriendlyAttackOverlay || isOpponentAttackOverlay) {
    const boardState = overlaySearchParams.get("qa-opponent-demo") === "1" ? qaOpponentOverlayState : state;
    const side = isFriendlyAttackOverlay ? "friendly" : "opponent";
    return <SingleAttackOverlay side={side} value={boardState.boardAttack?.[side] ?? 0} />;
  }

  if (isSecretOverlay) {
    const secretState = overlaySearchParams.get("qa-secret-dense") === "1"
      ? qaDenseSecretOverlayState
      : overlaySearchParams.get("qa-opponent-demo") === "1"
        ? qaOpponentOverlayState
        : state;
    const secretView = toOverlayPanelViewModel(secretState, {
      maxDeckRows: 0,
      maxRecentRows: 0,
      side: "opponent",
      showSecretCandidates: true
    });
    return (
      <SecretOverlay
        slots={secretView.cardTracking.secretSlots}
        isCollapsed={isSecretOverlayCollapsed}
        onCollapsedChange={(collapsed) => {
          const changeVersion = secretOverlayCollapseChangeVersion.current + 1;
          secretOverlayCollapseChangeVersion.current = changeVersion;
          setIsSecretOverlayCollapsed(collapsed);
          const saveCollapsedState = api?.setSecretOverlayCollapsed?.(collapsed);
          if (saveCollapsedState) {
            void saveCollapsedState
              .then((savedCollapsed) => {
                if (secretOverlayCollapseChangeVersion.current === changeVersion) {
                  setIsSecretOverlayCollapsed(savedCollapsed);
                }
              })
              .catch(() => {
                if (secretOverlayCollapseChangeVersion.current === changeVersion) {
                  setIsSecretOverlayCollapsed(!collapsed);
                }
              });
          }
        }}
      />
    );
  }

  if (isSmartCounterOverlay) {
    const smartCounterId = overlaySearchParams.get("smart-counter-id")?.trim();
    const availableCounters = overlaySearchParams.get("qa-opponent-demo") === "1"
      ? qaSmartCounters
      : smartCountersFromState(state);
    const counters = smartCounterId
      ? availableCounters.filter((counter) => counter.id === smartCounterId)
      : availableCounters;
    return <SmartCounterOverlay counters={counters} />;
  }

  if (isBoardAttackOverlay) {
    const boardState = isQaBoardAttackOverlay ? qaOpponentOverlayState : state;
    return (
      <BoardAttackOverlay
        attack={boardState.boardAttack}
        showFriendly={overlaySearchParams.get("show-friendly-attack") !== "0"}
        showOpponent={overlaySearchParams.get("show-opponent-attack") !== "0"}
      />
    );
  }

  if (isArenaChoiceOverlay) {
    return <ArenaChoiceOverlayPanel arena={isQaArenaChoiceOverlay ? qaArenaChoiceOverlayState : state.arena} />;
  }

  if (isOverlay) {
    const retainedStateError = !isQaFriendlyOverlay && hasAcceptedTrackerState
      ? initializationError
      : undefined;
    return (
      <>
        <style>{rendererStyles}</style>
        {retainedStateError ? <div className="notice" role="alert">{retainedStateError}</div> : null}
        <OverlayWindow
          state={isQaFriendlyOverlay ? qaFriendlyOverlayState : state}
          onClose={api?.closeFriendlyOverlay ? closeFriendlyOverlay : undefined}
          onOpenSettings={api ? openSettingsInMainWindow : undefined}
          isLoading={isQaFriendlyOverlay ? false : isInitializing}
          loadError={isQaFriendlyOverlay || hasAcceptedTrackerState ? undefined : initializationError}
        />
      </>
    );
  }

  return (
    <>
      <style>{rendererStyles}</style>
      <div className={`desktop-frame ${activeView === "home" ? "is-home-frame" : "is-workbench-frame"}`}>
        <DesktopWindowTitlebar
          title={activeView === "home"
            ? ""
            : workbenchItems.find((item) => item.id === activeWorkbenchItem)?.label ?? "工作台"}
          isHome={activeView === "home"}
          onMinimize={() => { void minimizeMain(); }}
          onOpenWorkbench={() => navigateTo("tracker")}
          onReturnHome={() => navigateTo("home")}
        />
        {activeView === "home" ? null : (
          <DesktopSidebar
            activeItem={activeWorkbenchItem}
            status={trackerStatus}
            onNavigate={navigateToWorkbench}
          />
        )}
        <main className={`app-shell view-${activeView}`}>
          {activeView === "home" || activeView === "settings" || activeView === "deck-tools" ? null : <TopBar
            status={trackerStatus}
            isTracking={state.status === "watching" && !logIssue}
            isBusy={isBusy}
            onToggleTracking={toggleTracking}
            onChooseLogDirectory={selectPath}
            onEnsureLogConfig={ensureLogConfig}
            onToggleOverlay={toggleOverlay}
            onToggleOpponentOverlay={toggleOpponentOverlay}
            onMinimize={minimizeMain}
            onImportDeck={() => navigateTo("deck-tools")}
          />}

        {activeView === "home" && publishedDeckIdentityNotice ? (
          <div className="notice action-notice deck-identity-notice" role="status" aria-live="polite">
            <strong>{publishedDeckIdentityNotice.title}</strong>
            <span>{publishedDeckIdentityNotice.detail}</span>
          </div>
        ) : null}

        {activeView === "home" || activeView === "settings" || activeView === "deck-tools" ? null : isInitializing ? (
          <div className="notice action-notice" role="status" aria-live="polite">
            <strong>正在读取记牌器状态</strong>
            <span>正在扫描炉石日志，请稍候。</span>
          </div>
        ) : logRepairNotice ? (
          <div className="notice action-notice" role={logRepairNotice.role} aria-live="polite">
            <strong>{logRepairNotice.role === "alert" ? "修复日志失败" : "日志配置已修复"}</strong>
            <span>{logRepairNotice.message}</span>
          </div>
        ) : logIssue ? (
          activeView === "tracker" ? null : (
            <div className="notice action-notice" role="status">
              <strong>{logIssue.title}</strong>
              <span>{logIssue.message}</span>
            </div>
          )
        ) : publishedDeckIdentityNotice ? (
          <div className="notice action-notice deck-identity-notice" role="status" aria-live="polite">
            <strong>{publishedDeckIdentityNotice.title}</strong>
            <span>{publishedDeckIdentityNotice.detail}</span>
          </div>
        ) : autoMatchNotice ? (
          <div className="notice action-notice" role="status" aria-live="polite">
            <strong>自动匹配成功</strong>
            <span>{autoMatchNotice}</span>
          </div>
        ) : selectVisibleNotice(initializationError, state.error, notice) ? (
          <div className="notice" role={selectVisibleNotice(initializationError, state.error, notice)!.role}>
            {selectVisibleNotice(initializationError, state.error, notice)!.message}
          </div>
        ) : null}

        {activeView === "settings" ? (
          <SettingsPanel
            settings={trackerSettings}
            smartCounters={state.smartCounters}
            isLoading={isSettingsLoading}
            isSaving={isSettingsSaving}
            error={settingsError}
            notice={settingsNotice}
            onChange={(next) => { void saveTrackerSettings(next); }}
            onOpenLogFolder={api?.openLogFolder ? openSettingsLogFolder : undefined}
            onRefreshCardDatabase={api?.refreshCardDatabase ? refreshSettingsCardDatabase : undefined}
            onRestoreDefaults={api?.restoreDefaultSettings ? restoreSettingsDefaults : undefined}
          />
        ) : activeView === "deck-tools" ? (
          <DeckToolsPage
            deckText={deckText}
            collectionScan={collectionScan}
            collectionError={collectionError}
            notice={notice}
            isBusy={isBusy}
            isScanningCollection={isScanningCollection}
            importingCollectionDeckId={importingCollectionDeckId}
            onDeckTextChange={setDeckText}
            onImportDeck={() => { void importDeck(); }}
            onScanCollection={() => { void scanCollectionDecks(); }}
            onImportCollectionDeck={(deckId) => { void importCollectionDeck(deckId); }}
          />
        ) : activeView === "card-library" ? (
          <CardLibraryRoute
            result={cardLibraryResult}
            query={cardLibraryQuery}
            isLoading={isCardLibraryLoading}
            error={cardLibraryError}
            onQueryChange={updateCardLibraryQuery}
          />
        ) : activeView === "match-history" ? (
          <MatchHistoryPanel result={matchHistoryResult} loading={isMatchHistoryLoading} error={matchHistoryError} />
        ) : activeView === "home" ? (
          <HomeDashboard
            state={isQaHomeDemo ? qaHomeState : deckDisplayState}
            matchHistory={isQaHomeDemo ? qaHomeHistory : matchHistoryResult}
            matchHistoryLoading={isQaHomeDemo ? false : isMatchHistoryLoading}
            matchHistoryError={isQaHomeDemo ? undefined : matchHistoryError}
            homeNews={isQaHomeDemo ? qaHomeNews : homeNews}
            homeNewsLoading={isQaHomeDemo ? false : isHomeNewsLoading}
            homeNewsError={isQaHomeDemo ? undefined : homeNewsError}
            ladderRecommendation={isQaHomeDemo ? { status: "ready", recommendation: qaLadderRecommendation, stale: false } : homeLadderRecommendation}
            arenaHeroRanking={isQaHomeDemo ? qaArenaHeroRanking : homeArenaHeroRanking}
            arenaHeroRankingLoading={isQaHomeDemo ? false : isHomeArenaHeroRankingLoading}
            onCopyLadderDeckCode={api?.copyLadderDeckCode ? copyHomeLadderDeckCode : undefined}
            onOpenNewsItem={api?.openHomeNewsItem ? openHomeNewsItem : undefined}
            onOpenTracker={() => navigateTo("tracker")}
            onOpenDeckTools={() => navigateTo("deck-tools")}
            onOpenMatchHistory={() => navigateTo("match-history")}
          />
        ) : (
          <>
            <DashboardOverview state={deckDisplayState} status={trackerStatus} />
            <section className="dashboard-grid" aria-label="记牌器工作区">
              <DeckPanel cards={deckCards} summary={deckSummary} logIssue={logRepairNotice ? undefined : logIssue} />
              <EventFeed events={events} />
              {state.arena && state.arena.status !== "inactive" && state.arena.status !== "playing" ? (
                <ArenaPanel state={state.arena} />
              ) : (
                <OpponentPanel overview={opponentOverview} playedCards={opponentUsedCards} />
              )}
            </section>
          </>
        )}

        </main>
      </div>
    </>
  );
}

function DeckToolsPage({
  deckText,
  collectionScan,
  collectionError,
  notice,
  isBusy,
  isScanningCollection,
  importingCollectionDeckId,
  onDeckTextChange,
  onImportDeck,
  onScanCollection,
  onImportCollectionDeck
}: {
  deckText: string;
  collectionScan: CollectionDeckScanResult | undefined;
  collectionError: string | undefined;
  notice: string | undefined;
  isBusy: boolean;
  isScanningCollection: boolean;
  importingCollectionDeckId: string | undefined;
  onDeckTextChange: (value: string) => void;
  onImportDeck: () => void;
  onScanCollection: () => void;
  onImportCollectionDeck: (deckId: string) => void;
}) {
  return (
    <section className="deck-tools-page" aria-labelledby="deck-tools-title">
      <header className="deck-tools-header">
        <span className="deck-tools-header-icon" aria-hidden="true"><Upload size={25} /></span>
        <div>
          <span>卡组管理</span>
          <h1 id="deck-tools-title">卡组工具</h1>
          <p>粘贴卡组代码，或从炉石收藏读取本机套牌。</p>
        </div>
      </header>

      <div className="deck-tools-workspace">
        <section className="deck-tools-card deck-tools-manual" aria-labelledby="deck-tools-manual-title">
          <header>
            <div>
              <span>手动导入</span>
              <h2 id="deck-tools-manual-title">粘贴卡组代码</h2>
              <p>支持炉石卡组代码，也可以每行填写“2x 卡名”。</p>
            </div>
          </header>
          <textarea
            aria-label="卡组代码或卡牌列表"
            value={deckText}
            onChange={(event) => onDeckTextChange(event.target.value)}
            placeholder="粘贴炉石卡组代码，或每行写 2x 卡名"
            spellCheck={false}
          />
          <div className="deck-tools-actions">
            <button type="button" className="primary-action" onClick={onImportDeck} disabled={!deckText.trim() || isBusy}>
              导入当前内容
            </button>
          </div>
          {notice ? <div className="deck-tools-notice" role="status">{notice}</div> : null}
        </section>

        <section className="deck-tools-card collection-import" aria-labelledby="deck-tools-collection-title">
          <div className="collection-import-header">
            <div>
              <span>本机收藏</span>
              <h2 id="deck-tools-collection-title">我的收藏 / 套牌</h2>
              <small>{toCollectionScanMeta(collectionScan)}</small>
            </div>
            <button type="button" onClick={onScanCollection} disabled={isScanningCollection || isBusy}>
              {isScanningCollection ? "读取中" : "从收藏读取"}
            </button>
          </div>
          <p className="collection-help">先打开炉石，进入“我的收藏 → 套牌”，再点读取。</p>
          {collectionScan?.warning || collectionScan?.message || collectionError ? (
            <div className="collection-warning" role="status">
              {collectionError ?? collectionScan?.warning ?? collectionScan?.message}
            </div>
          ) : null}
          {collectionScan?.decks.length ? (
            <ul className="collection-deck-list">
              {collectionScan.decks.map((deck) => (
                <li key={deck.id}>
                  <div className="collection-deck-main">
                    <strong title={deck.name?.trim() || "未命名套牌"}>{deck.name?.trim() || "未命名套牌"}</strong>
                    <span>
                      {formatCollectionDeckCardCount(deck)} · {deck.heroClass ?? deck.format ?? deck.mode ?? "收藏套牌"}
                    </span>
                    <small>{formatCollectionDeckSource(deck, collectionScan)}</small>
                    {deck.warnings?.length ? <em>{deck.warnings.join("；")}</em> : null}
                  </div>
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => onImportCollectionDeck(deck.id)}
                    disabled={Boolean(importingCollectionDeckId) || isBusy}
                  >
                    {importingCollectionDeckId === deck.id ? "导入中" : "导入"}
                  </button>
                </li>
              ))}
            </ul>
          ) : collectionScan && collectionScan.status === "ok" ? (
            <div className="collection-empty">没有读到可导入套牌。</div>
          ) : (
            <div className="collection-empty">尚未读取收藏套牌。</div>
          )}
        </section>
      </div>
    </section>
  );
}

function DesktopSidebar({
  activeItem,
  status,
  onNavigate
}: {
  activeItem: WorkbenchNavId;
  status: TrackerStatus;
  onNavigate: (item: WorkbenchNavId) => void;
}) {
  return (
    <aside className="app-sidebar workbench-sidebar" aria-label="二级工作台导航">
      <section className="sidebar-brand" aria-label="炉石记牌器品牌">
        <span className="sidebar-brand-mark" aria-hidden="true"><Layers3 size={27} /></span>
        <span>
          <strong>炉石记牌器</strong>
          <small>v0.5.2</small>
        </span>
      </section>
      <nav className="sidebar-nav" aria-label="工作台功能">
        {workbenchItems.map(({ id, label, ariaLabel, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`sidebar-item${activeItem === id ? " is-active" : ""}`}
            aria-current={activeItem === id ? "page" : undefined}
            aria-label={ariaLabel}
            onClick={() => onNavigate(id)}
          >
            <Icon aria-hidden="true" size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <footer className="sidebar-footer">
        <span className={`sidebar-status-dot status-${status.state}`} aria-hidden="true" />
        <span>
          <strong>本机记录</strong>
          <small>{trackerStatusLabels[status.state]} · 数据不上传</small>
        </span>
      </footer>
    </aside>
  );
}

function DashboardOverview({ state, status }: { state: PublicTrackerState; status: TrackerStatus }) {
  const matchPulse = toMatchPulseViewFromState(state);
  const deckCountUnknown = isUnconfirmedConstructedDeck(state);
  const items = [
    {
      label: "牌库剩余",
      value: deckCountUnknown
        ? "?"
        : `${state.summary.remainingCards.toLocaleString("zh-CN")} / ${state.summary.totalCards.toLocaleString("zh-CN")}`,
      icon: Layers3
    },
    { label: "已抽", value: state.summary.drawnCards.toLocaleString("zh-CN"), icon: Activity },
    { label: "对手已出", value: state.cardTracking.opponent.used.totalCount.toLocaleString("zh-CN"), icon: Swords },
    ...(matchPulse?.fullLabel
      ? []
      : [{ label: "当前状态", value: status.isLoading ? "正在读取" : trackerStatusLabels[status.state], icon: Activity }])
  ];

  return (
    <section className="dashboard-overview summary-strip" aria-label="当前对局概览">
      {items.map(({ label, value, icon: Icon }) => (
        <article className="overview-stat metric" key={label}>
          <Icon aria-hidden="true" size={17} />
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
      {matchPulse ? (
        <article className="overview-stat metric match-pulse-metric">
          <Activity aria-hidden="true" size={17} />
          <span>当前进程</span>
          <MatchPulse pulse={matchPulse} variant="full" />
        </article>
      ) : null}
    </section>
  );
}

function isUnconfirmedConstructedDeck(state: PublicTrackerState): boolean {
  return Boolean(
    state.deckIdentity &&
    state.deckIdentity.status !== "confirmed" &&
    (!state.arena || state.arena.status === "inactive")
  );
}

function hideUnconfirmedDeck(state: PublicTrackerState): PublicTrackerState {
  if (!isUnconfirmedConstructedDeck(state)) {
    return state;
  }
  return {
    ...state,
    deckCode: undefined,
    deckName: undefined,
    autoMatchedDeckId: undefined,
    deck: [],
    summary: {
      ...state.summary,
      totalCards: 0,
      remainingCards: 0,
      drawnCards: 0
    }
  };
}

const qaLadderRecommendation: LadderDeckRecommendation = {
  id: "qa-standard-top",
  mode: "standard",
  region: "CN",
  patch: "36.0",
  name: "高胜率节奏战",
  className: "战士",
  winRate: 58.4,
  games: 12_486,
  deckCode: "AAECAQcCi6AE0LIHDuPmBqr8Bqv8BuiHB9KXB7etB4+xB+yyB4S9B7XAB5XCB5vCB5zCB/nDBwAA",
  cards: [
    { name: "赤红深渊", cost: 1, count: 2 },
    { name: "黑暗的龙骑士", cost: 1, count: 2 },
    { name: "礼盒雏龙", cost: 2, count: 2 },
    { name: "龙巢守护者", cost: 2, count: 2 },
    { name: "石雕工匠", cost: 2, count: 2 },
    { name: "先行打击", cost: 2, count: 2 },
    { name: "传送门卫士", cost: 3, count: 2 },
    { name: "诚恳商家格里伏塔", cost: 4, count: 1 },
    { name: "幻影绿翼龙", cost: 4, count: 2 },
    { name: "王室图书管理员", cost: 4, count: 2 },
    { name: "现场播报员", cost: 4, count: 2 },
    { name: "休憩飞行员诺莉亚", cost: 6, count: 1 }
  ],
  source: { name: "国服天梯统计", url: "https://www.iyingdi.com" },
  updatedAt: "2026-07-12T06:30:00.000Z"
};

export function LadderDeckRecommendationWindow({ searchParams }: { searchParams: URLSearchParams }) {
  const initialMode: LadderMode = searchParams.get("mode") === "wild" ? "wild" : "standard";
  const isQaDemo = searchParams.get("qa-ladder-demo") === "1";
  const api = window.hearthstoneTracker;
  const [mode, setMode] = useState<LadderMode>(initialMode);
  const [result, setResult] = useState<LadderDeckRecommendationResult | undefined>(
    isQaDemo ? { status: "ready", recommendation: { ...qaLadderRecommendation, mode: initialMode }, stale: false } : undefined
  );
  const [isLoading, setIsLoading] = useState(!isQaDemo);
  const requestSerial = useRef(0);

  useEffect(() => {
    if (isQaDemo) return;
    let disposed = false;
    const unsubscribe = api?.onLadderDeckRecommendationUpdate?.((nextMode, nextResult) => {
      if (disposed) return;
      requestSerial.current += 1;
      setMode(nextMode);
      setResult(nextResult);
      setIsLoading(false);
    });
    if (!api?.getLadderDeckRecommendation) {
      setResult({ status: "unavailable", message: "当前版本未接入天梯推荐数据" });
      setIsLoading(false);
    } else {
      const serial = ++requestSerial.current;
      void api.getLadderDeckRecommendation(initialMode).then((nextResult) => {
        if (!disposed && requestSerial.current === serial) {
          setResult(nextResult);
          setIsLoading(false);
        }
      }).catch(() => {
        if (!disposed && requestSerial.current === serial) {
          setResult({ status: "unavailable", message: "天梯推荐读取失败，请稍后重试" });
          setIsLoading(false);
        }
      });
    }
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [api, initialMode, isQaDemo]);

  const ready = result?.status === "ready" ? result : undefined;
  const unavailable = result?.status === "unavailable" ? result : undefined;
  const gameVersion = result && "gameVersion" in result && typeof result.gameVersion === "string"
    ? result.gameVersion
    : ready?.recommendation.patch;

  const retryRecommendation = () => {
    if (!api?.getLadderDeckRecommendation) return;
    const serial = ++requestSerial.current;
    setIsLoading(true);
    void api.getLadderDeckRecommendation(mode).then((nextResult) => {
      if (requestSerial.current === serial) setResult(nextResult);
    }).catch(() => {
      if (requestSerial.current === serial) {
        setResult({ status: "unavailable", message: "天梯推荐读取失败，请稍后重试" });
      }
    }).finally(() => {
      if (requestSerial.current === serial) setIsLoading(false);
    });
  };
  return (
    <LadderDeckRecommendationPanel
      mode={mode}
      gameVersion={gameVersion}
      recommendation={ready?.recommendation}
      unavailable={unavailable}
      isCached={ready?.stale}
      isLoading={isLoading}
      onRetry={retryRecommendation}
      onCopyDeckCode={async (deckCode) => {
        if (api?.copyLadderDeckCode) {
          await api.copyLadderDeckCode(deckCode);
          return;
        }
        if (isQaDemo) return navigator.clipboard.writeText(deckCode);
        throw new Error("复制功能不可用");
      }}
      onClose={() => {
        if (api?.closeLadderDeckOverlay) void api.closeLadderDeckOverlay();
        else window.close();
      }}
    />
  );
}

function CardLibraryRoute({
  result,
  query,
  isLoading,
  error,
  onQueryChange
}: {
  result: CardLibraryResult | undefined;
  query: CardLibraryQuery;
  isLoading: boolean;
  error: string | undefined;
  onQueryChange: (update: Partial<CardLibraryQuery>) => void;
}) {
  const pageSize = query.pageSize ?? cardLibraryPageSize;
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / pageSize));

  return (
    <CardLibraryPanel
      cards={result?.items ?? []}
      total={result?.total ?? 0}
      filters={{
        heroClass: query.heroClass ?? "",
        cardType: query.cardType ?? "",
        heroClasses: result?.heroClasses ?? [],
        cardTypes: result?.cardTypes ?? []
      }}
      query={query.query ?? ""}
      loading={isLoading}
      error={error}
      page={{
        current: result?.page ?? query.page ?? 1,
        totalPages
      }}
      onSearch={(nextQuery) => onQueryChange({ query: nextQuery })}
      onClassChange={(heroClass) => onQueryChange({ heroClass: heroClass || undefined })}
      onTypeChange={(cardType) => onQueryChange({ cardType: cardType || undefined })}
      onPageChange={(page) => onQueryChange({ page })}
      onSelectCard={() => undefined}
    />
  );
}

function OverlayWindow({
  state,
  onClose,
  onOpenSettings,
  isLoading,
  loadError
}: {
  state: PublicTrackerState;
  onClose?: () => void;
  onOpenSettings?: () => void;
  isLoading: boolean;
  loadError?: string;
}) {
  const overlayView = toOverlayPanelViewModel(state, { maxDeckRows: 40, maxRecentRows: 3 });
  return (
    <OverlayPanel
      view={overlayView}
      onClose={onClose}
      onOpenSettings={onOpenSettings}
      isLoading={isLoading}
      loadError={loadError}
    />
  );
}

const qaArenaHeroRanking: ArenaHeroWinRateRankingResult = {
  status: "ok",
  source: "竞技场公开统计",
  updatedAt: "2026-07-23T08:00:00.000Z",
  entries: [
    { rank: 1, heroName: "死亡骑士", heroClass: "Death Knight", winRate: 55.8, games: 42860 },
    { rank: 2, heroName: "恶魔猎手", heroClass: "Demon Hunter", winRate: 54.6, games: 39120 },
    { rank: 3, heroName: "萨满祭司", heroClass: "Shaman", winRate: 53.9, games: 36740 },
    { rank: 4, heroName: "猎人", heroClass: "Hunter", winRate: 52.7, games: 35210 },
    { rank: 5, heroName: "法师", heroClass: "Mage", winRate: 51.8, games: 44980 }
  ]
};

function ArenaHeroWinRateRankingWindow({ searchParams }: { searchParams: URLSearchParams }) {
  const api = window.hearthstoneTracker;
  const isQaDemo = searchParams.get("qa-arena-hero-ranking") === "1";
  const [result, setResult] = useState<ArenaHeroWinRateRankingResult | undefined>(isQaDemo ? qaArenaHeroRanking : undefined);
  const [isLoading, setIsLoading] = useState(Boolean(api?.onArenaHeroWinRateRankingUpdate) && !isQaDemo);

  useEffect(() => {
    if (isQaDemo) return;
    let disposed = false;
    const unsubscribe = api?.onArenaHeroWinRateRankingUpdate?.((nextResult) => {
      if (!disposed) {
        setResult(nextResult);
        setIsLoading(false);
      }
    });

    if (!api?.onArenaHeroWinRateRankingUpdate) {
      setResult({ status: "unavailable", message: "当前桌面版尚未提供竞技场英雄排行数据。" });
      setIsLoading(false);
      return unsubscribe;
    }

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [api, isQaDemo]);

  return (
    <ArenaHeroWinRateRankingPanel
      result={result}
      isLoading={isLoading}
      onClose={api?.closeArenaHeroWinRateRanking ? () => { void api.closeArenaHeroWinRateRanking!(); } : undefined}
    />
  );
}

function OpponentOverlayWindow({
  state,
  isCollapsed,
  onCollapsedChange,
  isLoading,
  loadError
}: {
  state: PublicTrackerState;
  isCollapsed: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  isLoading: boolean;
  loadError?: string;
}) {
  const rawOverlayView = toOverlayPanelViewModel(state, {
    maxDeckRows: 40,
    maxRecentRows: 40,
    side: "opponent",
    showSecretCandidates: false
  });
  const overlayView = {
    ...rawOverlayView,
    cardTracking: {
      ...rawOverlayView.cardTracking,
      secretSlots: []
    }
  };

  return (
    <OpponentOverlayPanel
      view={overlayView}
      isCollapsed={isCollapsed}
      onCollapsedChange={onCollapsedChange}
      isLoading={isLoading}
      loadError={loadError}
    />
  );
}

function CardPreviewWindow() {
  const shouldShowQaPreview = new URLSearchParams(window.location.search).get("qa-card-preview") === "1";
  const [details, setDetails] = useState<CardDetails | undefined>(shouldShowQaPreview ? qaCardPreviewDetails : undefined);
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    return window.hearthstoneTracker?.onCardPreviewUpdate?.((nextDetails) => {
      setDetails(nextDetails);
    });
  }, []);

  useEffect(() => window.hearthstoneTracker?.onCardPreviewPinnedChange?.(setIsPinned), []);

  return (
    <section className="card-preview-window-shell" data-pinned={isPinned} aria-label={details ? `卡牌说明：${details.name}` : "卡牌说明"}>
      {details ? (
        <CardDetailBody
          details={details}
          className="card-detail-body-hover"
          mode={isPinned ? "interactive" : "summary"}
        />
      ) : null}
      {details ? <div className="card-preview-hint">{isPinned ? "已固定 · ⌥Q 取消" : "⌥Q 固定 · 滚轮查看"}</div> : null}
    </section>
  );
}

function toTrackerStatus(
  state: PublicTrackerState,
  candidates: LogCandidate[],
  selectedLogPath: string | undefined,
  isLoading: boolean
): TrackerStatus {
  const logIssue = toLogIssueViewModel(state);
  const statusState: TrackerStatus["state"] =
    logIssue
      ? "offline"
      : state.status === "watching"
      ? "tracking"
      : state.status === "paused"
        ? "paused"
        : state.status === "missing-log" || state.status === "error"
          ? "offline"
          : "ready";

  return {
    state: statusState,
    isLoading,
    logPath: isLoading ? "正在读取本机日志" : logIssue?.detail ?? selectedLogPath ?? state.logPath ?? "自动寻找炉石日志",
    watchedFiles: isLoading ? 0 : candidates.filter((candidate) => candidate.exists).length || candidates.length || 1,
    eventCount: state.events.length,
    lastSyncedAt: isLoading ? "读取中" : formatTimeLabel(state.lastUpdated)
  };
}

function toUserErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function toLogIssueViewModel(state: PublicTrackerState): LogIssueViewModel | undefined {
  const logPath = state.logPath;

  if (state.status === "missing-log") {
    return {
      title: "缺少 Power.log",
      message: "先点“修复日志”，完全退出并重新打开炉石，然后进入一局。",
      detail: state.error ?? "还没有找到可用的 Power.log。",
      actions: logRepairActions
    };
  }

  if (state.status !== "watching" && logPath && isPlayerOnlyLogPath(logPath)) {
    return {
      title: "只有 Player.log",
      message: "当前日志不能读取抽牌和出牌。先点“修复日志”，完全退出并重新打开炉石，然后进入一局。",
      detail: `当前只看到 ${compactPath(logPath)}`,
      actions: logRepairActions
    };
  }

  return undefined;
}

function isPlayerOnlyLogPath(logPath: string | undefined): boolean {
  return Boolean(logPath?.trim().match(/(^|[\\/])Player\.log$/i));
}

function toDeckSummary(state: PublicTrackerState, deckImported: boolean): DeckSummary {
  return {
    deckName: state.deckName ?? (deckImported || state.deck.length ? "当前卡组" : "自动识别中"),
    totalCards: state.summary.totalCards,
    remainingCards: state.summary.remainingCards
  };
}

function toDeckCards(rows: CardTrackerRow[], includeUnresolved = false): DeckCard[] {
  return rows.filter((row) => includeUnresolved || !row.unresolved).map((row, index) => ({
    id: `deck-${row.name}-${index}`,
    name: row.name,
    cost: row.details?.manaCost,
    cardType: row.unresolved ? "未识别" : row.details?.cardType ?? "卡牌",
    drawn: row.drawn,
    copiesRemaining: row.remaining,
    copiesTotal: row.count,
    details: row.details,
    unresolved: row.unresolved
  }));
}

function toGameEvents(events: TrackerEvent[]): GameEvent[] {
  return events.map((event) => ({
    id: event.id,
    kind: mapEventKind(event),
    actor: event.player === "friendly" ? "me" : event.player === "opponent" ? "opponent" : "system",
    ...(event.turn === undefined ? {} : { turn: event.turn }),
    timestamp: formatTimeLabel(event.at),
    title: eventTitle(event),
    detail: eventDetail(event)
  }));
}

function toOpponentOverview(state: PublicTrackerState): OpponentOverview {
  const latestOpponentEvent = [...state.events].reverse().find((event) => event.player === "opponent");
  const opponent = toDashboardOpponentView(state);

  return {
    heroClass: "未知职业",
    ...(opponent.currentTurn === undefined ? {} : { currentTurn: opponent.currentTurn }),
    ...(opponent.handCount === undefined ? {} : { handSize: opponent.handCount }),
    ...(opponent.deckCount === undefined ? {} : { deckRemaining: opponent.deckCount }),
    ...(opponent.secretCount === undefined ? {} : { secretsInPlay: opponent.secretCount }),
    ...(opponent.fatigueDamage === undefined ? {} : { fatigueDamage: opponent.fatigueDamage }),
    lastAction: latestOpponentEvent ? eventTitle(latestOpponentEvent) : "等待对手动作"
  };
}

function toOpponentUsedCards(state: PublicTrackerState): OpponentPlayedCard[] {
  return toDashboardOpponentView(state).playedCards.map((card) => ({
    id: card.id,
    name: card.name,
    hidden: card.hidden,
    cost: card.details?.manaCost,
    ...(card.turn === undefined ? {} : { turn: card.turn }),
    count: card.count,
    details: card.details
  }));
}

function withImportedDeck(state: PublicTrackerState, deckText: string): PublicTrackerState {
  const deck = parseDeckRows(deckText);
  const totalCards = deck.reduce((total, row) => total + row.count, 0);

  return {
    ...state,
    deck,
    summary: {
      ...state.summary,
      totalCards,
      remainingCards: totalCards,
      drawnCards: 0
    },
    lastUpdated: new Date().toISOString()
  };
}

function parseDeckRows(deckText: string): CardTrackerRow[] {
  return deckText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s*x\s+(.+)$/i);
      const count = match ? Number(match[1]) : 1;
      const name = match ? match[2] : line;

      return {
        name,
        count,
        remaining: count,
        drawn: 0,
        played: 0
      };
    });
}

function toCollectionScanMeta(scan: CollectionDeckScanResult | undefined): string {
  if (!scan) {
    return "未读取";
  }

  const count = scan.decks.length.toLocaleString("zh-CN");
  const updatedAt = formatDateTimeLabel(scan.updatedAt);

  return updatedAt ? `${count} 套 · ${updatedAt}` : `${count} 套`;
}

function formatCollectionDeckCardCount(deck: CollectionDeckSummary): string {
  if (typeof deck.cardCount === "number") {
    return `${deck.cardCount} 张`;
  }

  if (deck.cards) {
    const cardCount = deck.cards.reduce((total, card) => total + card.count, 0);
    if (cardCount === 0 && deck.rawDeckString) {
      return "卡组代码";
    }

    return `${cardCount} 张`;
  }

  if (deck.rawDeckString) {
    return "卡组代码";
  }

  return "卡牌数待解析";
}

function formatCollectionDeckSource(deck: CollectionDeckSummary, scan: CollectionDeckScanResult): string {
  const source = deck.sourcePath ?? scan.sourcePath ?? "炉石收藏";
  const updatedAt = formatDateTimeLabel(deck.updatedAt ?? scan.updatedAt);

  return updatedAt ? `${compactPath(source)} · ${updatedAt}` : compactPath(source);
}

function mapEventKind(event: TrackerEvent): GameEvent["kind"] {
  if (event.kind === "draw") {
    return "draw";
  }

  if (event.kind === "friendly-play" || event.kind === "opponent-play") {
    return "play";
  }

  if (event.kind === "game-start") {
    return "turn";
  }

  if (event.kind === "zone-change") {
    return "secret";
  }

  return "log";
}

function eventTitle(event: TrackerEvent): string {
  switch (event.kind) {
    case "draw":
      return `我方抽到 ${event.cardName ?? "未知卡牌"}`;
    case "friendly-play":
      return `我方打出 ${event.cardName ?? "未知卡牌"}`;
    case "opponent-play":
      return `对手打出 ${event.cardName ?? "未知卡牌"}`;
    case "game-start":
      return "新对局开始";
    case "zone-change":
      return event.player === "opponent" ? "对手区域变化" : "区域变化";
    case "info":
      return event.cardName?.startsWith("已自动匹配：") ? "已自动匹配收藏套牌" : "日志提示";
    default:
      return "日志提示";
  }
}

function eventDetail(event: TrackerEvent): string {
  if (event.raw) {
    return event.raw;
  }

  if (event.fromZone || event.toZone) {
    return `${event.fromZone ?? "未知区域"} -> ${event.toZone ?? "未知区域"}`;
  }

  return event.cardName ? `记录到卡牌：${event.cardName}` : "等待日志解析提供更多信息。";
}

function formatTimeLabel(value: string | undefined): string {
  if (!value) {
    return "刚刚";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTimeLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function compactPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);

  if (parts.length <= 2) {
    return path;
  }

  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

const rendererStyles = `
.overlay-shell:has(.overlay-normal) .overlay-deck-summary {
  min-height: 30px;
}

.overlay-shell:has(.overlay-normal) .overlay-deck-identity-compact {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  column-gap: 3px;
}

.overlay-shell:has(.overlay-normal) .overlay-deck-identity-compact > .overlay-deck-name {
  grid-column: 1;
  grid-row: 1;
}

.overlay-shell:has(.overlay-normal) .overlay-deck-identity-compact > svg {
  grid-column: 2;
  grid-row: 1;
}

.overlay-shell:has(.overlay-normal) .overlay-deck-status-compact {
  grid-column: 1 / -1;
  grid-row: 2;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: #a9c5d7;
  font-size: 8px;
  font-weight: 750;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

body:not(:has(.overlay-shell)):not(:has(.board-attack-overlay-canvas)) {
  min-width: 860px;
  overflow: hidden;
  background:
    radial-gradient(circle at 12% 0%, rgba(228, 157, 74, 0.18), transparent 31rem),
    linear-gradient(135deg, #17110d 0%, #241a11 50%, #111818 100%);
}

button {
  border: 1px solid rgba(245, 235, 220, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.07);
  color: #f9f1e6;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  min-height: 34px;
  padding: 0 11px;
}

button:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(245, 196, 108, 0.5);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  padding: 18px;
  background: transparent;
}

.top-bar {
  align-items: center;
  background: rgba(33, 25, 18, 0.94);
  border: 1px solid rgba(245, 235, 220, 0.14);
  border-radius: 8px;
  display: grid;
  flex: 0 0 auto;
  gap: 10px;
  grid-template-columns: minmax(220px, 1fr) auto auto;
  min-height: 58px;
  padding: 10px 12px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.26);
  -webkit-app-region: drag;
}

.brand-block,
.status-strip,
.top-actions,
.panel-heading,
.timeline-meta,
.hint-line,
.fatigue-block,
.subheading {
  display: flex;
  align-items: center;
}

.brand-block {
  gap: 12px;
  min-width: 0;
}

.brand-mark,
.panel-icon,
.timeline-icon {
  align-items: center;
  border-radius: 8px;
  display: inline-flex;
  justify-content: center;
  flex: 0 0 auto;
}

.brand-mark {
  background: linear-gradient(135deg, #e7a64c, #8e3b2c);
  color: #1b120c;
  height: 36px;
  width: 36px;
}

.brand-block h1,
.panel-heading h2,
.timeline-row h3,
.subheading h3,
.brand-block p,
.timeline-row p,
.last-action p {
  margin: 0;
}

.brand-block h1 {
  color: #f5ebdc;
  font-size: 16px;
  line-height: 1.2;
}

.brand-block p,
.timeline-row p,
.hint-line,
.last-action p {
  color: #cdbda8;
}

.brand-block p {
  font-size: 12px;
  line-height: 1.45;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-strip {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(245, 235, 220, 0.11);
  border-radius: 8px;
  gap: 8px;
  padding: 9px 12px;
  white-space: nowrap;
}

.status-strip strong {
  color: #f5ebdc;
  font-size: 13px;
}

.status-strip span:last-child {
  color: #cdbda8;
  font-size: 12px;
}

.status-dot {
  border-radius: 50%;
  height: 9px;
  width: 9px;
}

.status-ready {
  background: #e5a84e;
}

.status-tracking {
  background: #50d38a;
  box-shadow: 0 0 0 4px rgba(80, 211, 138, 0.14);
}

.status-paused {
  background: #d86a48;
}

.status-offline {
  background: #8d8a85;
}

.top-actions {
  gap: 8px;
  justify-content: flex-end;
  -webkit-app-region: no-drag;
}

.top-actions .icon-action {
  width: 34px;
  min-width: 34px;
  min-height: 34px;
  justify-content: center;
  padding: 0;
}

.top-actions button {
  white-space: nowrap;
}

.primary-action {
  background: linear-gradient(135deg, #f4ba59, #b94b35);
  border-color: rgba(255, 231, 159, 0.34);
  color: #21130c;
}

.dashboard-grid {
  display: grid;
  flex: 1 1 auto;
  gap: 10px;
  grid-template-columns: minmax(220px, 0.82fr) minmax(300px, 1.35fr) minmax(220px, 0.9fr);
  margin-top: 10px;
  min-height: 0;
  overflow: hidden;
}

.panel {
  background: rgba(29, 23, 18, 0.9);
  border: 1px solid rgba(245, 235, 220, 0.13);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 12px;
  box-shadow: none;
}

.panel-heading {
  flex: 0 0 auto;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.eyebrow {
  color: #d39f59;
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
  margin-bottom: 5px;
}

.panel-heading h2 {
  color: #f5ebdc;
  font-size: 16px;
  line-height: 1.2;
}

.panel-icon {
  background: rgba(229, 168, 78, 0.14);
  color: #f0b75e;
  height: 34px;
  width: 34px;
}

.panel-icon.danger {
  background: rgba(196, 76, 61, 0.17);
  color: #ff9279;
}

.deck-summary {
  background: linear-gradient(135deg, rgba(231, 166, 76, 0.16), rgba(76, 143, 127, 0.12));
  border: 1px solid rgba(245, 235, 220, 0.12);
  border-radius: 8px;
  flex: 0 0 auto;
  padding: 12px;
}

.deck-summary strong {
  color: #f5ebdc;
  font-size: 28px;
  line-height: 1;
}

.deck-summary span {
  color: #cdbda8;
  margin-left: 6px;
}

.meter {
  background: rgba(0, 0, 0, 0.28);
  border-radius: 999px;
  height: 7px;
  margin-top: 12px;
  overflow: hidden;
}

.meter span {
  background: linear-gradient(90deg, #50d38a, #f1bb58);
  display: block;
  height: 100%;
  margin: 0;
}

.card-list,
.played-list,
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}

.card-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.deck-card-row,
.played-list li {
  align-items: center;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(245, 235, 220, 0.1);
  border-radius: 8px;
  display: grid;
}

.deck-card-row {
  gap: 10px;
  grid-template-columns: 30px 1fr auto;
  min-height: 46px;
  padding: 7px;
}

.deck-card-row.is-gone {
  opacity: 0.48;
}

.mana-cost {
  align-items: center;
  background: radial-gradient(circle at 35% 25%, #84d8ff, #286b9d 72%);
  border: 1px solid rgba(219, 241, 255, 0.52);
  border-radius: 50%;
  color: #f8fcff;
  display: inline-flex;
  font-size: 13px;
  font-weight: 900;
  height: 30px;
  justify-content: center;
  width: 30px;
}

.card-main {
  min-width: 0;
}

.card-main span,
.played-list strong {
  color: #f5ebdc;
  display: block;
  font-size: 14px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-main small,
.played-list small,
.timeline-meta {
  color: #b9aa95;
  font-size: 11px;
}

.deck-card-row > strong {
  color: #f1bb58;
  font-size: 13px;
}

.hint-line {
  border-top: 1px solid rgba(245, 235, 220, 0.1);
  flex: 0 0 auto;
  gap: 7px;
  line-height: 1.45;
  margin-top: 10px;
  padding-top: 10px;
  font-size: 12px;
}

.event-feed {
  display: flex;
}

.event-count {
  background: rgba(76, 143, 127, 0.16);
  border: 1px solid rgba(96, 190, 169, 0.22);
  border-radius: 999px;
  color: #87dac5;
  font-size: 12px;
  font-weight: 800;
  padding: 6px 10px;
}

.timeline {
  display: grid;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.timeline-row {
  display: grid;
  gap: 12px;
  grid-template-columns: 36px 1fr;
  position: relative;
}

.timeline-icon {
  background: rgba(245, 235, 220, 0.08);
  border: 1px solid rgba(245, 235, 220, 0.12);
  color: #f1bb58;
  height: 36px;
  width: 36px;
}

.actor-opponent .timeline-icon {
  color: #ff9279;
}

.actor-me .timeline-icon {
  color: #87dac5;
}

.timeline-row article {
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(245, 235, 220, 0.1);
  border-radius: 8px;
  padding: 10px;
}

.timeline-meta {
  gap: 8px;
  margin-bottom: 7px;
}

.timeline-row h3 {
  color: #f5ebdc;
  font-size: 14px;
  line-height: 1.35;
}

.timeline-row p {
  font-size: 13px;
  line-height: 1.5;
  margin-top: 5px;
}

.overview-grid {
  flex: 0 0 auto;
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.stat-tile {
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(245, 235, 220, 0.1);
  border-radius: 8px;
  display: grid;
  gap: 6px;
  min-height: 70px;
  padding: 10px;
}

.stat-tile svg {
  color: #87dac5;
}

.stat-tile span,
.last-action span,
.subheading span {
  color: #b9aa95;
  font-size: 12px;
}

.stat-tile strong {
  color: #f5ebdc;
  font-size: 24px;
}

.fatigue-block {
  background: rgba(185, 75, 53, 0.14);
  border: 1px solid rgba(255, 146, 121, 0.22);
  border-radius: 8px;
  flex: 0 0 auto;
  gap: 10px;
  margin-top: 10px;
  padding: 10px;
}

.fatigue-block svg {
  color: #ff9279;
}

.fatigue-block span {
  color: #e0cbbb;
  flex: 1;
  font-size: 13px;
}

.fatigue-block strong {
  color: #ffb29f;
  font-size: 20px;
}

.last-action {
  border-bottom: 1px solid rgba(245, 235, 220, 0.1);
  border-top: 1px solid rgba(245, 235, 220, 0.1);
  flex: 0 0 auto;
  margin: 10px 0;
  padding: 10px 0;
}

.last-action p {
  font-size: 13px;
  line-height: 1.45;
  margin-top: 6px;
}

.subheading {
  justify-content: space-between;
  margin-bottom: 10px;
}

.subheading h3 {
  color: #f5ebdc;
  font-size: 15px;
}

.played-list {
  display: grid;
  gap: 8px;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.played-list li {
  gap: 10px;
  grid-template-columns: 30px 1fr auto;
  min-height: 46px;
  padding: 7px;
}

.played-list em {
  color: #f1bb58;
  font-style: normal;
  font-weight: 900;
}

.arena-panel {
  gap: 10px;
}

.arena-icon {
  background: rgba(116, 173, 222, 0.16);
  color: #9ad7f4;
}

.arena-progress {
  background: rgba(116, 173, 222, 0.1);
  border: 1px solid rgba(154, 215, 244, 0.18);
  border-radius: 8px;
  display: grid;
  gap: 3px;
  padding: 10px;
}

.arena-progress strong {
  color: #e8f7ff;
  font-size: 23px;
  line-height: 1;
}

.arena-progress span,
.arena-progress small,
.arena-waiting,
.arena-choices small,
.arena-deck li {
  color: #b9cbd6;
  font-size: 11px;
}

.arena-progress small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arena-choices,
.arena-deck {
  min-height: 0;
}

.arena-choices ul,
.arena-deck ul {
  display: grid;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.arena-choices ul {
  flex: 0 1 auto;
}

.arena-choices li,
.arena-deck li {
  align-items: center;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(154, 215, 244, 0.12);
  border-radius: 7px;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-width: 0;
  padding: 7px 8px;
}

.arena-choices li > div {
  min-width: 0;
}

.arena-choices strong {
  color: #f5ebdc;
  display: block;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arena-choices small {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arena-choices .arena-rating-breakdown {
  color: #d4c48e;
  font-size: 10px;
}

.arena-score {
  align-items: center;
  background: rgba(154, 215, 244, 0.2);
  border: 1px solid rgba(154, 215, 244, 0.28);
  border-radius: 6px;
  color: #c9efff;
  display: grid;
  flex: 0 0 auto;
  gap: 1px;
  min-width: 48px;
  padding: 5px 6px;
  text-align: center;
}

.arena-score strong {
  color: inherit;
  font-size: 14px;
  font-weight: 900;
  line-height: 1;
}

.arena-score small {
  color: inherit;
  font-size: 10px;
  line-height: 1.1;
}

.arena-score-s {
  background: rgba(250, 204, 21, 0.2);
  border-color: rgba(250, 204, 21, 0.48);
  color: #ffe58a;
}

.arena-score-a {
  background: rgba(74, 222, 128, 0.18);
  border-color: rgba(74, 222, 128, 0.38);
  color: #b5f7c9;
}

.arena-score-b {
  background: rgba(154, 215, 244, 0.2);
  color: #c9efff;
}

.arena-score-c {
  background: rgba(148, 163, 184, 0.18);
  border-color: rgba(148, 163, 184, 0.32);
  color: #d4dce4;
}

.arena-score-d {
  background: rgba(251, 146, 60, 0.18);
  border-color: rgba(251, 146, 60, 0.36);
  color: #ffd0a8;
}

.arena-score-f,
.arena-score-unknown {
  background: rgba(248, 113, 113, 0.16);
  border-color: rgba(248, 113, 113, 0.32);
  color: #ffc2c2;
}

.arena-recommendation {
  color: #fff0a8 !important;
  font-size: 9px !important;
  font-weight: 900;
}

.card-detail-disclosure {
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(245, 235, 220, 0.1);
  border-radius: 8px;
  overflow: hidden;
}

.card-detail-disclosure > summary {
  cursor: pointer;
  list-style: none;
}

.card-detail-disclosure > summary::-webkit-details-marker {
  display: none;
}

.card-detail-disclosure > summary:focus-visible {
  outline: 2px solid rgba(154, 215, 244, 0.72);
  outline-offset: -2px;
}

.card-detail-disclosure .deck-card-row,
.card-detail-disclosure .played-card-row {
  background: transparent;
  border: 0;
  border-radius: 0;
}

.card-detail-disclosure .played-card-row {
  align-items: center;
  display: grid;
  gap: 10px;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  min-height: 46px;
  padding: 7px;
}

.card-thumb {
  background: rgba(8, 13, 20, 0.72);
  border: 1px solid rgba(219, 241, 255, 0.25);
  border-radius: 5px;
  display: block;
  height: 40px;
  object-fit: cover;
  width: 30px;
}

.card-detail-body {
  border-top: 1px solid rgba(245, 235, 220, 0.1);
  display: grid;
  gap: 10px;
  grid-template-columns: 78px minmax(0, 1fr);
  padding: 10px;
}

.card-detail-image {
  aspect-ratio: 0.72;
  background: rgba(8, 13, 20, 0.72);
  border: 1px solid rgba(219, 241, 255, 0.25);
  border-radius: 6px;
  display: block;
  object-fit: cover;
  width: 78px;
}

.card-detail-image-empty {
  align-items: center;
  color: #8e9aa6;
  display: flex;
  font-size: 11px;
  justify-content: center;
  text-align: center;
}

.card-detail-copy {
  min-width: 0;
}

.card-detail-heading {
  align-items: baseline;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.card-detail-heading strong {
  color: #f5ebdc;
  font-size: 14px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-detail-heading span,
.card-detail-meta,
.card-detail-stats,
.card-related-list > span {
  color: #b9cbd6;
  font-size: 11px;
}

.card-detail-stats {
  color: #f1bb58;
  margin-top: 4px;
}

.card-detail-meta {
  margin-top: 4px;
}

.card-detail-text {
  color: #e4eaf0;
  font-size: 12px;
  line-height: 1.45;
  margin-top: 8px;
  white-space: pre-wrap;
}

.card-related-list {
  border-top: 1px solid rgba(245, 235, 220, 0.08);
  margin-top: 8px;
  padding-top: 7px;
}

.card-related-list p {
  color: #d7e9f2;
  font-size: 12px;
  line-height: 1.4;
  margin-top: 3px;
}

.card-detail-empty {
  border-top: 1px solid rgba(245, 235, 220, 0.1);
  color: #8e9aa6;
  font-size: 12px;
  padding: 10px;
}

.played-list > li {
  background: transparent;
  border: 0;
  display: block;
  padding: 0;
}

.arena-choices li:has(.arena-choice-disclosure) {
  display: block;
  padding: 0;
}

.arena-choice-disclosure {
  border-color: rgba(154, 215, 244, 0.12);
}

.arena-choice-row {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  min-height: 46px;
  padding: 7px 8px;
}

.arena-choice-row > div {
  min-width: 0;
}

.arena-deck li .card-thumb {
  height: 32px;
  width: 24px;
}

.arena-waiting {
  align-items: center;
  border: 1px dashed rgba(245, 235, 220, 0.16);
  display: flex;
  gap: 7px;
  padding: 9px;
}

.arena-deck {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
}

.arena-deck ul {
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.arena-deck li {
  min-height: 30px;
}

.arena-deck li span {
  color: #f5ebdc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arena-deck li strong {
  color: #f1bb58;
  flex: 0 0 auto;
}

.arena-last-pick {
  align-items: center;
  border-top: 1px solid rgba(245, 235, 220, 0.1);
  color: #87dac5;
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  padding-top: 9px;
}

.arena-last-pick span {
  color: #cfeee3;
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-backdrop {
  z-index: 20;
}

.modal {
  background: #1d1712;
  box-sizing: border-box;
  color: #f5ebdc;
  display: flex;
  flex-direction: column;
  max-height: min(650px, calc(100vh - 48px));
  min-height: 0;
  overflow: hidden;
  width: min(660px, calc(100vw - 36px));
}

.modal textarea {
  color: #f5ebdc;
  background: #130f0c;
  flex: 0 1 150px;
  min-height: 120px;
}

.collection-import {
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(245, 235, 220, 0.1);
  border-radius: 8px;
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
  min-height: 0;
  overflow: hidden;
  padding: 10px;
}

.collection-import-header {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.collection-import-header div,
.collection-deck-main {
  min-width: 0;
}

.collection-import-header strong,
.collection-deck-main strong {
  color: #f5ebdc;
  display: block;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collection-import-header span,
.collection-help,
.collection-deck-main span,
.collection-deck-main small {
  color: #b9aa95;
  display: block;
  font-size: 11px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collection-import .collection-help {
  margin: -4px 0 0;
}

.collection-warning,
.collection-empty {
  background: rgba(185, 75, 53, 0.14);
  border: 1px solid rgba(255, 146, 121, 0.18);
  border-radius: 8px;
  color: #ffcabd;
  font-size: 12px;
  line-height: 1.45;
  padding: 8px 10px;
}

.collection-empty {
  background: rgba(255, 255, 255, 0.055);
  border-color: rgba(245, 235, 220, 0.1);
  color: #cdbda8;
}

.collection-deck-list {
  display: grid;
  flex: 0 1 auto;
  gap: 7px;
  list-style: none;
  margin: 0;
  max-height: 190px;
  min-height: 0;
  overflow: auto;
  padding: 0 2px 0 0;
}

.collection-deck-list li {
  align-items: center;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(245, 235, 220, 0.09);
  border-radius: 8px;
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 58px;
  padding: 8px;
}

.collection-deck-main em {
  color: #e6ae65;
  display: block;
  font-size: 11px;
  font-style: normal;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .top-bar {
    grid-template-columns: minmax(220px, 1fr) auto auto;
  }

  .top-actions {
    justify-content: flex-end;
    flex-wrap: nowrap;
  }

  .dashboard-grid {
    grid-template-columns: minmax(200px, 0.8fr) minmax(280px, 1.12fr) minmax(210px, 0.88fr);
  }

  .panel {
    min-height: 0;
  }
}

@media (max-width: 980px), (max-height: 680px) {
  .app-shell {
    padding: 8px;
  }

  .top-bar {
    min-height: 46px;
    padding: 7px 8px;
  }

  .brand-mark {
    height: 30px;
    width: 30px;
  }

  .brand-block h1 {
    font-size: 14px;
  }

  .brand-block p,
  .status-strip span:last-child {
    font-size: 11px;
  }

  .status-strip {
    padding: 7px 8px;
  }

  button {
    min-height: 30px;
    padding: 0 9px;
  }

  .top-actions {
    gap: 6px;
  }

  .top-actions button {
    width: 32px;
    gap: 0;
    overflow: hidden;
    padding: 0;
    font-size: 0;
  }

  .top-actions button svg {
    flex: 0 0 auto;
  }

  .dashboard-grid {
    gap: 7px;
    grid-template-columns: minmax(190px, 0.78fr) minmax(260px, 1.08fr) minmax(200px, 0.86fr);
    margin-top: 7px;
  }

  .panel {
    padding: 9px;
  }

  .panel-heading {
    margin-bottom: 7px;
  }

  .panel-heading h2 {
    font-size: 14px;
  }

  .panel-icon {
    height: 30px;
    width: 30px;
  }

  .deck-summary {
    padding: 9px;
  }

  .deck-summary strong {
    font-size: 24px;
  }

  .deck-card-row,
  .played-list li {
    min-height: 38px;
    padding: 5px;
  }

  .mana-cost {
    height: 26px;
    width: 26px;
  }

  .card-main span,
  .played-list strong,
  .timeline-row h3 {
    font-size: 12.5px;
  }

  .hint-line {
    display: none;
  }

  .timeline {
    gap: 8px;
  }

  .timeline-row {
    gap: 8px;
    grid-template-columns: 30px 1fr;
  }

  .timeline-icon {
    height: 30px;
    width: 30px;
  }

  .timeline-row article {
    padding: 8px;
  }

  .timeline-row p,
  .last-action p {
    font-size: 12px;
    line-height: 1.35;
  }

  .stat-tile {
    min-height: 58px;
    padding: 8px;
  }

  .stat-tile strong {
    font-size: 20px;
  }

  .fatigue-block,
  .last-action {
    margin-top: 8px;
  }

  .modal-backdrop {
    padding: 12px;
  }

  .modal {
    max-height: calc(100vh - 24px);
    padding: 12px;
  }

  .modal h2 {
    margin-bottom: 6px;
    font-size: 16px;
  }

  .modal p {
    margin-bottom: 8px;
  }

  .modal textarea {
    flex-basis: 110px;
    min-height: 92px;
  }

  .collection-import {
    gap: 8px;
    margin-bottom: 8px;
    padding: 8px;
  }

  .collection-deck-list {
    max-height: clamp(112px, 22vh, 160px);
  }

  .modal-actions {
    margin-top: 10px;
  }
}

/* Final light-theme guard. This block intentionally lives after every legacy
   renderer rule so the white workbench cannot inherit dark card or arena UI. */
html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell),
html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) :is(
  .card-detail-body,
  .card-detail-body-hover,
  .card-detail-empty,
  .card-detail-image,
  .card-related-list,
  .card-related-card,
  .card-related-art,
  .card-spell-history-empty,
  .card-game-context,
  .card-outcome-section,
  .card-pool-load-more,
  .card-preview-hint
) {
  border-color: #dbe3ed;
  color: #253044;
  background: #ffffff;
  box-shadow: none;
}

html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) :is(
  .card-detail-heading strong,
  .card-related-card strong
) {
  color: #253044;
}

html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) :is(
  .card-detail-heading span,
  .card-detail-meta,
  .card-related-list > span,
  .card-related-card small,
  .card-preview-hint,
  .card-pool-section > summary
) {
  color: #526176;
}

html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) :is(
  .card-detail-text,
  .card-related-card p
) {
  color: #334155;
}

html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) :is(
  .card-detail-stats,
  .played-spells-progress,
  .card-outcome-children > span
) {
  color: #795500;
}

html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) .played-spells-cost-group > strong,
html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) .card-pool-load-more:hover,
html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) .card-pool-load-more:focus-visible {
  color: #176fd7;
}

html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) .card-pool-load-more:hover,
html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) .card-pool-load-more:focus-visible {
  border-color: #a9c8ed;
  background: #f5f9ff;
}

html[data-tracker-theme="light"] :is(.card-hover-preview, .card-preview-window-shell) .card-outcome-children {
  border-left-color: #d9e2ee;
}

html[data-tracker-theme="light"] :is(
  .arena-progress strong,
  .arena-deck li span,
  .arena-last-pick > span:first-of-type
) {
  color: #253044;
}

html[data-tracker-theme="light"] :is(
  .arena-progress span,
  .arena-progress small,
  .arena-waiting
) {
  color: #526176;
}

html[data-tracker-theme="light"] .arena-deck li > strong {
  color: #176fd7;
}

html[data-tracker-theme="light"] :is(.arena-score, .arena-score strong, .arena-score small) {
  color: #176fd7;
}

html[data-tracker-theme="light"] .arena-score {
  border-color: #bfd4ed;
  background: #edf5ff;
}

html[data-tracker-theme="light"] .arena-score-s {
  border-color: #e4cd8a;
  color: #795500;
  background: #fff9e8;
}

html[data-tracker-theme="light"] .arena-score-a {
  border-color: #b9ddc8;
  color: #187a46;
  background: #eefbf3;
}

html[data-tracker-theme="light"] .arena-score-c {
  border-color: #d5dde7;
  color: #42516a;
  background: #f5f7fa;
}

html[data-tracker-theme="light"] .arena-score-d {
  border-color: #e8c7a7;
  color: #934600;
  background: #fff6ed;
}

html[data-tracker-theme="light"] :is(.arena-score-f, .arena-score-unknown) {
  border-color: #e6bec3;
  color: #a3313d;
  background: #fff4f5;
}

html[data-tracker-theme="light"] .arena-recommendation {
  color: #795500 !important;
}

html[data-tracker-theme="light"] :is(
  .card-library-stale-warning,
  .card-library-art,
  .card-library-art.is-empty,
  .card-library-selected,
  .card-library-pagination button
) {
  border-color: #dbe3ed;
  color: #253044;
  background: #ffffff;
  box-shadow: none;
}

html[data-tracker-theme="light"] .card-library-stale-warning {
  border-color: #ead8a8;
  color: #795500;
  background: #fffdf7;
}

html[data-tracker-theme="light"] :is(
  .card-library-results-bar span:first-child,
  .card-library-state strong,
  .card-library-card-copy strong,
  .card-library-selected-heading strong,
  .card-library-selected .card-detail-heading strong
) {
  color: #253044;
}

html[data-tracker-theme="light"] :is(
  .card-library-state span,
  .card-library-card-copy small,
  .card-library-selected .card-detail-meta
) {
  color: #526176;
}

html[data-tracker-theme="light"] .card-library-selected .card-detail-text {
  color: #334155;
}

html[data-tracker-theme="light"] .card-library-state.is-error :is(svg, strong) {
  color: #a3313d;
}

html[data-tracker-theme="light"] :is(
  .card-library-pagination button:hover:not(:disabled),
  .card-library-pagination button:focus-visible
) {
  border-color: #a9c8ed;
  color: #176fd7;
  background: #f5f9ff;
}
`;

export default App;
