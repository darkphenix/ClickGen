import test from 'node:test';
import assert from 'node:assert/strict';
import { PipelineError, analyzeImage, makeClicker } from '../src/pipeline.js';
import { DEFAULTS, derive } from '../src/core/params.js';
import { bearImage, checkMesh, circle, fillPolygon, heart, newImage, solidIntervals, star } from './helpers.mjs';
import { runGuarded } from './guarded.mjs';

const dark = [40, 40, 60, 255], red = [200, 40, 40, 255], gold = [240, 190, 40, 255];

function shapeImage(draw, bg = [0, 0, 0, 0]) {
  const img = newImage(500, 500, bg);
  draw(img);
  return img;
}

async function run(img, over = {}) {
  const p = { ...DEFAULTS, ...over };
  return { p, r: await makeClicker(analyzeImage(img, p), p) };
}

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

test('ours : maillages étanches, 3 couleurs, taille demandée respectée', async () => {
  const { r } = await run(bearImage(500, true));
  assert.equal(r.size, 60);
  const big = Math.max(r.outline.w, r.outline.h);
  assert.ok(big > 59.5 && big < 60.5, `plus grande dimension ${big}`);
  assert.deepEqual(r.used, [0, 1, 2]);
  for (const m of [r.meshes.shell, r.meshes.capBody, ...r.meshes.arts]) {
    const c = checkMesh(m.mesh);
    assert.ok(c.watertight, `maillage non étanche (${c.badEdges} arêtes)`);
    assert.ok(c.volume > 0);
  }
});

test('cotes mécaniques : logement 14 mm, collerette, cavité, croix, fourreau', async () => {
  const { r, p } = await run(bearImage(500, true), { artDepth: 0.8, relief: 0 });
  const d = derive(p);
  const { x, y } = r.placement;
  const shell = r.meshes.shell.mesh, cap = r.meshes.capBody.mesh;

  // coque : au centre, seul le fond plein de 1,2 mm (la cavité sous le switch est ouverte au-dessus)
  assert.deepEqual(solidIntervals(shell, x, y), [[0, 1.2]]);
  // sur le rebord de la cavité (entre Ø12,4 et le carré de 14) : plein jusqu'au plancher du switch
  assert.deepEqual(solidIntervals(shell, x + 6.6, y), [[0, d.seat]]);
  // dans la collerette, juste hors du carré de 14 mm : plein jusqu'au plancher de la cavité
  assert.deepEqual(solidIntervals(shell, x + 7.2, y), [[0, d.cavityFloor]]);
  // paroi extérieure : on balaie vers +x depuis le switch jusqu'à toucher la paroi (pleine hauteur)
  let wall = null;
  for (let dx = 10; dx < 45 && !wall; dx += 0.25) {
    const iv = solidIntervals(shell, x + dx, y);
    if (iv.length === 1 && near(iv[0][1], d.shellH)) wall = iv[0];
  }
  assert.ok(wall && near(wall[0], 0), `paroi introuvable : ${JSON.stringify(wall)}`);

  // capuchon (repère assemblé) : le plafond de la croix est à capRim + pocketDepth
  const ceil = d.capRim + d.pocketDepth;
  const iv = solidIntervals(cap, x, y);
  assert.ok(near(iv[0][0], ceil), `plafond de croix ${iv[0][0]} != ${ceil}`);
  // fourreau : plein dès capRim + 1,0 entre la croix et Ø5,9
  assert.ok(near(solidIntervals(cap, x + 2.4, y)[0][0], d.capRim + 1.0));
  // bord du capuchon, loin du switch : plein de capRim jusqu'au dessus
  const edge = solidIntervals(cap, x + 20, y);
  assert.ok(near(edge[0][0], d.capRim) && near(edge[0][1], d.capTopRest, 0.8), JSON.stringify(edge));
});

test('forme trop petite : agrandie automatiquement, sinon erreur « nofit »', async () => {
  const img = shapeImage((i) => fillPolygon(i, circle(250, 250, 200), gold));
  const grown = await run(img, { size: 25 });
  assert.ok(grown.r.grown && grown.r.size > 30);
  await assert.rejects(run(img, { size: 25, autoGrow: false }), (e) => e instanceof PipelineError && e.code === 'nofit');
});

test('pièce détachée écartée : la taille désigne la pièce conservée', async () => {
  const img = shapeImage((i) => { fillPolygon(i, circle(120, 250, 100), dark); fillPolygon(i, circle(400, 250, 40), red); });
  const { r } = await run(img);
  assert.ok(near(Math.max(r.outline.w, r.outline.h), 60, 0.6));
  assert.ok(r.warnings.some((w) => w.code === 'dropped'));
});

