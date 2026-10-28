import { promises as fs } from "node:fs";
import path from "node:path";
import { getJsonCacheBackupPath, writeValidatedJsonCache } from "./atomicJsonCache.js";

export interface SecurityScopedResourceHost {
  startAccessingSecurityScopedResource(bookmarkData: string): () => void;
}

interface StoredSelection {
  readonly path: string;
  readonly bookmark: string;
}

export interface MasLogAccessStoreOptions {
  readonly filePath: string;
  readonly host: SecurityScopedResourceHost;
  readonly isMas: boolean;
  readonly environment?: NodeJS.ProcessEnv;
  readonly persistSelection?: (filePath: string, selection: { readonly path: string; readonly bookmark: string }) => Promise<void>;
}

/** Keeps the user-selected Hearthstone log folder accessible across MAS launches. */
export class MasLogAccessStore {
  private stopAccessing: (() => void) | undefined;
  private operation = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: MasLogAccessStoreOptions) {}

  async restore(): Promise<string | undefined> {
    return this.enqueue(async () => {
      if (!this.options.isMas || this.disposed) return undefined;
      const selection = await readSelection(this.options.filePath);
      if (!selection || this.disposed) return undefined;
      const nextStopAccessing = this.options.host.startAccessingSecurityScopedResource(selection.bookmark);
      if (this.disposed) {
        nextStopAccessing();
        return undefined;
      }
      const previousStopAccessing = this.stopAccessing;
      this.stopAccessing = nextStopAccessing;
      this.setEnvironment(selection.path);
      previousStopAccessing?.();
      return selection.path;
    });
  }

  async save(selection: { readonly path: string; readonly bookmark: string }): Promise<void> {
    await this.enqueue(async () => {
      if (!this.options.isMas || this.disposed) return;
      const nextStopAccessing = this.options.host.startAccessingSecurityScopedResource(selection.bookmark);
      try {
        await (this.options.persistSelection ?? writeSelection)(this.options.filePath, selection);
      } catch (error) {
        nextStopAccessing();
        throw error;
      }
      if (this.disposed) {
        nextStopAccessing();
        return;
      }
      const previousStopAccessing = this.stopAccessing;
      this.stopAccessing = nextStopAccessing;
      this.setEnvironment(selection.path);
      previousStopAccessing?.();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stopAccessing?.();
    this.stopAccessing = undefined;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.catch(() => undefined).then(operation);
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }

  private setEnvironment(logPath: string): void {
    if (this.options.environment) this.options.environment.HEARTHSTONE_LOG_DIR = logPath;
  }
}

async function readSelection(filePath: string): Promise<StoredSelection | undefined> {
  const selection = await readSelectionFile(filePath);
  return selection ?? readSelectionFile(getJsonCacheBackupPath(filePath));
}

async function readSelectionFile(filePath: string): Promise<StoredSelection | undefined> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return parseSelection(JSON.parse(content));
  } catch {
    return undefined;
  }
}

async function writeSelection(filePath: string, selection: StoredSelection): Promise<void> {
  await writeValidatedJsonCache(filePath, selection, parseSelection);
}

function parseSelection(value: unknown): StoredSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const selection = value as Partial<StoredSelection>;
  if (typeof selection.path !== "string" || !selection.path.trim() || typeof selection.bookmark !== "string" || !selection.bookmark.trim()) {
    return undefined;
  }
  return { path: selection.path, bookmark: selection.bookmark };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
