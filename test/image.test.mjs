import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentImage } from '../src/image/segment.js';
import { simplifyLoop, signedArea, traceContours } from '../src/image/contours.js';
import { quantizeColors } from '../src/image/quantize.js';
import { svgSize } from '../src/imageio.js';
import { bearImage, circle, fillPolygon, newImage } from './helpers.mjs';

const area = (loops) => loops.reduce((a, l) => a + signedArea(l), 0);

test('contours : un disque flou redonne son aire à 1 % près', () => {
  const w = 200, h = 200, f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = Math.max(0, Math.min(1, 0.5 + (60 - Math.hypot(x - 100, y - 100))));
  const loops = traceContours(f, w, h, 0.5);
  assert.equal(loops.length, 1);
  assert.ok(Math.abs(Math.abs(area(loops)) / (Math.PI * 60 * 60) - 1) < 0.01);
});

test('contours : un anneau donne deux boucles, la simplification garde l\'aire', () => {
  const w = 200, h = 200, f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.hypot(x - 100, y - 100);
    f[y * w + x] = r < 70 && r > 30 ? 1 : 0;
  }
  const loops = traceContours(f, w, h, 0.5);
  assert.equal(loops.length, 2);
  const simple = loops.map((l) => simplifyLoop(l, 0.4));
  assert.ok(simple[0].length < loops[0].length);
  assert.ok(Math.abs(Math.abs(signedArea(simple[0])) / Math.abs(signedArea(loops[0])) - 1) < 0.02);
});

test('segmentation : fond transparent et fond blanc donnent la même forme', () => {
  const a = segmentImage(bearImage(400, true));
  const b = segmentImage(bearImage(400, false));
  assert.equal(a.mode, 'alpha');
  assert.equal(b.mode, 'color');
  for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(a.bounds[k] - b.bounds[k]) <= 2, k);
});

test('segmentation : les trous intérieurs sont bouchés, sauf si on le demande', () => {
  const img = newImage(300, 300);
  fillPolygon(img, circle(150, 150, 120), [200, 40, 40, 255]);
  fillPolygon(img, circle(150, 150, 50), [255, 255, 255, 255]);
  const filled = traceContours(segmentImage(img, { fillHoles: true }).field, 300, 300);
  const holed = traceContours(segmentImage(img, { fillHoles: false }).field, 300, 300);
  assert.equal(filled.length, 1);
  assert.equal(holed.length, 2);
});

test('segmentation : image unie sans forme -> aucune boîte', () => {
  assert.equal(segmentImage(newImage(80, 80)).bounds, null);
});

test('couleurs : un trou transparent bouché ne devient ni noir ni blanc, il prend la couleur de base', () => {
  // anneau orange (bords nets) dont le trou est transparent, RGBA brut 0,0,0,0
  const W = 300;
  const img = newImage(W, W, [0, 0, 0, 0]);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - 150, y - 150);
      if (r < 130 && r >= 50) img.data.set([230, 120, 30, 255], (y * W + x) * 4);
    }
  }
  const seg = segmentImage(img, { fillHoles: true });
  assert.equal(traceContours(seg.field, W, W).length, 1, 'le trou est bouché');
  for (const k of [1, 2, 3]) {
    const q = quantizeColors(img, seg.solid, k);
    assert.equal(q.colors.length, 1, `k=${k} : une seule couleur d'image (${q.colors.map((c) => c.hex)})`);
    assert.equal(q.colors[0].hex, '#e6781e');
    assert.equal(q.labels[150 * W + 150], q.outside, 'le centre du trou n\'a pas de couleur propre');
  }
});

test('SVG : dimensions lues sur la balise racine, jamais NaN ni nulles', () => {
  assert.deepEqual(svgSize('<svg xmlns="x" viewBox="0 0 24 32"><path/></svg>'), [24, 32]);
  assert.deepEqual(svgSize('<svg viewBox="10, 20, 100, 50">'), [100, 50], 'virgules et espaces');
  // un viewBox ailleurs que sur la racine (commentaire, <symbol>) ne compte pas
  assert.deepEqual(svgSize('<!-- viewBox="0 0 1 1" --><svg width="64" height="48"><symbol viewBox="0 0 9 9"/></svg>'), [64, 48]);
  // pas de viewBox : width/height (et pas stroke-width)
  assert.deepEqual(svgSize('<svg stroke-width="9" width="30px" height="20px">'), [30, 20]);
  // valeurs inutilisables -> repli sur 512 x 512
  for (const bad of ['<svg viewBox="0 0 0 0">', '<svg viewBox="a b c d">', '<svg viewBox="0 0 -5 10">', '<svg>', 'pas du svg']) {
    assert.deepEqual(svgSize(bad), [512, 512], bad);
  }
});

test('couleurs : l\'ours a 3 couleurs et la médiane garde les teintes d\'origine', () => {
  const img = bearImage(400, true);
  const seg = segmentImage(img);
  const q = quantizeColors(img, seg.solid, 3);
  assert.equal(q.colors.length, 3);
  assert.equal(q.colors[0].hex, '#96623a'); // le brun, la plus grande surface
  assert.ok(q.colors.some((c) => c.hex === '#f0d6aa'), 'crème');
});
