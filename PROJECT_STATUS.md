# Storm — Project Status

_Last updated: 2026-08-18_

## What it is
An offline-first PWA for playing walk-up songs at Storm baseball games. Installed to the iPhone home screen via GitHub Pages (`github.com/jasonackerman1/storm`); works with no signal at the field once installed and opened once with internet.

## Architecture
- Static site: `index.html`, `css/style.css`, `js/app.js`, `sw.js` (service worker), `manifest.json`, `icons/`, `fonts/`
- Roster data: `roster.json` (bundled/committed songs, shipped with the app) + IndexedDB (`storm-db`, store `players`) for songs added directly from the phone via **Manage Team**
- Slot assignments: localStorage key `storm-slots-v2`, keyed by slot id (not array index): `sp1`/`sp2`/`sp3` (Walkout 1, Walkout 2, Victory) + `l1`–`l15` (`LINEUP_COUNT`, currently 15 — only 13 are filled by default, `l14`/`l15` are headroom). Defined in `SLOT_DEFS` in `js/app.js`. Grid is 3 columns × 6 rows.

## Build history
1. **`c1b72d5`** — Initial build: 12-button lineup grid, tap-to-play/tap-to-switch playback, per-slot reassign (pencil icon), Manage Team screen (add players + MP3 from phone → IndexedDB), bundled-roster path (`roster.json` + `mp3/`), Clear Lineup, offline-first PWA shell.
2. **`8efe520`** (2026-07-25) — Added a top row above the 12 lineup slots: 2 Walkout slots + 1 Victory slot for team-level songs. Refactored slots to keyed-by-id. Clear Lineup now only resets the 12 batting slots. Jersey # optional. Sizing adjusted for 5 rows.
3. **`21f406d`** (2026-07-25) — Added Owen Ackerman (#7) as the first real roster entry, plus `.gitignore` for `.DS_Store`.
4. **`cffbe41`** (2026-07-25) — Added this `PROJECT_STATUS.md`.
5. **`b52350b`** (2026-07-25) — Fixed a stale service-worker cache bug + first branding pass (colors, Anton font, hand-drawn cyclone icon — icon later superseded, see below).
6. **`d58a10d`** (2026-07-25) — Swapped the cyclone icon for a lightning bolt. Redesigned slot cards: dropped pencil icon + corner "#N" tag once filled, moved reassignment to press-and-hold, filled cards show LASTNAME over a bigger number.
7. **`2862418`** (2026-07-25) — Tap-to-stop-and-reset playback: tapping the currently-playing slot again stops the song and rewinds to 0:00.
8. **`a845f34`** (2026-07-25) — Added "Let's Go" (Trick Daddy) as a team song for Walkout 2, initially cut to 10s + fade — **reverted, see commit 9.**
9. **`5d292bb`** (2026-07-25) — Restored "Let's Go" to full length; team-level songs don't get trimmed (see content workflow rule below).
10. **`6e5c323`** (2026-07-25) — Added Screen Wake Lock so iOS doesn't auto-lock the screen while the app is open. Re-requested whenever the app returns to foreground. Fails silently below iOS 16.4.
11. **`3a83a52`** (2026-07-25) — Added "A Storm is Coming" as a team song for Walkout 1, full length (~4:56), untrimmed.
12. **`f45ef78`** (2026-07-25) — Moved the lightning bolt into the header wordmark as the letter O ("ST[bolt]RM"), removed the red outline stroke (gold fill only). Regenerated app icons from the same updated SVG.
13. **`98ec0c4`** (2026-07-25) — Fixed lingering red-stroke complaint (stale service-worker cache, not a code bug) and tightened bolt spacing in the wordmark. `CACHE_NAME` → v4.
14. **`9f752da`** (2026-07-25) — Jason provided a clean isolated `tornado.png`; replaced the lightning bolt with it as the header O and regenerated the app icon set. Removed `lightning.svg`. `CACHE_NAME` → v5.
15. **`d651a0c`** (2026-07-25) — Jason provided the full official wordmark (`storm-wordmark.png`); replaced the hand-composited header markup with this single authentic image. App icon stays tornado-only (square). `CACHE_NAME` → v6.

### Session of 2026-08-02 — interaction overhaul, inspired by BallparkDJ (the other parent's app)
16. **`ad19ad4`** — Select-then-confirm playback: tap a slot to select it (glowing ring), a bottom action bar's full-width Play/Stop button actually fires/stops audio. Long-press a lineup slot (not Walkout/Victory) to drag-and-reorder it — true insert-with-bump, not a two-slot swap. Pencil/Edit button replaces the old press-and-hold-to-reassign gesture.
17. **`f21df89`** — First pass at distinct visual states (thicker selected ring, blue dragging ring) + attempted haptic vibration on drag pickup (no-op on iOS — no Vibration API there).
18. **`9ec6ccd`** — Real fix for `.selected` never actually rendering: it was declared before `.filled` in the stylesheet, so at equal CSS specificity `.filled` (declared later) silently won the tie for every property. Jason caught this live on his phone. Fixed by reordering the CSS and verifying with `getComputedStyle()`, not just a screenshot.
19. **`b37a4b7`** — Doubled the action bar height (56px → 112px) + built auto-advance-to-next-batter: when a song finishes on its own, selection jumps to the next filled lineup slot (skips empty, wraps #12→#1), unless the user already tapped ahead to a different slot.
20. **`c51fa8c`** — Added an ADV header toggle for whether manual Stop also advances (default off at this point).
21. **`86cadf7`** — Removed the Clear Lineup button — the team is moving to a permanently-populated roster where a full wipe never comes up.
22. **`1df79ee`** — Replaced the ADV header button with a real switch in a new "Settings" section atop the Manage Team screen. Default flipped to ON for new installs.

### Same-day continuation, 2026-08-02 evening — full roster loaded, real batting order baked in as default
23-33. Eleven commits, one per kid, each following the same routine: check `git status`/`ffprobe` on the new untracked file → back up to scratchpad as `{name}-ORIGINAL-FULL.mp3` → `ffmpeg` cut to 10s + 1s fade-out from the given timestamp → verify exactly 10.0s via `ffprobe` → add `roster.json` entry → bump `CACHE_NAME` → commit + push. In order: `8d4237c` Bobby Youmans #45 (start 40.0), `8291f03` Kayden Lyons #5 (10.0), `d746ba3` Jaxsen Rodriguez #99 (59.5), `c7ffb48` Dom Diaz #12 (14.5), `b09ca8c` Jake Harris #13 (0), `1fb7233` Kameren Maldonoldo #11 (43.7), `6f761c1` Caleb Gingras #68 (41.5), `43ba7b4` Ethan Ladanyi #29 (1:13), `8585b01` Liam Pichardo #2 (0), `1182b53` Sam Va Tassel #4 (9.7), `d281cac` Manson Frank #15 (19.7).
34. **`4440bfc`** — Bobby Youmans start time corrected 40.0 → 44.0, re-cut from the same preserved original.
35. **`d4b0eee`** — Manson Frank start time corrected 19.7 → 20.0, re-cut from the same preserved original.
36. **`444d4e2`** — Added "Swagger Like Us" as a Victory team song, full length. Verified a filename with literal spaces resolves fine for both playback and service-worker precache (browsers auto-encode the space).
37. **`48d6e45`** — **Baked in the real batting order as the actual default lineup** — see dedicated section below.
38. **`5743b52`** — Jason replaced the working `45-bobby-youmans.mp3` file, asked for a re-cut at 45.5. Byte-identical (via `md5`) to the already-preserved original — re-cut from that, no new backup needed.
39. **`4a6a6e8`** — Same for Sam Va Tassel at start 10.0 — except the replacement landed as `4-sam-va-tassel.mp3.mp3` (double extension) with the correctly-named original deleted (`git status` showed **D**, not **M**) — renamed back before proceeding. See file-replacement workflow below.
40. *(no commit)* — A second "replace and re-cut" request for Manson Frank at the same 0:20 start already in place produced a byte-identical file — `git status` showed no diff, nothing to commit.
41. **`27a81f5`** — Added two more Victory *options* (not assigned to the slot): "All I Do Is Win," "Bring Em Out," both full length.
42. **`f1d9c87`** — Added a third extra Victory option, "Black and Yellow," same treatment.

### File-replacement workflow (new pattern, 2026-08-02)
When Jason says "I replaced X's mp3, re-cut it starting at Y":
1. `git status --short mp3/` — if it shows **D** (deleted) with no matching untracked file, check `ls mp3/` for a doubled extension (e.g. `name.mp3.mp3`) and rename it back.
2. Compare `md5` of the current file against the scratchpad-preserved `{name}-ORIGINAL-FULL.mp3`. **Every replacement this session was byte-identical** — re-cut from the already-preserved original rather than re-backing-up, unless the hash actually differs.
3. Verify the fresh cut is exactly 10.0s via `ffprobe` before overwriting the repo file.
4. Check `git status` before assuming a commit is needed — an identical re-cut (same source + same timestamp) produces zero diff.

### Baked-in default lineup (`48d6e45`) — the big milestone
Implemented as a **versioned one-time migration** in `loadSlots()` (`js/app.js`), not just a fresh-install fallback: `DEFAULT_LINEUP_VERSION` (currently `1`) + a `DEFAULT_SLOTS` map, applied whenever the stored `storm-default-lineup-version` is behind the current version. This takes effect on **any** device on next load — including ones with leftover test data — without ever clobbering real customization made afterward. Verified via a simulated device with pre-existing junk and no version marker: migration applies once, stamps the version, a manual edit survives a later reload untouched. **To reset/replace the whole lineup again in the future** (e.g. next season), bump `DEFAULT_LINEUP_VERSION` and update `DEFAULT_SLOTS`.

Baked-in order: Walkout 1 = "A Storm is Coming," Walkout 2 = "Let's Go," Victory = "Swagger Like Us"; lineup #1–#12 = jersey #45, #5, #99, #12, #13, #11, #68, #7, #29, #4, #15, #2.

## Gap-analysis conversation (2026-07-25)
Jason asked directly what's missing / what to improve. Findings and his calls on each:
- **iOS Safari's `<audio>` element normally obeys the phone's silent switch** — flagged as the biggest "might silently just not work" risk. **Jason tested it: songs play fine even when the phone is silenced.** No fix needed.
- **Screen auto-lock mid-game** — real risk → fixed in commit 10.
- **No backup/second device** for the lineup/local songs — Jason explicitly doesn't want this built.
- **Loudness varies between clips** — Jason will address case-by-case if something stands out, not proactively normalize.
- **Default 10s cut always starts at 0:00** — intentional; Jason will dictate a custom start time/length per song when needed (already the one-off-edit workflow).

## Content workflow rule (corrected 2026-07-25 — don't re-ask)
- **Individual player walk-up songs** → cut to 10 seconds with a 1-second fade-out via `ffmpeg`, starting at 0:00 unless Jason specifies otherwise for that song.
- **Team-level songs** (Walkout/Victory when not tied to a specific player) → **left at full length, untouched.** No trim, no fade.
- Either way: add the entry to `roster.json`. Slot *assignment* (which slot gets which song) happens in the app itself via press-and-hold — it's phone-local storage, not settable from the repo.
- **MP3 filename convention:** player songs `{number}-{firstname}-{lastname}.mp3` (e.g. `7-owen-ackerman.mp3`); team songs a dash-separated slug (e.g. `trick-daddy-lets-go.mp3`).
- **Tooling:** `ffmpeg` installed via Homebrew (2026-07-25).

## ⚠️ Incident (2026-07-25): don't overwrite user-provided source files
When first cutting "Let's Go" to 10s, the original full-length MP3 was renamed then overwritten in place by the `ffmpeg` output (`mv cut.mp3 original-name.mp3`) — only the cut version was ever committed. When it turned out team songs shouldn't be trimmed at all, the original was gone: not on disk, not in git, not in `/tmp` or Trash. Jason had to re-source the file himself.

**Rule going forward:** when processing any user-provided source file with a destructive step (trim/convert/compress/overwrite), write output to a new filename and never delete/overwrite the original unless the user explicitly confirms it's no longer needed. See global memory `dont-overwrite-source-files.md` — this applies beyond Storm too.

## Service worker cache bug (fixed 2026-07-25, `b52350b`)
`sw.js` was cache-first for every request, including `roster.json` — once the empty roster got cached, it stayed stale through every subsequent deploy. Fixed: shell files + `roster.json` (`NETWORK_FIRST_FILES` in `sw.js`) now go network-first with cache-fallback; mp3s/icons stay cache-first for offline playback reliability. `CACHE_NAME` bumped to `storm-cache-v3`.

**When touching `sw.js` again:** any file that must reflect a new deploy immediately belongs in `NETWORK_FIRST_FILES`, and bump `CACHE_NAME` whenever the precache file list changes.

## Branding (current, as of `d651a0c`)
Colors sampled directly from `storm_logo.jpg` (768×170px source): black `#000000`, red `#D00018`, gold `#F8B000` — the `:root` variables in `css/style.css`.
- **Font:** Anton, bundled locally as `fonts/Anton-Regular.woff2` so it works fully offline.
- **Header logo — 4 iterations:** hand-drawn cyclone SVG (rejected, "terrible") → lightning bolt recolor of the original placeholder icon (kept a while) → bolt moved inside the wordmark as the O + red stroke removed → **replaced entirely** once Jason supplied real assets. Current: `icons/storm-wordmark.png` (the actual official logo, transparent bg, Jason-provided) used directly as a single `<img>` in the header. `icons/tornado.png` (also Jason-provided, isolated tornado) is the source for the app icon set — kept as a separate square asset since the wordmark's wide aspect ratio doesn't fit an app icon.
- **Lesson:** every hand-built/approximated icon got superseded the moment Jason supplied real source art. Prefer real assets over hand-drawn approximations whenever they're available, even after investing effort tuning the hand-built version.
- **Slot cards:** look like the back of a baseball jersey. Once a lineup slot is filled: no pencil icon, no corner "#N" tag — just LASTNAME over a bigger number. Team-song slots (Walkout/Victory) keep their corner tag.
- Verified with a temporary headless-Chrome + puppeteer-core script (removed after each verification, not committed).

## Interaction model — REPLACED 2026-08-02, old tap-to-play model is gone
- **Tap any filled slot → selects it** (thick glowing gold ring + warm background). Nothing plays until you confirm — a deliberate mis-tap safety step.
- **Bottom action bar (112px tall):** pencil/Edit button (opens the assign sheet for the selected slot) + full-width Play/Stop button that actually fires/stops audio for the selected slot.
- Tapping a different slot while one plays only changes the selection — it never touches the already-playing audio.
- **Long-press (~500ms) a filled lineup slot (the 12 numbered ones only, not Walkout/Victory) → drag-to-reorder.** True insert-with-bump (move #1 to the #5 spot shifts 2-5 back by one). Shows a glowing blue ring while dragging.
- **Auto-advance:** a song finishing on its own moves the selection to the next filled lineup slot (skips empty, wraps #12→#1) — unless the user already tapped ahead to something else.
- **Advance on Stop switch** (gear icon → Manage Team → new "Settings" section above the roster): controls whether a *manual* Stop also advances. Defaults ON for new installs. Built as a switch specifically because Jason wasn't sure which behavior is right without live-game testing.
- **Clear Lineup button — REMOVED.** The team's moving to a permanently-populated roster; a full wipe never comes up in practice.

## CSS cascade-order lesson (bit twice this session — 2026-08-02)
`.selected`, `.dragging`, `.playing`, `.filled` all have equal CSS specificity (two classes each). When a rule is declared *later* in the stylesheet, it wins any tie for properties both rules set — no partial merging. Both `.dragging` (vs. `.playing`) and `.selected` (vs. `.filled`) were originally declared too early and silently lost that tie, so the "more special" state rendered as if it were the plain one. Jason caught the `.selected` case live on his phone. **Going forward: any new state class that can stack with an existing one must be declared after it in the file, and verify with `getComputedStyle()` — not just a screenshot — that it actually took effect.**

## Manage Team sheet rendering above the status bar (2026-08-02 late evening, `eb44799` + `dc1b2f9`)
Jason reported the Manage Team full-screen sheet's header/close-X rendering underneath the iPhone status bar, completely unreachable — only fix was force-quitting. Two-stage response:
1. First attempt: hypothesized iOS Safari's `100vh` (measures a taller "maximum possible" viewport than what's visible) was pushing the sheet's top edge above-screen. Added `100dvh` after the `vh` fallback.
2. **Jason reported zero change**, even after a hard restart. This surfaced two things: (a) a phone restart does **not** clear a PWA's site data/service worker cache — so it's unclear the fix had even reached the device; (b) a real gap in `sw.js` — the "network-first" fetch never forced `{ cache: 'no-store' }`, so it could be silently served from the browser's own HTTP cache instead of a real network hit, quietly defeating "network-first." Fixed by fetching `event.request.url` with an explicit no-store mode.
3. **Per Jason's own suggested fix**, also added a hard floor: `.sheet-full`'s `padding-top` is now `max(calc(env(safe-area-inset-top) + 16px), 100px)` — guarantees 100px of clearance regardless of whether the safe-area calc is behaving correctly. Roster list below is a flex/scroll region, shrinks to make room.
- **Not yet confirmed live.** Given the caching confusion, the reliable way to test is deleting the home-screen icon and reinstalling fresh — not a restart, not just reopening.
- **Lesson:** a device restart ≠ clearing PWA cache. If a fix "didn't seem to work at all," check whether it actually reached the device before re-diagnosing.

## Audio quality pass (2026-08-02/03, `90b1adc`, `09dff91`, `a5cf761`)
- **Dead-air trim:** measured leading silence with `ffmpeg silencedetect` on the 8 songs that started at 0:00 or were left full-length — found real gaps from 0.25s up to 1.48s (on "A Storm is Coming," the live Walkout 1 song). Player clips got their cut shifted forward; team songs got just the leading silence clipped, full length otherwise (first exception to "team songs stay untouched," Jason approved). "Swagger Like Us" was already clean. Every result re-verified with a second silencedetect pass.
- **Refresh App Content button:** new Settings button that forces a real re-download of everything, even already-cached files — built so Jason has an easy way to confirm a fix landed instead of deleting/reinstalling the app. Safe by design (never deletes the cache bucket up front, only overwrites via a fresh SW install). Doesn't touch the lineup/settings. Also fixed the same missing-`cache:'no-store'` gap in two more `sw.js` spots (install precache, cache-first background refresh) found while building this.
- **Loudness normalization, all 18 songs:** measured `mean_volume` first — ranged wildly from -9.7dB to **-30.4dB** (Kameren Maldonoldo's track was a massive outlier). Applied real two-pass EBU R128 `loudnorm` (target -11 LUFS, -1.0 dBTP ceiling) to every file. Spread tightened to -11.3dB to -16.7dB. Kameren's track is still the quietest even after the biggest correction — its source has less headroom than the others, so the peak ceiling limits it; flagged to Jason rather than pushed further via heavier compression without asking. All originals backed up first.
- **Real bug caught mid-task:** `echo "$json"` was silently mangling ffmpeg's JSON output for files whose metadata contained backslash-escape-like text, corrupting value extraction — 2 of 18 failed visibly, but the same bug could have silently produced wrong-but-valid numbers on any of the other 16. Fixed with `printf` instead of `echo`, and **re-ran the entire 18-file batch**, not just the two visible failures, since a silent-corruption bug can't be trusted to have only affected the files where it happened to be loud about it.

## "Analyze the app" pass (2026-08-03, `bd0f966`, `e4b9da3`, `f1f049d`, `76d9935`)
Jason asked directly what could be better/more scalable. Read the actual current code first rather than answering from memory. Gave a prioritized list split into "worth fixing" vs. "deliberately not doing" — when pushed on "why not fix all of them," clarified the distinction and executed the four real ones:
1. **Offline-cache status indicator** — Settings shows "All N songs ready offline" (green) or "X of N not downloaded yet" (amber), checked live against Cache Storage for bundled roster.json songs specifically (phone-added songs live in IndexedDB, always available regardless). Makes the app's core offline promise verifiable instead of assumed.
2. **Committed smoke test** (`test/smoke.js`) — consolidates this session's ad hoc verification (select/play/stop, mis-tap safety, auto-advance, Advance-on-Stop, drag-reorder) into one reusable script. **Verified it actually has teeth before committing**: a first version didn't catch an intentionally-broken auto-advance line (an earlier test step accidentally covered for the break), fixed the flow to properly isolate that path, reconfirmed both a real pass and a real failure.
3. **Duplicate jersey-number warning** — confirms with the existing player's name before adding a second one under the same number.
4. **Manage Team search** — filters by name/number, resets on each open.
- **Explicitly not done:** dynamic lineup size (not broken, no real need yet), modularizing `app.js`/build tooling (disproportionate for a 2-person tool), multi-device sync (already rejected in an earlier session, not relitigated).

## Header logo iteration (2026-08-03, `f3d5cc2` → `0d4c4df` → `2b19d08`)
Jason asked to center the logo + add "11U" on the left. Built as a 3-column grid (verified centered to 0px on a 390px viewport) — **he didn't like it**. Reverted to logo-left + "- 11U" inline. **Then asked to remove 11U entirely** ("trying to do too much"). Net result: three commits landing back at the original plain wordmark header. Normal, cheap design iteration — not a wasted round trip.

## Session of 2026-08-18 — audio fixes, fall roster overhaul, layout fixes

**Owen's walk-up song replaced (`3636725`).** New song, same standard workflow: preserved the original to scratchpad, cut to exactly 10.0s with a 1s fade-out from 0:00, two-pass loudnorm landed at -11.1 LUFS (right in the established roster range).

**"A Storm is Coming" quiet intro boosted (`97a35eb`).** Jason flagged the beginning sounds low. Measured segment-by-segment: the first ~30s is a genuinely quiet spoken-word build (-34 to -28dB) before the beat drops and the rest of the 4:54 track sits at -13 to -14dB — a real intro/body dynamic-range gap a single loudnorm pass can't fix. Asked Jason how to handle it (boost / trim / leave) — he chose boost, keep full length. New technique: `dynaudnorm` (frame-based auto-gain) first to lift the quiet passage, **then** the standard two-pass `loudnorm` on top to restore a safe -1.0dBTP ceiling (the dynaudnorm pass alone pushed true peak to +1.2dBTP). Result: intro raised to -14 to -16dB, body -12 to -13.5dB, duration unchanged.

**13th lineup slot added, then grid reverted to 3-per-row, then headroom added for 14/15 (`c1a8d42`, `7bd79fc`, `105c7ce`).** Team's going into fall with 13 teammates again — bumped `LINEUP_COUNT` 12→13 (all downstream logic already keys off `LINEUP_IDS.length`, so this was safe). Grid switched to 4×4 to fit. Jason didn't like the denser 4-column look — reverted to 3 columns, added a 6th row instead (18 cells for 16 real slots, 2 unused and that's fine per Jason). Later asked for headroom up to a 15th slot "even though we shouldn't have any" — bumped `LINEUP_COUNT` to 15, which fits the existing 3×6 grid exactly with zero CSS change.

**Fall roster overhaul (`7adaa1b`, `5344510`+`fd07c47`, `a93b24a`):**
- Bobby Youmans (#45) left the team — removed entirely from `roster.json`, mp3 deleted, dropped from `DEFAULT_SLOTS`, everyone else shifted up one slot.
- "Kameren Maldonoldo" corrected to **Kameren Branch** (a real typo, not the roster removal above) — `roster.json` name/file updated, mp3 renamed. Player ID (`p11`) unchanged so no lineup disruption. **Git gotcha hit here:** a `git mv` + a multi-path `git add` where one path no longer existed caused the *entire* `git add` to silently fail, so the first commit only captured the file rename, not the roster.json edit — caught via `git show --stat` immediately after and fixed with a follow-up commit. Lesson: always sanity-check `git status`/`git show --stat` right after a commit mixing `git mv` with other edits.
- Two new teammates added — **Velez** and **Tineo** (last names only) — no jersey number yet (`"?"` placeholder) and no song yet (`file: null`). Found and fixed two real gaps this exposed: both `sw.js`'s precache and the offline-status indicator in `js/app.js` built a cache URL from every player's `file` field unconditionally, which would've produced a literal `./null` request and a **permanent unfixable "not downloaded" warning** for these two — fixed both to filter out players with no file first.
- Pichardo moved to the true last lineup slot (`l13`... now effectively wherever the last filled slot is) since he "always bats last by design."
- Kameren Branch removed from the *default lineup* (not the roster/app) since he's playing fall football and may only make a few games — his old slot is simply left empty, still selectable via the assign sheet any day he's actually there.
- `DEFAULT_LINEUP_VERSION` bumped twice more (1→2→3) across these changes — same "next season reset" mechanism from the original bake-in, which pushes the new lineup onto every already-installed phone on next load (overwriting any day-of drag-reorder customization currently sitting there). `test/smoke.js`'s `seedSlots()` helper hardcodes a matching "skip migration" version number — has to be bumped in lockstep or the migration silently refires mid-test.
- Also found a stale `python3 -m http.server 8934` process left running for 5 days from an unrelated project (TheChallenge), squatting on the exact port `smoke.js` expects — if the smoke test ever fails at the very first `clickSlot` with a null-element error, check `lsof -i :8934` for a stale server before assuming the app broke.

**Suspected iOS viewport-height fix for "wasted space at the bottom" (`49b26a8`) — NOT YET CONFIRMED.** Jason reported real wasted space at the bottom on his iPhone 15 Pro Max. A headless-Chrome simulation at the exact 430×932 viewport shows the flex layout filling the screen with zero gap, so this can't be reproduced outside real iOS — the fix is a reasoned bet based on the same `100vh`-under-reports-the-real-viewport quirk already fixed once on `.sheet-full` (see the Manage Team status-bar section above), applied here to the root `html, body` height rule the whole page depends on. `css/style.css` is network-first, so it should take effect on next app open with no reinstall needed. **If Jason says the gap is still there, this theory was wrong — don't just reapply the same fix, get a screenshot and exact location of the gap first.**

## Jason's expected usage pattern — UPDATED 2026-08-02
No longer "set once, Clear between games." Now: bake in the full permanent roster (12 kids in batting order + both Walkout songs + Victory) as the shipped default, tweak day-of via drag-reorder, and only use gear/pencil for actual roster changes (kid added/removed/subbed). Two parents share day-to-day operation — Jason plus another parent currently on BallparkDJ, moving over once this app is further along.

## Pending (gated on Jason)
- Rename "WALKOUT 1" / "WALKOUT 2" → "TEAM 1" / "TEAM 2" once Jason confirms on his phone that Owen's entry is showing up live. **Still not confirmed.**
- "Sam Va Tassel" (possibly "VanTassel"/"Van Tassel") — still unconfirmed, used as-given. ("Maldonoldo" was confirmed and corrected to "Branch" 2026-08-18, see above.)
- Real jersey numbers and walk-up songs for Velez and Tineo — currently `"?"` and no song (intentional placeholders). Follow the standard single-file workflow when provided.
- **Top priority: confirm whether the `100dvh` fix (`49b26a8`) actually closed the "wasted space at the bottom" issue on Jason's iPhone 15 Pro Max.** Unconfirmed as of 2026-08-18.

## Current state
- Everything committed and pushed to `origin/main` through `49b26a8`.
- **Roster (as of 2026-08-18):** Owen Ackerman #7, Kayden Lyons #5, Jaxsen Rodriguez #99, Dom Diaz #12, Jake Harris #13, Kameren Branch #11 (renamed from Maldonoldo), Caleb Gingras #68, Ethan Ladanyi #29, Liam Pichardo #2 (now batting last), Sam Va Tassel #4, Manson Frank #15, Velez #? (no song yet), Tineo #? (no song yet) + 6 team songs. Bobby Youmans (#45) left the team and is fully removed. Branch stays in the roster/app but has no default lineup slot (fall football conflict) — assign him manually on days he's there.
- `LINEUP_COUNT` is 15 (grid is 3 columns × 6 rows, 18 cells) — 13 real players use slots, 2 slots (`l14`/`l15`) are pure headroom for now.
- The real batting order is baked in as the actual default lineup, now on its 3rd version (`DEFAULT_LINEUP_VERSION = 3`) reflecting the fall roster + Pichardo-last + Branch-out-of-default changes.
- All songs are dead-air-trimmed and loudness-normalized, including a new frame-based intro-boost technique used on "A Storm is Coming"'s quiet opening.
- A "Refresh App Content" button and an offline-cache status indicator exist in Settings.
- A committed smoke test exists at `test/smoke.js` — kept in sync with `DEFAULT_LINEUP_VERSION` bumps.
- Manage Team has a search box and warns on duplicate jersey numbers.
- Header is the plain original wordmark (an 11U experiment was tried and reverted, see above).
- `html, body` now has a `100dvh` fallback height (2026-08-18, unconfirmed live) to try to close a reported bottom-edge gap on larger iPhones.
- Push cadence: Jason wants changes committed AND pushed after each round of work, not batched up.

## Field-testing status (updated 2026-08-18)
Jason was actively testing live on his own phone throughout the 2026-08-02 session — that's how the `.selected` CSS bug got caught and how the Stop-vs-advance behavior got settled into the ADV switch. Playback selection, the Edit button, and the Advance-on-Stop switch have real live-device exposure with real bugs already found and fixed. **Still not explicitly confirmed:** whether the ~500ms long-press threshold and blue drag-ring feel right for drag-to-reorder on a real touchscreen, whether the 112px action bar looks right in daylight/at a field, and (new, 2026-08-18) whether the `100dvh` fix actually closed the bottom-gap issue on the iPhone 15 Pro Max.

## Open items / next steps
- **Top priority:** get Jason's confirmation on the `100dvh` bottom-gap fix (see above).
- **Immediate, still unresolved across several sessions now:** confirm the Manage Team status-bar/close-button fix actually works, after a full delete-and-reinstall (not a restart) — Jason has moved on to other work each time instead of confirming this either way. The Refresh App Content button is the easy way to check any fix without a full reinstall.
- Get real jersey numbers + walk-up songs for Velez and Tineo when Jason has them.
- Have Jason listen through the loudness-normalized songs (including the new Storm-intro boost and Owen's new song) on a real device speaker to confirm they actually sound consistent, not just correct on paper.
- The roster/default-lineup/audio-quality/app-improvement build-out is done — this is steady-state confirmation now, not a build phase.
- Confirm the baked-in fall lineup (Pichardo last, Branch out of default, Youmans gone, Velez/Tineo in) shows up correctly on both Jason's and the other parent's phones.
- Confirm or correct "Sam Va Tassel."
- Confirm drag-to-reorder feel and action-bar sizing live, if not already done.
- Rename Walkout 1/2 → Team 1/Team 2 once confirmed live.
- Screen wake lock still not field-tested during a real game.
