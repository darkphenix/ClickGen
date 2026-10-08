// Images synthétiques pour les tests (aucune dépendance : on dessine dans un tableau RGBA).

export function newImage(w, h, bg = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
  return { width: w, height: h, data };
}

/** Remplit un polygone (pair-impair) avec un léger anticrénelage vertical (4 sous-lignes). */
export function fillPolygon(img, poly, rgba) {
  const { width: w, height: h, data } = img;
  const SUB = 4;
  const cover = new Float32Array(w * h);
  let y0 = Infinity, y1 = -Infinity;
  for (const [, y] of poly) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++) {
    for (let s = 0; s < SUB; s++) {
      const sy = y + (s + 0.5) / SUB;
      const xs = [];
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
          xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, xs[k]), xb = Math.min(w, xs[k + 1]);
        for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
          const ov = Math.min(x + 1, xb) - Math.max(x, xa);
          if (ov > 0) cover[y * w + x] += ov / SUB;
        }
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const c = Math.min(1, cover[i]);
    if (c <= 0) continue;
    const a = (rgba[3] / 255) * c;
    for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(rgba[k] * c + data[i * 4 + k] * (1 - c));
    data[i * 4 + 3] = Math.round(255 * Math.min(1, a + (data[i * 4 + 3] / 255) * (1 - c)));
  }
}

export function circle(cx, cy, r, n = 96) {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
}

export function star(cx, cy, ro, ri, n = 5, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = rot + (i / (n * 2)) * 2 * Math.PI;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

export function rect(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/** Petit ours : tête brune, deux oreilles, museau crème, yeux et nez noirs. Fond transparent ou blanc. */
export function bearImage(size = 400, transparent = true) {
  const img = newImage(size, size, transparent ? [0, 0, 0, 0] : [255, 255, 255, 255]);
  const s = size / 400;
  const brown = [150, 98, 58, 255], cream = [240, 214, 170, 255], black = [25, 20, 20, 255];
  fillPolygon(img, circle(95 * s, 95 * s, 55 * s), brown);
  fillPolygon(img, circle(305 * s, 95 * s, 55 * s), brown);
  fillPolygon(img, circle(200 * s, 220 * s, 150 * s), brown);
  fillPolygon(img, circle(200 * s, 265 * s, 70 * s), cream);
  fillPolygon(img, circle(150 * s, 190 * s, 14 * s, 40), black);
  fillPolygon(img, circle(250 * s, 190 * s, 14 * s, 40), black);
  fillPolygon(img, circle(200 * s, 245 * s, 18 * s, 40), black);
  return img;
}

/** Vérifie qu'un maillage est étanche (chaque arête orientée a son opposée) et renvoie son volume. */
export function checkMesh(mesh) {
  const { positions: v, indices: t } = mesh;
  const key = (i) => `${Math.round(v[i * 3] * 1e4)},${Math.round(v[i * 3 + 1] * 1e4)},${Math.round(v[i * 3 + 2] * 1e4)}`;
  const ids = new Map();
  const vid = (i) => { const k = key(i); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const edges = new Map();
  let vol = 0, degenerate = 0;
  for (let f = 0; f < t.length; f += 3) {
    const a = vid(t[f]), b = vid(t[f + 1]), c = vid(t[f + 2]);
    if (a === b || b === c || a === c) { degenerate++; continue; }
    for (const [x, y] of [[a, b], [b, c], [c, a]]) edges.set(`${x}_${y}`, (edges.get(`${x}_${y}`) ?? 0) + 1);
    const i = t[f] * 3, j = t[f + 1] * 3, k = t[f + 2] * 3;
    vol += (v[i] * (v[j + 1] * v[k + 2] - v[j + 2] * v[k + 1])
      - v[i + 1] * (v[j] * v[k + 2] - v[j + 2] * v[k])
      + v[i + 2] * (v[j] * v[k + 1] - v[j + 1] * v[k])) / 6;
  }
  let bad = 0;
  for (const [e, n] of edges) {
    const [x, y] = e.split('_');
    if (n !== 1 || edges.get(`${y}_${x}`) !== 1) bad++;
  }
  return { watertight: bad === 0, badEdges: bad, degenerate, volume: vol, triangles: t.length / 3 };
}

export function heart(cx, cy, s, n = 120) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    const x = 16 * Math.sin(a) ** 3;
    const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    return [cx + x * s, cy + y * s];
  });
}

/** Intersections d'une droite verticale (x, y) avec un maillage : z triés, sans doublons. */
export function rayZ(mesh, x, y) {
  const { positions: v, indices: t } = mesh;
  const zs = [];
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
    const d = (v[b + 1] - v[c + 1]) * (v[a] - v[c]) + (v[c] - v[b]) * (v[a + 1] - v[c + 1]);
    if (Math.abs(d) < 1e-12) continue;
    const w1 = ((v[b + 1] - v[c + 1]) * (x - v[c]) + (v[c] - v[b]) * (y - v[c + 1])) / d;
    const w2 = ((v[c + 1] - v[a + 1]) * (x - v[c]) + (v[a] - v[c]) * (y - v[c + 1])) / d;
    const w3 = 1 - w1 - w2;
    if (w1 < -1e-9 || w2 < -1e-9 || w3 < -1e-9) continue;
    zs.push(w1 * v[a + 2] + w2 * v[b + 2] + w3 * v[c + 2]);
  }
  zs.sort((p, q) => p - q);
  const out = [];
  for (const z of zs) if (!out.length || Math.abs(z - out[out.length - 1]) > 1e-6) out.push(z);
  return out;
}

/** Intervalles pleins [z0, z1] déduits des intersections d'une droite verticale. */
export function solidIntervals(mesh, x, y) {
  const zs = rayZ(mesh, x, y);
  const out = [];
  for (let i = 0; i + 1 < zs.length; i += 2) out.push([+zs[i].toFixed(3), +zs[i + 1].toFixed(3)]);
  return out;
}
