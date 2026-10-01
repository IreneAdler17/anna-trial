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


// Square or wide packshots in a tall frame: show the whole piece, never crop it, sitting on the
// photo's own background colour (read from a tiny copy when the shop allows; studio grey if not).
const _edge = new Map();
function edgeColour(url) {
  if (_edge.has(url)) return _edge.get(url);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 12; c.height = 12;
        const g = c.getContext('2d'); g.drawImage(im, 0, 0, 12, 12);
        const px = [g.getImageData(0, 0, 1, 1).data, g.getImageData(11, 0, 1, 1).data, g.getImageData(0, 11, 1, 1).data, g.getImageData(11, 11, 1, 1).data];
        const avg = [0, 1, 2].map((k) => Math.round(px.reduce((t, d) => t + d[k], 0) / px.length));
        resolve(`rgb(${avg.join(',')})`);
      } catch { resolve(null); }
    };
    im.onerror = () => resolve(null);
    im.src = /[?&]width=\d+/.test(url) ? url.replace(/([?&]width=)\d+/, '$124') : url;
    setTimeout(() => resolve(null), 3000);
  });
  _edge.set(url, p);
  return p;
}
function fitPhoto(img) {
  if (!img) return;
  const apply = () => {
    const box = img.getBoundingClientRect();
    if (!img.naturalWidth || !box.height) return;
    const ar = img.naturalWidth / img.naturalHeight;
    if (ar < (box.width / box.height) * 1.3) return; // near the frame's shape: fill it
    img.classList.add('fit');
    img.style.backgroundColor = '#EBEBEA';
    edgeColour(img.currentSrc || img.src).then((c) => { if (c) img.style.backgroundColor = c; });
  };
  img.complete ? apply() : img.addEventListener('load', apply, { once: true });
}

// ---------- the deck: cover (optional) then pages to swipe ----------
function Deck(root, items, { cover = null, hint = false, context, editId, onDone, onTap }) {
  let i = 0, startX = null, dx = 0, moved = false, busy = false, shownAt = 0, t0 = 0, lastX = 0, lastT = 0, vel = 0;
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
    root.querySelectorAll('.page.tail img.ph').forEach(fitPhoto);
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

  // Love warms the page with vermilion as it moves right; pass fades it as it moves left.
  function ground(d) { if (cur) cur.style.setProperty('--warm', String(Math.max(0, Math.min(0.32, d / 300)))); }

  function bind(page) {
    page.addEventListener('pointerdown', (e) => {
      if (busy) return;
      stopHint();
      startX = e.clientX; dx = 0; moved = false; t0 = performance.now(); lastX = e.clientX; lastT = t0; vel = 0;
      try { page.setPointerCapture(e.pointerId); } catch {}
      page.style.transition = 'none';
    });
    page.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      dx = e.clientX - startX;
      const now = performance.now();
      if (now > lastT) { vel = (e.clientX - lastX) / (now - lastT); lastX = e.clientX; lastT = now; }
      if (Math.abs(dx) > 6) moved = true;
      page.style.transform = `translateX(${dx}px) rotate(${dx / 17}deg)`;
      if (!isCover()) { page.style.opacity = dx < 0 ? String(Math.max(0.35, 1 - (-dx / 220) * 0.6)) : '1'; ground(dx); }
    });
    const end = () => {
      if (startX === null) return;
      startX = null;
      if (!moved) { page.style.transform = ''; page.style.opacity = ''; ground(0); if (isCover()) advance(); else onTap?.(items[i]); return; }
      if (isCover()) { if (Math.abs(dx) > 60) advance(dx < 0 ? -1 : 1); else { page.style.transition = 'transform .23s ease-out'; page.style.transform = ''; } return; }
      // A short flick counts as much as a long drag.
      const flick = Math.abs(vel) > 0.45 && Math.abs(dx) > 30;
      if (dx > 60 || (flick && dx > 0)) decide(1);
      else if (dx < -60 || (flick && dx < 0)) decide(-1);
      else { page.style.transition = 'transform .23s ease-out, opacity .23s ease-out'; page.style.transform = ''; page.style.opacity = ''; ground(0); }
    };
    page.addEventListener('pointerup', end);
    page.addEventListener('pointercancel', () => { startX = null; page.style.transform = ''; page.style.opacity = ''; ground(0); });
  }

  function advance(dir = -1) {
    busy = true;
    const page = cur;
    page.style.transition = 'transform .18s ease-in, opacity .18s ease-in';
    page.style.transform = `translateX(${dir * 120}%) rotate(${dir * 4}deg)`;
    setTimeout(() => { i++; busy = false; render(); }, 180);
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
    page.style.transition = 'transform .17s ease-in, opacity .17s ease-in';
    page.style.transform = `translateX(${dir * 115}%) rotate(${dir * 6}deg)`;
    page.style.opacity = dir < 0 ? '0' : '1';
    setTimeout(() => { i++; busy = false; render(); }, 170);
  }

  render();
  return { decide, get index() { return i; } };
}

