// Storm smoke test — a committed, reusable regression check for the core
// interaction model (select/play/stop, drag-reorder, auto-advance, the
// Advance-on-Stop setting). Not run automatically (no CI in this project,
// deliberately — see PROJECT_STATUS.md) — run manually before shipping any
// change to js/app.js, css/style.css, or sw.js.
//
// This exists because this exact session found two real CSS cascade bugs
// and three cache: 'no-store' gaps that ad hoc, thrown-away test scripts
// eventually caught — but only after live-phone reports. A committed script
// means the next change gets the same checks without re-deriving them from
// scratch, and without needing a real device to catch an obvious break.
//
// How to run:
//   npm install puppeteer-core --no-save   (never commit node_modules/this)
//   python3 -m http.server 8934            (from the repo root, separate terminal)
//   node test/smoke.js
//
// Requires a local Google Chrome install (points at the real browser, not a
// downloaded Chromium). Exits 0 if every check passes, 1 otherwise.

const puppeteer = require('puppeteer-core');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE_URL = 'http://localhost:8934';

const results = [];
function check(name, condition) {
  results.push({ name, pass: !!condition });
}

async function clickSlot(page, id) {
  const el = await page.$('.slot-btn[data-slot-id="' + id + '"]');
  const box = await el.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 100));
}

async function selectedSlotId(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.slot-btn.selected');
    return el ? el.dataset.slotId : null;
  });
}

async function seedSlots(page) {
  await page.evaluate(() => {
    localStorage.setItem('storm-default-lineup-version', '3'); // skip the baked-in-lineup migration
    localStorage.setItem('storm-slots-v2', JSON.stringify({
      sp1: null, sp2: null, sp3: null,
      l1: 'p7', l2: null, l3: 't-letsgo', l4: null, l5: null,
      l6: null, l7: null, l8: null, l9: null, l10: null, l11: null, l12: 't-stormiscoming'
    }));
    localStorage.setItem('storm-stop-advances', '1');
  });
}

async function freshLoad(page) {
  await page.goto(BASE_URL + '/index.html?cb=' + Date.now(), { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
  });
  await waitForSplashGone(page);
}

