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
  const resFine = opts.res ?? Math.max(0.2, Math.min(0.5, Math.max(b.w, b.h) / 260));
  const resCoarse = Math.max(resFine, 0.6);
  const [gx, gy] = centroid(polys);
  const size = Math.max(b.w, b.h);

  /**
   * Meilleure position parmi `angles`, à la résolution `res`. `win` limite la recherche à un disque
   * {x, y, r} (affinage local autour d'un premier résultat).
   */
  const search = (angles, res, win = null) => {
    let best = null, bestScore = -Infinity;
    const cand = { x: 0, y: 0, angle: 0, clearance: 0, dCentroid: 0, size };
    for (const angle of angles) {
      const th = (angle * Math.PI) / 180;
      const c = Math.cos(th), s = Math.sin(th);
      const rot = polys.map((p) => p.map(([x, y]) => [x * c + y * s, -x * s + y * c]));
      const rb = polysBounds(rot);
      const pad = 2 * res;
      let ox = rb.x0 - pad, oy = rb.y0 - pad;
      let W = Math.ceil((rb.w + 2 * pad) / res), H = Math.ceil((rb.h + 2 * pad) / res);
      if (win) {
        // affinage : on ne rastérise qu'une boîte autour de la fenêtre (le calcul est ~5 fois plus court)
        const wx = win.x * c + win.y * s, wy = -win.x * s + win.y * c; // centre de la fenêtre, repère tourné
        const hb = win.r + keepOut / 2 + 2 * pad + 1;
        const bx0 = Math.max(ox, wx - hb), by0 = Math.max(oy, wy - hb);
        const bx1 = Math.min(ox + W * res, wx + hb), by1 = Math.min(oy + H * res, wy + hb);
        ox = bx0; oy = by0;
        W = Math.ceil((bx1 - bx0) / res); H = Math.ceil((by1 - by0) / res);
      }
      // bloc impair de cellules, + 1 cellule de marge de chaque côté
      let kc = Math.ceil(keepOut / res) + 2;
      if (kc % 2 === 0) kc++;
      const half = (kc - 1) >> 1;
      if (kc > W || kc > H) continue;
      const mask = rasterize(rot, ox, oy, W, H, res);
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
          const xr = ox + (i + 0.5) * res, yr = oy + (j + 0.5) * res;
          const x = xr * c - yr * s, y = xr * s + yr * c;
          if (win && Math.hypot(x - win.x, y - win.y) > win.r) continue;
          if (!edt) {
            const inv = new Uint8Array(W * H);
            for (let t = 0; t < inv.length; t++) inv[t] = mask[t] ? 0 : 1;
            edt = distanceTransform(inv, W, H);
          }
          cand.x = x; cand.y = y; cand.angle = angle;
          cand.clearance = edt[j * W + i] * res;
          cand.dCentroid = Math.hypot(x - gx, y - gy);
          const score = scoreCandidate(cand);
          if (score > bestScore) { bestScore = score; best = { x, y, angle, clearance: cand.clearance }; }
        }
      }
    }
    return best;
  };

  const wrap = (a) => ((a % 90) + 90) % 90;
  const coarseAngles = [];
  for (let a = 0; a < 90; a += 7.5) coarseAngles.push(a);

  let best;
  if (opts.angles?.length) {
    best = search(opts.angles, resFine); // angle imposé par l'utilisateur
  } else {
    // 1) passe grossière sur tous les angles (rapide) ; 2) affinage local à la résolution fine
    best = search(coarseAngles, resCoarse);
    if (best) {
      const near = [...new Set([best.angle - 3.75, best.angle, best.angle + 3.75].map(wrap))];
      best = search(near, resFine, { x: best.x, y: best.y, r: 3 })
        ?? search(coarseAngles, resFine); // rarissime : détail plus fin que la grille grossière
    } else {
      // forme juste : la marge de la grille grossière peut avoir tout refusé, on cherche finement
      best = search(coarseAngles, resFine);
      if (!best) {
        const fine = [];
        for (let a = 0; a < 90; a += 2.5) if (a % 7.5 !== 0) fine.push(a);
        best = search(fine, resFine);
      }
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, angle: best.angle, clearance: best.clearance };
}

