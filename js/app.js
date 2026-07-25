(function () {
  'use strict';

  var SLOT_COUNT = 12;
  var DB_NAME = 'storm-db';
  var DB_VERSION = 1;
  var STORE = 'players';

  var bundledPlayers = [];
  var localPlayers = [];
  var library = [];
  var slots = [];
  var currentPlayingSlot = null;
  var currentAssignSlot = null;
  var objectUrlCache = new Map();

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
    try {
      var raw = localStorage.getItem('storm-slots');
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === SLOT_COUNT) return arr;
      }
    } catch (e) {}
    return new Array(SLOT_COUNT).fill(null);
  }

  function saveSlots() {
    localStorage.setItem('storm-slots', JSON.stringify(slots));
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
  function playSlot(i) {
    var playerId = slots[i];
    if (!playerId) { openAssignSheet(i); return; }
    var player = library.filter(function (p) { return p.id === playerId; })[0];
    if (!player) return;
    var src = player.source === 'bundled' ? player.file : objectUrlCache.get(player.id);
    if (!src) return;
    var audio = document.getElementById('player-audio');
    audio.pause();
    audio.src = src;
    audio.currentTime = 0;
    audio.play().catch(function () {});
    currentPlayingSlot = i;
    renderGrid();
  }

  // ---------- Rendering ----------
  function renderGrid() {
    var grid = document.getElementById('lineup-grid');
    grid.innerHTML = '';
    for (var i = 0; i < SLOT_COUNT; i++) {
      (function (i) {
        var playerId = slots[i];
        var player = playerId ? library.filter(function (p) { return p.id === playerId; })[0] : null;

        var div = document.createElement('div');
        div.className = 'slot-btn ' + (player ? (currentPlayingSlot === i ? 'playing filled' : 'filled') : 'empty');
        div.setAttribute('role', 'button');

        var orderSpan = document.createElement('span');
        orderSpan.className = 'slot-order';
        orderSpan.textContent = '#' + (i + 1);
        div.appendChild(orderSpan);

        if (player) {
          var num = document.createElement('div');
          num.className = 'slot-num';
          num.textContent = player.number;
          var name = document.createElement('div');
          name.className = 'slot-name';
          name.textContent = player.name;
          div.appendChild(num);
          div.appendChild(name);
        } else {
          var label = document.createElement('div');
          label.className = 'slot-empty-label';
          label.textContent = '+ Assign';
          div.appendChild(label);
        }

        var editBtn = document.createElement('button');
        editBtn.className = 'slot-edit';
        editBtn.textContent = '✎';
        editBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openAssignSheet(i);
        });
        div.appendChild(editBtn);

        div.addEventListener('click', function () { playSlot(i); });

        grid.appendChild(div);
      })(i);
    }
  }

  function renderManageList() {
    var list = document.getElementById('manage-player-list');
    list.innerHTML = '';
    if (library.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'src-tag';
      empty.textContent = 'No players yet — add one below.';
      list.appendChild(empty);
    }
    library.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'manage-row';
      row.innerHTML = '<span class="num">' + escapeHtml(p.number) + '</span>' +
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
    if (!confirm('Remove ' + p.name + ' from the team?')) return;
    idbDelete(p.id).then(function () {
      var url = objectUrlCache.get(p.id);
      if (url) { URL.revokeObjectURL(url); objectUrlCache.delete(p.id); }
      localPlayers = localPlayers.filter(function (x) { return x.id !== p.id; });
      slots = slots.map(function (s) { return s === p.id ? null : s; });
      saveSlots();
      rebuildLibrary();
      renderManageList();
      renderGrid();
    });
  }

  function openAssignSheet(slotIndex) {
    currentAssignSlot = slotIndex;
    document.getElementById('assign-sheet-title').textContent = 'Assign Slot #' + (slotIndex + 1);
    var list = document.getElementById('assign-player-list');
    list.innerHTML = '';
    if (library.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'src-tag';
      empty.textContent = 'No players yet. Add players from Manage Team first.';
      list.appendChild(empty);
    }
    library.forEach(function (p) {
      var row = document.createElement('button');
      row.className = 'list-row';
      row.innerHTML = '<span class="num">' + escapeHtml(p.number) + '</span>' +
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
      if (!number || !name || !file) {
        alert('Please fill in number, name, and choose a song file.');
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
      if (!confirm('Clear all 12 slot assignments for a new game?')) return;
      slots = new Array(SLOT_COUNT).fill(null);
      saveSlots();
      document.getElementById('player-audio').pause();
      currentPlayingSlot = null;
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
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
