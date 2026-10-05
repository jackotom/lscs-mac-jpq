import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer entry split", () => {
  it("audit regression: keeps auxiliary overlays out of the desktop App chunk", () => {
    const entry = fs.readFileSync(path.resolve(import.meta.dirname, "../src/renderer/main.tsx"), "utf8");

    expect(entry).toContain('import("./AuxiliaryOverlayEntry")');
    expect(entry).toContain("isAuxiliaryOverlay");
    expect(entry).not.toContain('import "./overlayStyles.css"');
    expect(entry).not.toContain('import "./desktopReplicaStyles.css"');
  });
});
