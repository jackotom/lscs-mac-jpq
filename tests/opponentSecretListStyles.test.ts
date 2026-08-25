import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(process.cwd(), "src/renderer/opponentOverlayStyles.css"), "utf8");

describe("opponent secret list styles", () => {
  it("keeps status rows fixed while only the card area grows with window height", () => {
    expect(styles).toMatch(
      /\.opponent-overlay-shell:has\(\.card-tracking-layout\)\s*\{[^}]*?display:\s*flex;[^}]*?flex-direction:\s*column;/
    );
    expect(styles).toMatch(
      /\.opponent-overlay-shell:has\(\.card-tracking-layout\)\s*>\s*\.card-tracking-layout\s*\{[^}]*?flex:\s*1 1 auto;[^}]*?min-height:\s*0;/
    );
    expect(styles).toMatch(
      /\.opponent-turn-timer\s*\{[^}]*?flex:\s*0 0 auto;/
    );
    expect(styles).toMatch(
      /\.opponent-overlay-shell:has\(\.card-tracking-layout\)\s*>\s*\.overlay-public-counters\s*\{[^}]*?height:\s*30px;[^}]*?flex:\s*0 0 30px;/
    );
    expect(styles).toMatch(
      /\.opponent-overlay-shell:has\(\.card-tracking-layout\)\s*>\s*\.overlay-card-group\s*\{[^}]*?max-height:\s*96px;[^}]*?flex:\s*0 1 auto;[^}]*?overflow-y:\s*auto;/
    );
    expect(styles).toMatch(
      /\.opponent-overlay-shell:has\(\.card-tracking-layout\)\s*>\s*\.overlay-header\s*\{[^}]*?height:\s*24px;/
    );
    expect(styles).toMatch(
      /\.match-pulse-actor\s*\{[^}]*?height:\s*18px;[^}]*?flex:\s*0 0 auto;/
    );
    expect(styles).toMatch(
      /\.opponent-tracking-summary\s*\{[^}]*?height:\s*26px;[^}]*?flex:\s*0 0 auto;/
    );
    expect(styles).not.toMatch(/\.opponent-overlay-shell:has\(\.card-tracking-layout\)[^{]*\{[^}]*grid-template-rows:/);
  });

  it("keeps the collapsible confirmed-hand group in the main scroll area", () => {
    expect(styles).not.toMatch(
      /\.opponent-overlay-shell \.card-tracking-layout:has\(> \.opponent-hand-timeline\)/
    );
    expect(styles).toMatch(
      /\.opponent-hand-list\s*\{[^}]*?align-content:\s*start;/
    );
    expect(styles).not.toMatch(/\.opponent-hand-list\s*\{[^}]*?overflow:\s*auto;/);
  });

  it("keeps every secret slot as a compact readable row", () => {
    expect(styles).toMatch(
      /\.opponent-secret-section\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?align-content:\s*start;[\s\S]*?overflow:\s*visible;/
    );
    expect(styles).toMatch(
      /\.opponent-secret-slot\s*\{[\s\S]*?grid-template-columns:\s*36px minmax\(0,\s*1fr\);[\s\S]*?align-items:\s*start;[\s\S]*?padding:\s*3px 4px;/
    );
    expect(styles).toMatch(
      /\.opponent-secret-slot-label\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/
    );
  });

  it("wraps candidates inside the slot while keeping status text visible", () => {
    expect(styles).toMatch(
      /\.opponent-secret-candidates\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*visible;[\s\S]*?flex-wrap:\s*wrap;/
    );
    expect(styles).toMatch(
      /\.opponent-secret-candidates li\s*\{[\s\S]*?flex:\s*1 1 100%;[\s\S]*?min-width:\s*0;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/
    );
    expect(styles).toMatch(
      /\.opponent-secret-candidate-preview\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;[\s\S]*?display:\s*grid;[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?grid-template-columns:\s*20px minmax\(0,\s*1fr\) auto;/
    );
    expect(styles).toMatch(
      /\.opponent-secret-candidate-thumb\s*\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*26px;[\s\S]*?object-fit:\s*cover;/
    );
    expect(styles).toMatch(
      /\.secret-candidate-excluded \.opponent-secret-candidate-thumb\s*\{[\s\S]*?opacity:\s*0\.46;[\s\S]*?filter:\s*grayscale\(1\) saturate\(0\);/
    );
    expect(styles).toMatch(
      /\.opponent-secret-candidates strong\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/
    );
    expect(styles).toMatch(
      /\.opponent-secret-candidates span\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?white-space:\s*nowrap;/
    );
    expect(styles).not.toMatch(/\.opponent-secret-section\s*\{\s*max-height:/);
  });

  it("tightens the slot label at the 240px minimum width", () => {
    expect(styles).toMatch(
      /@media \(max-width: 280px\)[\s\S]*?\.opponent-secret-slot\s*\{[\s\S]*?grid-template-columns:\s*32px minmax\(0,\s*1fr\);/
    );
  });
});
