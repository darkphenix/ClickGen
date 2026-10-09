import test from 'node:test';
import assert from 'node:assert/strict';
import { centroid, findPlacement, findPlacements, scoreArrangement } from '../src/geometry/placement.js';
import { circle, rect, star } from './helpers.mjs';

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

// --- plusieurs switches dans un même capuchon --------------------------------------------------------------
const KEEP = 17.2; // carré de sécurité d'un switch (derive().capKeepOut)
const PITCH = 16.0; // écart minimal entre deux switches selon les axes des carrés (derive().switchPitch)

/** Écart « L-infini » de deux switches mesuré dans le repère tourné de l'arrangement. */
const lInf = (a, b) => {
  const t = (a.angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.max(Math.abs(dx * c + dy * s), Math.abs(-dx * s + dy * c));
};
const minPitch = (list) => Math.min(...list.flatMap((a, i) => list.slice(i + 1).map((b) => lInf(a, b))));
/** Le carré de sécurité de chaque switch tient-il dans le disque de rayon r centré à l'origine ? */
const squaresInDisc = (list, r) => list.every((q) => {
  const t = (q.angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), h = KEEP / 2;
  return [[-h, -h], [h, -h], [h, h], [-h, h]].every(([u, v]) => Math.hypot(q.x + u * c - v * s, q.y + u * s + v * c) <= r * 0.9995);
});

test('placements : un seul switch, c\'est findPlacement', () => {
  const r = findPlacements([circle(0, 0, 20, 128)], KEEP, 1);
  assert.equal(r.placements.length, 1);
  assert.ok(Math.hypot(r.placements[0].x, r.placements[0].y) < 1.5);
});

test('placements : deux switches dans un disque, même angle, écart respecté, carrés dans le disque', () => {
  const r = findPlacements([circle(0, 0, 27.4, 128)], KEEP, 2, { pitch: PITCH });
  assert.ok(r, 'un disque de 55 mm loge deux switches');
  const [a, b] = r.placements;
  assert.equal(a.angle, b.angle);
  assert.ok(minPitch(r.placements) >= PITCH - 0.05, `écart ${minPitch(r.placements)}`);
  assert.ok(squaresInDisc(r.placements, 27.4), 'chaque carré de sécurité reste dans le disque');
  // par défaut le score écarte les switches : bien plus que le strict nécessaire
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 24);
});

test('placements : trois switches dans un disque forment un vrai triangle', () => {
  const r = findPlacements([circle(0, 0, 27.4, 128)], KEEP, 3, { pitch: PITCH });
  assert.ok(r, 'un disque de 55 mm loge trois switches');
  const [p, q, s] = r.placements;
  assert.ok(new Set(r.placements.map((x) => x.angle)).size === 1, 'un seul angle pour tous');
  assert.ok(minPitch(r.placements) >= PITCH - 0.05);
  assert.ok(squaresInDisc(r.placements, 27.4));
  const area = Math.abs((q.x - p.x) * (s.y - p.y) - (s.x - p.x) * (q.y - p.y)) / 2;
  assert.ok(area > 150, `aire du triangle ${area} mm² : trois points alignés ne stabilisent rien`);
});

test('placements : le premier est le switch le plus proche du centre de gravité', () => {
  const r = findPlacements([circle(0, 0, 33, 128)], KEEP, 3, { pitch: PITCH });
  const d = r.placements.map((q) => Math.hypot(q.x, q.y));
  assert.deepEqual(d, [...d].sort((x, y) => x - y));
});

test('placements : une forme trop petite pour n switches est refusée', () => {
  assert.equal(findPlacements([circle(0, 0, 14, 128)], KEEP, 2, { pitch: PITCH }), null);
  assert.equal(findPlacements([circle(0, 0, 22, 128)], KEEP, 3, { pitch: PITCH }), null);
  // une étoile maigre loge un switch au centre mais pas trois
  assert.ok(findPlacement([star(0, 0, 40, 18)], KEEP));
  assert.equal(findPlacements([star(0, 0, 40, 18)], KEEP, 3, { pitch: PITCH }), null);
  assert.equal(findPlacements([], KEEP, 2), null);
});

test('placements : l\'angle imposé est respecté par tout le groupe', () => {
  const r = findPlacements([circle(0, 0, 33, 128)], KEEP, 2, { pitch: PITCH, angles: [30] });
  assert.ok(r.placements.every((q) => q.angle === 30));
  assert.ok(minPitch(r.placements) >= PITCH - 0.05);
});

test('placements : le mode rapide dit seulement si ça tient (et jamais « oui » à tort)', () => {
  const disc = [circle(0, 0, 27.4, 128)];
  const yes = findPlacements(disc, KEEP, 3, { pitch: PITCH, fast: true });
  assert.ok(yes && yes.placements.length === 3 && minPitch(yes.placements) >= PITCH - 0.05);
  assert.ok(squaresInDisc(yes.placements, 27.4));
  assert.equal(findPlacements([circle(0, 0, 22, 128)], KEEP, 3, { pitch: PITCH, fast: true }), null);
});

test('placements : le score est remplaçable (ici : tout à gauche)', () => {
  const big = [circle(0, 0, 47.4, 160)];
  const left = findPlacements(big, KEEP, 2, { pitch: PITCH, score: (a) => -a.points.reduce((s, p) => s + p.x, 0) });
  const mx = left.placements.reduce((s, q) => s + q.x, 0) / 2;
  assert.ok(mx < -10, `abscisse moyenne ${mx} : le groupe devait se coller à gauche`);
  // et le score par défaut préfère un groupe équilibré autour du centre de gravité
  const dflt = findPlacements(big, KEEP, 2, { pitch: PITCH });
  assert.ok(Math.abs(dflt.placements.reduce((s, q) => s + q.x, 0) / 2) < 6);
  assert.ok(Number.isFinite(scoreArrangement({ points: dflt.placements, angle: 0, centroid: [0, 0], size: 95, keepOut: KEEP, pitch: PITCH })));
});
