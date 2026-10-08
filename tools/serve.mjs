// Petit serveur statique : `npm run serve` puis http://localhost:5173 (développement).
// Le site doit être servi en HTTP : les modules ES, le worker et le WASM ne marchent pas en file://.
//
// En production (NODE_ENV=production, derrière un proxy) : HOST et PORT viennent de l'environnement, les
// réponses portent un ETag (revalidation à 304) et sont compressées en gzip une seule fois par version.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT) || 5173;
const host = process.env.HOST || '127.0.0.1';
const prod = process.env.NODE_ENV === 'production';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const compressible = new Set(['.html', '.js', '.mjs', '.css', '.json', '.wasm', '.svg', '.txt']);
const longLived = /^\/(vendor|assets)\//; // bibliothèques et polices : presque jamais modifiées
const gzipped = new Map(); // fichier -> { etag, buf }

createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    if (rel.split('/').some((part) => part.startsWith('.'))) throw new Error('fichier caché'); // .git, .env…
    const file = resolve(join(root, normalize(rel)));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('forbidden'); return; }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');

    const ext = extname(file);
    const headers = { 'Content-Type': types[ext] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
    if (!prod) {
      res.writeHead(200, { ...headers, 'Cache-Control': 'no-store' }).end(await readFile(file));
      return;
    }
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    Object.assign(headers, { ETag: etag, Vary: 'Accept-Encoding', 'Cache-Control': longLived.test(rel) ? 'public, max-age=86400' : 'no-cache' });
    if ((req.headers['if-none-match'] ?? '').split(',').some((tag) => tag.trim() === etag)) { res.writeHead(304, headers).end(); return; }
    let body = await readFile(file);
    if (compressible.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      let entry = gzipped.get(file);
      if (entry?.etag !== etag) gzipped.set(file, entry = { etag, buf: gzipSync(body, { level: 9 }) });
      body = entry.buf;
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, { ...headers, 'Content-Length': body.length }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}).listen(port, host, () => console.log(`ClickGen : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
