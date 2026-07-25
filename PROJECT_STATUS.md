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
3. **`21f406d`** (2026-07-25) — Added Owen Ackerman (#7) as the first real roster entry (`roster.json` + `mp3/7-owen-ackerman.mp3`), plus `.gitignore` for `.DS_Store`. First real (non-placeholder) content, pushed live.
4. **`cffbe41`** (2026-07-25) — Added this `PROJECT_STATUS.md`.
5. **`b52350b`** (2026-07-25) — Fixed a stale service-worker cache bug + first branding pass from the real team logo. Details below.

## Content workflow (in progress)
- **MP3 filename convention:** `{number}-{firstname}-{lastname}.mp3`, dashes between every word (e.g. `7-owen-ackerman.mp3`). Avoids ambiguity that a no-separator name would create.
- **Plan:** Jason is setting up a Google Doc for teammates to submit their walk-up song picks (pre-filled with Owen's entry as a model). He'll manually source each MP3 from the internet, name it per convention, and drop it in `mp3/`.
- **Once a file lands in `mp3/`:** Claude cuts it to 10 seconds with a 1-second fade-out (via `ffmpeg`) and adds the matching entry to `roster.json`. One-off edits (skip an intro, custom start time, different length/fade) are supported on request per song.
- **Tooling:** `ffmpeg` installed via Homebrew (2026-07-25) specifically for this.

## Service worker cache bug (fixed 2026-07-25, `b52350b`)
`sw.js` was cache-first for every request, including `roster.json` — once the empty roster got cached, it stayed stale through every subsequent deploy (this is why Owen's entry didn't show up live after commit 3). Fixed: shell files + `roster.json` (`NETWORK_FIRST_FILES` in `sw.js`) now go network-first with cache-fallback; mp3s/icons stay cache-first for offline playback reliability. `CACHE_NAME` bumped to `storm-cache-v3` to force a clean re-precache.

**When touching `sw.js` again:** any file that must reflect a new deploy immediately belongs in `NETWORK_FIRST_FILES`, and bump `CACHE_NAME` whenever the precache file list changes.

## Branding (first pass done 2026-07-25, `b52350b`)
Colors sampled directly from `storm_logo.jpg` (768×170px source, provided by Jason): black `#000000`, red `#D00018`, gold `#F8B000` — now the `:root` variables in `css/style.css`.
- **Font:** Anton (Google Font), bundled locally as `fonts/Anton-Regular.woff2` so it works fully offline — no live CDN dependency.
- **Cyclone icon:** the logo's tornado graphic is too low-res and interlocked with the T/R lettering to crop cleanly, so Claude hand-drew a matching SVG cyclone (`icons/cyclone.svg`) in the same gold-outline/red-fill/black style. Used in the header and regenerated as the new `icons/icon-180.png` / `icons/icon-512.png` app icons.
- **Slot cards:** restyled to look like the back of a baseball jersey — bold Anton-font number with gold outline, name below, subtle fabric-texture background, gold trim when filled, red gradient + gold ring when playing.
- Verified with a temporary headless-Chrome + puppeteer-core script driving the actual assign/play flows (removed after verification, not committed).

## Pending (gated on Jason)
- Rename "WALKOUT 1" / "WALKOUT 2" → "TEAM 1" / "TEAM 2" once Jason confirms on his phone that Owen's entry is showing up live (verifying the cache fix actually worked in the real PWA, not just in local testing).

## Current state
- Everything committed and pushed to `origin/main` through `b52350b`.
- `roster.json` has 1 real entry (Owen Ackerman, #7). `mp3/` has 1 file.
- Branding is live (no longer placeholder): logo colors, Anton font, cyclone icon/app icons, jersey-style cards.
- Push cadence: Jason wants changes committed AND pushed to `origin/main` after each round of work, not batched up.

## Open items / next steps
- Jason confirms the cache fix worked on his phone (may need a full quit + reopen, not just backgrounding).
- Once confirmed: rename Walkout 1/2 → Team 1/Team 2.
- Jason builds/shares the Google Doc and collects team song picks.
- As MP3s arrive: name → drop in `mp3/` → Claude cuts/fades/updates roster → commit → push.
