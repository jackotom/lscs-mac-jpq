# Backend and parsing layer

## Safety boundary

This layer only reads Hearthstone log files from disk. It does not read process memory, inject code into the game, patch files, or call any game process APIs.

## Files

- `src/main/logDiscovery.ts`: finds readable Hearthstone log sessions on macOS, including `Arena.log`.
- `src/main/collectionDeckService.ts`: scans `Decks.log`, imports collection deck records, and writes them to the local JSON database.
- `src/main/collectionDeckStore.ts`: reads and writes the local collection deck JSON database under Electron `userData`.
- `src/main/cardDataService.ts`: imports the full constructed-card list from the official Blizzard card browser API, merges HearthstoneJSON plus Firestone's full zhCN reference database so newly released log card IDs and generated cards can be resolved, and stores versioned local snapshots. Startup `preferCache` reads the newest local snapshot immediately without waiting for network. Explicit loads sharing the same cache path coalesce across service instances; after one instance writes a newer supplement, later `preferCache` calls re-read the shared files so the same app run sees the completed database. A snapshot with missing related cards is upgraded once.
- `src/main/atomicJsonCache.ts`: validates staged JSON writes, atomically replaces the primary cache, and restores the last valid backup when the primary is missing or damaged.
- `src/main/arenaRatingService.ts`: loads versioned HearthArena ratings, HearthArena official zh-cn/zh-tw tierlist pages, and Firestone public Arena/Underground statistics into a local cache, preserving source versions, winrates, played winrates, pick-rate buckets and sample sizes.
- `src/main/arenaHeroStatsService.ts`: aggregates Firestone's public Arena class overview into a hero win-rate ranking, keeps a 12-hour atomic local cache, and returns stale data with a warning when refresh fails.
- `src/main/arenaScreenRecognition.ts`: invokes the bundled macOS visual recognizer for Arena candidate fallback and constructed deck-select text recognition.
- `src/main/frontmostApp.ts`: reads the bundled macOS frontmost-app helper and gates Arena visual recognition/choice overlay visibility to Hearthstone.
- `src/main/startupHealthCheck.ts`: runs the pre-window startup inspection, verifies writable application data storage and required packaged files, coordinates safe settings/log-config repair, and returns one ready-or-blocked result for the main process.
- `src/main/opponentSecretOverlayVisibility.ts`: detects increases in independent opponent-secret slot count.
- `src/main/opponentSecretOverlayPresenter.ts`: presents an automatically triggered opponent-secret window through `showInactive()` only, after validating settings, generation, and window identity; the automatic path has no focus capability.
- `src/main/boardAttackOverlay.ts`: owns the confirmed HDT attack-icon placement ratios and the active-game/frontmost-app visibility rule.
- `src/main/opponentOverlayWindowState.ts`: preserves expanded opponent-window bounds while switching to and from the compact folded entry.
- `src/main/hearthstoneInstallation.ts`: reads the local Hearthstone app version and cross-checks Battle.net product records before publishing a verified CN patch.
- `src/main/ladderDeckRecommendationService.ts`: validates current-patch deck statistics, applies the minimum-games threshold, and maintains version-and-mode isolated caches. A configured `HEARTHSTONE_CN_LADDER_DECK_SOURCE_URL` remains the trusted Chinese-server source; otherwise the service reads HSGuru's public international Standard/Wild Diamond-to-Legend weekly ranking with at least 800 games and labels it `GLOBAL`. The current patch is detected from the local installation instead of a manual environment variable, and international data is never relabeled as Chinese-server data.
- `src/main/ladderDeckOverlayController.ts`: shows the left recommendation window only for Standard/Wild while Hearthstone is frontmost, rejects stale mode refreshes, and preserves a manual close until the mode changes.
- `src/main/logParsers.ts`: parses `Power.log` and `Player.log` into typed log events.
- `src/main/trackerBackend.ts`: reads discovered logs and builds a match state.
- `src/main/trackerService.ts`: Electron-facing watcher service that tails the chosen log file.
- `src/main/trackerSession.ts`: gives every tracking start an explicit identity and binds asynchronous log, OCR, rating, and deck results to that identity.
- `src/main/appRunState.ts`: stores an anonymous serialized run marker so the next launch can diagnose an unclean exit without storing player or deck data.
- `src/main/matchHistoryStore.ts`: validates and atomically stores at most 100 confirmed local match results under Electron `userData`.
- `src/main/main.ts` and `src/main/preload.ts`: IPC boundary for renderer calls.
- `src/main/rendererPage.ts`: resolves the renderer entry. Packaged builds always use the bundled page; development accepts only credential-free local HTTP addresses.
- `src/main/trackerSettingsStore.ts`: validates settings, migrates older formats, and during startup health checking preserves an invalid file as a timestamped backup before atomically restoring safe defaults.
- `src/shared/deck.ts`: UI-facing deck parser used by the current tracker engine; it supports manual lists and deck strings when a card database is available.
- `src/shared/deckImport.ts`: parses manual deck lists and preserves Hearthstone deck strings as raw text.
- `src/shared/deckstring.ts`: wraps the existing `deckstrings` package and maps decoded dbfIds through the local card database.
- `src/shared/collectionDeckParser.ts`: parses `Decks.log` or similar local text into collection deck blocks while preserving unknown raw blocks with warnings.
- `src/shared/arenaLogParser.ts`: parses Arena draft mode, hero, selected cards, and completed draft records from `Arena.log`.
- `src/shared/arenaChoiceParser.ts`: parses candidate and chosen entities from `Power.log` choice blocks.
- `src/shared/arenaDraftEngine.ts`: merges Arena and Power events, scores candidates, aggregates the selected cards, and exposes the current Arena state.
- `src/shared/cardDatabase.ts`: typed local dbfId/cardId-to-card-info dictionary helpers, including image URLs, mana/attack/health, cleaned card text, card type and related-card links; no network access is performed.
- `src/shared/powerLogParser.ts`: UI-facing Power.log line parser used by the current tracker engine.
- `src/shared/trackerEngine.ts`: UI-facing in-memory tracker engine.
- `src/shared/matchState.ts`: applies parsed events to the match state.
- `src/shared/types.ts`: shared contracts for renderer/main/tests.