// =====================================================================================================
// Plusieurs switches dans un même capuchon
// =====================================================================================================
//
// Pourquoi : avec un seul switch au centre d'un grand capuchon, appuyer sur le côté fait basculer le capuchon,
// qui coince dans la coque. Deux ou trois tiges réparties le tiennent à plat (comme les stabilisateurs d'une
// barre d'espace). Tous les switches ont le même angle : leurs logements forment une grille propre, et un seul
// angle suffit à régler l'ensemble.
//
// Méthode : pour chaque angle, on balaie la grille (comme pour un seul switch) et on obtient l'ensemble V des
// centres où un carré de sécurité tient. On choisit ensuite n centres de V, à au moins `pitch` les uns des
// autres (distance mesurée selon les axes des carrés), qui maximisent `scoreArrangement` : départ glouton depuis
// quelques graines, puis améliorations point par point, enfin affinage sur la grille complète.

const MAX_CANDIDATES = 500; // centres essayés par angle (réseau régulier extrait de V)

/**
 * ✦ À VOUS DE JOUER ✦  Score d'un arrangement de plusieurs switches (plus grand = meilleur).
 *
 * C'est le deuxième réglage « de goût » du placement (le premier est scoreCandidate, pour un seul switch).
 * Trois forces s'opposent :
 *   - l'appui : deux switches stabilisent mieux s'ils sont écartés, trois s'ils forment un grand triangle
 *     (trois points alignés ne valent pas mieux que deux : le capuchon bascule autour de la ligne) ;
 *   - l'équilibre : le milieu des switches doit tomber près du centre de gravité de la forme, sinon on appuie
 *     « à côté » des tiges ;
 *   - la marge : le switch le plus proche du bord garde de la matière autour de son relief.
 * Par défaut l'appui est plafonné (inutile d'écarter au maximum une fois la cible atteinte) : l'équilibre et la
 * marge départagent alors.
 *
 * @param {{points:{x:number,y:number,clearance:number}[], angle:number, centroid:number[], size:number,
 *          keepOut:number, pitch:number}} a  points : centres des switches (mm) et distance de chacun au bord ;
 *          size : plus grande dimension de la forme (mm)
 * @returns {number}
 */
export function scoreArrangement(a) {
  const { points, centroid, size, keepOut } = a;
  const n = points.length;
  let mx = 0, my = 0, minClearance = Infinity;
  for (const p of points) {
    mx += p.x; my += p.y;
    if (p.clearance < minClearance) minClearance = p.clearance;
  }
  mx /= n; my /= n;
  let support = 1;
  if (n === 2) {
    support = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / (0.55 * size);
  } else if (n >= 3) {
    const [p, q, r] = points;
    support = Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2 / (0.12 * size * size);
  }
  support = Math.min(support, 1);
  const balance = -Math.hypot(mx - centroid[0], my - centroid[1]) / size; // 0 = pile au centre de gravité
  const margin = Math.min(Math.max((minClearance - keepOut / 2) / (0.25 * size), 0), 1);
  return support + 1.5 * balance + 0.6 * margin - 0.0003 * a.angle;
}

