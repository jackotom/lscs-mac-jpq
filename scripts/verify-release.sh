#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
evidence_dir="$root_dir/outputs/release-verification"
screenshots_dir="$evidence_dir/screenshots"
inspections_dir="$evidence_dir/inspections"
metrics_file="$evidence_dir/baseline.tsv"
app_path="$root_dir/outputs/炉石记牌器.app"
app_executable="$app_path/Contents/MacOS/炉石记牌器"
redraft_source_dir="$root_dir/fixtures/logs/arena-redraft-session"
redraft_partial_fixture="outputs/release-verification/fixtures/arena-redraft-partial"
redraft_exact_fixture="outputs/release-verification/fixtures/arena-redraft-exact"
arena_playing_fixture="outputs/release-verification/fixtures/arena-playing"
arena_candidate_fixture_prefix="outputs/release-verification/fixtures/arena-redraft-candidates"
active_qa_pid=""

cleanup_active_qa_process() {
  local pid="${active_qa_pid:-}"
  active_qa_pid=""
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return
  fi

  kill "$pid" 2>/dev/null || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null || true
      return
    fi
    sleep 0.1
  done

  kill -9 "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

trap cleanup_active_qa_process EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$screenshots_dir" "$inspections_dir"
rm -f "$screenshots_dir"/*.png "$inspections_dir"/*.json "$metrics_file"
printf 'scenario\tduration_ms\tevidence\n' > "$metrics_file"
metrics_header=$'scenario\tduration_ms\tevidence'

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

require_file() {
  if [[ ! -s "$1" ]]; then
    echo "发布验证缺少证据：$1" >&2
    exit 1
  fi
}

prepare_arena_redraft_fixtures() {
  local partial_dir="$root_dir/$redraft_partial_fixture"
  local exact_dir="$root_dir/$redraft_exact_fixture"
  local playing_dir="$root_dir/$arena_playing_fixture"
  rm -rf "$partial_dir" "$exact_dir" "$playing_dir"
  rm -rf \
    "$evidence_dir/user-data/arena-redraft-partial-replay" \
    "$evidence_dir/user-data/arena-redraft-exact-replay" \
    "$evidence_dir/user-data/arena-playing-replay"
  mkdir -p "$partial_dir" "$exact_dir" "$playing_dir"
  for target_dir in "$partial_dir" "$exact_dir" "$playing_dir"; do
    cp "$redraft_source_dir/Arena.log" "$target_dir/Arena.log"
    cp "$redraft_source_dir/cards.qa-cache.json" "$target_dir/cards.qa-cache.json"
  done
  cp "$redraft_source_dir/Decks.after-redraft.log" "$exact_dir/Decks.log"
  cp "$redraft_source_dir/Decks.after-redraft.log" "$playing_dir/Decks.log"
  cp "$redraft_source_dir/Power.playing.log" "$playing_dir/Power.log"
  touch "$exact_dir/Decks.log"
  touch "$playing_dir/Arena.log" "$playing_dir/Decks.log" "$playing_dir/Power.log"
}

prepare_arena_candidate_fixtures() {
  local candidate_count target_dir
  for candidate_count in 35 34 33 32 31 30; do
    target_dir="$root_dir/${arena_candidate_fixture_prefix}-${candidate_count}"
    rm -rf "$target_dir" "$evidence_dir/user-data/arena-redraft-${candidate_count}-replay"
    mkdir -p "$target_dir"
    cp "$redraft_source_dir/cards.qa-cache.json" "$target_dir/cards.qa-cache.json"
    node - "$target_dir" "$candidate_count" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const targetDir = process.argv[2];
const candidateCount = Number(process.argv[3]);
const pendingCount = candidateCount - 30;
const cardId = (index) => `TEST_ARENA_${String(index).padStart(2, "0")}`;
const cachePath = path.join(targetDir, "cards.qa-cache.json");
const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
for (const card of cache.cards) {
  const match = /^TEST_ARENA_(\d+)$/.exec(card.cardId ?? "");
  if (match) {
    card.cost = Number(match[1]) % 8;
  }
}
for (let index = 31; index <= 35; index += 1) {
  cache.cards.push({
    dbfId: 1000 + index,
    name: `验收新牌${index}`,
    cardId: cardId(index),
    cost: index % 8
  });
}
fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);

const fetchedAt = "2026-07-31T12:00:00.000Z";
const cardIds = Array.from({ length: 35 }, (_value, index) => cardId(index + 1));
fs.writeFileSync(path.join(targetDir, "arena-ratings.qa-cache.json"), `${JSON.stringify({
  source: "QA Arena ratings",
  version: 1,
  fetchedAt,
  ratings: {
    Rogue: Object.fromEntries(cardIds.map((id, index) => [id, 80 + index]))
  },
  hearthArenaWeb: {
    source: "HearthArena Web",
    version: "qa-candidate-web-v1",
    locales: {
      "zh-cn": {
        locale: "zh-cn",
        url: "https://qa.invalid/heartharena",
        version: "qa-candidate-web-v1",
        fetchedAt,
        ratingCount: cardIds.length,
        ratings: {
          Rogue: Object.fromEntries(cardIds.map((id, index) => [id, 80 + index]))
        }
      }
    }
  },
  firestone: {
    source: "Firestone",
    version: "qa-candidate-ratings-v1",
    lastUpdated: fetchedAt,
    ratings: Object.fromEntries(cardIds.map((id, index) => [id, {
      pickRate: 30 + index,
      pickRateSampleSize: 10_000
    }]))
  }
}, null, 2)}\n`);
fs.writeFileSync(path.join(targetDir, "arena-ratings-firestone-rogue.qa-cache.json"), `${JSON.stringify({
  source: "Firestone",
  playerClass: "rogue",
  version: "qa-candidate-impact-v1",
  lastUpdated: fetchedAt,
  overallWins: 5_000,
  overallGames: 10_000,
  ratings: Object.fromEntries(cardIds.map((id, index) => [id, {
    includedWins: 55 + (index % 20),
    sampleSize: 100
  }]))
}, null, 2)}\n`);

const initial = [
  "D 11:59:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9000000001, Hero Card = HERO_03",
  ...Array.from(
    { length: 30 },
    (_value, index) => `D 11:59:00.${String(index + 1).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card ${cardId(index + 1)}`
  ),
  "D 11:59:01.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
];
const transition = [
  "D 12:00:00.000 Arena.SetDraftMode - REDRAFTING",
  "D 12:00:00.100 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9000000002",
  "D 12:00:00.200 DraftManager.OnChoicesAndContents - Draft Deck ID: 9000000001, Hero Card = HERO_03",
  ...Array.from(
    { length: 24 },
    (_value, index) => `D 12:00:00.${String(index + 201).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card ${cardId(index + 1)}`
  ),
  ...Array.from(
    { length: pendingCount },
    (_value, index) => `D 12:00:0${index + 1}.000 Client chooses: 验收新牌${index + 31} (${cardId(index + 31)})`
  )
];
fs.writeFileSync(path.join(targetDir, "Arena.log"), `${initial.join("\n")}\n`);
fs.writeFileSync(path.join(targetDir, "Arena.append.log"), `${transition.join("\n")}\n`);
NODE
  done
}

run_capture() {
  local name="$1"
  local fixture="$2"
  local qa_flag="${3:-}"
  local attempt="${4:-1}"
  local screenshot="$screenshots_dir/$name.png"
  local inspection="$inspections_dir/$name.json"
  local qa_user_data="$evidence_dir/user-data/$name"
  local qa_log_path="$root_dir/$fixture/Power.log"
  local qa_apply_tracker_settings_effects=0
  if [[ "$name" == "smart-counter-overlay" ]]; then
    qa_apply_tracker_settings_effects=1
  fi
  if [[ "$name" == arena-* ]]; then
    qa_log_path="$root_dir/$fixture/Arena.log"
  fi
  local started finished
  started="$(now_ms)"
  rm -rf "$qa_user_data"
  mkdir -p "$qa_user_data"
  local original_log_snapshot="$qa_user_data/qa-log-before-capture"
  cp "$qa_log_path" "$original_log_snapshot"
  if [[ -f "$root_dir/$fixture/cards.qa-cache.json" ]]; then
    cp "$root_dir/$fixture/cards.qa-cache.json" "$qa_user_data/hearthstone-cards.zhCN.blizzard.json"
  fi
  if [[ -f "$root_dir/$fixture/arena-ratings.qa-cache.json" ]]; then
    cp "$root_dir/$fixture/arena-ratings.qa-cache.json" "$qa_user_data/hearthstone-arena-ratings.json"
  fi
  if [[ -f "$root_dir/$fixture/arena-ratings-firestone-rogue.qa-cache.json" ]]; then
    cp "$root_dir/$fixture/arena-ratings-firestone-rogue.qa-cache.json" "$qa_user_data/hearthstone-arena-ratings-firestone-rogue.json"
  fi

  if [[ -n "$qa_flag" ]]; then
    env \
      HEARTHSTONE_LOG_DIR="$root_dir/$fixture" \
      QA_LOG_PATH="$qa_log_path" \
      QA_LOCK_LOG_PATH=1 \
      QA_SKIP_ARENA_SCREEN_RECOGNITION=1 \
      QA_ALLOW_MULTIPLE_INSTANCES=1 \
      QA_USER_DATA_DIR="$qa_user_data" \
      QA_SKIP_LOG_CONFIG_REPAIR=1 \
      QA_EXIT_AFTER_SCREENSHOT=1 \
      QA_SCREENSHOT_PATH="$screenshot" \
      QA_INSPECT_PATH="$inspection" \
      QA_APPLY_TRACKER_SETTINGS_EFFECTS="$qa_apply_tracker_settings_effects" \
      "$qa_flag"=1 \
      "$app_executable" &
  else
    env \
      HEARTHSTONE_LOG_DIR="$root_dir/$fixture" \
      QA_LOG_PATH="$qa_log_path" \
      QA_LOCK_LOG_PATH=1 \
      QA_SKIP_ARENA_SCREEN_RECOGNITION=1 \
      QA_ALLOW_MULTIPLE_INSTANCES=1 \
      QA_USER_DATA_DIR="$qa_user_data" \
      QA_SKIP_LOG_CONFIG_REPAIR=1 \
      QA_EXIT_AFTER_SCREENSHOT=1 \
      QA_SCREENSHOT_PATH="$screenshot" \
      QA_INSPECT_PATH="$inspection" \
      "$app_executable" &
  fi
  active_qa_pid=$!
  local transition_path="$root_dir/$fixture/Arena.append.log"
  if [[ -f "$transition_path" ]]; then
    local startup_log="$qa_user_data/logs/hearthstone-tracker.log"
    local app_started=0
    for _ in {1..100}; do
      if [[ -f "$startup_log" ]] && grep -Fq '"message":"应用启动"' "$startup_log"; then
        app_started=1
        break
      fi
      sleep 0.05
    done
    if [[ "$app_started" -ne 1 ]]; then
      echo "QA 场景未完成隔离应用启动：$name" >&2
      cleanup_active_qa_process
      return 38
    fi
    sleep 1.2
    if ! kill -0 "$active_qa_pid" 2>/dev/null; then
      echo "QA 场景在日志切换前提前退出：$name" >&2
      return 38
    fi
    cat "$transition_path" >> "$qa_log_path"
  fi
  local qa_status=0
  wait "$active_qa_pid" || qa_status=$?
  active_qa_pid=""
  if [[ "$qa_status" -ne 0 ]]; then
    if [[ "$attempt" -lt 2 ]]; then
      echo "QA 场景首次异常退出，正在重试：$name" >&2
      cp "$original_log_snapshot" "$qa_log_path"
      run_capture "$name" "$fixture" "$qa_flag" "$((attempt + 1))"
      return
    fi
    echo "QA 场景异常退出：$name（状态 $qa_status）" >&2
    return "$qa_status"
  fi

  if [[ ! -s "$screenshot" || ! -s "$inspection" ]]; then
    if [[ "$attempt" -lt 2 ]]; then
      echo "QA 场景首次缺少截图证据，正在重试：$name" >&2
      cp "$original_log_snapshot" "$qa_log_path"
      run_capture "$name" "$fixture" "$qa_flag" "$((attempt + 1))"
      return
    fi
  fi

  require_file "$screenshot"
  require_file "$inspection"
  node -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!report.hasApi || !report.location || !report.bodyText) process.exit(1);
    if (report.qaDockVisible !== false) process.exit(40);
    const scenario = process.argv[2];
    const fixture = process.argv[3];
    const candidateMatch = scenario.match(/^arena-redraft-(35|34|33|32|31|30)-replay$/);
    if (/\.card-detail-(?:copy|heading|image)\s*\{/.test(String(report.bodyText))) process.exit(37);
    if (report.trackerSettings?.general?.startMinimized !== false) process.exit(25);
    if (report.trackerSettings?.overlay?.position !== "right") process.exit(26);
    if (report.trackerSettings?.overlay?.showFriendlyAttack !== false) process.exit(27);
    if (report.trackerSettings?.overlay?.showOpponentAttack !== false) process.exit(28);
    if (scenario === "arena-choice-overlay") {
      const metricLabels = ["抽到影响", "对套牌影响", "选取率", "6+胜选取率"];
      const metricValues = ["1.85", "-1.75", "36.4%", "40.2%", "-2.40", "3.10", "0.00"];
      const bodyText = String(report.bodyText);
      if (!metricLabels.every((label) => bodyText.includes(label))) process.exit(41);
      if (!metricValues.every((value) => bodyText.includes(value))) process.exit(42);
      if (!Array.isArray(report.arenaChoiceMetrics) || report.arenaChoiceMetrics.length !== 3) process.exit(43);
      for (const group of report.arenaChoiceMetrics) {
        const items = group.items;
        if (!Array.isArray(items) || items.length !== 4 || !group.rect || group.rect.height > 62) process.exit(44);
        if (!(items[0].y === items[1].y && items[2].y === items[3].y && items[0].x === items[2].x && items[1].x === items[3].x)) process.exit(45);
        if (!(items[2].y > items[0].y && items[1].x > items[0].x)) process.exit(46);
        if (String(group.gridTemplateColumns).trim().split(/\s+/).length !== 2) process.exit(47);
        if (String(group.gridTemplateRows).trim().split(/\s+/).length !== 2) process.exit(48);
      }
    }
    if (scenario.endsWith("-replay")) {
      if (!report.trackerState || !String(report.trackerState.logPath ?? "").includes(fixture)) process.exit(2);
      if (report.trackerState.status !== "watching") process.exit(3);
      if (scenario === "normal-replay" && report.trackerState.gameActive !== true) process.exit(4);
      if (scenario === "auto-match-replay" && (!report.trackerState.autoMatchedDeckId || report.trackerState.deckName !== "智能匹配测试")) process.exit(5);
      if (scenario === "constructed-duplicate-replay") {
        const state = report.trackerState;
        const body = String(report.bodyText);
        if (!state.gameActive || state.deckName !== "学徒猎人" || state.summary?.remainingCards !== 28) process.exit(16);
        if (state.friendlyHand?.[0]?.cardId !== "JAM_037" || state.friendlyOther?.[0]?.cardId !== "CORE_DS1_184") process.exit(17);
        if (state.globalEffects?.length !== 0 || state.opponentGlobalEffects?.[0]?.cardId !== "JAIL_397") process.exit(18);
        if (!body.includes("学徒猎人") || body.includes("牌库中暂无卡牌")) process.exit(19);
      }
      if (scenario === "arena-replay" && (report.trackerState.arena?.status !== "drafting" || report.trackerState.arena?.draftCount !== 2 || report.trackerState.arena?.deck?.length !== 2)) process.exit(6);
      if (scenario === "arena-redraft-partial-replay") {
        const arena = report.trackerState.arena;
        const body = String(report.bodyText);
        const fakeNames = ["日志缺失的竞技场牌", "未解析竞技场牌"];
        if (
          arena?.status !== "complete" ||
          arena?.draftCount !== 29 ||
          arena?.unresolvedCount !== 30 ||
          arena?.awaitingExactDeck !== true ||
          arena?.pendingRedraftChoices?.length !== 5
        ) process.exit(8);
        if (!["选取率", "卡牌", "影响"].every((label) => body.includes(label))) process.exit(9);
        if (body.includes("影响全局") || body.includes("牌库中") || body.includes("待识别")) process.exit(20);
        if (fakeNames.some((name) => body.includes(name))) process.exit(10);
        if (arena.deck?.some((card) => card.unresolved || fakeNames.includes(card.name))) process.exit(11);
      }
      if (candidateMatch) {
        const expectedCandidateCount = Number(candidateMatch[1]);
        const arena = report.trackerState.arena;
        const body = String(report.bodyText);
        const confirmedTotal = (arena?.deck ?? []).reduce((sum, card) => sum + card.count, 0);
        const candidateTotal = (arena?.redraftPool ?? []).reduce((sum, card) => sum + card.count, 0);
        const trackerTotal = (report.trackerState.deck ?? []).reduce((sum, card) => sum + card.count, 0);
        const visibleCandidateRows = body.match(/(?:测试牌|验收新牌)\d+/g)?.length ?? 0;
        const candidatesWithCompleteData = (arena?.redraftPool ?? []).filter(
          (card) =>
            Number.isFinite(card.details?.manaCost) &&
            Number.isFinite(card.pickRate) &&
            Number.isFinite(card.deckImpact)
        ).reduce((sum, card) => sum + card.count, 0);
        if (
          arena?.status !== "redrafting" ||
          arena?.awaitingExactDeck !== true ||
          confirmedTotal !== 30 ||
          trackerTotal !== 30 ||
          candidateTotal !== expectedCandidateCount ||
          arena?.pendingRedraftChoices?.length !== expectedCandidateCount - 30 ||
          visibleCandidateRows !== expectedCandidateCount ||
          candidatesWithCompleteData !== expectedCandidateCount ||
          body.includes("?") ||
          body.includes("—")
        ) process.exit(38);
        if (!body.includes(`${expectedCandidateCount}张候选 · 最终30`)) process.exit(39);
      }
      if (scenario === "arena-redraft-exact-replay") {
        const arena = report.trackerState.arena;
        const arenaCards = arena?.deck ?? [];
        const trackerCards = report.trackerState.deck ?? [];
        const body = String(report.bodyText);
        const arenaTotal = arenaCards.reduce((sum, card) => sum + card.count, 0);
        const trackerTotal = trackerCards.reduce((sum, card) => sum + card.count, 0);
        const knownExactCard = (card) =>
          typeof card.name === "string" && /^测试牌\d{2}$/.test(card.name) &&
          typeof card.cardId === "string" && card.cardId.startsWith("TEST_ARENA_") &&
          card.unresolved !== true;
        const exactEvidence = JSON.stringify({ body, arenaCards, trackerCards });
        const invalidLabels = ["Unknown card", "未知卡牌", "未识别", "日志缺失的竞技场牌", "未解析竞技场牌"];
        if (arena?.status !== "complete" || arena?.draftCount !== 30 || arena?.unresolvedCount !== 0 || arenaTotal !== 30 || trackerTotal !== 30) process.exit(12);
        if (!["选取率", "卡牌", "影响"].every((label) => body.includes(label)) || body.includes("待识别")) process.exit(13);
        if (body.includes("影响全局") || body.includes("牌库中")) process.exit(21);
        if (arenaCards.length !== 30 || trackerCards.length !== 30 || !arenaCards.every(knownExactCard) || !trackerCards.every(knownExactCard)) process.exit(14);
        if (!body.includes("测试牌01") || !body.includes("测试牌30") || invalidLabels.some((label) => exactEvidence.includes(label))) process.exit(15);
      }
      if (scenario === "arena-playing-replay") {
        const arena = report.trackerState.arena;
        const body = String(report.bodyText);
        if (arena?.status !== "playing" || report.trackerState.gameActive !== true || report.trackerState.summary?.remainingCards !== 29) process.exit(22);
        if (!body.includes("牌库 (29)") || body.includes("等待开局")) process.exit(23);
        if (["选取率", "卡牌", "影响"].every((label) => body.includes(label))) process.exit(24);
      }
    }
    const routeByScenario = { "deck-overlay": "overlay=1", "constructed-duplicate-replay": "overlay=1", "arena-redraft-partial-replay": "overlay=1", "arena-redraft-exact-replay": "overlay=1", "arena-playing-replay": "overlay=1", "opponent-overlay": "opponent-overlay=1", "arena-choice-overlay": "arena-choice-overlay=1", "ladder-deck-overlay": "ladder-deck-overlay=1", "board-attack-overlay": "friendly-attack-overlay=1", "smart-counter-overlay": "smart-counter-overlay=1", "arena-hero-ranking-overlay": "arena-hero-ranking-overlay=1", "three-window-layout": "arena-hero-ranking-overlay=1" };
    if (candidateMatch) routeByScenario[scenario] = "overlay=1";
    if (routeByScenario[scenario] && !report.location.includes(routeByScenario[scenario])) process.exit(7);
    if (routeByScenario[scenario] && report.qaMainWindowVisible !== false) process.exit(36);
    if (scenario === "three-window-layout") {
      const { workArea, hero, opponent, friendly } = report.qaWindowLayout ?? {};
      const windowsOverlap = (left, right) =>
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y;
      const insideWorkArea = (bounds) =>
        bounds.x >= workArea.x &&
        bounds.y >= workArea.y &&
        bounds.x + bounds.width <= workArea.x + workArea.width &&
        bounds.y + bounds.height <= workArea.y + workArea.height;
      if (!workArea || !hero?.bounds || !opponent?.bounds || !friendly?.bounds) process.exit(29);
      if (!hero.visible || !opponent.visible || !friendly.visible || hero.collapsed || opponent.collapsed || friendly.collapsed) process.exit(30);
      if (hero.bounds.width !== 100 || opponent.bounds.width !== 250 || friendly.bounds.width !== 100) process.exit(31);
      if (hero.bounds.x !== workArea.x || friendly.bounds.x + friendly.bounds.width !== workArea.x + workArea.width) process.exit(32);
      if (opponent.bounds.x !== hero.bounds.x + hero.bounds.width + 24) process.exit(33);
      if (![hero.bounds, opponent.bounds, friendly.bounds].every(insideWorkArea)) process.exit(34);
      if (
        windowsOverlap(hero.bounds, opponent.bounds) ||
        windowsOverlap(hero.bounds, friendly.bounds) ||
        windowsOverlap(opponent.bounds, friendly.bounds)
      ) process.exit(35);
    }
  ' "$inspection" "$name" "${fixture##*/}"
  finished="$(now_ms)"
  printf '%s\t%s\t%s\n' "$name" "$((finished - started))" "${screenshot#$root_dir/}" >> "$metrics_file"
}

