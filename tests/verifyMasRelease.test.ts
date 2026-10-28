import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const root = path.resolve(import.meta.dirname, "..");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("MAS release verifier", () => {
  it("audit regression: replaces an old success manifest with a redacted failure record when a required helper is missing", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mas-release-failure-"));
    temporaryDirectories.push(directory);
    const app = path.join(directory, "炉石记牌器.app");
    const contents = path.join(app, "Contents");
    await mkdir(path.join(contents, "MacOS"), { recursive: true });
    await mkdir(path.join(contents, "Resources"), { recursive: true });
    await writeFile(path.join(contents, "Info.plist"), '<?xml version="1.0"?><plist><dict><key>CFBundleShortVersionString</key><string>0.7.5</string><key>CFBundleVersion</key><string>7</string><key>CFBundleIdentifier</key><string>cc.acyg.hearthstonemactracker</string></dict></plist>');
    await writeFile(path.join(contents, "MacOS", "炉石记牌器"), "fixture");
    await writeFile(path.join(contents, "MacOS", "arena-ocr"), "fixture");
    await writeFile(path.join(contents, "Resources", "app.asar"), "fixture");
    const manifest = path.join(directory, "manifest.json");
    await writeFile(manifest, JSON.stringify({ status: "passed", runId: "stale-success" }));

    await expect(execFileAsync(process.execPath, ["scripts/verify-mas-release.mjs", "--fixture"], {
      cwd: root,
      env: { ...process.env, MAS_APP_PATH: app, MAS_RELEASE_MANIFEST_PATH: manifest }
    })).rejects.toThrow();

    expect(JSON.parse(await readFile(manifest, "utf8"))).toMatchObject({
      status: "failed",
      failedStep: "artifact-layout",
      errorCode: "MAS_VERIFICATION_FAILED"
    });
  });

  it("audit regression: writes a redacted manifest for a fixture package without claiming distribution signing", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mas-release-audit-"));
    temporaryDirectories.push(directory);
    const app = path.join(directory, "炉石记牌器.app");
    const contents = path.join(app, "Contents");
    await mkdir(path.join(contents, "MacOS"), { recursive: true });
    await mkdir(path.join(contents, "Resources"), { recursive: true });
    await writeFile(
      path.join(contents, "Info.plist"),
      '<?xml version="1.0"?><plist><dict><key>CFBundleShortVersionString</key><string>0.7.5</string><key>CFBundleVersion</key><string>7</string><key>CFBundleIdentifier</key><string>cc.acyg.hearthstonemactracker</string></dict></plist>'
    );
    await writeFile(path.join(contents, "MacOS", "炉石记牌器"), "fixture");
    await writeFile(path.join(contents, "MacOS", "arena-ocr"), "fixture");
    await writeFile(path.join(contents, "MacOS", "frontmost-app"), "fixture");
    await writeFile(path.join(contents, "Resources", "app.asar"), "fixture");

    const manifest = path.join(directory, "manifest.json");
    await execFileAsync(process.execPath, ["scripts/verify-mas-release.mjs", "--fixture"], {
      cwd: root,
      env: { ...process.env, MAS_APP_PATH: app, MAS_RELEASE_MANIFEST_PATH: manifest }
    });

    expect(JSON.parse(await readFile(manifest, "utf8"))).toMatchObject({
      version: "0.7.5",
      build: "7",
      verificationMode: "fixture",
      distributionSigningVerified: false,
      runtimeVerified: false,
      clearanceStatus: "blocked-pending-external-authorizations",
      artifactHashes: expect.objectContaining({
        appArtifactDigest: expect.any(String),
        appAsarSha256: expect.any(String),
        executableSha256: expect.any(String)
      }),
      sourceContentSha256: expect.any(String)
    });
  });
});
