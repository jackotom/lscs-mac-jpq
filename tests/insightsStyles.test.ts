import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const renderer = join(process.cwd(), "src/renderer");
const load = (name: string) => readFileSync(join(renderer, name), "utf8");

describe("insights workspace style contracts", () => {
  it("loads arena and collection styles through the global renderer stylesheet", () => {
    const styles = load("styles.css");

    expect(styles).toMatch(/@import\s+["']\.\/arenaInsightsStyles\.css["'];/);
    expect(styles).toMatch(/@import\s+["']\.\/collectionInsightsStyles\.css["'];/);
  });

  it("keeps the arena center readable in a constrained workspace", () => {
    expect(existsSync(join(renderer, "arenaInsightsStyles.css"))).toBe(true);
    const styles = load("arenaInsightsStyles.css");

    expect(styles).toMatch(/\.arena-insights-panel\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*auto;/);
    expect(styles).toMatch(/\.arena-insights-header\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/);
    expect(styles).toMatch(/\.arena-insights-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(120px,\s*1fr\)\);/);
    expect(styles).toMatch(/\.arena-insights-header small\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
    expect(styles).toMatch(/\.arena-insights-state\s*\{[\s\S]*?border-style:\s*dashed;/);
    expect(styles).toMatch(/\.arena-insights-panel :focus-visible\s*\{[\s\S]*?outline:/);
    expect(styles).toContain("@media (max-width: 700px)");
  });

  it("makes collection source, update time, partial pity, and cosmetics grid explicit", () => {
    expect(existsSync(join(renderer, "collectionInsightsStyles.css"))).toBe(true);
    const styles = load("collectionInsightsStyles.css");

    expect(styles).toMatch(/\.collection-insights-panel\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*auto;/);
    expect(styles).toMatch(/\.collection-insights-header\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/);
    expect(styles).toMatch(/\.collection-insights-header small\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
    expect(styles).toMatch(/\.collection-insights-pity li\.collection-insights-pity-partial\s*\{[\s\S]*?border-style:\s*dashed;/);
    expect(styles).toMatch(/\.collection-insights-cosmetics\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(96px,\s*1fr\)\);/);
    expect(styles).toMatch(/\.collection-insights-cosmetics > section\s*\{[\s\S]*?min-width:\s*0;/);
    expect(styles).toMatch(/\.collection-insights-panel :focus-visible\s*\{[\s\S]*?outline:/);
    expect(styles).toContain("@media (max-width: 700px)");
  });

  it("keeps opponent hand facts compact without styling unknown cards as known", () => {
    const styles = load("opponentOverlayStyles.css");

    expect(styles).toMatch(/\.opponent-hand-timeline > ul\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*auto;/);
    expect(styles).toMatch(/\.opponent-hand-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/);
    expect(styles).toMatch(/\.opponent-hand-row > \*\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
    expect(styles).toMatch(/\.opponent-hand-unknown\s*\{[\s\S]*?border-style:\s*dashed;/);
    expect(styles).toMatch(/\.opponent-turn-timer\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/);
    expect(styles).toMatch(/\.opponent-turn-timer\s*\{[\s\S]*?gap:/);
    expect(styles).toMatch(/\.opponent-turn-timer\.is-unavailable\s*\{[\s\S]*?font-variant-numeric:\s*normal;/);
    expect(styles).toMatch(/\.opponent-overlay-shell :focus-visible\s*\{[\s\S]*?outline:/);
  });
});
