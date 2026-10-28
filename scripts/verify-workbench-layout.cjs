// Run after the renderer build: env -u ELECTRON_RUN_AS_NODE electron scripts/verify-workbench-layout.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
app.on('window-all-closed', () => {});

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-layout-'));
  app.setPath('userData', temporary);
  const output = path.resolve(process.argv[2] || 'outputs/workbench-layout');
  const zone = { status: 'known', knownCount: 0, totalCount: 0, cards: [] };
  const player = { current: Object.fromEntries(['deck', 'hand', 'play', 'secret', 'graveyard', 'removed'].map(key => [key, zone])), burned: { totalCount: 0, items: [], truncated: false }, used: { totalCount: 0, items: [], truncated: false } };
  const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#338866"/><circle cx="200" cy="100" r="80" fill="#e4bb56"/></svg>');
  const details = { dbfId: 1, cardId: 'QA_LAYOUT', name: '比例检查卡牌', manaCost: 4, isSpell: false, cardType: '随从', text: '用于确认展开后的卡牌正文在浅色界面中清晰可读。', imageUrl: picture, cropImageUrl: picture, relatedCards: [] };
  const arenaCard = { name: '竞技场比例检查卡牌', cardId: details.cardId, count: 30, details };
  const state = { status: 'watching', gameActive: true, manualDeck: true, trackerMode: 'arena', logPath: '/isolated/layout/very-long-directory-name/with-many-segments/and-a-file-name-that-must-truncate-without-overlapping-actions/Power.log', deckName: '布局回归检查', deck: [{ name: details.name, cardId: details.cardId, count: 2, remaining: 2, drawn: 0, played: 0, details }], opponentPlayed: [], events: [], summary: { totalCards: 2, remainingCards: 2, drawnCards: 0, opponentPlayedCount: 0 }, arena: { status: 'complete', hero: { name: '测试英雄' }, draftCount: 30, unresolvedCount: 0, currentChoices: [], picks: [], deck: [arenaCard] }, cardTracking: { schemaVersion: 1, gameKey: 'layout', friendly: player, opponent: player, opponentSecretSlots: [], detailsByCardKey: { 'id:qa_layout': details }, contextDetailsBySideAndCardKey: { friendly: {}, opponent: {} } } };
  const preload = path.join(temporary, 'preload.cjs');
  await fs.writeFile(preload, `require('electron').contextBridge.exposeInMainWorld('hearthstoneTracker', { getState: async () => (${JSON.stringify(state)}), onUpdate: () => () => {} });`);
  let window;
  try {
    await app.whenReady();
    await fs.mkdir(output, { recursive: true });
    window = new BrowserWindow({ width: 1180, height: 760, show: false, webPreferences: { preload } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) console.error(message); });
    window.webContents.on('preload-error', (_event, file, error) => console.error(file, error.message));
    // Isolated UI verification must not fetch external card data or touch live logs.
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_request, callback) => callback({ cancel: true }));
    await window.loadFile(path.resolve('dist/index.html'));
    const evaluate = (script) => window.webContents.executeJavaScript(script);
    assert.ok(await evaluate('Boolean(window.hearthstoneTracker)'), 'isolated state bridge must be available');
    assert.equal(await evaluate('(async () => (await window.hearthstoneTracker.getState()).deckName)()'), state.deckName, 'isolated state must load');
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(document.querySelector('[aria-label="打开二级工作台"]'))`)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await evaluate(`document.documentElement.dataset.trackerTheme = 'light'; document.querySelector('[aria-label="打开二级工作台"]').click()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    await evaluate(`Array.from(document.querySelectorAll('.sidebar-item')).find(button => button.textContent.trim() === '实时对局')?.click()`);
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(document.querySelector('.deck-card-row .card-thumb'))`)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await fs.writeFile(path.join(output, 'page.txt'), await evaluate('document.body.innerText'));
    const metrics = await evaluate(`(async () => {
      const row = document.querySelector('.deck-card-row');
      const thumb = row.querySelector('.card-thumb');
      await thumb.decode();
      const closed = !row.parentElement.open;
      row.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const detail = row.parentElement.querySelector('.card-detail-image');
      await detail.decode();
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const arenaRow = document.querySelector('.arena-deck li');
      const arenaThumb = arenaRow.querySelector('.card-thumb');
      const logPath = document.querySelector('.brand-block p');
      const status = document.querySelector('.status-strip');
      const detailText = row.parentElement.querySelector('.card-detail-text');
      return { closed, opened: row.parentElement.open, thumbFit: getComputedStyle(thumb).objectFit, thumb: rect(thumb), detail: rect(detail), rowDisplay: getComputedStyle(row).display, dashboardDisplay: getComputedStyle(document.querySelector('.dashboard-grid')).display, brandDisplay: getComputedStyle(document.querySelector('.brand-block')).display, arenaThumbFit: getComputedStyle(arenaThumb).objectFit, arenaThumb: rect(arenaThumb), arenaRow: rect(arenaRow), logPath: rect(logPath), status: rect(status), logText: logPath.textContent, detailTextColor: getComputedStyle(detailText).color };
    })()`);
    await fs.writeFile(path.join(output, 'inspection.json'), JSON.stringify(metrics, null, 2));
    await fs.writeFile(path.join(output, 'screenshot.png'), (await window.capturePage()).toPNG());
    assert.equal(metrics.thumbFit, 'contain', 'card thumbnail must show a complete card image without cropping');
    assert.equal(metrics.arenaThumbFit, 'contain', 'arena card thumbnail must show a complete card image without cropping');
    assert.equal(metrics.rowDisplay, 'grid', 'card row must retain its columns');
    assert.equal(metrics.dashboardDisplay, 'grid', 'workbench panels must remain in columns');
    assert.equal(metrics.brandDisplay, 'flex', 'toolbar icon and log text must align');
    assert.ok(metrics.detail.width > 0 && metrics.detail.width <= 100, 'expanded artwork must stay bounded');
    assert.ok(metrics.arenaThumb.height <= metrics.arenaRow.height, 'arena thumbnail must remain within its row');
    assert.ok(metrics.logPath.x + metrics.logPath.width <= metrics.status.x, 'long log path must not overlap tracker status');
    assert.equal(metrics.detailTextColor, 'rgb(51, 65, 85)', 'expanded card text must retain readable light-theme contrast');
    assert.ok(metrics.closed && metrics.opened, 'card details must open on click');
    console.log('PASS: complete card thumbnails, arena row bounds, long-path toolbar layout, readable detail text, expand interaction');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 });
    app.exit(process.exitCode || 0);
  }
})().catch(error => { console.error(error.message); app.exit(1); });
