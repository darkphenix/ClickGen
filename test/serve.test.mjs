// Le serveur statique (tools/serve.mjs) est exposé derrière un proxy : on vérifie les types MIME (le WASM en
// a besoin), le cache, la compression et surtout ce qu'il refuse de servir. Chaque test lance un vrai processus.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const freePort = () => new Promise((ok, ko) => {
  const s = net.createServer();
  s.on('error', ko);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

async function start(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['tools/serve.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((ok, ko) => {
    child.stdout.once('data', ok);
    child.once('error', ko);
    child.once('exit', (code) => ko(new Error(`le serveur s'est arrêté (code ${code})`)));
  });
  return { port, stop: () => child.kill() };
}

/** Requête à chemin brut : le client http de Node n'enlève pas les « .. » (fetch, lui, les normaliserait). */
const get = (port, path, { method = 'GET', headers = {} } = {}) => new Promise((ok, ko) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', ko);
  req.end();
});

test('serveur (production) : types MIME, cache, ETag et gzip', async () => {
  const srv = await start({ NODE_ENV: 'production' });
  try {
    const page = await get(srv.port, '/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.equal(page.headers['cache-control'], 'no-cache', 'la page est revalidée à chaque visite');
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.ok(page.headers.etag);

    // le WASM doit porter son type MIME (instantiateStreaming), le JS celui des modules ES
    const wasmPath = '/vendor/manifold/manifold.wasm';
    const plain = await get(srv.port, wasmPath);
    assert.equal(plain.headers['content-type'], 'application/wasm');
    assert.equal(plain.headers['cache-control'], 'public, max-age=86400', 'les bibliothèques se mettent en cache');
    assert.equal(plain.headers['content-encoding'], undefined, 'pas de gzip sans Accept-Encoding');
    const zipped = await get(srv.port, wasmPath, { headers: { 'Accept-Encoding': 'gzip, deflate' } });
    assert.equal(zipped.headers['content-encoding'], 'gzip');
    assert.ok(zipped.body.length < plain.body.length * 0.8, `gzip : ${zipped.body.length} contre ${plain.body.length} octets`);
    assert.ok(gunzipSync(zipped.body).equals(readFileSync('vendor/manifold/manifold.wasm')), 'le contenu décompressé est intact');
    const mod = await get(srv.port, '/src/app.js');
    assert.match(mod.headers['content-type'], /^text\/javascript/);

    // revalidation : le navigateur renvoie l'ETag, le serveur répond 304 sans corps
    const again = await get(srv.port, '/', { headers: { 'If-None-Match': page.headers.etag } });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    const stale = await get(srv.port, '/', { headers: { 'If-None-Match': 'W/"0-0"' } });
    assert.equal(stale.status, 200);

    const head = await get(srv.port, '/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
  } finally {
    srv.stop();
  }
});

test('serveur : refuse les fichiers cachés, les chemins piégés, les répertoires et les méthodes d\'écriture', async () => {
  const srv = await start({ NODE_ENV: 'production' });
  try {
    const secret = readFileSync('package.json', 'utf8').slice(0, 40);
    for (const path of ['/.gitignore', '/.git/config', '/src/.hidden', '/src/%2ehidden', '/%00', '/%zz', '/src/', '/src', '/vendor/', '/nexiste.js']) {
      const r = await get(srv.port, path);
      assert.ok(r.status === 404 || r.status === 403, `${path} -> ${r.status}`);
      assert.ok(!r.body.toString().includes(secret), `${path} ne doit rien révéler`);
    }
    // les « .. » ne sortent jamais du dossier du site, qu'ils soient bruts ou encodés
    for (const path of ['/../../../../etc/passwd', '/..%2f..%2f..%2fetc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/src/..%5c..%5cpackage.json']) {
      const r = await get(srv.port, path);
      assert.ok(r.status === 404 || r.status === 403, `${path} -> ${r.status}`);
      assert.ok(!/root:|\[extensions\]|fonts/.test(r.body.toString()), `${path} ne doit rien révéler`);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await get(srv.port, '/', { method });
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.allow, 'GET, HEAD');
    }
  } finally {
    srv.stop();
  }
});

test('serveur (développement) : jamais de cache, pas de compression, mêmes protections', async () => {
  const srv = await start();
  try {
    const r = await get(srv.port, '/', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['content-encoding'], undefined);
    assert.equal(r.headers.etag, undefined);
    assert.equal((await get(srv.port, '/.git/config')).status, 404);
    assert.equal((await get(srv.port, '/', { method: 'POST' })).status, 405);
  } finally {
    srv.stop();
  }
});
