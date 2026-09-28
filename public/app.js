// Anna — the phone app. One page, no framework: screens are rendered into #app.
const $app = document.getElementById('app');
const $photo = document.getElementById('photo-input');
const qs = new URLSearchParams(location.search);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- who she is: ?u=<name>&k=<key> in her personal link ----------
let AUTH = { u: qs.get('u'), k: qs.get('k') };
try {
  if (AUTH.u && AUTH.k) localStorage.setItem('anna-auth', JSON.stringify(AUTH));
  else AUTH = JSON.parse(localStorage.getItem('anna-auth') || '{}');
} catch { /* private mode: the link itself still works */ }

let STATE = null;
let screenToken = 0; // bumps on every screen change so timers and polls from old screens stop

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (p, cur = 'AUD') => (p == null ? '' : `${cur === 'AUD' ? '$' : cur + ' '}${Math.round(p).toLocaleString('en-AU')}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const authQS = () => `u=${encodeURIComponent(AUTH.u || '')}&k=${encodeURIComponent(AUTH.k || '')}`;

async function api(path, { method = 'GET', body, extra = '' } = {}) {
  const r = await fetch(`/api/${path}?${authQS()}${extra}`, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return data;
}

// ---------- events: batched, flushed often, never lost on close ----------
const queue = [];
let flushTimer = null;
function track(ev) {
  queue.push(ev);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 2500);
}
function flush(keepalive = false) {
  if (!queue.length) return;
  const events = queue.splice(0, queue.length);
  fetch(`/api/events?${authQS()}`, { method: 'POST', keepalive, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }) })
    .catch(() => queue.unshift(...events));
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });

// ---------- screen helpers ----------
function show(html, cls = '') {
  screenToken++;
  $app.innerHTML = `<section class="screen ${cls}">${html}</section>`;
  $app.scrollTop = 0;
  return $app.firstElementChild;
}
function saveStep(step) { try { localStorage.setItem(`anna-step-${AUTH.u}`, step); } catch {} }
function savedStep() { try { return localStorage.getItem(`anna-step-${AUTH.u}`); } catch { return null; } }

const ICON = {
  heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2A2420" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  right: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2A2420" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  left: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2A2420" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6E6358" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2A2420" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  out: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EDE7DD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6E6358" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  tick: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#EDE7DD" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  share: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2A2420" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
  addsq: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2A2420" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
  bell: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2A2420" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
};

// ---------- the swipe deck (calibration and nightly edit) ----------
function Deck(root, items, { withInfo = false, hint = false, context, editId, onDone, onTap }) {
  let i = 0, startX = null, dx = 0, moved = false, busy = false, shownAt = 0, hinting = hint;
  let cur = null;

  const cardHTML = (it, cls) => `
    <div class="card ${withInfo ? 'with-info' : 'photo-only'} ${cls}">
      <img src="${esc(it.image_url)}" alt="${esc([it.brand, it.name].filter(Boolean).join(', '))}" referrerpolicy="no-referrer" draggable="false">
      ${withInfo ? `<div class="info">
        <div class="row"><span class="brand">${esc(it.brand || '')}</span><span class="price">${esc(money(it.price, it.currency))}</span></div>
        <div class="row"><span class="pname">${esc(it.name || '')}</span><span class="retailer">${esc(it.source || '')}</span></div>
      </div>` : ''}
      <div class="warm"></div>
      ${cls.includes('hint') ? `<div class="chip love">${ICON.heart}${ICON.right}</div><div class="chip pass">${ICON.left}${ICON.x}</div>` : ''}
    </div>`;

  function preload(it) { if (it) { const im = new Image(); im.referrerPolicy = 'no-referrer'; im.src = it.image_url; } }

  function render() {
    root.innerHTML = '';
    if (i >= items.length) { onDone?.(); return; }
    const frag = document.createElement('div');
    frag.innerHTML = (items[i + 1] ? cardHTML(items[i + 1], 'next') : '') + cardHTML(items[i], hinting && i === 0 ? 'hint' : '');
    root.append(...frag.children);
    cur = root.lastElementChild;
    if (hinting && i === 0) root.insertAdjacentHTML('beforeend', '<div class="finger" aria-hidden="true"></div>');
    root.insertAdjacentHTML('beforeend', '<button class="sr" data-k="love">Love it</button><button class="sr" data-k="pass">Not for me</button>');
    root.querySelector('[data-k=love]').onclick = () => decide(1);
    root.querySelector('[data-k=pass]').onclick = () => decide(-1);
    bind(cur);
    shownAt = performance.now();
    preload(items[i + 2]);
    // A picture that won't load is skipped quietly, never shown as a blank card.
    const im = cur.querySelector('img');
    const skip = () => { if (cur?.querySelector('img') === im && !busy) { items.splice(i, 1); render(); } };
    im.addEventListener('error', skip, { once: true });
    if (im.complete && im.naturalWidth === 0 && im.src) skip();
  }

  function stopHint() {
    if (!hinting) return;
    hinting = false;
    cur.classList.remove('hint');
    root.querySelector('.finger')?.remove();
  }

  function bind(card) {
    const img = card.querySelector('img');
    card.addEventListener('pointerdown', (e) => {
      if (busy) return;
      stopHint();
      startX = e.clientX; dx = 0; moved = false;
      try { card.setPointerCapture(e.pointerId); } catch {}
      card.style.transition = 'none';
    });
    card.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      dx = e.clientX - startX;
      if (Math.abs(dx) > 6) moved = true;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
      img.style.filter = dx < 0 ? `grayscale(${Math.min(0.9, (-dx / 140) * 0.9)})` : '';
    });
    const end = () => {
      if (startX === null) return;
      startX = null;
      if (!moved) { card.style.transform = ''; onTap?.(items[i]); return; }
      if (dx > 90) decide(1);
      else if (dx < -90) decide(-1);
      else { card.style.transition = 'transform .23s ease-out'; card.style.transform = ''; img.style.filter = ''; }
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', () => { startX = null; card.style.transform = ''; img.style.filter = ''; });
  }

  function decide(dir) {
    if (busy || i >= items.length) return;
    busy = true;
    stopHint();
    const it = items[i];
    track({ item_id: it.id, action: dir > 0 ? 'love' : 'pass', context, edit_id: editId, ms: performance.now() - shownAt });
    if (dir > 0) it._loved = true;
    const card = cur;
    const fly = () => {
      card.style.transition = 'transform .23s ease-out';
      card.style.transform = `translateX(${dir * 560}px) rotate(${dir * 18}deg)`;
      setTimeout(() => { i++; busy = false; render(); }, 230);
    };
    if (dir > 0) { card.classList.add('flash'); setTimeout(fly, 190); } else fly();
  }

  render();
  return { decide, get index() { return i; } };
}

// ================= ONBOARDING =================

function screenIntro() {
  saveStep('intro');
  const el = show(`
    <div class="fan" aria-hidden="true">
      <img id="f1" style="left:calc(50% - 155px);top:30px;width:116px;height:158px;transform:rotate(-8deg)">
      <img id="f2" style="left:calc(50% + 39px);top:30px;width:116px;height:158px;transform:rotate(8deg)">
      <img id="f3" style="left:calc(50% - 69px);top:8px;width:138px;height:190px;box-shadow:0 20px 44px rgba(42,36,32,.22)">
    </div>
    <h1>Let’s build your Anna.</h1>
    <p class="lede" style="font-size:15px">Anna isn’t an app. She’s your own taste agent — she learns what you love, and one day you’ll take her into any app to help you edit.</p>
    <ol class="steps">
      <li><span class="num">1</span><span>Swipe through a few things so your Anna gets a feel for your eye.</span></li>
      <li><span class="num">2</span><span>Teach her from anywhere. <b>The more you add, and the wider the mix, the better your Anna knows you.</b></span></li>
      <li><span class="num">3</span><span>For now, your Anna puts together a personal daily edit for you — not just things you’ll love, but what’s new, what’s trending and the wider look.</span></li>
      <li><span class="num">4</span><span>She keeps learning from every swipe — she’s yours, and she goes where you go.</span></li>
    </ol>
    <div class="grow"></div>
    <button class="btn" id="go">Start building my Anna</button>`);
  // Borrow three pieces from the calibration set for the fan (loaded in the background).
  calibrationItems().then((items) => {
    ['f1', 'f2', 'f3'].forEach((id, n) => { const im = el.querySelector('#' + id); if (im && items[n]) { im.referrerPolicy = 'no-referrer'; im.src = items[n].image_url; } });
  }).catch(() => {});
  el.querySelector('#go').onclick = async () => { api('user', { method: 'POST', body: { stage: 'onboarding' } }).catch(() => {}); screenCalibrate(); };
}

let _calib = null;
function calibrationItems() { return (_calib ||= api('calibration').then((r) => r.items)); }

async function screenCalibrate() {
  saveStep('calibrate');
  screenToken++;
  $app.innerHTML = '<section class="deck" id="deck"></section>';
  let items;
  try { items = await calibrationItems(); } catch (e) { return screenError(e); }
  Deck(document.getElementById('deck'), items, { hint: true, context: 'calibration', onDone: () => { flush(); screenAddAnywhere(); } });
}

function phoneFront(extra = '') {
  return `<div class="face front">
    <div class="appbar">[ANY APP]</div>
    <div class="wl"><div class="t">Wishlist</div><div class="g" id="wlg"></div></div>
    <div class="whiteflash f1"></div>${extra}
  </div>`;
}
async function fillWishlist(el, n = 6) {
  const items = await calibrationItems().catch(() => []);
  el.querySelector('#wlg').innerHTML = items.slice(3, 3 + n).map((it) => `<img src="${esc(it.image_url)}" alt="" referrerpolicy="no-referrer">`).join('');
}

function screenAddAnywhere() {
  saveStep('addanywhere');
  const el = show(`
    <h1>How to add to your Anna from anywhere</h1>
    <p class="lede">See something you love in any app? Double-tap the back of your phone and your Anna has it.</p>
    <div class="phone-stage demoA">
      <div class="phone">
        ${phoneFront('<div class="toast"><span class="a">A</span><span style="flex:1">4 pieces sent to your Anna</span></div>')}
        <div class="face back">
          <div class="bump"><i style="left:11px;top:11px"></i><i style="left:11px;top:47px"></i></div>
          <div class="spot"></div><div class="ripple"></div><div class="tapdot"></div>
        </div>
      </div>
    </div>`);
  fillWishlist(el);
  const token = screenToken;
  // Plays once, then moves on by itself.
  setTimeout(() => { if (token === screenToken) screenSetup(); }, 10500);
}

function screenSetup() {
  saveStep('setup');
  const shortcut = STATE?.shortcut_url;
  const el = show(`
    <h1>How to set that up</h1>
    <ol class="steps" style="margin-top:16px;gap:20px">
      <li><span class="num">1</span><span><b>Add the Anna shortcut</b><span class="sub">Tap the button below, then Add Shortcut. When it asks for your code, enter <b>${esc(AUTH.u)}.${esc(AUTH.k)}</b></span></span></li>
      <li><span class="num">2</span><span><b>Turn on the double-tap</b><span class="sub">Settings › Accessibility › Touch › Back Tap › Double Tap › Anna</span></span></li>
      <li><span class="num">3</span><span><b>Test it</b><span class="sub">Come back here and double-tap the back of your phone. First time, tap Always Allow.</span></span></li>
    </ol>
    <div class="grow"></div>
    ${shortcut ? `<a class="btn" href="${esc(shortcut)}" target="_blank" rel="noopener">Add the shortcut</a>` : '<button class="btn" disabled>Shortcut link coming soon</button>'}
    <div class="waiting" id="wait"><span class="dot"></span><span id="waittext">Waiting for your first double-tap…</span></div>
    <button class="btn link" id="skip">Skip for now</button>`);
  el.querySelector('#skip').onclick = () => screenWishlists();
  const token = screenToken;
  (async () => {
    while (token === screenToken) {
      await sleep(3000);
      if (token !== screenToken) return;
      try {
        STATE = await api('me');
        if (STATE.user.shortcut_ok) {
          const w = el.querySelector('#wait'); w.classList.add('ok'); el.querySelector('#waittext').textContent = 'Got it — your double-tap works';
          await sleep(1400);
          if (token === screenToken) screenWishlists();
          return;
        }
      } catch {}
    }
  })();
}

function screenWishlists() {
  saveStep('wishlists');
  const ok = STATE?.user?.shortcut_ok;
  const el = show(`
    ${ok ? `<div class="okline"><span class="tick">${ICON.tick}</span>Double-tap is working</div>` : ''}
    <h1>Now use it to add your wishlists</h1>
    <p class="lede">Open a wishlist in any app and double-tap. Scroll, tap again. The more you add, the better your Anna knows you.</p>
    <div class="phone-stage demoB" style="min-height:440px">
      <div class="phone" style="height:420px">
        ${phoneFront('<div class="whiteflash f2"></div><div class="toast t1"><span class="a">A</span><span style="flex:1">4 pieces sent to your Anna</span></div><div class="toast t2"><span class="a">A</span><span style="flex:1">4 more sent to your Anna</span></div>')}
      </div>
    </div>
    <button class="btn" id="done">I’ve added my wishlists</button>
    <button class="btn link" id="photos">${ICON.plus} Add screenshots from Photos instead</button>
    <p class="small" id="upmsg" style="text-align:center;margin:0"></p>`);
  fillWishlist(el, 8);
  el.querySelector('#done').onclick = () => screenMostYou();
  el.querySelector('#photos').onclick = () => pickPhotos(el.querySelector('#upmsg'));
}

// Screenshots from Photos: shrink on the phone first so uploads are quick.
function shrink(file, max = 1600) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.82);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}
function pickPhotos(msgEl) {
  $photo.value = '';
  $photo.onchange = async () => {
    const files = [...$photo.files].slice(0, 10);
    if (!files.length) return;
    if (msgEl) msgEl.textContent = `Sending ${files.length}…`;
    const form = new FormData();
    for (const f of files) form.append('file', await shrink(f), 'screenshot.jpg');
    try {
      const r = await fetch(`/capture?${authQS()}`, { method: 'POST', body: form });
      if (!r.ok) throw new Error();
      if (msgEl) msgEl.textContent = `${files.length} sent to your Anna ✓`;
    } catch { if (msgEl) msgEl.textContent = 'That didn’t go through — try again.'; }
  };
  $photo.click();
}

async function screenMostYou() {
  saveStep('mostyou');
  let items = [];
  try { items = (await api('mostyou')).items; } catch {}
  if (items.length < 3) return screenDropTime();
  items = items.slice(0, 9);
  const picked = [];
  const el = show(`
    <h1 style="font-size:34px">Last thing: pick the three that are the most you</h1>
    <p class="lede" style="font-size:15px">These become your Anna’s starting point.</p>
    <div class="grid3" id="g"></div>
    <div class="grow"></div>
    <button class="btn" id="done" disabled>Done</button>`);
  const g = el.querySelector('#g');
  const draw = () => {
    g.innerHTML = items.map((it) => {
      const n = picked.indexOf(it.id) + 1;
      return `<button class="tile ${n ? 'on' : ''}" data-id="${esc(it.id)}" aria-pressed="${n ? 'true' : 'false'}" aria-label="${esc(it.name || 'piece')}">
        <img src="${esc(it.image_url)}" alt="" referrerpolicy="no-referrer">${n ? `<span class="n">${n}</span>` : ''}</button>`;
    }).join('');
    el.querySelector('#done').disabled = picked.length < 3;
  };
  g.onclick = (e) => {
    const b = e.target.closest('.tile'); if (!b) return;
    const id = b.dataset.id; const at = picked.indexOf(id);
    if (at >= 0) picked.splice(at, 1); else if (picked.length < 3) picked.push(id);
    draw();
  };
  draw();
  el.querySelector('#done').onclick = async () => {
    picked.forEach((id) => track({ item_id: id, action: 'most_you', context: 'onboarding' }));
    flush();
    api('user', { method: 'POST', body: { most_you: picked } }).catch(() => {});
    screenDropTime();
  };
}

function screenDropTime() {
  saveStep('droptime');
  const current = STATE?.user?.drop_time || '20:30';
  const el = show(`
    <h1>What time should your Anna edit arrive?</h1>
    <p class="lede">Every night. Change it any time.</p>
    <div class="timebox"><label class="sr" for="t">Edit time</label><input id="t" type="time" value="${esc(current)}" step="900"></div>
    <div class="grow"></div>
    <button class="btn" id="set">Set it</button>`);
  const input = el.querySelector('#t');
  const label = () => { const [h, m] = input.value.split(':').map(Number); const h12 = ((h + 11) % 12) + 1; el.querySelector('#set').textContent = `Set ${h12}${m ? '.' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };
  input.oninput = label; label();
  el.querySelector('#set').onclick = async () => {
    try { STATE = await api('user', { method: 'POST', body: { drop_time: input.value || '20:30', stage: 'homescreen' } }); } catch {}
    isStandalone ? screenNotify() : screenHomeScreen();
  };
}

