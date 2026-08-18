(function () {
  'use strict';

  var LINEUP_COUNT = 13;
  var DB_NAME = 'storm-db';
  var DB_VERSION = 1;
  var STORE = 'players';
  var SLOTS_KEY = 'storm-slots-v2';
  var STOP_ADVANCES_KEY = 'storm-stop-advances';
  var DEFAULT_LINEUP_VERSION_KEY = 'storm-default-lineup-version';

  // The real, current batting order — bump DEFAULT_LINEUP_VERSION whenever
  // this changes so it gets applied once on every device (even ones with
  // leftover state from earlier testing), without ever clobbering whatever
  // customizing (reorders/reassignments) happens afterward.
  var DEFAULT_LINEUP_VERSION = 1;
  var DEFAULT_SLOTS = {
    sp1: 't-stormiscoming',
    sp2: 't-letsgo',
    sp3: 't-swaggerlikeus',
    l1: 'p45', l2: 'p5', l3: 'p99', l4: 'p12', l5: 'p13', l6: 'p11',
    l7: 'p68', l8: 'p7', l9: 'p29', l10: 'p4', l11: 'p15', l12: 'p2'
  };

  var SLOT_DEFS = [
    { id: 'sp1', tag: 'WALKOUT 1', kind: 'special' },
    { id: 'sp2', tag: 'WALKOUT 2', kind: 'special' },
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

  var LINEUP_IDS = SLOT_DEFS.filter(function (d) { return d.kind === 'lineup'; })
    .map(function (d) { return d.id; });

  function findSlotDef(id) {
    return SLOT_DEFS.filter(function (d) { return d.id === id; })[0];
  }

  // ---------- IndexedDB helpers ----------
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGetAll() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(record) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbDelete(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
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
    var files = bundledPlayers.map(function (p) { return './' + p.file; });
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
    audio.pause();
    audio.currentTime = 0;
    currentPlayingSlot = null;
  }

  function firePlayback(slotId) {
    var playerId = slots[slotId];
    var player = library.filter(function (p) { return p.id === playerId; })[0];
    if (!player) return;
    var src = player.source === 'bundled' ? player.file : objectUrlCache.get(player.id);
    if (!src) return;
    var audio = document.getElementById('player-audio');
    audio.pause();
    audio.src = src;
    audio.currentTime = 0;
    audio.play().catch(function () {});
    currentPlayingSlot = slotId;
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
    idbDelete(p.id).then(function () {
      var url = objectUrlCache.get(p.id);
      if (url) { URL.revokeObjectURL(url); objectUrlCache.delete(p.id); }
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
    if (library.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'src-tag';
      empty.textContent = 'No songs yet. Add songs from Manage Team first.';
      list.appendChild(empty);
    }
    library.forEach(function (p) {
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

  // ---------- Add player form ----------
  function bindAddPlayerForm() {
    var fileInput = document.getElementById('new-player-file');
    var fileLabelText = document.getElementById('file-label-text');
    fileInput.addEventListener('change', function () {
      var f = fileInput.files[0];
      fileLabelText.textContent = f ? f.name : 'Choose song (MP3)';
    });

    document.getElementById('add-player-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var numberInput = document.getElementById('new-player-number');
      var nameInput = document.getElementById('new-player-name');
      var number = numberInput.value.trim();
      var name = nameInput.value.trim();
      var file = fileInput.files[0];
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
      idbPut({ id: id, number: number, name: name, blob: file }).then(function () {
        var url = URL.createObjectURL(file);
        objectUrlCache.set(id, url);
        localPlayers.push({ id: id, number: number, name: name, source: 'local' });
        rebuildLibrary();
        renderManageList();
        numberInput.value = '';
        nameInput.value = '';
        fileInput.value = '';
        fileLabelText.textContent = 'Choose song (MP3)';
      });
    });
  }

  // ---------- Static event bindings ----------
  function bindEvents() {
    document.getElementById('player-audio').addEventListener('ended', function () {
      var finishedSlot = currentPlayingSlot;
      currentPlayingSlot = null;
      // Only auto-advance if the user hasn't already tapped ahead to a
      // different slot while this song was finishing out.
      if (selectedSlot === finishedSlot) advanceToNextLineupSlot(finishedSlot);
      renderGrid();
      updateActionBar();
    });

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
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('Service worker registration failed', err);
      });
    }
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
      // foreground — not just once at startup.
      if (document.visibilityState === 'visible') requestWakeLock();
    });
  }

  // ---------- Init ----------
  function init() {
    slots = loadSlots();
    stopAdvancesEnabled = loadStopAdvancesSetting();

    fetch('roster.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; })
      .then(function (data) {
        bundledPlayers = (data || []).map(function (p) {
          return { id: p.id, number: p.number, name: p.name, file: p.file, source: 'bundled' };
        });
        return idbGetAll();
      })
      .then(function (records) {
        localPlayers = records.map(function (r) {
          var url = URL.createObjectURL(r.blob);
          objectUrlCache.set(r.id, url);
          return { id: r.id, number: r.number, name: r.name, source: 'local' };
        });
      })
      .catch(function () { localPlayers = []; })
      .then(function () {
        rebuildLibrary();
        renderGrid();
        renderManageList();
        bindEvents();
        updateActionBar();
        updateStopAdvanceSwitch();
        registerServiceWorker();
        bindWakeLock();
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
