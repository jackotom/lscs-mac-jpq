import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const fixture = process.argv.includes("--fixture");
const appPath = process.env.MAS_APP_PATH;
const pkgPath = process.env.MAS_PKG_PATH;
const manifestPath = process.env.MAS_RELEASE_MANIFEST_PATH ?? path.join(process.cwd(), "outputs", "mas-release-manifest.json");
const appName = "炉石记牌器";
const runId = `${Date.now()}-${process.pid}`;
let failedStep = "initialization";
let manifest;

try {
if (!appPath) throw new Error("缺少 MAS_APP_PATH");
const contentsPath = path.join(appPath, "Contents");
const infoPath = path.join(contentsPath, "Info.plist");
const executablePath = path.join(contentsPath, "MacOS", appName);
const asarPath = path.join(contentsPath, "Resources", "app.asar");
const helperPaths = ["arena-ocr", "frontmost-app"].map((name) => path.join(contentsPath, "MacOS", name));
const info = await readPlist(infoPath, fixture);
const version = plistValue(info, "CFBundleShortVersionString");
const build = plistValue(info, "CFBundleVersion");
const bundleId = plistValue(info, "CFBundleIdentifier");
if (!version || !build || !bundleId) throw new Error("MAS Info.plist 缺少版本号或 bundle identifier");
failedStep = "artifact-layout";
await Promise.all([access(executablePath), access(asarPath), ...helperPaths.map((filePath) => access(filePath))]);

const artifactHashes = await hashes({
  infoPlistSha256: infoPath,
  appAsarSha256: asarPath,
  executableSha256: executablePath,
  arenaOcrSha256: helperPaths[0],
  frontmostAppSha256: helperPaths[1],
  ...(pkgPath ? { pkgSha256: pkgPath } : {})
});
artifactHashes.appArtifactDigest = sha256(
  Object.entries(artifactHashes).filter(([name]) => name !== "pkgSha256").sort().map(([name, hash]) => `${name}:${hash}`).join("\n")
);

manifest = {
  status: "running",
  runId,
  generatedAt: new Date().toISOString(),
  commit: await gitCommit(),
  worktreeDirty: await gitDirty(),
  sourceContentSha256: await sourceContentSha256(),
  version,
  build,
  bundleId,
  appPath: path.basename(appPath),
  artifactHashes,
  verificationMode: fixture ? "fixture" : process.env.MAS_ADHOC_QA === "1" ? "ad-hoc-sandbox" : "distribution-static",
  distributionSigningVerified: false,
  sandboxEntitlementVerified: false,
  profileVerified: false,
  asarAllowlistVerified: false,
  pkgContainsAppPayload: false,
  runtimeVerified: false,
  manualLogGrantVerified: false,
  requiresManualLogGrant: false,
  clearanceStatus: "blocked-pending-external-authorizations"
};

if (!fixture) {
  failedStep = "sandbox-entitlements";
  const entitlements = await command("codesign", ["-d", "--entitlements", ":-", appPath]);
  if (!plistBoolean(entitlements, "com.apple.security.app-sandbox")) throw new Error("MAS 包没有启用 App Sandbox entitlement");
  if (!plistBoolean(entitlements, "com.apple.security.files.user-selected.read-write")) throw new Error("MAS 包缺少用户选择目录访问 entitlement");
  manifest.sandboxEntitlementVerified = true;
  await command("codesign", ["--verify", "--deep", "--strict", appPath]);
  const signatureDetails = await command("codesign", ["-dv", "--verbose=4", appPath]);
  const signingTeam = /^TeamIdentifier=(.+)$/m.exec(signatureDetails)?.[1];
  manifest.distributionSigningVerified = signatureDetails.includes("Authority=Apple Distribution:");
  if (process.env.MAS_ADHOC_QA !== "1" && !manifest.distributionSigningVerified) {
    throw new Error("MAS distribution 包未使用 Apple Distribution 签名");
  }
  failedStep = "profile-binding";
  const profile = await command("security", ["cms", "-D", "-i", path.join(contentsPath, "embedded.provisionprofile")]);
  const profileApplicationId = applicationIdentifier(profile);
  const entitlementApplicationId = applicationIdentifier(entitlements);
  const profileTeam = teamPrefix(profileApplicationId);
  const entitlementTeam = teamPrefix(entitlementApplicationId);
  const profileMatches = plistArrayValues(profile, "Platform").includes("OSX") && profileApplicationIdMatches(profileApplicationId, bundleId) && profileApplicationIdMatches(entitlementApplicationId, bundleId) && profileTeam === entitlementTeam;
  if (!profileMatches || (process.env.MAS_ADHOC_QA !== "1" && signingTeam !== profileTeam)) {
    throw new Error("MAS profile、bundle identifier 与 entitlement 不匹配");
  }
  manifest.profileVerified = process.env.MAS_ADHOC_QA !== "1" && signingTeam === profileTeam;
  if (process.env.MAS_ADHOC_QA === "1" && !signingTeam) manifest.profileVerified = false;
  failedStep = "asar-allowlist";
  await verifyAsarAllowlist(asarPath);
  manifest.asarAllowlistVerified = true;
  if (pkgPath) {
    failedStep = "pkg-binding";
    await command("pkgutil", ["--check-signature", pkgPath]);
    const payload = await command("pkgutil", ["--payload-files", pkgPath]);
    manifest.pkgContainsAppPayload = payload.includes(`${appName}.app/Contents/MacOS/${appName}`);
    if (!manifest.pkgContainsAppPayload) throw new Error("MAS pkg 不包含目标 app payload");
  }
  if (process.env.MAS_ADHOC_QA === "1") {
    failedStep = "sandbox-qa";
    const qa = await runIsolatedQa(executablePath, bundleId);
    manifest.runtimeVerified = qa.runtimeVerified;
    manifest.requiresManualLogGrant = qa.requiresManualLogGrant;
    manifest.manualLogGrantVerified = false;
  }
}

manifest.status = "passed";
await writeManifest(manifest);
} catch (error) {
  await writeManifest({
    status: "failed",
    runId,
    generatedAt: new Date().toISOString(),
    failedStep,
    errorCode: "MAS_VERIFICATION_FAILED"
  });
  throw error;
}

