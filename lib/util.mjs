// Small shared helpers: time zones, auth, JSON responses.
import * as store from './store.mjs';

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
}

// Her local date (YYYY-MM-DD) and minutes-since-midnight in her time zone.
export function localNow(tz = 'Australia/Sydney', at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + Number(parts.minute) };
}

export function toMinutes(hhmm = '20:30') {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function prettyTime(hhmm = '20:30') {
  const mins = toMinutes(hhmm);
  const h = Math.floor(mins / 60), m = mins % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${m ? '.' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
}

// Every request from the phone carries ?u=<id>&k=<key> (or the same as JSON/body fields).
export async function authUser(req, body = null) {
  const url = new URL(req.url);
  const u = url.searchParams.get('u') || body?.u || req.headers.get('x-anna-user');
  const k = url.searchParams.get('k') || body?.k || req.headers.get('x-anna-key');
  if (!u || !k) return null;
  const user = await store.getUser(String(u).toLowerCase());
  if (!user || user.key !== k) return null;
  return user;
}

export function siteUrl(req) {
  if (process.env.URL) return process.env.URL;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

export function slugify(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}

export function randomKey(n = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Pipeline image URLs arrive in a few shapes; make each one a plain https URL or nothing.
export function cleanImage(raw) {
  if (!raw) return null;
  let u = String(raw).trim();
  if (u.startsWith('[')) { try { u = String(JSON.parse(u)[0] || ''); } catch { u = u.replace(/^\[\s*"?/, ''); } }
  u = u.split(/[\s,]+(?=https?:|\/\/)/)[0].replace(/^"|"$/g, '').trim();
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  return /^https:\/\/[^/]+\/.+/.test(u) ? u : null;
}

// Shopify's CDN resizes on request: ask for a phone-sized image, not the 20-megapixel original.
export function sizedImage(url, width = 900) {
  if (!url) return url;
  try {
    const x = new URL(url);
    if (x.hostname === 'cdn.shopify.com' || x.pathname.includes('/cdn/shop/')) {
      x.searchParams.set('width', String(width));
      return x.toString();
    }
  } catch {}
  return url;
}

// Quick check that an image actually loads (used to keep broken pictures out of the swipes).
export async function imageLoads(url, ms = 4000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const r = await fetch(sizedImage(url, 200), { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Anna trial)' } });
    clearTimeout(t);
    const ok = r.ok && (r.headers.get('content-type') || '').startsWith('image/');
    try { await r.body?.cancel(); } catch {}
    return ok;
  } catch { return false; }
}

// Start one of the background jobs and wait until Netlify has accepted it (it answers 202 straight away).
export async function kickBackground(name, body = {}, base = null) {
  const root = base || process.env.URL || 'https://anna-trial.netlify.app';
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`${root}/.netlify/functions/${name}`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-anna-admin': process.env.ADMIN_KEY || '' },
      body: JSON.stringify(body),
    });
    clearTimeout(t);
    console.log('[kick]', name, r.status);
    return r.status;
  } catch (e) {
    console.error('[kick]', name, e.message);
    return 0;
  }
}
