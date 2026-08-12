import path from "node:path";
import type { HearthstoneLogFiles } from "./logDiscovery.js";

declare const sessionKeyBrand: unique symbol;

export interface SessionKey {
  readonly id: number;
  readonly [sessionKeyBrand]: true;
}

export interface SessionContext {
  readonly key: SessionKey;
  readonly root?: string;
  readonly sessionDir?: string;
  readonly activeLogPath?: string;
  readonly powerLogPath?: string;
  readonly arenaLogPath?: string;
  readonly decksLogPath?: string;
  readonly playerLogPath?: string;
  readonly loadingScreenLogPath?: string;
}

export function createSessionKey(id: number): SessionKey {
  return Object.freeze({ id }) as SessionKey;
}

export function createSessionContext(key: SessionKey): SessionContext {
  return Object.freeze({ key });
}

export function bindSessionContext(
  context: SessionContext,
  logs: HearthstoneLogFiles,
  options: {
    readonly activeLogPath: string;
    readonly arenaLogPath?: string;
    readonly decksLogPath?: string;
    readonly playerLogPath?: string;
  }
): SessionContext {
  return Object.freeze({
    key: context.key,
    root: normalizePath(logs.root),
    sessionDir: normalizePath(logs.sessionDir),
    activeLogPath: normalizePath(options.activeLogPath),
    powerLogPath: normalizeOptionalPath(logs.powerLogPath),
    arenaLogPath: normalizeOptionalPath(options.arenaLogPath),
    decksLogPath: normalizeOptionalPath(options.decksLogPath),
    playerLogPath: normalizeOptionalPath(options.playerLogPath),
    loadingScreenLogPath: normalizeOptionalPath(logs.loadingScreenLogPath)
  });
}

export function hasSessionKey(context: SessionContext, key: SessionKey): boolean {
  return context.key === key;
}

export function sessionOwnsLogPath(
  context: SessionContext,
  candidatePath: string,
  kind?: "power" | "arena" | "decks" | "player" | "loading-screen"
): boolean {
  const normalizedCandidate = normalizePath(candidatePath);
  if (kind) {
    return normalizedCandidate === context[sessionPathProperty[kind]];
  }
  return sessionLogPaths(context).includes(normalizedCandidate);
}

const sessionPathProperty = {
  power: "powerLogPath",
  arena: "arenaLogPath",
  decks: "decksLogPath",
  player: "playerLogPath",
  "loading-screen": "loadingScreenLogPath"
} as const;

function sessionLogPaths(context: SessionContext): readonly (string | undefined)[] {
  return [
    context.powerLogPath,
    context.arenaLogPath,
    context.decksLogPath,
    context.playerLogPath,
    context.loadingScreenLogPath
  ];
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
  return value ? normalizePath(value) : undefined;
}

function normalizePath(value: string): string {
  return path.resolve(value);
}
