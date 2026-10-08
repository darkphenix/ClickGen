// Réduction de l'image à N couleurs (k-means en Lab) pour le décor multi-filaments.

import { rgbToLab } from './raster.js';

const OUTSIDE = 255;

/**
 * @param {{width:number,height:number,data:ArrayLike<number>}} img RGBA
 * @param {Uint8Array} inside 1 = pixel dans la silhouette
 * @param {number} k nombre de couleurs demandé
 * @returns {{labels:Uint8Array, colors:{hex:string, rgb:number[], area:number}[], outside:number}}
 */
export function quantizeColors(img, inside, k, opts = {}) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const mergeDE = opts.mergeDeltaE ?? 9;

  // Lab des pixels intérieurs (composés sur blanc)
  const idx = [];
  for (let i = 0; i < n; i++) if (inside[i]) idx.push(i);
  const labAll = new Float32Array(idx.length * 3);
  const tmp = [0, 0, 0];
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    const a = data[i * 4 + 3] / 255;
    rgbToLab(
      Math.round(data[i * 4] * a + 255 * (1 - a)),
      Math.round(data[i * 4 + 1] * a + 255 * (1 - a)),
      Math.round(data[i * 4 + 2] * a + 255 * (1 - a)),
      tmp, 0,
    );
    labAll[j * 3] = tmp[0]; labAll[j * 3 + 1] = tmp[1]; labAll[j * 3 + 2] = tmp[2];
  }

  const labels = new Uint8Array(n).fill(OUTSIDE);
  if (idx.length === 0) return { labels, colors: [], outside: OUTSIDE };
  k = Math.max(1, Math.min(8, Math.round(k)));

  // échantillon réduit
  const step = Math.max(1, Math.floor(idx.length / 20000));
  const sample = [];
  for (let j = 0; j < idx.length; j += step) sample.push(j);

  const centers = kmeansPP(labAll, sample, k);
  // Lloyd
  for (let iter = 0; iter < 16; iter++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const j of sample) {
      const c = nearest(centers, labAll, j);
      const s = sum[c];
      s[0] += labAll[j * 3]; s[1] += labAll[j * 3 + 1]; s[2] += labAll[j * 3 + 2]; s[3]++;
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

  // fusion des centres trop proches
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

  // affectation de tous les pixels
  const lab = new Uint8Array(n).fill(OUTSIDE);
  for (let j = 0; j < idx.length; j++) lab[idx[j]] = nearest(centers, labAll, j);

  // filtre majoritaire 3x3 (supprime liserés d'anticrénelage et poussières)
  majorityFilter(lab, w, h, centers.length, 2);

  // surfaces, tri par taille décroissante, suppression des clusters quasi vides
  // La couleur d'un cluster est la MÉDIANE de ses pixels : les pixels d'anticrénelage (minoritaires)
  // ne déplacent pas la teinte, contrairement à une moyenne.
  const counts = new Array(centers.length).fill(0);
  const members = centers.map(() => [[], [], []]);
  const memberStep = Math.max(1, Math.floor(idx.length / 40000));
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j], c = lab[i];
    if (c === OUTSIDE) continue;
    counts[c]++;
    if (j % memberStep === 0) {
      members[c][0].push(data[i * 4]); members[c][1].push(data[i * 4 + 1]); members[c][2].push(data[i * 4 + 2]);
    }
  }
  const median = (arr) => { if (!arr.length) return 0; arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
  const rgbMed = members.map((m) => m.map(median));
  const order = counts.map((a, c) => c).filter((c) => counts[c] >= idx.length * 0.003).sort((a, b) => counts[b] - counts[a]);
  if (order.length === 0) order.push(counts.indexOf(Math.max(...counts)));
  const remap = new Uint8Array(centers.length).fill(OUTSIDE);
  order.forEach((c, r) => (remap[c] = r));
  // les pixels des clusters supprimés vont au cluster survivant le plus proche
  const dropped = counts.map((_, c) => c).filter((c) => remap[c] === OUTSIDE);
  for (const c of dropped) {
    let bestR = 0, bestD = Infinity;
    order.forEach((o, r) => { const d = dE(centers[c], centers[o]); if (d < bestD) { bestD = d; bestR = r; } });
    remap[c] = bestR;
  }
  for (let i = 0; i < n; i++) if (lab[i] !== OUTSIDE) lab[i] = remap[lab[i]];

  const colors = order.map((c) => ({ rgb: rgbMed[c], hex: toHex(rgbMed[c]), area: counts[c] }));
  return { labels: lab, colors, outside: OUTSIDE };
}

function kmeansPP(lab, sample, k) {
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (j) => [lab[j * 3], lab[j * 3 + 1], lab[j * 3 + 2]];
  const centers = [pick(sample[Math.floor(rnd() * sample.length)])];
  const d2 = new Float64Array(sample.length).fill(Infinity);
  while (centers.length < k) {
    const last = centers[centers.length - 1];
    let total = 0;
    for (let s = 0; s < sample.length; s++) {
      const j = sample[s];
      const dx = lab[j * 3] - last[0], dy = lab[j * 3 + 1] - last[1], dz = lab[j * 3 + 2] - last[2];
      d2[s] = Math.min(d2[s], dx * dx + dy * dy + dz * dz);
      total += d2[s];
    }
    if (total <= 1e-6) break; // image quasi unie
    let r = rnd() * total, s = 0;
    for (; s < sample.length - 1; s++) { r -= d2[s]; if (r <= 0) break; }
    centers.push(pick(sample[s]));
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
        if (src[i] === OUTSIDE) continue;
        votes.fill(0);
        let any = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = src[i + dy * w + dx];
            if (v !== OUTSIDE) { votes[v]++; any = true; }
          }
        }
        if (!any) continue;
        let best = src[i], bv = votes[best];
        for (let c = 0; c < k; c++) if (votes[c] > bv) { bv = votes[c]; best = c; }
        // changement seulement si majorité nette (≥ 5 voisins sur 9)
        if (best !== src[i] && bv >= 5) lab[i] = best;
      }
    }
  }
}

export function toHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}
