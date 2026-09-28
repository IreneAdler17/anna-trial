// Background: reads any waiting screenshots (up to 15 minutes allowed).
import { processPending } from '../../lib/captures.mjs';
import { isAdmin } from '../../lib/util.mjs';

export default async (req) => {
  if (!isAdmin(req.headers.get('x-anna-admin'))) { console.log('[process-captures] refused: no admin header'); return; }
  console.log('[process-captures] start');
  const result = await processPending({ limit: 25 });
  console.log('[process-captures]', result);
};
