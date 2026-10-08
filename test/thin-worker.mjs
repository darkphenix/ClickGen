// Exécuté dans un worker_thread par guarded.mjs : un cas pathologique par nom, résultat renvoyé au parent.
// (Pas de suffixe .test.mjs : le lanceur de tests ne le prend pas pour un fichier de test.)

import { parentPort, workerData } from 'node:worker_threads';
import { analyzeImage, makeClicker } from '../src/pipeline.js';
import { DEFAULTS } from '../src/core/params.js';
import { fillPolygon, newImage, rect } from './helpers.mjs';

const ink = [20, 20, 20, 255];

/** Trait fin d'épaisseur `t` px entre deux points. */
function stroke(img, [x0, y0], [x1, y1], t) {
  const dx = x1 - x0, dy = y1 - y0, n = Math.hypot(dx, dy);
  const ox = (-dy / n) * (t / 2), oy = (dx / n) * (t / 2);
  fillPolygon(img, [[x0 + ox, y0 + oy], [x1 + ox, y1 + oy], [x1 - ox, y1 - oy], [x0 - ox, y0 - oy]], ink);
}

const cases = {
  line: () => { const i = newImage(600, 600, [0, 0, 0, 0]); fillPolygon(i, rect(100, 300, 400, 3), ink); return i; },
  cross: () => {
    const i = newImage(600, 600, [0, 0, 0, 0]);
    stroke(i, [100, 100], [500, 500], 4);
    stroke(i, [500, 100], [100, 500], 4);
    return i;
  },
  dust: () => {
    const i = newImage(600, 600, [0, 0, 0, 0]);
    for (let k = 0; k < 9; k++) fillPolygon(i, rect(60 + k * 55, 80 + (k % 3) * 160, 3, 3), ink);
    return i;
  },
};

const t0 = Date.now();
const done = (msg) => parentPort.postMessage({ ...msg, ms: Date.now() - t0 });
try {
  const p = { ...DEFAULTS };
  const a = analyzeImage(cases[workerData.name](), p);
  const r = await makeClicker(a, p);
  done({ ok: true, size: r.size });
} catch (e) {
  done({ ok: false, code: e.code ?? 'internal', message: String(e?.message ?? e) });
}
