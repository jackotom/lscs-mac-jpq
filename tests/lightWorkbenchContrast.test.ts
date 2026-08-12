import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const rendererDirectory = join(process.cwd(), "src/renderer");
const linkedStyleFiles = [
  "styles.css",
  "overlayStyles.css",
  "arenaChoiceOverlayStyles.css",
  "cardHoverStyles.css",
  "opponentOverlayStyles.css",
  "boardAttackOverlayStyles.css",
  "ladderDeckRecommendationStyles.css",
  "matchHistoryStyles.css",
  "desktopReplicaStyles.css",
  "homeNewsStyles.css",
  "arenaHeroRankingStyles.css",
  "lightOverlayStyles.css",
] as const;

function rendererStyles(): string {
  const source = readFileSync(join(rendererDirectory, "App.tsx"), "utf8");
  const match = source.match(/const rendererStyles = `([\s\S]*?)`;\s*\n\s*export default App;/);
  if (!match) throw new Error("无法读取 App 内嵌样式");
  return match[1];
}

function installActualStyles() {
  for (const cssText of [
    ...linkedStyleFiles.map((file) => readFileSync(join(rendererDirectory, file), "utf8")),
    rendererStyles(),
  ]) {
    const style = document.createElement("style");
    style.textContent = cssText;
    document.head.append(style);
  }
}

function hasRule(selectorFragment: string) {
  return Array.from(document.styleSheets).some((sheet) => (
    Array.from(sheet.cssRules).some((rule) => rule.cssText.includes(selectorFragment))
  ));
}

