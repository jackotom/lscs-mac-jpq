import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(process.cwd(), "src/renderer/homeNewsStyles.css"), "utf8");
const dashboard = readFileSync(join(process.cwd(), "src/renderer/components/HomeDashboard.tsx"), "utf8");

describe("home tavern visual styles", () => {
  it("uses the generated original hero only for the home surface", () => {
    expect(dashboard).toContain('assets/home-emerald-hero-v1.png');
    expect(styles).toMatch(/\.home-reference-dashboard\s*\{[\s\S]*?background:/);
    expect(styles).toMatch(
      /body:has\(\.desktop-frame\):has\(\.app-shell\.view-home\)[\s\S]*?\.app-sidebar/
    );
    expect(styles).not.toContain("tavern-dashboard-frame-v1");
  });

  it("keeps interactive states and reduced-motion fallbacks explicit", () => {
    expect(styles).toMatch(/\.home-reference-dashboard button:focus-visible/);
    expect(styles).toMatch(/\.home-news-list button:not\(:disabled\):hover/);
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.home-reference-dashboard/
    );
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.home-reference-content/);
  });

  it("lets the main home page scroll vertically when the window is shorter than its content", () => {
    expect(styles).toMatch(
      /\.app-shell\.view-home\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/
    );
    expect(styles).toMatch(
      /\.home-reference-dashboard\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow-y:\s*visible;/
    );
  });
});
