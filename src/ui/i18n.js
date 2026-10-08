// Textes de l'interface (français / anglais). Les clés sont référencées par data-i18n dans index.html.

const FR = {
  'app.title': 'ClickGen',
  'app.tagline': 'Votre image devient un clicker à switch mécanique, prêt à imprimer.',
  'nav.source': 'Code source',
  'lang.other': 'EN',
  'lang.label': 'Changer de langue',

  'img.title': 'Image',
  'img.drop': 'Déposez une image ici',
  'img.dropSub': 'ou cliquez pour parcourir. PNG, JPG, WebP, SVG. Vous pouvez aussi la coller.',
  'img.samples': 'Essayer avec',
  'img.sample.cat': 'Chat',
  'img.sample.mushroom': 'Champignon',
  'img.sample.star': 'Étoile',
  'img.sample.ghost': 'Fantôme',
  'img.sample.heart': 'Cœur',
  'img.mode': 'Détourage',
  'img.mode.auto': 'Automatique',
  'img.mode.alpha': 'Transparence',
  'img.mode.color': 'Couleur du fond',
  'img.tolerance': 'Tolérance du fond',
  'img.invert': 'Inverser la forme',
  'img.fillHoles': 'Boucher les trous',
  'img.hint': 'Le contour bleu montre la forme retenue. Un fond transparent ou uni donne le meilleur résultat.',
  'img.loadError': 'Impossible de lire ce fichier : {message}',

  'shape.title': 'Forme',
  'shape.size': 'Taille de la coque',
  'shape.autoGrow': 'Agrandir si le switch ne rentre pas',
  'shape.keepMain': 'Garder la plus grande pièce seulement',
  'shape.smooth': 'Lissage du contour',
  'shape.minDetail': 'Détail minimum',
  'shape.closeGap': 'Combler les fentes',

  'col.title': 'Couleurs',
  'col.count': 'Couleurs de l’image',
  'col.shell': 'Coque',
  'col.base': 'Capuchon',
  'col.decor': 'Décor {n}',
  'col.depth': 'Épaisseur du décor',
  'col.relief': 'Relief du décor',
  'col.hint': 'Choisissez la couleur de votre filament. Deux pièces de même couleur partagent le même filament.',

  'fit.title': 'Ajustements',
  'fit.wall': 'Paroi de la coque',
  'fit.clearance': 'Jeu capuchon / coque',
  'fit.pocket': 'Logement du switch',
  'fit.socket': 'Serrage de la croix',
  'fit.boss': 'Diamètre du fourreau',
  'fit.pins': 'Dessous du switch',
  'fit.pins.void': 'Cavité tolérante',
  'fit.pins.holes': 'Trous exacts',
  'fit.chamfer': 'Chanfrein de première couche',
  'fit.reset': 'Valeurs par défaut',
  'fit.hint': 'Après un premier essai, corrigez par pas de 0,05 à 0,1 mm : + dilate le logement ou la croix, − les resserre.',

  'print.title': 'Impression',
  'print.printer': 'Imprimante',
  'print.a1mini': 'Bambu Lab A1 mini (180 mm)',
  'print.big': 'Autre Bambu / Orca (256 mm)',
  'print.hint': 'Le .3mf embarque les réglages de l’A1 mini. Sur une autre machine, changez simplement d’imprimante dans le slicer : filaments et pièces sont conservés.',

  'exp.title': 'Exporter',
  'exp.3mf': 'Télécharger le .3mf',
  'exp.stl': 'Pièces en STL (.zip)',
  'exp.3mf.hint': 'Pour Bambu Studio et OrcaSlicer : 2 objets, un filament par couleur.',
  'exp.busy': 'Calcul en cours…',
  'exp.done': 'Fichier créé : {name}',

  'stat.shell': 'Coque',
  'stat.cap': 'Capuchon',
  'stat.height': 'Hauteur',
  'stat.rest': 'au repos',
  'stat.pressed': 'enfoncé',
  'stat.filaments': 'Filaments',
  'stat.mass': 'Matière',
  'stat.switch': 'Switch',
  'stat.massValue': '~{g} g de PLA',

  'view.3d': '3D',
  'view.top': 'Dessus',
  'view.press': 'Presser',
  'view.explode': 'Éclaté',
  'view.switch': 'Switch',
  'view.cut': 'Coupe',
  'view.dims': 'Cotes',
  'view.sound': 'Son',
  'view.reset': 'Recentrer',
  'view.hint': 'Cliquez sur le capuchon ou appuyez sur Espace pour presser.',
  'view.travel': 'course',
  'view.topAngle': 'Angle du switch',
  'view.topAuto': 'Auto',

  'msg.computing': 'Calcul en cours…',
  'msg.empty': 'Aucune forme détectée. Essayez une autre image ou réglez la tolérance du fond.',
  'msg.nofit': 'Le switch ne rentre pas à {size} mm. Agrandissez la forme ou activez l’agrandissement automatique.',
  'msg.geometry': 'La géométrie n’a pas pu être construite : {message}',
  'msg.internal': 'Erreur inattendue : {message}',
  'msg.grown': 'Agrandi à {size} mm pour loger le switch.',
  'msg.toobig': 'Plus grand que le plateau ({size} mm pour {bed} mm). Réduisez la taille ou changez d’imprimante.',
  'msg.dropped': '{count} pièce(s) détachée(s) ignorée(s).',
  'msg.layout': 'Les pièces ne tiennent pas ensemble sur le plateau : placez-les à la main dans le slicer.',
  'msg.workerFail': 'Le calcul 3D n’a pas pu démarrer. Ouvrez la page via un serveur web (pas en file://).',

  'foot.license': 'Libre (MIT). Non affilié à Cherry ni à Bambu Lab. Tout se calcule dans votre navigateur : vos images ne quittent pas votre ordinateur.',
  'sound.on': 'Son activé',
  'sound.off': 'Son coupé',
};