## Log discovery

Candidate roots are checked in this order:

1. Caller-provided `extraCandidates`
2. `HEARTHSTONE_LOG_DIR`
3. `~/Library/Logs/Blizzard Entertainment/Hearthstone`
4. `/Applications/Hearthstone/Logs`
5. `~/Library/Logs/Hearthstone`
6. `~/Library/Logs/Blizzard/Hearthstone`
7. `~/Library/Application Support/Blizzard/Hearthstone/Logs`

A session is any readable directory containing `Power.log`, `Player.log`, `Decks.log`, `Arena.log`, or `LoadingScreen.log`. If multiple sessions exist, the newest modified one is selected. A newer Hearthstone session without `Power.log` still wins over an older card-tracking session, so the UI clears stale deck counts and reports either the recognized pregame wait state or a real missing-log error. While tracking, `TrackerService` checks for a newer session every second and follows that session; a paused or disposed tracker ignores any delayed discovery result. Automatic discovery normally retains the selected discovery root, but when it initially resolves only an isolated root-level `Player.log`, recovery may rescan every supported default log root to find a usable session in another directory. A manually selected file or directory always remains locked to its original file or containing-session scope and must never widen into default-root discovery. A transition binds the exact discovery result and retains that result's root; it must neither rebind to the current `Decks.log` or `LoadingScreen.log` nor resolve the root a second time, otherwise it can miss a later `Power.log` or race back to the active session. Every tracking start owns an explicit internal session identity, even when it reuses the same resolved path. An mtime increase on that path is ordinary live growth and is handled only by the incremental watcher. Periodic discovery must never restart or replay the active path, and delayed work from an older identity must be discarded before it mutates state.

`TrackerService` requires `Power.log` for live card tracking. If a user-selected or auto-discovered path is `Player.log`, the service first switches to a sibling `Power.log` in the same directory. A session whose `LoadingScreen.log` current mode is login, hub, draft, or tournament remains in the recognized waiting state even when `Player.log` already exists or `nextMode` announces gameplay. A lone `Player.log` with no scene evidence, or a current `GAMEPLAY` scene that still has no `Power.log`, reports the repair error because live card data is genuinely unavailable, but the session refresh remains active. This is required for the normal launch order where the tracker first sees the root-level `Player.log` and Hearthstone creates a timestamped session with `Power.log` a few seconds later. Other pregame-only sessions clear any previous game state and keep checking once per second. A later `Power.log` is adopted automatically without restarting the tracker. Arena discovery follows the same readiness rule: if the selected newest `Arena.log` exists but is empty or not yet usable, later growth that makes that same file usable must be processed automatically even though its path did not change. When a usable Arena session is active without `Power.log`, the service also watches sibling `Decks.log`; a later `Finding Game With Deck` entry immediately previews the constructed deck so a completed Arena deck does not remain on the overlay after queuing Standard or Wild.

When the newest session only has `Decks.log`, the service publishes the recognized waiting state, loads the local card database before collection-deck preview, and starts constructed-screen recognition. This allows a cold launch directly into Standard or Wild deck selection to publish an overlay context before Arena has ever been opened, with mana costs and card thumbnails already available even though `Power.log` does not exist yet.

Live log reads are framed on complete newline boundaries. A trailing partial UTF-8 line is kept until the next append, so `SHOW_ENTITY` details written across multiple filesystem notifications cannot drop mulligan replacements or other revealed cards. Entity-detail continuations are scoped to their own `SHOW_ENTITY` / `FULL_ENTITY` block, including both `Updating` and `Creating` forms; a generated entity entering `PLAY` therefore cannot overwrite the zone of the previously revealed hand card. The constructed snapshot inspector also carries the current `SHOW_ENTITY` entity across its indented `tag=CONTROLLER` and `tag=ZONE` continuation lines; a revealed card that reaches `HAND` through this nested form is subtracted from the initial deck instead of leaving the remaining count one too high.

Friendly hand totals are based on distinct friendly entities currently in the `HAND` zone. An entity whose card identity has not been resolved yet is retained as `未识别手牌` instead of being dropped, so restarting the tracker during a game restores the real hand size immediately; a later reveal replaces the placeholder without changing the total.

Collection deck import requires `Decks.log`. The service does not read memory, account servers, or game APIs. If `Decks.log` is missing, `CollectionDeckService.scanAndImportDecks()` returns `missing-log` with this user action: repair log config, restart Hearthstone, then open the in-game collection/deck page.

## Parsed events

`Power.log` currently emits:

- `game-started` from `CREATE_GAME`
- setup-complete markers from `STEP` / `NEXT_STEP` reaching `MAIN_READY` or `MAIN_ACTION`
- `zone-change` from `TAG_CHANGE`
- `card-played` from `BLOCK_START BlockType=PLAY`
- `entity-revealed` from `SHOW_ENTITY` and `FULL_ENTITY`
- generated-entity markers from `DISPLAYED_CREATOR`; after setup these drive inserted-deck entity tracking, exact deduplication, and unknown-to-known card replacement
- block boundaries from every `BLOCK_START` / `BLOCK_END`; random-spell outcomes are collected under the actual source card, preserve nested casts, and deduplicate the mirrored `GameState` / `PowerTaskList` block.

A full-hand burn can first appear as an unknown `DECK -> GRAVEYARD` entity and reveal its card id on the following `SHOW_ENTITY`. The tracker keeps that pending entity until reveal, then decrements the matching deck row exactly once. This uses the same path for every card, not a card-name exception.

`Player.log` currently emits:

- `player-info` from player id/name lines
- local-player markers when a line identifies the local player id

## Match history

`TrackerService` records a result only when a `PLAYSTATE` line includes a controller that matches the confirmed local player. An explicit local marker from `Player.log` remains authoritative. The `Power.log` fallback accepts only an explicit local marker/name such as `Local` or `本地玩家`; an ordinary real name never confirms local identity, even when it is the only named player currently visible. `WON` is stored as a win, `LOST` or `CONCEDED` as a loss, and `TIED` as a tie. Opponent results, ambiguous/unknown controllers, and a standalone `FINAL_GAMEOVER` are ignored.

