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
2. **`8efe520`** (2026-07-25) — Added a top row above the 12 lineup slots: 2 Walkout slots + 1 Victory slot for team-level songs. Refactored slots to keyed-by-id so special/lineup manage independently. Clear Lineup now only resets the 12 batting slots. Jersey # optional when adding a song. Sizing adjusted for 5 rows.
3. **`21f406d`** (2026-07-25) — Added Owen Ackerman (#7) as the first real roster entry (`roster.json` + `mp3/7-owen-ackerman.mp3`), plus `.gitignore` for `.DS_Store`.
4. **`cffbe41`** (2026-07-25) — Added this `PROJECT_STATUS.md`.
5. **`b52350b`** (2026-07-25) — Fixed a stale service-worker cache bug + first branding pass from the real team logo (colors, Anton font, hand-drawn cyclone icon — later superseded, see below).
6. **`d58a10d`** (2026-07-25) — Swapped the cyclone icon for a lightning bolt (Jason rejected the cyclone; the bolt is a recolor of the original placeholder icon he'd already seen and liked). Redesigned slot cards: dropped the pencil icon and the corner "#N" tag once a lineup slot is filled, moved reassignment to a press-and-hold gesture, filled cards now show LASTNAME over a bigger number.
7. **`2862418`** (2026-07-25) — Tap-to-stop-and-reset playback: tapping the currently-playing slot again stops the song and rewinds to 0:00, so the next tap always starts fresh from the top.

## Content workflow (in progress)
- **MP3 filename convention:** `{number}-{firstname}-{lastname}.mp3`, dashes between every word (e.g. `7-owen-ackerman.mp3`). Avoids ambiguity that a no-separator name would create.
- **Plan:** Jason is setting up a Google Doc for teammates to submit their walk-up song picks (pre-filled with Owen's entry as a model). He'll manually source each MP3 from the internet, name it per convention, and drop it in `mp3/`.
- **Once a file lands in `mp3/`:** Claude cuts it to 10 seconds with a 1-second fade-out (via `ffmpeg`) and adds the matching entry to `roster.json`. One-off edits (skip an intro, custom start time, different length/fade) are supported on request per song.
- **Tooling:** `ffmpeg` installed via Homebrew (2026-07-25) specifically for this.

## Service worker cache bug (fixed 2026-07-25, `b52350b`)
`sw.js` was cache-first for every request, including `roster.json` — once the empty roster got cached, it stayed stale through every subsequent deploy (this is why Owen's entry didn't show up live after commit 3). Fixed: shell files + `roster.json` (`NETWORK_FIRST_FILES` in `sw.js`) now go network-first with cache-fallback; mp3s/icons stay cache-first for offline playback reliability. `CACHE_NAME` bumped to `storm-cache-v3` to force a clean re-precache.

**When touching `sw.js` again:** any file that must reflect a new deploy immediately belongs in `NETWORK_FIRST_FILES`, and bump `CACHE_NAME` whenever the precache file list changes.

## Branding (current, as of `d58a10d`)
Colors sampled directly from `storm_logo.jpg` (768×170px source, provided by Jason): black `#000000`, red `#D00018`, gold `#F8B000` — the `:root` variables in `css/style.css`.
- **Font:** Anton (Google Font), bundled locally as `fonts/Anton-Regular.woff2` so it works fully offline — no live CDN dependency.
- **Icon:** first pass hand-drew a cyclone/tornado SVG matching the logo's tornado motif — Jason rejected it ("terrible"). Replaced with a **lightning bolt** (`icons/lightning.svg`), recreated from the original placeholder icon shape (already cached as Jason's iPhone home screen icon) and recolored to the gold/red palette. Used in the header and as the source for `icons/icon-180.png` / `icons/icon-512.png`.
- **Slot cards:** restyled to look like the back of a baseball jersey. Once a lineup slot is filled: no pencil icon, no corner "#N" tag — just LASTNAME over a bigger number, both in Anton font, gold outline on black / gold-on-red when playing. Team-song slots (Walkout/Victory) keep their corner tag since they have no number to substitute.
- Verified with a temporary headless-Chrome + puppeteer-core script driving the actual assign/play/stop flows (removed after each verification, not committed).

## Interaction model (current, as of `2862418`)
- Tap an empty slot → opens the assign sheet.
- Tap a filled, non-playing slot → plays that song from the beginning.
- Tap the currently-playing slot again → stops it and rewinds to 0:00 (next tap starts fresh).
- Tap a different slot while one is playing → stops the old one, starts the new one.
- Press-and-hold (~500ms) any slot → opens the assign sheet to reassign.

**Jason's expected usage pattern** (shared 2026-07-25, not yet field-tested): mostly set the lineup once and leave it, using "Clear Lineup" between games rather than reassigning weekly, with maybe one or two mid-game swaps via press-and-hold. Useful context: the reassign path is for occasional use, not a frequent workflow — clarity/no-accidental-triggers matters more than speed there.

## Pending (gated on Jason)
- Rename "WALKOUT 1" / "WALKOUT 2" → "TEAM 1" / "TEAM 2" once Jason confirms on his phone that Owen's entry is showing up live (verifying the cache fix actually worked in the real PWA, not just in local testing). **Not yet confirmed.**

## Current state
- Everything committed and pushed to `origin/main` through `2862418`.
- `roster.json` has 1 real entry (Owen Ackerman, #7). `mp3/` has 1 file.
- Branding and interaction redesign are both live (no longer placeholder).
- Push cadence: Jason wants changes committed AND pushed to `origin/main` after each round of work, not batched up.

## Open items / next steps
- Jason confirms the cache fix worked on his phone (may need a full quit + reopen, not just backgrounding).
- Jason tries the press-and-hold reassign gesture live to confirm the ~500ms threshold feels right (only verified in headless browser so far).
- Once cache fix confirmed: rename Walkout 1/2 → Team 1/Team 2.
- Jason builds/shares the Google Doc and collects team song picks.
- As MP3s arrive: name → drop in `mp3/` → Claude cuts/fades/updates roster → commit → push.
