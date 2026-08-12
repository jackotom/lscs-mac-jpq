import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const FILE_NAME = "app-run-state.json";

type AppRunPhase = "starting" | "startup-health" | "ready" | "monitoring" | "stopping" | "stopped";

interface StoredRunState {
  readonly schemaVersion: 1;
  readonly status: "running" | "clean";
  readonly version: string;
  readonly startedAt: string;
  readonly phase: AppRunPhase;
  readonly endedAt?: string;
}

export interface PreviousRunSummary {
  readonly wasUnclean: boolean;
  readonly version?: string;
  readonly startedAt?: string;
  readonly phase?: AppRunPhase;
}

export class AppRunState {
  private readonly filePath: string;
  private current: StoredRunState | undefined;
  private operations: Promise<void> = Promise.resolve();
  private clean = false;

  constructor(
    directory: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.filePath = path.join(directory, FILE_NAME);
  }

  begin(version: string): Promise<PreviousRunSummary> {
    let summary: PreviousRunSummary = { wasUnclean: false };
    return this.enqueue(async () => {
      const previous = await this.read().catch(() => undefined);
      const startedAt = this.now().toISOString();
      this.clean = false;
      this.current = {
        schemaVersion: 1,
        status: "running",
        version,
        startedAt,
        phase: "starting"
      };
      await this.write(this.current);
      summary = previous?.status === "running"
        ? {
            wasUnclean: true,
            version: previous.version,
            startedAt: previous.startedAt,
            phase: previous.phase
          }
        : { wasUnclean: false };
    }).then(() => summary);
  }

  markPhase(phase: Exclude<AppRunPhase, "stopped">): Promise<void> {
    return this.enqueue(async () => {
      if (!this.current || this.clean) return;
      this.current = { ...this.current, status: "running", phase };
      await this.write(this.current);
    });
  }

  markClean(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.current) return;
      this.clean = true;
      this.current = {
        ...this.current,
        status: "clean",
        phase: "stopped",
        endedAt: this.now().toISOString()
      };
      await this.write(this.current);
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.operations.then(operation);
    this.operations = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<StoredRunState | undefined> {
    const value = JSON.parse(await fs.readFile(this.filePath, "utf8")) as unknown;
    return parseStoredRunState(value);
  }

  private async write(value: StoredRunState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      const verified = parseStoredRunState(JSON.parse(await fs.readFile(temporaryPath, "utf8")) as unknown);
      if (!verified) {
        throw new Error("运行状态写入校验失败");
      }
      await fs.rename(temporaryPath, this.filePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function parseStoredRunState(value: unknown): StoredRunState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    (candidate.status !== "running" && candidate.status !== "clean") ||
    typeof candidate.version !== "string" ||
    typeof candidate.startedAt !== "string" ||
    !isAppRunPhase(candidate.phase) ||
    (candidate.endedAt !== undefined && typeof candidate.endedAt !== "string")
  ) {
    return undefined;
  }
  return candidate as unknown as StoredRunState;
}

function isAppRunPhase(value: unknown): value is AppRunPhase {
  return value === "starting" || value === "startup-health" || value === "ready" ||
    value === "monitoring" || value === "stopping" || value === "stopped";
}