test('formes variées : étoile, cœur, anneau', async () => {
  const cases = {
    star: shapeImage((i) => { fillPolygon(i, star(250, 260, 230, 100), gold); fillPolygon(i, circle(250, 260, 40), dark); }),
    heart: shapeImage((i) => fillPolygon(i, heart(250, 250, 13), red)),
    ring: shapeImage((i) => { fillPolygon(i, circle(250, 250, 220), red); fillPolygon(i, circle(250, 250, 90), [255, 255, 255, 255]); }, [255, 255, 255, 255]),
  };
  for (const [name, img] of Object.entries(cases)) {
    const { r } = await run(img, { fillHoles: name !== 'ring' });
    for (const m of [r.meshes.shell, r.meshes.capBody, ...r.meshes.arts]) assert.ok(checkMesh(m.mesh).watertight, name);
  }
});

test('image sans forme : erreur « empty »', () => {
  assert.throws(() => analyzeImage(newImage(100, 100), DEFAULTS), (e) => e.code === 'empty');
});

test('formes plus fines que « Détail minimum » : refus rapide, jamais de boucle infinie', async () => {
  // régression : la silhouette vide avait des bornes infinies, l'échelle de départ tombait à 0 et la
  // recherche d'agrandissement ne finissait plus (le worker restait figé)
  for (const name of ['line', 'cross', 'dust']) {
    const r = await runGuarded(name, 20000);
    assert.ok(!r.hung, `${name} : le calcul ne s'arrête pas`);
    assert.ok(!r.ok && ['vanished', 'nofit', 'empty'].includes(r.code), `${name} : ${JSON.stringify(r)}`);
    assert.ok(r.ms < 10000, `${name} : ${r.ms} ms`);
  }
});

test('paramètres invalides : taille ou plateau absurdes sont refusés, angle imposé NaN ignoré', async () => {
  const a = analyzeImage(bearImage(500, true), DEFAULTS);
  for (const bad of [{ size: 0 }, { size: NaN }, { size: -5 }, { bed: NaN }, { bed: 0 }]) {
    await assert.rejects(makeClicker(a, { ...DEFAULTS, ...bad }), (e) => e instanceof PipelineError && e.code === 'geometry', JSON.stringify(bad));
  }
  const r = await makeClicker(a, { ...DEFAULTS, placementAngle: NaN });
  assert.ok(Number.isFinite(r.placement.angle), 'retour au placement automatique');
});

test('décor en relief : la couche dépasse du capuchon de la hauteur demandée', async () => {
  const { r, p } = await run(bearImage(500, true), { relief: 1.0 });
  const d = derive(p);
  const tops = r.meshes.arts.map((a) => {
    let top = -Infinity;
    for (let i = 2; i < a.mesh.positions.length; i += 3) top = Math.max(top, a.mesh.positions[i]);
    return top;
  });
  assert.ok(tops.some((z) => near(z, d.capTopRest + 1.0, 0.02)), JSON.stringify(tops));
});

test('cache : un réglage du capuchon ne reconstruit pas la coque, et inversement', async () => {
  const cache = {};
  const base = { ...DEFAULTS };
  const a = analyzeImage(bearImage(500, true), base);
  const r1 = await makeClicker(a, base, { cache });
  const r2 = await makeClicker(a, { ...base, socketFit: 0.1 }, { cache });
  assert.equal(r2.meshes.shell, r1.meshes.shell, 'coque réutilisée');
  assert.notEqual(r2.meshes.capBody, r1.meshes.capBody, 'capuchon reconstruit');
  const r3 = await makeClicker(a, { ...base, socketFit: 0.1, pocketFit: 0.1 }, { cache });
  assert.notEqual(r3.meshes.shell, r2.meshes.shell, 'coque reconstruite');
  assert.equal(r3.meshes.capBody, r2.meshes.capBody, 'capuchon réutilisé');
  // même résultat qu'un calcul sans cache
  const fresh = await makeClicker(a, { ...base, socketFit: 0.1, pocketFit: 0.1 });
  assert.equal(fresh.meshes.capBody.volume.toFixed(3), r3.meshes.capBody.volume.toFixed(3));
});

test('position manuelle du switch : acceptée si elle tient, sinon retour à l\'automatique', async () => {
  const base = { ...DEFAULTS };
  const a = analyzeImage(bearImage(500, true), base);
  const auto = await makeClicker(a, base);
  const manual = await makeClicker(a, { ...base, placementX: auto.placement.x, placementY: auto.placement.y - 5, placementAngle: 0 });
  assert.ok(manual.manual);
  assert.ok(near(manual.placement.y, auto.placement.y - 5, 1e-6));
  assert.ok(checkMesh(manual.meshes.shell.mesh).watertight && checkMesh(manual.meshes.capBody.mesh).watertight);
  const bad = await makeClicker(a, { ...base, placementX: 100, placementY: 100, placementAngle: 0 });
  assert.ok(!bad.manual);
  assert.ok(bad.warnings.some((w) => w.code === 'manualReset'));
  assert.ok(Math.hypot(bad.placement.x - auto.placement.x, bad.placement.y - auto.placement.y) < 3, 'retour à la position automatique');
});
