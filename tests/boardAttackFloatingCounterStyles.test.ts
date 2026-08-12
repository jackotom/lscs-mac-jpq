import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const styles = fs.readFileSync(path.join(projectRoot, "src/renderer/boardAttackOverlayStyles.css"), "utf8");

describe("board attack floating counter styles", () => {
  it("matches the reference's tiny sword counter beside each hero", () => {
    expect(styles).toMatch(
      /\.single-attack-overlay\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?background:\s*transparent;[\s\S]*?pointer-events:\s*none;/
    );
    expect(styles).toMatch(
      /\.single-attack-counter\s*\{[\s\S]*?width:\s*42px;[\s\S]*?height:\s*42px;[\s\S]*?place-items:\s*center;[\s\S]*?border-radius:\s*50%;[\s\S]*?background:\s*rgba\(15,\s*28,\s*73,\s*0\.96\)/
    );
    expect(styles).toMatch(
      /\.single-attack-counter \.board-attack-counter-icon\s*\{[\s\S]*?top:\s*5px;/
    );
    expect(styles).toMatch(
      /\.single-attack-counter \.board-attack-counter-icon svg\s*\{[\s\S]*?width:\s*16px;[\s\S]*?height:\s*16px;/
    );
    expect(styles).toMatch(
      /\.single-attack-counter \.board-attack-counter-value\s*\{[\s\S]*?font-size:\s*17px;/
    );
  });

  it("does not recreate a large panel around the counters", () => {
    const canvasRule = styles.match(/\.single-attack-overlay\s*\{[^}]*\}/)?.[0] ?? "";
    const iconRule = styles.match(/\.single-attack-counter\s*\{[^}]*\}/)?.[0] ?? "";

    expect(canvasRule).not.toMatch(/(?:border|box-shadow):/);
    expect(iconRule).not.toMatch(/width:\s*(?:4[5-9]|[5-9]\d|\d{3,})px/);
    expect(iconRule).not.toMatch(/height:\s*(?:4[5-9]|[5-9]\d|\d{3,})px/);
  });
});
