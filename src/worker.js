// Calculs lourds hors du fil principal : l'interface reste fluide pendant que la géométrie se refait.
// Protocole :
//   -> {type:'image', id, width, height, buffer}   définit l'image source (buffer RGBA transféré)
//   -> {type:'run', id, params}                    (re)calcule ; seules les dernières demandes comptent
//   <- {type:'result', id, analysis, result}       ou {type:'error', id, code, message, extra}

import { PipelineError, analyzeImage, makeClicker } from './pipeline.js';

let img = null;
let imgVersion = 0;
let cache = { key: '', value: null };
let pending = null;
let running = false;

const MASK_KEYS = ['maskMode', 'tolerance', 'invert', 'fillHoles', 'colorCount'];

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
  }
};

async function drain() {
  if (running || !pending) return;
  running = true;
  const job = pending;
  pending = null;
  try {
    if (!img) throw new PipelineError('empty', 'Aucune image chargée.');
    const p = job.params;
    const key = imgVersion + '|' + MASK_KEYS.map((k) => String(p[k])).join('|');
    if (cache.key !== key) cache = { key, value: analyzeImage(img, p) };
    const a = cache.value;
    const result = await makeClicker(a, p);
    const transfer = [];
    const take = (mesh) => { transfer.push(mesh.positions.buffer, mesh.indices.buffer); };
    take(result.meshes.shell.mesh);
    take(result.meshes.capBody.mesh);
    for (const art of result.meshes.arts) take(art.mesh);
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
      message: err.message,
      extra: err instanceof PipelineError ? { size: err.size } : {},
      stack: String(err.stack ?? ''),
    });
  } finally {
    running = false;
    if (pending) setTimeout(drain, 0);
  }
}