// The startup splash now also blocks on decoding every bundled file into an
// AudioBuffer (not just confirming it's cache-stored), so it can take a real
// couple of seconds even on a warm cache — a fixed short sleep after
// load/reload is no longer reliably enough for the app to be interactive.
async function waitForSplashGone(page) {
  await page.waitForFunction(() => !document.getElementById('splash-screen'), { timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 100));
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new' });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  // Lineup playback now runs through a decoded AudioBuffer + AudioBufferSourceNode
  // whenever a file decoded successfully (the normal case), not the <audio
  // id="player-audio"> element — so "is it actually playing" needs to observe
  // both paths. Wrapping AudioContext before app.js loads (rather than reaching
  // into the IIFE's internals) keeps this a black-box, DOM/observable-behavior
  // test like the rest of the file.
  await page.evaluateOnNewDocument(() => {
    window.__audioLog = { bufferSourceStarts: 0 };
    const OrigCtx = window.AudioContext || window.webkitAudioContext;
    function WrappedCtx(opts) {
      const ctx = new OrigCtx(opts);
      const origCreateBS = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = function () {
        const src = origCreateBS();
        const origStart = src.start.bind(src);
        src.start = function (...a) {
          window.__audioLog.bufferSourceStarts++;
          window.__audioLog.lastSource = src;
          return origStart(...a);
        };
        return src;
      };
      return ctx;
    }
    window.AudioContext = WrappedCtx;
    window.webkitAudioContext = WrappedCtx;
  });

  // --- Seed a known lineup, load fresh ---
  await page.goto(BASE_URL + '/index.html?cb=' + Date.now(), { waitUntil: 'networkidle0' });
  await waitForSplashGone(page);
  await seedSlots(page);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
  });
  await waitForSplashGone(page);

  // --- Select-then-confirm playback ---
  await clickSlot(page, 'l1');
  check('tap selects (not plays) a filled slot', await selectedSlotId(page) === 'l1');
  const playBtnAfterSelect = await page.$eval('#action-play', b => ({ text: b.textContent, disabled: b.disabled }));
  check('Play button enables + reads PLAY after selecting', !playBtnAfterSelect.disabled && playBtnAfterSelect.text === 'PLAY');

  await page.click('#action-play');
  await new Promise(r => setTimeout(r, 100));
  const playingClass = await page.$eval('.slot-btn[data-slot-id="l1"]', el => el.className);
  check('tile shows playing state after Play', playingClass.indexOf('playing') !== -1);
  const audioPlaying = await page.evaluate(() =>
    !document.getElementById('player-audio').paused || window.__audioLog.bufferSourceStarts > 0);
  check('audio is actually playing (buffer or <audio> fallback path)', audioPlaying);

  // Mis-tap safety: selecting a different slot must not touch the playing audio
  await clickSlot(page, 'l3');
  const stillPlaying = await page.evaluate(() =>
    !document.getElementById('player-audio').paused || window.__audioLog.bufferSourceStarts > 0);
  check('selecting a different slot does not interrupt playback', stillPlaying);
  check('selection moved to the newly tapped slot', await selectedSlotId(page) === 'l3');

  // Re-select l1 (still the one actually playing, untouched since step above) so
  // selected === playing === l1, then simulate it finishing on its own. Using
  // dispatchEvent directly (not clicking Play again) is deliberate: l1 is
  // already playing, so a Play click here would hit the manual-stop branch
  // instead of exercising natural completion in isolation.
  await clickSlot(page, 'l1');
  // Simulate the currently-playing clip finishing naturally. When the buffer
  // path was used (the normal case now), that means invoking the real
  // AudioBufferSourceNode's own onended handler directly rather than firing a
  // synthetic event on the (in that case, unused) <audio> element. l1 (Owen)
  // now has a name-announcer clip, so a real play is a 2-clip sequence
  // (name clip, then song) — firing onended once only finishes the FIRST
  // clip and advances to the second, not the whole sequence. Loop until the
  // Play button no longer reads STOP (the real, observable "play is over"
  // signal), which drains a sequence of any length instead of assuming one.
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) {
      var src = window.__audioLog.lastSource;
      if (src && src.onended) { src.onended(); }
      else { document.getElementById('player-audio').dispatchEvent(new Event('ended')); }
      await new Promise(r => setTimeout(r, 80));
      if (document.getElementById('action-play').textContent !== 'STOP') break;
    }
  });
  await new Promise(r => setTimeout(r, 100));
  check('auto-advance on natural finish skips empty l2 and lands on l3', await selectedSlotId(page) === 'l3');
  const playBtnAfterEnded = await page.$eval('#action-play', b => b.textContent);
  check('Play button resets to PLAY after natural finish', playBtnAfterEnded === 'PLAY');

  // --- Advance-on-Stop setting: manual stop respects the toggle ---
  // Fresh play/stop cycle (nothing playing beforehand) to isolate the
  // manual-stop path from the natural-finish path tested above.
  await page.click('#action-play'); // fires fresh playback on l3
  await new Promise(r => setTimeout(r, 100));
  await page.click('#action-play'); // manual stop, toggle currently ON (seeded)
  await new Promise(r => setTimeout(r, 100));
  check('manual Stop advances when Advance-on-Stop is ON', await selectedSlotId(page) === 'l12');

  await page.click('#btn-manage-team');
  await new Promise(r => setTimeout(r, 200));
  await page.click('label.settings-row'); // toggle the switch off
  await new Promise(r => setTimeout(r, 100));
  const switchNowOff = await page.$eval('#setting-stop-advance', el => !el.checked);
  check('Advance-on-Stop switch toggles off on click', switchNowOff);
  await page.click('[data-close="manage-team"]');
  await new Promise(r => setTimeout(r, 150));

  await clickSlot(page, 'l12');
  await page.click('#action-play');
  await new Promise(r => setTimeout(r, 100));
  await page.click('#action-play'); // manual stop, toggle now OFF
  await new Promise(r => setTimeout(r, 100));
  check('manual Stop does NOT advance when Advance-on-Stop is OFF', await selectedSlotId(page) === 'l12');

  // --- Drag-to-reorder (true insert-with-bump) ---
  await page.evaluate(() => {
    localStorage.setItem('storm-slots-v2', JSON.stringify({
      sp1: null, sp2: null, sp3: null,
      l1: 'p7', l2: 't-letsgo', l3: 't-stormiscoming', l4: null, l5: null,
      l6: null, l7: null, l8: null, l9: null, l10: null, l11: null, l12: null
    }));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForSplashGone(page);

  const l1Box = (await (await page.$('.slot-btn[data-slot-id="l1"]')).boundingBox());
  const l3Box = (await (await page.$('.slot-btn[data-slot-id="l3"]')).boundingBox());
  await page.mouse.move(l1Box.x + l1Box.width / 2, l1Box.y + l1Box.height / 2);
  await page.mouse.down();
  await new Promise(r => setTimeout(r, 650)); // clear the 500ms long-press threshold
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(
      l1Box.x + l1Box.width / 2 + (l3Box.x - l1Box.x) * (i / 6),
      l1Box.y + l1Box.height / 2 + (l3Box.y - l1Box.y) * (i / 6)
    );
    await new Promise(r => setTimeout(r, 30));
  }
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 200));

  const slotsAfterDrag = await page.evaluate(() => JSON.parse(localStorage.getItem('storm-slots-v2')));
  check(
    'drag l1->l3 bumps intermediate slots instead of swapping',
    slotsAfterDrag.l1 === 't-letsgo' && slotsAfterDrag.l2 === 't-stormiscoming' && slotsAfterDrag.l3 === 'p7'
  );

  check('no page errors thrown during the whole run', pageErrors.length === 0);

  // --- Report ---
  const failed = results.filter(r => !r.pass);
  console.log('');
  results.forEach(r => console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name));
  console.log('');
  console.log(failed.length === 0
    ? 'All ' + results.length + ' checks passed.'
    : failed.length + ' of ' + results.length + ' checks FAILED.');
  if (pageErrors.length) console.log('Page errors: ' + pageErrors.join(' | '));

  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
})();