const EN = {
  'app.title': 'ClickGen',
  'app.tagline': 'Turn any image into a print-ready mechanical-switch clicker.',
  'nav.source': 'Source code',
  'lang.other': 'FR',
  'lang.label': 'Switch language',

  'img.title': 'Image',
  'img.drop': 'Drop an image here',
  'img.dropSub': 'or click to browse. PNG, JPG, WebP, SVG. You can also paste one.',
  'img.samples': 'Try with',
  'img.sample.cat': 'Cat',
  'img.sample.mushroom': 'Mushroom',
  'img.sample.star': 'Star',
  'img.sample.ghost': 'Ghost',
  'img.sample.heart': 'Heart',
  'img.mode': 'Cut-out',
  'img.mode.auto': 'Automatic',
  'img.mode.alpha': 'Transparency',
  'img.mode.color': 'Background color',
  'img.tolerance': 'Background tolerance',
  'img.invert': 'Invert shape',
  'img.fillHoles': 'Fill holes',
  'img.hint': 'The blue outline shows the detected shape. A transparent or plain background works best.',
  'img.loadError': 'Could not read this file: {message}',

  'shape.title': 'Shape',
  'shape.size': 'Shell size',
  'shape.autoGrow': 'Grow if the switch does not fit',
  'shape.keepMain': 'Keep the largest piece only',
  'shape.smooth': 'Outline smoothing',
  'shape.minDetail': 'Minimum detail',
  'shape.closeGap': 'Close narrow gaps',

  'col.title': 'Colors',
  'col.count': 'Image colors',
  'col.shell': 'Shell',
  'col.base': 'Cap',
  'col.decor': 'Decor {n}',
  'col.depth': 'Decor thickness',
  'col.relief': 'Decor relief',
  'col.hint': 'Pick the color of your filament. Two parts with the same color share one filament.',

  'fit.title': 'Fit',
  'fit.wall': 'Shell wall',
  'fit.clearance': 'Cap / shell clearance',
  'fit.pocket': 'Switch pocket',
  'fit.socket': 'Cross socket grip',
  'fit.boss': 'Stem sleeve diameter',
  'fit.pins': 'Under the switch',
  'fit.pins.void': 'Tolerant cavity',
  'fit.pins.holes': 'Exact holes',
  'fit.chamfer': 'First-layer chamfer',
  'fit.reset': 'Reset to defaults',
  'fit.hint': 'After a first print, adjust in steps of 0.05 to 0.1 mm: + loosens the pocket or the cross, − tightens it.',

  'print.title': 'Printing',
  'print.printer': 'Printer',
  'print.a1mini': 'Bambu Lab A1 mini (180 mm)',
  'print.big': 'Other Bambu / Orca (256 mm)',
  'print.hint': 'The .3mf carries A1 mini settings. On another machine, just switch printer in the slicer: parts and filaments are kept.',

  'exp.title': 'Export',
  'exp.3mf': 'Download .3mf',
  'exp.stl': 'Parts as STL (.zip)',
  'exp.3mf.hint': 'For Bambu Studio and OrcaSlicer: 2 objects, one filament per color.',
  'exp.busy': 'Working…',
  'exp.done': 'File created: {name}',

  'stat.shell': 'Shell',
  'stat.cap': 'Cap',
  'stat.height': 'Height',
  'stat.rest': 'at rest',
  'stat.pressed': 'pressed',
  'stat.filaments': 'Filaments',
  'stat.mass': 'Material',
  'stat.switch': 'Switch',
  'stat.massValue': '~{g} g of PLA',

  'view.3d': '3D',
  'view.top': 'Top',
  'view.press': 'Press',
  'view.explode': 'Exploded',
  'view.switch': 'Switch',
  'view.cut': 'Cutaway',
  'view.dims': 'Dimensions',
  'view.sound': 'Sound',
  'view.reset': 'Recenter',
  'view.hint': 'Click the cap or hit Space to press it.',
  'view.travel': 'travel',
  'view.topAngle': 'Switch angle',
  'view.topAuto': 'Auto',

  'msg.computing': 'Working…',
  'msg.empty': 'No shape detected. Try another image or tune the background tolerance.',
  'msg.nofit': 'The switch does not fit at {size} mm. Make the shape bigger or enable automatic growth.',
  'msg.geometry': 'The geometry could not be built: {message}',
  'msg.internal': 'Unexpected error: {message}',
  'msg.grown': 'Enlarged to {size} mm to make room for the switch.',
  'msg.toobig': 'Larger than the plate ({size} mm for {bed} mm). Reduce the size or change printer.',
  'msg.dropped': '{count} detached piece(s) ignored.',
  'msg.layout': 'The parts do not fit together on the plate: arrange them by hand in the slicer.',
  'msg.workerFail': 'The 3D engine could not start. Open the page through a web server (not file://).',

  'foot.license': 'Open source (MIT). Not affiliated with Cherry or Bambu Lab. Everything runs in your browser: your images never leave your computer.',
  'sound.on': 'Sound on',
  'sound.off': 'Sound off',
};

const DICTS = { fr: FR, en: EN };
let lang = 'fr';

export function detectLang() {
  try {
    const saved = localStorage.getItem('clickgen.lang');
    if (saved && DICTS[saved]) return saved;
  } catch { /* stockage indisponible */ }
  return (navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function setLang(l) {
  lang = DICTS[l] ? l : 'fr';
  document.documentElement.lang = lang;
  try { localStorage.setItem('clickgen.lang', lang); } catch { /* ignoré */ }
  applyI18n();
}

export function getLang() { return lang; }

/** Traduit une clé, remplace les {variables}. */
export function t(key, vars = {}) {
  const s = DICTS[lang][key] ?? FR[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

/** Applique les traductions au DOM : data-i18n (texte), data-i18n-attr="attr:key;attr2:key2". */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
  document.title = lang === 'fr'
    ? 'ClickGen : clickers 3D imprimables à partir d’une image'
    : 'ClickGen: 3D-printable clickers from any image';
}

/** Formate un nombre avec la décimale de la langue courante. */
export function fmt(n, digits = 1) {
  return n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
