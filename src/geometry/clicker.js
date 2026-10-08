// Construction 3D de la coque et du capuchon (manifold-3d).
//
// Repère « assemblé » : fond de la coque à z = 0, switch posé sur son plancher (z = seat),
// capuchon au repos (son bord est à z = capRim, sa face décor est au-dessus).
// Tout est une pile de prismes 2D (CrossSection) combinés en 3D : aucune CSG fragile sur des
// surfaces gauches, donc des maillages toujours étanches.
//
// La coque et le capuchon se construisent séparément (buildShell, buildCap) : le pipeline met chacun en
// cache et ne reconstruit que celui dont les entrées ont changé.

import { MECH, PIN_HOLES, SWITCH, derive } from '../core/params.js';
import { SEG } from './outline.js';
import { toMesh } from './engine.js';

/** Place des formes 2D dans le repère du switch (centre, rotation). */
function switchFrame(wasm, T, placement) {
  const { CrossSection } = wasm;
  const { x, y, angle } = placement;
  const onSwitch = (cs) => T(T(cs.rotate(angle)).translate(x, y));
  const square = (side) => onSwitch(T(CrossSection.square([side, side], true)));
  return { onSwitch, square };
}

/**
 * Coque : fond plein, cavité sous le switch, logement carré, cavité du capuchon, anneau éventuel.
 * @param {{Manifold:any,CrossSection:any}} wasm
 * @param {{add:(o:any)=>any}} scope
 * @param {any} S silhouette de la coque (CrossSection du scope)
 * @param {any} cap contour du capuchon, composante qui porte le switch (CrossSection du scope)
 * @param {{x:number,y:number,angle:number}} placement
 * @param {import('../core/params.js').DEFAULTS} p
 */
export function buildShell(wasm, scope, S, cap, placement, p) {
  const { Manifold, CrossSection } = wasm;
  const T = (x) => scope.add(x);
  const d = derive(p);
  const { x: px, y: py } = placement;
  const { onSwitch, square } = switchFrame(wasm, T, placement);

  const cavity = T(cap.offset(p.clearance, 'Round', 2, SEG));
  const pocket = square(d.pocket);
  const stray = T(pocket.subtract(cavity)).area();
  if (stray > 0.05) throw new Error(`Le logement du switch déborde de la cavité (${stray.toFixed(2)} mm²)`);

  let pinCut;
  if (p.pinStyle === 'holes') {
    const holes = PIN_HOLES.map((h) => T(T(CrossSection.circle(h.d / 2, 32)).translate(h.x, h.y)));
    pinCut = onSwitch(T(CrossSection.compose(holes)));
  } else {
    pinCut = T(T(CrossSection.circle(MECH.voidSize / 2, 64)).translate(px, py));
  }

  const skin = MECH.floorSkin;
  const floorSlab = T(
    T(extrudeChamfer(wasm, T, S, d.seat, p.chamfer, 0)).subtract(
      T(T(pinCut.extrude(d.seat - skin + 0.05)).translate(0, 0, skin)),
    ),
  );
  const collar = T(T(T(S.subtract(pocket)).extrude(MECH.collarH)).translate(0, 0, d.seat));
  const ring = T(T(T(S.subtract(cavity)).extrude(d.shellH - d.cavityFloor)).translate(0, 0, d.cavityFloor));
  let shell = T(Manifold.union([floorSlab, collar, ring]));

  // anneau porte-clés : une patte plate fixée au pied de la coque, percée d'un trou pour un anneau
  let keyring = null;
  if (p.keyring) {
    const [lx, ly] = lugCenter(S.toPolygons(), S.bounds(), p.keyringAngle);
    const lug = T(T(T(CrossSection.circle(LUG.radius, 64)).translate(lx, ly)).extrude(LUG.height));
    const hole = T(T(T(T(CrossSection.circle(LUG.hole, 48)).translate(lx, ly)).extrude(LUG.height + 2)).translate(0, 0, -1));
    shell = T(T(Manifold.union([shell, lug])).subtract(hole));
    keyring = { x: lx, y: ly, r: LUG.radius, hole: LUG.hole };
  }
  if (shell.isEmpty() || shell.status() !== 'NoError') throw new Error(`maillage coque invalide (${shell.status()})`);
  return { shell, keyring };
}