// ================= ONBOARDING =================
// The first run: Anna (with a flash of three pieces) → what you'll do → double-tap → wishlists →
// forty swipes → pick three → time → Home Screen → notifications.

const STEPS = ['Show Anna your wishlists from any app or platform.', 'Swipe a selection of random items to help get a sense of your taste.', 'Choose the time for your Anna’s daily edit.', 'Add Anna to your Home Screen.'];
const stepMark = (n) => `<div class="stepmark">${n} of ${STEPS.length}</div>`;

function screenIntro() {
  saveStep('intro');
  screenToken++;
  const token = screenToken;
  $app.innerHTML = `<section class="intro">
    <div class="flash" id="flash"></div>
    <div class="mast" aria-label="Anna">An<br>na</div>
    <div class="foot" id="foot">
      <button class="btn light" id="go">Begin</button>
    </div></section>`;
  const el = $app.firstElementChild;
  el.querySelector('#go').onclick = () => { api('user', { method: 'POST', body: { stage: 'onboarding' } }).catch(() => {}); screenRunThrough(); };
  // The sizzle: Anna alone, then three pieces flash behind her, then the line and the button.
  const reveal = () => { if (token === screenToken) el.classList.add('ready'); };
  calibrationItems().then(async (items) => {
    const picks = items.filter((x) => x.image_url).slice(0, 12);
    const three = [picks[0], picks[4], picks[8]].filter(Boolean);
    const loaded = await Promise.all(three.map((it) => new Promise((res) => {
      const im = new Image(); im.referrerPolicy = 'no-referrer'; im.onload = () => res(im); im.onerror = () => res(null); im.src = it.image_url;
      setTimeout(() => res(null), 2500);
    })));
    const ims = loaded.filter(Boolean);
    if (token !== screenToken) return;
    const box = el.querySelector('#flash');
    await sleep(900);
    // Each piece fades in over the last, holds, then the next: slow enough to see, not a jolt.
    for (const im of ims) {
      if (token !== screenToken) return;
      im.className = 'ph'; im.alt = '';
      box.appendChild(im);
      requestAnimationFrame(() => requestAnimationFrame(() => im.classList.add('in')));
      await sleep(1300);
    }
    reveal();
  }).catch(reveal);
  setTimeout(reveal, 7000);
}

let _calib = null;
function calibrationItems() { return (_calib ||= api('calibration').then((r) => r.items)); }

function screenRunThrough() {
  saveStep('runthrough');
  const el = show(`
    <h1>To set up your Anna</h1>
    <ol class="steps big">${STEPS.map((t, k) => `<li><span class="num">${k + 1}</span><span>${esc(t)}</span></li>`).join('')}</ol>
    <button class="btn full red" id="go" style="margin-top:18px">Start</button>`);
  el.querySelector('#go').onclick = () => screenBackTap();
}

function screenBackTap() {
  saveStep('backtap');
  const shortcut = STATE?.shortcut_url;
  const ok = STATE?.user?.shortcut_ok;
  const el = show(`
    ${stepMark(1)}
    <h1>Set up the double-tap.</h1>
    <p class="lede big">Then you can show your Anna whatever’s on your screen, in any app.</p>
    ${ok ? `<p class="okline" style="margin-top:8px">Your double-tap is already working.</p>` : `
    <ol class="steps" style="margin-top:6px">
      <li><span class="num">1</span><span><b>Add the Anna shortcut.</b><span class="sub">Tap the red button, then Add Shortcut. When it asks for your code, type <b>${esc(AUTH.u)}.${esc(AUTH.k)}</b>.</span></span></li>
      <li><span class="num">2</span><span><b>Turn on the double-tap.</b><span class="sub">Open Settings › Accessibility › Touch › Back Tap › Double Tap, and choose Anna.</span></span></li>
      <li><span class="num">3</span><span><b>Come back and try it.</b><span class="sub">Double-tap the back of your phone on this screen. The first time, tap Always Allow.</span></span></li>
    </ol>`}
    <div class="grow"></div>
    ${ok ? '' : `${shortcut ? `<a class="btn full red" href="${esc(shortcut)}" target="_blank" rel="noopener">Add the shortcut</a>` : '<button class="btn full" disabled>Shortcut link coming soon</button>'}
    <div class="waiting" id="wait"><span class="dot"></span><span id="waittext">Waiting for your first double-tap…</span></div>`}
    <button class="btn ${ok ? 'full red' : 'link'}" id="next">${ok ? 'Next' : 'Skip for now'}</button>`);
  el.querySelector('#next').onclick = () => screenWishlists();
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
          el.querySelector('#waittext').textContent = 'It works. Anna’s seen it.';
          const nx = el.querySelector('#next'); nx.className = 'btn full red'; nx.textContent = 'Next';
          return;
        }
      } catch {}
    }
  })();
}

