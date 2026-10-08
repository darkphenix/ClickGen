// Chargement d'une image (fichier, URL, presse-papiers) -> pixels RGBA réduits (navigateur uniquement).

const MAX_SIDE = 800; // assez fin : 60 mm sur 800 px = 0,075 mm par pixel

/**
 * @param {Blob|string} source fichier/blob ou URL
 * @returns {Promise<{width:number,height:number,data:Uint8ClampedArray,name:string,previewUrl:string}>}
 */
export async function loadImage(source, name = 'image') {
  let blob = source;
  if (typeof source === 'string') {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Image introuvable (${res.status})`);
    blob = await res.blob();
    if (!name || name === 'image') name = source.startsWith('data:') ? 'image' : source.split('/').pop();
  } else if (source.name) {
    name = source.name;
  }
  const isSvg = blob.type === 'image/svg+xml' || /\.svg$/i.test(name);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    if (isSvg) {
      // les SVG sans taille intrinsèque n'ont pas de dimensions : on lit le viewBox
      const text = await blob.text();
      const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(text);
      const [, , vw, vh] = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 512, 512];
      const k = MAX_SIDE / Math.max(vw, vh);
      img.width = Math.round(vw * k);
      img.height = Math.round(vh * k);
    }
    img.src = url;
    await img.decode();
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (isSvg) { w = img.width; h = img.height; }
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cw, ch);
    const { data } = ctx.getImageData(0, 0, cw, ch);
    const previewUrl = canvas.toDataURL('image/png');
    return { width: cw, height: ch, data, name, previewUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}
