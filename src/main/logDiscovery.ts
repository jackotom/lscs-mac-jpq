import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { LogCandidate } from "../shared/types.js";
import { selectCurrentArenaLogText } from "../shared/arenaLogParser.js";

const DEFAULT_CANDIDATES = [
  path.join(os.homedir(), "Library/Logs/Blizzard Entertainment/Hearthstone"),
  "/Applications/Hearthstone/Logs",
  path.join(os.homedir(), "Library/Logs/Hearthstone"),
  path.join(os.homedir(), "Library/Logs/Blizzard/Hearthstone"),
  path.join(os.homedir(), "Library/Application Support/Blizzard/Hearthstone/Logs"),
  path.join(os.homedir(), "Library/Logs/Unity/Player.log")
];

export interface HearthstoneLogFiles {
  readonly root: string;
  readonly sessionDir: string;
  readonly powerLogPath?: string;
  readonly playerLogPath?: string;
  readonly decksLogPath?: string;
  readonly arenaLogPath?: string;
  readonly loadingScreenLogPath?: string;
  readonly modifiedAtMs: number;
}

export interface LogDiscoveryOptions {
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly extraCandidates?: readonly string[];
  readonly includeDefaultCandidates?: boolean;
}

export function getHearthstoneLogCandidates(options: LogDiscoveryOptions = {}): readonly string[] {
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const defaultCandidates =
    options.includeDefaultCandidates === false
      ? []
      : [
          path.join(homeDir, "Library", "Logs", "Blizzard Entertainment", "Hearthstone"),
          "/Applications/Hearthstone/Logs",
          path.join(homeDir, "Library", "Logs", "Hearthstone"),
          path.join(homeDir, "Library", "Logs", "Blizzard", "Hearthstone"),
          path.join(homeDir, "Library", "Application Support", "Blizzard", "Hearthstone", "Logs")
        ];
  const candidates = [
    ...(options.extraCandidates ?? []),
    env.HEARTHSTONE_LOG_DIR,
    ...defaultCandidates
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

export async function discoverHearthstoneLogs(
  options: LogDiscoveryOptions = {}
): Promise<HearthstoneLogFiles | undefined> {
  const sessions: HearthstoneLogFiles[] = [];

  for (const root of getHearthstoneLogCandidates(options)) {
    sessions.push(...(await discoverSessionsInRoot(root)));
  }

  return sessions.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)[0];
}

export async function resolveBestLogTarget(providedPath?: string): Promise<HearthstoneLogFiles | undefined> {
  const sessions = providedPath ? await discoverSessionsFromPath(providedPath) : await discoverSessionsFromDefaultRoots();
  return selectBestLogTarget(sessions);
}

export async function discoverLogCandidates(): Promise<LogCandidate[]> {
  const candidates: LogCandidate[] = [];
  for (const candidatePath of DEFAULT_CANDIDATES) {
    const stat = await statIfExists(candidatePath);
    candidates.push({
      path: candidatePath,
      label: labelForPath(candidatePath),
      exists: Boolean(stat),
      modifiedAt: stat?.mtime.toISOString()
    });
  }
  return candidates;
}

export async function findBestLogFile(providedPath?: string): Promise<string | undefined> {
  const target = await resolveBestLogTarget(providedPath);
  return target?.powerLogPath ?? target?.playerLogPath;
}

export async function findBestDecksLogFile(providedPath?: string): Promise<string | undefined> {
  const sessions = providedPath ? await discoverSessionsFromPath(providedPath) : await discoverSessionsFromDefaultRoots();
  return sessions
    .filter((session) => session.decksLogPath)
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)[0]?.decksLogPath;
}

async function statIfExists(targetPath: string) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return undefined;
  }
}

function isSupportedLog(targetPath: string) {
  const base = path.basename(targetPath).toLowerCase();
  return base === "power.log" || base === "player.log" || base === "decks.log" || base === "arena.log" || base === "loadingscreen.log";
}

function labelForPath(targetPath: string) {
  if (targetPath.includes("Library/Logs/Blizzard Entertainment")) {
    return "Blizzard Entertainment 用户日志";
  }
  if (targetPath.includes("/Applications/Hearthstone")) {
    return "炉石安装目录日志";
  }
  if (targetPath.includes("Library/Logs/Blizzard")) {
    return "Blizzard 用户日志";
  }
  if (targetPath.includes("Unity/Player.log")) {
    return "Unity Player.log";
  }
  return "自定义日志";
}

async function discoverSessionsInRoot(root: string): Promise<readonly HearthstoneLogFiles[]> {
  const rootStat = await statIfExists(root);
  if (!rootStat?.isDirectory()) {
    return [];
  }

  const sessions: HearthstoneLogFiles[] = [];
  const rootSession = await readSession(root, root);
  if (rootSession) {
    sessions.push(rootSession);
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const session = await readSession(root, path.join(root, entry.name));
    if (session) {
      sessions.push(session);
    }
  }

  return sessions;
}