Each record keeps a stable log-derived id, mode, last known deck name, and end time. End time combines the matching result line's time-of-day with the active `Power.log` mtime date. A late-night result with an mtime just after midnight is assigned to the previous day; if the line time cannot be parsed safely, the observable file mtime is used instead of the current import time. `MatchHistoryStore` validates every record read from disk, writes through a temporary file plus rename, preserves an existing record on replay, sorts by `endedAt` descending, and keeps the true newest 100 records. Read or write failures are returned to the renderer as explicit errors. The history IPC is exposed only to the main window preload capability.

## Deck import

Manual card lists are supported, including:

```text
2x Fireball
1x (2) Frostbolt
Fireball
```

Hearthstone export text with `###`, `# Class:`, `# Format:`, and commented card rows is also supported.

When a Hearthstone deck string is present, `TrackerService` loads the cached official card database or refreshes it from the Blizzard card browser, then passes it into `parseDeckText()`. HearthstoneJSON remains a fallback/enrichment source for card IDs and historical cards. If the database cannot be loaded, the raw code is still preserved and manual card rows remain usable.

When a valid `Power.log` is available, `TrackerService` also loads the same zhCN database before replaying log lines. `TrackerEngine` resolves card names by `cardId` first, so `UNKNOWN ENTITY` log lines and English entity names can still map to the localized card names from the deck string or card database.

## Collection deck import

`ensureLogConfig()` enables the Power, Zone, Decks, and Arena sections with file printing. `inspectLogConfig()` parses each section independently so a later section cannot make a disabled section look enabled. Startup repair merges only missing sections or a disabled/missing `FilePrinting` key, preserving custom sections, paths, comments, and unrelated settings. A changed config is backed up and replaced atomically. Isolated QA runs use explicit user-data/screenshot/repair-skip variables so release screenshots cannot modify the user's real Hearthstone config.

`CollectionDeckService.scanAndImportDecks()` resolves the best local `Decks.log`, parses deck blocks, decodes each deck string into card rows using the local card database, writes the result to `collection-decks.json` under Electron `userData`, and returns the imported deck list through IPC channel `tracker:scan-import-collection-decks`. When Hearthstone appends `Finding Game With Deck`, the selected deck is returned separately and activated immediately after the game starts. This log-selected preview is authoritative across transient screen-capture failures before the next game; only a preview inferred from screen text may be cleared by a later recognition failure.

The collection parser supports the current macOS log format emitted after opening the in-game collection deck page:

```text
I 20:56:52.9687400 Deck Contents Received:
I 20:56:52.9687400 ### Deck Name
I 20:56:52.9687400 # Deck ID: 9222863564
I 20:56:52.9687400 AAE...
```

`Deck ID` is stored for de-duplication, but it is not passed into the normal deck importer as a card row. Repeated `Finished Editing Deck` blocks with the same ID replace the earlier copy.

Stored deck records include:

- deck name, class, format, and mode when present
- Hearthstone deck ID when present
- parsed card rows
- raw deck string when present
- full raw source block
- source path and update time
- parser warnings for unknown or partial formats

Unknown `Decks.log` formats are not discarded. The raw block is stored with a warning so future parser improvements can use the original evidence.

The main process syncs collection decks on app startup and starts tracking automatically. Automatic startup always uses the local card cache immediately, even when the cache is old; network version checks are reserved for an explicit card-library load so overlay recognition is not blocked by an update request. `TrackerEngine` gives the `Finding Game With Deck` result priority over heuristic matches. If that record is unavailable, it scores friendly draw/play observations against the decoded collection decks and waits for a confident match instead of requiring manual deck selection.

## Arena draft flow

Underground Arena redraft uses two layers of deck state:

- `deck` keeps the most recently confirmed exact 30-card deck.
- `pendingRedraftChoices` keeps newly selected cards, while `redraftPool` combines the confirmed deck and those pending candidates for display.
- The confirmed 30-card deck is rebuilt through the same card-detail and rating pipeline as live picks. If the card database or rating cache arrives later, the confirmed cards are hydrated again before the first redraft choice and remain complete throughout the 30–35 candidate pool.
- `ACTIVE_DRAFT_DECK` only closes the selection screen; it does not confirm the final deck, so `awaitingExactDeck` remains true.
- Only a newer matching 30-card snapshot from `Decks.log` replaces the confirmed deck and clears pending candidates.
- On cold start without a previous exact deck, the tracker does not guess omitted duplicate copies and waits for an exact snapshot.
- Identical redraft pick lines are deduplicated by their complete raw log text. Picks for the same card at different timestamps remain distinct.
- Release QA replays every 30–35 candidate state through the packaged application and rejects missing rows or missing cost, pick-rate, and impact data.

The independent Arena hero ranking window uses the same public Firestone class-overview source as card deck-impact statistics. It appears on the left while Hearthstone is frontmost and the watched Arena state is active, respects both the global overlay switch and its own saved setting, and closes when Arena becomes inactive. A manual close suppresses it until that Arena session ends.

When `Arena.log` exists beside `Power.log`, `TrackerService` reads both files from the same session. `Arena.log` is the source of final picks; `Power.log` supplies the live candidate cards and is also used as a fallback when the Arena log has not been enabled yet. If the current Hearthstone session only writes `Arena.log` while the player is drafting or has just completed the draft, the service still follows that newest Arena session so screen recognition, the choice overlay, and the completed arena deck can start instead of staying attached to an older `Power.log`. The parser keeps the current `OnChoicesAndContents` block around the latest `SetDraftMode`, so restart/reopen restores the Arena hero and drafted deck instead of resetting to zero.

Recent macOS clients can omit the three currently offered Arena cards from every log. While the draft is waiting for a choice and no logged candidates are available, the Electron main process first captures a named Hearthstone window after macOS screen-recording permission is granted. Full-screen Hearthstone can be absent from the macOS window-source list; only while Hearthstone is independently confirmed as the frontmost app, the process may fall back to the cursor's target display. No unrelated display is selected. The short-lived local image is passed to the bundled `arena-ocr` helper, deleted immediately after recognition, and never sent over the network. Apple Vision reads text locally, and the service accepts only exactly three uniquely matched names from the local card database. Normal single-instance startup removes every abandoned `hearthstone-screen-*` directory from the previous process; runtime cleanup retains a ten-minute safety threshold and never touches unrelated temporary files. This Arena fallback does not infer a card when recognition is incomplete.