verify_arena_redraft_candidate_windows() {
  local candidate_count
  prepare_arena_candidate_fixtures
  for candidate_count in 30 31 32 33 34 35; do
    run_capture \
      "arena-redraft-${candidate_count}-replay" \
      "${arena_candidate_fixture_prefix}-${candidate_count}" \
      QA_OPEN_OVERLAY
    require_file "$screenshots_dir/arena-redraft-${candidate_count}-replay.png"
    require_file "$inspections_dir/arena-redraft-${candidate_count}-replay.json"
  done
}

if [[ "${VERIFY_ARENA_REDRAFT_ONLY:-0}" == "1" ]]; then
  echo "[1/1] 地下竞技场重选窗口回放"
  verify_arena_redraft_candidate_windows
  echo "地下竞技场重选窗口验证通过。证据保存在：$evidence_dir"
  exit 0
fi

echo "[1/7] 完整测试"
npm test
npm test -- \
  tests/mainWindowVisibility.test.ts \
  tests/automaticOverlayController.test.ts \
  tests/opponentOverlayWindowController.test.ts \
  tests/trackerSettingsStore.test.ts \
  tests/overlayWindowBounds.test.ts

echo "[2/7] 类型检查"
npm run typecheck

echo "[3/7] 正式构建"
npm run build

