// Receives screenshots: from the double-tap Shortcut, and from "Add screenshots from Photos".
import * as store from '../../lib/store.mjs';
import { authUser, json, siteUrl } from '../../lib/util.mjs';

export const config = { path: '/capture' };

const MAX_BYTES = 5.5 * 1024 * 1024; // Netlify's request limit is ~6MB

async function userFromCode(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('c'); // Shortcut sends ?c=<id>.<key>
  if (code && code.includes('.')) {
    const [id, key] = code.trim().toLowerCase().split('.');
    const user = await store.getUser(id);
    if (user && user.key === key) return user;
    return null;
  }
  return authUser(req);
}

async function filesFrom(req) {
  const type = req.headers.get('content-type') || '';
  if (type.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const out = [];
    for (const [, v] of form.entries()) {
      if (typeof v === 'object' && v.arrayBuffer) out.push({ bytes: Buffer.from(await v.arrayBuffer()), type: v.type || 'image/jpeg' });
    }
    return out;
  }
  const bytes = Buffer.from(await req.arrayBuffer());
  return bytes.length ? [{ bytes, type: type.startsWith('image/') ? type.split(';')[0] : 'image/png' }] : [];
}

function kick(req) {
  // Start reading the screenshot straight away in the background; the 15-minute tick is the backstop.
  const url = `${siteUrl(req)}/.netlify/functions/process-captures-background`;
  return Promise.race([
    fetch(url, { method: 'POST', headers: { 'x-anna-admin': process.env.ADMIN_KEY || '' } }).catch(() => {}),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Anna is listening.', { status: 200 });
  const user = await userFromCode(req);
  const isShortcut = new URL(req.url).searchParams.has('c');
  if (!user) return isShortcut ? new Response('Anna doesn’t recognise this phone — check your code.', { status: 401 }) : json({ error: 'not allowed' }, 401);

  const files = (await filesFrom(req)).filter((f) => f.bytes.length > 1000 && f.bytes.length <= MAX_BYTES).slice(0, 10);
  if (!files.length) return isShortcut ? new Response('Nothing came through — try again.', { status: 400 }) : json({ error: 'no image' }, 400);

  try {
    for (const f of files) {
      const ext = f.type.includes('png') ? 'png' : f.type.includes('webp') ? 'webp' : 'jpg';
      const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await store.uploadCaptureFile(filePath, f.bytes, f.type);
      await store.addCapture({ user_id: user.id, via: isShortcut ? 'backtap' : 'photos', image_path: filePath });
    }
  } catch (err) {
    console.error('[capture]', user.id, err);
    return isShortcut
      ? new Response('Anna missed that one. Double-tap again.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      : json({ error: 'Anna missed those. Try again.' }, 500);
  }
  if (isShortcut && !user.shortcut_ok) await store.updateUser(user.id, { shortcut_ok: true });
  await kick(req);

  if (isShortcut) return new Response('Sent to your Anna ✓', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return json({ ok: true, added: files.length });
};
