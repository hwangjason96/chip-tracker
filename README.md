# 🪙 Chip Tracker

A simple, phone-friendly website for tracking poker/game chips and side bets with friends. No build step: it's plain HTML, CSS and JavaScript, hosted for free on GitHub Pages.

## Features

- **Players**: add friends with starting chips, add or remove chips, buy-ins and rebuys, and a leaderboard with each player's net up or down.
- **Transfers**: move chips from one player to another, with an optional note.
- **Bets**: create a bet with any number of options ("Who wins the next hand?", "Alex / Sam / Jordan"). Everyone puts chips on an option, and the live odds update as they go. When you pick the winner, the winners split the whole pot in proportion to their stake (pari-mutuel). If nobody picked the winner, everyone is refunded. You can also cancel a bet and refund it.
- **History**: a log of every change.
- **Rooms**: `?room=friday-night` keeps separate groups apart. Use **Settings → Copy invite link** to share it.
- **Backup**: export and import JSON.

## Use it

Open the GitHub Pages URL for this repo, or just open `index.html` locally.

Data is **synced live** through a Firebase Realtime Database (project `chip-tracker-cf94b`), so everyone who opens the same room sees the same chips instantly. Share the room link from **Settings → Copy invite link**.

Each room is open to anyone who has its link. Pick a hard-to-guess room name (for example `?room=jason-crew-7x2k`) if you don't want strangers wandering in.

## Using your own Firebase project

To point the site at a different Firebase Realtime Database:

1. Go to <https://console.firebase.google.com>, then **Add project** (Analytics isn't needed).
2. **Build → Realtime Database → Create database**, and start in **test mode**.
3. **Project settings → General → Your apps → Web (`</>`)**, register an app, and copy the `firebaseConfig` object.
4. Paste it into `config.js` as `window.FIREBASE_CONFIG = { ... }`. Make sure it includes `databaseURL`.
5. In **Realtime Database → Rules**, publish these rules so only rooms can be read and written:

   ```json
   { "rules": { "rooms": { "$room": { ".read": true, ".write": true, ".validate": "$room.matches(/^[A-Za-z0-9_-]{1,32}$/)" } } } }
   ```

6. Commit and push. The badge in the top-right will say **Live · room main**.

Set `window.FIREBASE_CONFIG = null` to go back to saving in the browser only.

## Run locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.
