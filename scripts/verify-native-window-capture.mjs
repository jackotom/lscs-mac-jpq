// Run with Hearthstone foreground; never captures an unverified window or display.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const helper = path.resolve(process.argv[2] ?? "native/bin/frontmost-app");
const context = JSON.parse(execFileSync(helper, ["--capture-context"], { encoding: "utf8", timeout: 3000 }));
assert.equal(context.applicationName, "Hearthstone");
const rejected = spawnSync(helper, ["--capture-window", String(context.windowId), "2147483647"], { timeout: 5000 });
assert.notEqual(rejected.status, 0, "wrong owner must fail closed");
assert.equal(rejected.stdout.length, 0, "wrong owner must not return pixels");
const captured = spawnSync(helper, ["--capture-window", String(context.windowId), String(context.ownerPid)], { timeout: 5000, maxBuffer: 64 * 1024 * 1024 });
assert.equal(captured.status, 0, `native capture failed: ${captured.signal ?? captured.stderr.toString()}`);
assert.equal(captured.stdout.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "must return PNG");
const width = captured.stdout.readUInt32BE(16);
const height = captured.stdout.readUInt32BE(20);
assert.ok(width >= 200 && height >= 200);
assert.ok(Math.abs(width / height - context.bounds.width / context.bounds.height) < 0.02, "capture must preserve window geometry");
console.log(JSON.stringify({ status: "passed", wrongOwnerRejected: true, width, height, bytes: captured.stdout.length }));