function screenHomeScreen() {
  saveStep('homescreen');
  show(`
    <div class="bigicon" aria-hidden="true">A</div>
    <h1 style="margin-top:14px">Put your Anna on your phone</h1>
    <p class="lede">For now she lives here, and brings you your edit each night. One day she’ll come with you into any app.</p>
    <div style="display:flex;flex-direction:column;gap:18px;margin-top:18px">
      <div class="iconrow"><span class="ic">${ICON.share}</span>Tap Share at the bottom of Safari</div>
      <div class="iconrow"><span class="ic">${ICON.addsq}</span>Choose Add to Home Screen</div>
      <div class="iconrow"><span class="ic">A</span>Open Anna from the new icon</div>
    </div>
    <div class="grow"></div>
    <div class="arrowdown" aria-hidden="true"><svg width="28" height="40" viewBox="0 0 28 40" fill="none" stroke="#2A2420" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v34M5 27l9 9 9-9"/></svg></div>`);
}

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function screenNotify() {
  saveStep('notify');
  const when = STATE?.user?.drop_pretty || '8.30pm';
  const el = show(`
    <div class="grow"></div>
    ${ICON.bell}
    <h1 style="font-size:40px">Your Anna brings you her first edit tonight at ${esc(when)}.</h1>
    <p class="lede">One a night. Nothing else.</p>
    <p class="error" id="err" style="margin:0"></p>
    <div style="height:30px"></div>
    <button class="btn" id="on">Turn on notifications</button>
    <button class="btn link" id="later">Not now</button>`);
  const finish = async () => {
    try { STATE = await api('user', { method: 'POST', body: { stage: 'ready' } }); } catch {}
    saveStep('done');
    screenHome();
  };
  el.querySelector('#later').onclick = finish;
  el.querySelector('#on').onclick = async () => {
    const err = el.querySelector('#err');
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !STATE?.vapid_public_key) throw new Error('Notifications need Anna on your Home Screen first.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications are off — you can turn them on later in Settings › Notifications › Anna.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(STATE.vapid_public_key) });
      await api('push', { method: 'POST', body: { subscription: sub.toJSON() } });
      await finish();
    } catch (e) { err.textContent = e.message || 'That didn’t work.'; }
  };
}