/**
 * Capuchon : corps, relief sous la face, fourreau et croix, couches de décor.
 * @param {any} cap contour du capuchon (CrossSection du scope)
 * @param {{index:number, cs:any}[]} art régions de décor (CrossSection du scope), déjà disjointes
 */
export function buildCap(wasm, scope, cap, placement, art, p) {
  const { Manifold, CrossSection } = wasm;
  const T = (x) => scope.add(x);
  const d = derive(p);
  const { x: px, y: py, angle } = placement;
  const { onSwitch } = switchFrame(wasm, T, placement);
  const warnings = [];

  // repère local : bord à z = 0, face décor à z = capH
  let body = extrudeChamfer(wasm, T, cap, d.capH, 0, p.chamfer);

  const rim = MECH.capPocketRim, ceil = MECH.capPocketCeil;
  const reliefProfile = T(CrossSection.square([rim, rim], true));
  // scaleTop doit être un couple [x, y] : un simple nombre ne réduirait que l'axe X (manifold 3.5)
  const reliefRaw = T(reliefProfile.extrude(d.pocketDepth + 0.04, 0, 0, [ceil / rim, ceil / rim]));
  const relief = T(T(reliefRaw.rotate(0, 0, angle)).translate(px, py, -0.04));
  body = T(body.subtract(relief));

  const bossR = p.bossDiameter / 2;
  const bossH = d.pocketDepth + 0.3 - MECH.mouthRecess;
  const boss = T(T(Manifold.cylinder(bossH, bossR, bossR, 64)).translate(px, py, MECH.mouthRecess));
  body = T(body.add(boss));

  const span = MECH.crossSpan + p.socketFit, arm = MECH.crossArm + p.socketFit;
  const crossShape = (grow) => {
    const a = T(CrossSection.square([span + 2 * grow, arm + 2 * grow], true));
    const b = T(CrossSection.square([arm + 2 * grow, span + 2 * grow], true));
    return onSwitch(T(a.add(b)));
  };
  const m0 = MECH.mouthRecess;
  const socketParts = [
    T(T(crossShape(0).extrude(MECH.socketDepth + 0.02)).translate(0, 0, m0 - 0.02)),
    T(T(crossShape(0.25).extrude(0.14)).translate(0, 0, m0 - 0.02)), // entrée évasée
    T(T(crossShape(0.12).extrude(0.12)).translate(0, 0, m0 + 0.12)),
  ];
  body = T(body.subtract(T(Manifold.union(socketParts))));

  // décor : couches de couleur découpées dans la face du capuchon
  const arts = [];
  const zTop = d.capH - p.artDepth;
  const capInset = p.relief > 0 ? T(cap.offset(-p.chamfer - 0.1, 'Round', 2, SEG)) : null;
  for (const a of art) {
    const slab = T(T(a.cs.extrude(p.artDepth + 0.001)).translate(0, 0, zTop));
    let piece = T(slab.intersect(body));
    if (piece.volume() < 0.05) { warnings.push(`couleur ${a.index + 1} : détail trop petit, ignoré`); continue; }
    body = T(body.subtract(slab));
    if (p.relief > 0) {
      const lift = T(T(T(a.cs.intersect(capInset)).extrude(p.relief)).translate(0, 0, d.capH));
      piece = T(Manifold.union([piece, lift]));
    }
    arts.push({ index: a.index, manifold: T(piece.translate(0, 0, d.capRim)) });
  }
  const capBody = T(body.translate(0, 0, d.capRim));
  if (capBody.isEmpty() || capBody.status() !== 'NoError') throw new Error(`maillage capuchon invalide (${capBody.status()})`);
  return { capBody, arts, warnings };
}

