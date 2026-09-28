// The pipeline pool: reads candidate pieces from the existing pipeline table in Supabase.
// Column names come from env vars (POOL_COL_*) so nothing here assumes the pipeline's schema.
import fs from 'node:fs';
import path from 'node:path';
import { sb } from './store.mjs';
import { shuffle, cleanImage, imageLoads } from './util.mjs';

const MOCK = process.env.ANNA_MOCK === '1';
const env = (k, d = '') => (process.env[k] ?? d).trim();

function cols() {
  return {
    // Defaults match Daniela's pipeline_products table (checked 28 Sep 2026).
    table: env('POOL_TABLE', 'pipeline_products'),
    id: env('POOL_COL_ID', 'url_key'),
    image: env('POOL_COL_IMAGE', 'image_url'),
    brand: env('POOL_COL_BRAND', 'brand'),
    name: env('POOL_COL_NAME', 'title'),
    price: env('POOL_COL_PRICE', 'price'),
    comparePrice: env('POOL_COL_COMPARE_PRICE', 'compare_at_price'),
    currency: env('POOL_COL_CURRENCY', 'currency'),
    url: env('POOL_COL_URL', 'product_url'),
    source: env('POOL_COL_SOURCE', 'domain'),
    firstSeen: env('POOL_COL_FIRST_SEEN', 'first_seen'),
    category: env('POOL_COL_CATEGORY'),
    colour: env('POOL_COL_COLOUR'),
    material: env('POOL_COL_MATERIAL'),
    inStock: env('POOL_COL_IN_STOCK', 'available'),
  };
}

function selectList(c) {
  return [c.id, c.image, c.brand, c.name, c.price, c.comparePrice, c.currency, c.url, c.source, c.firstSeen, c.category, c.colour, c.material, c.inStock]
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(',');
}

export function normalize(row, c = cols()) {
  const num = (v) => (v == null ? null : Number(String(v).replace(/[^0-9.]/g, '')) || null);
  const price = num(row[c.price]);
  const compare = c.comparePrice ? num(row[c.comparePrice]) : null;
  const item = {
    id: `pipe:${row[c.id]}`,
    kind: 'pipeline',
    source: row[c.source] ?? null,
    image_url: cleanImage(row[c.image]),
    brand: row[c.brand] ?? null,
    name: row[c.name] ?? null,
    price,
    currency: (c.currency && row[c.currency]) || 'AUD',
    url: row[c.url] ?? null,
    first_seen: c.firstSeen ? row[c.firstSeen] ?? null : null,
    attrs: {
      ...(c.category && row[c.category] ? { category: row[c.category] } : {}),
      ...(c.colour && row[c.colour] ? { colour: row[c.colour] } : {}),
      ...(c.material && row[c.material] ? { material: row[c.material] } : {}),
      ...(c.inStock && row[c.inStock] != null ? { in_stock: Boolean(Number(row[c.inStock])) } : {}),
      ...(compare && price && compare > price ? { on_sale: true } : {}),
    },
  };
  item.description = describe(item);
  return item;
}

export function describe(it) {
  const a = it.attrs || {};
  return [it.brand, it.name, a.category, a.colour, a.material, it.price ? `$${Math.round(it.price)}` : null, a.on_sale ? 'on sale' : null, it.source]
    .filter(Boolean).join(' · ');
}

function mockPool() {
  const file = path.join(process.cwd(), 'config', 'sample_pool.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).map((it) => ({ ...it, description: it.description || describe(it) }));
}

async function totalRows(c) {
  const { count, error } = await (await sb()).from(c.table).select(c.id, { count: 'estimated', head: true });
  if (error) throw new Error(error.message);
  return count || 0;
}

async function page(c, from, size, orderNewest = false) {
  let q = (await sb()).from(c.table).select(selectList(c)).not(c.image, 'is', null);
  if (orderNewest && c.firstSeen) q = q.order(c.firstSeen, { ascending: false });
  if (c.inStock) q = q.gt(c.inStock, 0); // 'available' is 1 when in stock
  const { data, error } = await q.range(from, from + size - 1);
  if (error) throw new Error(error.message);
  return data.map((r) => normalize(r, c));
}

// A broad, varied set of candidates for tonight's edit: newest arrivals plus random slices.
export async function fetchCandidates({ exclude = new Set(), newest = 400, random = 4, perPage = 150, maxPerSource = 8 } = {}) {
  let items;
  if (MOCK) {
    items = mockPool();
  } else {
    const c = cols();
    const total = await totalRows(c);
    const jobs = newest > 0 ? [page(c, 0, newest, true)] : [];
    for (let i = 0; i < random; i++) {
      const from = Math.max(0, Math.floor(Math.random() * Math.max(1, total - perPage)));
      jobs.push(page(c, from, perPage));
    }
    const pages = await Promise.all(jobs);
    if (newest > 0) for (const it of pages[0]) it.attrs.recent = true;
    items = pages.flat();
  }
  // No single retailer may flood the candidates (a big new drop from one shop, say).
  const seen = new Set();
  const perSource = new Map();
  return items.filter((it) => {
    if (!it.image_url || exclude.has(it.id) || seen.has(it.id)) return false;
    const k = it.source || 'unknown';
    if ((perSource.get(k) || 0) >= maxPerSource) return false;
    perSource.set(k, (perSource.get(k) || 0) + 1);
    seen.add(it.id);
    return true;
  });
}

// The first-swipe calibration set: hand-picked ids from config/calibration.json when you
// have chosen them, otherwise a wide spread (no more than one piece per retailer).
export async function calibrationSet(n = 40) {
  const cfgFile = path.join(process.cwd(), 'config', 'calibration.json');
  let chosen = [];
  try { chosen = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).ids || []; } catch {}

  let pool;
  if (MOCK) pool = mockPool();
  else {
    const c = cols();
    if (chosen.length) {
      const { data, error } = await (await sb()).from(c.table).select(selectList(c)).in(c.id, chosen.map((x) => String(x).replace(/^pipe:/, '')));
      if (error) throw new Error(error.message);
      pool = data.map((r) => normalize(r, c));
    } else {
      pool = await fetchCandidates({ newest: 0, random: 5, perPage: 150 });
    }
  }

  const bySource = new Map();
  for (const it of shuffle(pool)) {
    const k = it.source || it.brand || it.id;
    if (!bySource.has(k)) bySource.set(k, it);
  }
  let picked = [...bySource.values()];
  if (picked.length < n + 30) picked = picked.concat(shuffle(pool).filter((i) => !picked.includes(i)));
  picked = picked.slice(0, n + 30);
  if (MOCK) return picked.slice(0, n);
  // Put pictures that load first; slow ones only fill gaps (the phone skips any that fail).
  const ok = await Promise.all(picked.map((it) => imageLoads(it.image_url, 2500)));
  return [...picked.filter((_, k) => ok[k]), ...picked.filter((_, k) => !ok[k])].slice(0, n);
}
