import test from 'node:test';
import assert from 'node:assert/strict';
import { PipelineError, analyzeImage, makeClicker } from '../src/pipeline.js';
import { DEFAULTS, derive, switchCountOf } from '../src/core/params.js';
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

// --- plusieurs switches dans le même clicker ---------------------------------------------------------------

const disc = (r = 220) => shapeImage((i) => { fillPolygon(i, circle(250, 250, r), red); fillPolygon(i, circle(250, 250, r * 0.4), gold); });

/** Écart « L-infini » de deux switches dans le repère tourné de l'arrangement. */
const lInf = (a, b) => {
  const t = (a.angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.max(Math.abs(dx * c + dy * s), Math.abs(-dx * s + dy * c));
};

test('plusieurs switches : un logement et une croix à chaque position, maillages étanches', async () => {
  for (const n of [2, 3]) {
    const { r, p } = await run(disc(), { size: 70, switchCount: n });
    const d = derive(p);
    assert.equal(r.switchCount, n);
    assert.equal(r.placements.length, n);
    assert.deepEqual(r.placement, r.placements[0], 'le switch de référence reste exposé');
    assert.equal(new Set(r.placements.map((q) => q.angle)).size, 1, 'un seul angle pour tout le groupe');
    for (const m of [r.meshes.shell, r.meshes.capBody, ...r.meshes.arts]) assert.ok(checkMesh(m.mesh).watertight, `${n} switches : maillage non étanche`);
    for (const [i, q] of r.placements.entries()) {
      // coque : au centre de chaque logement, seul le fond plein de 1,2 mm ; capuchon : le plafond de la croix
      assert.deepEqual(solidIntervals(r.meshes.shell.mesh, q.x, q.y), [[0, 1.2]], `${n} switches, logement ${i}`);
      const iv = solidIntervals(r.meshes.capBody.mesh, q.x, q.y);
      assert.ok(near(iv[0][0], d.capRim + d.pocketDepth), `${n} switches, croix ${i} : plafond ${iv[0][0]}`);
      for (const o of r.placements.slice(i + 1)) {
        assert.ok(lInf(q, o) >= d.switchPitch - 1e-6, `écart ${lInf(q, o)} mm < ${d.switchPitch}`);
        // entre deux logements : la collerette pleine jusqu'au plancher de la cavité
        const mid = solidIntervals(r.meshes.shell.mesh, (q.x + o.x) / 2, (q.y + o.y) / 2);
        assert.deepEqual(mid, [[0, d.cavityFloor]], `entre deux switches : ${JSON.stringify(mid)}`);
      }
    }
  }
});

test('plusieurs switches : la forme grandit pour les loger, jamais en dessous du cas à un seul switch', async () => {
  const size = {};
  for (const n of [1, 2, 3]) {
    const { r } = await run(disc(), { size: 40, switchCount: n });
    size[n] = r.size;
    assert.equal(r.placements.length, n);
  }
  assert.ok(size[1] <= size[2] + 1e-6 && size[2] <= size[3] + 1e-6, JSON.stringify(size));
  assert.ok(size[3] > 50, `trois switches ne tiennent pas dans un disque de 40 mm (${size[3]})`);
});

test('plusieurs switches : trop serré sans agrandissement, le refus dit combien de switches', async () => {
  const img = disc();
  await assert.rejects(run(img, { size: 50, switchCount: 3, autoGrow: false }), (e) => e instanceof PipelineError && e.code === 'nofit' && e.switches === 3 && e.extra.switches === 3);
  await assert.rejects(run(img, { size: 30, switchCount: 1, autoGrow: false }), (e) => e.code === 'nofit' && e.switches === 1);
  // formes qui n'en logeront jamais trois à la taille maximale : refus, pas de boucle infinie
  const thin = shapeImage((i) => fillPolygon(i, [[40, 235], [460, 235], [460, 265], [40, 265]], dark));
  await assert.rejects(run(thin, { switchCount: 3 }), (e) => e instanceof PipelineError && ['nofit', 'vanished'].includes(e.code));
});

test('plusieurs switches : le groupe se déplace d\'un bloc, ou revient à l\'automatique', async () => {
  const base = { ...DEFAULTS, size: 100, switchCount: 2 };
  const a = analyzeImage(disc(), base);
  const auto = await makeClicker(a, base);
  const [a0, a1] = auto.placements;
  const moved = await makeClicker(a, { ...base, placementX: a0.x + 3, placementY: a0.y + 2, placementAngle: a0.angle });
  assert.ok(moved.manual, 'le groupe décalé tient dans le disque');
  assert.ok(near(moved.placements[0].x, a0.x + 3, 1e-6) && near(moved.placements[0].y, a0.y + 2, 1e-6));
  assert.ok(near(moved.placements[1].x - moved.placements[0].x, a1.x - a0.x, 1e-6), 'les écarts du groupe ne changent pas');
  assert.ok(near(moved.placements[1].y - moved.placements[0].y, a1.y - a0.y, 1e-6));
  for (const m of [moved.meshes.shell, moved.meshes.capBody]) assert.ok(checkMesh(m.mesh).watertight);
  const far = await makeClicker(a, { ...base, placementX: a0.x + 80, placementY: a0.y, placementAngle: a0.angle });
  assert.ok(!far.manual && far.warnings.some((w) => w.code === 'manualReset'));
  assert.deepEqual(far.placements, auto.placements, 'retour à l\'arrangement automatique');
});

test('plusieurs switches : l\'arrangement est mis en mémoire, et reste identique sans mémoire', async () => {
  const cache = {};
  const base = { ...DEFAULTS, size: 70, switchCount: 3 };
  const a = analyzeImage(disc(), base);
  const r1 = await makeClicker(a, base, { cache });
  assert.ok(cache.place instanceof Map && cache.place.size > 0, 'arrangements mémorisés');
  const known = cache.place.size;
  const r2 = await makeClicker(a, { ...base, socketFit: 0.1 }, { cache }); // même contour : rien à recalculer
  assert.equal(cache.place.size, known, 'pas de nouvelle recherche pour un réglage sans rapport avec la forme');
  assert.deepEqual(r2.placements, r1.placements);
  const fresh = await makeClicker(a, base); // sans mémoire du tout
  assert.deepEqual(fresh.placements, r1.placements, 'même résultat sans le mémo');
  assert.equal(r2.meshes.shell, r1.meshes.shell, 'coque réutilisée');
  // un autre nombre de switches ne réutilise pas la coque d'avant
  const r4 = await makeClicker(a, { ...base, switchCount: 2 }, { cache });
  assert.notEqual(r4.meshes.shell, r1.meshes.shell);
  assert.equal(r4.placements.length, 2);
});

test('nombre de switches : borné à 1..3, toute valeur douteuse retombe sur 1', () => {
  assert.equal(switchCountOf({ switchCount: 2 }), 2);
  assert.equal(switchCountOf({ switchCount: 3 }), 3);
  assert.equal(switchCountOf({ switchCount: 7 }), 3);
  assert.equal(switchCountOf({ switchCount: 0 }), 1);
  assert.equal(switchCountOf({ switchCount: -4 }), 1);
  assert.equal(switchCountOf({ switchCount: 2.4 }), 2);
  assert.equal(switchCountOf({ switchCount: '3' }), 3);
  for (const bad of [NaN, undefined, null, 'x', Infinity, -Infinity]) assert.equal(switchCountOf({ switchCount: bad }), 1, String(bad));
  assert.equal(switchCountOf({}), 1);
});
