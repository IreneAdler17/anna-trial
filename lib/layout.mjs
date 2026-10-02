// Layout for the night: which page template each piece gets, and the cut-outs that make
// the Behind and Product pages possible. Rules (from the Anna design canvas, 30 Sep 2026):
//
//   behind    portrait photo with a person, cut-out succeeded → brand headline behind her
//   product   object / beauty with a clean cut-out, shown on cream
//   landscape any photo wider than it is tall
//   tail      the fallback: any portrait photo where the cut-out fails or the ground is busy
//
// Sequence for the twelve: never the same template twice in a row; at least two Product pages
// a night when there are any; open with Behind or Tail; close with Landscape or Product.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.mjs';
import { sizedImage } from './util.mjs';

const MOCK = process.env.ANNA_MOCK === '1';
const CUTOUT_PREFIX = '_cutouts/';
const env = (k, d = '') => (process.env[k] ?? d).trim();

// ---------- image size, from the file header (no image library needed) ----------
export function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  // WebP
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    if (chunk === 'VP8X') return { w: (buf.readUIntLE(24, 3)) + 1, h: (buf.readUIntLE(27, 3)) + 1 };
  }
  // JPEG: walk the markers to the first SOF
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

async function fetchBytes(url, { ms = 6000, max = 4_000_000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Anna trial)' } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > max ? null : buf;
  } catch { return null; } finally { clearTimeout(t); }
}

// Aspect ratio (w/h) from a small copy of the photo.
export async function probeAspect(imageUrl) {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('/')) {
    // Local testing: fixture images on disk.
    try { const s = imageSize(fs.readFileSync(path.join(process.cwd(), 'dev-fixtures', path.basename(imageUrl)))); return s ? s.w / s.h : null; } catch { return null; }
  }
  const buf = await fetchBytes(sizedImage(imageUrl, 200), { ms: 5000 });
  const s = buf && imageSize(buf);
  return s && s.w && s.h ? s.w / s.h : null;
}

// ---------- cut-outs (remove.bg, behind CUTOUT_API_KEY) ----------
export function hasCutouts() { return Boolean(env('CUTOUT_API_KEY')) || MOCK; }

function cutoutId(imageUrl) { return createHash('sha1').update(imageUrl).digest('hex').slice(0, 20); }

// Local testing: a hand-made cut-out in dev-fixtures/cut/person-<name>.png or product-<name>.png stands in for remove.bg.
async function mockCutout(imageUrl, id) {
  const base = path.basename(imageUrl).replace(/\.\w+$/, '');
  for (const type of ['person', 'product']) {
    const f = path.join(process.cwd(), 'dev-fixtures', 'cut', `${type}-${base}.png`);
    if (fs.existsSync(f)) { await store.uploadCaptureFile(`${CUTOUT_PREFIX}${id}.png`, fs.readFileSync(f), 'image/png'); return { ok: true, id, type, share: 0.5 }; }
  }
  return { ok: false, id };
}