Main-process diagnostics are written to the same logs directory opened from Settings. The active JSON-lines log is capped at 2 MiB and keeps one rotated backup, so startup, capture, crash, and graceful-shutdown evidence remains persistent without unbounded disk growth.

The same local recognizer is also used on Standard/Wild deck-select screens before a constructed game starts. It only activates a collection deck when the screen contains a constructed mode title and the selected deck name maps to exactly one stored deck after mode filtering. This keeps a completed Arena deck from staying on the overlay when the player returns to Standard or Wild deck selection.
Constructed deck-select recognition is allowed to run whenever the tracker is not inside an active game. A verified Standard/Wild screen deck immediately resets the Arena state and previews the constructed collection deck, so leaving Arena or switching between constructed decks on the deck-select screen does not require a fresh `Power.log` write before the overlay switches.

Some CN client matches stop writing `Power.log` before emitting `PLAYSTATE` or `FINAL_GAMEOVER`. While a constructed game is still marked active, the service therefore keeps checking for the constructed deck-select screen. Two consecutive confirmations end the stale match, clear all old match zones and events, and preview the selected collection deck. A single observation is ignored, and an active Arena match remains excluded from this fallback.

`AutomaticOverlayController` polls the tracker state and the macOS frontmost application every 350 ms. A confirmed Standard/Wild deck, any active constructed game, a confirmed constructed screen waiting for an exact deck, or any active Arena state creates and shows the tracker overlay with `showInactive()`. Leaving Hearthstone releases the renderer window, and returning rebuilds it from the saved bounds without taking focus. Moving or resizing the overlay keeps it visible through brief focus changes. Manual close suppresses only the current deck/mode context; a real deck or Standard/Wild/Arena change clears that suppression. The main-window toggle reuses a live window or creates one from the saved state. Waiting for an exact constructed deck publishes `constructedScreenMode` and clears stale deck statistics and event rows instead of retaining the previous deck.

The main process separately watches the number of active opponent-secret slots. Every increase, including `0→1` and `1→2`, displays the existing opponent overlay with `showInactive()`; candidate updates, reveals, and removals do not reopen it. Automatic display never focuses the overlay or steals input from Hearthstone. A manual user toggle still opens and focuses the window normally.

The opponent window is retained when its close control is used. It stores the expanded bounds under Electron `userData`, folds to a `52×38` draggable entry, and restores the saved bounds on the next manual toggle. Secret updates may show the folded entry inactive but never expand it automatically. The main process is the single source of truth for folded state: only the opponent window may call the set-state IPC, every fold/restore publishes `tracker:opponent-overlay-collapsed:update`, and the main-window toggle uses the same controller so the renderer cannot get out of sync.

Board-attack totals remain in tracker state. New users start with both board-attack overlay switches disabled; the monitor starts only after the user explicitly enables either switch. Friendly attack, opponent attack, and secret windows persist separate display-relative positions under Electron `userData`; monitor refreshes do not overwrite an active drag, and restored bounds are clamped into the current Hearthstone display work area with an 8-pixel edge inset. The secret window stores collapsed intent in the same validated atomic state file, uses a real `44×44` BrowserWindow while collapsed, and preserves its top-left anchor across resize. Preload exposes drag IPC only to the three sender-scoped movable routes; main-process sender mapping and finite coordinates are revalidated for every gesture. Mouse input remains ignored by default and is enabled only while the renderer is over an authorized question, secret title, or attack control. `QA_OPEN_BOARD_ATTACK_OVERLAY=1` still opens the deterministic full-display layer for automated rendering acceptance.

Board attack is the total attack shown by heroes and minions in `PLAY`. Weapons are excluded because their attack is already reflected on the hero; locations and other non-combat entities are also excluded. Card type comes from live `CARDTYPE` tags when available, with the local card database as a fallback.

Current-match counters come only from public `FATIGUE`, `CORPSES`, and `NUM_SPELLS_PLAYED_THIS_GAME` tag changes whose player can be tied to a confirmed `PlayerID`; fatigue is exposed as the next damage amount. Missing ownership evidence leaves the value absent. Opponent hand size is the count of observed hand entities, while `opponentHand` contains only cards actually revealed by the log. The remaining hand slots stay anonymous and no hidden identity is inferred.

An opponent card that was already public remains public when it returns to hand. Ordinary returns retain the same entity identity. Effects such as `Kidnap` can instead store the public entity behind an attached enchantment and create a new hidden hand entity when the container dies. The tracker transfers the known card only when the log provides one unique attached stored-entity link and the trigger creates one unique hidden hand candidate for the same controller. Missing links or multiple possible hand candidates remain anonymous.

An active `Arena.log` draft is authoritative: constructed OCR is paused for the whole drafting state, so a delayed frame from the previous Standard/Wild screen cannot reset Arena progress. If constructed OCR later fails or screen-recording permission is removed, the service clears only a non-game constructed preview, keeps the last confirmed constructed mode as a waiting context, and publishes the recognition error instead of showing stale cards. The automatic overlay controller re-reads tracker state after every asynchronous foreground/window operation so an older refresh cannot reopen a newly closed context.

At the start of a current-format Arena draft, repeated legendary `Client chooses` lines are team previews rather than separate picks. The engine keeps the last preview as the selected team core, accounts for its three bundled cards temporarily, and preserves the three visible choice metrics until the first ordinary pick confirms the team. During Underground redraft, the retained snapshot is applied before every subsequent replacement choice, and reaching 30 candidates does not end the redraft early. A 31-card editable pool is kept as ambiguous evidence rather than guessing which card was removed.

