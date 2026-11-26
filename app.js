(() => {
  "use strict";

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString();
  const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
  const toInt = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : 0; };
  const values = (o) => Object.values(o || {});
  const timeAgo = (t) => {
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return new Date(t).toLocaleDateString();
  };

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ---------- room ----------
  const params = new URLSearchParams(location.search);
  const cleanRoom = (r) => (r || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  let room = cleanRoom(params.get("room")) || safeGet("chip-tracker:room") || "main";
  safeSet("chip-tracker:room", room);

  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

  // ---------- state ----------
  function emptyState() {
    return { settings: { defaultChips: 1000 }, players: {}, bets: {}, log: {} };
  }
  function normalize(s) {
    s = s && typeof s === "object" ? s : {};
    const base = emptyState();
    s.settings = Object.assign(base.settings, s.settings || {});
    s.players = s.players || {};
    s.bets = s.bets || {};
    s.log = s.log || {};
    for (const b of values(s.bets)) {
      b.options = Array.isArray(b.options) ? b.options : values(b.options);
      b.wagers = b.wagers || {};
    }
    return s;
  }
  function addLog(s, text) {
    const id = uid();
    s.log[id] = { id, t: Date.now(), text };
    const ids = Object.keys(s.log).sort((a, b) => s.log[a].t - s.log[b].t);
    while (ids.length > 300) delete s.log[ids.shift()];
  }

  let state = emptyState();

  // ---------- storage backends ----------
  // Every change goes through mutate(fn). fn edits a draft state and may
  // throw an Error with a user-facing message to abort.
  const local = {
    key: () => "chip-tracker:data:" + room,
    start() {
      try { state = normalize(JSON.parse(safeGet(this.key()))); } catch { state = emptyState(); }
      setSync("Local only · this device", "");
      render();
    },
    mutate(fn) {
      try {
        const draft = normalize(JSON.parse(JSON.stringify(state)));
        fn(draft);
        state = draft;
        safeSet(this.key(), JSON.stringify(state));
        render();
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    },
    stop() {},
  };

  const remote = {
    ref: null,
    start() {
      setSync("Connecting…", "");
      this.ref = firebase.database().ref("rooms/" + room);
      this.ref.on("value", (snap) => {
        state = normalize(snap.val());
        setSync("Live · room " + room, "live");
        render();
      }, (err) => setSync("Sync error: " + err.message, "err"));
    },
    mutate(fn) {
      let userError = null;
      return this.ref.transaction((cur) => {
        const draft = normalize(cur);
        try { fn(draft); } catch (e) { userError = e; return; } // abort
        return draft;
      }).then(() => { if (userError) throw userError; });
    },
    stop() { if (this.ref) this.ref.off(); },
  };

  let store = local;

  function mutate(fn, okMsg) {
    return store.mutate(fn).then(() => { if (okMsg) toast(okMsg); })
      .catch((e) => toast(e && e.message ? e.message : "Something went wrong"));
  }

  function setSync(text, cls) {
    const el = $("#syncStatus");
    el.textContent = text;
    el.className = "sync " + (cls || "");
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  async function boot() {
    if (window.FIREBASE_CONFIG) {
      try {
        const v = "10.12.2";
        await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js`);
        await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-database-compat.js`);
        firebase.initializeApp(window.FIREBASE_CONFIG);
        store = remote;
      } catch (e) {
        console.error(e);
        store = local;
        toast("Couldn't connect to Firebase — using local storage");
      }
    }
    store.start();
  }

  // ---------- derived data ----------
  const sortedPlayers = () => values(state.players).sort((a, b) => b.chips - a.chips || a.name.localeCompare(b.name));
  const openBets = () => values(state.bets).filter((b) => b.status === "open").sort((a, b) => b.createdAt - a.createdAt);
  const closedBets = () => values(state.bets).filter((b) => b.status !== "open").sort((a, b) => (b.settledAt || 0) - (a.settledAt || 0));
  const potOf = (bet) => values(bet.wagers).reduce((s, w) => s + w.amount, 0);
  const pName = (id) => (state.players[id] ? state.players[id].name : "(removed)");
  function inPlayFor(playerId) {
    let n = 0;
    for (const b of openBets()) for (const w of values(b.wagers)) if (w.playerId === playerId) n += w.amount;
    return n;
  }

  // ---------- render ----------
  function render() {
    renderStats();
    renderPlayers();
    renderTransferSelects();
    renderBets();
    renderHistory();
    renderSettings();
  }

  function renderStats() {
    const players = values(state.players);
    const held = players.reduce((s, p) => s + p.chips, 0);
    const pots = openBets().reduce((s, b) => s + potOf(b), 0);
    $("#stats").innerHTML = `
      <div class="stat"><div class="label">Players</div><div class="value">${players.length}</div></div>
      <div class="stat"><div class="label">Chips in play</div><div class="value">${fmt(held + pots)}</div></div>
      <div class="stat"><div class="label">In open pots</div><div class="value">${fmt(pots)}</div></div>`;
    $("#newPlayerChips").placeholder = "Chips (" + fmt(state.settings.defaultChips) + ")";
  }

  function renderPlayers() {
    const list = sortedPlayers();
    if (!list.length) {
      $("#playerList").innerHTML = `<div class="empty">No players yet. Add your crew above 👆</div>`;
      return;
    }
    $("#playerList").innerHTML = list.map((p, i) => {
      const inPlay = inPlayFor(p.id);
      const net = p.chips + inPlay - p.buyIn;
      const cls = net > 0 ? "up" : net < 0 ? "down" : "";
      return `
      <div class="player" data-id="${p.id}">
        <div class="rank ${i === 0 && p.chips > 0 ? "r1" : ""}">${i === 0 && p.chips > 0 ? "👑" : i + 1}</div>
        <div>
          <div class="name">${esc(p.name)}</div>
          <div class="sub">Bought in ${fmt(p.buyIn)}${inPlay ? ` · ${fmt(inPlay)} in bets` : ""} · <span class="${cls}">net ${signed(net)}</span></div>
        </div>
        <div class="chips"><div class="amt">${fmt(p.chips)}</div></div>
        <div class="player-actions">
          <input type="number" min="1" step="1" placeholder="Amount" class="adj-amt" aria-label="Amount for ${esc(p.name)}" />
          <button class="btn small" data-action="add">+ Add</button>
          <button class="btn small" data-action="sub">− Remove</button>
          <button class="btn small" data-action="rebuy" title="Add chips and count it as a buy-in">Buy in</button>
          <button class="btn small" data-action="rename">Rename</button>
          <button class="btn small danger" data-action="delete">Delete</button>
        </div>
      </div>`;
    }).join("");
  }

  function renderTransferSelects() {
    const opts = sortedPlayers().map((p) => `<option value="${p.id}">${esc(p.name)} (${fmt(p.chips)})</option>`).join("");
    for (const id of ["#transferFrom", "#transferTo"]) {
      const sel = $(id);
      const prev = sel.value;
      sel.innerHTML = `<option value="">${id === "#transferFrom" ? "From…" : "To…"}</option>` + opts;
      if (state.players[prev]) sel.value = prev;
    }
  }

  function betCard(bet) {
    const pot = potOf(bet);
    const wagers = values(bet.wagers);
    const isOpen = bet.status === "open";
    const optionTotals = {};
    for (const o of bet.options) optionTotals[o.id] = 0;
    for (const w of wagers) optionTotals[w.optionId] = (optionTotals[w.optionId] || 0) + w.amount;

    const options = bet.options.map((o) => {
      const total = optionTotals[o.id] || 0;
      const mult = total ? (pot / total) : 0;
      const ws = wagers.filter((w) => w.optionId === o.id);
      return `
        <div class="option ${bet.winnerId === o.id ? "winner" : ""}">
          <div class="option-head">
            <div><span class="option-name">${bet.winnerId === o.id ? "🏆 " : ""}${esc(o.name)}</span>
              <span class="odds"> · ${fmt(total)} chips${total ? ` · pays ${mult.toFixed(2)}×` : ""}</span></div>
            ${isOpen ? `<button class="btn small win" data-action="settle" data-option="${o.id}">Winner</button>` : ""}
          </div>
          ${ws.length ? `<div class="wagers">${ws.map((w) => `
            <span class="wager">${esc(pName(w.playerId))} ${fmt(w.amount)}${isOpen ? `<button data-action="unwager" data-wager="${w.id}" title="Take back">✕</button>` : ""}</span>`).join("")}</div>` : ""}
        </div>`;
    }).join("");

    const players = sortedPlayers();
    const place = isOpen ? `
      <form class="place" data-action="wager">
        <select name="player" required><option value="">Who's betting?</option>
          ${players.map((p) => `<option value="${p.id}">${esc(p.name)} (${fmt(p.chips)})</option>`).join("")}</select>
        <select name="option" required><option value="">On…</option>
          ${bet.options.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select>
        <input name="amount" type="number" min="1" step="1" placeholder="Chips" required />
        <button class="btn primary" type="submit">Bet</button>
      </form>` : "";

    let result = "";
    if (bet.status === "settled") {
      const parts = values(bet.payouts || {}).length
        ? Object.entries(bet.payouts).map(([pid, amt]) => `${esc(pName(pid))} won ${fmt(amt)}`).join(", ")
        : "No one picked the winner — all wagers refunded.";
      result = `<div class="result">${parts}</div>`;
    } else if (bet.status === "cancelled") {
      result = `<div class="result">Cancelled — all wagers refunded.</div>`;
    }

    return `
      <div class="bet ${isOpen ? "" : "closed"}" data-bet="${bet.id}">
        <div class="bet-head">
          <div class="bet-title">${esc(bet.title)}</div>
          <div class="pot">Pot ${fmt(pot)}</div>
        </div>
        <div class="options">${options}</div>
        ${place}
        ${result}
        <div class="bet-foot">
          ${isOpen ? `<button class="btn small danger" data-action="cancel">Cancel &amp; refund</button>`
                   : `<button class="btn small" data-action="removebet">Remove</button>`}
        </div>
      </div>`;
  }

  function renderBets() {
    const open = openBets();
    const closed = closedBets().slice(0, 20);
    $("#openBets").innerHTML = open.length ? open.map(betCard).join("") : `<div class="empty">No open bets. Start one above.</div>`;
    $("#closedBets").innerHTML = closed.length ? closed.map(betCard).join("") : `<div class="empty">Nothing settled yet.</div>`;
  }

  function renderHistory() {
    const items = values(state.log).sort((a, b) => b.t - a.t);
    $("#historyList").innerHTML = items.length
      ? items.map((l) => `<div class="h-item"><span>${esc(l.text)}</span><span class="h-time">${timeAgo(l.t)}</span></div>`).join("")
      : `<div class="empty" style="margin:10px 0">No activity yet.</div>`;
  }

  function renderSettings() {
    $("#roomHint").innerHTML = store === remote
      ? `You're in room <b>${esc(room)}</b>. Everyone who opens the invite link sees the same chips live.`
      : `You're in room <b>${esc(room)}</b>. Live sync is off, so data is saved in this browser only. See the README to turn on live sync with Firebase.`;
    $("#roomInput").placeholder = room;
    const dc = $("#defaultChips");
    if (document.activeElement !== dc) dc.value = state.settings.defaultChips;
  }

  // ---------- actions ----------
  function need(cond, msg) { if (!cond) throw new Error(msg); }

  // Tabs
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + t.dataset.tab));
  }));

  // Add player
  $("#addPlayerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#newPlayerName").value.trim();
    const raw = $("#newPlayerChips").value;
    mutate((s) => {
      const chips = raw === "" ? toInt(s.settings.defaultChips) : toInt(raw);
      need(name, "Enter a name");
      need(chips >= 0, "Chips can't be negative");
      need(!values(s.players).some((p) => p.name.toLowerCase() === name.toLowerCase()), "That name is taken");
      const id = uid();
      s.players[id] = { id, name, chips, buyIn: chips, createdAt: Date.now() };
      addLog(s, `${name} joined with ${fmt(chips)} chips`);
    }, `Added ${name}`).then(() => { $("#newPlayerName").value = ""; $("#newPlayerChips").value = ""; $("#newPlayerName").focus(); });
  });

  // Player actions
  $("#playerList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest(".player");
    const id = card.dataset.id;
    const amt = toInt($(".adj-amt", card).value);
    const action = btn.dataset.action;
    const name = state.players[id] && state.players[id].name;

    if (action === "add" || action === "sub") {
      if (amt <= 0) return toast("Enter an amount first");
      mutate((s) => {
        const p = s.players[id]; need(p, "Player not found");
        if (action === "sub") need(p.chips >= amt, `${p.name} only has ${fmt(p.chips)}`);
        p.chips += action === "add" ? amt : -amt;
        addLog(s, `${p.name} ${action === "add" ? "+" : "−"}${fmt(amt)} chips (manual)`);
      }, "Updated");
    } else if (action === "rebuy") {
      const n = amt > 0 ? amt : toInt(state.settings.defaultChips);
      mutate((s) => {
        const p = s.players[id]; need(p, "Player not found");
        p.chips += n; p.buyIn += n;
        addLog(s, `${p.name} bought in for ${fmt(n)}`);
      }, `${name} bought in for ${fmt(n)}`);
    } else if (action === "rename") {
      const next = (prompt("New name for " + name, name) || "").trim().slice(0, 24);
      if (!next || next === name) return;
      mutate((s) => {
        need(!values(s.players).some((p) => p.id !== id && p.name.toLowerCase() === next.toLowerCase()), "That name is taken");
        s.players[id].name = next;
        addLog(s, `${name} is now ${next}`);
      }, "Renamed");
    } else if (action === "delete") {
      if (!confirm(`Delete ${name}? Their chips will be removed.`)) return;
      mutate((s) => {
        for (const b of values(s.bets)) if (b.status === "open")
          need(!values(b.wagers).some((w) => w.playerId === id), `${name} has chips in an open bet`);
        delete s.players[id];
        addLog(s, `${name} left the table`);
      }, `Removed ${name}`);
    }
  });

  // Transfer
  $("#transferForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const from = $("#transferFrom").value, to = $("#transferTo").value;
    const amt = toInt($("#transferAmount").value);
    const note = $("#transferNote").value.trim();
    mutate((s) => {
      need(from && to, "Pick both players");
      need(from !== to, "Pick two different players");
      need(amt > 0, "Enter an amount");
      const a = s.players[from], b = s.players[to];
      need(a && b, "Player not found");
      need(a.chips >= amt, `${a.name} only has ${fmt(a.chips)}`);
      a.chips -= amt; b.chips += amt;
      addLog(s, `${a.name} paid ${b.name} ${fmt(amt)}${note ? ` — ${note}` : ""}`);
    }, "Sent").then(() => { $("#transferAmount").value = ""; $("#transferNote").value = ""; });
  });

  // New bet
  $("#newBetForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#betTitle").value.trim();
    const names = [...new Set($("#betOptions").value.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 12);
    if (names.length < 2) return toast("Add at least 2 options, separated by commas");
    mutate((s) => {
      const id = uid();
      s.bets[id] = {
        id, title, status: "open", createdAt: Date.now(), wagers: {},
        options: names.map((n) => ({ id: uid(), name: n.slice(0, 40) })),
      };
      addLog(s, `New bet: ${title}`);
    }, "Bet created").then(() => { $("#betTitle").value = ""; $("#betOptions").value = ""; });
  });

  // Bet interactions
  const betsRoot = $("#tab-bets");
  betsRoot.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-action='wager']");
    if (!form) return;
    e.preventDefault();
    const betId = form.closest(".bet").dataset.bet;
    const pid = form.player.value, oid = form.option.value, amt = toInt(form.amount.value);
    mutate((s) => {
      const bet = s.bets[betId]; need(bet && bet.status === "open", "This bet is closed");
      const p = s.players[pid]; need(p, "Pick a player");
      need(bet.options.some((o) => o.id === oid), "Pick an option");
      need(amt > 0, "Enter an amount");
      need(p.chips >= amt, `${p.name} only has ${fmt(p.chips)}`);
      p.chips -= amt;
      const wid = uid();
      bet.wagers[wid] = { id: wid, playerId: pid, optionId: oid, amount: amt, t: Date.now() };
      const opt = bet.options.find((o) => o.id === oid);
      addLog(s, `${p.name} bet ${fmt(amt)} on "${opt.name}" (${bet.title})`);
    }, "Bet placed");
  });

  betsRoot.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const betEl = btn.closest(".bet");
    if (!betEl) return;
    const betId = betEl.dataset.bet;
    const action = btn.dataset.action;

    if (action === "unwager") {
      const wid = btn.dataset.wager;
      mutate((s) => {
        const bet = s.bets[betId]; need(bet && bet.status === "open", "This bet is closed");
        const w = bet.wagers[wid]; need(w, "Wager not found");
        if (s.players[w.playerId]) s.players[w.playerId].chips += w.amount;
        delete bet.wagers[wid];
        addLog(s, `${pName(w.playerId)} took back ${fmt(w.amount)} (${bet.title})`);
      }, "Wager returned");
    } else if (action === "settle") {
      const oid = btn.dataset.option;
      const bet = state.bets[betId];
      const optName = bet.options.find((o) => o.id === oid).name;
      if (!confirm(`Settle "${bet.title}" with winner: ${optName}?`)) return;
      mutate((s) => settle(s, betId, oid), `Settled: ${optName} wins`);
    } else if (action === "cancel") {
      if (!confirm("Cancel this bet and refund everyone?")) return;
      mutate((s) => {
        const bet = s.bets[betId]; need(bet && bet.status === "open", "This bet is closed");
        for (const w of values(bet.wagers)) if (s.players[w.playerId]) s.players[w.playerId].chips += w.amount;
        bet.status = "cancelled"; bet.settledAt = Date.now();
        addLog(s, `Bet cancelled & refunded: ${bet.title}`);
      }, "Bet cancelled");
    } else if (action === "removebet") {
      mutate((s) => { delete s.bets[betId]; });
    }
  });

  // Pari-mutuel settlement: winners split the whole pot by stake.
  function settle(s, betId, winnerId) {
    const bet = s.bets[betId]; need(bet && bet.status === "open", "This bet is already closed");
    const wagers = values(bet.wagers);
    const pot = wagers.reduce((t, w) => t + w.amount, 0);
    const winners = wagers.filter((w) => w.optionId === winnerId);
    const winTotal = winners.reduce((t, w) => t + w.amount, 0);
    const payouts = {};

    if (!winTotal) {
      for (const w of wagers) if (s.players[w.playerId]) s.players[w.playerId].chips += w.amount;
    } else {
      let paid = 0;
      const shares = winners.map((w) => {
        const exact = (pot * w.amount) / winTotal;
        const base = Math.floor(exact);
        paid += base;
        return { w, base, frac: exact - base };
      });
      // hand out leftover chips from rounding, biggest fractions first
      shares.sort((a, b) => b.frac - a.frac);
      for (let i = 0; paid < pot; i++, paid++) shares[i % shares.length].base++;
      for (const { w, base } of shares) payouts[w.playerId] = (payouts[w.playerId] || 0) + base;
      for (const [pid, amt] of Object.entries(payouts)) if (s.players[pid]) s.players[pid].chips += amt;
    }

    bet.status = "settled";
    bet.winnerId = winnerId;
    bet.payouts = payouts;
    bet.settledAt = Date.now();
    const optName = bet.options.find((o) => o.id === winnerId).name;
    const summary = Object.keys(payouts).length
      ? Object.entries(payouts).map(([pid, amt]) => `${s.players[pid] ? s.players[pid].name : "(removed)"} +${fmt(amt)}`).join(", ")
      : "no winners, refunded";
    addLog(s, `"${bet.title}" → ${optName} wins (${summary})`);
  }

  // ---------- settings ----------
  $("#defaultChips").addEventListener("change", (e) => {
    const n = toInt(e.target.value);
    if (n < 0) return toast("Must be 0 or more");
    mutate((s) => { s.settings.defaultChips = n; }, "Default saved");
  });

  $("#roomForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const next = cleanRoom($("#roomInput").value);
    if (!next) return toast("Letters, numbers, - and _ only");
    const url = new URL(location.href);
    url.searchParams.set("room", next);
    location.href = url.toString();
  });

  $("#copyLink").addEventListener("click", async () => {
    const url = new URL(location.href);
    url.searchParams.set("room", room);
    try { await navigator.clipboard.writeText(url.toString()); toast("Invite link copied"); }
    catch { prompt("Copy this link:", url.toString()); }
  });

  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chip-tracker-${room}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = normalize(JSON.parse(await file.text()));
      if (!confirm("Replace everything in this room with the imported file?")) return;
      mutate((s) => { Object.keys(s).forEach((k) => delete s[k]); Object.assign(s, data); addLog(s, "Imported backup"); }, "Imported");
    } catch { toast("That file isn't valid JSON"); }
    e.target.value = "";
  });

  $("#resetChips").addEventListener("click", () => {
    if (!confirm("Refund open bets and reset every player to the default chip count?")) return;
    mutate((s) => {
      const d = toInt(s.settings.defaultChips);
      for (const b of values(s.bets)) if (b.status === "open") { b.status = "cancelled"; b.settledAt = Date.now(); }
      for (const p of values(s.players)) { p.chips = d; p.buyIn = d; }
      addLog(s, `Everyone reset to ${fmt(d)} chips`);
    }, "Chips reset");
  });

  $("#resetAll").addEventListener("click", () => {
    if (!confirm(`Delete ALL players, bets and history in room "${room}"? This can't be undone.`)) return;
    mutate((s) => { const keep = s.settings; Object.assign(s, emptyState()); s.settings = keep; }, "Room cleared");
  });

  // refresh relative times
  setInterval(renderHistory, 60000);

  boot();
})();
