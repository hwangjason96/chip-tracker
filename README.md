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

By default the data is saved **in the browser you're using**. That works well when one person keeps the "bank" on one phone or laptop at the table.

## Enable live sync (optional, free)

To let everyone see and change the same chips from their own phones, connect a free Firebase Realtime Database:

1. Go to <https://console.firebase.google.com>, then **Add project** (Analytics isn't needed).
2. **Build → Realtime Database → Create database**, and start in **test mode**.
3. **Project settings → General → Your apps → Web (`</>`)**, register an app, and copy the `firebaseConfig` object.
4. Paste it into `config.js` as `window.FIREBASE_CONFIG = { ... }`. Make sure it includes `databaseURL`.
5. Commit and push. The badge in the top-right will say **Live · room main**.

> Firebase web config values aren't secrets, but test-mode rules let anyone with your URL read and write. For a friend group that's usually fine. If you want to lock it down, set these database rules so only the `rooms` path is writable:
>
> ```json
> { "rules": { "rooms": { "$room": { ".read": true, ".write": true } } } }
> ```

## Run locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.