`ArenaState.deck` contains confirmed cards only; `unresolvedCount` carries the missing amount. Once `Decks.log` emits a same-session `Starting Arena Game With Deck`, the exact 30-card deck string replaces the incomplete state. While that Arena deck remains active, a later same-ID `Finished Editing Deck` snapshot also replaces the displayed list immediately; an explicit `Finding Game With Deck` selection still has priority when returning to constructed play. If that exact deck arrives while Arena is still `REDRAFTING`, it is held against the current primary/redraft IDs and applied as soon as `ACTIVE_DRAFT_DECK` arrives. If the live Arena `CREATE_GAME` reaches `Power.log` before that completion line, its current-game text is also held and replayed immediately after the exact deck is activated, so the state cannot remain stuck at waiting. On cold start, the completed Arena deck is loaded into the tracker before the current `Power.log` game is replayed, preserving opening-hand deductions. The service rejects different IDs and stale pre-redraft files, serializes Arena/Decks updates, and watches the expected `Decks.log` even when it does not exist at startup. Watcher startup waits for readiness and reconciles the file once, covering a Decks log created during startup. Arena reads keep a file-identity and prefix fingerprint so a truncate-and-fast-rewrite at or above the old byte length resets and replays into a fresh state instead of mixing old picks into the new file. An unresolved Arena row follows unknown draws and shuffles by entity ID without consuming the separate generated-card pool.

Cold-start freshness still uses the observable Arena/Decks file times. A manually touched old Decks file can therefore defeat that conservative guard; the implementation does not impose a candidate-subset rule because Underground mode legitimately allows the final deck to remove replacement candidates during re-editing.

The main overlay bounds are stored as `overlay-window-bounds.json` under Electron `userData`. Saved bounds are validated against current display work areas before window creation; the default remains `100x900`, the supported minimum is `100x200`, and off-screen coordinates are clamped back into a visible display. Existing valid heights are preserved. Displays shorter than `900px` use their available work-area height instead.

The main process captures the largest available Hearthstone window and fails closed when no such window exists, then applies the same strict local-database validation. Screen capture belongs to the signed main application, while `arena-ocr` only performs local text recognition and never requests permission itself. Both automatic capture entry points preflight `getMediaAccessStatus("screen")` before any `desktopCapturer` call. Non-granted status returns immediately and never opens System Settings; only the main-window permission page can issue one explicit first request or open the fixed Screen Recording settings page. Transient capture failures still retry without being mislabeled as missing permission.

The bundled `frontmost-app` helper uses `NSWorkspace` to read the current frontmost macOS application. Arena OCR and the three-choice overlay only run when that helper reports `Hearthstone`; switching to ChatGPT or any other app hides the overlay and pauses visual recognition. This avoids Apple Events/System Events automation prompts.

Some Arena sessions write the saved draft contents (`DraftManager.OnChoicesAndContents` and `Draft deck contains card`) before the following mode marker. That marker can be `DRAFTING` during an active draft, `ACTIVE_DRAFT_DECK` after completion, or `REDRAFTING` while five replacement cards are being selected. The draft engine restores the retained cards, keeps the remaining slots visible, and re-enables local screen recognition and the three-card quality overlay during `REDRAFTING`. Two consecutive frames showing an exact constructed mode and selected deck are required before leaving this Arena state, preventing one stale frame from clearing a real draft while still allowing Standard/Wild to take over promptly.

The local card database resolves card IDs to Chinese names. The Arena rating cache stores the Arena Tracker HearthArena JSON table, HearthArena official zh-cn/zh-tw tierlist pages, and Firestone global Arena/Underground statistics under Electron `userData`; a fresh cache is used without a network request, and a stale or legacy cache checks upstream versions before downloading changed sources. HearthArena official pages are parsed as score sources only, using the card ID in `data-card-image` and the adjacent score cell, then preferred over the GitHub JSON table when available. They are never treated as winrate data. Rating lookup always prefers an exact card ID; when a current `CORE_` card has no row, it also checks the corresponding base card ID so reprinted cards do not lose an existing real score. Firestone's `decksWithCardThenWin / decksWithCard` is stored as included winrate, while `playedThenWin / played` is stored as played winrate. Firestone draft stats are cached by win bucket: `0` is overall pick rate, `6` is the preferred high-win bucket, and the raw buckets are preserved. If Firestone later publishes a real `12` bucket, it is stored as `twelveWinRate`; current public Underground data exposes `0/4/6/8`, so no 12-win value is synthesized. Arena hero skins keep the base `HERO_01` through `HERO_11` prefix (for example `HERO_04bh`), so the engine normalizes that prefix before selecting the class-specific rating table. Once the current Arena hero class is known, only that class overview and card-stat table are loaded and cached for 12 hours. Multiple overview rows for one class are summed before its baseline is calculated; concurrent class loads merge into the latest table instead of overwriting each other, and a failed stale refresh stays stale so a later call retries. Deck impact follows Firestone exactly: `100 * (decksWithCardThenWin / decksWithCard - totalsWins / totalGames)`; missing or invalid samples stay absent instead of being estimated. Each HearthArena score is mapped to a readable quality tier (`顶级`, `优秀`, `良好`, `一般`, `偏弱`, `不推荐`) for the renderer. If a source does not publish a pick rate but has a real Firestone win rate, the overlay labels it `胜率`; ordinary Firestone winrates are never relabeled as 12-win rates. Only a confirmed 30-card Arena deck is presented as exact; an incomplete deck remains trackable with explicit unresolved metadata until the authoritative deck string arrives.

Firestone's full zhCN no-audio card database is fetched from `static.zerotoheroes.com`, with `static.firestoneapp.com` as the mirror, and cached atomically as `hearthstone-cards.foreign-supplement.json`. It fills missing `cardId`, type, rarity, class, mechanics, and artwork fields while Blizzard's China card browser remains authoritative for Chinese names and text. An existing local mapping always wins over a foreign replacement; an upstream outage falls back to the last validated supplement and never blocks the official database.

Arena screen choices are split into fixed left, middle and right title lanes before card matching, so card rules text cannot become a fourth candidate. Exact matching uses the same punctuation-insensitive OCR normalization as fuzzy matching. A unique one-character correction is allowed for three-character names, while ambiguous matches still fail closed. Hero skins and internal non-playable records are excluded; when several playable card IDs share one display name, the rated collectible/base card is preferred. Two reliable lane matches may be published as a partial result with their original slot numbers, and recognition continues until all three lanes are complete; a complete result is never downgraded by a later partial frame.

