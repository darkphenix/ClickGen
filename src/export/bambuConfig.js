// Réglages projet Bambu Studio : on part d'un project_settings.config complet (A1 mini 0.4 mm,
// enregistré par Bambu Studio) et on l'adapte au nombre de filaments voulu.
//
// Pourquoi : sans ce fichier, Bambu Studio ignore les numéros de filament des volumes et
// retombe sur 1 seul filament. Avec lui, chaque volume garde son filament et ses couleurs.

/**
 * @param {Record<string, any>} template contenu de templates/bambu-a1mini.json
 * @param {string[]} colors couleurs des filaments (#rrggbb), une par filament utilisé
 * @param {{supports?:boolean, tower?:{x:number,y:number}|null, layerHeight?:number}} [opts]
 */
export function bambuProjectSettings(template, colors, opts = {}) {
  const cfg = structuredClone(template);
  const n = colors.length;
  const n0 = cfg.filament_colour.length;
  const proto = n0 > 2 ? 2 : 0; // filament de référence : « Bambu PLA Basic » dans le gabarit

  // tous les vecteurs « un élément par filament » sont recopiés depuis le filament de référence
  for (const [key, value] of Object.entries(cfg)) {
    if (Array.isArray(value) && value.length === n0) cfg[key] = Array.from({ length: n }, () => value[proto]);
  }
  const hex = colors.map((c) => c.toUpperCase());
  cfg.filament_colour = hex;
  cfg.filament_multi_colour = [...hex];
  cfg.default_filament_colour = Array.from({ length: n }, () => '');
  cfg.filament_self_index = Array.from({ length: n }, (_, i) => String(i + 1));
  cfg.filament_map = Array.from({ length: n }, () => '1');
  cfg.filament_colour_type = Array.from({ length: n }, () => '1');

  // volumes de purge entre filaments (matrice n x n, 280 mm³ hors diagonale) et vecteur 2n
  cfg.flush_volumes_matrix = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cfg.flush_volumes_matrix.push(i === j ? '0' : '280');
  cfg.flush_volumes_vector = Array.from({ length: 2 * n }, () => '140');

  // projet « propre » : aucun réglage marqué comme modifié par rapport aux préréglages système
  cfg.different_settings_to_system = Array.from({ length: n + 2 }, () => '');
  cfg.enable_support = opts.supports ? '1' : '0';
  cfg.support_type = 'tree(auto)';
  cfg.support_style = 'default';
  // hauteur de couche : on garde la même épaisseur de peaux haut et bas (≈ 1,0 et 0,6 mm)
  if (opts.layerHeight) {
    const h = opts.layerHeight;
    cfg.layer_height = String(h);
    cfg.top_shell_layers = String(Math.max(3, Math.ceil(0.96 / h)));
    cfg.bottom_shell_layers = String(Math.max(3, Math.ceil(0.6 / h)));
  }
  // tour de purge : un seul plateau -> une seule position (coin inférieur gauche de la tour)
  if (opts.tower) {
    cfg.wipe_tower_x = [String(+opts.tower.x.toFixed(3))];
    cfg.wipe_tower_y = [String(+opts.tower.y.toFixed(3))];
  }
  return cfg;
}

/** Charge le gabarit (fetch dans le navigateur, lecture de fichier sous Node). */
export async function loadBambuTemplate() {
  const url = new URL('./templates/bambu-a1mini.json', import.meta.url);
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`gabarit Bambu introuvable (${res.status})`);
    return res.json();
  }
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(url, 'utf8'));
}
