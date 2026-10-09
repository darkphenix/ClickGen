// Garde-fou du Runner (côté page) : on remplace Worker par un faux pour simuler un calcul figé,
// des signes de vie, des erreurs répétées. Les délais sont courts : les marges restent larges.

import test from 'node:test';
import assert from 'node:assert/strict';

const instances = [];
class FakeWorker {
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.sent = [];
    this.terminated = false;
    instances.push(this);
  }
  postMessage(msg) { this.sent.push(msg); }
  terminate() { this.terminated = true; }
  emit(data) { this.onmessage?.({ data }); }
  fail(message = 'boom') { this.onerror?.({ message, preventDefault() {} }); }
  last(type) { return [...this.sent].reverse().find((m) => m.type === type); }
}
globalThis.Worker = FakeWorker;
const { Runner } = await import('../src/runner.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const img = () => ({ width: 2, height: 1, data: new Uint8ClampedArray(8) });
const fresh = () => { instances.length = 0; return new Runner(); };

test('runner : une réponse du worker résout la demande', async () => {
  const r = fresh();
  const p = r.run({ size: 60 });
  const w = instances[0];
  w.emit({ type: 'result', id: w.last('run').id, result: 42 });
  assert.equal((await p).result, 42);
  assert.equal(r.waiting.size, 0);
  assert.equal(r.stallTimer, 0, 'plus de chronomètre quand plus rien n\'attend');
});

test('runner : un worker muet est tué, recréé avec l\'image, et la demande échoue en « timeout »', async () => {
  const r = fresh();
  r.stallMs = 80;
  const ready = r.setImage(img());
  instances[0].emit({ type: 'imageReady', id: instances[0].last('image').id });
  await ready;
  const p = r.run({});
  await assert.rejects(p, (e) => e.code === 'timeout');
  assert.equal(instances.length, 2, 'un nouveau worker');
  assert.ok(instances[0].terminated);
  assert.equal(instances[1].last('image')?.width, 2, 'l\'image est renvoyée au nouveau worker');
  // le nouveau worker répond normalement
  const p2 = r.run({});
  instances[1].emit({ type: 'result', id: instances[1].last('run').id, ok: true });
  assert.ok((await p2).ok);
});

test('runner : les signes de vie prolongent le délai', async () => {
  const r = fresh();
  r.stallMs = 150;
  const p = r.run({});
  const w = instances[0], id = w.last('run').id;
  for (let i = 0; i < 4; i++) { await sleep(80); w.emit({ type: 'progress', id, step: 'x' }); } // 320 ms > 150 ms
  w.emit({ type: 'result', id, done: true });
  assert.ok((await p).done, 'pas de timeout tant que le worker avance');
  assert.ok(!w.terminated);
});

test('runner : une nouvelle demande ne relance pas le chronomètre d\'un worker figé', async () => {
  const r = fresh();
  r.stallMs = 200;
  const t0 = Date.now();
  const first = r.run({}).catch((e) => e);
  await sleep(120);
  const second = r.run({}); // l'utilisateur bouge un curseur : la 1re est remplacée, le worker reste figé
  assert.equal((await first).superseded, true);
  await assert.rejects(second, (e) => e.code === 'timeout');
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 200 + 120, `échec ${elapsed} ms après la 1re demande (le délai ne doit pas repartir à la 2e)`);
});

test('runner : le résultat d\'une demande remplacée compte comme signe de vie', async () => {
  const r = fresh();
  r.stallMs = 200;
  const worker = instances[0];
  const old = r.run({}).catch((e) => e);
  const oldId = worker.last('run').id;
  const cur = r.run({});
  assert.equal((await old).superseded, true);
  await sleep(150);
  worker.emit({ type: 'result', id: oldId }); // fin du vieux calcul : le worker est vivant
  await sleep(150); // 300 ms depuis la demande, mais seulement 150 ms depuis le dernier signe de vie
  assert.ok(!worker.terminated, 'pas de redémarrage à tort');
  worker.emit({ type: 'result', id: worker.last('run').id, fin: true });
  assert.ok((await cur).fin);
});

test('runner : un worker qui échoue en boucle n\'est pas recréé indéfiniment', async () => {
  const r = fresh();
  const failures = [];
  for (let i = 0; i < 6; i++) {
    const p = r.run({}).catch((e) => e);
    const w = instances.at(-1);
    w.fail(`échec ${i}`);
    failures.push(await p);
  }
  assert.ok(r.broken, 'abandon après quelques échecs');
  assert.ok(instances.length <= 4, `${instances.length} workers créés au maximum 1 + 3`);
  assert.match(failures.at(-1).message, /échec/);
  // plus aucun appel ne part vers un worker
  const sentBefore = instances.at(-1).sent.length;
  await assert.rejects(r.run({}), (e) => e === r.broken);
  assert.equal(instances.at(-1).sent.length, sentBefore);
});

test('runner : « forcer » est transmis au worker, et seulement quand on le demande', async () => {
  const r = fresh();
  const w = instances[0];
  const normal = r.run({ size: 60 });
  assert.equal(w.last('run').force, false, 'par défaut : on réutilise les caches');
  w.emit({ type: 'result', id: w.last('run').id, ok: 1 });
  await normal;
  const forced = r.run({ size: 60 }, { force: true });
  assert.equal(w.last('run').force, true, 'régénérer : le worker doit vider ses caches');
  w.emit({ type: 'result', id: w.last('run').id, ok: 2 });
  assert.equal((await forced).ok, 2);
});

test('runner : une erreur du worker devient une Error avec code et détails', async () => {
  const r = fresh();
  const p = r.run({});
  const w = instances[0];
  w.emit({ type: 'error', id: w.last('run').id, code: 'vanished', message: 'trop fin', extra: { minDetail: 1.2 }, stack: 's' });
  await assert.rejects(p, (e) => e.code === 'vanished' && e.extra.minDetail === 1.2 && e.message === 'trop fin');
});