/** Les deux pièces d'un coup (tests, usage simple). */
export function buildClicker(wasm, scope, S, cap, placement, art, p) {
  const s = buildShell(wasm, scope, S, cap, placement, p);
  const c = buildCap(wasm, scope, cap, placement, art, p);
  return { shell: s.shell, capBody: c.capBody, arts: c.arts, dims: derive(p), warnings: c.warnings, keyring: s.keyring };
}

/** Patte porte-clés (mm) : disque de rayon `radius`, épaisseur `height`, trou de rayon `hole` (anneau de 3 mm). */
const LUG = { radius: 4.4, height: 3.6, hole: 1.8, offset: 3.2 };

/**
 * Centre de la patte : sur le contour de la coque, dans la direction `angleDeg` (0 = +x, 90 = +y) depuis le
 * centre de la boîte englobante ; on prend la sortie la plus lointaine du rayon, puis on avance de `offset`.
 */
function lugCenter(polys, b, angleDeg) {
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  const ux = Math.cos((angleDeg * Math.PI) / 180), uy = Math.sin((angleDeg * Math.PI) / 180);
  let tMax = 0;
  for (const poly of polys) {
    for (let i = 0, n = poly.length; i < n; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % n];
      const ex = bx - ax, ey = by - ay;
      const den = ux * ey - uy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - cx) * ey - (ay - cy) * ex) / den; // distance le long du rayon
      const sEdge = ((ax - cx) * uy - (ay - cy) * ux) / den; // position sur l'arête
      if (t > tMax && sEdge >= -1e-9 && sEdge <= 1 + 1e-9) tMax = t;
    }
  }
  if (tMax === 0) tMax = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2;
  const t = tMax + LUG.offset;
  return [cx + ux * t, cy + uy * t];
}

/** Convertit le résultat de buildClicker en maillages indépendants de la mémoire WASM. */
export function clickerToMeshes(res) {
  return {
    shell: { mesh: toMesh(res.shell), volume: res.shell.volume() },
    capBody: { mesh: toMesh(res.capBody), volume: res.capBody.volume() },
    arts: res.arts.map((a) => ({ index: a.index, mesh: toMesh(a.manifold), volume: a.manifold.volume() })),
    dims: res.dims,
    warnings: res.warnings,
    keyring: res.keyring,
  };
}

/**
 * Extrusion de z=0 à z=h avec chanfrein optionnel en bas (cb) et en haut (ct), approché par 2 marches
 * (l'imprimante fait de toute façon des couches). Jointure « Miter » : un décalage vers l'intérieur d'un
 * contour n'a pas besoin d'arrondis aux angles convexes, et c'est deux fois plus rapide.
 */
function extrudeChamfer(wasm, T, cs, h, cb, ct, steps = 2) {
  const { Manifold } = wasm;
  const zb = cb > 0.01 ? Math.min(cb, h / 3) : 0;
  const zt = ct > 0.01 ? Math.min(ct, h / 3) : 0;
  const slabs = [];
  const prism = (inset, z0, z1) => {
    const base = inset > 0 ? T(cs.offset(-inset, 'Miter', 2, SEG)) : cs;
    return T(T(base.extrude(z1 - z0)).translate(0, 0, z0));
  };
  for (let i = 0; i < steps && zb; i++) {
    slabs.push(prism(zb * (1 - (i + 0.5) / steps), (zb * i) / steps, (zb * (i + 1)) / steps));
  }
  slabs.push(prism(0, zb, h - zt));
  for (let i = 0; i < steps && zt; i++) {
    slabs.push(prism(zt * ((i + 0.5) / steps), h - zt + (zt * i) / steps, h - zt + (zt * (i + 1)) / steps));
  }
  return slabs.length === 1 ? slabs[0] : T(Manifold.union(slabs));
}

export { SWITCH };
