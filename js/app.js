(function () {
  'use strict';

  var LINEUP_COUNT = 15;
  var DB_NAME = 'storm-db';
  var DB_VERSION = 2;
  var STORE = 'players';
  var SOUND_STORE = 'soundboard';
  var SLOTS_KEY = 'storm-slots-v2';
  var STOP_ADVANCES_KEY = 'storm-stop-advances';
  var DEFAULT_LINEUP_VERSION_KEY = 'storm-default-lineup-version';

  // The real, current batting order — bump DEFAULT_LINEUP_VERSION whenever
  // this changes so it gets applied once on every device (even ones with
  // leftover state from earlier testing), without ever clobbering whatever
  // customizing (reorders/reassignments) happens afterward.
  var DEFAULT_LINEUP_VERSION = 3;
  var DEFAULT_SLOTS = {
    sp1: 't-stormiscoming',
    sp2: 't-letsgo',
    sp3: 't-swaggerlikeus',
    // l5 deliberately omitted: Branch is playing fall football and may only
    // make a few games, so he no longer gets a default lineup slot (he's
    // still in roster.json, assign him manually on days he's actually here).
    l1: 'p5', l2: 'p99', l3: 'p12', l4: 'p13', l6: 'p68',
    l7: 'p7', l8: 'p29', l9: 'p4', l10: 'p15', l11: 'p-tineo',
    l12: 'p-velez', l13: 'p2'
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
  var objectUrlCache = new Map();
  var nameClipObjectUrlCache = new Map();
  var activeSequenceOnComplete = null;

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
  var activeSoundboardSounds = new Map(); // clipId -> playing Audio element
  var soundboardEditingId = null; // null while the sheet is in "add" mode
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

  function rebuildLibrary() {
    library = bundledPlayers.concat(localPlayers).sort(function (a, b) {
      return (Number(a.number) || 0) - (Number(b.number) || 0);
    });
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
    if (!playerId) { openAssignSheet(slotId); return; }
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

  function songSrcFor(player) {
    if (!player) return null;
    return player.source === 'bundled' ? player.file : objectUrlCache.get(player.id);
  }

  function nameClipSrcFor(player) {
    if (!player) return null;
    if (player.source === 'bundled') return player.nameClipFile || null;
    return player.hasNameClip ? nameClipObjectUrlCache.get(player.id) : null;
  }

  function firePlayback(slotId) {
    var playerId = slots[slotId];
    var player = library.filter(function (p) { return p.id === playerId; })[0];
    if (!player) return;
    var songSrc = songSrcFor(player);
    if (!songSrc) return;
    currentPlayingSlot = slotId;
    // Graceful fallback is automatic: playSequence() drops the null name
    // clip entry when a player has none, and just plays the song.
    playSequence([nameClipSrcFor(player), songSrc], function () {
      var finishedSlot = slotId;
      currentPlayingSlot = null;
      // Only auto-advance if the user hasn't already tapped ahead to a
      // different slot while this sequence was finishing out.
      if (selectedSlot === finishedSlot) advanceToNextLineupSlot(finishedSlot);
      renderGrid();
      updateActionBar();
    });
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
        '<span class="name">' + escapeHtml(p.name) + '</span>';
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
      row.innerHTML = (p.number ? '<span class="num">' + escapeHtml(p.number) + '</span>' : '') +
        '<span>' + escapeHtml(p.name) + '</span>' +
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
    soundboardClips = bundledSoundboardClips.concat(localSoundboardClips).sort(function (a, b) {
      return a.label.localeCompare(b.label);
    });
  }

  function soundboardSrcFor(clip) {
    if (!clip) return null;
    return clip.source === 'bundled' ? clip.file : soundboardObjectUrlCache.get(clip.id);
  }

  function stopSoundboardClip(clipId) {
    var audio = activeSoundboardSounds.get(clipId);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      activeSoundboardSounds.delete(clipId);
    }
  }

  // Tap a tile: if nothing's playing, start it, layering on top of anything
  // else already playing (each clip gets its own Audio instance — the shared
  // player-audio element is reserved for lineup playback). Tap it again while
  // playing: a short one-shot stinger restarts from the top, a longer
  // loop-style sound stops.
  function toggleSoundboardClip(clipId) {
    var existing = activeSoundboardSounds.get(clipId);
    if (existing) {
      if (existing.duration && existing.duration <= SOUND_STINGER_MAX_SECONDS) {
        existing.currentTime = 0;
        existing.play().catch(function () {});
      } else {
        stopSoundboardClip(clipId);
      }
    } else {
      var clip = soundboardClips.filter(function (c) { return c.id === clipId; })[0];
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
      activeSoundboardSounds.set(clipId, audio);
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

  function openSoundboardAddSheet() {
    soundboardEditingId = null;
    document.getElementById('soundboard-edit-title').textContent = 'Add Sound';
    document.getElementById('soundboard-clip-label').value = '';
    document.getElementById('soundboard-clip-file').value = '';
    document.getElementById('soundboard-file-label-text').textContent = 'Choose sound (MP3)';
    document.getElementById('soundboard-delete-btn').classList.add('hidden');
    showSheet('soundboard-edit-sheet');
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
      localSoundboardClips = localSoundboardClips.filter(function (c) { return c.id !== clip.id; });
      rebuildSoundboardLibrary();
      renderSoundboardGrid();
      closeSheet('soundboard-edit-sheet');
    });
  }

  function bindSoundboardEvents() {
    document.getElementById('btn-soundboard').addEventListener('click', function () {
      document.getElementById('soundboard-panel').classList.add('open');
    });
    document.getElementById('soundboard-close').addEventListener('click', function () {
      document.getElementById('soundboard-panel').classList.remove('open');
    });
    document.getElementById('soundboard-stop-all').addEventListener('click', function () {
      activeSoundboardSounds.forEach(function (audio) { audio.pause(); audio.currentTime = 0; });
      activeSoundboardSounds.clear();
      renderSoundboardGrid();
    });
    document.getElementById('soundboard-add-btn').addEventListener('click', openSoundboardAddSheet);

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
        var hasNameClip = false;
        if (nameClipFile) {
          var nameUrl = URL.createObjectURL(nameClipFile);
          nameClipObjectUrlCache.set(id, nameUrl);
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
        setViewportHeightVar();
      }
    });
  }

  // ---------- Init ----------
  function init() {
    setViewportHeightVar();
    window.addEventListener('resize', setViewportHeightVar);
    window.addEventListener('orientationchange', setViewportHeightVar);
    window.addEventListener('pageshow', setViewportHeightVar);

    slots = loadSlots();
    stopAdvancesEnabled = loadStopAdvancesSetting();

    fetch('roster.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; })
      .then(function (data) {
        bundledPlayers = (data || []).map(function (p) {
          return { id: p.id, number: p.number, name: p.name, file: p.file, nameClipFile: p.nameClipFile || null, source: 'bundled' };
        });
        return idbGetAll(STORE);
      })
      .then(function (records) {
        localPlayers = records.map(function (r) {
          var url = URL.createObjectURL(r.blob);
          objectUrlCache.set(r.id, url);
          var hasNameClip = false;
          if (r.nameClipBlob) {
            nameClipObjectUrlCache.set(r.id, URL.createObjectURL(r.nameClipBlob));
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
          return { id: r.id, label: r.label, source: 'local' };
        });
      })
      .catch(function () { localSoundboardClips = []; })
      .then(function () {
        rebuildLibrary();
        rebuildSoundboardLibrary();
        renderGrid();
        renderManageList();
        renderSoundboardGrid();
        bindEvents();
        updateActionBar();
        updateStopAdvanceSwitch();
        registerServiceWorker();
        bindWakeLock();
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
