// Reading double-tap screenshots into her profile.
import * as store from './store.mjs';
import { hasClaude, readScreenshot } from './claude.mjs';

export async function processCapture(cap, { log = console.log } = {}) {
  try {
    const file = await store.downloadCaptureFile(cap.image_path);
    if (!file) throw new Error('screenshot file missing');
    let result = { items: [], overall: '' };
    if (hasClaude()) result = await readScreenshot(file.bytes, file.contentType || 'image/png');

    const items = result.items.map((it, n) => ({
      id: `cap:${cap.id}:${n}`,
      kind: 'capture',
      source: 'her screenshot',
      brand: it.brand || null,
      name: it.name || it.piece_type || 'piece',
      price: typeof it.price === 'number' ? it.price : null,
      currency: it.currency || 'AUD',
      attrs: { piece_type: it.piece_type || null, colour: it.colour || null, material: it.material || null },
      description: [it.brand, it.name, it.piece_type, it.colour, it.material, it.style].filter(Boolean).join(' · '),
    }));
    await store.upsertItems(items);
    await store.addEvents(items.map((i) => ({ user_id: cap.user_id, item_id: i.id, action: 'capture', context: cap.via })));
    await store.updateCapture(cap.id, { status: 'done', items: result.items });
    log(`[capture] ${cap.user_id} ${cap.id}: ${items.length} pieces`);
    return items.length;
  } catch (err) {
    await store.updateCapture(cap.id, { status: 'failed', error: String(err.message || err).slice(0, 300) });
    log(`[capture] ${cap.id} failed: ${err.message}`);
    return 0;
  }
}

export async function processPending({ limit = 20, log } = {}) {
  const pending = await store.listCaptures(null, { status: 'pending', limit });
  let n = 0;
  for (const cap of pending.reverse()) n += await processCapture(cap, { log });
  return { captures: pending.length, pieces: n };
}
