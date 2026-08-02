# Storm — Project Status

_Last updated: 2026-08-02_

## What it is
An offline-first PWA for playing walk-up songs at Storm baseball games. Installed to the iPhone home screen via GitHub Pages (`github.com/jasonackerman1/storm`); works with no signal at the field once installed and opened once with internet.

## Architecture
- Static site: `index.html`, `css/style.css`, `js/app.js`, `sw.js` (service worker), `manifest.json`, `icons/`, `fonts/`
- Roster data: `roster.json` (bundled/committed songs, shipped with the app) + IndexedDB (`storm-db`, store `players`) for songs added directly from the phone via **Manage Team**
- Slot assignments: localStorage key `storm-slots-v2`, keyed by slot id (not array index): `sp1`/`sp2`/`sp3` (Walkout 1, Walkout 2, Victory) + `l1`–`l12` (12 lineup slots). Defined in `SLOT_DEFS` in `js/app.js`.

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

## Jason's expected usage pattern — UPDATED 2026-08-02
No longer "set once, Clear between games." Now: bake in the full permanent roster (12 kids in batting order + both Walkout songs + Victory) as the shipped default, tweak day-of via drag-reorder, and only use gear/pencil for actual roster changes (kid added/removed/subbed). Two parents share day-to-day operation — Jason plus another parent currently on BallparkDJ, moving over once this app is further along.

## Pending (gated on Jason)
- Rename "WALKOUT 1" / "WALKOUT 2" → "TEAM 1" / "TEAM 2" once Jason confirms on his phone that Owen's entry is showing up live. **Still not confirmed.**

## Current state
- Everything committed and pushed to `origin/main` through `1df79ee`.
- `roster.json` still has 3 entries (Owen Ackerman #7, "Let's Go," "A Storm is Coming") — the rest of the team's songs haven't been compiled yet.
- `CACHE_NAME` is `storm-cache-v6`.
- Push cadence: Jason wants changes committed AND pushed after each round of work, not batched up.

## Not yet field-tested on Jason's actual phone (automation-verified only) — he said "I'll test" at the end of this session
- Select-then-confirm playback + the pencil/Edit button.
- Long-press drag-to-reorder — does the ~500ms threshold and blue ring feel right on a real touchscreen?
- The doubled (112px) action bar.
- Auto-advance, both the natural-finish case and the manual-Stop case.
- The new Settings section / Advance-on-Stop switch.

## Open items / next steps
- Jason is about to compile the rest of the kids' walk-up songs (jersey #, name, MP3, start timestamp, intended batting slot).
- Once that data's in: load everyone into `roster.json` (same trim rule: players → 10s+fade from a specified timestamp, team songs → untouched) **and pre-seed that exact slot arrangement as the actual default `slots` state**, so a fresh install already shows the real batting order instead of empty tiles.
- Rename Walkout 1/2 → Team 1/Team 2 once confirmed live.
- Screen wake lock still not field-tested during a real game.
