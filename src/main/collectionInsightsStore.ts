import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCollectionSnapshot, type CollectionSnapshot } from "../shared/collectionInsights.js";

const FILE_NAME = "collection-insights.json";

export class CollectionInsightsStore {
  private writeChain = Promise.resolve();
  constructor(private readonly filePath = path.join(app.getPath("userData"), FILE_NAME)) {}
  getPath() { return this.filePath; }

  async read(): Promise<CollectionSnapshot | undefined> {
    await this.writeChain.catch(() => undefined);
    try {
      return parseCollectionSnapshot(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      await this.quarantineCorruptFile();
      return undefined;
    }
  }

  async replace(value: unknown): Promise<CollectionSnapshot> {
    const snapshot = parseCollectionSnapshot(value);
    const operation = this.writeChain.catch(() => undefined).then(() => this.write(snapshot));
    this.writeChain = operation;
    await operation;
    return snapshot;
  }

  private async quarantineCorruptFile() {
    await fs.rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}-${process.pid}`).catch((error) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
  }

  private async write(snapshot: CollectionSnapshot) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, this.filePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
