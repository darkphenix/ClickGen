// Placement automatique du switch : on cherche une position (x, y) et un angle pour qu'un carré
// de côté `keepOut` (logement + parois) tienne entièrement dans le contour du capuchon.
//
// Méthode : pour chaque angle, on tourne le contour de -angle, on le rastérise, puis une image
// intégrale dit en O(1) si un bloc de cellules est entièrement dedans.

import { distanceTransform } from '../image/raster.js';

/**
 * ✦ À VOUS DE JOUER ✦  Score d'une position candidate du switch (plus grand = meilleur).
 *
 * Plusieurs positions/angles sont possibles dans une même forme ; c'est cette fonction qui tranche.
 * Le choix change le ressenti du clicker :
 *   - proche du centre de gravité  -> clic bien équilibré en main (par défaut) ;
 *   - loin du bord (clearance)     -> parois plus épaisses autour du switch, capuchon plus robuste ;
 *   - angle 0                      -> logement aligné sur les axes (usinage « propre »).
 *
 * @param {{x:number,y:number,angle:number,clearance:number,dCentroid:number,size:number}} c
 *   clearance : distance du centre au bord de la pièce (mm)
 *   dCentroid : distance du centre au centre de gravité de la pièce (mm)
 *   angle     : rotation du carré en degrés, 0..90
 *   size      : plus grande dimension de la pièce (mm)
 * @returns {number}
 */
export function scoreCandidate(c) {
  const balance = -c.dCentroid / c.size; // 0 = pile au centre de gravité
  const margin = 0.15 * Math.min(c.clearance / c.size, 0.5);
  const tidy = -0.0003 * c.angle; // très léger penchant pour les angles faibles
  return balance + margin + tidy;
}

/** Centre de gravité d'un ensemble de contours (aires signées : trous négatifs). */
export function centroid(polys) {
  let A = 0, cx = 0, cy = 0;
  for (const p of polys) {
    for (let i = 0, n = p.length; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const cr = a[0] * b[1] - b[0] * a[1];
      A += cr;
      cx += (a[0] + b[0]) * cr;
      cy += (a[1] + b[1]) * cr;
    }
  }
  if (Math.abs(A) < 1e-9) return [0, 0];
  return [cx / (3 * A), cy / (3 * A)];
}

export function polysBounds(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Rastérise des contours (règle pair-impair) : 1 = dedans, échantillonné au centre des cellules. */
export function rasterize(polys, ox, oy, W, H, res) {
  const out = new Uint8Array(W * H);
  const xs = [];
  for (let j = 0; j < H; j++) {
    const y = oy + (j + 0.5) * res;
    xs.length = 0;
    for (const p of polys) {
      for (let i = 0, n = p.length; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - ox) / res - 0.5));
      const i1 = Math.min(W - 1, Math.floor((xs[k + 1] - ox) / res - 0.5));
      for (let i = i0; i <= i1; i++) out[j * W + i] = 1;
    }
  }
  return out;
}

/**
 * @param {number[][][]} polys contours du capuchon (mm), trous inclus
 * @param {number} keepOut côté du carré à loger (mm)
 * @param {{res?:number, angles?:number[]}} [opts] angles : n'essayer que ces angles (degrés)
 * @returns {{x:number,y:number,angle:number,clearance:number}|null}
 */
export function findPlacement(polys, keepOut, opts = {}) {
  if (!polys.length) return null;
  const b = polysBounds(polys);
  if (Math.min(b.w, b.h) < keepOut * 0.7 && Math.max(b.w, b.h) < keepOut) return null;
  const res = opts.res ?? Math.max(0.2, Math.min(0.5, Math.max(b.w, b.h) / 260));
  const [gx, gy] = centroid(polys);
  const size = Math.max(b.w, b.h);

  const tryAngles = (angles) => {
    let best = null;
    for (const angle of angles) {
      const th = (angle * Math.PI) / 180;
      const c = Math.cos(th), s = Math.sin(th);
      const rot = polys.map((p) => p.map(([x, y]) => [x * c + y * s, -x * s + y * c]));
      const rb = polysBounds(rot);
      const pad = 2 * res;
      const ox = rb.x0 - pad, oy = rb.y0 - pad;
      const W = Math.ceil((rb.w + 2 * pad) / res), H = Math.ceil((rb.h + 2 * pad) / res);
      const mask = rasterize(rot, ox, oy, W, H, res);
      // bloc impair de cellules, + 1 cellule de marge de chaque côté
      let kc = Math.ceil(keepOut / res) + 2;
      if (kc % 2 === 0) kc++;
      const half = (kc - 1) >> 1;
      if (kc > W || kc > H) continue;
      // image intégrale
      const SW = W + 1;
      const integ = new Int32Array(SW * (H + 1));
      for (let j = 0; j < H; j++) {
        let row = 0;
        for (let i = 0; i < W; i++) {
          row += mask[j * W + i];
          integ[(j + 1) * SW + i + 1] = integ[j * SW + i + 1] + row;
        }
      }
      const full = kc * kc;
      let edt = null;
      for (let j = half; j < H - half; j++) {
        for (let i = half; i < W - half; i++) {
          const sum = integ[(j + half + 1) * SW + i + half + 1] - integ[(j - half) * SW + i + half + 1]
            - integ[(j + half + 1) * SW + i - half] + integ[(j - half) * SW + i - half];
          if (sum !== full) continue;
          if (!edt) {
            const inv = new Uint8Array(W * H);
            for (let t = 0; t < inv.length; t++) inv[t] = mask[t] ? 0 : 1;
            edt = distanceTransform(inv, W, H);
          }
          const xr = ox + (i + 0.5) * res, yr = oy + (j + 0.5) * res;
          const x = xr * c - yr * s, y = xr * s + yr * c;
          const clearance = edt[j * W + i] * res;
          const cand = { x, y, angle, clearance, dCentroid: Math.hypot(x - gx, y - gy), size };
          cand.score = scoreCandidate(cand);
          if (!best || cand.score > best.score) best = cand;
        }
      }
    }
    return best;
  };

  let best;
  if (opts.angles?.length) {
    best = tryAngles(opts.angles); // angle imposé par l'utilisateur
  } else {
    const coarse = [];
    for (let a = 0; a < 90; a += 7.5) coarse.push(a);
    best = tryAngles(coarse);
    if (!best) {
      const fine = [];
      for (let a = 0; a < 90; a += 2.5) if (a % 7.5 !== 0) fine.push(a);
      best = tryAngles(fine);
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, angle: best.angle, clearance: best.clearance };
}
