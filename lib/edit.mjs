// Builds one person's nightly edit: candidates → Claude shortlist → Claude looks at the photos → 12.
import * as store from './store.mjs';
import * as pool from './pool.mjs';
import { freshCandidates } from './sources.mjs';
import { buildProfile } from './profile.mjs';
import { hasClaude, shortlist, finalEdit, MIX } from './claude.mjs';
import { shuffle } from './util.mjs';

async function alreadyShown(userId) {
  const shown = new Set();
  for (const e of await store.listEdits(userId, { limit: 60 })) for (const it of e.items || []) shown.add(it.item_id);
  for (const ev of await store.listEvents(userId, { limit: 2000 })) if (ev.item_id) shown.add(ev.item_id);
  return shown;
}

// Without Claude (local testing), a simple spread so the whole flow still works.
function fallbackEdit(candidates) {
  const buckets = [];
  for (const [b, n] of Object.entries(MIX)) for (let i = 0; i < n; i++) buckets.push(b);
  return shuffle(candidates).slice(0, 12).map((c, i) => ({ id: c.id, bucket: buckets[i] || 'wildcard' }));
}

function interleave(picks) {
  // Keep Claude's order, but make sure the first card is a "you" piece: open strong.
  const firstYou = picks.findIndex((p) => p.bucket === 'you');
  if (firstYou > 0) picks.unshift(...picks.splice(firstYou, 1));
  return picks;
}

export async function buildEdit(user, date, { log = console.log } = {}) {
  let exclude = await alreadyShown(user.id);
  let pipe = await pool.fetchCandidates({ exclude });
  let fresh = await freshCandidates(exclude);
  if (pipe.length + fresh.length < 12) {
    // Small pool (testing): only rule out what earlier edits already showed.
    exclude = new Set((await store.listEdits(user.id, { limit: 60 })).flatMap((e) => (e.items || []).map((i) => i.item_id)));
    pipe = await pool.fetchCandidates({ exclude });
    fresh = await freshCandidates(exclude);
  }
  const candidates = shuffle([...pipe.slice(0, 320), ...fresh.slice(0, 120)]);
  if (candidates.length < 12) throw new Error(`Only ${candidates.length} candidates for ${user.id}`);
  const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));

  let picks;
  if (!hasClaude()) {
    picks = fallbackEdit(candidates);
  } else {
    const profile = await buildProfile(user);
    const short = await shortlist({ profileText: profile.text, candidates });
    log(`[edit] ${user.id}: shortlist ${short.length}`);
    picks = await finalEdit({ profileText: profile.text, picks: short, itemsById: byId });
    if (!picks) {
      log(`[edit] ${user.id}: photo pass unavailable, using shortlist order`);
      const need = { ...MIX }; picks = [];
      for (const p of short) if (need[p.bucket] > 0) { picks.push(p); need[p.bucket]--; }
      for (const p of short) if (picks.length < 12 && !picks.includes(p)) picks.push(p);
    }
    picks = interleave(picks.slice(0, 12));
  }

  await store.upsertItems(picks.map((p) => byId[p.id]));
  const edit = await store.saveEdit({ user_id: user.id, edit_date: date, items: picks.map((p) => ({ item_id: p.id, bucket: p.bucket })) });
  log(`[edit] ${user.id} ${date}: ${picks.length} pieces`);
  return edit;
}
