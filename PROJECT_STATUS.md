# Storm — Project Status

_Last updated: 2026-07-25_

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

## Branding (current, as of `d58a10d`)
Colors sampled directly from `storm_logo.jpg` (768×170px source): black `#000000`, red `#D00018`, gold `#F8B000` — the `:root` variables in `css/style.css`.
- **Font:** Anton, bundled locally as `fonts/Anton-Regular.woff2` so it works fully offline.
- **Icon:** first pass hand-drew a cyclone/tornado SVG — Jason rejected it ("terrible"). Replaced with a **lightning bolt** (`icons/lightning.svg`), recreated from the original placeholder icon (already cached as Jason's iPhone home screen icon) and recolored to the gold/red palette. Used in the header and as the app icon source.
- **Slot cards:** look like the back of a baseball jersey. Once a lineup slot is filled: no pencil icon, no corner "#N" tag — just LASTNAME over a bigger number. Team-song slots (Walkout/Victory) keep their corner tag.
- Verified with a temporary headless-Chrome + puppeteer-core script (removed after each verification, not committed).

## Interaction model (current, as of `2862418`)
- Tap an empty slot → opens the assign sheet.
- Tap a filled, non-playing slot → plays that song from the beginning.
- Tap the currently-playing slot again → stops it and rewinds to 0:00 (next tap starts fresh).
- Tap a different slot while one is playing → stops the old one, starts the new one.
- Press-and-hold (~500ms) any slot → opens the assign sheet to reassign.

**Jason's expected usage pattern** (shared 2026-07-25, not yet field-tested): mostly set the lineup once and leave it, using "Clear Lineup" between games, with maybe one or two mid-game swaps via press-and-hold. The reassign path is for occasional use — clarity/no-accidental-triggers matters more than speed there.

## Pending (gated on Jason)
- Rename "WALKOUT 1" / "WALKOUT 2" → "TEAM 1" / "TEAM 2" once Jason confirms on his phone that Owen's entry is showing up live. **Not yet confirmed.**

## Current state
- Everything committed and pushed to `origin/main` through `3a83a52`.
- `roster.json` has 3 entries: Owen Ackerman (#7, cut to 10s+fade), "Let's Go" by Trick Daddy (team song for Walkout 2, full length ~3:42), and "A Storm is Coming" (team song for Walkout 1, full length ~4:56).
- Branding, interaction redesign, and screen-wake-lock are all live.
- Push cadence: Jason wants changes committed AND pushed after each round of work, not batched up.

## Open items / next steps
- Jason confirms the cache fix worked on his phone (may need a full quit + reopen, not just backgrounding).
- Jason tries the press-and-hold reassign gesture live to confirm the ~500ms threshold feels right (only verified in headless browser so far).
- Jason still needs to assign "Let's Go" to WALKOUT 2 and "A Storm is Coming" to WALKOUT 1 in the app itself.
- Once cache fix confirmed: rename Walkout 1/2 → Team 1/Team 2.
- Jason builds/shares the Google Doc and collects team song picks.
- As MP3s arrive: name per convention → apply player-vs-team trim rule → update roster → commit → push.
- Screen wake lock not yet field-tested during a real game (only verified error-free in headless testing).