async function readPlist(filePath, allowXmlFixture) {
  const bytes = await readFile(filePath);
  const text = bytes.toString("utf8");
  if (allowXmlFixture || text.includes("<plist")) return text;
  return command("plutil", ["-convert", "xml1", "-o", "-", filePath]);
}

function plistValue(plist, key) {
  return new RegExp(`<key>${escapeRegex(key)}</key>\\s*<string>([^<]+)</string>`).exec(plist)?.[1];
}

function plistBoolean(plist, key) {
  return new RegExp(`<key>${escapeRegex(key)}</key>\\s*<true\\s*/>`).test(plist);
}

function applicationIdentifier(plist) {
  return plistValue(plist, "application-identifier") ?? plistValue(plist, "com.apple.application-identifier");
}

function profileApplicationIdMatches(applicationId, bundleId) {
  const separator = applicationId?.indexOf(".") ?? -1;
  return Boolean(applicationId && separator > 0 && applicationId.slice(separator + 1) === bundleId);
}

function teamPrefix(applicationId) {
  return applicationId?.split(".", 1)[0];
}

function plistArrayValues(plist, key) {
  const array = new RegExp(`<key>${escapeRegex(key)}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(plist)?.[1];
  return array ? [...array.matchAll(/<string>([^<]+)<\/string>/g)].map((match) => match[1]) : [];
}

async function verifyAsarAllowlist(filePath) {
  const asar = path.join(process.cwd(), "node_modules", ".bin", "asar");
  const listing = await command(asar, ["list", filePath]);
  const allowed = /^(\/)?(dist|dist-electron|node_modules)(\/|$)|^\/?(package\.json|LICENSE|THIRD_PARTY_NOTICES)$/;
  for (const entry of listing.split("\n").filter(Boolean)) {
    if (!allowed.test(entry)) throw new Error(`MAS app.asar 混入非运行文件：${entry}`);
  }
}

async function runIsolatedQa(executable, bundleId) {
  const container = process.env.MAS_QA_CONTAINER_DIR;
  if (!container || !path.resolve(container).includes(path.join("Library", "Containers", bundleId))) {
    return { runtimeVerified: false, requiresManualLogGrant: true };
  }
  try {
    await access(path.join(container, "Data", "Library", "Caches"));
  } catch {
    return { runtimeVerified: false, requiresManualLogGrant: true };
  }
  const root = await mkdtemp(path.join(container, "Data", "Library", "Caches", "HearthstoneTrackerQA-"));
  const userData = path.join(root, "user-data");
  const inspection = path.join(root, "inspection.json");
  const screenshot = path.join(root, "main.png");
  const fixtureLog = path.join(root, "fixture", "Power.log");
  await mkdir(path.dirname(fixtureLog), { recursive: true });
  await copyFile(path.join(process.cwd(), "fixtures", "logs", "session-2026-07-10", "Power.log"), fixtureLog);
  await copyFile(path.join(process.cwd(), "fixtures", "logs", "session-2026-07-10", "Player.log"), path.join(path.dirname(fixtureLog), "Player.log"));
  await mkdir(userData, { recursive: true });
  const fixtureCards = JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "cards.sample.json"), "utf8"));
  await writeFile(path.join(userData, "hearthstone-cards.zhCN.blizzard.json"), JSON.stringify({
    schemaVersion: 1, version: "qa-fixture", fetchedAt: new Date().toISOString(), cards: fixtureCards
  }));
  const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(QA_|NODE_|VITE_)/.test(key) && key !== "ELECTRON_RUN_AS_NODE"));
  const child = spawn(executable, [], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...cleanEnvironment,
      HEARTHSTONE_LOG_DIR: path.dirname(fixtureLog),
      QA_LOG_PATH: fixtureLog,
      QA_LOCK_LOG_PATH: "1",
      QA_ALLOW_MULTIPLE_INSTANCES: "1",
      QA_USER_DATA_DIR: userData,
      QA_SKIP_LOG_CONFIG_REPAIR: "1",
      QA_SKIP_ARENA_SCREEN_RECOGNITION: "1",
      QA_EXIT_AFTER_SCREENSHOT: "1",
      QA_SCREENSHOT_PATH: screenshot,
      QA_INSPECT_PATH: inspection
    }
  });
  let spawnError;
  child.once("error", (error) => { spawnError = error; });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const report = JSON.parse(await readFile(inspection, "utf8"));
        const replayedCardState = report.trackerState?.gameActive === true &&
          report.trackerState?.cardTracking?.friendly?.current?.hand?.knownCount === 2 &&
          report.trackerState?.summary?.opponentPlayedCount === 1;
        if (report.rendererReady === true && report.hasApi && replayedCardState && report.trackerState?.logPath === fixtureLog && report.consoleErrorCount === 0) {
          await access(screenshot);
          return { runtimeVerified: true, requiresManualLogGrant: true };
        }
      } catch {}
      if (spawnError) return { runtimeVerified: false, requiresManualLogGrant: true };
      await delay(100);
    }
    return { runtimeVerified: false, requiresManualLogGrant: true };
  } finally {
    await stopProcessGroup(child.pid, exited);
    await rm(root, { recursive: true, force: true });
  }
}

async function writeManifest(value) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.${runId}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, manifestPath);
}

async function hashes(files) {
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, filePath]) => [name, sha256(await readFile(filePath))])));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function gitCommit() {
  try { return (await command("git", ["rev-parse", "HEAD"])).trim(); } catch { return "unavailable"; }
}

async function gitDirty() {
  try { return Boolean((await command("git", ["status", "--porcelain"])).trim()); } catch { return true; }
}

async function sourceContentSha256() {
  const listing = await command("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "src", "native", "scripts", "package.json", "package-lock.json"]);
  const files = listing.split("\0").filter((file) => file && (
    file.startsWith("src/") || file.startsWith("native/") || file === "package.json" || file === "package-lock.json" ||
    /^scripts\/(?:package|sign-mas|verify-mas)/.test(file)
  )).sort();
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file).update("\0").update(await readFile(path.join(process.cwd(), file)));
  }
  return digest.digest("hex");
}

async function command(file, args) {
  const { stdout, stderr } = await execFileAsync(file, args);
  return `${stdout}${stderr}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopProcessGroup(pid, exited) {
  if (!pid) return;
  try { process.kill(-pid, "SIGTERM"); } catch {}
  if (await Promise.race([exited.then(() => true), delay(2_000).then(() => false)])) return;
  try { process.kill(-pid, "SIGKILL"); } catch {}
  await Promise.race([exited, delay(2_000)]);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
