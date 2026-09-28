// Everything the phone app talks to: /api/*
import * as store from '../../lib/store.mjs';
import * as pool from '../../lib/pool.mjs';
import { buildEdit } from '../../lib/edit.mjs';
import { pushToUser } from '../../lib/push.mjs';
import { sizedImage, json, authUser, localNow, toMinutes, prettyTime, siteUrl, slugify, randomKey } from '../../lib/util.mjs';

export const config = { path: '/api/*' };

function publicItem(it) {
  if (!it) return null;
  return { id: it.id, image_url: sizedImage(it.image_url, 900), brand: it.brand, name: it.name, price: it.price,
    currency: it.currency, url: it.url, source: it.source };
}

async function readBody(req) {
  if (req.method === 'GET') return null;
  try { return await req.json(); } catch { return {}; }
}

async function stateFor(user) {
  const { date, minutes } = localNow(user.tz);
  const edit = await store.getEdit(user.id, date);
  const dropMins = toMinutes(user.drop_time);
  const captures = await store.listCaptures(user.id, { limit: 200 });
  return {
    user: { id: user.id, name: user.display_name, stage: user.stage, drop_time: user.drop_time,
      drop_pretty: prettyTime(user.drop_time), shortcut_ok: user.shortcut_ok, most_you: user.most_you },
    today: { date, edit_ready: Boolean(edit) && minutes >= dropMins, edit_exists: Boolean(edit) },
    captures: { count: captures.length, latest: captures[0]?.created_at || null },
    shortcut_url: process.env.SHORTCUT_URL || 'https://www.icloud.com/shortcuts/84ee3bc70c824196a1abb4521cbcc4d5',
    vapid_public_key: process.env.VAPID_PUBLIC_KEY || null,
  };
}

async function editPayload(user, edit) {
  const items = await store.getItems(edit.items.map((i) => i.item_id));
  return {
    id: edit.id, date: edit.edit_date,
    items: edit.items.map((i) => ({ ...publicItem(items[i.item_id]), bucket: i.bucket })).filter((i) => i.id && i.image_url),
  };
}

