// Everything Anna asks Claude: reading double-tap screenshots, and picking tonight's edit.

const MODEL = () => process.env.ANNA_MODEL || 'claude-sonnet-5';
let _client = null;
export function hasClaude() { return Boolean(process.env.ANTHROPIC_API_KEY); }
async function client() {
  if (!_client) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

function firstJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in reply');
  return JSON.parse(text.slice(start, end + 1));
}

async function ask(content, { system, maxTokens = 2000 } = {}) {
  const res = await (await client()).messages.create({
    model: MODEL(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
  });
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// ---------- screenshots ----------
const READ_SYSTEM = `You help build a personal taste profile. The user double-tapped the back of her phone
to send a screenshot of something she loves — usually a wishlist, a product page, an Instagram post or a Pinterest board.
Reply with JSON only.`;

export async function readScreenshot(bytes, mediaType = 'image/png') {
  const text = await ask([
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') } },
    { type: 'text', text: `List the distinct pieces clearly shown (clothes, shoes, bags, jewellery, homewares, objects, art) — at most 10.
If the screenshot is a single styled look, list the look's key pieces.
Ignore interface elements, ads for unrelated things and text-only content.

Return:
{"items":[{"brand":string|null,"name":string,"price":number|null,"currency":string|null,
"piece_type":string,"colour":string|null,"material":string|null,
"style":"one short line on the look — era, mood, silhouette, what makes it distinctive"}],
"overall":"one line on the taste this screenshot shows"}` },
  ], { system: READ_SYSTEM, maxTokens: 1500 });
  const out = firstJson(text);
  return { items: Array.isArray(out.items) ? out.items.slice(0, 10) : [], overall: out.overall || '' };
}

// ---------- tonight's edit ----------
const EDIT_SYSTEM = `You are Anna, a personal taste agent with an editor's eye (think a great fashion editor).
Each night you put together a short visual edit for one woman: not only things she will love, but what's new,
what's trending and the wider look around her taste. It is for pleasure, not shopping — no sales logic.
Reply with JSON only.`;

export const MIX = { you: 4, adjacent: 3, new: 2, wildcard: 3 }; // 12 pieces: 30% squarely her, 70% wider

// Round 1 (text only): shortlist ~26 from a few hundred candidates.
export async function shortlist({ profileText, candidates }) {
  const lines = candidates.map((c) =>
    `${c.id} | ${c.description || ''}${c.attrs?.recent ? ' | NEW IN' : ''}${c.kind === 'fresh' ? ` | ${c.attrs?.source_bucket || 'fresh source'}` : ''}`);
  const text = await ask([{ type: 'text', text: `HER TASTE SO FAR
${profileText}

CANDIDATES (id | details)
${lines.join('\n')}

Shortlist 26 candidates for tonight's edit, tagged by bucket:
- "you" (8): squarely her taste
- "adjacent" (6): one step from her taste — a neighbouring look she hasn't shown yet
- "new" (5): prefer NEW IN pieces; newness first, still within reach of her taste
- "wildcard" (7): deliberately outside her usual taste but beautiful and interesting — objects, homewares, art, an unexpected era or colour
Avoid near-duplicates (same brand + same piece type) and anything she has passed on that is similar.
Return {"picks":[{"id":string,"bucket":"you"|"adjacent"|"new"|"wildcard"}]}` }], { system: EDIT_SYSTEM, maxTokens: 3000 });
  const out = firstJson(text);
  const valid = new Set(candidates.map((c) => c.id));
  return (out.picks || []).filter((p) => valid.has(p.id));
}

async function fetchImage(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Anna trial)' } });
    clearTimeout(t);
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 3000 || buf.length > 3_500_000) return null;
    return { data: buf.toString('base64'), media_type: type };
  } catch { return null; }
}

// Round 2 (looks at the photos): drop weak images, choose the final 12 and their order.
export async function finalEdit({ profileText, picks, itemsById }) {
  const withImages = [];
  await Promise.all(picks.map(async (p) => {
    const it = itemsById[p.id];
    if (!it?.image_url) return;
    const img = await fetchImage(it.image_url);
    if (img) withImages.push({ ...p, img, it });
  }));
  if (withImages.length < 12) return null; // caller falls back to the text-only order

  const content = [];
  content.push({ type: 'text', text: `HER TASTE SO FAR\n${profileText}\n\nHere are the shortlisted pieces, each labelled with its id and bucket.` });
  for (const w of withImages) {
    content.push({ type: 'text', text: `id=${w.id} bucket=${w.bucket} — ${w.it.description || ''}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: w.img.media_type, data: w.img.data } });
  }
  content.push({ type: 'text', text: `Choose the final 12 for tonight: ${MIX.you} "you", ${MIX.adjacent} "adjacent", ${MIX.new} "new", ${MIX.wildcard} "wildcard".
The photograph matters most: this is looked at full-screen at night for pleasure. Reject flat, low-resolution, cluttered,
watermarked, collage, size-chart or badly cropped images, and anything that looks cheap in its photo.
Order them so the edit has rhythm: open strong, alternate categories and colours, never two of the same bucket in a row where avoidable.
Return {"edit":[{"id":string,"bucket":string}]} in display order.` });

  const text = await ask(content, { system: EDIT_SYSTEM, maxTokens: 1500 });
  const out = firstJson(text);
  const valid = new Set(withImages.map((w) => w.id));
  const edit = (out.edit || []).filter((e) => valid.has(e.id));
  return edit.length >= 8 ? edit.slice(0, 12) : null;
}