function screenWishlists() {
  saveStep('wishlists');
  const el = show(`
    ${stepMark(1)}
    <h1>Show Anna your wishlists.</h1>
    <ol class="steps" style="margin-top:6px">
      <li><span class="num">1</span><span>Open a wishlist or saved items, in any shop’s app or site, or Instagram saves.</span></li>
      <li><span class="num">2</span><span>Double-tap the back of your phone.</span></li>
      <li><span class="num">3</span><span>Scroll down and double-tap again, until you’ve shown Anna the lot.</span></li>
      <li><span class="num">4</span><span>Come back here.</span></li>
      <li><span class="num">5</span><span>Already have screenshots? <button class="inlink" id="photos">Add them from Photos</button>.<span class="sub" id="upmsg"></span></span></li>
    </ol>
    <div class="grow"></div>
    <button class="btn full red" id="done">I’ve done that</button>`);
  el.querySelector('#done').onclick = () => screenSwipeIntro();
  el.querySelector('#photos').onclick = () => pickPhotos(el.querySelector('#upmsg'));
}

function screenSwipeIntro() {
  saveStep('swipeintro');
  const el = show(`
    ${stepMark(2)}
    <h1>Let’s swipe.</h1>
    <p class="lede big">Swipe right if you love it. Swipe left if you don’t. Don’t think too hard.</p>
    <button class="btn full red" id="go" style="margin-top:18px">Go</button>`);
  el.querySelector('#go').onclick = () => screenCalibrate();
}

async function screenCalibrate() {
  saveStep('calibrate');
  screenToken++;
  $app.innerHTML = '<section class="deck" id="deck"></section>';
  let items;
  try { items = await calibrationItems(); } catch (e) { return screenError(e); }
  Deck(document.getElementById('deck'), items, { hint: true, context: 'calibration', onDone: () => { flush(); screenMostYou(); } });
}

