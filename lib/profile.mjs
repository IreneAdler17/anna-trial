// Turns everything she has done into a short text profile Claude reads when picking her edit.
import * as store from './store.mjs';

export async function buildProfile(user) {
  const events = await store.listEvents(user.id, { limit: 800 });
  const captures = await store.listCaptures(user.id, { limit: 60, status: 'done' });

  const loveIds = [], passIds = [];
  for (const e of events) {
    if (!e.item_id) continue;
    if (e.action === 'love' && !loveIds.includes(e.item_id)) loveIds.push(e.item_id);
    if (e.action === 'pass' && !passIds.includes(e.item_id)) passIds.push(e.item_id);
  }
  const mostYou = Array.isArray(user.most_you) ? user.most_you : [];
  const items = await store.getItems([...mostYou, ...loveIds.slice(0, 80), ...passIds.slice(0, 60)]);
  const line = (id) => items[id]?.description || null;

  const captureLines = [];
  for (const c of captures) {
    for (const it of c.items || []) {
      captureLines.push([it.brand, it.name, it.piece_type, it.colour, it.material, it.style].filter(Boolean).join(' · '));
    }
    if (captureLines.length > 80) break;
  }

  const sections = [];
  const mostYouLines = mostYou.map(line).filter(Boolean);
  if (mostYouLines.length) sections.push(`Her three "most me" picks (weight these most):\n- ${mostYouLines.join('\n- ')}`);
  if (captureLines.length) sections.push(`Things she saved from other apps (wishlists, Instagram, etc.):\n- ${captureLines.slice(0, 80).join('\n- ')}`);
  const loves = loveIds.slice(0, 80).map(line).filter(Boolean);
  if (loves.length) sections.push(`Swiped right (loved):\n- ${loves.join('\n- ')}`);
  const passes = passIds.slice(0, 60).map(line).filter(Boolean);
  if (passes.length) sections.push(`Swiped left (passed):\n- ${passes.join('\n- ')}`);
  if (!sections.length) sections.push('Nothing yet — make a wide, beautiful first edit.');

  return {
    text: sections.join('\n\n'),
    counts: { loves: loveIds.length, passes: passIds.length, captures: captureLines.length, mostYou: mostYou.length },
  };
}
