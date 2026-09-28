// Fresh sources beyond the pipeline — mostly for the wildcards (vintage, objects, art).
// Sources live in config/sources.json. Shopify stores expose a public products feed,
// which is the simplest reliable way to read a shop's current pieces with good photos.
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.mjs';
import { describe } from './pool.mjs';

export function loadSources() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config', 'sources.json'), 'utf8')).sources || [];
  } catch { return []; }
}

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Anna trial)', accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

function fromShopify(src, p) {
  const img = p.images?.[0]?.src;
  if (!img) return null;
  const price = Number(p.variants?.[0]?.price) || null;
  const available = (p.variants || []).some((v) => v.available !== false);
  const item = {
    id: `src:${src.domain}:${p.id}`,
    kind: 'fresh',
    source: src.name || src.domain,
    image_url: img,
    brand: p.vendor || src.name,
    name: p.title,
    price,
    currency: src.currency || 'AUD',
    url: `https://${src.domain}/products/${p.handle}`,
    first_seen: p.published_at || p.created_at || null,
    attrs: { category: p.product_type || null, source_bucket: src.bucket || 'wildcard', in_stock: available },
  };
  item.description = describe(item);
  return available ? item : null;
}

// Pull the latest pieces from every source and keep them in anna_items. Run once a day.
export async function refreshFreshSources() {
  const sources = loadSources();
  let total = 0;
  for (const src of sources) {
    if (src.type !== 'shopify') continue;
    const data = await getJson(`https://${src.domain}/products.json?limit=${src.limit || 60}`);
    const items = (data?.products || []).map((p) => fromShopify(src, p)).filter(Boolean);
    await store.upsertItems(items);
    total += items.length;
  }
  return total;
}

export async function freshCandidates(exclude = new Set()) {
  const items = await store.listItems({ kind: 'fresh', sinceDays: 10, limit: 300 });
  return items.filter((i) => !exclude.has(i.id));
}
