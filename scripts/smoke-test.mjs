// End-to-end check against the mock database: ANNA_MOCK=1 node scripts/smoke-test.mjs
// Adds a friend, runs her through onboarding calls, sends a "double-tap" screenshot,
// builds tonight's edit and swipes through it.
import fs from 'node:fs';
import path from 'node:path';

process.env.ANNA_MOCK = '1';
process.env.ADMIN_KEY = 'test-admin';
process.env.ANNA_MOCK_FILE = path.join(process.cwd(), '.anna-smoke-db.json');
try { fs.unlinkSync(process.env.ANNA_MOCK_FILE); } catch {}

const api = (await import('../netlify/functions/api.mjs')).default;
const capture = (await import('../netlify/functions/capture.mjs')).default;
const { processPending } = await import('../lib/captures.mjs');
const { buildEdit } = await import('../lib/edit.mjs');
const store = await import('../lib/store.mjs');
const { localNow } = await import('../lib/util.mjs');

const base = 'http://localhost:8888';
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };
async function call(fn, p, { method = 'GET', body, headers } = {}) {
  const res = await fn(new Request(base + p, { method, body, headers }));
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// 1. Add a friend
const add = await call(api, '/api/admin?admin=test-admin&action=add&name=Sophie');
check(add.status === 200 && add.data.link.includes('u=sophie'), `admin add → ${add.data.link}`);
const k = new URL(add.data.link).searchParams.get('k');
const q = `u=sophie&k=${k}`;

// 2. Bad key is refused
check((await call(api, '/api/me?u=sophie&k=wrong')).status === 401, 'wrong key refused');

// 3. State + calibration
const me = await call(api, `/api/me?${q}`);
check(me.status === 200 && me.data.user.stage === 'new', 'me: stage new');
const cal = await call(api, `/api/calibration?${q}`);
check(cal.data.items?.length >= 20, `calibration: ${cal.data.items?.length} pieces`);

// 4. Swipe calibration: love every third
const events = cal.data.items.map((it, n) => ({ item_id: it.id, action: n % 3 === 0 ? 'love' : 'pass', context: 'calibration', ms: 900 }));
const ev = await call(api, `/api/events?${q}`, { method: 'POST', body: JSON.stringify({ events }), headers: { 'content-type': 'application/json' } });
check(ev.data.saved === events.length, `events saved: ${ev.data.saved}`);

// 5. Double-tap capture from the Shortcut
const img = fs.readFileSync(path.join(process.cwd(), 'dev-fixtures', '252.jpg'));
const cap = await call(capture, `/capture?c=sophie.${k}`, { method: 'POST', body: img, headers: { 'content-type': 'image/jpeg' } });
check(cap.status === 200 && String(cap.data).includes('Sent'), `shortcut capture → "${cap.data}"`);
check((await call(api, `/api/me?${q}`)).data.user.shortcut_ok === true, 'shortcut_ok flips on first double-tap');
const processed = await processPending();
check(processed.captures === 1, `capture processed (${JSON.stringify(processed)})`);

// 6. Most you + time + ready
const my = await call(api, `/api/mostyou?${q}`);
check(my.data.items.length >= 3, `most-you candidates: ${my.data.items.length}`);
const pick = my.data.items.slice(0, 3).map((i) => i.id);
const up = await call(api, `/api/user?${q}`, { method: 'POST', body: JSON.stringify({ most_you: pick, drop_time: '00:00', stage: 'ready' }), headers: { 'content-type': 'application/json' } });
check(up.data.user.stage === 'ready' && up.data.user.most_you.length === 3, 'most you + time + ready saved');

// 7. Build tonight's edit and fetch it
const user = await store.getUser('sophie');
const edit = await buildEdit(user, localNow(user.tz).date, { log: () => {} });
check(edit.items.length === 12, `edit built: ${edit.items.length} pieces`);
const shown = new Set(cal.data.items.map((i) => i.id));
check(!edit.items.some((i) => shown.has(i.item_id)), 'edit avoids pieces already swiped (when the pool allows)');
const got = await call(api, `/api/edit?${q}`);
check(got.data.status === 'ready' && got.data.edit.items.length >= 1, `edit served: ${got.data.edit?.items.length} cards`);

// 8. Swipe it, finish, see kept
const e2 = got.data.edit.items.map((it, n) => ({ item_id: it.id, action: n < 4 ? 'love' : 'pass', context: 'edit', edit_id: got.data.edit.id }));
await call(api, `/api/events?${q}`, { method: 'POST', body: JSON.stringify({ events: e2 }), headers: { 'content-type': 'application/json' } });
await call(api, `/api/edit/finished?${q}`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
const kept = await call(api, `/api/kept?${q}`);
check(kept.data.items.length === Math.min(4, got.data.edit.items.length), `kept: ${kept.data.items.length}`);
const stats = await call(api, '/api/admin?admin=test-admin&action=stats');
check(stats.data.users[0].edits_finished === 1, `stats: ${JSON.stringify(stats.data.users[0])}`);

fs.unlinkSync(process.env.ANNA_MOCK_FILE);
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