// The same double-tap setup, reachable later from the end of the night and the waiting screen.
function screenCapture(back = screenHome) {
  const shortcut = STATE?.shortcut_url;
  const ok = STATE?.user?.shortcut_ok;
  const el = show(`
    <button class="btn link" id="back" style="align-self:flex-start">‹ Back</button>
    <h1>Show your Anna more things you love.</h1>
    <p class="lede">Double-tap the back of your phone on anything you love, in any app. Anna sees it.</p>
    ${ok ? `<p class="okline" style="margin:8px 0 0">Your double-tap is working.</p>` : `
    <ol class="steps" style="margin-top:8px">
      <li><span class="num">1</span><span><b>Add the Anna shortcut.</b><span class="sub">Tap the red button, then Add Shortcut. When it asks for your code, type <b>${esc(AUTH.u)}.${esc(AUTH.k)}</b>.</span></span></li>
      <li><span class="num">2</span><span><b>Turn on the double-tap.</b><span class="sub">Open Settings › Accessibility › Touch › Back Tap › Double Tap, and choose Anna.</span></span></li>
      <li><span class="num">3</span><span><b>Come back and try it.</b><span class="sub">Double-tap the back of your phone. The first time, tap Always Allow.</span></span></li>
    </ol>`}
    <div class="grow"></div>
    ${ok ? '' : (shortcut ? `<a class="btn full red" href="${esc(shortcut)}" target="_blank" rel="noopener">Add the shortcut</a>` : '')}
    <button class="btn link" id="photos">Or add screenshots from Photos</button>
    <p class="small" id="upmsg" style="margin:0"></p>`);
  el.querySelector('#back').onclick = () => back();
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
    <h1>Now, out of the ones you love, pick the three that are most you.</h1>
    <div class="grid3" id="g" style="margin-top:8px"></div>
    <div class="grow"></div>
    <button class="btn full red" id="done" disabled>Done</button>`);
  const g = el.querySelector('#g');
  const draw = () => {
    g.innerHTML = items.map((it) => {
      const n = picked.indexOf(it.id) + 1;
      return `<button class="tile ${n ? 'on' : ''}" data-id="${esc(it.id)}" aria-pressed="${n ? 'true' : 'false'}" aria-label="${esc(it.name || 'piece')}">
        <img src="${esc(it.image_url)}" alt="" referrerpolicy="no-referrer">${n ? `<span class="n" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span>` : ''}</button>`;
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

// "Today's Anna edition arrives at 8.30pm." — or tomorrow's, once today's time has passed (or today's is done).
function arrivesLine(dropTime, { done = false } = {}) {
  const t = dropTime || STATE?.user?.drop_time || '20:30';
  const [h, m] = t.split(':').map(Number);
  const now = new Date();
  const passed = now.getHours() * 60 + now.getMinutes() >= h * 60 + (m || 0);
  return `${done || passed ? 'Tomorrow’s' : 'Today’s'} Anna edition arrives at ${pretty(t)}.`;
}

const pretty = (t) => { const [h, m] = String(t).split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? '.' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };

function screenDropTime() {
  saveStep('droptime');
  const current = STATE?.user?.drop_time || '20:30';
  const el = show(`
    ${stepMark(3)}
    <h1>When should today’s Anna arrive?</h1>
    <p class="lede big">Change it anytime.</p>
    <div class="timebox"><label class="sr" for="t">Time</label><input id="t" type="time" value="${esc(current)}" step="900"></div>
    <button class="btn red center" id="set">Set</button>`);
  const input = el.querySelector('#t');
  // Move on at once; the time saves in the background.
  el.querySelector('#set').onclick = () => {
    const t = input.value || '20:30';
    STATE = { ...STATE, user: { ...(STATE?.user || {}), drop_time: t, stage: 'homescreen', drop_pretty: pretty(t) } };
    api('user', { method: 'POST', body: { drop_time: t, stage: 'homescreen' } }).then((r) => { STATE = r; }).catch(() => {});
    isStandalone ? screenNotify() : screenHomeScreen();
  };
}

const SAFARI = {
  dots: '<span class="glyph dots">•••</span>',
  share: '<svg class="glyph" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
  add: '<svg class="glyph" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
  toggle: '<span class="glyph toggle"><i></i></span>',
  icon: '<span class="glyph appicon">A</span>',
};

function screenHomeScreen() {
  saveStep('homescreen');
  // The Home Screen icon opens whatever address is showing when she adds it: make it just her link.
  try { history.replaceState(null, '', `/?${authQS()}`); } catch {}
  const el = show(`
    ${stepMark(4)}
    <h1>Add Anna to your Home Screen.</h1>
    <p class="lede big">Your Anna will bring you a personal edition once a day.</p>
    <ol class="hsteps">
      <li><span class="num">1</span><span>Tap ${SAFARI.dots} at the bottom right of Safari.</span></li>
      <li><span class="num">2</span><span>Tap ${SAFARI.share} <b>Share</b>.</span></li>
      <li><span class="num">3</span><span>Tap <b>View More</b>, then ${SAFARI.add} <b>Add to Home Screen</b>.</span></li>
      <li><span class="num">4</span><span>Make sure <b>Open as Web App</b> is on ${SAFARI.toggle}, then tap <b>Add</b>.</span></li>
      <li><span class="num">5</span><span>Safari closes. Find ${SAFARI.icon} <b>Anna</b> on your Home Screen and tap it.</span></li>
      <li><span class="num">6</span><span>Tap <b>Turn on notifications</b>, then <b>Allow</b>, so your Anna can tell you when your edition is here.</span></li>
    </ol>
    <div class="grow"></div>
    <button class="btn link" id="later">I’ll do this later</button>
    <div class="arrowdown right" aria-hidden="true"><svg width="28" height="40" viewBox="0 0 28 40" fill="none" stroke="#C8452B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v34M5 27l9 9 9-9"/></svg></div>`);
  el.querySelector('#later').onclick = async () => {
    try { STATE = await api('user', { method: 'POST', body: { stage: 'ready' } }); } catch {}
    saveStep('done');
    screenHome();
  };
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
    <h1>${esc(arrivesLine())}</h1>
    <p class="lede big">Turn on notifications and your Anna will tell you when it’s here. Once a day, nothing else.</p>
    <p class="error" id="err" style="margin:0"></p>
    <div style="height:20px"></div>
    <button class="btn full red" id="on">Turn on notifications</button>
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
    <p class="lede big" style="margin-top:8px">${esc(arrivesLine(STATE?.user?.drop_time))}</p>
    <div class="grow"></div>
    <button class="biglink red" id="show">Show your Anna more things you love.</button>
    <button class="biglink red" id="kept">Here’s everything you liked.</button>`, 'wait');
  el.querySelector('#kept').onclick = screenKept;
  el.querySelector('#show').onclick = () => screenCapture(screenHome);
}

