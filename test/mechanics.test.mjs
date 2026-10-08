// Simulation d'interférences : on pose un switch MX simplifié (cotes du datasheet Cherry) dans la coque,
// on enfonce le capuchon de 0 à ~3,5 mm et on vérifie qu'aucune pièce ne se traverse, hormis la croix
// de la tige qui s'emboîte volontairement (jeu négatif de quelques centièmes de mm).

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage, makeClicker } from '../src/pipeline.js';
import { DEFAULTS, SWITCH, derive } from '../src/core/params.js';
import { Scope, getEngine } from '../src/geometry/engine.js';
import { bearImage } from './helpers.mjs';

const p = { ...DEFAULTS };
const result = await makeClicker(analyzeImage(bearImage(500, true), p), p);
const wasm = await getEngine();
const d = derive(p);

function manifoldOf(sc, mesh) {
  const m = new wasm.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices });
  return sc.add(new wasm.Manifold(m));
}

/** Switch MX simplifié, repère assemblé : pièce fixe (boîtier, bride, chapeau à fenêtre) + tige mobile. */
function buildSwitch(sc) {
  const { Manifold } = wasm;
  const T = (x) => sc.add(x);
  const { x, y, angle } = result.placement;
  const place = (m, z = 0, dz = 0) => T(T(T(m.rotate(0, 0, angle)).translate(x, y, d.seat + z + dz)));
  const box = (w, h, z0, z1) => T(T(Manifold.cube([w, h, z1 - z0], true)).translate(0, 0, (z0 + z1) / 2));
  const lower = box(13.8, 13.8, 0, SWITCH.seatToFlange);
  const flange = box(SWITCH.flange, SWITCH.flange, SWITCH.seatToFlange, SWITCH.seatToFlange + 1.0);
  const hatH = SWITCH.housingTop - (SWITCH.seatToFlange + 1.0);
  const hatRaw = T(Manifold.cylinder(hatH, 11.7 / Math.SQRT2, 6.4 / Math.SQRT2, 4));
  const hat = T(T(T(hatRaw.rotate(0, 0, 45)).translate(0, 0, SWITCH.seatToFlange + 1.0)));
  const window = T(T(Manifold.cylinder(hatH + 0.2, 3.1, 3.1, 48)).translate(0, 0, SWITCH.seatToFlange + 0.9));
  const hatWithWindow = T(hat.subtract(window));
  const fixed = place(T(Manifold.union([lower, flange, hatWithWindow])));
  const arm1 = box(4.0, 1.2, SWITCH.housingTop - 4.0, SWITCH.housingTop + SWITCH.stemAbove);
  const arm2 = box(1.2, 4.0, SWITCH.housingTop - 4.0, SWITCH.housingTop + SWITCH.stemAbove);
  const stem = place(T(Manifold.union([arm1, arm2])));
  return { fixed, stem };
}

const vol = (sc, a, b) => sc.add(a.intersect(b)).volume();

test('interférences : rien ne se traverse de 0 à 3,4 mm de course', () => {
  const sc = new Scope();
  try {
    const shell = manifoldOf(sc, result.meshes.shell.mesh);
    const capParts = [result.meshes.capBody.mesh, ...result.meshes.arts.map((a) => a.mesh)].map((m) => manifoldOf(sc, m));
    const cap = sc.add(wasm.Manifold.union(capParts));
    const { fixed, stem } = buildSwitch(sc);

    assert.ok(vol(sc, shell, fixed) < 0.5, `coque x switch : ${vol(sc, shell, fixed)} mm³`);
    for (const t of [0, 1, 2, 3, 3.4]) {
      const capT = sc.add(cap.translate(0, 0, -t));
      const stemT = sc.add(stem.translate(0, 0, -t));
      assert.ok(vol(sc, capT, shell) < 0.5, `capuchon x coque à ${t} mm : ${vol(sc, capT, shell)} mm³`);
      assert.ok(vol(sc, capT, fixed) < 0.5, `capuchon x boîtier à ${t} mm : ${vol(sc, capT, fixed)} mm³`);
      // la croix de la tige est un peu plus épaisse que son logement : serrage volontaire, mais borné
      const fit = vol(sc, capT, stemT);
      assert.ok(fit > 0.1 && fit < 8, `serrage de la croix à ${t} mm : ${fit} mm³`);
    }
  } finally {
    sc.dispose();
  }
});

test('la tige touche le plafond de la croix au repos (le capuchon est bien posé sur la tige)', () => {
  const stemTop = d.seat + SWITCH.housingTop + SWITCH.stemAbove;
  assert.ok(Math.abs(stemTop - (d.capRim + d.pocketDepth)) < 1e-9);
  assert.ok(d.capTopRest - SWITCH.travel < d.shellH, 'enfoncé, le capuchon affleure sous le haut de la coque');
  assert.ok(d.capRim - SWITCH.travel > d.cavityFloor, 'le bord du capuchon ne touche pas le plancher de la cavité');
});