echo "[4/7] 签名打包"
npm run package:mac-arm64
require_file "$root_dir/outputs/炉石记牌器-mac-arm64.zip"
if [[ ! -s "$metrics_file" || "$(head -n 1 "$metrics_file")" != "$metrics_header" ]]; then
  echo "发布验证证据在打包时被清理" >&2
  exit 1
fi

echo "[5/7] 代表性日志回放与窗口截图"
prepare_arena_redraft_fixtures
run_capture normal-replay fixtures/logs/session-2026-07-10
run_capture auto-match-replay fixtures/logs/auto-match-session
run_capture constructed-duplicate-replay fixtures/logs/constructed-duplicate-create QA_OPEN_OVERLAY
run_capture arena-replay fixtures/logs/arena-session
run_capture arena-redraft-partial-replay "$redraft_partial_fixture" QA_OPEN_OVERLAY
verify_arena_redraft_candidate_windows
run_capture arena-redraft-exact-replay "$redraft_exact_fixture" QA_OPEN_OVERLAY
run_capture arena-playing-replay "$arena_playing_fixture" QA_OPEN_OVERLAY
run_capture deck-overlay fixtures/logs/session-2026-07-10 QA_OPEN_OVERLAY
run_capture opponent-overlay fixtures/logs/session-2026-07-10 QA_OPEN_OPPONENT_OVERLAY
run_capture arena-choice-overlay fixtures/logs/arena-session QA_OPEN_ARENA_CHOICE_OVERLAY
run_capture ladder-deck-overlay fixtures/logs/session-2026-07-10 QA_OPEN_LADDER_DECK_OVERLAY
run_capture board-attack-overlay fixtures/logs/session-2026-07-10 QA_OPEN_BOARD_ATTACK_OVERLAY
run_capture smart-counter-overlay fixtures/logs/session-2026-07-10 QA_OPEN_SMART_COUNTER_OVERLAY
run_capture arena-hero-ranking-overlay fixtures/logs/arena-session QA_OPEN_ARENA_HERO_RANKING_OVERLAY
run_capture three-window-layout fixtures/logs/arena-session QA_OPEN_THREE_WINDOW_LAYOUT
require_file "$screenshots_dir/arena-redraft-partial-replay.png"
require_file "$screenshots_dir/arena-redraft-exact-replay.png"
require_file "$screenshots_dir/arena-playing-replay.png"
require_file "$screenshots_dir/arena-choice-overlay.png"
require_file "$screenshots_dir/smart-counter-overlay.png"
require_file "$screenshots_dir/arena-hero-ranking-overlay.png"
require_file "$screenshots_dir/three-window-layout.png"
require_file "$inspections_dir/arena-redraft-partial-replay.json"
require_file "$inspections_dir/arena-redraft-exact-replay.json"
require_file "$inspections_dir/arena-playing-replay.json"
require_file "$inspections_dir/arena-choice-overlay.json"
require_file "$inspections_dir/smart-counter-overlay.json"
require_file "$inspections_dir/arena-hero-ranking-overlay.json"
require_file "$inspections_dir/three-window-layout.json"