/** Balaie la grille d'un angle : cellules dont le carré de sécurité tient entièrement dans les contours. */
function scanValid(polys, keepOut, angle, res) {
  const th = (angle * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const rot = polys.map((p) => p.map(([x, y]) => [x * c + y * s, -x * s + y * c]));
  const rb = polysBounds(rot);
  const pad = 2 * res;
  const ox = rb.x0 - pad, oy = rb.y0 - pad;
  const W = Math.ceil((rb.w + 2 * pad) / res), H = Math.ceil((rb.h + 2 * pad) / res);
  let kc = Math.ceil(keepOut / res) + 2; // bloc impair de cellules, + 1 cellule de marge de chaque côté
  if (kc % 2 === 0) kc++;
  const half = (kc - 1) >> 1;
  if (kc > W || kc > H) return null;
  const mask = rasterize(rot, ox, oy, W, H, res);
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
  const valid = new Uint8Array(W * H);
  let count = 0;
  for (let j = half; j < H - half; j++) {
    for (let i = half; i < W - half; i++) {
      const sum = integ[(j + half + 1) * SW + i + half + 1] - integ[(j - half) * SW + i + half + 1]
        - integ[(j + half + 1) * SW + i - half] + integ[(j - half) * SW + i - half];
      if (sum === full) { valid[j * W + i] = 1; count++; }
    }
  }
  return count ? { W, H, ox, oy, res, c, s, mask, valid, count, edt: null } : null;
}

/** Distance de chaque cellule au bord (en cellules), calculée à la demande. */
function clearanceMap(g) {
  if (!g.edt) {
    const inv = new Uint8Array(g.W * g.H);
    for (let t = 0; t < inv.length; t++) inv[t] = g.mask[t] ? 0 : 1;
    g.edt = distanceTransform(inv, g.W, g.H);
  }
  return g.edt;
}

/** Meilleur arrangement de n switches sur une grille balayée (même angle). */
function arrangeOnGrid(g, angle, ctx) {
  const { W, H, ox, oy, res, c, s, valid } = g;
  const { n, pitch, size, gx, gy, keepOut, score } = ctx;
  const edt = clearanceMap(g);
  const U = (i) => ox + (i + 0.5) * res;
  const V = (j) => oy + (j + 0.5) * res;

  // centres candidats : réseau régulier de cellules valides ; toutes si la zone est étroite
  let stride = Math.max(1, Math.ceil(Math.sqrt(g.count / MAX_CANDIDATES)));
  let cell = [];
  for (;;) {
    cell = [];
    for (let j = 0; j < H; j += stride) for (let i = 0; i < W; i += stride) if (valid[j * W + i]) cell.push(j * W + i);
    if (cell.length >= Math.min(g.count, 8 * n) || stride === 1) break;
    stride = Math.max(1, stride >> 1);
  }
  const m = cell.length;
  if (m < n) return null;
  const cu = new Float64Array(m), cv = new Float64Array(m);
  for (let q = 0; q < m; q++) { cu[q] = U(cell[q] % W); cv[q] = V((cell[q] / W) | 0); }

  const far = (q, o) => Math.max(Math.abs(cu[q] - cu[o]), Math.abs(cv[q] - cv[o])) >= pitch - 1e-9;
  const compatible = (q, others) => { for (const o of others) if (!far(q, o)) return false; return true; };
  const toPoint = (u, v, idx) => ({ x: u * c - v * s, y: u * s + v * c, clearance: edt[idx] * res });
  const rate = (points) => score({ points, angle, centroid: [gx, gy], size, keepOut, pitch });
  const rateCand = (ids) => rate(ids.map((q) => toPoint(cu[q], cv[q], cell[q])));
  const rateCells = (ids) => rate(ids.map((idx) => toPoint(U(idx % W), V((idx / W) | 0), idx)));

  // coordonnées dans le repère du monde de chaque candidat
  const wx = new Float64Array(m), wy = new Float64Array(m), dist = new Float64Array(m);
  let nearest = 0, farthest = 0, minU = 0, maxU = 0, minV = 0, maxV = 0;
  for (let q = 0; q < m; q++) {
    wx[q] = cu[q] * c - cv[q] * s;
    wy[q] = cu[q] * s + cv[q] * c;
    dist[q] = Math.hypot(wx[q] - gx, wy[q] - gy);
    if (dist[q] < dist[nearest]) nearest = q;
    if (dist[q] > dist[farthest]) farthest = q;
    if (cu[q] < cu[minU]) minU = q;
    if (cu[q] > cu[maxU]) maxU = q;
    if (cv[q] < cv[minV]) minV = q;
    if (cv[q] > cv[maxV]) maxV = q;
  }

  /** Départ glouton : on ajoute à chaque fois le centre qui améliore le plus le score. */
  const greedy = (seed) => {
    const arr = [seed];
    while (arr.length < n) {
      let bq = -1, bs = -Infinity;
      for (let q = 0; q < m; q++) {
        if (!compatible(q, arr)) continue;
        arr.push(q);
        const sc = rateCand(arr);
        arr.pop();
        if (sc > bs) { bs = sc; bq = q; }
      }
      if (bq < 0) return null;
      arr.push(bq);
    }
    return arr;
  };

  /** Améliorations point par point (un switch glisse vers le meilleur centre, les autres restant fixes). */
  const improve = (arr) => {
    let cur = rateCand(arr);
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let k = 0; k < n; k++) {
        const others = arr.filter((_, t) => t !== k);
        let bq = arr[k], bs = cur;
        for (let q = 0; q < m; q++) {
          if (q === arr[k] || !compatible(q, others)) continue;
          const trial = arr.slice();
          trial[k] = q;
          const sc = rateCand(trial);
          if (sc > bs + 1e-12) { bs = sc; bq = q; }
        }
        if (bq !== arr[k]) { arr[k] = bq; cur = bs; moved = true; }
      }
      if (!moved) break;
    }
    return cur;
  };

  let best = null, bestScore = -Infinity;
  const consider = (arr, sc) => { if (sc > bestScore) { bestScore = sc; best = arr.map((q) => cell[q]); } };
  const seeds = [...new Set([nearest, farthest, minU, maxU, minV, maxV])];

  if (ctx.fast) { // faisabilité seulement : le premier arrangement valable suffit
    for (const seed of seeds) {
      const arr = greedy(seed);
      if (arr) { consider(arr, rateCand(arr)); break; }
    }
  } else {
    // graines structurées : une paire sur un diamètre, un triangle équilibré, autour du centre de gravité. Les
    // déplacements point par point ne sauraient pas écarter deux switches ENSEMBLE : ces graines explorent l'espace.
    const step = stride * res;
    const snap = (x, y) => {
      let bq = -1, bd = Infinity;
      for (let q = 0; q < m; q++) {
        const d = Math.hypot(wx[q] - x, wy[q] - y);
        if (d < bd) { bd = d; bq = q; }
      }
      return bd <= 1.5 * step + 0.5 ? bq : -1;
    };
    const structured = [];
    for (const f of [0.12, 0.18, 0.24, 0.3, 0.36, 0.42]) {
      const r = f * size;
      for (let k = 0; k < 8; k++) {
        const phi = n === 2 ? (k * Math.PI) / 8 : (k * Math.PI) / 12; // une paire a un demi-tour de symétrie, un triangle un tiers de tour
        const arr = [];
        for (let t = 0; t < n; t++) {
          const a = phi + (n === 2 ? t * Math.PI : (t * 2 * Math.PI) / n);
          const q = snap(gx + r * Math.cos(a), gy + r * Math.sin(a));
          if (q < 0 || arr.includes(q) || !compatible(q, arr)) break;
          arr.push(q);
        }
        if (arr.length === n) structured.push({ arr, sc: rateCand(arr) });
      }
    }
    structured.sort((p, q) => q.sc - p.sc);
    for (const st of structured.slice(0, 3)) consider(st.arr, improve(st.arr));
    for (const seed of seeds) {
      const arr = greedy(seed);
      if (arr) consider(arr, improve(arr));
    }
  }
  if (!best) return null;

  // affinage sur la grille complète : chaque switch glisse vers la meilleure cellule voisine, les autres restant fixes
  let cur = bestScore;
  if (!ctx.fast && stride > 1) {
    const hw = stride + 1;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let k = 0; k < n; k++) {
        const i0 = best[k] % W, j0 = (best[k] / W) | 0;
        let bi = best[k], bs = cur;
        for (let j = Math.max(0, j0 - hw); j <= Math.min(H - 1, j0 + hw); j++) {
          for (let i = Math.max(0, i0 - hw); i <= Math.min(W - 1, i0 + hw); i++) {
            const idx = j * W + i;
            if (!valid[idx] || idx === best[k]) continue;
            let ok = true;
            for (let t = 0; t < n && ok; t++) {
              if (t === k) continue;
              const o = best[t];
              if (Math.max(Math.abs(U(i) - U(o % W)), Math.abs(V(j) - V((o / W) | 0))) < pitch - 1e-9) ok = false;
            }
            if (!ok) continue;
            const trial = best.slice();
            trial[k] = idx;
            const sc = rateCells(trial);
            if (sc > bs + 1e-12) { bs = sc; bi = idx; }
          }
        }
        if (bi !== best[k]) { best[k] = bi; cur = bs; moved = true; }
      }
      if (!moved) break;
    }
  }
  const points = best.map((idx) => toPoint(U(idx % W), V((idx / W) | 0), idx));
  return { angle, score: cur, points };
}