Expired Arena base and class caches are returned immediately while one deduplicated refresh runs in the background. Network calls use a five-second timeout and one short retry, so slow or failed upstream services cannot create a 20–40 second blank statistics window. Background base/class refreshes preserve the newest merged class tables, and partial-source warnings remain visible until a later clean refresh. In the renderer, a transient update may fill missing metrics only from the same Arena hero and exact card ID; changing hero, changing card, or lacking a card ID never inherits old statistics.

Constructed-deck tracking is gated by `CREATE_GAME`. The selected collection preview is carried into the live game instead of being cleared by the first `CREATE_GAME`; same-timestamp duplicate `CREATE_GAME` blocks are treated as one start so player identity immediately before the duplicate block is retained. The preferred local-player source is `Player.log`; otherwise the current `Power.log` game must contain an explicit local marker/name such as `Local` or `本地玩家`, or exactly one named player paired with an `UNKNOWN HUMAN PLAYER` opponent. An ordinary account name without that opponent evidence is never enough on its own. Player slots can swap between games, so current-game evidence resets on a new timestamp. Controller-sensitive zone events remain pending until identity is explicit. Friendly draw/play observations are scored against every stored collection deck; the engine waits for a confident match before activating a deck, so collection browsing and opponent draws cannot select a deck. Constructed screen recognition first uses the exact deck name, then strips only the known `备阵` display prefix when Hearthstone adds it to the selected deck label.

Global effects are accepted from two conservative sources: explicit `START_OF_GAME_KEYWORD` trigger blocks on the start-of-game list, and `BLOCK_START BlockType=PLAY` records on a separate persistent-play list. Ordinary board auras and unknown cards are not inferred. Confirmed controller ownership keeps friendly effects in `globalEffects` and opponent effects in `opponentGlobalEffects`; unknown ownership is omitted. Both lists are cleared on a real new game or game end, while a same-timestamp duplicate start leaves them intact. Deathrattle and enchantment effects are intentionally excluded until the log supplies a reliable activation and ownership signal; merely seeing such a card or enchantment does not prove that its match-wide effect took effect. The sanitized regression fixture under `fixtures/logs/constructed-duplicate-create` preserves the observed duplicate-start and `JAIL_397` trigger shape without retaining account identity.

Friendly `BLOCK_START BlockType=PLAY` spell actions also build the current-match history used by Galactic Projection Orb (`TOY_378`). The engine deduplicates the GameState/PowerTaskList copies by entity id, permits the same entity again after it returns to hand, excludes opponent actions, and clears the history at game boundaries. Arena Power logs follow the same engine replay path as constructed games, so a cold-started tracker restores the current hand, spell history, and the hidden opponent deck entities needed for the real remaining-deck total.

The first concrete `STEP=MAIN_READY` or `STEP=MAIN_ACTION` freezes each controller's post-mulligan hand entity ids for `TIME_706` (`超时空鳍侠`). Earlier `NEXT_STEP` predictions do not freeze the snapshot because mirrored PowerTaskList lines may still contain mulligan replacements. Card identities resolve lazily from the retained entities, duplicates remain distinct, Coin variants are excluded, repeated later step lines cannot overwrite the snapshot, and game boundaries clear it. Only friendly card details publish this private opening-hand list.

`TAG_SCRIPT_DATA_NUM_1` has more than one meaning. The parser keeps its existing entity-link event and also publishes the numeric script-data event. For `REV_514` and `CORE_REV_514`, `TrackerEngine` records that number by controller as the current resurrection count, resolves abbreviated updates through the already known entity, accepts inline `TAG_CHANGE` plus `FULL_ENTITY` / `SHOW_ENTITY` continuation forms, overwrites duplicate GameState/PowerTaskList copies, and clears the value at game boundaries. Before that tag is available, the matching side's deduplicated `REV_845` / `CORE_REV_845` death history is a reliable fallback; an observed tag, including zero, always takes precedence.

Friendly minions moving from `PLAY` to `GRAVEYARD` build a separate ordered death history for live card details. Duplicate GameState/PowerTaskList records for one entity count once, opponent deaths stay separate, and a resurrected copy can become the newest death later. Dynamic resurrection details filter this history by the card text; for `TOY_886` (`决胜时刻`), the current target is the last friendly Demon death. Official card-cache `minion_type_id` values are normalized into race names during parsing, so existing caches do not need a refresh before tribe filters work. The history clears at real game boundaries.

Tracker display settings live in `tracker-settings.json` under Electron `userData`. Missing, corrupt, or invalid files use enabled defaults for both ladder and Arena without overwriting the bad file. Replacements validate the complete shape and write atomically; write failures remain visible to the caller. Only trusted windows can call the settings IPC. The main window can read and replace settings, while tracker overlays can only request that the main settings page be opened. A successful replacement refreshes both automatic overlay controllers immediately.

Before activating a heuristic deck match, the service counts the local deck entities in the current Power.log setup snapshot. A guessed collection deck with a different base total is rejected as stale or incompatible. A deck explicitly written by Hearthstone as `Finding Game With Deck` is trusted for identity even when the local deck code decodes fewer cards than the live 30-card snapshot; the missing portion is shown as `日志缺失的收藏牌`. Some modes add cards into the deck during setup; those entities carry a `DISPLAYED_CREATOR` marker, so they are excluded from guessed-deck comparison but retained in the live total and remaining counts as `对局生成的未知牌`. When there is no explicit or matching base deck, it preserves the real counts under `等待精确识别` rather than presenting a false named deck.

If `Player.log` reports `SERVER_GAME_STARTED` while `Power.log` is stalled, the service enters an active waiting state and publishes an explicit recovery message. This keeps the overlay visible without inventing deck or card data; live tracking resumes only when `Power.log` writes again.

When switching from a constructed screen into Arena, a confirmed Arena draft or active Arena deck replaces the constructed preview. A collection deck found during startup cannot overwrite an active Arena state; a later explicit `Finding Game With Deck` event can still switch back to constructed mode.

