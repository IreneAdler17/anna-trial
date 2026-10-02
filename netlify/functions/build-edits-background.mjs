// Background: builds tonight's edit for the people listed in the request body (up to 15 minutes).
import * as store from '../../lib/store.mjs';
import { buildEdit } from '../../lib/edit.mjs';
import { refreshFreshSources } from '../../lib/sources.mjs';
import { isAdmin, localNow } from '../../lib/util.mjs';

export default async (req) => {
  if (!isAdmin(req.headers.get('x-anna-admin'))) { console.log('[build-edits] refused: no admin header'); await store.logLine('_config/build-log.json', { ok: false, error: 'refused: admin key did not match' }); return; }
  console.log('[build-edits] start');
  let body = {};
  try { body = await req.json(); } catch {}
  if (body.refreshSources) {
    const n = await refreshFreshSources().catch((e) => { console.error('[sources]', e.message); return 0; });
    console.log('[sources] refreshed', n);
  }
  for (const id of body.users || []) {
    const user = await store.getUser(id);
    if (!user) continue;
    const { date } = localNow(user.tz);
    if (!body.force && await store.getEdit(user.id, date)) continue;
    const t0 = Date.now();
    try {
      const edit = await buildEdit(user, date);
      await store.logLine('_config/build-log.json', { user: id, date, ok: true, pieces: edit.items.length,
        pages: edit.items.map((i) => i.template || '-').join(' '), secs: Math.round((Date.now() - t0) / 1000), site: process.env.CONTEXT || null });
    } catch (err) {
      console.error('[build]', id, err.message);
      await store.logLine('_config/build-log.json', { user: id, date, ok: false, error: String(err.message || err).slice(0, 400),
        secs: Math.round((Date.now() - t0) / 1000), site: process.env.CONTEXT || null });
    }
  }
};
