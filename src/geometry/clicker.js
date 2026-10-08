// Construction 3D de la coque et du capuchon (manifold-3d).
//
// Repère « assemblé » : fond de la coque à z = 0, switch posé sur son plancher (z = seat),
// capuchon au repos (son bord est à z = capRim, sa face décor est au-dessus).
// Tout est une pile de prismes 2D (CrossSection) combinés en 3D : aucune CSG fragile sur des
// surfaces gauches, donc des maillages toujours étanches.

import { MECH, PIN_HOLES, SWITCH, derive } from '../core/params.js';
import { SEG } from './outline.js';
import { toMesh } from './engine.js';

/**
 * @param {{Manifold:any,CrossSection:any}} wasm
 * @param {{add:(o:any)=>any}} scope
 * @param {any} S silhouette de la coque (CrossSection du scope)
 * @param {any} cap contour du capuchon, composante qui porte le switch (CrossSection du scope)
 * @param {{x:number,y:number,angle:number}} placement
 * @param {{index:number, cs:any}[]} art régions de décor (CrossSection du scope), déjà disjointes
 * @param {import('../core/params.js').DEFAULTS} p
 */
export function buildClicker(wasm, scope, S, cap, placement, art, p) {
  const { Manifold, CrossSection } = wasm;
  const T = (x) => scope.add(x);
  const d = derive(p);
  const { x: px, y: py, angle } = placement;
  const warnings = [];

  // ---- contours ------------------------------------------------------------------------
  const cavity = T(cap.offset(p.clearance, 'Round', 2, SEG));

  const onSwitch = (cs) => T(T(cs.rotate(angle)).translate(px, py));
  const square = (side) => onSwitch(T(CrossSection.square([side, side], true)));

  const pocket = square(d.pocket);
  const stray = T(pocket.subtract(cavity)).area();
  if (stray > 0.05) throw new Error(`Le logement du switch déborde de la cavité (${stray.toFixed(2)} mm²)`);

  // ---- coque -----------------------------------------------------------------------------
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
  const shell = T(Manifold.union([floorSlab, collar, ring]));

  // ---- capuchon (repère local : bord à z = 0, face décor à z = capH) --------------------
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
  const artMeshes = [];
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
    artMeshes.push({ index: a.index, manifold: T(piece.translate(0, 0, d.capRim)) });
  }
  const capBody = T(body.translate(0, 0, d.capRim));

  for (const [name, m] of [['coque', shell], ['capuchon', capBody]]) {
    if (m.isEmpty() || m.status() !== 'NoError') throw new Error(`maillage ${name} invalide (${m.status()})`);
  }
  return { shell, capBody, arts: artMeshes, dims: d, warnings };
}

/** Convertit le résultat de buildClicker en maillages indépendants de la mémoire WASM. */
export function clickerToMeshes(res) {
  return {
    shell: { mesh: toMesh(res.shell), volume: res.shell.volume() },
    capBody: { mesh: toMesh(res.capBody), volume: res.capBody.volume() },
    arts: res.arts.map((a) => ({ index: a.index, mesh: toMesh(a.manifold), volume: a.manifold.volume() })),
    dims: res.dims,
    warnings: res.warnings,
  };
}

/**
 * Extrusion de z=0 à z=h avec chanfrein optionnel en bas (cb) et en haut (ct),
 * approché par 3 marches (l'imprimante fait de toute façon des couches).
 */
function extrudeChamfer(wasm, T, cs, h, cb, ct, steps = 3) {
  const { Manifold } = wasm;
  const zb = cb > 0.01 ? Math.min(cb, h / 3) : 0;
  const zt = ct > 0.01 ? Math.min(ct, h / 3) : 0;
  const slabs = [];
  const prism = (inset, z0, z1) => {
    const base = inset > 0 ? T(cs.offset(-inset, 'Round', 2, SEG)) : cs;
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
