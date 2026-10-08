// Briques de traitement d'image sur tableaux typés (aucune dépendance DOM : testable sous Node).

const SRGB_LUT = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** sRGB (0-255) -> CIE Lab (D65). Écrit dans out[o..o+2]. */
export function rgbToLab(r, g, b, out, o = 0) {
  const lr = SRGB_LUT[r], lg = SRGB_LUT[g], lb = SRGB_LUT[b];
  let x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  let y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  let z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  out[o] = 116 * y - 16;
  out[o + 1] = 500 * (x - y);
  out[o + 2] = 200 * (y - z);
}

/** Lab de tous les pixels d'une image RGBA -> Float32Array(3 * n). */
export function imageToLab(data, n) {
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], lab, i * 3);
  return lab;
}

/** Flou gaussien séparable (3 passes de flou boîte), en place sur un Float32Array w*h. */
export function blur(field, w, h, sigma) {
  if (sigma < 0.3) return field;
  // largeurs de boîtes idéales pour approcher une gaussienne (méthode de Kovesi)
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const tmp = new Float32Array(field.length);
  for (let pass = 0; pass < n; pass++) {
    const r = ((pass < m ? wl : wu) - 1) >> 1;
    boxH(field, tmp, w, h, r);
    boxV(tmp, field, w, h, r);
  }
  return field;
}

function boxH(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w, first = src[row], last = src[row + w - 1];
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += x < 0 ? first : x >= w ? last : src[row + x];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * inv;
      const add = x + r + 1, rem = x - r;
      acc += (add >= w ? last : src[row + add]) - (rem < 0 ? first : src[row + rem]);
    }
  }
}

function boxV(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    const first = src[x], last = src[(h - 1) * w + x];
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += y < 0 ? first : y >= h ? last : src[y * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * inv;
      const add = y + r + 1, rem = y - r;
      acc += (add >= h ? last : src[add * w + x]) - (rem < 0 ? first : src[rem * w + x]);
    }
  }
}

const BIG = 1e12;

/**
 * Transformée en distance euclidienne (Felzenszwalb & Huttenlocher).
 * @param {Uint8Array} feature 1 = pixel "source" (distance 0)
 * @returns {Float32Array} distance (en pixels) au pixel source le plus proche
 */
export function distanceTransform(feature, w, h) {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = feature[i] ? 0 : BIG;
  const n = Math.max(w, h);
  const f = new Float64Array(n), out = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const pass = (len, get, set) => {
    for (let i = 0; i < len; i++) f[i] = get(i);
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
    for (let i = 0; i < len; i++) set(i, out[i]);
  };
  for (let x = 0; x < w; x++) pass(h, (y) => d[y * w + x], (y, val) => (d[y * w + x] = val));
  for (let y = 0; y < h; y++) pass(w, (x) => d[y * w + x], (x, val) => (d[y * w + x] = val));
  for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i]);
  return d;
}

/**
 * Pixels de fond reliés au bord de l'image (remplissage par diffusion, 4-connexité).
 * @param {Uint8Array} solid 1 = pixel "plein"
 * @returns {Uint8Array} 1 = fond extérieur
 */
export function floodOutside(solid, w, h) {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i) => {
    if (!solid[i] && !outside[i]) {
      outside[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (sp) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return outside;
}

/**
 * Composantes connexes (8-connexité) d'un masque binaire.
 * @returns {{labels: Int32Array, areas: number[]}} labels 0 = vide, 1.. = composantes
 */
export function connectedComponents(mask, w, h) {
  const labels = new Int32Array(w * h);
  const areas = [0];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || labels[s]) continue;
    let sp = 0, area = 0;
    stack[sp++] = s;
    labels[s] = next;
    while (sp) {
      const i = stack[--sp];
      area++;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !labels[j]) {
            labels[j] = next;
            stack[sp++] = j;
          }
        }
      }
    }
    areas.push(area);
    next++;
  }
  return { labels, areas };
}

/** Boîte englobante des pixels dont la valeur atteint `level`. */
export function fieldBounds(field, w, h, level = 0.5) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (field[row + x] >= level) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Boîte englobante des pixels non nuls. */
export function maskBounds(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