// The closer look: the photo large, the credit beneath, the shop one tap away.
function closerLook(it, { context, editId = null, onKeep }) {
  track({ item_id: it.id, action: 'open', context, edit_id: editId });
  const d = document.createElement('div');
  d.className = 'detail';
  const wide = templateOf(it) === 'landscape';
  const shop = retailerName(it.source, it.brand) || 'the shop';
  d.innerHTML = `
    <div class="frame"><img src="${esc(it.image_url)}" alt="${esc(it.name || '')}" referrerpolicy="no-referrer" class="${wide ? 'contain' : ''}"></div>
    <div class="body">
      <div>
        ${it.url ? `<a class="brandlink" href="${esc(it.url)}" target="_blank" rel="noopener">${metaHTML(it)}</a>` : metaHTML(it)}
        ${it.url ? `<a class="go" href="${esc(it.url)}" target="_blank" rel="noopener">Take me to ${esc(shop)} &rarr;</a>` : ''}
      </div>
      <div class="acts">
        <button class="ring ${it._loved ? 'on' : ''}" aria-label="Keep" id="keep"><i></i></button>
        <button class="xbtn" aria-label="Close" id="close">&times;</button>
      </div>
    </div>`;
  $app.appendChild(d);
  fitPhoto(d.querySelector('.frame img'));
  d.querySelector('#close').onclick = () => d.remove();
  d.querySelectorAll('a[href]').forEach((a) => a.addEventListener('click', () => { track({ item_id: it.id, action: 'shop', context: 'detail', edit_id: editId }); flush(); }));
  d.querySelector('#keep').onclick = () => { d.remove(); onKeep?.(); };
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
  const openDetail = (it) => closerLook(it, { context: 'edit', editId: edit.id, onKeep: () => deck.decide(1) });
  deck = Deck(document.getElementById('deck'), items, {
    cover: fresh ? edit : null, hint: true, context: 'edit', editId: edit.id, onTap: openDetail,
    onDone: () => { flush(); api('edit/finished', { method: 'POST', body: {} }).catch(() => {}); screenEnd([...earlier, ...items.filter((i) => i._loved)]); },
  });
}

function screenEnd(kept) {
  const when = STATE?.user?.drop_pretty || '8.30pm';
  const el = show(`
    <h1 style="margin-top:40px">That’s today.</h1>
    <div class="keptrow small">${kept.slice(0, 8).map((it) => `<img src="${esc(it.image_url)}" alt="${esc(it.name || '')}" referrerpolicy="no-referrer">`).join('')}</div>
    <p class="endline">${esc(arrivesLine(STATE?.user?.drop_time, { done: true }))}</p>
    <button class="biglink red" id="show">Show your Anna more things you love.</button>
    <button class="biglink red" id="kept">Here’s everything you liked.</button>`, 'end');
  el.querySelector('#kept').onclick = screenKept;
  el.querySelector('#show').onclick = () => screenCapture(() => screenEnd(kept));
}

async function screenKept() {
  let items = [];
  try { items = (await api('kept')).items; } catch {}
  const el = show(`
    <button class="btn link" id="back" style="align-self:flex-start">‹ Back</button>
    <h1>Here’s everything you liked.</h1>
    ${items.length ? '' : '<p class="lede">Nothing yet. Swipe right on anything you love today.</p>'}
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

const RESUME = { intro: screenIntro, runthrough: screenRunThrough, backtap: screenBackTap, wishlists: screenWishlists,
  swipeintro: screenSwipeIntro, calibrate: screenCalibrate, addanywhere: screenBackTap, setup: screenBackTap, mostyou: screenMostYou, droptime: screenDropTime, homescreen: screenHomeScreen, notify: screenNotify };

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
