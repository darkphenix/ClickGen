// Texte (et emojis) -> image RGBA sur fond transparent, pour personnaliser un clicker avec un prénom.
// Navigateur uniquement (canvas 2D). L'image obtenue suit ensuite le même chemin qu'une image importée.

const MAX_SIDE = 800;

export const FONTS = {
  condensed: { css: '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif', weight: 700 },
  sans: { css: '"IBM Plex Sans", system-ui, sans-serif', weight: 700 },
  rounded: { css: 'ui-rounded, "Arial Rounded MT Bold", "Varela Round", system-ui, sans-serif', weight: 800 },
  serif: { css: 'Georgia, "Times New Roman", serif', weight: 700 },
  mono: { css: 'ui-monospace, Consolas, "Courier New", monospace', weight: 700 },
  script: { css: '"Brush Script MT", "Segoe Script", "Comic Sans MS", cursive', weight: 700 },
};
export const FONT_KEYS = Object.keys(FONTS);

/**
 * @param {{text:string, font?:keyof typeof FONTS, color?:string}} o
 * @returns {Promise<{width:number,height:number,data:Uint8ClampedArray,name:string,previewUrl:string}|null>}
 */
export async function renderText({ text, font = 'condensed', color = '#ffffff' }) {
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(0, 3);
  if (!lines.length) return null;
  const f = FONTS[font] ?? FONTS.condensed;
  try { await document.fonts.load(`${f.weight} 100px ${f.css}`); } catch { /* police système : rien à charger */ }

  const size = 240;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `${f.weight} ${size}px ${f.css}`;
  const metrics = lines.map((l) => probe.measureText(l));
  const lineH = size * 1.08;
  const pad = size * 0.14; // marge pour les jambages et les empattements qui débordent
  const w = Math.ceil(Math.max(...metrics.map((m) => m.width)) + 2 * pad);
  const h = Math.ceil(lineH * lines.length + 2 * pad);
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.scale(k, k);
  ctx.font = probe.font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => {
    // ligne de base : on centre verticalement la hauteur de glyphes mesurée sur la ligne
    const m = metrics[i];
    const asc = m.actualBoundingBoxAscent || size * 0.75, desc = m.actualBoundingBoxDescent || size * 0.2;
    const top = pad + i * lineH + (lineH - (asc + desc)) / 2;
    ctx.fillText(l, w / 2, top + asc);
  });
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data, name: 'texte', previewUrl: canvas.toDataURL('image/png') };
}