async function admin(req, url) {
  if (!process.env.ADMIN_KEY || url.searchParams.get('admin') !== process.env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const action = url.searchParams.get('action');
  if (action === 'add') {
    const name = url.searchParams.get('name');
    if (!name) return json({ error: 'name required' }, 400);
    const id = slugify(name);
    if (await store.getUser(id)) return json({ error: `${id} already exists` }, 409);
    const user = await store.createUser({ id, key: randomKey(), display_name: name });
    return json({ id: user.id, link: `${siteUrl(req)}/?u=${user.id}&k=${user.key}`, shortcut_code: `${user.id}.${user.key}` });
  }
  if (action === 'users' || action === 'stats') {
    const users = await store.listUsers();
    const out = [];
    for (const u of users) {
      const ev = await store.listEvents(u.id, { limit: 5000 });
      const edits = await store.listEdits(u.id, { limit: 60 });
      const count = (a, ctx) => ev.filter((e) => e.action === a && (!ctx || e.context === ctx)).length;
      out.push({ id: u.id, stage: u.stage, drop_time: u.drop_time, shortcut_ok: u.shortcut_ok,
        link: action === 'users' ? `${siteUrl(req)}/?u=${u.id}&k=${u.key}` : undefined,
        edits: edits.length, edits_opened: edits.filter((e) => e.opened_at).length,
        edits_finished: edits.filter((e) => e.finished_at).length,
        loves: count('love', 'edit'), passes: count('pass', 'edit'), opens: count('open'), shop_taps: count('shop'),
        captures: count('capture') });
    }
    return json({ users: out });
  }
  if (action === 'build') {
    const user = await store.getUser(url.searchParams.get('u'));
    if (!user) return json({ error: 'no such user' }, 404);
    const edit = await buildEdit(user, localNow(user.tz).date);
    return json({ ok: true, pieces: edit.items.length });
  }
  if (action === 'vapid') {
    // One-off: makes the notification key pair inside your own site, so the private key never leaves it.
    const { createECDH } = await import('node:crypto');
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return json({ VAPID_PUBLIC_KEY: b64u(ecdh.getPublicKey()), VAPID_PRIVATE_KEY: b64u(ecdh.getPrivateKey()),
      next: 'Add both as environment variables in Netlify, then redeploy.' });
  }
  if (action === 'push') {
    const user = await store.getUser(url.searchParams.get('u'));
    if (!user) return json({ error: 'no such user' }, 404);
    return json(await pushToUser(user.id, { title: 'Anna', body: 'Testing, testing — this is your Anna.', url: '/' }));
  }
  return json({ error: 'unknown action' }, 400);
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  try {
    if (route === 'admin') return await admin(req, url);

    const body = await readBody(req);
    const user = await authUser(req, body);
    if (!user) return json({ error: 'This link is not valid. Ask Daniela for yours.' }, 401);

    if (route === 'me') return json(await stateFor(user));

    if (route === 'calibration') {
      const items = await pool.calibrationSet(40);
      await store.upsertItems(items);
      return json({ items: items.map(publicItem) });
    }

    if (route === 'events' && req.method === 'POST') {
      const events = (body.events || []).slice(0, 200).map((e) => ({
        user_id: user.id, item_id: e.item_id, action: e.action, context: e.context, edit_id: e.edit_id || null,
        ms: Number.isFinite(e.ms) ? Math.round(e.ms) : null,
      })).filter((e) => ['love', 'pass', 'open', 'shop', 'most_you'].includes(e.action));
      await store.addEvents(events);
      return json({ ok: true, saved: events.length });
    }

    if (route === 'user' && req.method === 'POST') {
      const patch = {};
      if (typeof body.drop_time === 'string' && /^\d{1,2}:\d{2}$/.test(body.drop_time)) patch.drop_time = body.drop_time;
      if (Array.isArray(body.most_you)) patch.most_you = body.most_you.slice(0, 3);
      if (['onboarding', 'homescreen', 'ready'].includes(body.stage)) patch.stage = body.stage;
      if (body.stage === 'ready' && !user.onboarded_at) patch.onboarded_at = new Date().toISOString();
      const updated = Object.keys(patch).length ? await store.updateUser(user.id, patch) : user;
      if (body.stage === 'ready' && user.stage !== 'ready' && process.env.URL) {
        // Start her first edit now so it is ready by her drop time.
        await Promise.race([
          fetch(`${process.env.URL}/.netlify/functions/build-edits-background`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-anna-admin': process.env.ADMIN_KEY || '' },
            body: JSON.stringify({ users: [user.id] }),
          }).catch(() => {}),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      }
      return json(await stateFor(updated));
    }

    if (route === 'mostyou') {
      // Her strongest signals so far: what she loved in calibration plus pieces from her screenshots.
      const ev = await store.listEvents(user.id, { limit: 500 });
      const loved = [...new Set(ev.filter((e) => e.action === 'love').map((e) => e.item_id))];
      const items = await store.getItems(loved);
      return json({ items: loved.map((id) => publicItem(items[id])).filter((i) => i?.image_url).slice(0, 12) });
    }

    if (route === 'push' && req.method === 'POST') {
      if (!body.subscription?.endpoint) return json({ error: 'no subscription' }, 400);
      await store.savePush(user.id, body.subscription);
      return json({ ok: true });
    }

    if (route === 'edit') {
      const { date, minutes } = localNow(user.tz);
      let edit = await store.getEdit(user.id, date);
      const early = url.searchParams.get('preview') === '1';
      if (!edit || (!early && minutes < toMinutes(user.drop_time))) {
        const last = await store.latestEdit(user.id);
        if (last && last.edit_date !== date && url.searchParams.get('last') === '1') return json({ edit: await editPayload(user, last), status: 'last' });
        return json({ status: 'waiting', drop_pretty: prettyTime(user.drop_time) });
      }
      if (!edit.opened_at) edit = await store.updateEdit(edit.id, { opened_at: new Date().toISOString() });
      // So she picks up where she left off, and a finished edit shows its summary instead of restarting.
      const ev = (await store.listEvents(user.id, { limit: 400 })).filter((e) => e.edit_id === edit.id);
      const decided = [...new Set(ev.filter((e) => e.action === 'love' || e.action === 'pass').map((e) => e.item_id))];
      const kept = [...new Set(ev.filter((e) => e.action === 'love').map((e) => e.item_id))];
      return json({ status: 'ready', edit: { ...(await editPayload(user, edit)), decided, kept, finished: Boolean(edit.finished_at) } });
    }

    if (route === 'edit/finished' && req.method === 'POST') {
      const edit = await store.getEdit(user.id, localNow(user.tz).date);
      if (edit && !edit.finished_at) await store.updateEdit(edit.id, { finished_at: new Date().toISOString() });
      return json({ ok: true });
    }

    if (route === 'kept') {
      const ev = await store.listEvents(user.id, { limit: 3000 });
      const ids = [...new Set(ev.filter((e) => e.action === 'love' && e.context === 'edit').map((e) => e.item_id))];
      const items = await store.getItems(ids);
      return json({ items: ids.map((id) => publicItem(items[id])).filter(Boolean) });
    }

    return json({ error: 'not found' }, 404);
  } catch (err) {
    console.error('[api]', route, err);
    return json({ error: 'Something went wrong on our side.' }, 500);
  }
};