/**
 * Place n switches (même angle) dans un capuchon.
 * @param {number[][][]} polys contours d'UNE composante du capuchon (mm), trous inclus
 * @param {number} keepOut côté du carré de sécurité de chaque switch (relief + parois)
 * @param {number} n nombre de switches
 * @param {{pitch?:number, angles?:number[], res?:number, fast?:boolean, score?:Function}} [opts]
 *   pitch : écart minimal entre deux switches, mesuré selon les axes des carrés (défaut : keepOut − 1,2 mm,
 *   c'est-à-dire une paroi de 1,2 mm entre deux reliefs) ; angles : n'essayer que ceux-là ; fast : premier
 *   arrangement valable, grille grossière, aucun repli (sert à savoir si ça tient, pas à choisir : un peu
 *   pessimiste sur les formes très justes) ; score : remplace scoreArrangement
 * @returns {{placements:{x:number,y:number,angle:number,clearance:number}[], score:number}|null}
 *   placements triés du plus proche au plus éloigné du centre de gravité (le premier sert de référence)
 */
export function findPlacements(polys, keepOut, n, opts = {}) {
  if (!polys.length) return null;
  if (n <= 1) {
    const p = findPlacement(polys, keepOut, opts);
    return p ? { placements: [p], score: 0 } : null;
  }
  const b = polysBounds(polys);
  const size = Math.max(b.w, b.h);
  const resFine = opts.res ?? Math.max(0.2, Math.min(0.5, size / 260));
  const resCoarse = Math.max(resFine, 0.8);
  const [gx, gy] = centroid(polys);
  const ctx = { n, pitch: opts.pitch ?? keepOut - 1.2, size, gx, gy, keepOut, score: opts.score ?? scoreArrangement, fast: !!opts.fast };

  const attempt = (angles, res) => {
    let best = null;
    for (const angle of angles) {
      const g = scanValid(polys, keepOut, angle, res);
      if (!g) continue;
      const r = arrangeOnGrid(g, angle, ctx);
      if (r && (!best || r.score > best.score)) best = r;
      if (r && ctx.fast) break; // faisabilité : un seul arrangement valable suffit
    }
    return best;
  };
  const wrap = (a) => ((a % 90) + 90) % 90;
  const grid = (step) => { const out = []; for (let a = 0; a < 90 - 1e-9; a += step) out.push(a); return out; };

  let best;
  if (opts.angles?.length) {
    best = attempt(opts.angles, resFine); // angle imposé par l'utilisateur
  } else {
    best = attempt(grid(15), resCoarse); // passe grossière : 6 angles
    if (best && !ctx.fast) {
      const near = [...new Set([best.angle - 7.5, best.angle - 3.75, best.angle, best.angle + 3.75, best.angle + 7.5].map(wrap))];
      best = attempt(near, resFine) ?? best;
    } else if (!best && !ctx.fast) {
      best = attempt(grid(7.5), resFine); // forme juste : la grille grossière a tout refusé
    }
  }
  if (!best) return null;
  const placements = best.points
    .map((p) => ({ x: p.x, y: p.y, angle: best.angle, clearance: p.clearance }))
    .sort((p, q) => Math.hypot(p.x - gx, p.y - gy) - Math.hypot(q.x - gx, q.y - gy) || p.x - q.x || p.y - q.y);
  return { placements, score: best.score };
}
