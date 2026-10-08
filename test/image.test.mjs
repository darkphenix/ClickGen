import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentImage } from '../src/image/segment.js';
import { simplifyLoop, signedArea, traceContours } from '../src/image/contours.js';
import { quantizeColors } from '../src/image/quantize.js';
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

test('couleurs : l\'ours a 3 couleurs et la médiane garde les teintes d\'origine', () => {
  const img = bearImage(400, true);
  const seg = segmentImage(img);
  const q = quantizeColors(img, seg.solid, 3);
  assert.equal(q.colors.length, 3);
  assert.equal(q.colors[0].hex, '#96623a'); // le brun, la plus grande surface
  assert.ok(q.colors.some((c) => c.hex === '#f0d6aa'), 'crème');
});
