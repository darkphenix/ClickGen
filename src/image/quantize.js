// Réduction de l'image à N couleurs (k-means en Lab) pour le décor multi-filaments.
//
// Rapide : on ne travaille pas pixel par pixel mais sur les couleurs DISTINCTES (clés RGB 5 bits par
// canal, 32 768 au plus), pondérées par leur nombre de pixels. La couleur finale de chaque groupe est
// la médiane des vrais pixels : l'anticrénelage (minoritaire) ne la déplace pas.

import { rgbToLab } from './raster.js';

const OUTSIDE = 255;

/**
 * @param {{width:number,height:number,data:ArrayLike<number>}} img RGBA
 * @param {Uint8Array} inside 1 = pixel à colorier
 * @param {number} k nombre de couleurs demandé
 * @param {{mergeDeltaE?:number, reserveBase?:boolean, rect?:{x0:number,y0:number,x1:number,y1:number}|null, baseRgb?:number[]}} [opts]
 *   reserveBase : l'indice 0 est réservé au FOND (pixels du cadre hors de `inside`), les couleurs de
 *   l'image prennent les indices 1..k. Utilisé quand le sujet se détache d'un fond transparent.
 * @returns {{labels:Uint8Array, colors:{hex:string, rgb:number[], area:number}[], outside:number}}
 */
