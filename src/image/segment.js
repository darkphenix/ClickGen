// Image -> silhouette : champ d'« avant-plan » doux (0..1) dont le contour à 0,5 est la forme.

import {
  blur,
  connectedComponents,
  floodOutside,
  maskBounds,
  rgbToLab,
} from './raster.js';

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} img RGBA
 * @param {{maskMode?:'auto'|'alpha'|'color', tolerance?:number, invert?:boolean, fillHoles?:boolean}} opts
 * @returns {{w:number,h:number,field:Float32Array,solid:Uint8Array,bounds:{x0:number,y0:number,x1:number,y1:number}|null,mode:string,bg:number[]|null}}
 */
export function segmentImage(img, opts = {}) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const tol = opts.tolerance ?? 14;
  const fillHoles = opts.fillHoles ?? true;

  let transparent = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 250) transparent++;
  let mode = opts.maskMode ?? 'auto';
  if (mode === 'auto') mode = transparent / n > 0.005 ? 'alpha' : 'color';

  const fg = new Float32Array(n);
  let bg = null;
  if (mode === 'alpha') {
    for (let i = 0; i < n; i++) fg[i] = data[i * 4 + 3] / 255;
  } else {
    bg = estimateBackground(data, w, h);
    const lab = [0, 0, 0];
    const ramp = Math.max(3, tol * 0.6);
    for (let i = 0; i < n; i++) {
      const a = data[i * 4 + 3] / 255;
      // composition sur blanc pour les pixels semi-transparents
      const r = Math.round(data[i * 4] * a + 255 * (1 - a));
      const g = Math.round(data[i * 4 + 1] * a + 255 * (1 - a));
      const b = Math.round(data[i * 4 + 2] * a + 255 * (1 - a));
      rgbToLab(r, g, b, lab, 0);
      const dL = lab[0] - bg[0], dA = lab[1] - bg[1], dB = lab[2] - bg[2];
      const dist = Math.sqrt(dL * dL + dA * dA + dB * dB);
      fg[i] = Math.min(1, Math.max(0, (dist - tol) / ramp + 0.5));
    }
  }
  if (opts.invert) for (let i = 0; i < n; i++) fg[i] = 1 - fg[i];

  // pixels pleins, puis remplissage des trous (fond non relié au bord)
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = fg[i] >= 0.5 ? 1 : 0;
  const outside = floodOutside(solid, w, h);
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) filled[i] = outside[i] ? 0 : 1;

  // supprime les poussières (composantes minuscules)
  const { labels, areas } = connectedComponents(filled, w, h);
  const minPx = Math.max(12, Math.round(n * 0.00005));
  for (let i = 0; i < n; i++) if (filled[i] && areas[labels[i]] < minPx) filled[i] = 0;

  const field = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!filled[i]) field[i] = 0;
    else if (fillHoles) field[i] = solid[i] ? Math.max(fg[i], 0.5) : 1;
    else field[i] = solid[i] ? fg[i] : 0;
  }
  // les pixels de bord doux gardent leur valeur (anticrénelage) : on ne les écrase pas
  for (let i = 0; i < n; i++) {
    if (!filled[i] && fg[i] > 0 && fg[i] < 0.5 && nearFilled(filled, i, w, h)) field[i] = fg[i];
  }
  blur(field, w, h, 0.8);
  const bounds = maskBounds(field.map((v) => (v >= 0.5 ? 1 : 0)), w, h);
  return { w, h, field, solid: filled, bounds, mode, bg };
}

function nearFilled(filled, i, w, h) {
  const x = i % w, y = (i / w) | 0;
  if (x > 0 && filled[i - 1]) return true;
  if (x < w - 1 && filled[i + 1]) return true;
  if (y > 0 && filled[i - w]) return true;
  if (y < h - 1 && filled[i + w]) return true;
  return false;
}

/** Couleur de fond = médiane (Lab) d'un anneau de pixels au bord de l'image. */
export function estimateBackground(data, w, h) {
  const ring = Math.max(1, Math.min(3, Math.floor(Math.min(w, h) / 50)));
  const Ls = [], As = [], Bs = [];
  const lab = [0, 0, 0];
  const take = (x, y) => {
    const i = (y * w + x) * 4;
    const a = data[i + 3] / 255;
    rgbToLab(
      Math.round(data[i] * a + 255 * (1 - a)),
      Math.round(data[i + 1] * a + 255 * (1 - a)),
      Math.round(data[i + 2] * a + 255 * (1 - a)),
      lab,
      0,
    );
    Ls.push(lab[0]); As.push(lab[1]); Bs.push(lab[2]);
  };
  for (let r = 0; r < ring; r++) {
    for (let x = 0; x < w; x++) { take(x, r); take(x, h - 1 - r); }
    for (let y = ring; y < h - ring; y++) { take(r, y); take(w - 1 - r, y); }
  }
  const med = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
  return [med(Ls), med(As), med(Bs)];
}