## Deck string decoding

`parseDeckStringToCards(deckCode, cardDb)` delegates Hearthstone deck string decoding to the existing `deckstrings` package, then maps card dbfIds through the supplied local card database.

Supported card groups:

- one-copy cards
- two-copy cards
- multi-copy cards with explicit counts

The decoder itself does not fetch card data. Missing dbfIds are returned as `Unknown card <dbfId>` with warnings so callers can keep the deck import flow usable while surfacing incomplete local data.

## Match state

The state model tracks:

- friendly deck remaining
- friendly drawn cards
- opponent played cards
- parsed players
- event stream

Draw detection currently uses a `ZONE` change from `DECK` to `HAND` for the friendly player. Opponent played cards currently use `ZONE` changes to `PLAY`, with card names resolved by `cardId` when possible.

## Match history

Completed matches are stored in `match-history.json` under Electron `userData`. A result is accepted only from a `PLAYSTATE` line whose entity controller matches the confirmed local-player controller: `WON` is a win, `LOST` or `CONCEDED` is a loss, and `TIED` is a tie. An explicit `Player.log` local marker has priority. Without it, `Power.log` must expose an explicit local marker/name; one or more ordinary real names remain unconfirmed. Opponent results, ambiguous/unknown controllers, and `FINAL_GAMEOVER` alone never create records.

Each record keeps a stable replay-safe id, result, Standard/Wild/Arena/unknown mode, the last known deck name, and end time. The matching result line supplies the time-of-day and `Power.log` mtime supplies the date; crossing midnight moves a late-night result to the preceding day, while an unsafe/missing line timestamp conservatively falls back to mtime. Replaying an existing id is a complete no-op, preserving the original record and order. The store sorts by `endedAt` descending before retaining the true newest 100 records and reports corrupt-file or unresolved write failures explicitly through the main-window-only `tracker:get-match-history` IPC method. The first Electron `before-quit` event is blocked while cleanup finishes. Tracker disposal closes watcher and timer sources, waits for any in-flight local screen recognition to delete its temporary image, drains queued log reads, performs one final incremental read of the active `Power.log`, waits for resulting history writes, and only then clears monitoring state. QA screenshot runs use the same normal quit path. One final `app.quit()` is then allowed through. Cleanup failure is reported and still releases the application instead of hanging permanently. The outer release-verification script also tracks the exact QA PID and reaps it on success, failure, or shell interruption; it never uses a name-wide kill that could terminate the user's normal tracker instance.

Main-process diagnostics are appended as structured lines to `hearthstone-tracker.log` under Electron's `logs` directory. The settings action that opens the log folder therefore exposes real startup, capture, crash, and shutdown evidence rather than an empty directory.

## Current risks

- Hearthstone log formats vary across game versions and languages; parser coverage should grow with real logs.
- Deck string decoding depends on the cached/downloaded HearthstoneJSON card database matching current card dbfIds.
- Friendly player detection prefers `Player.log` local-player markers, then the named local player in the complete `Power.log` header. If neither source is present, matching waits rather than guessing a controller.

## 2026-07-22 desktop settings integration

Desktop settings now use one validated, migrated, atomically written store under Electron `userData`. General, overlay, appearance, retention, update, and diagnostic preferences are exposed through preload IPC and applied by the main process. This includes login-item intent, start-minimized behavior, tray/minimize handling, overlay visibility/position/opacity, card-data refresh cadence, match-history retention, log-folder opening, and restoring defaults. Permission status and permission requests use separate main-window-only IPC; overlay preload capabilities cannot access them. Invalid settings payloads are rejected rather than partially applied.

Unsigned development builds can be denied permission when changing the macOS login item. The UI reports that failure; final signed-package QA must confirm the operating-system permission path.

## Window lifecycle contract

New settings default `general.startMinimized` to `false`, so a normal first launch shows the main window. Only a persisted opt-in to start minimized hides it. `general.focusOnOpen` controls one-time activation on the initial launch, Dock activation, second-instance launch, and tray actions: disabled uses inactive showing without `app.focus()` or `window.focus()`, while enabled brings the window forward once. Neither path makes the main window always-on-top, so another application can cover it normally.

Automatic foreground and tracker-context controllers own friendly and opponent overlay visibility only while `general.gameDetection` is `automatic`. In `manual` mode, a friendly or opponent window opened by the user survives Hearthstone losing focus, tracker status changes, and background refreshes. The global overlay switch and the corresponding friendly/opponent switch remain authoritative in both modes and immediately close the affected expanded window or folded opponent entry.

Friendly-close suppression is scoped to the current automatically detected deck/mode context. The opponent close control folds the window to `52×38`; secret updates and automatic foreground recovery may show that entry inactive, but never call expand. Only the folded entry or main-window opponent control expands it. Closing the Arena hero ranking suppresses it for the current Arena session, while leaving Arena clears that suppression.

First-run placement is left-two/right-one: the Arena hero ranking is at the left edge, the opponent tracker is 24 pixels to its right, and the friendly tracker is at the right edge. A legacy opponent tracker saved flush against a display's left edge is migrated once beside the new hero ranking to avoid overlap. Friendly, opponent, and Arena hero windows persist bounds independently. Overlay position and offset settings anchor only the friendly tracker. Bounds restoration validates against every connected display, preserves a valid secondary-display placement instead of relocating to the cursor display, and clamps only off-screen or removed-display coordinates into a current work area. Opponent move/resize interaction has a grace period, and pending bounds writes are flushed before explicit close, automatic hide, or application quit.

## Card lifecycle state

`TrackerEngine` owns the only mutable per-game card lifecycle records. Physical zones and action histories are published separately through required `cardTracking` state:

- current deck, hand, play, secret, graveyard, and removed zones come from current entities and deck rows;
- used and suspected-burn histories come only from logged actions, never by reinterpreting graveyard contents;
- a burn is inferred only from a deck-to-graveyard transition while ten countable cards occupy the friendly hand;
- random-spell captures bind to a concrete `usageId`; completed captures are deduplicated by usage, source, and ordered outcome-tree content;
- opponent secret slot count is independent from the number of candidates in each slot. Each slot keeps its own explicit `CLASS` evidence from the entity log and uses it ahead of the opponent hero class when rebuilding candidates; missing evidence falls back to the hero class. Match reset clears the fallback class so a new game cannot inherit the previous opponent.

