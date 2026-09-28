// Background (up to 15 min): makes the curated first-swipe set. Triggered by the admin
// "calibrate" action, by the API when no set exists yet, and weekly by the tick.
import { buildCalibration } from '../../lib/calibrate.mjs';

export default async (req) => {
  if ((req.headers.get('x-anna-admin') || '') !== (process.env.ADMIN_KEY || '')) return new Response('forbidden', { status: 403 });
  try { await buildCalibration(); } catch (err) { console.error('[calibrate]', err); }
  return new Response('ok');
};
