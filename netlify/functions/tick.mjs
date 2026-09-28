// Runs every 15 minutes: prepares tonight's edits a few hours ahead, and sends the
// notification at each person's chosen time. Heavy work is handed to background functions.
import * as store from '../../lib/store.mjs';
import { pushToUser } from '../../lib/push.mjs';
import { localNow, toMinutes } from '../../lib/util.mjs';

export const config = { schedule: '*/15 * * * *' };

const BUILD_AHEAD_MINUTES = 180;

async function trigger(name, body) {
  const base = process.env.URL;
  if (!base) return;
  await fetch(`${base}/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-anna-admin': process.env.ADMIN_KEY || '' },
    body: JSON.stringify(body || {}),
  }).catch((e) => console.error('[tick] trigger', name, e.message));
}

export default async () => {
  const users = (await store.listUsers()).filter((u) => u.stage === 'ready' || u.onboarded_at);
  const toBuild = [];
  let refreshSources = false;

  for (const u of users) {
    const { date, minutes } = localNow(u.tz);
    const drop = toMinutes(u.drop_time);
    const edit = await store.getEdit(u.id, date);
    if (!edit && minutes >= Math.max(0, drop - BUILD_AHEAD_MINUTES)) toBuild.push(u.id);
    if (edit && !edit.notified_at && minutes >= drop) {
      const r = await pushToUser(u.id, { title: 'Anna', body: 'Your Anna has tonight’s edit.', url: '/?open=edit' });
      await store.updateEdit(edit.id, { notified_at: new Date().toISOString() });
      console.log('[tick] notified', u.id, r);
    }
    // Refresh the fresh sources once a day, early in the first build window.
    if (!edit && minutes >= drop - BUILD_AHEAD_MINUTES && minutes < drop - BUILD_AHEAD_MINUTES + 15) refreshSources = true;
  }

  if ((await store.listCaptures(null, { status: 'pending', limit: 1 })).length) await trigger('process-captures-background');
  if (toBuild.length) await trigger('build-edits-background', { users: toBuild, refreshSources });
  console.log('[tick]', { users: users.length, building: toBuild });
};