// ================= EVERY NIGHT =================

async function screenHome() {
  let res;
  try { res = await api('edit', { extra: qs.get('preview') === '1' ? '&preview=1' : '' }); } catch (e) { return screenError(e); }
  if (res.status === 'ready') return screenEdit(res.edit);
  const el = show(`
    <div class="grow"></div>
    <div class="bigicon" aria-hidden="true">A</div>
    <h1 style="margin-top:12px">Your Anna is putting together tonight’s edit.</h1>
    <p class="lede">It arrives at ${esc(res.drop_pretty)}. Until then, double-tap anything you love in any app and she’ll learn from it.</p>
    <div class="grow"></div>
    <button class="btn outline" id="kept">Everything you’ve kept</button>
    <button class="btn link" id="photos">${ICON.plus} Add screenshots from Photos</button>
    <p class="small" id="upmsg" style="text-align:center;margin:0"></p>`, 'center');
  el.querySelector('#kept').onclick = screenKept;
  el.querySelector('#photos').onclick = () => pickPhotos(el.querySelector('#upmsg'));
}

function screenEdit(edit) {
  const decided = new Set(edit.decided || []);
  const keptIds = new Set(edit.kept || []);
  if (edit.finished || (edit.items.length && edit.items.every((i) => decided.has(i.id)))) {
    return screenEnd(edit.items.filter((i) => keptIds.has(i.id)));
  }
  screenToken++;
  $app.innerHTML = '<section class="deck" id="deck"></section>';
  const earlier = edit.items.filter((i) => keptIds.has(i.id)).map((i) => ({ ...i, _loved: true }));
  const items = edit.items.filter((i) => !decided.has(i.id));
  let deck;
  const openDetail = (it) => {
    track({ item_id: it.id, action: 'open', context: 'edit', edit_id: edit.id });
    const d = document.createElement('div');
    d.className = 'detail';
    d.innerHTML = `
      <img src="${esc(it.image_url)}" alt="${esc(it.name || '')}" referrerpolicy="no-referrer">
      <button class="close" aria-label="Close">${ICON.close}</button>
      <div class="meta">
        <span class="brand">${esc(it.brand || '')}</span>
        <span class="pname">${esc(it.name || '')}</span>
        <span class="small">${esc([money(it.price, it.currency), it.source].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="actions">
        ${it.url ? `<a class="btn" href="${esc(it.url)}" target="_blank" rel="noopener" id="shop">Take me there ${ICON.out}</a>` : ''}
        <button class="iconbtn" aria-label="Keep" id="keep">${ICON.heart}</button>
      </div>`;
    $app.appendChild(d);
    d.querySelector('.close').onclick = () => d.remove();
    d.querySelector('#shop')?.addEventListener('click', () => { track({ item_id: it.id, action: 'shop', context: 'detail', edit_id: edit.id }); flush(); });
    d.querySelector('#keep').onclick = () => { d.remove(); deck.decide(1); };
  };
  deck = Deck(document.getElementById('deck'), items, {
    withInfo: true, context: 'edit', editId: edit.id, onTap: openDetail,
    onDone: () => { flush(); api('edit/finished', { method: 'POST', body: {} }).catch(() => {}); screenEnd([...earlier, ...items.filter((i) => i._loved)]); },
  });
}

