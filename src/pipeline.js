// Orchestration : image -> silhouette -> placement du switch -> coque + capuchon.
// Aucune dépendance au DOM : le même code tourne dans le navigateur et sous Node (tests).

import { derive } from './core/params.js';
import { blur } from './image/raster.js';
import { segmentImage } from './image/segment.js';
import { quantizeColors } from './image/quantize.js';
import { signedArea, simplifyLoop, traceContours } from './image/contours.js';
import { Scope, getEngine } from './geometry/engine.js';
import { SEG, capOutline, componentAt, pxTransform, shellOutline, toMm } from './geometry/outline.js';
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

/**
 * Étape 1 (dépend de l'image, du masque et du nombre de couleurs) : silhouette, contours, couleurs.
 * @param {{width:number,height:number,data:ArrayLike<number>}} img RGBA
 */
export function analyzeImage(img, p) {
  const seg = segmentImage(img, p);
  if (!seg.bounds) throw new PipelineError('empty', 'Aucune forme détectée dans cette image.');
  const loops = cleanLoops(traceContours(seg.field, seg.w, seg.h, 0.5), 6, 0.35);
  if (!loops.length) throw new PipelineError('empty', 'Aucune forme détectée dans cette image.');
  const quant = quantizeColors(img, seg.solid, p.colorCount);
  const artLoops = quant.colors.map((_, i) => (i === 0 ? null : traceLabel(quant.labels, i, seg.w, seg.h)));
  return { seg, loops, quant, artLoops, width: seg.w, height: seg.h };
}

function cleanLoops(loops, minArea, eps) {
  return loops.filter((l) => Math.abs(signedArea(l)) >= minArea).map((l) => simplifyLoop(l, eps));
}

function traceLabel(labels, idx, w, h) {
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = labels[i] === idx ? 1 : 0;
  blur(f, w, h, 0.9);
  return cleanLoops(traceContours(f, w, h, 0.5), 3, 0.3);
}

/**
 * Étape 2 : géométrie 3D à partir de l'analyse. Renvoie maillages + données d'aperçu 2D.
 * @param {ReturnType<typeof analyzeImage>} a
 * @param {import('./core/params.js').DEFAULTS} p
 * @param {{colors?:string[], onStep?:(s:string)=>Promise<void>|void}} [opts]
 */
export async function makeClicker(a, p, opts = {}) {
  const wasm = await getEngine();
  const { CrossSection } = wasm;
  const d = derive(p);
  const tf = pxTransform(a.seg.bounds, p.size);
  const step = async (s) => opts.onStep && (await opts.onStep(s));
  const maxSize = Math.max(p.size, p.bed - 8);

  let scope = null;
  try {
    // --- la « taille » désigne la silhouette finale (après filtres et pièces écartées) ----
    await step('outline');
    let k = 1;
    {
      const probe = new Scope();
      try {
        const b = shellOutline(wasm, probe, toMm(a.loops, tf, 1), p).cs.bounds();
        const eff = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
        if (eff > 1 && Math.abs(eff - p.size) / p.size > 0.005) k = p.size / eff;
      } finally {
        probe.dispose();
      }
    }
    const k0 = k;

    // --- agrandissement automatique jusqu'à ce que le switch rentre -----------------------
    let S = null, cap = null, placement = null, dropped = 0, capPolys = null;
    for (let iter = 0; iter < 24; iter++) {
      scope = new Scope();
      const polys = toMm(a.loops, tf, k);
      const so = shellOutline(wasm, scope, polys, p);
      S = so.cs;
      dropped = so.dropped;
      const capAll = capOutline(wasm, scope, S, d);
      capPolys = capAll.toPolygons();
      const angles = p.placementAngle == null ? undefined : [((p.placementAngle % 90) + 90) % 90];
      placement = capPolys.length ? findPlacement(capPolys, d.capKeepOut, { angles }) : null;
      if (placement) { cap = componentAt(wasm, scope, capAll, placement.x, placement.y); break; }
      scope.dispose();
      scope = null;
      if (!p.autoGrow) {
        throw new PipelineError('nofit', 'Le switch ne rentre pas dans cette forme à cette taille.', { size: p.size * (k / k0) });
      }
      k *= 1.06;
      if (p.size * (k / k0) > maxSize * 1.6) break;
    }
    if (!placement) throw new PipelineError('nofit', 'La forme est trop fine pour loger un switch.', { size: p.size * (k / k0) });
    const finalSize = p.size * (k / k0);
    const grown = k / k0 > 1.001;
    const warnings = [];
    if (grown) warnings.push({ code: 'grown', size: finalSize });
    if (finalSize > maxSize) warnings.push({ code: 'toobig', size: finalSize, bed: p.bed });
    if (dropped) warnings.push({ code: 'dropped', count: dropped });

    // --- décor : une région par couleur (hors couleur de base), disjointes ----------------
    await step('art');
    const T = (x) => scope.add(x);
    const art = [];
    let taken = null;
    const r = p.minArt / 2;
    for (let i = 1; i < a.quant.colors.length; i++) {
      const polys = toMm(a.artLoops[i], tf, k);
      if (!polys.length) continue;
      let cs = T(CrossSection.ofPolygons(polys, 'EvenOdd'));
      cs = T(cs.intersect(cap));
      if (taken) cs = T(cs.subtract(taken));
      if (r > 0.01) cs = T(T(cs.offset(-r, 'Round', 2, SEG)).offset(r, 'Round', 2, SEG));
      if (cs.isEmpty() || cs.area() < Math.max(0.5, p.minArt * p.minArt)) continue;
      taken = taken ? T(taken.add(cs)) : cs;
      art.push({ index: i, cs });
    }

    // --- 3D ----------------------------------------------------------------------------------
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
      art: art.map((x) => ({ index: x.index, polys: x.cs.toPolygons() })),
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
      outline: { w: b.max[0] - b.min[0], h: b.max[1] - b.min[1] },
      warnings,
    };
  } finally {
    scope?.dispose();
  }
}
