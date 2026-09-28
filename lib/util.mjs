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
