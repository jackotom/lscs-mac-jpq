import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(process.cwd(), "src/renderer/desktopReplicaStyles.css"), "utf8");

describe("desktop ice-blue theme styles", () => {
  it("uses the home page blue material system for the shell, settings, and deck tools route", () => {
    expect(styles).toMatch(/--replica-bg:\s*#070d1c/);
    expect(styles).toMatch(/--replica-panel:\s*#0c1528/);
    expect(styles).toMatch(/--replica-blue:\s*#255bdc/);
    expect(styles).toMatch(/--replica-blue-light:\s*#64b5ff/);
    expect(styles).toMatch(/--replica-gold:\s*#64b5ff/);
    expect(styles).toMatch(/\.sidebar-item\[aria-current="page"\][\s\S]*?background:\s*linear-gradient\(105deg, rgba\(30, 72, 163, \.9\), rgba\(18, 42, 90, \.62\)\)/);
    expect(styles).toMatch(/\.settings-section-content\s*\{[\s\S]*?#070d1c/);
    expect(styles).toMatch(/\.deck-tools-page\s*\{[\s\S]*?linear-gradient\(180deg, #080e1d, #050a15\)/);
    expect(styles).toMatch(/\.deck-tools-manual textarea\s*\{[\s\S]*?background:\s*var\(--replica-bg\)/);
    expect(styles).toMatch(/\.deck-tools-page \.primary-action\s*\{[\s\S]*?background:\s*linear-gradient\(180deg, #3187ef, #1d65c8\)/);
  });

  it("keeps tracker, match history, and card library interiors in the blue material system", () => {
    expect(styles).toMatch(/\.mana-cost\s*\{[\s\S]*?background:\s*radial-gradient\(circle at 35% 25%, #f1c765, #a96112 72%\)/);
    expect(styles).toMatch(/\.card-hover-preview\s*\{[\s\S]*?background:\s*var\(--replica-bg\)/);
    expect(styles).toMatch(/\.match-history-panel\s*\{[\s\S]*?background:\s*linear-gradient\(180deg, var\(--replica-panel-raised\), var\(--replica-panel\)\)/);
    expect(styles).toMatch(/\.card-library-panel\s*\{[\s\S]*?--card-library-bg:\s*var\(--replica-panel\)/);
    expect(styles).toMatch(/\.card-library-mana\s*\{[\s\S]*?background:\s*radial-gradient\(circle at 35% 25%, #f0c45d, #a65e10 74%\)/);
    expect(styles).toMatch(/\.card-library-pagination button\s*\{[\s\S]*?background:\s*var\(--replica-panel-soft\)/);
    expect(styles).not.toMatch(/--replica-(?:bg|sidebar|panel|border|blue):\s*(?:#090806|#100d09|#15110c|#634316|#c88922)/);
  });
});
