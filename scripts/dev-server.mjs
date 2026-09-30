// Local testing without Netlify or Supabase: ANNA_MOCK=1 node scripts/dev-server.mjs
// Serves public/, routes /api/* and /capture to the real function code, uses a JSON file as the database.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

process.env.ANNA_MOCK = process.env.ANNA_MOCK || '1';
const root = process.cwd();
const PORT = Number(process.env.PORT || 8888);

const api = (await import(path.join(root, 'netlify/functions/api.mjs'))).default;
const capture = (await import(path.join(root, 'netlify/functions/capture.mjs'))).default;
const cutout = (await import(path.join(root, 'netlify/functions/cutout.mjs'))).default;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

function serveFile(res, file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
  return true;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/') || url.pathname === '/capture' || url.pathname.startsWith('/cutout/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : body, duplex: 'half' });
      const fn = url.pathname === '/capture' ? capture : url.pathname.startsWith('/cutout/') ? cutout : api;
      const out = await fn(request);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    if (url.pathname.startsWith('/dev-img/')) { if (serveFile(res, path.join(root, 'dev-fixtures', path.basename(url.pathname)))) return; }
    if (serveFile(res, path.join(root, 'public', url.pathname))) return;
    serveFile(res, path.join(root, 'public', 'index.html'));
  } catch (err) {
    console.error(err);
    res.writeHead(500); res.end(String(err));
  }
}).listen(PORT, () => console.log(`Anna dev server on http://localhost:${PORT}`));