async function discoverSessionsFromDefaultRoots(): Promise<HearthstoneLogFiles[]> {
  const sessions: HearthstoneLogFiles[] = [];
  for (const root of getHearthstoneLogCandidates()) {
    sessions.push(...(await discoverSessionsInRoot(root)));
  }
  return sessions;
}

async function discoverSessionsFromPath(targetPath: string): Promise<HearthstoneLogFiles[]> {
  const stat = await statIfExists(targetPath);
  if (!stat) {
    return [];
  }

  if (stat.isFile()) {
    if (!isSupportedLog(targetPath)) {
      return [];
    }

    const session = await readSession(path.dirname(targetPath), path.dirname(targetPath));
    return session ? [session] : [];
  }

  return stat.isDirectory() ? [...(await discoverSessionsInRoot(targetPath))] : [];
}

function scoreSession(session: HearthstoneLogFiles): number {
  return (session.powerLogPath ? 100 : 0) + (session.playerLogPath ? 10 : 0);
}

async function selectBestLogTarget(sessions: readonly HearthstoneLogFiles[]): Promise<HearthstoneLogFiles | undefined> {
  const bestScoredSession = [...sessions].sort((left, right) => scoreSession(right) - scoreSession(left) || right.modifiedAtMs - left.modifiedAtMs)[0];
  if (!bestScoredSession) {
    return undefined;
  }

  const newestSessions = [...sessions].sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);
  const newerPowerlessSessions = newestSessions.filter(
    (session) =>
      session.modifiedAtMs > bestScoredSession.modifiedAtMs &&
      !session.powerLogPath &&
      !isRootLevelPlayerOnlySession(session)
  );

  for (const session of newerPowerlessSessions) {
    if (!session.arenaLogPath) {
      continue;
    }
    if (await isUsableArenaSession(session)) {
      return session;
    }
  }

  if (newerPowerlessSessions[0]) {
    return newerPowerlessSessions[0];
  }

  const newestRootPlayerSession = newestSessions.find(isRootLevelPlayerOnlySession);
  if (bestScoredSession.powerLogPath && !bestScoredSession.playerLogPath && newestRootPlayerSession?.playerLogPath) {
    return {
      ...bestScoredSession,
      playerLogPath: newestRootPlayerSession.playerLogPath,
      modifiedAtMs: Math.max(bestScoredSession.modifiedAtMs, newestRootPlayerSession.modifiedAtMs)
    };
  }

  return bestScoredSession;
}

export function isRootLevelPlayerOnlySession(session: HearthstoneLogFiles): boolean {
  return Boolean(
    path.resolve(session.sessionDir) === path.resolve(session.root) &&
    session.playerLogPath &&
    !session.powerLogPath &&
    !session.decksLogPath &&
    !session.arenaLogPath &&
    !session.loadingScreenLogPath
  );
}

async function isUsableArenaSession(session: HearthstoneLogFiles): Promise<boolean> {
  if (!session.arenaLogPath) {
    return false;
  }

  const arenaText = await fs.readFile(session.arenaLogPath, "utf8").catch(() => "");
  return /(?:Arena\.)?SetDraftMode\s*-\s*(?:DRAFTING|ACTIVE_DRAFT_DECK|REDRAFTING|IN_REWARDS)\b/i.test(selectCurrentArenaLogText(arenaText));
}

async function readSession(root: string, sessionDir: string): Promise<HearthstoneLogFiles | undefined> {
  const powerLogPath = path.join(sessionDir, "Power.log");
  const playerLogPath = path.join(sessionDir, "Player.log");
  const decksLogPath = path.join(sessionDir, "Decks.log");
  const arenaLogPath = path.join(sessionDir, "Arena.log");
  const loadingScreenLogPath = path.join(sessionDir, "LoadingScreen.log");
  const [powerStat, playerStat, decksStat, arenaStat, loadingScreenStat, sessionStat] = await Promise.all([
    statIfExists(powerLogPath),
    statIfExists(playerLogPath),
    statIfExists(decksLogPath),
    statIfExists(arenaLogPath),
    statIfExists(loadingScreenLogPath),
    statIfExists(sessionDir)
  ]);

  if (!powerStat?.isFile() && !playerStat?.isFile() && !decksStat?.isFile() && !arenaStat?.isFile() && !loadingScreenStat?.isFile()) {
    return undefined;
  }

  return {
    root,
    sessionDir,
    powerLogPath: powerStat?.isFile() ? powerLogPath : undefined,
    playerLogPath: playerStat?.isFile() ? playerLogPath : undefined,
    decksLogPath: decksStat?.isFile() ? decksLogPath : undefined,
    arenaLogPath: arenaStat?.isFile() ? arenaLogPath : undefined,
    loadingScreenLogPath: loadingScreenStat?.isFile() ? loadingScreenLogPath : undefined,
    modifiedAtMs: Math.max(
      powerStat?.mtimeMs ?? 0,
      playerStat?.mtimeMs ?? 0,
      decksStat?.mtimeMs ?? 0,
      arenaStat?.mtimeMs ?? 0,
      loadingScreenStat?.mtimeMs ?? 0,
      sessionStat?.mtimeMs ?? 0
    )
  };
}