Legacy shared fields remain for one compatibility version, but renderer state is validated with required `cardTracking` and no longer falls back to those fields.

## v0.3.0 log contracts

- `TURN`, `CURRENT_PLAYER`, `RESOURCES` and `RESOURCES_USED` feed one match-flow state.
- `DISPLAYED_CREATOR` binds inserted deck entities to the effect source; the public group count is computed from entities still in `DECK`.
- `ZONE_POSITION=1` marks a tracked insertion as top. A position equal to the current deck size marks bottom.
- `SHUFFLE_DECK PlayerID=n` invalidates that player's top/bottom records. It does not remove inserted entities, source groups, or known identities.
- Generated entities remain deduplicated by entity id across `GameState` and `PowerTaskList` copies.

## v0.3.11 runtime contracts

- Every BrowserWindow uses the same renderer-page resolver. A packaged build ignores `VITE_DEV_SERVER_URL`; an unpackaged build rejects non-local hosts, non-HTTP schemes, and URLs containing credentials.
- A tailed log range is committed only after its complete lines have been processed. Processing failures retain the previous offset and schedule a retry without requiring additional bytes. Renderer-send failures are isolated from log retries, and partial trailing bytes remain pending until a complete line arrives.

## v0.3.12 identity and deck evidence contracts

- A multi-line entity snapshot merges `ZONE` and `CONTROLLER` details before deciding whether the entity belongs to the friendly starting deck. Their line order must not change the result.
- While the friendly controller is unknown, controller-bearing zone changes stay pending. They replay in original order after friendly identity is confirmed; opponent ownership requires positive controller evidence.
- A more precise Arena deck received during an active match reconciles base deck rows in place. Matching prefers `cardId` and uses normalized names only when the match is unique; match activity, turns, entities, hand state, opponent records, and match statistics remain intact.
- Heuristic collection-deck matching requires at least two distinct friendly card observations and a unique best candidate or a strict score lead. Explicit Hearthstone deck selection remains immediate and does not use this threshold.

## v0.3.14 live Arena redraft contract

- Every `Client chooses` replacement is published to the tracker immediately; `ACTIVE_DRAFT_DECK` is not required for visibility.
- The provisional tracker deck uses the latest retained-card snapshot plus replacements that arrived after that snapshot. It never uses the 31–35 card evidence pool as a playable deck.
- A provisional deck below 30 cards is padded only with an explicit `待确认重选牌` unresolved row. If the retained snapshot is ambiguous or exceeds 30 with pending choices, only directly observed replacements are trusted and the rest stay unresolved.
- A matching exact 30-card deck replaces the provisional deck. Old, mismatched, incomplete, or delayed exact snapshots cannot overwrite a newer redraft generation.

## 2026-08-22 竞技场、收藏与对手手牌契约

- `PublicTrackerState.opponentHand` 向后兼容旧区域行，同时允许发布按实体去重的抽取回合、揭示牌名、创建、锻造和增益信息。新对局清空实时手牌；长期竞技场和收藏档案不受影响。
- `turnTimer` 只发布日志能够确认的回合与行动方。没有可靠完整时间戳时不发布 `startedAt`，renderer 不倒计时。
- `ArenaInsightsService` 使用 `arena-runs.json` 原子保存轮次。活跃竞技场首次出现即建档，牌组签名变化时幂等刷新 1→30 和地下竞技场 31→35→30 过程；已有胜负不能被牌组刷新清除。真实本方比赛结果累积胜负，只有明确 `NO_ACTIVE_DRAFT` 证据封档。
- 本机日志不能完整证明换前、保留和换后状态时，自动档案写入空留牌样本。结构化导入只有通过完整 schema 后才参与留牌统计。
- `CollectionInsightsService` 使用 `collection-insights.json` 原子保存卡牌、开包和装饰品。并发竞技场结果和并发开包都经过串行 mutation，不能由 read-modify-write 竞争覆盖。

## 2026-08-24 启动对局状态恢复契约

- `Player.log` 的文件更新时间只能证明文件后来仍有写入，不能证明其中历史 `SERVER_GAME_STARTED` 属于 Power.log 之后的新对局。
- 启动回放已有 `Power.log` 时同时读取最新 `LoadingScreen.log` 模式。已知模式不是 `GAMEPLAY` 时，禁止用历史 Player 开局事件把已结束状态重新激活；缺少 LoadingScreen 的旧客户端继续保留原 Power 停写补救。
- 场攻主进程和专用 renderer 双重 fail-closed：`gameActive !== true` 时既不创建窗口，也不渲染场攻数字；QA 明确演示路由除外。
- 手动开包来源固定为 `manual`。导入快照不信任外部保底字段；保底按已确认开包重新计算，史诗 10 包、传说 40 包，并强制标记 `partial`。
- 竞技场与收藏 IPC 只允许主工作台读取和写入；辅助悬浮窗 preload 不暴露导入、导出、奖励、开包或装饰品写入口。所有输入在写盘前做严格 schema 校验，失败保留最后有效数据。

## 2026-08-24 竞技场跨局与地下重选契约

- 同一竞技场轮次已经由 `Decks.log` 确认 30 张牌后，局间重复的同牌组简略 `Arena.log` 快照只能刷新英雄和时间，不能降级或清空完整牌库。
- 活跃竞技场期间，构筑画面识别必须同时确认模式和唯一套牌；只有“标准/狂野”文字、识别失败或权限失败都不能销毁竞技场状态。
- 炉石窗口截图必须在有限时间内结束。超时按可恢复失败处理，并释放当前识别占用，让下一轮 450ms 监控继续尝试。
- 地下竞技场从 `REDRAFTING` 进入选完新牌后的 `ACTIVE_DRAFT_DECK` 时，`awaitingExactDeck`、5 张新牌和 30–35 张候选池继续保留；最终精确 30 张牌到达后再收口。
