// Contours sous-pixel (marching squares) + simplification de polylignes.

/**
 * Trace les iso-contours `field == level`.
 * Le champ est entouré d'une bordure vide : tous les contours sont fermés.
 * @param {Float32Array} field w*h
 * @returns {number[][][]} liste de boucles [[x,y],...] en pixels (y vers le bas)
 */
export function traceContours(field, w, h, level = 0.5) {
  // champ avec 1 pixel de marge à 0
  const W = w + 2, H = h + 2;
  const f = new Float32Array(W * H);
  for (let y = 0; y < h; y++) f.set(field.subarray(y * w, y * w + w), (y + 1) * W + 1);

  // identifiants de croisements : arête horizontale (x,y)-(x+1,y) = y*W+x ; verticale (x,y)-(x,y+1) = W*H + y*W+x
  const V0 = W * H;
  const adj = new Map(); // id -> [id, id]
  const link = (a, b) => {
    let la = adj.get(a);
    if (!la) adj.set(a, (la = []));
    la.push(b);
    let lb = adj.get(b);
    if (!lb) adj.set(b, (lb = []));
    lb.push(a);
  };
  const coord = (id) => {
    if (id < V0) {
      const y = (id / W) | 0, x = id - y * W;
      const a = f[y * W + x], b = f[y * W + x + 1];
      return [x + (level - a) / (b - a) - 1, y - 1];
    }
    const k = id - V0;
    const y = (k / W) | 0, x = k - y * W;
    const a = f[y * W + x], b = f[(y + 1) * W + x];
    return [x - 1, y + (level - a) / (b - a) - 1];
  };

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = f[y * W + x], b = f[y * W + x + 1];
      const c = f[(y + 1) * W + x + 1], d = f[(y + 1) * W + x];
      const idx = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const top = y * W + x, bottom = (y + 1) * W + x;
      const left = V0 + y * W + x, right = V0 + y * W + x + 1;
      switch (idx) {
        case 1: case 14: link(left, top); break;
        case 2: case 13: link(top, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(right, bottom); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, bottom); break;
        case 5:
          if ((a + b + c + d) / 4 >= level) { link(top, right); link(left, bottom); }
          else { link(left, top); link(right, bottom); }
          break;
        case 10:
          if ((a + b + c + d) / 4 >= level) { link(left, top); link(right, bottom); }
          else { link(top, right); link(left, bottom); }
          break;
      }
    }
  }

  const loops = [];
  const visited = new Set();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const ids = [start];
    visited.add(start);
    let prev = -1, cur = start;
    for (;;) {
      const nb = adj.get(cur);
      let nxt = nb[0] !== prev ? nb[0] : nb[1];
      if (nb[0] === nb[1]) nxt = nb[0];
      if (nxt === start) break;
      if (visited.has(nxt)) break; // sécurité (boucle inattendue)
      visited.add(nxt);
      ids.push(nxt);
      prev = cur;
      cur = nxt;
    }
    if (ids.length >= 3) loops.push(ids.map(coord));
  }
  return loops;
}

/** Aire signée (positive = anti-horaire dans un repère y vers le haut). */
export function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Ramer-Douglas-Peucker pour une boucle fermée (itératif). */
export function simplifyLoop(poly, eps) {
  const n = poly.length;
  if (n <= 4 || eps <= 0) return poly;
  // deux points éloignés comme ancres
  let i0 = 0;
  let best = -1, i1 = 0;
  for (let i = 1; i < n; i++) {
    const d = dist2(poly[0], poly[i]);
    if (d > best) { best = d; i1 = i; }
  }
  best = -1;
  for (let i = 0; i < n; i++) {
    const d = dist2(poly[i1], poly[i]);
    if (d > best) { best = d; i0 = i; }
  }
  const a = Math.min(i0, i1), b = Math.max(i0, i1);
  const keep = new Uint8Array(n);
  keep[a] = keep[b] = 1;
  const rdp = (lo, hi) => {
    const stack = [[lo, hi]];
    while (stack.length) {
      const [s, e] = stack.pop();
      if (e - s < 2) continue;
      let dmax = 0, idx = -1;
      for (let i = s + 1; i < e; i++) {
        const d = segDist(poly[i % n], poly[s % n], poly[e % n]);
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax > eps) {
        keep[idx % n] = 1;
        stack.push([s, idx], [idx, e]);
      }
    }
  };
  rdp(a, b);
  rdp(b, a + n);
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(poly[i]);
  return out.length >= 3 ? out : poly;
}

function dist2(p, q) { const dx = p[0] - q[0], dy = p[1] - q[1]; return dx * dx + dy * dy; }

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.sqrt(dist2(p, a));
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
