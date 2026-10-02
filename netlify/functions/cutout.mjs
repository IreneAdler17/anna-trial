// Serves a stored cut-out (a piece with its background removed) to the phone: /cutout/<id>
import { cutoutFile } from '../../lib/layout.mjs';

export const config = { path: '/cutout/*' };

export default async (req) => {
  const id = new URL(req.url).pathname.split('/').pop().replace(/\.png$/, '');
  const f = await cutoutFile(id);
  if (!f) return new Response('not found', { status: 404 });
  return new Response(f.bytes, { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800, immutable' } });
};
