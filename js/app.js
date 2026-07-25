(function () {
  'use strict';

  var LINEUP_COUNT = 12;
  var DB_NAME = 'storm-db';
  var DB_VERSION = 1;
  var STORE = 'players';
  var SLOTS_KEY = 'storm-slots-v2';

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
  var objectUrlCache = new Map();

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

  function rebuildLibrary() {
    library = bundledPlayers.concat(localPlayers).sort(function (a, b) {
      return (Number(a.number) || 0) - (Number(b.number) || 0);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Playback ----------
  function playSlot(slotId) {
    var playerId = slots[slotId];
    if (!playerId) { openAssignSheet(slotId); return; }

    var audio = document.getElementById('player-audio');

    // Tapping the slot that's already playing stops it and rewinds to the
    // start, rather than pausing mid-song — the next tap always starts
    // the song fresh from the top.
    if (currentPlayingSlot === slotId) {
      audio.pause();
      audio.currentTime = 0;
      currentPlayingSlot = null;
      renderGrid();
      return;
    }

    var player = library.filter(function (p) { return p.id === playerId; })[0];
    if (!player) return;
    var src = player.source === 'bundled' ? player.file : objectUrlCache.get(player.id);
    if (!src) return;
    audio.pause();
    audio.src = src;
    audio.currentTime = 0;
    audio.play().catch(function () {});
    currentPlayingSlot = slotId;
    renderGrid();
  }

  // ---------- Rendering ----------
  var LONG_PRESS_MS = 500;

  function lastNameOf(fullName) {
    var parts = (fullName || '').trim().split(/\s+/);
    return parts[parts.length - 1] || fullName;
  }

  function bindSlotInteraction(div, slotId) {
    var pressTimer = null;
    var longPressFired = false;

    function clearTimer() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }

    div.addEventListener('pointerdown', function () {
      longPressFired = false;
      clearTimer();
      pressTimer = setTimeout(function () {
        longPressFired = true;
        openAssignSheet(slotId);
      }, LONG_PRESS_MS);
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
      div.addEventListener(evt, clearTimer);
    });

    div.addEventListener('click', function () {
      if (longPressFired) { longPressFired = false; return; }
      playSlot(slotId);
    });
  }

  function buildSlotButton(def) {
    var playerId = slots[def.id];
    var player = playerId ? library.filter(function (p) { return p.id === playerId; })[0] : null;

    var div = document.createElement('div');
    var classes = ['slot-btn', def.kind];
    classes.push(player ? (currentPlayingSlot === def.id ? 'playing filled' : 'filled') : 'empty');
    div.className = classes.join(' ');
    div.setAttribute('role', 'button');

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

    bindSlotInteraction(div, def.id);

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
    if (library.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'src-tag';
      empty.textContent = 'No songs yet — add one below.';
      list.appendChild(empty);
    }
    library.forEach(function (p) {
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
      rebuildLibrary();
      renderManageList();
      renderGrid();
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
        closeSheet('assign-sheet');
        renderGrid();
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
      currentPlayingSlot = null;
      renderGrid();
    });

    document.getElementById('btn-clear-lineup').addEventListener('click', function () {
      if (!confirm('Clear all 12 lineup slots for a new game? (Walkout/Victory songs will stay assigned.)')) return;
      var playingDef = currentPlayingSlot ? findSlotDef(currentPlayingSlot) : null;
      SLOT_DEFS.filter(function (d) { return d.kind === 'lineup'; }).forEach(function (d) {
        slots[d.id] = null;
      });
      saveSlots();
      if (playingDef && playingDef.kind === 'lineup') {
        document.getElementById('player-audio').pause();
        currentPlayingSlot = null;
      }
      renderGrid();
    });

    document.getElementById('btn-manage-team').addEventListener('click', function () {
      renderManageList();
      showSheet('manage-team');
    });

    document.getElementById('assign-clear-slot').addEventListener('click', function () {
      if (currentAssignSlot == null) return;
      slots[currentAssignSlot] = null;
      saveSlots();
      if (currentPlayingSlot === currentAssignSlot) {
        document.getElementById('player-audio').pause();
        currentPlayingSlot = null;
      }
      closeSheet('assign-sheet');
      renderGrid();
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
        registerServiceWorker();
        bindWakeLock();
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
