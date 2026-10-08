// Affectation des couleurs aux filaments : deux pièces de même couleur partagent le même filament.

/**
 * @param {string} shellColor couleur de la coque
 * @param {string} baseColor couleur du corps du capuchon
 * @param {Record<number,string>} artColors couleurs des décors réellement présents (index de couleur -> #rrggbb)
 * @returns {{filaments:{color:string,name:string}[], slots:{shell:number, cap:number, art:Record<number,number>}}}
 */
export function assignFilaments(shellColor, baseColor, artColors = {}) {
  const filaments = [];
  const slotOf = (color) => {
    const c = color.toLowerCase();
    let i = filaments.findIndex((f) => f.color === c);
    if (i < 0) {
      i = filaments.length;
      filaments.push({ color: c, name: c });
    }
    return i;
  };
  const shell = slotOf(shellColor);
  const cap = slotOf(baseColor);
  const art = {};
  for (const [index, color] of Object.entries(artColors)) art[index] = slotOf(color);
  return { filaments, slots: { shell, cap, art } };
}
