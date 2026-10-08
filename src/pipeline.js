// Orchestration : image -> silhouette -> placement du switch -> coque + capuchon.
// Aucune dépendance au DOM : le même code tourne dans le navigateur et sous Node (tests).

import { derive } from './core/params.js';
import { blur } from './image/raster.js';
import { segmentImage } from './image/segment.js';
import { quantizeColors } from './image/quantize.js';
import { signedArea, simplifyLoop, traceContours } from './image/contours.js';
import { Scope, getEngine } from './geometry/engine.js';
import { SEG, capOutline, componentAt, pxTransform, shellOutline, toMm } from './geometry/outline.js';
import { convexHull, fitInside, frameOutline } from './geometry/frames.js';
import { findPlacement } from './geometry/placement.js';
import { buildClicker, clickerToMeshes } from './geometry/clicker.js';

export class PipelineError extends Error {
  /** @param {'empty'|'nofit'|'toobig'|'geometry'} code */
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/** Vrai si l'utilisateur a choisi un cadre géométrique plutôt que le contour de l'image. */
export const isFramed = (p) => !!p.frame && p.frame !== 'image';

/**
 * Étape 1 (dépend de l'image, du masque et du nombre de couleurs) : silhouette, contours, couleurs.
 * @param {{width:number,height:number,data:ArrayLike<number>}} img RGBA
 */
export function analyzeImage(img, p) {
  const { width: w, height: h } = img;
  if (isFramed(p)) return analyzeFramed(img, p);

  const seg = segmentImage(img, p);
  if (!seg.bounds) throw new PipelineError('empty', 'Aucune forme détectée dans cette image.');
  const loops = cleanLoops(traceContours(seg.field, seg.w, seg.h, 0.5), 6, 0.35);
  if (!loops.length) throw new PipelineError('empty', 'Aucune forme détectée dans cette image.');
  const quant = quantizeColors(img, seg.solid, p.colorCount);
  const artLoops = quant.colors.map((_, i) => (i === 0 ? null : traceLabel(quant.labels, i, w, h)));
  return { seg, loops, quant, artLoops, width: w, height: h, frame: null };
}

/**
 * Mode cadre : la silhouette vient d'un cadre géométrique, l'image n'est plus que le décor du capuchon.
 * Sujet détouré (fond transparent) : le fond devient la couleur 0 du capuchon et chaque couleur du sujet
 * un décor. Image entière (photo) : la couleur la plus répandue sert de fond.
 */
function analyzeFramed(img, p) {
  const { width: w, height: h } = img;
  const seg = p.frameContent === 'full' ? null : segmentImage(img, p);
  const subject = !!seg?.bounds && (p.frameContent === 'subject' || (p.frameContent === 'auto' && seg.mode === 'alpha'));
  const rect = subject ? seg.bounds : { x0: 0, y0: 0, x1: w, y1: h };
  const inside = subject ? seg.solid : new Uint8Array(w * h).fill(1);
  const quant = quantizeColors(img, inside, p.colorCount, { reserveBase: subject, rect });
  const artLoops = quant.colors.map((_, i) => (i === 0 && subject ? null : i === 0 ? null : traceLabel(quant.labels, i, w, h)));
  const loops = [[[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]]];
  // enveloppe convexe du sujet : sert à l'ajuster dans le cadre sans rogner ses extrémités (oreilles, queue…)
  const hull = subject
    ? convexHull(cleanLoops(traceContours(seg.field, seg.w, seg.h, 0.5), 6, 0.5).flat())
    : loops[0];
  return { seg: seg ?? { w, h, bounds: rect, mode: 'full' }, loops, quant, artLoops, width: w, height: h, frame: { rect, subject, hull } };
}

function cleanLoops(loops, minArea, eps) {
  return loops.filter((l) => Math.abs(signedArea(l)) >= minArea).map((l) => simplifyLoop(l, eps));
}

/** Contours d'une étiquette de couleur : on ne travaille que sur sa boîte englobante (bien plus rapide). */
function traceLabel(labels, idx, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (labels[row + x] === idx) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return [];
  const m = 4;
  const cx0 = Math.max(0, x0 - m), cy0 = Math.max(0, y0 - m);
  const cw = Math.min(w, x1 + m + 1) - cx0, ch = Math.min(h, y1 + m + 1) - cy0;
  const f = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const src = (cy0 + y) * w + cx0, dst = y * cw;
    for (let x = 0; x < cw; x++) f[dst + x] = labels[src + x] === idx ? 1 : 0;
  }
  blur(f, cw, ch, 0.9);
  return cleanLoops(traceContours(f, cw, ch, 0.5), 3, 0.3).map((l) => l.map(([x, y]) => [x + cx0, y + cy0]));
}