export function quantizeColors(img, inside, k, opts = {}) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const mergeDE = opts.mergeDeltaE ?? 9;
  k = Math.max(1, Math.min(8, Math.round(k)));

  // 1) clé de couleur de chaque pixel intérieur + histogramme
  // Un pixel transparent à l'intérieur de la silhouette (trou comblé) n'a pas de couleur : il ne vote pas
  // et prend la couleur de base. Sinon son RGB brut (0, 0, 0) donnait un « noir » fantôme à la médiane,
  // ou le blanc de la composition occupait l'une des couleurs demandées.
  let opaque = 0;
  for (let i = 0; i < n; i++) if (inside[i] && data[i * 4 + 3] >= 128) opaque++;
  const votes = (i) => inside[i] && (opaque === 0 || data[i * 4 + 3] >= 128); // opaque === 0 : image entièrement translucide
  const keyOf = new Uint16Array(n);
  const hist = new Uint32Array(32768);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!votes(i)) continue;
    let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    if (a < 128) { const t = a / 255; r = r * t + 255 * (1 - t); g = g * t + 255 * (1 - t); b = b * t + 255 * (1 - t); }
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    keyOf[i] = key;
    hist[key]++;
    count++;
  }
  const labels = new Uint8Array(n).fill(OUTSIDE);
  if (!count) return { labels, colors: [], outside: OUTSIDE };

  // 2) couleurs distinctes -> Lab (au centre du casier)
  const keys = [];
  for (let c = 0; c < 32768; c++) if (hist[c]) keys.push(c);
  const m = keys.length;
  const lab = new Float32Array(m * 3);
  const wt = new Float64Array(m);
  const tmp = [0, 0, 0];
  for (let j = 0; j < m; j++) {
    const c = keys[j];
    rgbToLab(((c >> 10) & 31) * 8 + 4, ((c >> 5) & 31) * 8 + 4, (c & 31) * 8 + 4, tmp, 0);
    lab[j * 3] = tmp[0]; lab[j * 3 + 1] = tmp[1]; lab[j * 3 + 2] = tmp[2];
    wt[j] = hist[c];
  }

  // 3) k-means++ pondéré, puis Lloyd
  const centers = kmeansPP(lab, wt, m, k);
  for (let iter = 0; iter < 20; iter++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (let j = 0; j < m; j++) {
      const s = sum[nearest(centers, lab, j)];
      s[0] += lab[j * 3] * wt[j]; s[1] += lab[j * 3 + 1] * wt[j]; s[2] += lab[j * 3 + 2] * wt[j]; s[3] += wt[j];
    }
    let moved = 0;
    for (let c = 0; c < centers.length; c++) {
      if (!sum[c][3]) continue;
      const nc = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
      moved += Math.abs(nc[0] - centers[c][0]) + Math.abs(nc[1] - centers[c][1]) + Math.abs(nc[2] - centers[c][2]);
      centers[c] = nc;
    }
    if (moved < 0.05) break;
  }

  // 4) fusion des centres trop proches
  let merged = true;
  while (merged && centers.length > 1) {
    merged = false;
    outer: for (let a = 0; a < centers.length; a++) {
      for (let b = a + 1; b < centers.length; b++) {
        if (dE(centers[a], centers[b]) < mergeDE) {
          centers[a] = centers[a].map((v, t) => (v + centers[b][t]) / 2);
          centers.splice(b, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  // 5) étiquette de chaque couleur distincte, puis de chaque pixel
  const labelOfKey = new Uint8Array(32768);
  for (let j = 0; j < m; j++) labelOfKey[keys[j]] = nearest(centers, lab, j);
  const lab8 = new Uint8Array(n).fill(OUTSIDE);
  for (let i = 0; i < n; i++) if (votes(i)) lab8[i] = labelOfKey[keyOf[i]];

  // 6) filtre majoritaire 3 x 3 : supprime liserés d'anticrénelage et poussières
  majorityFilter(lab8, w, h, centers.length, 2);

  // 7) surfaces, couleur médiane de chaque groupe, tri par taille décroissante
  const counts = new Array(centers.length).fill(0);
  const members = centers.map(() => [[], [], []]);
  const step = Math.max(1, Math.floor(count / 40000));
  let seen = 0;
  for (let i = 0; i < n; i++) {
    const c = lab8[i];
    if (c === OUTSIDE) continue;
    counts[c]++;
    if (seen++ % step === 0) {
      members[c][0].push(data[i * 4]); members[c][1].push(data[i * 4 + 1]); members[c][2].push(data[i * 4 + 2]);
    }
  }
  const median = (arr) => { if (!arr.length) return 0; arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
  const rgbMed = members.map((mm) => mm.map(median));
  const order = counts.map((_, c) => c).filter((c) => counts[c] >= count * 0.003).sort((a, b) => counts[b] - counts[a]);
  if (!order.length) order.push(counts.indexOf(Math.max(...counts)));
  const remap = new Uint8Array(centers.length).fill(OUTSIDE);
  order.forEach((c, r) => (remap[c] = r));
  // les pixels des groupes supprimés vont au groupe conservé le plus proche
  for (let c = 0; c < centers.length; c++) {
    if (remap[c] !== OUTSIDE) continue;
    let bestR = 0, bestD = Infinity;
    order.forEach((o, r) => { const d = dE(centers[c], centers[o]); if (d < bestD) { bestD = d; bestR = r; } });
    remap[c] = bestR;
  }
  for (let i = 0; i < n; i++) if (lab8[i] !== OUTSIDE) lab8[i] = remap[lab8[i]];
  let colors = order.map((c) => ({ rgb: rgbMed[c], hex: toHex(rgbMed[c]), area: counts[c] }));

  // 8) fond réservé : indice 0 = tout ce qui est dans le cadre mais hors du sujet
  if (opts.reserveBase) {
    const rect = opts.rect ?? { x0: 0, y0: 0, x1: w, y1: h };
    let baseArea = 0;
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        const i = y * w + x;
        if (lab8[i] === OUTSIDE) { labels[i] = 0; baseArea++; } else labels[i] = lab8[i] + 1;
      }
    }
    const baseRgb = opts.baseRgb ?? [255, 255, 255];
    colors = [{ rgb: baseRgb, hex: toHex(baseRgb), area: baseArea }, ...colors];
    return { labels, colors, outside: OUTSIDE };
  }
  return { labels: lab8, colors, outside: OUTSIDE };
}

function kmeansPP(lab, wt, m, k) {
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (j) => [lab[j * 3], lab[j * 3 + 1], lab[j * 3 + 2]];
  let total = 0;
  for (let j = 0; j < m; j++) total += wt[j];
  // premier centre : couleur la plus fréquente (déterministe et stable)
  let first = 0;
  for (let j = 1; j < m; j++) if (wt[j] > wt[first]) first = j;
  const centers = [pick(first)];
  const d2 = new Float64Array(m).fill(Infinity);
  while (centers.length < k) {
    const last = centers[centers.length - 1];
    let sum = 0;
    for (let j = 0; j < m; j++) {
      const dx = lab[j * 3] - last[0], dy = lab[j * 3 + 1] - last[1], dz = lab[j * 3 + 2] - last[2];
      d2[j] = Math.min(d2[j], dx * dx + dy * dy + dz * dz);
      sum += d2[j] * wt[j];
    }
    if (sum <= 1e-6) break; // image quasi unie
    let r = rnd() * sum, j = 0;
    for (; j < m - 1; j++) { r -= d2[j] * wt[j]; if (r <= 0) break; }
    centers.push(pick(j));
  }
  return centers;
}

function nearest(centers, lab, j) {
  let best = 0, bd = Infinity;
  const l = lab[j * 3], a = lab[j * 3 + 1], b = lab[j * 3 + 2];
  for (let c = 0; c < centers.length; c++) {
    const dx = l - centers[c][0], dy = a - centers[c][1], dz = b - centers[c][2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function dE(p, q) { return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }

function majorityFilter(lab, w, h, k, passes) {
  const src = new Uint8Array(lab.length);
  const votes = new Int32Array(k);
  for (let p = 0; p < passes; p++) {
    src.set(lab);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const c0 = src[i];
        if (c0 === OUTSIDE) continue;
        // raccourci : un pixel dont les 4 voisins directs ont la même étiquette ne change pas
        if (src[i - 1] === c0 && src[i + 1] === c0 && src[i - w] === c0 && src[i + w] === c0) continue;
        votes.fill(0);
        let any = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = src[i + dy * w + dx];
            if (v !== OUTSIDE) { votes[v]++; any = true; }
          }
        }
        if (!any) continue;
        let best = c0, bv = votes[best];
        for (let c = 0; c < k; c++) if (votes[c] > bv) { bv = votes[c]; best = c; }
        // changement seulement si majorité nette (≥ 5 voisins sur 9)
        if (best !== c0 && bv >= 5) lab[i] = best;
      }
    }
  }
}

export function toHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
