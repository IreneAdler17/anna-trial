// Builds the curated first-swipe set: a wide spread from the pipeline, vetted by Claude looking
// at the photos, saved so every new person starts from the same strong set. Refreshed weekly.
import * as store from './store.mjs';
import * as pool from './pool.mjs';
import { CALIBRATION_MIX } from './category.mjs';
import { hasClaude, curateCalibration } from './claude.mjs';

export const CALIBRATION_FILE = '_config/calibration-v3.json';
const MAX_AGE_DAYS = 7;
const LOCK_FILE = '_config/calibration-building-v3.json';

// Should a (re)build start now? Yes if there's no good curated set, unless one started in the last 10 minutes.
export async function needsBuild(cached) {
  if (cached && cached.curated && !cached.stale && cached.items.length >= 30) return false;
  const lock = await store.loadJson(LOCK_FILE);
  return !(lock?.at && Date.now() - Date.parse(lock.at) < 10 * 60 * 1000);
}

export async function loadCalibration() {
  const c = await store.loadJson(CALIBRATION_FILE);
  if (!c?.items?.length) return null;
  const ageDays = (Date.now() - Date.parse(c.created_at || 0)) / 86400000;
  return { ...c, stale: ageDays > MAX_AGE_DAYS };
}

export async function buildCalibration({ n = 40, log = console.log } = {}) {
  await store.saveJson(LOCK_FILE, { at: new Date().toISOString() }).catch(() => {});
  const candidates = pool.quotaPick(await pool.calibrationPool(), CALIBRATION_MIX, n, 2);
  log('[calibrate] candidates', candidates.length);
  const mixText = Object.entries(CALIBRATION_MIX).map(([k, v]) => `${v} ${k}`).join(', ');
  let items = null;
  let note = hasClaude() ? '' : 'no Claude key';
  if (hasClaude()) {
    try { items = await curateCalibration({ candidates, n, mixText }); if (!items) note = 'Claude returned too few'; }
    catch (e) { note = `Claude error: ${e.message}`.slice(0, 300); log('[calibrate]', note); }
  }
  const curated = Boolean(items);
  if (!items) items = pool.spread(candidates).slice(0, n);
  await store.upsertItems(items);
  const out = { created_at: new Date().toISOString(), curated, note, candidates: candidates.length, items };
  await store.saveJson(CALIBRATION_FILE, out);
  log('[calibrate] saved', { count: items.length, curated });
  return out;
}