/**
 * Étape 2 : géométrie 3D à partir de l'analyse. Renvoie maillages + données d'aperçu 2D.
 * @param {ReturnType<typeof analyzeImage>} a
 * @param {import('./core/params.js').DEFAULTS} p
 * @param {{onStep?:(s:string)=>Promise<void>|void}} [opts]
 */
export async function makeClicker(a, p, opts = {}) {
  const wasm = await getEngine();
  const { CrossSection } = wasm;
  const d = derive(p);
  const framed = isFramed(p) && !!a.frame;
  const step = async (s) => opts.onStep && (await opts.onStep(s));
  const maxSize = Math.max(p.size, p.bed - 8);
  const sizeLimit = maxSize * 1.6;

  // --- repères pixels -> mm et contour de départ ---------------------------------------------
  let tf, framePoly = null;
  if (framed) {
    framePoly = frameOutline(p.frame).map(([x, y]) => [x * p.size, y * p.size]);
    const fx = framePoly.map((q) => q[0]), fy = framePoly.map((q) => q[1]);
    const fw = Math.max(...fx) - Math.min(...fx), fh = Math.max(...fy) - Math.min(...fy);
    const { rect, hull, subject } = a.frame;
    const cx = (rect.x0 + rect.x1) / 2, cy = (rect.y0 + rect.y1) / 2;
    let s;
    if (subject) {
      // sujet détouré : le plus grand agrandissement qui garde toute son enveloppe dans le capuchon
      const pts = hull.map(([x, y]) => [x - cx, -(y - cy)]);
      s = fitInside(framePoly, pts, d.capOffset + 0.8);
      if (!Number.isFinite(s) || s <= 0) s = Math.min(fw / (rect.x1 - rect.x0), fh / (rect.y1 - rect.y0)) * 0.7;
    } else {
      // image entière (photo) : elle recouvre tout le cadre, le bord est rogné par le contour
      s = Math.max(fw / (rect.x1 - rect.x0), fh / (rect.y1 - rect.y0));
    }
    tf = { s: s * p.frameZoom, cx, cy };
  } else {
    tf = pxTransform(a.seg.bounds, p.size);
  }

  /** Silhouette de la coque à l'échelle k (hors du scope retenu : l'appelant le libère). */
  const outlineAt = (sc, k) => {
    if (framed) {
      const cs = sc.add(CrossSection.ofPolygons([framePoly.map(([x, y]) => [x * k, y * k])], 'Positive'));
      return { cs, dropped: 0 };
    }
    return shellOutline(wasm, sc, toMm(a.loops, tf, k), p);
  };

  /** Essaie une échelle : silhouette, capuchon, position du switch. */
  const angles = p.placementAngle == null ? undefined : [((p.placementAngle % 90) + 90) % 90];
  const tryFit = (k) => {
    const sc = new Scope();
    try {
      const so = outlineAt(sc, k);
      const capAll = capOutline(wasm, sc, so.cs, d);
      const polys = capAll.toPolygons();
      const placement = polys.length ? findPlacement(polys, d.capKeepOut, { angles }) : null;
      return { sc, S: so.cs, dropped: so.dropped, capAll, placement, k };
    } catch (e) {
      sc.dispose();
      throw e;
    }
  };

  let scope = null;
  try {
    // --- la « taille » désigne la silhouette finale (après filtres et pièces écartées) ----------
    await step('outline');
    let k0 = 1;
    if (!framed) {
      const probe = new Scope();
      try {
        const b = outlineAt(probe, 1).cs.bounds();
        const eff = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
        if (eff > 1 && Math.abs(eff - p.size) / p.size > 0.005) k0 = p.size / eff;
      } finally {
        probe.dispose();
      }
    }
    const sizeOf = (k) => p.size * (k / k0);

    // --- agrandissement automatique : on cherche l'échelle minimale où le switch rentre --------
    // (progression géométrique jusqu'à trouver, puis dichotomie : ~8 essais au lieu de 24)
    let best = tryFit(k0);
    if (!best.placement) {
      if (!p.autoGrow) {
        best.sc.dispose();
        throw new PipelineError('nofit', 'Le switch ne rentre pas dans cette forme à cette taille.', { size: sizeOf(k0) });
      }
      let lo = k0, hi = k0;
      best.sc.dispose();
      best = null;
      while (!best) {
        hi *= 1.25;
        if (sizeOf(hi) > sizeLimit) throw new PipelineError('nofit', 'La forme est trop fine pour loger un switch.', { size: sizeOf(hi) });
        const t = tryFit(hi);
        if (t.placement) best = t; else { t.sc.dispose(); lo = hi; }
      }
      for (let i = 0; i < 5 && (hi - lo) / lo > 0.02; i++) {
        const mid = (lo + hi) / 2;
        const t = tryFit(mid);
        if (t.placement) { best.sc.dispose(); best = t; hi = mid; } else { t.sc.dispose(); lo = mid; }
      }
    }
    scope = best.sc;
    const { S, dropped, placement } = best;
    const k = best.k;
    const cap = componentAt(wasm, scope, best.capAll, placement.x, placement.y);
    const finalSize = sizeOf(k);
    const grown = k / k0 > 1.001;
    const warnings = [];
    if (grown) warnings.push({ code: 'grown', size: finalSize });
    if (finalSize > maxSize) warnings.push({ code: 'toobig', size: finalSize, bed: p.bed });
    if (dropped) warnings.push({ code: 'dropped', count: dropped });

    // --- décor : une région par couleur (hors couleur de base), disjointes ----------------------
    await step('art');
    const T = (x) => scope.add(x);
    const art = [];
    let taken = null;
    const r = p.minArt / 2;
    // Le décor déborde volontairement de 0,5 mm du capuchon : c'est la découpe 3D qui l'ajuste au bord.
    // Un contour de décor exactement confondu avec celui du capuchon créerait des faces coïncidentes
    // et des triangles dégénérés dans le maillage.
    const capGrown = T(cap.offset(0.5, 'Round', 2, SEG));
    for (let i = 1; i < a.quant.colors.length; i++) {
      const polys = toMm(a.artLoops[i] ?? [], tf, k);
      if (!polys.length) continue;
      let cs = T(CrossSection.ofPolygons(polys, 'EvenOdd'));
      cs = T(cs.intersect(capGrown));
      if (taken) cs = T(cs.subtract(taken));
      if (r > 0.01) cs = T(T(cs.offset(-r, 'Round', 2, SEG)).offset(r, 'Round', 2, SEG));
      cs = T(cs.simplify(0.01)); // retire les sommets doubles ou alignés laissés par les décalages
      if (cs.isEmpty() || cs.area() < Math.max(0.5, p.minArt * p.minArt)) continue;
      taken = taken ? T(taken.add(cs)) : cs;
      art.push({ index: i, cs });
    }

    // --- 3D ---------------------------------------------------------------------------------------
    await step('solid');
    let res;
    try {
      res = buildClicker(wasm, scope, S, cap, placement, art, { ...p });
    } catch (e) {
      throw new PipelineError('geometry', e.message);
    }
    const meshes = clickerToMeshes(res);
    warnings.push(...res.warnings.map((w) => ({ code: 'note', text: w })));

    const preview = {
      shell: S.toPolygons(),
      cap: cap.toPolygons(),
      art: art.map((x) => ({ index: x.index, polys: T(x.cs.intersect(cap)).toPolygons() })),
    };
    const b = S.bounds();
    // couleurs réellement utilisées : le corps + les décors qui ont produit de la matière
    const usedArt = new Set(meshes.arts.map((x) => x.index));
    const used = a.quant.colors.map((_, i) => i).filter((i) => i === 0 || usedArt.has(i));
    return {
      meshes,
      colors: a.quant.colors,
      used,
      preview,
      placement,
      dims: d,
      size: finalSize,
      grown,
      framed,
      keyring: meshes.keyring ?? null,
      outline: { w: b.max[0] - b.min[0], h: b.max[1] - b.min[1] },
      warnings,
    };
  } finally {
    scope?.dispose();
  }
}