function rgb(value: string) {
  const hex = value.match(/^#([\da-f]{6})$/i)?.[1];
  if (hex) return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [];
}

function luminance(value: string) {
  const [red, green, blue] = rgb(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete document.documentElement.dataset.trackerTheme;
});

describe("light workbench contrast", () => {
  it.each([
    ["dark", "dark"],
    ["missing", undefined],
  ] as const)("keeps the portal preview light when the main workbench theme is %s", (_label, theme) => {
    if (theme) document.documentElement.dataset.trackerTheme = theme;
    else delete document.documentElement.dataset.trackerTheme;
    document.body.innerHTML = `
      <div class="desktop-frame"><main class="app-shell view-card-library"></main></div>
      <aside class="card-hover-preview">
        <div class="card-detail-body card-detail-body-hover">
          <div class="card-related-list card-spell-history card-detail-related">
            <span>关联牌（1）</span>
            <div class="card-related-cards">
              <div class="card-related-card">
                <span class="card-related-art"></span>
                <div><strong>关联牌</strong><small>英雄</small><p>说明文字</p></div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    `;
    installActualStyles();

    const mainWorkbenchSelector = "html body:has(.desktop-frame):not(:has(.overlay-shell))";
    const relatedCardRule = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSStyleRule => "selectorText" in rule)
      .find((rule) => (
        rule.selectorText.includes(mainWorkbenchSelector)
        && rule.selectorText.includes(".card-related-list")
        && rule.selectorText.includes(".card-related-card")
        && rule.selectorText.includes(".card-related-art")
      ));

    expect(relatedCardRule, "浅色规则必须覆盖主程序更高权重的深色关联牌规则").toBeDefined();
    expect(relatedCardRule?.style.background).toMatch(/^#(?:fff(?:fff)?|f[0-9a-f]{5})$/i);

    const preview = document.querySelector(".card-hover-preview");
    expect(preview?.parentElement).toBe(document.body);
    expect(document.querySelector(".desktop-frame")?.contains(preview)).toBe(false);

    const styleRules = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSStyleRule => "selectorText" in rule);
    for (const selector of [
      ".card-hover-preview",
      ".card-detail-body",
      ".card-detail-body-hover",
      ".card-related-list",
      ".card-related-cards",
      ".card-related-card",
      ".card-related-art",
    ]) {
      const element = document.querySelector(selector);
      expect(element, `${selector} 应存在`).not.toBeNull();
      const rule = styleRules.find((candidate) => (
        candidate.selectorText.includes(mainWorkbenchSelector)
        && candidate.selectorText.includes(selector)
        && candidate.style.background
        && luminance(candidate.style.background) > 0.8
      ));
      expect(rule, `${selector} 必须有主工作台固定浅色规则`).toBeDefined();
      expect(luminance(rule!.style.background), `${selector} 主工作台必须保持浅色：${rule!.style.background}`)
        .toBeGreaterThan(0.8);
    }

    const cardBackground = styleRules.find((rule) => (
      rule.selectorText.includes(mainWorkbenchSelector)
      && rule.selectorText.includes(".card-related-card")
      && rule.style.background
      && luminance(rule.style.background) > 0.8
    ))!.style.background;
    for (const selector of [".card-related-card strong", ".card-related-card small", ".card-related-card p"]) {
      const element = document.querySelector(selector);
      expect(element, `${selector} 应存在`).not.toBeNull();
      const color = styleRules.find((rule) => (
        rule.selectorText.includes(mainWorkbenchSelector)
        && rule.selectorText.includes(selector)
        && rule.style.color
        && contrast(rule.style.color, cardBackground) >= 4.5
      ))?.style.color;
      expect(color, `${selector} 必须有主工作台文字颜色`).toBeDefined();
      expect(contrast(color!, cardBackground), `${selector} 主工作台对比度不足：${color}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the complete card preview white in the main workbench", () => {
    document.documentElement.dataset.trackerTheme = "light";
    document.body.innerHTML = `
      <div class="desktop-frame"><main class="app-shell view-card-library"></main></div>
      <aside class="card-hover-preview">
        <div class="card-detail-body-hover">
          <div class="card-detail-image"></div>
          <div class="card-related-card">
            <span class="card-related-art"></span>
            <div><strong>关联牌</strong><small>英雄</small><p>说明</p></div>
          </div>
          <div class="card-spell-history-empty">暂无资料</div>
          <button class="card-pool-load-more">继续显示</button>
        </div>
        <div class="card-preview-hint">悬停查看完整效果</div>
      </aside>
    `;
    installActualStyles();
    expect(hasRule('html[data-tracker-theme="light"] .card-hover-preview .card-detail-image')).toBe(true);

    for (const selector of [
      ".card-hover-preview",
      ".card-detail-body-hover",
      ".card-detail-image",
      ".card-related-card",
      ".card-related-art",
      ".card-spell-history-empty",
      ".card-pool-load-more",
      ".card-preview-hint",
    ]) {
      const element = document.querySelector(selector);
      expect(element, `${selector} 应存在`).not.toBeNull();
      const background = getComputedStyle(element!).backgroundColor;
      expect(luminance(background), `${selector} 不应保留深色背景：${background}`).toBeGreaterThan(0.9);
    }
  });

  it("keeps the related-card footer dark and readable in dark mode", () => {
    const styles = readFileSync(join(rendererDirectory, "cardHoverStyles.css"), "utf8");

    expect(styles).toMatch(/\.card-related-card\s*\{[^}]*background:\s*#10253a;/s);
    expect(styles).toMatch(/\.card-related-art\s*\{[^}]*background:\s*#091725;/s);
    expect(styles).toMatch(/\.card-related-card strong\s*\{[^}]*color:\s*#e7f0f4;/s);
    expect(styles).toMatch(/\.card-related-card small\s*\{[^}]*color:\s*#8298a4;/s);
    expect(styles).toMatch(/\.card-related-card p\s*\{[^}]*color:\s*#c3d3db;/s);
  });

  it("keeps theme-independent light rules scoped to the main workbench", () => {
    installActualStyles();

    const escapedRules = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSStyleRule => "selectorText" in rule)
      .filter((rule) => (
        rule.selectorText.includes(".card-preview-window-shell")
        && !rule.selectorText.includes('data-tracker-theme="light"')
        && /#(?:fff(?:fff)?|f[0-9a-f]{5})/i.test(rule.style.background)
        && !rule.selectorText.includes("body:has(.desktop-frame)")
      ));

    expect(escapedRules, "独立 ?card-preview=1 悬浮窗不能被主工作台固定浅色规则污染").toEqual([]);
  });

  it("keeps arena deck names, counts, progress, and the latest pick readable on white", () => {
    document.documentElement.dataset.trackerTheme = "light";
    document.body.innerHTML = `
      <div class="desktop-frame">
        <main class="app-shell view-dashboard">
          <aside class="panel arena-panel">
            <div class="arena-progress"><strong>30/30</strong><span>吉安娜</span><small>本地缓存</small></div>
            <div class="arena-waiting">等待下一轮候选牌</div>
            <section class="arena-deck"><ul><li><span>传送门卫士</span><strong>x1</strong></li></ul></section>
            <div class="arena-last-pick"><span>最近选择：折纸仙鹤</span><span class="arena-score arena-score-b"><strong>102</strong><small>良好</small></span></div>
          </aside>
        </main>
      </div>
    `;
    installActualStyles();
    expect(hasRule('html[data-tracker-theme="light"] .arena-progress strong')).toBe(true);

    for (const selector of [
      ".arena-progress strong",
      ".arena-progress span",
      ".arena-progress small",
      ".arena-waiting",
      ".arena-deck li span",
      ".arena-deck li > strong",
      ".arena-last-pick > span:first-of-type",
      ".arena-score strong",
      ".arena-score small",
    ]) {
      const element = document.querySelector(selector);
      expect(element, `${selector} 应存在`).not.toBeNull();
      const color = getComputedStyle(element!).color;
      expect(contrast(color, "rgb(255, 255, 255)"), `${selector} 对比度不足：${color}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps card-library edge states light and readable", () => {
    document.documentElement.dataset.trackerTheme = "light";
    document.body.innerHTML = `
      <div class="desktop-frame">
        <main class="app-shell view-card-library">
          <section class="card-library-panel">
            <div class="card-library-results-bar"><span>找到 8,110 张卡牌</span></div>
            <div class="card-library-stale-warning">更新失败，正在使用本地资料</div>
            <div class="card-library-state"><strong>暂无结果</strong><span>请修改筛选条件</span></div>
            <button class="card-library-card"><span class="card-library-art is-empty"></span><span class="card-library-card-copy"><strong>测试卡牌</strong><small>法术</small></span></button>
            <section class="card-library-selected">
              <div class="card-library-selected-heading"><strong>已选卡牌</strong></div>
              <div class="card-detail-heading"><strong>测试卡牌</strong></div>
              <p class="card-detail-meta">法术</p>
              <p class="card-detail-text">卡牌说明</p>
            </section>
            <div class="card-library-pagination"><button type="button">上一页</button></div>
          </section>
        </main>
      </div>
    `;
    installActualStyles();

    for (const selector of [
      ".card-library-stale-warning",
      ".card-library-art.is-empty",
      ".card-library-selected",
      ".card-library-pagination button",
    ]) {
      const element = document.querySelector(selector);
      expect(element, `${selector} 应存在`).not.toBeNull();
      expect(luminance(getComputedStyle(element!).backgroundColor), `${selector} 不应保留深色背景`)
        .toBeGreaterThan(0.9);
    }

    for (const selector of [
      ".card-library-results-bar span:first-child",
      ".card-library-state strong",
      ".card-library-card-copy strong",
      ".card-library-selected-heading strong",
      ".card-library-selected .card-detail-heading strong",
      ".card-library-selected .card-detail-meta",
      ".card-library-selected .card-detail-text",
      ".card-library-pagination button",
    ]) {
      const element = document.querySelector(selector);
      expect(element, `${selector} 应存在`).not.toBeNull();
      const color = getComputedStyle(element!).color;
      expect(contrast(color, "rgb(255, 255, 255)"), `${selector} 对比度不足：${color}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
