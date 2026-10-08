// Contours en pixels -> contours en mm -> silhouette de la coque (filtres morphologiques vectoriels).

import { MECH } from '../core/params.js';

export const SEG = 48; // segments par tour complet pour les arrondis

/**
 * Transformation pixels -> mm : centre la forme, retourne l'axe y (l'image a y vers le bas).
 * @param {{x0:number,y0:number,x1:number,y1:number}} bounds boîte englobante de la forme (px)
 * @param {number} size plus grande dimension voulue (mm)
 */
export function pxTransform(bounds, size) {
  const bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0;
  return {
    s: size / Math.max(bw, bh),
    cx: (bounds.x0 + bounds.x1) / 2,
    cy: (bounds.y0 + bounds.y1) / 2,
  };
}

/**
 * Convertit des boucles en pixels en polygones en mm.
 * @param {number[][][]} loops
 * @param {{s:number,cx:number,cy:number}} tf
 * @param {number} [k] facteur d'agrandissement supplémentaire
 */
export function toMm(loops, tf, k = 1) {
  const s = tf.s * k;
  return loops.map((l) => l.map(([x, y]) => [(x - tf.cx) * s, -(y - tf.cy) * s]));
}

/**
 * Silhouette de la coque : fermeture (fentes), ouverture (détails trop fins), arrondi, plus grande pièce.
 * @returns {{cs:any, dropped:number}} cs appartient au scope fourni
 */
export function shellOutline(wasm, scope, polys, p) {
  const { CrossSection } = wasm;
  const T = (x) => scope.add(x);
  const grow = (cs, d) => T(cs.offset(d, 'Round', 2, SEG));
  let cs = T(CrossSection.ofPolygons(polys, 'EvenOdd'));
  if (p.closeGap > 0.02) cs = grow(grow(cs, p.closeGap / 2), -p.closeGap / 2);
  if (p.minDetail > 0.02) cs = grow(grow(cs, -p.minDetail / 2), p.minDetail / 2);
  if (p.smooth > 0.02) {
    cs = grow(grow(cs, p.smooth), -p.smooth);
    cs = grow(grow(cs, -p.smooth), p.smooth);
  }
  cs = T(cs.simplify(0.015));
  let dropped = 0;
  if (p.keepMain) {
    const parts = cs.decompose().map(T);
    if (parts.length > 1) {
      let bestI = 0, bestA = -1;
      parts.forEach((c, i) => {
        const a = c.area();
        if (a > bestA) { bestA = a; bestI = i; }
      });
      dropped = parts.length - 1;
      cs = parts[bestI];
    }
  }
  return { cs, dropped };
}

/** Contour du capuchon = silhouette réduite de (paroi + jeu), sans les détails trop fins. */
export function capOutline(wasm, scope, S, d) {
  const T = (x) => scope.add(x);
  let cap = T(S.offset(-d.capOffset, 'Round', 2, SEG));
  const r = MECH.minCapFeature / 2;
  cap = T(T(cap.offset(-r, 'Round', 2, SEG)).offset(r, 'Round', 2, SEG));
  return T(cap.simplify(0.015));
}

/** Composante de `cs` qui contient le point (x, y), sinon la plus grande. */
export function componentAt(wasm, scope, cs, x, y) {
  const { CrossSection } = wasm;
  const T = (v) => scope.add(v);
  const parts = cs.decompose().map(T);
  if (parts.length <= 1) return parts[0] ?? cs;
  const probe = T(T(CrossSection.square([0.6, 0.6], true)).translate(x, y));
  let best = parts[0], bestA = -1;
  for (const c of parts) {
    const hit = T(c.intersect(probe)).area();
    if (hit > 0.2) return c;
    if (c.area() > bestA) { bestA = c.area(); best = c; }
  }
  return best;
}