// Returns { id, type: 'person' | 'product', box } or null when the cut-out isn't clean enough to use.
export async function cutout(imageUrl, { log = console.log } = {}) {
  if (!hasCutouts() || !imageUrl) return null;
  const id = cutoutId(imageUrl);
  if (MOCK) { const r = await mockCutout(imageUrl, id); return r.ok ? r : null; }
  if (imageUrl.startsWith('/')) return null;
  const existing = await store.loadJson(`${CUTOUT_PREFIX}${id}.json`);
  if (existing) return existing.ok ? existing : null;
  let result = { ok: false, id };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25000);
    const r = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': env('CUTOUT_API_KEY'), 'content-type': 'application/json', accept: 'image/png' },
      body: JSON.stringify({ image_url: sizedImage(imageUrl, 1200), size: env('CUTOUT_SIZE', 'auto'), type: 'auto', format: 'png', crop: false }),
    });
    clearTimeout(t);
    if (!r.ok) {
      log(`[cutout] ${id}: HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
    } else {
      const bytes = Buffer.from(await r.arrayBuffer());
      const type = (r.headers.get('x-type') || 'other').toLowerCase();
      const W = Number(r.headers.get('x-width')) || 0, H = Number(r.headers.get('x-height')) || 0;
      const box = { top: Number(r.headers.get('x-foreground-top')) || 0, left: Number(r.headers.get('x-foreground-left')) || 0,
        w: Number(r.headers.get('x-foreground-width')) || 0, h: Number(r.headers.get('x-foreground-height')) || 0 };
      const share = W && H && box.w && box.h ? (box.w * box.h) / (W * H) : 0;
      // A usable cut-out: a person or a product, filling a sensible share of the frame, not the whole thing.
      const ok = (type === 'person' || type === 'product') && share > 0.08 && share < 0.97 && bytes.length > 2000;
      if (ok) await store.uploadCaptureFile(`${CUTOUT_PREFIX}${id}.png`, bytes, 'image/png');
      result = { ok, id, type, box: { ...box, W, H }, share: Number(share.toFixed(3)) };
      log(`[cutout] ${id}: ${type} share=${result.share} ${ok ? 'kept' : 'rejected'}`);
    }
  } catch (e) { log(`[cutout] ${id}: ${e.message}`); }
  await store.saveJson(`${CUTOUT_PREFIX}${id}.json`, result).catch(() => {});
  return result.ok ? result : null;
}

export async function cutoutFile(id) {
  if (!/^[a-f0-9]{20}$/.test(id)) return null;
  return store.downloadCaptureFile(`${CUTOUT_PREFIX}${id}.png`).catch(() => null);
}

// ---------- template per piece ----------
export function templateFor({ aspect, cut }) {
  if (aspect && aspect > 1.05) return 'landscape';
  if (cut?.type === 'person') return 'behind';
  if (cut?.type === 'product') return 'product';
  return 'tail';
}

// Measures and cuts every piece, then decides its template. Items are mutated in place with
// layout: { template, aspect, cutout } and returned in display order.
export async function layoutEdit(items, { log = console.log, maxCutouts = Number(env('CUTOUT_MAX_PER_BUILD', '14')) } = {}) {
  await Promise.all(items.map(async (it) => { it._aspect = await probeAspect(it.image_url); }));
  let budget = maxCutouts;
  await Promise.all(items.map(async (it) => {
    it._cut = null;
    if (it._aspect && it._aspect > 1.05) return; // landscape never needs one
    if (budget-- <= 0) return;
    it._cut = await cutout(it.image_url, { log });
  }));
  for (const it of items) {
    it.layout = { template: templateFor({ aspect: it._aspect, cut: it._cut }), aspect: it._aspect ? Number(it._aspect.toFixed(3)) : null,
      cutout: it._cut ? it._cut.id : null };
    delete it._aspect; delete it._cut;
  }
  return sequence(items);
}

// Order the night: no template twice running, at least two Product pages, open on Behind/Tail,
// close on Landscape/Product. Keeps the incoming order (Claude's rhythm) wherever it can.
export function sequence(items) {
  const rest = items.slice();
  const out = [];
  const tpl = (it) => it.layout?.template || 'tail';
  const takeWhere = (pred) => { const k = rest.findIndex(pred); return k >= 0 ? rest.splice(k, 1)[0] : null; };
  const count = (t) => rest.filter((it) => tpl(it) === t).length;
  // Hold one Landscape or Product back for the last page.
  const closer = takeWhere((it) => tpl(it) === 'landscape') || takeWhere((it) => tpl(it) === 'product');
  const first = takeWhere((it) => tpl(it) === 'behind' && it.bucket === 'you') || takeWhere((it) => tpl(it) === 'behind')
    || takeWhere((it) => tpl(it) === 'tail') || rest.shift();
  if (first) out.push(first);
  while (rest.length) {
    const prev = tpl(out[out.length - 1]);
    // Prefer whichever template has the most left to place, so a run of one kind spreads out.
    const options = rest.filter((it) => tpl(it) !== prev);
    let next;
    if (options.length) {
      const best = Math.max(...options.map((it) => count(tpl(it))));
      next = options.find((it) => count(tpl(it)) === best);
    } else next = rest[0];
    rest.splice(rest.indexOf(next), 1);
    out.push(next);
  }
  if (closer) {
    if (!out.length || tpl(out[out.length - 1]) !== tpl(closer)) out.push(closer);
    else {
      // Would repeat: slot it in the last place it doesn't.
      let placed = false;
      for (let k = out.length - 1; k > 0; k--) {
        if (tpl(out[k]) !== tpl(closer) && tpl(out[k - 1]) !== tpl(closer)) { out.splice(k, 0, closer); placed = true; break; }
      }
      if (!placed) out.push(closer);
    }
  }
  return out;
}
