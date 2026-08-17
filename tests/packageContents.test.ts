import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("minimal macOS package", () => {
  it("packages from an explicit runtime-only allowlist", () => {
    const script = fs.readFileSync(path.join(root, "scripts/package-mac-arm64.sh"), "utf8");

    expect(script).toContain("runtime_root_pattern");
    expect(script).toContain("dist|dist-electron|node_modules");
    expect(script).toContain("package\\.json");
    expect(script).toContain('"$root_dir/LICENSE"');
    expect(script).toContain('"$root_dir/THIRD_PARTY_NOTICES"');
    expect(script).toContain("grep -Fxq '/LICENSE'");
    expect(script).toContain("grep -Fxq '/THIRD_PARTY_NOTICES'");
    expect(script).toContain('assert_minimal_package "$publish_app"');
  });

  it("rejects source, tests, docs, fixtures, screenshots, and development dependencies", () => {
    const script = fs.readFileSync(path.join(root, "scripts/package-mac-arm64.sh"), "utf8");

    for (const forbidden of ["/src/", "/tests/", "/docs/", "/fixtures/", "/screenshots/", "/.superpowers/"]) {
      expect(script).toContain(forbidden);
    }
    expect(script).toContain("npm audit --omit=dev");
    expect(script).toContain("package_entry_count");
  });

  it("builds node_modules from production dependencies only", () => {
    const script = fs.readFileSync(path.join(root, "scripts/package-mac-arm64.sh"), "utf8");

    expect(script).toContain('npm ci --omit=dev --ignore-scripts');
    expect(script).toContain('rm -rf "$runtime_source/node_modules/.vite"');
    expect(script).toContain("/node_modules/.vite/");
  });
});
