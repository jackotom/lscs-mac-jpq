export interface ArenaHeroWinRateRankingEntry {
  readonly rank: number;
  readonly heroName: string;
  readonly heroClass: string;
  readonly games: number;
  readonly winRate: number;
}

export type ArenaHeroWinRateRankingResult =
  | {
      readonly status: "ok";
      readonly entries: readonly ArenaHeroWinRateRankingEntry[];
      readonly source: string;
      readonly updatedAt: string;
      readonly fetchedAt?: string;
      readonly sample?: number;
      readonly warning?: string;
    }
  | {
      readonly status: "unavailable" | "error";
      readonly message: string;
    };
