// Web push to her phone (works on iPhone once Anna is on her Home Screen).
import * as store from './store.mjs';

let webpush = null;
async function setup() {
  if (webpush) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush = (await import('web-push')).default;
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:anna@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  return true;
}

export async function pushToUser(userId, payload) {
  if (!(await setup())) return { sent: 0, reason: 'no VAPID keys' };
  const subs = await store.listPush(userId);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 60 * 60 * 6, urgency: 'high' });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await store.deletePush(s.subscription.endpoint);
      else console.error('[push]', userId, err.statusCode, err.body || err.message);
    }
  }
  return { sent };
}
