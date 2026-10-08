import test from 'node:test';
import assert from 'node:assert/strict';
import { centroid, findPlacement } from '../src/geometry/placement.js';
import { circle, rect } from './helpers.mjs';

test('placement : au centre d\'un disque assez grand', () => {
  const p = findPlacement([circle(0, 0, 20, 128)], 17.2);
  assert.ok(p);
  assert.ok(Math.hypot(p.x, p.y) < 1.5);
});

test('placement : une bande trop étroite est refusée', () => {
  assert.equal(findPlacement([rect(-40, -6, 80, 12)], 17.2), null);
});

test('placement : une forme en haltère met le switch dans un des disques', () => {
  const bone = [circle(-30, 0, 14, 96), circle(30, 0, 14, 96)];
  // deux disques séparés : le switch doit être dans l'un des deux, jamais entre
  const p = findPlacement(bone, 17.2);
  assert.ok(p);
  assert.ok(Math.abs(Math.abs(p.x) - 30) < 6);
});

test('placement : l\'angle imposé est respecté', () => {
  const p = findPlacement([circle(0, 0, 22, 128)], 17.2, { angles: [30] });
  assert.equal(p.angle, 30);
});

test('placement : centre de gravité d\'un rectangle décentré', () => {
  const [cx, cy] = centroid([rect(10, 20, 30, 10)]);
  assert.ok(Math.abs(cx - 25) < 1e-9 && Math.abs(cy - 25) < 1e-9);
});
