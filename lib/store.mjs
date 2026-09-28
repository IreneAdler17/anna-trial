// Data access for Anna. Two backends with the same functions:
//  - Supabase (production), using the service key from Netlify env vars
//  - a JSON file on disk (ANNA_MOCK=1) for local testing without any accounts
import fs from 'node:fs';
import path from 'node:path';

const MOCK = process.env.ANNA_MOCK === '1';
const MOCK_FILE = process.env.ANNA_MOCK_FILE || path.join(process.cwd(), '.anna-mock-db.json');
const BUCKET = 'anna-captures';

let _sb = null;
// Loaded lazily so local testing (ANNA_MOCK=1) works without the Supabase package installed.
export async function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY are not set');
  const { createClient } = await import('@supabase/supabase-js');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

// ---------- mock backend ----------
function mockLoad() {
  try { return JSON.parse(fs.readFileSync(MOCK_FILE, 'utf8')); }
  catch { return { users: {}, items: {}, events: [], captures: [], edits: [], push: {}, files: {} }; }
}
function mockSave(db) { fs.writeFileSync(MOCK_FILE, JSON.stringify(db)); }
function uuid() { return globalThis.crypto.randomUUID(); }
const now = () => new Date().toISOString();

function must({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

// ---------- users ----------
export async function getUser(id) {
  if (!id) return null;
  if (MOCK) return mockLoad().users[id] || null;
  return must(await (await sb()).from('anna_users').select('*').eq('id', id).maybeSingle());
}

export async function listUsers() {
  if (MOCK) return Object.values(mockLoad().users);
  return must(await (await sb()).from('anna_users').select('*').order('created_at'));
}

export async function createUser({ id, key, display_name }) {
  const row = { id, key, display_name, drop_time: '20:30', tz: 'Australia/Sydney', stage: 'new',
    most_you: [], shortcut_ok: false, created_at: now(), onboarded_at: null };
  if (MOCK) { const db = mockLoad(); db.users[id] = row; mockSave(db); return row; }
  return must(await (await sb()).from('anna_users').insert({ id, key, display_name }).select().single());
}

export async function updateUser(id, patch) {
  if (MOCK) { const db = mockLoad(); db.users[id] = { ...db.users[id], ...patch }; mockSave(db); return db.users[id]; }
  return must(await (await sb()).from('anna_users').update(patch).eq('id', id).select().single());
}

// ---------- items ----------
export async function upsertItems(items) {
  if (!items.length) return;
  const rows = items.map((it) => ({
    id: it.id, kind: it.kind, source: it.source ?? null, image_url: it.image_url ?? null,
    brand: it.brand ?? null, name: it.name ?? null, price: it.price ?? null,
    currency: it.currency ?? 'AUD', url: it.url ?? null, first_seen: it.first_seen ?? null,
    attrs: it.attrs ?? {}, description: it.description ?? null,
  }));
  if (MOCK) { const db = mockLoad(); for (const r of rows) db.items[r.id] = { ...db.items[r.id], ...r }; mockSave(db); return; }
  for (let i = 0; i < rows.length; i += 200) {
    must(await (await sb()).from('anna_items').upsert(rows.slice(i, i + 200), { onConflict: 'id' }));
  }
}

export async function getItems(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  if (MOCK) { const db = mockLoad(); return Object.fromEntries(uniq.filter((i) => db.items[i]).map((i) => [i, db.items[i]])); }
  const out = {};
  for (let i = 0; i < uniq.length; i += 200) {
    const rows = must(await (await sb()).from('anna_items').select('*').in('id', uniq.slice(i, i + 200)));
    for (const r of rows) out[r.id] = r;
  }
  return out;
}

// ---------- events ----------
export async function listItems({ kind, sinceDays = 14, limit = 400 } = {}) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  if (MOCK) return Object.values(mockLoad().items).filter((i) => (!kind || i.kind === kind) && (i.created_at || now()) >= since).slice(0, limit);
  let q = (await sb()).from('anna_items').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(limit);
  if (kind) q = q.eq('kind', kind);
  return must(await q);
}

export async function addEvents(events) {
  if (!events.length) return;
  const rows = events.map((e) => ({ user_id: e.user_id, item_id: e.item_id ?? null, action: e.action,
    context: e.context ?? null, edit_id: e.edit_id ?? null, ms: e.ms ?? null }));
  if (MOCK) { const db = mockLoad(); for (const r of rows) db.events.push({ ...r, id: db.events.length + 1, created_at: now() }); mockSave(db); return; }
  must(await (await sb()).from('anna_events').insert(rows));
}

export async function listEvents(userId, { limit = 500 } = {}) {
  if (MOCK) return mockLoad().events.filter((e) => e.user_id === userId).slice(-limit).reverse();
  return must(await (await sb()).from('anna_events').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(limit));
}

// ---------- captures ----------
export async function addCapture({ user_id, via, image_path }) {
  const row = { id: uuid(), user_id, via, image_path, status: 'pending', items: [], error: null, created_at: now() };
  if (MOCK) { const db = mockLoad(); db.captures.push(row); mockSave(db); return row; }
  return must(await (await sb()).from('anna_captures').insert({ id: row.id, user_id, via, image_path }).select().single());
}

export async function updateCapture(id, patch) {
  if (MOCK) { const db = mockLoad(); const c = db.captures.find((x) => x.id === id); Object.assign(c, patch); mockSave(db); return c; }
  return must(await (await sb()).from('anna_captures').update(patch).eq('id', id).select().single());
}

export async function listCaptures(userId, { limit = 100, status } = {}) {
  if (MOCK) {
    let rows = mockLoad().captures.filter((c) => (!userId || c.user_id === userId) && (!status || c.status === status));
    return rows.slice(-limit).reverse();
  }
  let q = (await sb()).from('anna_captures').select('*').order('created_at', { ascending: false }).limit(limit);
  if (userId) q = q.eq('user_id', userId);
  if (status) q = q.eq('status', status);
  return must(await q);
}

export async function uploadCaptureFile(filePath, bytes, contentType) {
  if (MOCK) { const db = mockLoad(); db.files[filePath] = { b64: Buffer.from(bytes).toString('base64'), contentType }; mockSave(db); return; }
  // Storage occasionally fails for no stated reason; try up to three times before giving up.
  let last;
  for (let n = 0; n < 3; n++) {
    const { error } = await (await sb()).storage.from(BUCKET).upload(filePath, bytes, { contentType, upsert: true });
    if (!error) return;
    last = error;
    console.error('[upload] attempt', n + 1, JSON.stringify({ name: error.name, status: error.status ?? error.statusCode, message: error.message, bytes: bytes.length, contentType }));
    await new Promise((r) => setTimeout(r, 400 * (n + 1)));
  }
  throw new Error(`upload failed: ${last?.message || 'unknown'}`);
}

export async function downloadCaptureFile(filePath) {
  if (MOCK) { const f = mockLoad().files[filePath]; return f ? { bytes: Buffer.from(f.b64, 'base64'), contentType: f.contentType } : null; }
  const blob = must(await (await sb()).storage.from(BUCKET).download(filePath));
  return { bytes: Buffer.from(await blob.arrayBuffer()), contentType: blob.type || 'image/png' };
}

// ---------- edits ----------
export async function getEdit(userId, date) {
  if (MOCK) return mockLoad().edits.find((e) => e.user_id === userId && e.edit_date === date) || null;
  return must(await (await sb()).from('anna_edits').select('*').eq('user_id', userId).eq('edit_date', date).maybeSingle());
}

export async function latestEdit(userId) {
  if (MOCK) return mockLoad().edits.filter((e) => e.user_id === userId).sort((a, b) => a.edit_date < b.edit_date ? 1 : -1)[0] || null;
  return must(await (await sb()).from('anna_edits').select('*').eq('user_id', userId)
    .order('edit_date', { ascending: false }).limit(1).maybeSingle());
}

export async function listEdits(userId, { limit = 60 } = {}) {
  if (MOCK) return mockLoad().edits.filter((e) => e.user_id === userId).slice(-limit);
  return must(await (await sb()).from('anna_edits').select('*').eq('user_id', userId)
    .order('edit_date', { ascending: false }).limit(limit));
}

export async function saveEdit({ user_id, edit_date, items }) {
  if (MOCK) {
    const db = mockLoad();
    const i = db.edits.findIndex((e) => e.user_id === user_id && e.edit_date === edit_date);
    const row = { id: i >= 0 ? db.edits[i].id : uuid(), user_id, edit_date, items, created_at: now(), notified_at: null, opened_at: null, finished_at: null };
    if (i >= 0) db.edits[i] = row; else db.edits.push(row);
    mockSave(db); return row;
  }
  return must(await (await sb()).from('anna_edits').upsert({ user_id, edit_date, items, notified_at: null, opened_at: null, finished_at: null },
    { onConflict: 'user_id,edit_date' }).select().single());
}

export async function updateEdit(id, patch) {
  if (MOCK) { const db = mockLoad(); const e = db.edits.find((x) => x.id === id); Object.assign(e, patch); mockSave(db); return e; }
  return must(await (await sb()).from('anna_edits').update(patch).eq('id', id).select().single());
}

// ---------- push subscriptions ----------
export async function savePush(userId, subscription) {
  if (MOCK) { const db = mockLoad(); db.push[subscription.endpoint] = { user_id: userId, subscription }; mockSave(db); return; }
  must(await (await sb()).from('anna_push').upsert({ endpoint: subscription.endpoint, user_id: userId, subscription }, { onConflict: 'endpoint' }));
}

export async function listPush(userId) {
  if (MOCK) return Object.values(mockLoad().push).filter((p) => p.user_id === userId);
  return must(await (await sb()).from('anna_push').select('*').eq('user_id', userId));
}

export async function deletePush(endpoint) {
  if (MOCK) { const db = mockLoad(); delete db.push[endpoint]; mockSave(db); return; }
  must(await (await sb()).from('anna_push').delete().eq('endpoint', endpoint));
}
