// Chargement d'une image (fichier, URL, presse-papiers) -> pixels RGBA réduits (navigateur uniquement).

const MAX_SIDE = 800; // assez fin : 60 mm sur 800 px = 0,075 mm par pixel
const MAX_BYTES = 40 * 1024 * 1024; // au-delà, le décodage risque de saturer la mémoire de l'onglet

/**
 * Dimensions utiles d'un SVG : viewBox de la balise racine, sinon width/height, sinon 512 x 512.
 * On ne regarde que la balise <svg> ouvrante : un viewBox dans un commentaire, un <symbol> ou un <marker>
 * ne doit pas compter, et une valeur nulle ou illisible ne doit pas donner des dimensions NaN.
 * @returns {[number, number]}
 */
export function svgSize(text) {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
  const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
  const ok = (n) => Number.isFinite(n) && n > 0;
  const vb = attr('viewBox');
  if (vb) {
    const [, , w, h] = vb.trim().split(/[\s,]+/).map(Number);
    if (ok(w) && ok(h)) return [w, h];
  }
  const w = parseFloat(attr('width')), h = parseFloat(attr('height'));
  return ok(w) && ok(h) ? [w, h] : [512, 512];
}

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
  if (blob.size > MAX_BYTES) {
    throw new Error(`Fichier trop lourd (${(blob.size / 1048576).toFixed(0)} Mo, maximum ${MAX_BYTES / 1048576} Mo).`);
  }
  const isSvg = blob.type === 'image/svg+xml' || /\.svg$/i.test(name);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    if (isSvg) {
      // les SVG sans taille intrinsèque n'ont pas de dimensions : on les déduit du viewBox
      const [vw, vh] = svgSize(await blob.text());
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