function screenEnd(kept) {
  const when = STATE?.user?.drop_pretty || '8.30pm';
  const el = show(`
    <h1 style="font-style:italic;font-size:46px;margin-top:30px">That’s tonight.</h1>
    <p class="lede">You kept ${kept.length}. Your Anna learned from every swipe.</p>
    <div class="endgrid" style="margin-top:16px">${kept.map((it) => `<img src="${esc(it.image_url)}" alt="${esc(it.name || '')}" referrerpolicy="no-referrer">`).join('')}</div>
    <div class="grow"></div>
    <p class="small" style="text-align:center;margin:0">Your next edit arrives tomorrow at ${esc(when)}</p>
    <button class="btn outline" id="kept">Everything you’ve kept</button>`);
  el.querySelector('#kept').onclick = screenKept;
}

async function screenKept() {
  let items = [];
  try { items = (await api('kept')).items; } catch {}
  const el = show(`
    <button class="btn link" id="back" style="width:auto;align-self:flex-start;padding:0">‹ Back</button>
    <h1>Everything you’ve kept</h1>
    ${items.length ? '' : '<p class="lede">Nothing yet — swipe right on anything you love in tonight’s edit.</p>'}
    <div class="endgrid">${items.map((it) => `<a href="${esc(it.url || '#')}" target="_blank" rel="noopener"><img src="${esc(it.image_url)}" alt="${esc(it.name || '')}" referrerpolicy="no-referrer"></a>`).join('')}</div>`);
  el.querySelector('#back').onclick = screenHome;
}