echo "[6/7] 组件、签名、权限说明与架构"
expected_app_version="$(node -p 'require("./package.json").version')"
actual_short_version="$(plutil -extract CFBundleShortVersionString raw "$app_path/Contents/Info.plist")"
actual_build_version="$(plutil -extract CFBundleVersion raw "$app_path/Contents/Info.plist")"
if [[ "$actual_short_version" != "$expected_app_version" || "$actual_build_version" != "$expected_app_version" ]]; then
  echo "安装包版本错误：期望 $expected_app_version，实际 $actual_short_version / $actual_build_version" >&2
  exit 1
fi
for helper in arena-ocr frontmost-app; do
  helper_path="$app_path/Contents/MacOS/$helper"
  if [[ ! -x "$helper_path" ]]; then
    echo "本机组件不可执行：$helper" >&2
    exit 1
  fi
  lipo -archs "$helper_path" | grep -qw arm64
done
lipo -archs "$app_executable" | grep -qw arm64
plutil -extract NSScreenCaptureUsageDescription raw "$app_path/Contents/Info.plist" | grep -q .
codesign --verify --deep --strict "$app_path"
signature_details="$(codesign -dv --verbose=4 "$app_path" 2>&1)"
if ! grep -Fq 'Authority=Developer ID Application:' <<<"$signature_details"; then
  echo "安装包未使用 Developer ID 正式签名" >&2
  exit 1
