// Cadres : contours analytiques (cercle, carré arrondi, hexagone…) utilisés à la place de la silhouette
// de l'image. L'image devient alors le décor du capuchon : idéal pour les photos, les textes et les logos
// compliqués dont le contour ne ferait pas une jolie coque.
//
// Chaque cadre est un polygone anti-horaire centré sur l'origine, plus grande dimension = 1, y vers le haut.

const TAU = Math.PI * 2;

export const FRAME_NAMES = ['circle', 'squircle', 'roundrect', 'hexagon', 'octagon', 'shield', 'pill'];

/** Part de la plus grande dimension du cadre occupée par le sujet (le reste est de la marge visuelle). */
export const FRAME_CONTENT = {
  circle: 0.78, squircle: 0.84, roundrect: 0.84, hexagon: 0.82, octagon: 0.84, shield: 0.74, pill: 0.88,
};

function arcPoints(cx, cy, r, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Arrondit les angles d'un polygone convexe anti-horaire par des arcs de rayon r. */
export function roundedPolygon(verts, r, seg = 10) {
  const out = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const v = verts[i], p = verts[(i + n - 1) % n], q = verts[(i + 1) % n];
    const u1 = norm([p[0] - v[0], p[1] - v[1]]), u2 = norm([q[0] - v[0], q[1] - v[1]]);
    const cosT = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
    const theta = Math.acos(cosT); // angle intérieur
    const lim = 0.5 * Math.min(Math.hypot(p[0] - v[0], p[1] - v[1]), Math.hypot(q[0] - v[0], q[1] - v[1]));
    const t = Math.min(r / Math.tan(theta / 2), lim);
    const rr = t * Math.tan(theta / 2);
    const bis = norm([u1[0] + u2[0], u1[1] + u2[1]]);
    const c = [v[0] + (bis[0] * rr) / Math.sin(theta / 2), v[1] + (bis[1] * rr) / Math.sin(theta / 2)];
    const t1 = [v[0] + u1[0] * t, v[1] + u1[1] * t], t2 = [v[0] + u2[0] * t, v[1] + u2[1] * t];
    let a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    let a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    // polygone anti-horaire : l'arc tourne dans le sens anti-horaire de t1 vers t2
    while (a2 < a1) a2 += TAU;
    if (a2 - a1 > Math.PI) a2 -= TAU; // si on a pris le grand arc, repartir dans l'autre sens
    out.push(...arcPoints(c[0], c[1], rr, a1, a2, seg));
  }
  return out;
}

function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

function regularPolygon(n, R, rot = 0) {
  return Array.from({ length: n }, (_, i) => [R * Math.cos(rot + (i / n) * TAU), R * Math.sin(rot + (i / n) * TAU)]);
}

function roundedRect(w, h, r, seg = 14) {
  const x = w / 2, y = h / 2;
  return roundedPolygon([[-x, -y], [x, -y], [x, y], [-x, y]], r, seg);
}

function superellipse(a, b, n, count = 180) {
  return Array.from({ length: count }, (_, i) => {
    const t = (i / count) * TAU;
    const c = Math.cos(t), s = Math.sin(t);
    return [a * Math.sign(c) * Math.abs(c) ** (2 / n), b * Math.sign(s) * Math.abs(s) ** (2 / n)];
  });
}

function normalize(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const k = 1 / Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return poly.map(([x, y]) => [(x - cx) * k, (y - cy) * k]);
}

/** @param {string} name l'un de FRAME_NAMES @returns {number[][]} polygone anti-horaire, plus grande dimension 1 */
export function frameOutline(name) {
  switch (name) {
    case 'circle': return normalize(regularPolygon(160, 0.5));
    case 'squircle': return normalize(superellipse(0.5, 0.5, 4));
    case 'roundrect': return normalize(roundedRect(1, 1, 0.16));
    case 'hexagon': return normalize(roundedPolygon(regularPolygon(6, 0.5), 0.07, 8));
    case 'octagon': return normalize(roundedPolygon(regularPolygon(8, 0.5, Math.PI / 8), 0.05, 8));
    case 'shield': return normalize(roundedPolygon([[-0.43, 0.5], [-0.43, 0.04], [0, -0.5], [0.43, 0.04], [0.43, 0.5]], 0.1, 8));
    case 'pill': return normalize(roundedRect(1, 0.46, 0.23, 24));
    default: throw new Error(`cadre inconnu : ${name}`);
  }
}

/** Enveloppe convexe (chaîne monotone d'Andrew), anti-horaire. */
export function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Plus grand facteur s tel que tous les points s * p restent dans `poly` (convexe, anti-horaire, contenant
 * l'origine) réduit de `margin` de chaque côté.
 */
export function fitInside(poly, points, margin = 0) {
  let s = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const nx = ey / len, ny = -ex / len; // normale sortante
    const dist = nx * a[0] + ny * a[1] - margin;
    for (const [x, y] of points) {
      const q = nx * x + ny * y;
      if (q > 1e-9) s = Math.min(s, dist / q);
    }
  }
  return s;
}

export function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
