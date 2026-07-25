# Storm — Project Status

_Last updated: 2026-07-25_

## What it is
An offline-first PWA for playing walk-up songs at Storm baseball games. Installed to the iPhone home screen via GitHub Pages (`github.com/jasonackerman1/storm`); works with no signal at the field once installed and opened once with internet.

## Architecture
- Static site: `index.html`, `css/style.css`, `js/app.js`, `sw.js` (service worker), `manifest.json`, `icons/`
- Roster data: `roster.json` (bundled/committed songs, shipped with the app) + IndexedDB (`storm-db`, store `players`) for songs added directly from the phone via **Manage Team**
- Slot assignments: localStorage key `storm-slots-v2`, keyed by slot id (not array index): `sp1`/`sp2`/`sp3` (Walkout 1, Walkout 2, Victory) + `l1`–`l12` (12 lineup slots). Defined in `SLOT_DEFS` in `js/app.js`.

## Build history
1. **`c1b72d5`** — Initial build: 12-button lineup grid, tap-to-play/tap-to-switch playback, per-slot reassign (pencil icon), Manage Team screen (add players + MP3 from phone → IndexedDB), bundled-roster path (`roster.json` + `mp3/`), Clear Lineup, offline-first PWA shell.
2. **`8efe520`** (2026-07-25) — Added a top row above the 12 lineup slots: 2 Walkout slots + 1 Victory slot for team-level songs. Refactored slots to keyed-by-id so special/lineup manage independently. Clear Lineup now only resets the 12 batting slots. Jersey # optional when adding a song. Sizing adjusted for 5 rows.
3. **`21f406d`** (2026-07-25) — Added Owen Ackerman (#7) as the first real roster entry (`roster.json` + `mp3/7-owen-ackerman.mp3`), plus `.gitignore` for `.DS_Store`. First real (non-placeholder) content, pushed live.

## Content workflow (in progress)
- **MP3 filename convention:** `{number}-{firstname}-{lastname}.mp3`, dashes between every word (e.g. `7-owen-ackerman.mp3`). Avoids ambiguity that a no-separator name would create.
- **Plan:** Jason is setting up a Google Doc for teammates to submit their walk-up song picks (pre-filled with Owen's entry as a model). He'll manually source each MP3 from the internet, name it per convention, and drop it in `mp3/`.
- **Once a file lands in `mp3/`:** Claude cuts it to 10 seconds with a 1-second fade-out (via `ffmpeg`) and adds the matching entry to `roster.json`. One-off edits (skip an intro, custom start time, different length/fade) are supported on request per song.
- **Tooling:** `ffmpeg` installed via Homebrew (2026-07-25) specifically for this.

## Current state
- `roster.json` has 1 real entry (Owen Ackerman, #7). `mp3/` has 1 file.
- Icons and styling are still placeholder (`icon-180.png`, `icon-512.png`, `css/style.css`) — restyling explicitly deferred until after testing with real songs.
- Push cadence: Jason wants changes pushed to `origin/main` (live on GitHub Pages) after each round of work, not batched up.

## Open items / next steps
- Jason builds/shares the Google Doc and collects team song picks.
- As MP3s arrive: name → drop in `mp3/` → Claude cuts/fades/updates roster → commit → push.
- Restyle colors/logo/icons once real content is in and tested.
