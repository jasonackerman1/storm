# Storm Walk-Up Songs

A simple offline web app for playing walk-up songs at Storm baseball games. Lives on your iPhone home screen, works with no internet connection once installed.

## How it works

- **12 big buttons**, one per lineup spot. Tap a button to play that player's song. Tapping a different button instantly stops the current song and starts the new one.
- Each button can be **reassigned** at any time (tap the small pencil icon on the button) to any player on the team — so you can match the grid to whatever lineup is playing that day, even if your full roster is bigger than 12.
- **Manage Team** (gear icon, top right) is the full player list. It's also where you add brand-new players later, right from your phone — no computer needed.
- Everything is stored locally on the phone (either bundled into the app or saved in the browser's local storage). No internet is needed once it's installed and opened at least once.

## Adding songs Jason provides directly (built-in roster)

1. Drop the MP3 file(s) into the `mp3/` folder in this project.
2. Add one entry per player to `roster.json`, for example:

   ```json
   [
     { "id": "p23", "number": "23", "name": "Jake Smith", "file": "mp3/23-jake-smith.mp3" },
     { "id": "p7",  "number": "7",  "name": "Mia Chen",   "file": "mp3/7-mia-chen.mp3" }
   ]
   ```

   - `id` just needs to be unique — jersey number prefixed with `p` is an easy convention.
   - `file` is the path relative to this folder.
3. Commit and push. These players will show up automatically in the app for everyone, and get cached for offline use the next time the app is opened with internet available.

## Adding a player directly from the phone (no computer needed)

Open **Manage Team** → fill in jersey number, name, and pick the MP3 from the Files app (AirDropped, downloaded, whatever) → **Add Player**. That player is saved permanently in the phone's local browser storage and is available immediately, fully offline, right away — it does not need a re-deploy or internet connection.

## Installing on iPhone

1. Open the app's GitHub Pages link in **Safari** (must be Safari, not Chrome) — this requires internet the first time only.
2. Tap the **Share** icon → **Add to Home Screen**.
3. Open it from the home screen icon from now on. After that first load, it works with airplane mode on / no signal at the field.

## Notes

- "Clear Lineup" (top left) resets all 12 buttons to empty, ready for a new game's lineup.
- Colors/logo are placeholder for now — easy to restyle later in `css/style.css` and swap `icons/icon-180.png` / `icons/icon-512.png`.
