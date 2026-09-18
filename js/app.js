(function () {
  'use strict';

  var LINEUP_COUNT = 15;
  var DB_NAME = 'storm-db';
  var DB_VERSION = 2;
  var STORE = 'players';
  var SOUND_STORE = 'soundboard';
  var SLOTS_KEY = 'storm-slots-v2';
  var STOP_ADVANCES_KEY = 'storm-stop-advances';
  var ANNOUNCER_OVERLAP_KEY = 'storm-announcer-overlap';
  var ANNOUNCER_ENABLED_KEY = 'storm-announcer-enabled';
  var DEFAULT_LINEUP_VERSION_KEY = 'storm-default-lineup-version';

  // MUST match CACHE_NAME in sw.js — bump both together. Used by the startup
  // splash to write confirmed-fresh media straight into the same cache
  // bucket the service worker serves from, without needing a message
  // round-trip through a service worker that may not be controlling yet
  // (e.g. the very first install, before any SW has activated).
  var CACHE_NAME = 'storm-cache-v53';

  // The real, current batting order — bump DEFAULT_LINEUP_VERSION whenever
  // this changes so it gets applied once on every device (even ones with
  // leftover state from earlier testing), without ever clobbering whatever
  // customizing (reorders/reassignments) happens afterward.
  var DEFAULT_LINEUP_VERSION = 4;
  var DEFAULT_SLOTS = {
    sp1: 't-stormiscoming',
    sp2: 't-letsgo',
    sp3: 't-swaggerlikeus',
    // l5 deliberately omitted: Branch is playing fall football and may only
    // make a few games, so he no longer gets a default lineup slot (he's
    // still in roster.json, assign him manually on days he's actually here).
    l1: 'p5', l2: 'p99', l3: 'p12', l4: 'p13', l6: 'p68',
    l7: 'p7', l8: 'p29', l9: 'p4', l10: 'p15', l11: 'p-tineo',
    l12: 'p-velez',
    // Pichardo always bats last by design — back on the team, restored to
    // his original l13 slot.
    l13: 'p2'
  };

  var SLOT_DEFS = [
    { id: 'sp1', tag: 'TEAM WALKOUT 1', kind: 'special' },
    { id: 'sp2', tag: 'TEAM WALKOUT 2', kind: 'special' },
    { id: 'sp3', tag: 'VICTORY', kind: 'special' }
  ];
  for (var s = 1; s <= LINEUP_COUNT; s++) {
    SLOT_DEFS.push({ id: 'l' + s, tag: '#' + s, kind: 'lineup' });
  }

  var bundledPlayers = [];
  var localPlayers = [];
  var library = [];
  var slots = {};
  var currentPlayingSlot = null;
  var currentAssignSlot = null;
  var selectedSlot = null;
  var dragState = null;
  var stopAdvancesEnabled = true;
  var announcerOverlapEnabled = true;
  var announcerEnabled = true;
  var objectUrlCache = new Map();
  var nameClipObjectUrlCache = new Map();
  var activeSequenceOnComplete = null;

  // ---------- Web Audio (low-latency playback + Bluetooth keep-alive) ----------
  // audioCtx is created once at startup (construction needs no user gesture —
  // only resume()/audible output does) so decoding can begin immediately
  // during the startup splash, well before the user's first tap. The keep-
  // alive hum and audioCtx.resume() itself are gated on the first real tap
  // (see unlockAudioOnFirstGesture) to satisfy iOS's autoplay-gesture rule.
  // Every playback path below falls back to the existing <audio>/new Audio()
  // approach whenever a decoded buffer isn't available (still decoding,
  // failed to decode, or Web Audio unsupported) — this must never turn a
  // working-but-laggy song into a silently broken one at the field.
  var audioCtx = null;
  var keepAliveOscillator = null;
  var songBufferCache = new Map();
  var nameClipBufferCache = new Map();
  var soundboardBufferCache = new Map();
  var activeBufferSource = null;
  // Second concurrent source, used whenever a player's announcerOverlapFraction
  // starts their song while the name clip is still playing (see below) —
  // activeBufferSource always represents the PRIMARY clip (the walk-up
  // song, whose completion is what actually ends the at-bat / drives
  // auto-advance); this tracks the secondary clip (the name announcement)
  // purely so a manual Stop can silence it too when it's still playing
  // concurrently.
  var secondaryBufferSource = null;

  // ---------- Soundboard state ----------
  // Mirrors the bundled/local split already used for players: bundled clips
  // ship in soundboard.json + sfx/ (committed, same for every device, shown
  // to everyone the moment it's deployed); local clips are phone-added via
  // the Add Sound sheet (IndexedDB, per-device). soundboardClips is the
  // merged, render-facing list — rebuilt from the two after any change.
  var bundledSoundboardClips = [];
  var localSoundboardClips = [];
  var soundboardClips = []; // { id, label, source }
  var soundboardObjectUrlCache = new Map();
  // clipId -> { kind: 'buffer', source: AudioBufferSourceNode } | { kind: 'audio', audio: Audio }
  var activeSoundboardSounds = new Map();
  var soundboardEditingId = null;
  // A clip whose duration is at or under this is treated as a one-shot
  // stinger (retap restarts it); anything longer is treated as a loop-style
  // sound (retap stops it). Duration isn't known until the browser loads the
  // local blob's metadata, which is effectively instant, so by the time a
  // user could plausibly retap it's already available.
  var SOUND_STINGER_MAX_SECONDS = 8;

  var LINEUP_IDS = SLOT_DEFS.filter(function (d) { return d.kind === 'lineup'; })
    .map(function (d) { return d.id; });

  function findSlotDef(id) {
    return SLOT_DEFS.filter(function (d) { return d.id === id; })[0];
  }

  // ---------- IndexedDB helpers ----------
  // Store-name-parameterized so both the existing players store and the new
  // soundboard clips store share one set of helpers.
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SOUND_STORE)) {
          db.createObjectStore(SOUND_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGetAll(store) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readonly');
        var req = tx.objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbGet(store, id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readonly');
        var req = tx.objectStore(store).get(id);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(store, record) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(record);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbDelete(store, id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  // ---------- Persistence ----------
  function loadSlots() {
    var result = {};
    SLOT_DEFS.forEach(function (def) { result[def.id] = null; });

    var storedVersion = 0;
    try {
      storedVersion = parseInt(localStorage.getItem(DEFAULT_LINEUP_VERSION_KEY), 10) || 0;
    } catch (e) {}

    if (storedVersion < DEFAULT_LINEUP_VERSION) {
      SLOT_DEFS.forEach(function (def) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_SLOTS, def.id)) {
          result[def.id] = DEFAULT_SLOTS[def.id];
        }
      });
      try {
        localStorage.setItem(SLOTS_KEY, JSON.stringify(result));
        localStorage.setItem(DEFAULT_LINEUP_VERSION_KEY, String(DEFAULT_LINEUP_VERSION));
      } catch (e) {}
      return result;
    }

    try {
      var raw = localStorage.getItem(SLOTS_KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        SLOT_DEFS.forEach(function (def) {
          if (obj && Object.prototype.hasOwnProperty.call(obj, def.id)) {
            result[def.id] = obj[def.id];
          }
        });
      }
    } catch (e) {}
    return result;
  }

  function saveSlots() {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
  }

  function loadStopAdvancesSetting() {
    try {
      var raw = localStorage.getItem(STOP_ADVANCES_KEY);
      if (raw === null) return true; // default: Stop also advances to next batter
      return raw === '1';
    } catch (e) {
      return true;
    }
  }

  function saveStopAdvancesSetting() {
    localStorage.setItem(STOP_ADVANCES_KEY, stopAdvancesEnabled ? '1' : '0');
  }

  // Default ON: overlapping announcer/song playback (halfway-through, the
  // 2026-09-15 A/B-tested standard) is what every real player's
  // announcerOverlapFraction drives in firePlayback(). Turning this off
  // falls back to the plain sequential path (full name clip, then song)
  // regardless of what announcerOverlapFraction is set to per player.
  function loadAnnouncerOverlapSetting() {
    try {
      var raw = localStorage.getItem(ANNOUNCER_OVERLAP_KEY);
      if (raw === null) return true;
      return raw === '1';
    } catch (e) {
      return true;
    }
  }

  function saveAnnouncerOverlapSetting() {
    localStorage.setItem(ANNOUNCER_OVERLAP_KEY, announcerOverlapEnabled ? '1' : '0');
  }

  // Default ON: name-announcer clips play before/with each song, same as
  // today. Turning this off makes firePlayback() treat every player as if
  // it had no name clip at all for that play — walk-up songs play by
  // themselves, on-the-fly, without needing to touch any per-player data.
  function loadAnnouncerEnabledSetting() {
    try {
      var raw = localStorage.getItem(ANNOUNCER_ENABLED_KEY);
      if (raw === null) return true;
      return raw === '1';
    } catch (e) {
      return true;
    }
  }

  function saveAnnouncerEnabledSetting() {
    localStorage.setItem(ANNOUNCER_ENABLED_KEY, announcerEnabled ? '1' : '0');
  }

  function rebuildLibrary() {
    library = bundledPlayers.concat(localPlayers).sort(function (a, b) {
      return (Number(a.number) || 0) - (Number(b.number) || 0);
    });
  }

  // Clears any slot still pointing at a player id that no longer exists in
  // the library — e.g. a bundled roster.json entry removed because a kid
  // left the team, while a device's saved lineup still has them assigned.
  // selectSlot() already treats such a "ghost" slot as empty for tap
  // purposes, but this actually cleans up the persisted state instead of
  // just masking it every time, so it doesn't linger indefinitely. Only
  // ever fires right after init's first rebuildLibrary(), before anything
  // is rendered, so there's no risk of racing a real assignment made during
  // the session.
  function pruneStaleSlots() {
    var changed = false;
    Object.keys(slots).forEach(function (slotId) {
      var playerId = slots[slotId];
      if (!playerId) return;
      var stillExists = library.some(function (p) { return p.id === playerId; });
      if (!stillExists) { slots[slotId] = null; changed = true; }
    });
    if (changed) saveSlots();
  }

  // Only bundled (roster.json) songs depend on the network/service-worker
  // cache — phone-added songs live in IndexedDB and are always available
  // offline regardless. This tells you whether a song could actually
  // silently fail to play at the field before it happens, not after.
  function checkOfflineCacheStatus() {
    var el = document.getElementById('offline-status');
    if (!el) return;
    if (!('caches' in window) || bundledPlayers.length === 0) {
      el.classList.remove('visible');
      return;
    }
    var files = bundledPlayers.filter(function (p) { return p.file; })
      .map(function (p) { return './' + p.file; });
    Promise.all(files.map(function (url) {
      return caches.match(url).then(function (res) { return !!res; }).catch(function () { return false; });
    })).then(function (results) {
      var total = results.length;
      var cached = results.filter(Boolean).length;
      el.classList.add('visible');
      if (cached === total) {
        el.textContent = 'All ' + total + ' songs ready offline';
        el.className = 'offline-status visible offline-status-ok';
      } else {
        el.textContent = (total - cached) + ' of ' + total + ' songs not downloaded yet — connect to Wi-Fi and tap Refresh below';
        el.className = 'offline-status visible offline-status-warn';
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Playback (select-then-confirm) ----------
  // A tap only ever selects a slot; nothing plays until the dedicated Play
  // button in the bottom bar is pressed. This is a deliberate safety step —
  // a mis-tap on the wrong slot no longer fires that player's song.
  function selectSlot(slotId) {
    var playerId = slots[slotId];
    // Checking the resolved player (not just a truthy id) also catches a
    // "ghost" slot — one whose assigned id no longer exists in the library
    // because a bundled roster.json entry was removed out from under it
    // (e.g. a player leaving the team) — and routes it through the same
    // assign flow as a genuinely empty slot, matching what the tile itself
    // already shows ("+ Assign").
    var player = playerId ? library.filter(function (p) { return p.id === playerId; })[0] : null;
    if (!player) { openAssignSheet(slotId); return; }
    selectedSlot = slotId;
    renderGrid();
    updateActionBar();
  }

  function clampSelection() {
    if (selectedSlot && !slots[selectedSlot]) selectedSlot = null;
  }

  function stopPlayback() {
    var audio = document.getElementById('player-audio');
    // Clear the sequencer's own onended chaining and pending completion
    // callback FIRST — otherwise pausing/rewinding here can still let a
    // queued step or the completion callback fire after a manual stop.
    audio.onended = null;
    if (activeBufferSource) {
      // Null onended before stop() — stop() fires 'ended' too, and a manual
      // stop must never trigger the chain-continuation/completion callback.
      activeBufferSource.onended = null;
      try { activeBufferSource.stop(); } catch (e) {}
      activeBufferSource = null;
    }
    if (secondaryBufferSource) {
      secondaryBufferSource.onended = null;
      try { secondaryBufferSource.stop(); } catch (e) {}
      secondaryBufferSource = null;
    }
    activeSequenceOnComplete = null;
    audio.pause();
    audio.currentTime = 0;
    currentPlayingSlot = null;
  }

  // Plays a list of clip URLs back-to-back on the single shared player-audio
  // element, skipping any null/unset entries. onComplete fires once after the
  // whole sequence finishes naturally (not on a manual stop) — never after an
  // individual clip in the middle of the sequence. Reusable anywhere clips
  // need to chain, e.g. a name-announcement clip before a player's walk-up
  // song.
  function playSequence(urls, onComplete) {
    var audio = document.getElementById('player-audio');
    var queue = (urls || []).filter(Boolean).slice();
    activeSequenceOnComplete = onComplete || null;

    function playNext() {
      if (queue.length === 0) {
        audio.onended = null;
        var cb = activeSequenceOnComplete;
        activeSequenceOnComplete = null;
        if (cb) cb();
        return;
      }
      audio.pause();
      audio.src = queue.shift();
      audio.currentTime = 0;
      audio.onended = playNext;
      audio.play().catch(function () {});
    }
    playNext();
  }

  // Buffer-based equivalent of playSequence — used only when every clip in
  // the sequence has a pre-decoded AudioBuffer available, so playback is
  // source.start(0) on already-decoded audio with zero decode-on-tap delay.
  // AudioBufferSourceNodes are one-shot (the spec disallows restarting one
  // after stop/ended), so a fresh node is created for every clip in the queue.
  function playSequenceBuffers(buffers, onComplete) {
    var queue = (buffers || []).filter(Boolean).slice();
    activeSequenceOnComplete = onComplete || null;

    function playNext() {
      if (queue.length === 0) {
        activeBufferSource = null;
        var cb = activeSequenceOnComplete;
        activeSequenceOnComplete = null;
        if (cb) cb();
        return;
      }
      var source = audioCtx.createBufferSource();
      source.buffer = queue.shift();
      source.connect(audioCtx.destination);
      source.onended = playNext;
      activeBufferSource = source;
      source.start(0);
    }
    playNext();
  }

  // Plays the name clip and walk-up song concurrently instead of back-to-
  // back, starting the song `delaySeconds` after the name clip begins (0 =
  // fully simultaneous). Settled 2026-09-15 after Jason A/B tested this
  // against fully-simultaneous (0) and plain sequential — halfway-through
  // (fraction 0.5, see announcerOverlapFraction) won and is now the
  // standard for every real roster player. Both sources are scheduled off
  // the SAME audioCtx.currentTime reference via source.start(), which is
  // sample-accurate — far more reliable than a setTimeout-based delay for
  // keeping two clips in sync. activeBufferSource always tracks the song
  // (the primary clip — its completion is what actually ends the at-bat
  // and drives auto-advance); secondaryBufferSource tracks the name clip
  // purely so stopPlayback() can silence it too if it's still playing when
  // the user manually stops. Buffer-path only, no <audio>-element fallback
  // — every real player already decodes successfully in practice, so this
  // hasn't been a real gap.
  function playOverlappingBuffers(nameClipBuffer, songBuffer, delaySeconds, onComplete) {
    var startAt = audioCtx.currentTime;

    var nameSource = audioCtx.createBufferSource();
    nameSource.buffer = nameClipBuffer;
    nameSource.connect(audioCtx.destination);
    secondaryBufferSource = nameSource;
    nameSource.onended = function () {
      if (secondaryBufferSource === nameSource) secondaryBufferSource = null;
    };
    nameSource.start(startAt);

    var songSource = audioCtx.createBufferSource();
    songSource.buffer = songBuffer;
    songSource.connect(audioCtx.destination);
    activeBufferSource = songSource;
    songSource.onended = function () {
      if (activeBufferSource === songSource) activeBufferSource = null;
      if (onComplete) onComplete();
    };
    songSource.start(startAt + delaySeconds);
  }

  function songSrcFor(player) {
    if (!player) return null;
    return player.source === 'bundled' ? player.file : objectUrlCache.get(player.id);
  }

  function nameClipSrcFor(player) {
    if (!player) return null;
    if (player.source === 'bundled') return player.nameClipFile || null;
    return player.hasNameClip ? nameClipObjectUrlCache.get(player.id) : null;
  }

  function songBufferFor(player) {
    if (!player) return null;
    return songBufferCache.get(player.id) || null;
  }

  function nameClipBufferFor(player) {
    if (!player) return null;
    return nameClipBufferCache.get(player.id) || null;
  }

  function firePlayback(slotId) {
    var playerId = slots[slotId];
    var player = library.filter(function (p) { return p.id === playerId; })[0];
    if (!player) return;
    var songSrc = songSrcFor(player);
    if (!songSrc) return;
    currentPlayingSlot = slotId;

    function onFinished() {
      var finishedSlot = slotId;
      currentPlayingSlot = null;
      // Only auto-advance if the user hasn't already tapped ahead to a
      // different slot while this sequence was finishing out.
      if (selectedSlot === finishedSlot) advanceToNextLineupSlot(finishedSlot);
      renderGrid();
      updateActionBar();
    }

    // Use the pre-decoded buffer path only when the WHOLE sequence for this
    // play can run on buffers — never mix a decoded buffer with a URL-based
    // clip in the same play, which would need a much harder mixed-node/
    // mixed-element state machine to sequence correctly.
    //
    // When the Play Announcers setting is off, treat this player as if it
    // had no name clip at all for this one play — nulling both the src and
    // the buffer here (rather than just skipping playback of them further
    // down) means every branch below, including the overlap-mode check,
    // automatically falls through to "just play the song" with no separate
    // gating needed.
    var nameClipSrc = announcerEnabled ? nameClipSrcFor(player) : null;
    var needsNameClip = !!nameClipSrc;
    var songBuffer = songBufferFor(player);
    var nameClipBuffer = announcerEnabled ? nameClipBufferFor(player) : null;

    // Overlapping announcer/song playback: only kicks in when a player's
    // roster.json entry sets announcerOverlapFraction (a number 0-1 — 0.5,
    // the settled standard, starts the song once the name clip is halfway
    // done). Team songs and any player without a name clip never set this,
    // so they fall through to the normal sequential path below unchanged —
    // as would a buffer-decode failure for either clip.
    if (announcerOverlapEnabled && audioCtx && songBuffer && needsNameClip && nameClipBuffer &&
        typeof player.announcerOverlapFraction === 'number') {
      var delay = nameClipBuffer.duration * player.announcerOverlapFraction;
      playOverlappingBuffers(nameClipBuffer, songBuffer, delay, onFinished);
      return;
    }

    if (audioCtx && songBuffer && (!needsNameClip || nameClipBuffer)) {
      playSequenceBuffers([nameClipBuffer, songBuffer], onFinished);
    } else {
      // Graceful fallback is automatic: playSequence() drops the null name
      // clip entry when a player has none (or when Play Announcers is off),
      // and just plays the song.
      playSequence([nameClipSrc, songSrc], onFinished);
    }
  }

  function toggleActionPlay() {
    if (!selectedSlot) return;
    // Tapping Play again on the slot that's already playing stops it and
    // rewinds to the start — the next Play always starts fresh from the top.
    if (currentPlayingSlot === selectedSlot) {
      var stoppedSlot = selectedSlot;
      stopPlayback();
      // Whether a manual Stop counts as "that batter's at-bat is over" (and
      // should advance) vs. "I stopped it early" (and shouldn't) is a real
      // judgment call that depends on live-game feel — the ADV toggle in
      // the header lets that be decided/changed on the fly instead of
      // baked in as one fixed behavior.
      if (stopAdvancesEnabled) advanceToNextLineupSlot(stoppedSlot);
    } else {
      firePlayback(selectedSlot);
    }
    renderGrid();
    updateActionBar();
  }

  function openEditForSelected() {
    if (!selectedSlot) return;
    openAssignSheet(selectedSlot);
  }

  function updateStopAdvanceSwitch() {
    var el = document.getElementById('setting-stop-advance');
    if (!el) return;
    el.checked = stopAdvancesEnabled;
  }

  function updateAnnouncerOverlapSwitch() {
    var el = document.getElementById('setting-announcer-overlap');
    if (!el) return;
    el.checked = announcerOverlapEnabled;
  }

  function updateAnnouncerEnabledSwitch() {
    var el = document.getElementById('setting-announcer-enabled');
    if (!el) return;
    el.checked = announcerEnabled;
  }

  // A song that finishes on its own (not manually stopped) means that
  // batter's at-bat is over — auto-select the next filled lineup slot so
  // the next song is already queued up and Play is the only tap needed.
  // Skips empty slots and wraps from #12 back to #1, same as a real order.
  function advanceToNextLineupSlot(finishedSlotId) {
    var idx = LINEUP_IDS.indexOf(finishedSlotId);
    if (idx === -1) return; // Walkout/Victory have no "next batter" concept
    for (var i = 1; i <= LINEUP_IDS.length; i++) {
      var candidate = LINEUP_IDS[(idx + i) % LINEUP_IDS.length];
      if (slots[candidate]) { selectedSlot = candidate; return; }
    }
  }

  function updateActionBar() {
    var playBtn = document.getElementById('action-play');
    var editBtn = document.getElementById('action-edit');
    if (!selectedSlot) {
      playBtn.disabled = true;
      playBtn.textContent = 'Select a Song';
      playBtn.classList.remove('stop-state');
      editBtn.disabled = true;
      return;
    }
    editBtn.disabled = false;
    playBtn.disabled = false;
    if (currentPlayingSlot === selectedSlot) {
      playBtn.textContent = 'STOP';
      playBtn.classList.add('stop-state');
    } else {
      playBtn.textContent = 'PLAY';
      playBtn.classList.remove('stop-state');
    }
  }

  // ---------- Rendering ----------
  var LONG_PRESS_MS = 500;

  function lastNameOf(fullName) {
    var parts = (fullName || '').trim().split(/\s+/);
    return parts[parts.length - 1] || fullName;
  }

  function bindSlotInteraction(div, def) {
    var slotId = def.id;
    var pressTimer = null;
    var longPressFired = false;

    function clearTimer() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }

    div.addEventListener('pointerdown', function (e) {
      longPressFired = false;
      clearTimer();
      // Only the numbered batting-order slots can be dragged/reordered —
      // the Walkout/Victory row isn't sequential, so long-press there is a no-op.
      if (def.kind === 'lineup' && slots[slotId]) {
        pressTimer = setTimeout(function () {
          longPressFired = true;
          armDrag(slotId, div, e);
        }, LONG_PRESS_MS);
      }
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
      div.addEventListener(evt, clearTimer);
    });

    div.addEventListener('click', function () {
      if (longPressFired) { longPressFired = false; return; }
      selectSlot(slotId);
    });
  }

  // ---------- Drag-to-reorder (lineup slots only) ----------
  function armDrag(slotId, div, downEvent) {
    var rects = [];
    LINEUP_IDS.forEach(function (id) {
      var el = document.querySelector('.slot-btn[data-slot-id="' + id + '"]');
      if (el) rects.push({ id: id, rect: el.getBoundingClientRect() });
    });
    dragState = {
      sourceId: slotId,
      el: div,
      rects: rects,
      startX: downEvent.clientX,
      startY: downEvent.clientY,
      lastTargetId: slotId
    };
    div.classList.add('dragging');
    // Haptic pickup cue where supported (Android Chrome). iOS Safari has no
    // Vibration API at all, so this is a silent no-op on iPhone — the blue
    // dragging outline is the cue that actually reaches every device.
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragState) return;
    e.preventDefault();
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    dragState.el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';

    var nearest = null, nearestDist = Infinity;
    dragState.rects.forEach(function (r) {
      var cx = r.rect.left + r.rect.width / 2;
      var cy = r.rect.top + r.rect.height / 2;
      var d = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (d < nearestDist) { nearestDist = d; nearest = r; }
    });
    if (nearest && nearest.id !== dragState.lastTargetId) {
      var prevEl = document.querySelector('.slot-btn[data-slot-id="' + dragState.lastTargetId + '"]');
      if (prevEl) prevEl.classList.remove('drag-target');
      if (nearest.id !== dragState.sourceId) {
        var nextEl = document.querySelector('.slot-btn[data-slot-id="' + nearest.id + '"]');
        if (nextEl) nextEl.classList.add('drag-target');
      }
      dragState.lastTargetId = nearest.id;
    }
  }

  function onDragEnd() {
    if (!dragState) return;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);

    var sourceId = dragState.sourceId;
    var targetId = dragState.lastTargetId;
    document.querySelectorAll('.drag-target').forEach(function (el) { el.classList.remove('drag-target'); });
    dragState = null;

    if (targetId && targetId !== sourceId) {
      reorderLineup(sourceId, targetId);
    } else {
      renderGrid();
    }
  }

  function reorderLineup(sourceId, targetId) {
    var fromIdx = LINEUP_IDS.indexOf(sourceId);
    var toIdx = LINEUP_IDS.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    var values = LINEUP_IDS.map(function (id) { return slots[id]; });
    var moved = values.splice(fromIdx, 1)[0];
    values.splice(toIdx, 0, moved);
    LINEUP_IDS.forEach(function (id, i) { slots[id] = values[i]; });
    saveSlots();

    // Reordering can scramble what "currently playing"/"selected" pointed
    // at — safer to reset both than risk the bar highlighting a slot that
    // no longer holds the song it was pointing to.
    stopPlayback();
    selectedSlot = null;

    renderGrid();
    updateActionBar();
  }

  function buildSlotButton(def) {
    var playerId = slots[def.id];
    var player = playerId ? library.filter(function (p) { return p.id === playerId; })[0] : null;

    var div = document.createElement('div');
    var classes = ['slot-btn', def.kind];
    var stateClass = 'filled';
    if (currentPlayingSlot === def.id) stateClass = 'playing filled';
    else if (selectedSlot === def.id) stateClass = 'selected filled';
    classes.push(player ? stateClass : 'empty');
    div.className = classes.join(' ');
    div.setAttribute('role', 'button');
    div.dataset.slotId = def.id;

    // Once a lineup slot has a player, its name + number identify it —
    // the slot tag ("#7") is redundant. Team-song slots keep their tag
    // (WALKOUT 1 / VICTORY) since there's no number to take its place.
    if (!player || def.kind !== 'lineup') {
      var tagSpan = document.createElement('span');
      tagSpan.className = 'slot-order';
      tagSpan.textContent = def.tag;
      div.appendChild(tagSpan);
    }

    if (player) {
      if (def.kind === 'lineup') {
        var name = document.createElement('div');
        name.className = 'slot-name slot-lastname';
        name.textContent = lastNameOf(player.name).toUpperCase();
        div.appendChild(name);

        if (player.number) {
          var num = document.createElement('div');
          num.className = 'slot-num';
          num.textContent = player.number;
          div.appendChild(num);
        }
      } else {
        var teamName = document.createElement('div');
        teamName.className = 'slot-name';
        teamName.textContent = player.name;
        div.appendChild(teamName);
      }
    } else {
      var label = document.createElement('div');
      label.className = 'slot-empty-label';
      label.textContent = '+ Assign';
      div.appendChild(label);
    }

    bindSlotInteraction(div, def);

    return div;
  }

  function renderGrid() {
    var grid = document.getElementById('lineup-grid');
    grid.innerHTML = '';
    SLOT_DEFS.forEach(function (def) {
      grid.appendChild(buildSlotButton(def));
    });
  }

  function renderManageList() {
    var list = document.getElementById('manage-player-list');
    list.innerHTML = '';
    var query = (document.getElementById('manage-search').value || '').trim().toLowerCase();
    var visible = query
      ? library.filter(function (p) {
          return p.name.toLowerCase().indexOf(query) !== -1 ||
            (p.number && String(p.number).toLowerCase().indexOf(query) !== -1);
        })
      : library;
    if (library.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'src-tag';
      empty.textContent = 'No songs yet — add one below.';
      list.appendChild(empty);
    } else if (visible.length === 0) {
      var noMatch = document.createElement('div');
      noMatch.className = 'src-tag';
      noMatch.textContent = 'No matches for "' + query + '".';
      list.appendChild(noMatch);
    }
    visible.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'manage-row';
      row.innerHTML = (p.number ? '<span class="num">' + escapeHtml(p.number) + '</span>' : '') +
        '<span class="name">' + escapeHtml(p.name) + (p.guestSong ? ' — ' + escapeHtml(p.guestSong) + (p.guestDefault ? ' (default)' : '') : '') + '</span>';
      if (p.source === 'local') {
        var delBtn = document.createElement('button');
        delBtn.className = 'list-row delete-row';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', function () { deletePlayer(p); });
        row.appendChild(delBtn);
      } else {
        var tag = document.createElement('span');
        tag.className = 'src-tag';
        tag.textContent = 'built-in';
        row.appendChild(tag);
      }
      list.appendChild(row);
    });
  }

  function deletePlayer(p) {
    if (!confirm('Remove "' + p.name + '" from the team?')) return;
    idbDelete(STORE, p.id).then(function () {
      var url = objectUrlCache.get(p.id);
      if (url) { URL.revokeObjectURL(url); objectUrlCache.delete(p.id); }
      var nameUrl = nameClipObjectUrlCache.get(p.id);
      if (nameUrl) { URL.revokeObjectURL(nameUrl); nameClipObjectUrlCache.delete(p.id); }
      songBufferCache.delete(p.id);
      nameClipBufferCache.delete(p.id);
      localPlayers = localPlayers.filter(function (x) { return x.id !== p.id; });
      Object.keys(slots).forEach(function (slotId) {
        if (slots[slotId] === p.id) slots[slotId] = null;
      });
      saveSlots();
      if (currentPlayingSlot && !slots[currentPlayingSlot]) stopPlayback();
      clampSelection();
      rebuildLibrary();
      renderManageList();
      renderGrid();
      updateActionBar();
    });
  }

  function openAssignSheet(slotId) {
    currentAssignSlot = slotId;
    var def = findSlotDef(slotId);
    document.getElementById('assign-sheet-title').textContent =
      def.kind === 'special' ? 'Assign ' + def.tag : 'Assign Slot ' + def.tag;
    var list = document.getElementById('assign-player-list');
    list.innerHTML = '';
    // Team slots (Walkout/Victory) only take full team songs (no jersey
    // number); lineup slots only take a player's own walk-up song (has a
    // jersey number). Keeps the two song pools from getting cross-assigned.
    var eligible = library.filter(function (p) {
      return def.kind === 'special' ? !p.number : !!p.number;
    });
    if (eligible.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'src-tag';
      empty.textContent = library.length === 0
        ? 'No songs yet. Add songs from Manage Team first.'
        : (def.kind === 'special'
          ? 'No team songs yet. Add one from Manage Team (leave # blank).'
          : 'No walk-up songs yet. Add one from Manage Team with a jersey #.');
      list.appendChild(empty);
    }
    var assignedIds = {};
    Object.keys(slots).forEach(function (id) {
      if (slots[id]) assignedIds[slots[id]] = true;
    });
    // Not-yet-picked players/songs float to the top, so the sheet leads with
    // who's actually still available to assign. Stable sort preserves the
    // existing relative order within each group.
    var sortedLibrary = eligible.slice().sort(function (a, b) {
      return (assignedIds[a.id] ? 1 : 0) - (assignedIds[b.id] ? 1 : 0);
    });
    sortedLibrary.forEach(function (p) {
      var row = document.createElement('button');
      row.className = 'list-row';
      // Guest roster entries all share the same name/number ("Guest" / "?")
      // so they're indistinguishable in this list without their song name —
      // guestSong/guestDefault (see bundledPlayers mapping) fill that in.
      row.innerHTML = (p.number ? '<span class="num">' + escapeHtml(p.number) + '</span>' : '') +
        '<span>' + escapeHtml(p.name) + (p.guestSong ? ' — ' + escapeHtml(p.guestSong) + (p.guestDefault ? ' (default)' : '') : '') + '</span>' +
        '<span class="src-tag">' + (p.source === 'bundled' ? 'built-in' : 'phone') + '</span>';
      row.addEventListener('click', function () {
        slots[currentAssignSlot] = p.id;
        saveSlots();
        // The assigned song changed under this slot — if it was mid-playback,
        // the audio no longer matches what the slot now shows, so stop it.
        if (currentPlayingSlot === currentAssignSlot) stopPlayback();
        closeSheet('assign-sheet');
        renderGrid();
        updateActionBar();
      });
      list.appendChild(row);
    });
    showSheet('assign-sheet');
  }

  function showSheet(id) { document.getElementById(id).classList.remove('hidden'); }
  function closeSheet(id) { document.getElementById(id).classList.add('hidden'); }

  // ---------- Soundboard ----------
  function rebuildSoundboardLibrary() {
    soundboardClips = bundledSoundboardClips.concat(
      localSoundboardClips.slice().sort(function (a, b) { return a.label.localeCompare(b.label); })
    );
  }

  function soundboardSrcFor(clip) {
    if (!clip) return null;
    return clip.source === 'bundled' ? clip.file : soundboardObjectUrlCache.get(clip.id);
  }

  function stopSoundboardClip(clipId) {
    var entry = activeSoundboardSounds.get(clipId);
    if (!entry) return;
    if (entry.kind === 'buffer') {
      entry.source.onended = null;
      try { entry.source.stop(); } catch (e) {}
    } else {
      entry.audio.pause();
      entry.audio.currentTime = 0;
    }
    activeSoundboardSounds.delete(clipId);
  }

  // Starts (or restarts) a soundboard clip via a fresh AudioBufferSourceNode.
  // Buffer sources are one-shot/can't seek, so "restart" always means a
  // brand new node rather than rewinding an existing one.
  function startSoundboardBufferClip(clipId, buffer) {
    var source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.onended = function () {
      activeSoundboardSounds.delete(clipId);
      renderSoundboardGrid();
    };
    activeSoundboardSounds.set(clipId, { kind: 'buffer', source: source });
    source.start(0);
  }

  // Tap a tile: if nothing's playing, start it, layering on top of anything
  // else already playing (each clip plays independently — the shared
  // player-audio element is reserved for lineup playback). Tap it again while
  // playing: a short one-shot stinger restarts from the top, a longer
  // loop-style sound stops. Uses a pre-decoded AudioBuffer when available,
  // falling back to a plain Audio element (the only way to play a clip that
  // hasn't been decoded yet) otherwise.
  function toggleSoundboardClip(clipId) {
    var existing = activeSoundboardSounds.get(clipId);
    if (existing) {
      var duration = existing.kind === 'buffer' ? existing.source.buffer.duration : existing.audio.duration;
      if (duration && duration <= SOUND_STINGER_MAX_SECONDS) {
        if (existing.kind === 'buffer') {
          var buffer = existing.source.buffer;
          existing.source.onended = null;
          try { existing.source.stop(); } catch (e) {}
          activeSoundboardSounds.delete(clipId);
          startSoundboardBufferClip(clipId, buffer);
        } else {
          existing.audio.currentTime = 0;
          existing.audio.play().catch(function () {});
        }
      } else {
        stopSoundboardClip(clipId);
      }
    } else {
      var clip = soundboardClips.filter(function (c) { return c.id === clipId; })[0];
      if (!clip) return;
      var decodedBuffer = soundboardBufferCache.get(clip.id);
      if (audioCtx && decodedBuffer) {
        startSoundboardBufferClip(clipId, decodedBuffer);
      } else {
        var src = soundboardSrcFor(clip);
        if (!src) return;
        var audio = new Audio(src);
        var clear = function () {
          activeSoundboardSounds.delete(clipId);
          renderSoundboardGrid();
        };
        audio.addEventListener('ended', clear);
        audio.addEventListener('error', clear);
        audio.play().catch(function () {});
        activeSoundboardSounds.set(clipId, { kind: 'audio', audio: audio });
      }
    }
    renderSoundboardGrid();
  }

  // Only phone-added (local) clips can be edited/replaced/deleted — bundled
  // clips ship the same for everyone via soundboard.json, same as a bundled
  // player's song can't be deleted from Manage Team either.
  function bindSoundboardTileInteraction(tile, clip) {
    var pressTimer = null;
    var longPressFired = false;

    function clearTimer() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }

    tile.addEventListener('pointerdown', function () {
      longPressFired = false;
      clearTimer();
      if (clip.source === 'local') {
        pressTimer = setTimeout(function () {
          longPressFired = true;
          openSoundboardEditSheet(clip.id);
        }, LONG_PRESS_MS);
      }
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
      tile.addEventListener(evt, clearTimer);
    });

    tile.addEventListener('click', function () {
      if (longPressFired) { longPressFired = false; return; }
      toggleSoundboardClip(clip.id);
    });
  }

  function renderSoundboardGrid() {
    var grid = document.getElementById('soundboard-grid');
    if (!grid) return;
    grid.innerHTML = '';
    soundboardClips.forEach(function (clip) {
      var tile = document.createElement('div');
      tile.className = 'soundboard-tile' + (activeSoundboardSounds.has(clip.id) ? ' playing' : '');
      tile.setAttribute('role', 'button');
      tile.dataset.clipId = clip.id;
      if (clip.icon) {
        var icon = document.createElement('div');
        icon.className = 'soundboard-tile-icon';
        icon.textContent = clip.icon;
        tile.appendChild(icon);
      }
      var label = document.createElement('div');
      label.className = 'soundboard-tile-label';
      label.textContent = clip.label;
      tile.appendChild(label);
      bindSoundboardTileInteraction(tile, clip);
      grid.appendChild(tile);
    });
  }

  function openSoundboardEditSheet(clipId) {
    var clip = localSoundboardClips.filter(function (c) { return c.id === clipId; })[0];
    if (!clip) return;
    soundboardEditingId = clipId;
    document.getElementById('soundboard-edit-title').textContent = 'Edit Sound';
    document.getElementById('soundboard-clip-label').value = clip.label;
    document.getElementById('soundboard-clip-file').value = '';
    document.getElementById('soundboard-file-label-text').textContent = 'Replace sound (MP3)';
    document.getElementById('soundboard-delete-btn').classList.remove('hidden');
    showSheet('soundboard-edit-sheet');
  }

  function saveSoundboardClip(label, file) {
    if (soundboardEditingId) {
      var clip = localSoundboardClips.filter(function (c) { return c.id === soundboardEditingId; })[0];
      if (!clip) return Promise.resolve();
      clip.label = label;
      if (file) {
        stopSoundboardClip(clip.id);
        var oldUrl = soundboardObjectUrlCache.get(clip.id);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        return idbPut(SOUND_STORE, { id: clip.id, label: label, blob: file }).then(function () {
          soundboardObjectUrlCache.set(clip.id, URL.createObjectURL(file));
          decodeOneInto(soundboardBufferCache, clip.id, file.arrayBuffer());
          rebuildSoundboardLibrary();
        });
      }
      // Label-only edit — re-fetch the existing blob rather than trusting a
      // cached copy, since idbPut overwrites the whole record.
      return idbGet(SOUND_STORE, clip.id).then(function (rec) {
        return idbPut(SOUND_STORE, { id: clip.id, label: label, blob: rec.blob });
      }).then(function () {
        rebuildSoundboardLibrary();
      });
    }
    var id = 'sound-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    return idbPut(SOUND_STORE, { id: id, label: label, blob: file }).then(function () {
      soundboardObjectUrlCache.set(id, URL.createObjectURL(file));
      decodeOneInto(soundboardBufferCache, id, file.arrayBuffer());
      localSoundboardClips.push({ id: id, label: label, source: 'local' });
      rebuildSoundboardLibrary();
    });
  }

  function deleteSoundboardClip(clipId) {
    var clip = localSoundboardClips.filter(function (c) { return c.id === clipId; })[0];
    if (!clip) return;
    if (!confirm('Delete "' + clip.label + '"?')) return;
    stopSoundboardClip(clip.id);
    idbDelete(SOUND_STORE, clip.id).then(function () {
      var url = soundboardObjectUrlCache.get(clip.id);
      if (url) { URL.revokeObjectURL(url); soundboardObjectUrlCache.delete(clip.id); }
      soundboardBufferCache.delete(clip.id);
      localSoundboardClips = localSoundboardClips.filter(function (c) { return c.id !== clip.id; });
      rebuildSoundboardLibrary();
      renderSoundboardGrid();
      closeSheet('soundboard-edit-sheet');
    });
  }

  function bindSoundboardEvents() {
    document.getElementById('btn-soundboard').addEventListener('click', function () {
      var isOpen = document.getElementById('soundboard-panel').classList.toggle('open');
      this.classList.toggle('active', isOpen);
    });
    document.getElementById('soundboard-stop-all').addEventListener('click', function () {
      activeSoundboardSounds.forEach(function (entry) {
        if (entry.kind === 'buffer') {
          entry.source.onended = null;
          try { entry.source.stop(); } catch (e) {}
        } else {
          entry.audio.pause();
          entry.audio.currentTime = 0;
        }
      });
      activeSoundboardSounds.clear();
      renderSoundboardGrid();
    });

    var clipFileInput = document.getElementById('soundboard-clip-file');
    clipFileInput.addEventListener('change', function () {
      var f = clipFileInput.files[0];
      var fallback = soundboardEditingId ? 'Replace sound (MP3)' : 'Choose sound (MP3)';
      document.getElementById('soundboard-file-label-text').textContent = f ? f.name : fallback;
    });

    document.getElementById('soundboard-save-btn').addEventListener('click', function () {
      var label = document.getElementById('soundboard-clip-label').value.trim();
      var file = clipFileInput.files[0] || null;
      if (!label) { alert('Please enter a label for this sound.'); return; }
      if (!soundboardEditingId && !file) { alert('Please choose a sound file.'); return; }
      saveSoundboardClip(label, file).then(function () {
        renderSoundboardGrid();
        closeSheet('soundboard-edit-sheet');
      });
    });

    document.getElementById('soundboard-delete-btn').addEventListener('click', function () {
      if (soundboardEditingId) deleteSoundboardClip(soundboardEditingId);
    });
  }

  // ---------- Add player form ----------
  function bindAddPlayerForm() {
    var fileInput = document.getElementById('new-player-file');
    var fileLabelText = document.getElementById('file-label-text');
    fileInput.addEventListener('change', function () {
      var f = fileInput.files[0];
      fileLabelText.textContent = f ? f.name : 'Choose song (MP3)';
    });

    var nameClipInput = document.getElementById('new-player-nameclip-file');
    var nameClipLabelText = document.getElementById('name-clip-label-text');
    var clearNameClipBtn = document.getElementById('clear-nameclip-btn');
    nameClipInput.addEventListener('change', function () {
      var f = nameClipInput.files[0];
      nameClipLabelText.textContent = f ? f.name : 'Name announcement (optional)';
      clearNameClipBtn.classList.toggle('hidden', !f);
    });
    clearNameClipBtn.addEventListener('click', function () {
      nameClipInput.value = '';
      nameClipLabelText.textContent = 'Name announcement (optional)';
      clearNameClipBtn.classList.add('hidden');
    });

    document.getElementById('add-player-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var numberInput = document.getElementById('new-player-number');
      var nameInput = document.getElementById('new-player-name');
      var number = numberInput.value.trim();
      var name = nameInput.value.trim();
      var file = fileInput.files[0];
      var nameClipFile = nameClipInput.files[0] || null;
      if (!name || !file) {
        alert('Please fill in a name and choose a song file. (Jersey # is optional — leave it blank for team songs like Walkout or Victory.)');
        return;
      }
      if (number) {
        var dupe = library.filter(function (p) { return p.number && String(p.number) === number; })[0];
        if (dupe && !confirm('Jersey #' + number + ' is already assigned to ' + dupe.name + '. Add "' + name + '" as well?')) {
          return;
        }
      }
      var id = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      var record = { id: id, number: number, name: name, blob: file };
      if (nameClipFile) record.nameClipBlob = nameClipFile;
      idbPut(STORE, record).then(function () {
        var url = URL.createObjectURL(file);
        objectUrlCache.set(id, url);
        decodeOneInto(songBufferCache, id, file.arrayBuffer());
        var hasNameClip = false;
        if (nameClipFile) {
          var nameUrl = URL.createObjectURL(nameClipFile);
          nameClipObjectUrlCache.set(id, nameUrl);
          decodeOneInto(nameClipBufferCache, id, nameClipFile.arrayBuffer());
          hasNameClip = true;
        }
        localPlayers.push({ id: id, number: number, name: name, source: 'local', hasNameClip: hasNameClip });
        rebuildLibrary();
        renderManageList();
        numberInput.value = '';
        nameInput.value = '';
        fileInput.value = '';
        fileLabelText.textContent = 'Choose song (MP3)';
        nameClipInput.value = '';
        nameClipLabelText.textContent = 'Name announcement (optional)';
        clearNameClipBtn.classList.add('hidden');
      });
    });
  }

  // ---------- Static event bindings ----------
  function bindEvents() {
    document.getElementById('action-play').addEventListener('click', toggleActionPlay);
    document.getElementById('action-edit').addEventListener('click', openEditForSelected);

    document.getElementById('btn-manage-team').addEventListener('click', function () {
      document.getElementById('manage-search').value = '';
      renderManageList();
      checkOfflineCacheStatus();
      showSheet('manage-team');
    });

    document.getElementById('manage-search').addEventListener('input', function () {
      renderManageList();
    });

    document.getElementById('setting-stop-advance').addEventListener('change', function (e) {
      stopAdvancesEnabled = e.target.checked;
      saveStopAdvancesSetting();
    });

    document.getElementById('setting-announcer-overlap').addEventListener('change', function (e) {
      announcerOverlapEnabled = e.target.checked;
      saveAnnouncerOverlapSetting();
    });

    document.getElementById('setting-announcer-enabled').addEventListener('change', function (e) {
      announcerEnabled = e.target.checked;
      saveAnnouncerEnabledSetting();
    });

    document.getElementById('btn-refresh-content').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
      // Deliberately does NOT delete the current cache bucket up front — that
      // would risk leaving the app with zero offline content if the network
      // fails partway through. Instead: unregister so the next load does a
      // completely fresh service worker registration, whose install step
      // re-fetches everything with cache: 'no-store' into the SAME cache
      // bucket, overwriting entries as fresh fetches succeed. Anything that
      // fails to fetch (e.g. mid-refresh signal drop) just keeps whatever
      // was already cached rather than being wiped. Doesn't touch the
      // lineup/settings in localStorage — only app code, roster, and songs.
      var unregisterAll = ('serviceWorker' in navigator)
        ? navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          }).catch(function () {})
        : Promise.resolve();

      unregisterAll.then(function () {
        window.location.reload();
      });
    });

    document.getElementById('assign-clear-slot').addEventListener('click', function () {
      if (currentAssignSlot == null) return;
      slots[currentAssignSlot] = null;
      saveSlots();
      if (currentPlayingSlot === currentAssignSlot) stopPlayback();
      clampSelection();
      closeSheet('assign-sheet');
      renderGrid();
      updateActionBar();
    });

    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeSheet(btn.dataset.close); });
    });

    document.querySelectorAll('.sheet-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) overlay.classList.add('hidden');
      });
    });

    bindAddPlayerForm();
    bindSoundboardEvents();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('Service worker registration failed', err);
      });
    }
  }

  // ---------- Viewport height fix ----------
  // iOS can leave the WKWebView's viewport height stale when the installed
  // PWA is resumed from the background (rather than freshly launched) —
  // seen as the app sometimes opening at a smaller/wrong height until
  // something forces a reflow. 100dvh in CSS handles most cases but iOS
  // doesn't always recompute it on resume, so this sets a --vh custom
  // property from the real window.innerHeight and recomputes it on every
  // point the app could resume, not just once at load.
  function setViewportHeightVar() {
    document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
  }

  // A resume-triggered event (visibilitychange, pageshow) can fire before
  // the WKWebView has actually finished resizing back to full height — a
  // synchronous read of innerHeight right then can still capture the stale,
  // backgrounded value, which is a plausible reason the earlier fix (an
  // immediate read on those same events) didn't fully close this out.
  // Deferring past a couple of animation frames lets the real layout settle
  // first; the immediate call stays too, since it's harmless when the value
  // was already correct.
  function scheduleViewportHeightRecalc() {
    requestAnimationFrame(function () {
      requestAnimationFrame(setViewportHeightVar);
    });
  }

  // ---------- Web Audio setup ----------
  // Constructing an AudioContext needs no user gesture — only resuming it to
  // an audible 'running' state does — so this happens unconditionally at
  // startup (see init()) well before any tap, letting the decode pipeline
  // below start immediately during the splash sequence. Target hardware is a
  // fixed, known device (iPhone 16 Pro Max Safari) that has always supported
  // this, so there's no fallback/polyfill for a missing AudioContext beyond
  // degrading to the existing <audio>/new Audio() paths everywhere below.
  function initAudioContext() {
    var AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) return;
    try {
      audioCtx = new AudioCtxClass({ latencyHint: 'interactive' });
    } catch (e) {
      audioCtx = null;
    }
  }

  // A literal digital-silence signal isn't good enough to keep a Bluetooth
  // speaker's link awake — some stacks specifically detect true silence and
  // let the link sleep regardless of a Web Audio node technically running.
  // A very quiet (~-70dBFS), sub-audible 20Hz tone is a real nonzero AC
  // signal that keeps the link active without being audible, and (unlike a
  // synthesized noise buffer) needs no manual sample-filling/loop-seam work.
  // Started exactly once, on the first real user tap, and left running for
  // the life of the tab — see unlockAudioOnFirstGesture.
  function startKeepAliveHum() {
    if (!audioCtx || keepAliveOscillator) return;
    var oscillator = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 20;
    gain.gain.value = 0.0003;
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.start();
    keepAliveOscillator = oscillator;
  }

  // iOS gates an AudioContext's audible 'running' state behind a real user
  // gesture regardless of when it was constructed — this is that gesture.
  // Fires exactly once, on the very first tap anywhere in the app (which,
  // thanks to this app's select-then-confirm playback model, always happens
  // well before Play is even tappable — see selectSlot). No dedicated
  // "Enable Audio" screen needed.
  function unlockAudioOnFirstGesture() {
    if (!audioCtx) return;
    audioCtx.resume().catch(function () {});
    startKeepAliveHum();
  }

  // The OS can suspend an AudioContext when the app is backgrounded, the
  // same way it releases the screen wake lock — re-resume on every return to
  // the foreground, not just once at startup. Node graphs (including the
  // keep-alive hum) survive a suspend/resume cycle, so only the context
  // itself needs re-arming here, never the hum's oscillator/gain nodes.
  function resumeAudioIfNeeded() {
    if (!audioCtx || audioCtx.state === 'running') return;
    audioCtx.resume().catch(function () {});
  }

  // Decodes an ArrayBuffer-yielding promise into the given buffer cache under
  // id. Never rejects outward — a decode failure just leaves that id absent
  // from the cache, so play-time code automatically falls back to the
  // existing URL-based <audio>/new Audio() path for that one file. Used both
  // for mid-session additions (phone-added songs/clips) and by the bundled-
  // media decode pass at startup.
  function decodeOneInto(cacheMap, id, arrayBufferPromise) {
    if (!audioCtx) return Promise.resolve();
    return arrayBufferPromise
      .then(function (arrayBuffer) { return audioCtx.decodeAudioData(arrayBuffer); })
      .catch(function (err) {
        console.warn('Storm: decode failed for', id, err);
        return null;
      })
      .then(function (buffer) {
        if (buffer) cacheMap.set(id, buffer);
      });
  }

  // ---------- Keep screen awake ----------
  // Without this, iOS locks the screen after ~30s of no touches — easy to
  // hit between at-bats — and the next tap has to unlock the phone first.
  var wakeLockSentinel = null;

  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen')
      .then(function (sentinel) { wakeLockSentinel = sentinel; })
      .catch(function () {}); // e.g. low battery mode — fail silently, app still works
  }

  function bindWakeLock() {
    requestWakeLock();
    document.addEventListener('visibilitychange', function () {
      // The OS releases the lock whenever the tab/app is backgrounded, so
      // it has to be re-requested every time the app comes back to the
      // foreground — not just once at startup. Same trigger point doubles
      // as the reliable signal to recompute the viewport height fix above.
      if (document.visibilityState === 'visible') {
        requestWakeLock();
        resumeAudioIfNeeded();
        setViewportHeightVar();
        scheduleViewportHeightRecalc();
      }
    });
  }

  // ---------- Startup splash ----------
  // Hides the app behind a full-screen splash until every bundled song/sfx
  // file is confirmed present in the offline cache — the tornado logo
  // (a grayscale layer under a color layer, the color layer clipped by
  // progress) fills in bottom-to-top as each file is checked/downloaded.
  // A file already cached from a prior launch resolves near-instantly; only
  // genuinely new/missing media triggers a real network fetch, so this
  // never re-downloads the whole roster over cellular just because the app
  // was reopened at the field.
  var SPLASH_MIN_MS = 500;
  var SPLASH_MAX_MS = 12000;

  function setSplashProgress(pct) {
    var colorLayer = document.getElementById('splash-logo-color');
    if (colorLayer) colorLayer.style.clipPath = 'inset(' + (100 - pct) + '% 0 0 0)';
    var label = document.getElementById('splash-status');
    if (label) label.textContent = pct >= 100 ? 'Ready' : 'Loading media… ' + pct + '%';
  }

  function hideSplash() {
    // Second safety net for the cold-launch viewport-height glitch (see the
    // note in init()): the splash can run anywhere from ~500ms to 12s, so a
    // single deferred recompute right after DOMContentLoaded might still be
    // too early if iOS takes longer than that to settle its real layout.
    // Recomputing again right as the real content is about to become
    // visible catches that case regardless of how long the splash ran.
    setViewportHeightVar();
    scheduleViewportHeightRecalc();
    var splash = document.getElementById('splash-screen');
    if (!splash) return;
    splash.classList.add('splash-done');
    setTimeout(function () { splash.remove(); }, 450);
  }

  // Resolves once `url` is confirmed cached — either it already was, or a
  // fresh fetch just wrote it in. Never rejects and never waits past 6s for
  // a single file, so one slow/dead URL can't hang the whole sequence.
  function ensureCachedWithTimeout(url, cache) {
    return cache.match(url).then(function (cached) {
      if (cached) return;
      return new Promise(function (resolve) {
        var settled = false;
        var controller = ('AbortController' in window) ? new AbortController() : null;
        var timer = setTimeout(function () {
          settled = true;
          if (controller) controller.abort();
          resolve();
        }, 6000);
        fetch(url, { cache: 'no-store', signal: controller ? controller.signal : undefined })
          .then(function (res) {
            // Must return (not fire-and-forget) cache.put's promise — callers
            // that read the cache immediately after this resolves (e.g. the
            // decode pipeline) need the write to have actually landed, not
            // just been kicked off.
            if (!settled && res && res.ok) return cache.put(url, res);
          })
          .catch(function () {})
          .then(function () { if (!settled) { clearTimeout(timer); resolve(); } });
      });
    });
  }

  // Reads a bundled file's bytes straight from the cache runStartupMediaCheck
  // just confirmed present (no second network fetch) and decodes them into
  // the given buffer cache via decodeOneInto, which already isolates
  // per-file failures.
  function decodeBundledEntry(entry, cache) {
    return cache.match(entry.url).then(function (res) {
      return res ? res.arrayBuffer() : Promise.reject(new Error('not cached'));
    }).then(function (arrayBuffer) {
      return decodeOneInto(entry.cache, entry.id, Promise.resolve(arrayBuffer));
    }).catch(function () {
      // cache.match found nothing — shouldn't happen once ensureCachedWithTimeout
      // resolved, but stay defensive; that id just stays undecoded (URL fallback).
    });
  }

  function runStartupMediaCheck() {
    var startedAt = Date.now();
    var songEntries = bundledPlayers.filter(function (p) { return p.file; })
      .map(function (p) { return { id: p.id, url: './' + p.file, cache: songBufferCache }; });
    var nameClipEntries = bundledPlayers.filter(function (p) { return p.nameClipFile; })
      .map(function (p) { return { id: p.id, url: './' + p.nameClipFile, cache: nameClipBufferCache }; });
    var sfxEntries = bundledSoundboardClips.filter(function (c) { return c.file; })
      .map(function (c) { return { id: c.id, url: './' + c.file, cache: soundboardBufferCache }; });
    var entries = songEntries.concat(nameClipEntries, sfxEntries);

    function reveal() {
      var elapsed = Date.now() - startedAt;
      setTimeout(hideSplash, Math.max(0, SPLASH_MIN_MS - elapsed));
    }

    if (entries.length === 0 || !('caches' in window)) {
      setSplashProgress(100);
      reveal();
      return;
    }

    var done = 0;
    var total = entries.length;

    var checkAll = caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(entries.map(function (entry) {
        return ensureCachedWithTimeout(entry.url, cache).then(function () {
          return decodeBundledEntry(entry, cache);
        }).then(function () {
          done++;
          setSplashProgress(Math.round((done / total) * 100));
        });
      }));
    }).catch(function () {});

    // Whichever finishes first — every file confirmed and decoded, or this
    // hard ceiling — reveals the app. Guarantees a bad connection (or a
    // captive portal that never actually errors) can't leave the splash up
    // indefinitely. Anything still mid-decode or that failed to decode when
    // this fires just plays via its existing URL-based fallback until (or
    // unless) decoding quietly finishes in the background.
    var hardCeiling = new Promise(function (resolve) { setTimeout(resolve, SPLASH_MAX_MS); });

    Promise.race([checkAll, hardCeiling]).then(function () {
      setSplashProgress(100);
      reveal();
    });
  }

  // ---------- Init ----------
  function init() {
    initAudioContext();
    // Capture phase + once: fires on the very first tap anywhere, before any
    // in-app handler could stop propagation — reliably ahead of any slot tap.
    document.addEventListener('pointerdown', unlockAudioOnFirstGesture, { capture: true, once: true });

    // The previous two viewport-height fixes only deferred-recompute on
    // RESUME events (pageshow/visibilitychange) — but Jason confirmed the
    // wrong-height glitch almost always happens on a genuine COLD LAUNCH,
    // rarely on resume. A cold launch never fires any of those events, so
    // this path never got the "wait a couple of frames for real layout to
    // settle" treatment at all — it read innerHeight exactly once,
    // synchronously, before iOS may have finished its initial layout pass,
    // and nothing ever corrected it afterward unless the user happened to
    // resize/rotate/resume. Applying the same deferred recompute here too.
    setViewportHeightVar();
    scheduleViewportHeightRecalc();
    window.addEventListener('resize', setViewportHeightVar);
    window.addEventListener('orientationchange', setViewportHeightVar);
    window.addEventListener('pageshow', function () {
      setViewportHeightVar();
      scheduleViewportHeightRecalc();
    });
    // visualViewport reports the WKWebView's real visible geometry more
    // reliably than window.resize on iOS, which doesn't consistently fire
    // for every layout change a resumed PWA can go through.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setViewportHeightVar);
    }

    slots = loadSlots();
    stopAdvancesEnabled = loadStopAdvancesSetting();
    announcerOverlapEnabled = loadAnnouncerOverlapSetting();
    announcerEnabled = loadAnnouncerEnabledSetting();

    fetch('roster.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; })
      .then(function (data) {
        bundledPlayers = (data || []).map(function (p) {
          // guestSong/guestDefault are only ever set on the small pool of
          // "Guest" roster entries in roster.json — used to label them by
          // their actual song in the assign sheet, since they otherwise all
          // share the same name/number ("Guest" / "?").
          return {
            id: p.id, number: p.number, name: p.name, file: p.file,
            nameClipFile: p.nameClipFile || null,
            guestSong: p.guestSong || null, guestDefault: !!p.guestDefault,
            // See playOverlappingBuffers/firePlayback — 0.5 for every real
            // player as of 2026-09-15, undefined (sequential) for anything
            // without a name clip, like team songs and guests.
            announcerOverlapFraction: typeof p.announcerOverlapFraction === 'number' ? p.announcerOverlapFraction : undefined,
            source: 'bundled'
          };
        });
        return idbGetAll(STORE);
      })
      .then(function (records) {
        localPlayers = records.map(function (r) {
          var url = URL.createObjectURL(r.blob);
          objectUrlCache.set(r.id, url);
          decodeOneInto(songBufferCache, r.id, r.blob.arrayBuffer());
          var hasNameClip = false;
          if (r.nameClipBlob) {
            nameClipObjectUrlCache.set(r.id, URL.createObjectURL(r.nameClipBlob));
            decodeOneInto(nameClipBufferCache, r.id, r.nameClipBlob.arrayBuffer());
            hasNameClip = true;
          }
          return { id: r.id, number: r.number, name: r.name, source: 'local', hasNameClip: hasNameClip };
        });
      })
      .catch(function () { localPlayers = []; })
      .then(function () { return fetch('soundboard.json', { cache: 'no-store' }); })
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; })
      .then(function (data) {
        bundledSoundboardClips = (data || []).map(function (c) {
          return { id: c.id, label: c.label, icon: c.icon || null, file: c.file, source: 'bundled' };
        });
        return idbGetAll(SOUND_STORE);
      })
      .then(function (records) {
        localSoundboardClips = (records || []).map(function (r) {
          soundboardObjectUrlCache.set(r.id, URL.createObjectURL(r.blob));
          decodeOneInto(soundboardBufferCache, r.id, r.blob.arrayBuffer());
          return { id: r.id, label: r.label, source: 'local' };
        });
      })
      .catch(function () { localSoundboardClips = []; })
      .then(function () {
        rebuildLibrary();
        pruneStaleSlots();
        rebuildSoundboardLibrary();
        renderGrid();
        renderManageList();
        renderSoundboardGrid();
        bindEvents();
        updateActionBar();
        updateStopAdvanceSwitch();
        updateAnnouncerOverlapSwitch();
        updateAnnouncerEnabledSwitch();
        registerServiceWorker();
        bindWakeLock();
        runStartupMediaCheck();
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
