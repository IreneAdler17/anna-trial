// Anna — the phone app. One page, no framework: screens are rendered into #app.
// Design v2 (30 Sep 2026): the night is an issue — a cover, then twelve pages, each built one of four ways.
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

// Shops send brand names every which way; the headline wants them as a name.
function brandName(b) {
  const s = String(b || '').trim();
  if (!s) return '';
  if (s === s.toUpperCase() && s.length > 3) return s.toLowerCase().replace(/(^|[\s\-&'’.])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  return s;
}
// A shop's domain reads better as a name: "orla.com.au" → "Orla". When the brand sells direct
// ("a-esque.com" for A-Esque), use the brand's own spelling.
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function retailerName(src, brand) {
  const stem = String(src || '').replace(/^www\./, '').split('.')[0];
  if (brand && squash(stem) === squash(brand)) return brandName(brand);
  const s = stem.replace(/[-_]+/g, ' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}
const priceLine = (it) => [money(it.price, it.currency), it.source ? `at ${retailerName(it.source, it.brand)}` : ''].filter(Boolean);
const metaHTML = (it) => `<div class="meta"><div class="brand">${esc(brandName(it.brand || it.source))}</div><div class="name">${esc(it.name || '')}</div><div class="pr">${priceLine(it).map((p) => `<span>${esc(p)}</span>`).join('')}</div></div>`;

// The Behind headline: two balanced lines, sized so the longer one fits the width. 134px ceiling, 56px floor.
function headline(brand, width) {
  const words = brandName(brand).split(/\s+/).filter(Boolean);
  let a = words.join(' '), b = '';
  if (words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const l1 = words.slice(0, i).join(' '), l2 = words.slice(i).join(' ');
      const score = Math.abs(l1.length - l2.length);
      if (best === null || score < best.score) best = { l1, l2, score };
    }
    a = best.l1; b = best.l2;
  }
  const longest = Math.max(a.length, b.length, 1);
  const size = Math.max(56, Math.min(134, Math.floor((width - 28) / (0.56 * longest))));
  return { a, b, size };
}

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
function seenHint() { try { return localStorage.getItem('anna-hint') === '1'; } catch { return false; } }
function markHint() { try { localStorage.setItem('anna-hint', '1'); } catch {} }

const ICON = {
  addsq: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/><path d="M12 8v8M8 12h8"/></svg>',
};

// ---------- the pages ----------
// Which way a piece is built. The server decides when it has measured the photo and tried a cut-out;
// otherwise the phone falls back to Landscape (a wide photo) or Printed tail.
function templateOf(it) {
  const t = it.layout?.template;
  if (t === 'behind' && it.layout?.cutout) return 'behind';
  if (t === 'product' && it.layout?.cutout) return 'product';
  if (t === 'landscape' || (it.layout?.aspect && it.layout.aspect > 1.05) || it._wide) return 'landscape';
  return 'tail';
}

function pageHTML(it, width) {
  const img = `<img class="ph" src="${esc(it.image_url)}" alt="${esc([it.brand, it.name].filter(Boolean).join(', '))}" referrerpolicy="no-referrer" draggable="false">`;
  const cut = it.layout?.cutout ? `<img class="cut" src="${esc(it.layout.cutout)}" alt="" draggable="false">` : '';
  const pr = priceLine(it);
  switch (templateOf(it)) {
    case 'behind': {
      const h = headline(it.brand || it.source, width);
      return `<div class="page behind">${img}<div class="head" style="font-size:${h.size}px"><div>${esc(h.a)}</div>${h.b ? `<div>${esc(h.b)}</div>` : ''}</div>${cut}
        <div class="credit"><span>${esc(it.name || '')}</span>${pr.map((p) => `<span class="b">${esc(p)}</span>`).join('')}</div></div>`;
    }
    case 'product': {
      const h = headline(it.brand || it.source, 9999);
      return `<div class="page product"><div class="top"><div class="brand">${esc(h.a)}${h.b ? `<br>${esc(h.b)}` : ''}</div><div class="name">${esc(it.name || '')}</div></div>
        <img class="obj" src="${esc(it.layout.cutout)}" alt="${esc(it.name || '')}" draggable="false">
        <div class="credit">${pr.map((p) => `<span class="b">${esc(p)}</span>`).join('')}</div></div>`;
    }
    case 'landscape':
      return `<div class="page landscape"><img class="wide" src="${esc(it.image_url)}" alt="${esc(it.name || '')}" referrerpolicy="no-referrer" draggable="false">${metaHTML(it)}</div>`;
    default:
      return `<div class="page tail">${img}${metaHTML(it)}</div>`;
  }
}

function coverHTML(edit, it) {
  const cut = it?.layout?.cutout ? `<img class="cut" src="${esc(it.layout.cutout)}" alt="" draggable="false">` : '';
  return `<div class="page cover">${it ? `<img class="ph" src="${esc(it.image_url)}" alt="" referrerpolicy="no-referrer" draggable="false">` : ''}
    <div class="mast" aria-label="Anna">An<br>na</div>${cut}
    <div class="issue"><div class="no">No. ${esc(edit.no || 1)}</div><div class="day">${esc(edit.weekday || '')}</div></div></div>`;
}

// ---------- the deck: cover (optional) then pages to swipe ----------
function Deck(root, items, { cover = null, hint = false, context, editId, onDone, onTap }) {
  let i = 0, startX = null, dx = 0, moved = false, busy = false, shownAt = 0;
  let hinting = hint && !seenHint();
  let cur = null;
  const width = root.clientWidth || 390;
  const isCover = () => cover && i === -1;
  if (cover) i = -1;

  function preload(it) { if (it) { const im = new Image(); im.referrerPolicy = 'no-referrer'; im.src = it.image_url; if (it.layout?.cutout) { const c = new Image(); c.src = it.layout.cutout; } } }

  function html(k) { return k === -1 ? coverHTML(cover, items[0]) : pageHTML(items[k], width); }

  function render() {
    root.innerHTML = '';
    root.className = 'deck' + (hinting && i === 0 ? ' hinting' : '');
    if (i >= items.length) { onDone?.(); return; }
    const frag = document.createElement('div');
    frag.innerHTML = (i + 1 < items.length ? html(i + 1).replace('class="page', 'class="page under') : '') + html(i);
    root.append(...frag.children);
    cur = root.lastElementChild;
    if (hinting && i === 0) cur.classList.add('hint');
    if (!isCover()) root.insertAdjacentHTML('beforeend', '<button class="sr" data-k="love">Love it</button><button class="sr" data-k="pass">Not for me</button>');
    root.querySelector('[data-k=love]')?.addEventListener('click', () => decide(1));
    root.querySelector('[data-k=pass]')?.addEventListener('click', () => decide(-1));
    bind(cur);
    shownAt = performance.now();
    preload(items[i + 2]);
    // No server layout yet (the first swipes): a wide photo becomes a Landscape page once it has loaded.
    const it = items[i];
    if (it && !isCover() && !it.layout?.template && !it._wide) {
      const im = cur.querySelector('img.ph, img.wide');
      const fit = () => { if (im.naturalWidth && im.naturalWidth > im.naturalHeight * 1.05 && templateOf(it) !== 'landscape') { it._wide = true; if (cur?.isConnected && !busy) render(); } };
      if (im) { im.complete ? fit() : im.addEventListener('load', fit, { once: true }); }
    }
    // A picture that won't load is skipped quietly, never shown as a blank page.
    const im = cur.querySelector('img.ph, img.wide, img.obj');
    if (im && !isCover()) {
      const skip = () => { if (cur?.isConnected && !busy) { items.splice(i, 1); render(); } };
      im.addEventListener('error', skip, { once: true });
      if (im.complete && im.naturalWidth === 0 && im.src) skip();
    }
  }

  function stopHint() {
    if (!hinting) return;
    hinting = false; markHint();
    cur.classList.remove('hint'); root.classList.remove('hinting');
  }

  function ground(d) { root.classList.toggle('warm', d > 8); root.classList.toggle('cool', d < -8); }

  function bind(page) {
    page.addEventListener('pointerdown', (e) => {
      if (busy) return;
      stopHint();
      startX = e.clientX; dx = 0; moved = false;
      try { page.setPointerCapture(e.pointerId); } catch {}
      page.style.transition = 'none';
    });
    page.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      dx = e.clientX - startX;
      if (Math.abs(dx) > 6) moved = true;
      page.style.transform = `translateX(${dx}px) rotate(${dx / 17}deg)`;
      if (!isCover()) { page.style.opacity = dx < 0 ? String(Math.max(0.35, 1 - (-dx / 220) * 0.6)) : '1'; ground(dx); }
    });
    const end = () => {
      if (startX === null) return;
      startX = null;
      if (!moved) { page.style.transform = ''; page.style.opacity = ''; ground(0); if (isCover()) advance(); else onTap?.(items[i]); return; }
      if (isCover()) { if (Math.abs(dx) > 60) advance(dx < 0 ? -1 : 1); else { page.style.transition = 'transform .23s ease-out'; page.style.transform = ''; } return; }
      if (dx > 90) decide(1);
      else if (dx < -90) decide(-1);
      else { page.style.transition = 'transform .23s ease-out, opacity .23s ease-out'; page.style.transform = ''; page.style.opacity = ''; ground(0); }
    };
    page.addEventListener('pointerup', end);
    page.addEventListener('pointercancel', () => { startX = null; page.style.transform = ''; page.style.opacity = ''; ground(0); });
  }

  function advance(dir = -1) {
    busy = true;
    const page = cur;
    page.style.transition = 'transform .28s ease-in, opacity .28s ease-in';
    page.style.transform = `translateX(${dir * 120}%) rotate(${dir * 4}deg)`;
    setTimeout(() => { i++; busy = false; ground(0); render(); }, 280);
  }

  function decide(dir) {
    if (busy || i < 0 || i >= items.length) return;
    busy = true;
    stopHint();
    const it = items[i];
    track({ item_id: it.id, action: dir > 0 ? 'love' : 'pass', context, edit_id: editId, ms: performance.now() - shownAt });
    if (dir > 0) it._loved = true;
    const page = cur;
    ground(dir * 100);
    page.style.transition = 'transform .26s ease-in, opacity .26s ease-in';
    page.style.transform = `translateX(${dir * 120}%) rotate(${dir * 6}deg)`;
    page.style.opacity = dir < 0 ? '0.2' : '1';
    setTimeout(() => { i++; busy = false; ground(0); render(); }, dir > 0 ? 300 : 260);
  }

  render();
  return { decide, get index() { return i; } };
}

// ================= ONBOARDING =================

function screenIntro() {
  saveStep('intro');
  screenToken++;
  $app.innerHTML = `<section class="intro">
    <img class="ph" id="ph" alt="" referrerpolicy="no-referrer">
    <div class="mast" aria-label="Anna">An<br>na</div>
    <img class="cut" id="cut" alt="" hidden>
    <div class="foot">
      <div class="line">The most tasteful friend you’ll ever have. Twelve things she found, every night. Swipe.</div>
      <button class="btn light" id="go">Begin</button>
    </div></section>`;
  const el = $app.firstElementChild;
  calibrationItems().then((items) => {
    const it = items.find((x) => x.layout?.cutout) || items[0];
    if (!it) return;
    el.querySelector('#ph').src = it.image_url;
    if (it.layout?.cutout) { const c = el.querySelector('#cut'); c.src = it.layout.cutout; c.hidden = false; }
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
  Deck(document.getElementById('deck'), items, { hint: true, context: 'calibration', onDone: () => { flush(); screenMostYou(); } });
}

// Show her things from anywhere: the double-tap, set up once. Not part of the first run —
// offered after her first night, from the end screen and the waiting screen.
function screenCapture(back = screenHome) {
  const shortcut = STATE?.shortcut_url;
  const ok = STATE?.user?.shortcut_ok;
  const el = show(`
    <button class="btn link" id="back" style="align-self:flex-start">‹ Back</button>
    <h1>Show her things from anywhere.</h1>
    <p class="lede">Double-tap the back of your phone on anything you love, in any app: a wishlist, a shop, Instagram. Anna sees it.</p>
    ${ok ? `<p class="okline" style="margin:8px 0 0">Your double-tap is working. Try it on a wishlist.</p>` : `
    <ol class="steps" style="margin-top:8px">
      <li><span class="num">1</span><span><b>Add the Anna shortcut</b><span class="sub">Tap the button below, then Add Shortcut. When it asks for your code, enter <b>${esc(AUTH.u)}.${esc(AUTH.k)}</b></span></span></li>
      <li><span class="num">2</span><span><b>Turn on the double-tap</b><span class="sub">Settings › Accessibility › Touch › Back Tap › Double Tap › Anna</span></span></li>
      <li><span class="num">3</span><span><b>Try it</b><span class="sub">Come back here and double-tap the back of your phone. First time, tap Always Allow.</span></span></li>
    </ol>`}
    <div class="grow"></div>
    ${ok ? '' : (shortcut ? `<a class="btn full solid" href="${esc(shortcut)}" target="_blank" rel="noopener">Add the shortcut</a>` : '<button class="btn full" disabled>Shortcut link coming soon</button>')}
    ${ok ? '' : '<div class="waiting" id="wait"><span class="dot"></span><span id="waittext">Waiting for your first double-tap…</span></div>'}
    <button class="btn link" id="photos">Or add screenshots from Photos</button>
    <p class="small" id="upmsg" style="margin:0"></p>`);
  el.querySelector('#back').onclick = () => back();
  el.querySelector('#photos').onclick = () => pickPhotos(el.querySelector('#upmsg'));
  if (ok) return;
  const token = screenToken;
  (async () => {
    while (token === screenToken) {
      await sleep(3000);
      if (token !== screenToken) return;
      try {
        STATE = await api('me');
        if (STATE.user.shortcut_ok) {
          el.querySelector('#wait').classList.add('ok');
          el.querySelector('#waittext').textContent = 'Anna’s seen it. Now try it on a wishlist.';
          return;
        }
      } catch {}
    }
  })();
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
      if (msgEl) msgEl.textContent = 'Anna’s seen them';
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
    <h1>Pick the three that are most you.</h1>
    <div class="grid3" id="g" style="margin-top:8px"></div>
    <div class="grow"></div>
    <button class="btn full solid" id="done" disabled>Done</button>`);
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
    <h1>When should tonight’s arrive?</h1>
    <p class="lede">Every night, at the same time. Change it whenever you like.</p>
    <div class="timebox"><label class="sr" for="t">Time</label><input id="t" type="time" value="${esc(current)}" step="900"></div>
    <div class="grow"></div>
    <button class="btn full solid" id="set">Set it</button>`);
  const input = el.querySelector('#t');
  const label = () => { const [h, m] = input.value.split(':').map(Number); const h12 = ((h + 11) % 12) + 1; el.querySelector('#set').textContent = `Set ${h12}${m ? '.' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };
  input.oninput = label; label();
  // Move on at once; the time saves in the background (a cold server can take a few seconds,
  // and a first tap that only closes the time picker must not feel like a dead button).
  el.querySelector('#set').onclick = () => {
    const t = input.value || '20:30';
    const [h, m] = t.split(':').map(Number);
    STATE = { ...STATE, user: { ...(STATE?.user || {}), drop_time: t, stage: 'homescreen',
      drop_pretty: `${((h + 11) % 12) + 1}${m ? '.' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}` } };
    api('user', { method: 'POST', body: { drop_time: t, stage: 'homescreen' } }).then((r) => { STATE = r; }).catch(() => {});
    isStandalone ? screenNotify() : screenHomeScreen();
  };
}

function screenHomeScreen() {
  saveStep('homescreen');
  show(`
    <h1>Put her on your phone.</h1>
    <p class="lede">For now she lives here and brings you her issue each night.</p>
    <div style="display:flex;flex-direction:column;gap:18px;margin-top:10px">
      <div class="iconrow"><span class="ic dots">•••</span>Tap ••• at the bottom right, then Share</div>
      <div class="iconrow"><span class="ic">${ICON.addsq}</span>Choose Add to Home Screen (under View More)</div>
      <div class="iconrow"><span class="ic">A</span>Open Anna from the new icon</div>
    </div>
    <div class="grow"></div>
    <div class="arrowdown right" aria-hidden="true"><svg width="28" height="40" viewBox="0 0 28 40" fill="none" stroke="#1A1815" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v34M5 27l9 9 9-9"/></svg></div>`);
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
    <h1>Tonight at ${esc(when)}.</h1>
    <p class="lede">One a night. Nothing else.</p>
    <p class="error" id="err" style="margin:0"></p>
    <div style="height:20px"></div>
    <button class="btn full solid" id="on">Turn on notifications</button>
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
    <div class="mast" aria-label="Anna">An<br>na</div>
    <p class="lede" style="margin-top:8px">Tonight’s arrives at ${esc(res.drop_pretty)}.</p>
    <div class="grow"></div>
    <button class="textlink" id="kept">Everything you’ve kept</button>
    <button class="btn link" id="show">Show her things from anywhere</button>`, 'wait');
  el.querySelector('#kept').onclick = screenKept;
  el.querySelector('#show').onclick = () => screenCapture(screenHome);
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
  const fresh = decided.size === 0; // the cover opens the issue only the first time she opens it
  let deck;
  const openDetail = (it) => {
    track({ item_id: it.id, action: 'open', context: 'edit', edit_id: edit.id });
    const d = document.createElement('div');
    d.className = 'detail';
    const wide = templateOf(it) === 'landscape';
    d.innerHTML = `
      <img src="${esc(it.image_url)}" alt="${esc(it.name || '')}" referrerpolicy="no-referrer" class="${wide ? 'contain' : ''}">
      <div class="body">
        ${metaHTML(it)}
        <div class="acts">
          ${it.url ? `<a class="go" href="${esc(it.url)}" target="_blank" rel="noopener" id="shop">Take me there &rarr;</a>` : '<span></span>'}
          <div class="right">
            <button class="ring ${it._loved ? 'on' : ''}" aria-label="Keep" id="keep"><i></i></button>
            <button class="xbtn" aria-label="Close" id="close">&times;</button>
          </div>
        </div>
      </div>`;
    $app.appendChild(d);
    d.querySelector('#close').onclick = () => d.remove();
    d.querySelector('#shop')?.addEventListener('click', () => { track({ item_id: it.id, action: 'shop', context: 'detail', edit_id: edit.id }); flush(); });
    d.querySelector('#keep').onclick = () => { d.remove(); deck.decide(1); };
  };
  deck = Deck(document.getElementById('deck'), items, {
    cover: fresh ? edit : null, hint: true, context: 'edit', editId: edit.id, onTap: openDetail,
    onDone: () => { flush(); api('edit/finished', { method: 'POST', body: {} }).catch(() => {}); screenEnd([...earlier, ...items.filter((i) => i._loved)]); },
  });
}

function screenEnd(kept) {
  const when = STATE?.user?.drop_pretty || '8.30pm';
  const el = show(`
    <h1 style="margin-top:40px">That’s tonight.</h1>
    <div class="keptrow">${kept.map((it) => `<img src="${esc(it.image_url)}" alt="${esc(it.name || '')}" referrerpolicy="no-referrer">`).join('')}</div>
    <p class="endline">Tomorrow at ${esc(when)}.</p>
    <div class="grow"></div>
    <button class="textlink" id="kept">Everything you’ve kept</button>
    <button class="btn link" id="show">Show her things from anywhere</button>`, 'end');
  el.querySelector('#kept').onclick = screenKept;
  el.querySelector('#show').onclick = () => screenCapture(() => screenEnd(kept));
}

async function screenKept() {
  let items = [];
  try { items = (await api('kept')).items; } catch {}
  const el = show(`
    <button class="btn link" id="back" style="align-self:flex-start">‹ Back</button>
    <h1>Everything you’ve kept.</h1>
    ${items.length ? '' : '<p class="lede">Nothing yet. Swipe right on anything you love tonight.</p>'}
    <div class="keptrow" style="margin-top:8px">${items.map((it) => `<a href="${esc(it.url || '#')}" target="_blank" rel="noopener"><img src="${esc(it.image_url)}" alt="${esc(it.name || '')}" referrerpolicy="no-referrer"></a>`).join('')}</div>`);
  el.querySelector('#back').onclick = screenHome;
}

function screenNoLink() {
  show(`<div class="grow"></div><div class="mast" aria-label="Anna">An<br>na</div>
    <p class="lede" style="margin-top:8px">Open Anna from the personal link Daniela sent you. It’s how your Anna knows it’s you.</p><div class="grow"></div>`, 'wait');
}

function screenError(e) {
  if (e?.status === 401) return screenNoLink();
  const el = show(`<div class="grow"></div><h1>Something went wrong.</h1><p class="lede">${esc(e?.message || '')}</p>
    <button class="btn" id="retry">Try again</button><div class="grow"></div>`, 'center');
  el.querySelector('#retry').onclick = start;
}

// ================= START =================

const RESUME = { intro: screenIntro, calibrate: screenCalibrate, addanywhere: screenMostYou, setup: screenMostYou,
  wishlists: screenMostYou, mostyou: screenMostYou, droptime: screenDropTime, homescreen: screenHomeScreen, notify: screenNotify };

async function start() {
  if (!AUTH.u || !AUTH.k) return screenNoLink();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (qs.get('restart') === '1') {
    // Re-testing: wipe where she was up to and start again from the intro.
    try { Object.keys(localStorage).filter((k) => k.startsWith('anna-step-') || k === 'anna-hint').forEach((k) => localStorage.removeItem(k)); } catch {}
    try { await api('restart', { method: 'POST', body: {} }); } catch (e) { return screenError(e); }
    qs.delete('restart');
    history.replaceState(null, '', `${location.pathname}?${qs}`);
  }
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