function screenNoLink() {
  show(`<div class="grow"></div><div class="bigicon" aria-hidden="true">A</div>
    <h1 style="margin-top:12px">This is Anna.</h1>
    <p class="lede">Open Anna from the personal link Daniela sent you — it’s how your Anna knows it’s you.</p><div class="grow"></div>`, 'center');
}

function screenError(e) {
  if (e?.status === 401) return screenNoLink();
  const el = show(`<div class="grow"></div><h1>Something went wrong.</h1><p class="lede">${esc(e?.message || '')}</p>
    <button class="btn" id="retry">Try again</button><div class="grow"></div>`, 'center');
  el.querySelector('#retry').onclick = start;
}

// ================= START =================

const RESUME = { intro: screenIntro, calibrate: screenCalibrate, addanywhere: screenAddAnywhere, setup: screenSetup,
  wishlists: screenWishlists, mostyou: screenMostYou, droptime: screenDropTime, homescreen: screenHomeScreen, notify: screenNotify };

async function start() {
  if (!AUTH.u || !AUTH.k) return screenNoLink();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { STATE = await api('me'); } catch (e) { return screenError(e); }
  const stage = STATE.user.stage;
  if (stage === 'ready' || qs.get('open') === 'edit') return screenHome();
  if (stage === 'homescreen') return isStandalone ? screenNotify() : screenHomeScreen();
  const step = savedStep();
  if (stage === 'onboarding' && step && RESUME[step]) return RESUME[step]();
  screenIntro();
}

navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'open-edit') screenHome(); });
start();