fi
if ! grep -Eq 'flags=.*runtime' <<<"$signature_details"; then
  echo "安装包未启用 Hardened Runtime" >&2
  exit 1
fi
if ! grep -Fq 'Timestamp=' <<<"$signature_details"; then
  echo "安装包缺少可信时间戳" >&2
  exit 1
fi

echo "[7/7] 安装包启动"
launch_user_data="$evidence_dir/user-data/launch-check"
rm -rf "$launch_user_data"
mkdir -p "$launch_user_data"
env \
  QA_ALLOW_MULTIPLE_INSTANCES=1 \
  QA_USER_DATA_DIR="$launch_user_data" \
  QA_SKIP_LOG_CONFIG_REPAIR=1 \
  QA_SKIP_ARENA_SCREEN_RECOGNITION=1 \
  "$app_executable" >/dev/null 2>&1 &
launched_pid=$!
active_qa_pid="$launched_pid"
sleep 4
if ! kill -0 "$launched_pid" 2>/dev/null; then
  echo "安装包未成功启动" >&2
  exit 1
fi
cleanup_active_qa_process

printf 'idle-listening\tmanual\t打包应用连续空闲 5 分钟后用活动监视器记录\n' >> "$metrics_file"
printf 'high-frequency-log\tautomated\t日志并发、截断与会话切换回归测试通过\n' >> "$metrics_file"

echo "发布验证通过。证据保存在：$evidence_dir"
