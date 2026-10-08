import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_NAMES, convexHull, fitInside, frameOutline, signedArea } from '../src/geometry/frames.js';
import { analyzeImage, makeClicker } from '../src/pipeline.js';
import { buildCoupon, couponToMesh } from '../src/geometry/coupon.js';
import { DEFAULTS } from '../src/core/params.js';
import { Scope, getEngine } from '../src/geometry/engine.js';
import { bearImage, checkMesh, newImage, fillPolygon, circle, solidIntervals } from './helpers.mjs';

test('cadres : polygones convexes, anti-horaires, plus grande dimension = 1', () => {
  for (const name of FRAME_NAMES) {
    const poly = frameOutline(name);
    assert.ok(signedArea(poly) > 0.3, `${name} : aire ${signedArea(poly)}`);
    const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    assert.ok(Math.abs(Math.max(w, h) - 1) < 1e-9, `${name} : ${w} x ${h}`);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
      assert.ok((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > -1e-9, `${name} non convexe en ${i}`);
    }
  }
});

test('cadre + sujet détouré : le fond devient la couleur 0 du capuchon', async () => {
  const p = { ...DEFAULTS, frame: 'circle' };
  const a = analyzeImage(bearImage(500, true), p);
  assert.ok(a.frame.subject);
  assert.equal(a.quant.colors[0].hex, '#ffffff');
  assert.ok(a.quant.colors.length >= 3, 'fond + au moins deux couleurs du sujet');
  const r = await makeClicker(a, p);
  assert.ok(r.framed);
  assert.ok(Math.abs(r.outline.w - 60) < 0.3 && Math.abs(r.outline.h - 60) < 0.3, `${r.outline.w} x ${r.outline.h}`);
  assert.ok(Math.hypot(r.placement.x, r.placement.y) < 2, 'le switch est au centre du cercle');
  for (const m of [r.meshes.shell, r.meshes.capBody, ...r.meshes.arts]) assert.ok(checkMesh(m.mesh).watertight);
  assert.ok(r.meshes.arts.length >= 2);
});

test('cadre + image entière (photo opaque) : la couleur dominante sert de fond', async () => {
  const img = newImage(400, 300, [30, 90, 200, 255]);
  fillPolygon(img, circle(200, 150, 70), [250, 200, 40, 255]);
  const p = { ...DEFAULTS, frame: 'hexagon', frameContent: 'full', colorCount: 2 };
  const a = analyzeImage(img, p);
  assert.ok(!a.frame.subject);
  assert.equal(a.quant.colors[0].hex, '#1e5ac8');
  const r = await makeClicker(a, p);
  assert.ok(r.meshes.arts.length === 1);
  assert.ok(checkMesh(r.meshes.capBody.mesh).watertight);
});

test('cadre : un cadre trop petit est agrandi pour loger le switch', async () => {
  const p = { ...DEFAULTS, frame: 'pill', size: 30 };
  const r = await makeClicker(analyzeImage(bearImage(400, true), p), p);
  assert.ok(r.grown && r.size > 30 && r.size < 60, `taille finale ${r.size}`);
});

test('banc d\'essai : 4 logements et 4 croix de tailles croissantes, maillage étanche', async () => {
  const wasm = await getEngine();
  const sc = new Scope();
  try {
    const res = buildCoupon(wasm, sc, { ...DEFAULTS });
    const mesh = couponToMesh(res);
    assert.ok(checkMesh(mesh).watertight);
    assert.deepEqual(res.info.pockets.map((v) => +v.toFixed(2)), [13.9, 14.0, 14.1, 14.2]);
    const yA = 19 / 2 + 6;
    res.info.pockets.forEach((side, i) => {
      const x = (i - 1.5) * 19;
      assert.deepEqual(solidIntervals(mesh, x, yA), [], `logement ${i} ouvert au centre`);
      assert.deepEqual(solidIntervals(mesh, x + side / 2 + 0.1, yA), [[0, 4]], `paroi du logement ${i}`);
      assert.deepEqual(solidIntervals(mesh, x + side / 2 - 0.1, yA), [], `dans le logement ${i}`);
    });
    const yB = -(15 / 2 + 6);
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 15;
      assert.deepEqual(solidIntervals(mesh, x, yB), [[0, 1.35]], `fond de la croix ${i}`);
      assert.deepEqual(solidIntervals(mesh, x + 0.9, yB + 2.6), [[0, 5.2]], `paroi du fourreau ${i}`);
    }
  } finally {
    sc.dispose();
  }
});

test('enveloppe convexe et ajustement dans un cadre', () => {
  const pts = [[0, 0], [4, 0], [4, 4], [0, 4], [2, 2], [1, 3], [3, 1]];
  const hull = convexHull(pts);
  assert.equal(hull.length, 4);
  assert.ok(Math.abs(signedArea(hull) - 16) < 1e-9);
  // un carré de demi-côté 10 dans un cercle de rayon 30 (marge 3) : la diagonale 14,14 * s doit tenir dans 27
  const circle30 = frameOutline('circle').map(([x, y]) => [x * 60, y * 60]);
  const s = fitInside(circle30, [[-10, -10], [10, -10], [10, 10], [-10, 10]], 3);
  assert.ok(Math.abs(s * 14.1421 - 27) < 0.1, `s = ${s}`);
  assert.equal(fitInside(circle30, [], 3), Infinity);
});
