// Builds the curated first-swipe set: a wide spread from the pipeline, vetted by Claude looking
// at the photos, saved so every new person starts from the same strong set. Refreshed weekly.
import * as store from './store.mjs';
import * as pool from './pool.mjs';
import { CALIBRATION_MIX } from './category.mjs';
import { hasClaude, curateCalibration } from './claude.mjs';

export const CALIBRATION_FILE = '_config/calibration.json';
const MAX_AGE_DAYS = 7;

export async function loadCalibration() {
  const c = await store.loadJson(CALIBRATION_FILE);
  if (!c?.items?.length) return null;
  const ageDays = (Date.now() - Date.parse(c.created_at || 0)) / 86400000;
  return { ...c, stale: ageDays > MAX_AGE_DAYS };
}

export async function buildCalibration({ n = 40, log = console.log } = {}) {
  const candidates = pool.quotaPick(await pool.calibrationPool(), CALIBRATION_MIX, n, 2);
  log('[calibrate] candidates', candidates.length);
  const mixText = Object.entries(CALIBRATION_MIX).map(([k, v]) => `${v} ${k}`).join(', ');
  let items = hasClaude() ? await curateCalibration({ candidates, n, mixText }) : null;
  const curated = Boolean(items);
  if (!items) items = pool.spread(candidates).slice(0, n);
  await store.upsertItems(items);
  const out = { created_at: new Date().toISOString(), curated, items };
  await store.saveJson(CALIBRATION_FILE, out);
  log('[calibrate] saved', { count: items.length, curated });
  return out;
}
