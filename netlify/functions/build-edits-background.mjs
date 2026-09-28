// Background: builds tonight's edit for the people listed in the request body (up to 15 minutes).
import * as store from '../../lib/store.mjs';
import { buildEdit } from '../../lib/edit.mjs';
import { refreshFreshSources } from '../../lib/sources.mjs';
import { isAdmin, localNow } from '../../lib/util.mjs';

export default async (req) => {
  if (!isAdmin(req.headers.get('x-anna-admin'))) { console.log('[build-edits] refused: no admin header'); return; }
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
    try { await buildEdit(user, date); }
    catch (err) { console.error('[build]', id, err.message); }
  }
};
