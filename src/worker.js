// Calculs lourds hors du fil principal : l'interface reste fluide pendant que la géométrie se refait.
// Protocole :
//   -> {type:'image', id, width, height, buffer}   définit l'image source (buffer RGBA transféré)
//   -> {type:'run', id, params}                    (re)calcule ; seules les dernières demandes comptent
//   -> {type:'coupon', id, params}                 banc d'essai de calibration
//   <- {type:'result', id, analysis, result}       ou {type:'error', id, code, message, extra}
//   <- {type:'coupon', id, mesh, info}
//   <- {type:'progress', id, step}                 signe de vie pendant un calcul long

import { PipelineError, analyzeImage, errorText, isFramed, makeClicker } from './pipeline.js';
import { Scope, getEngine } from './geometry/engine.js';
import { buildCoupon, couponToMesh } from './geometry/coupon.js';

let img = null;
let imgVersion = 0;
let cache = { key: '', value: null };
const buildCache = {}; // maillages de la coque et du capuchon déjà construits (voir pipeline.js)
let pending = null;
let running = false;

// réglages qui obligent à refaire la segmentation et les couleurs (le cadre choisi, lui, non)
const MASK_KEYS = ['maskMode', 'tolerance', 'invert', 'fillHoles', 'colorCount', 'frameContent', 'bgColor'];

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'image') {
    img = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.buffer) };
    imgVersion++;
    cache = { key: '', value: null };
    self.postMessage({ type: 'imageReady', id: m.id });
  } else if (m.type === 'run') {
    pending = m; // une demande plus récente remplace celle qui attend
    if (!running) setTimeout(drain, 0);
  } else if (m.type === 'coupon') {
    runCoupon(m);
  }
};

async function runCoupon(m) {
  const sc = new Scope();
  try {
    const res = buildCoupon(await getEngine(), sc, m.params);
    const mesh = couponToMesh(res);
    self.postMessage({ type: 'coupon', id: m.id, mesh, info: res.info }, [mesh.positions.buffer, mesh.indices.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, code: 'internal', message: errorText(err), extra: {}, stack: String(err?.stack ?? '') });
  } finally {
    sc.dispose();
  }
}

async function drain() {
  if (running || !pending) return;
  running = true;
  const job = pending;
  pending = null;
  try {
    if (!img) throw new PipelineError('empty', 'Aucune image chargée.');
    const p = job.params;
    const key = `${imgVersion}|${MASK_KEYS.map((k) => String(p[k])).join('|')}|${isFramed(p) ? 'frame' : 'outline'}`;
    // signes de vie : la page tue et relance le worker s'il reste muet trop longtemps (voir runner.js)
    const alive = (step) => self.postMessage({ type: 'progress', id: job.id, step });
    if (cache.key !== key) { alive('analyze'); cache = { key, value: analyzeImage(img, p) }; }
    const a = cache.value;
    const result = await makeClicker(a, p, { cache: buildCache, onStep: alive });
    // les maillages en cache restent ici : on envoie des copies (transférer les tampons les viderait)
    const transfer = [];
    const send = (item) => {
      const mesh = { positions: item.mesh.positions.slice(), indices: item.mesh.indices.slice() };
      transfer.push(mesh.positions.buffer, mesh.indices.buffer);
      return { ...item, mesh };
    };
    result.meshes = {
      ...result.meshes,
      shell: send(result.meshes.shell),
      capBody: send(result.meshes.capBody),
      arts: result.meshes.arts.map(send),
    };
    self.postMessage({
      type: 'result',
      id: job.id,
      analysis: {
        width: a.width,
        height: a.height,
        loops: a.loops,
        bounds: a.seg.bounds,
        mode: a.seg.mode,
        colors: a.quant.colors,
      },
      result,
    }, transfer);
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: job.id,
      code: err instanceof PipelineError ? err.code : 'internal',
      message: errorText(err),
      extra: err instanceof PipelineError ? err.extra : {},
      stack: String(err?.stack ?? ''),
    });
  } finally {
    running = false;
    if (pending) setTimeout(drain, 0);
  }
}
