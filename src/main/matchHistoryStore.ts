import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { MatchHistoryResult, MatchMode, MatchRecord, MatchResult } from "../shared/types.js";

const DATABASE_FILE_NAME = "match-history.json";
const MATCH_HISTORY_LIMIT = 100;

export class MatchHistoryStore {
  private writeChain: Promise<void> = Promise.resolve();
  private writeErrors = new Map<string, Error>();
  private retentionDays: 30 | 90 | 180 | undefined;

  constructor(private readonly databasePath = path.join(app.getPath("userData"), DATABASE_FILE_NAME)) {}

  setRetentionDays(days: 30 | 90 | 180): void {
    this.retentionDays = days;
  }

  async getHistory(): Promise<MatchHistoryResult> {
    await this.writeChain.catch(() => undefined);
    const writeError = this.writeErrors.values().next().value;
    if (writeError) {
      return { status: "error", error: `写入对局历史失败：${writeError.message}` };
    }

    try {
      const matches = await this.readMatches();
      return { status: "ok", matches, summary: summarizeMatches(matches) };
    } catch (error) {
      return { status: "error", error: `读取对局历史失败：${formatError(error)}` };
    }
  }

  async add(match: MatchRecord): Promise<void> {
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      try {
        const current = await this.readMatches();
        if (current.some((entry) => entry.id === match.id)) {
          this.writeErrors.delete(match.id);
          return;
        }
        const matches = [...current, match]
          .sort((left, right) => Date.parse(right.endedAt) - Date.parse(left.endedAt))
          .slice(0, MATCH_HISTORY_LIMIT);
        await this.writeMatches(matches);
        this.writeErrors.delete(match.id);
      } catch (error) {
        this.writeErrors.set(match.id, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    });
    this.writeChain = operation;
    await operation;
  }

  private async readMatches(): Promise<MatchRecord[]> {
    try {
      const value = JSON.parse(await fs.readFile(this.databasePath, "utf8")) as unknown;
      if (!isRecord(value) || !Array.isArray(value.matches)) {
        throw new Error("文件格式无效");
      }
      const matches = value.matches.map(parseMatchRecord);
      if (!this.retentionDays) return matches;
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      return matches.filter((match) => Date.parse(match.endedAt) >= cutoff);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async writeMatches(matches: readonly MatchRecord[]) {
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    const temporaryPath = `${this.databasePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify({ matches }, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, this.databasePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function summarizeMatches(matches: readonly MatchRecord[]) {
  const wins = matches.filter((match) => match.result === "win").length;
  const losses = matches.filter((match) => match.result === "loss").length;
  const ties = matches.filter((match) => match.result === "tie").length;
  return {
    total: matches.length,
    wins,
    losses,
    ties,
    winRate: matches.length > 0 ? wins / matches.length : 0
  };
}

function parseMatchRecord(value: unknown): MatchRecord {
  if (!isRecord(value)) {
    throw new Error("对局记录格式无效");
  }

  const { id, result, mode, deckName, endedAt } = value;
  if (
    typeof id !== "string" ||
    !isMatchResult(result) ||
    !isMatchMode(mode) ||
    (deckName !== undefined && typeof deckName !== "string") ||
    typeof endedAt !== "string" ||
    !Number.isFinite(Date.parse(endedAt))
  ) {
    throw new Error("对局记录字段无效");
  }

  return { id, result, mode, ...(deckName ? { deckName } : {}), endedAt };
}

function isMatchResult(value: unknown): value is MatchResult {
  return value === "win" || value === "loss" || value === "tie";
}

function isMatchMode(value: unknown): value is MatchMode {
  return value === "standard" || value === "wild" || value === "casual" || value === "arena" || value === "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
