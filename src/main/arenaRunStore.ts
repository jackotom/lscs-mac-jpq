import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseArenaRuns, type ArenaRunRecord } from "../shared/arenaInsights.js";

const FILE_NAME = "arena-runs.json";
export type ArenaRetentionDays = 30 | 90 | 180;

export class ArenaRunStore {
  private writeChain = Promise.resolve();

  constructor(
    private readonly filePath = path.join(app.getPath("userData"), FILE_NAME),
    private readonly now: () => Date = () => new Date()
  ) {}

  getPath() { return this.filePath; }

  async read(retentionDays?: ArenaRetentionDays): Promise<ArenaRunRecord[]> {
    await this.writeChain.catch(() => undefined);
    const runs = await this.readFile();
    if (!retentionDays) return runs;
    const cutoff = this.now().getTime() - retentionDays * 86_400_000;
    return runs.filter((run) => Date.parse(run.endedAt ?? run.startedAt) >= cutoff);
  }

  async replace(runs: readonly ArenaRunRecord[]): Promise<ArenaRunRecord[]> {
    const parsed = parseArenaRuns(runs);
    await this.enqueueWrite(parsed);
    return parsed;
  }

  async upsert(run: ArenaRunRecord): Promise<ArenaRunRecord> {
    const [parsed] = parseArenaRuns([run]);
    if (!parsed) throw new Error("竞技场轮次无效");
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      const current = await this.readFile();
      const next = parseArenaRuns([...current.filter((entry) => entry.id !== parsed.id), parsed]);
      await this.writeFile(next);
    });
    this.writeChain = operation;
    await operation;
    return parsed;
  }

  private async enqueueWrite(runs: readonly ArenaRunRecord[]) {
    const operation = this.writeChain.catch(() => undefined).then(() => this.writeFile(runs));
    this.writeChain = operation;
    await operation;
  }

  private async readFile(): Promise<ArenaRunRecord[]> {
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, "utf8")) as unknown;
      if (!isRecord(value) || !Array.isArray(value.runs)) throw new Error("竞技场档案格式无效");
      return parseArenaRuns(value.runs);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      await this.quarantineCorruptFile();
      return [];
    }
  }

  private async quarantineCorruptFile() {
    const corruptPath = `${this.filePath}.corrupt-${Date.now()}-${process.pid}`;
    await fs.rename(this.filePath, corruptPath).catch((error) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
  }

  private async writeFile(runs: readonly ArenaRunRecord[]) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify({ schemaVersion: 1, runs }, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, this.filePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
