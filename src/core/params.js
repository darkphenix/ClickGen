// Paramètres par défaut du générateur + cotes dérivées.
//
// Les cotes du switch viennent du datasheet Cherry MX (boîtier 15,6 mm, hauteur 11,6 mm,
// tige +3,6 mm, pattes 3,3 mm, bride à 5,0 mm du fond, course 4,0 mm). Les cotes de la
// coque/capuchon (paroi 2 mm, jeu ~0,6 mm, logement 14,0 mm, croix 4,13 x 1,12 mm) sont
// celles qui ont fait leurs preuves sur des clickers imprimés en FDM 0,4 mm.

/** Cotes d'un switch compatible Cherry MX (mm). */
export const SWITCH = Object.freeze({
  flange: 15.6, // largeur de la bride / boîtier haut
  lowerBody: 14.0, // largeur du boîtier bas (trou de plaque standard)
  seatToFlange: 5.0, // fond du switch -> dessous de la bride
  housingTop: 11.6, // fond du switch -> dessus du boîtier haut
  stemAbove: 3.6, // dépassement de la tige au-dessus du boîtier
  travel: 4.0, // course totale
  pinLength: 3.3, // pattes sous le boîtier
});

export const DEFAULTS = Object.freeze({
  // --- Forme -------------------------------------------------------------
  size: 60, // plus grande dimension de la coque (mm)
  autoGrow: true, // agrandir automatiquement si le switch ne rentre pas
  maskMode: 'auto', // auto | alpha | color
  tolerance: 14, // écart de couleur (ΔE Lab) pour détecter le fond
  invert: false,
  fillHoles: true,
  keepMain: true, // ne garder que la plus grande pièce
  closeGap: 0.6, // comble les fentes plus étroites que ça (mm)
  minDetail: 1.2, // supprime les détails plus fins que ça (mm)
  smooth: 0.5, // lissage du contour (mm)

  // --- Cadre (à la place du contour de l'image) -------------------------------
  frame: 'image', // image | circle | squircle | roundrect | hexagon | octagon | shield | pill
  frameContent: 'auto', // auto | subject (sujet détouré) | full (image entière)
  frameZoom: 1, // taille du motif dans le cadre
  bgColor: null, // fond choisi à la pipette (#rrggbb) ; null = détecté sur les bords

  // --- Couleurs ----------------------------------------------------------
  colorCount: 3, // couleurs d'image (1 = capuchon uni)
  artDepth: 0.8, // épaisseur de la couche de décor (mm)
  relief: 0, // décor en saillie au-dessus du capuchon (mm)
  minArt: 0.6, // plus petit détail de décor imprimable (mm)

  // --- Mécanique ---------------------------------------------------------
  wall: 2.0, // paroi de la coque (mm)
  clearance: 0.6, // jeu capuchon/coque par côté (mm)
  pocketFit: 0, // correction du logement 14,0 mm (mm, + = plus lâche)
  socketFit: 0, // correction de la croix de la tige (mm, + = plus lâche)
  bossDiameter: 5.9, // diamètre extérieur du fourreau de la croix
  pinStyle: 'void', // void = une cavité tolérante | holes = trous exacts
  chamfer: 0.5, // chanfrein du bord imprimé en premier (mm)
  keyring: false, // anneau porte-clés
  keyringAngle: 90, // position de l'anneau sur le contour (degrés)

  placementAngle: null, // angle imposé du switch (degrés) ; null = automatique
  placementX: null, // position imposée du switch (mm, repère de la coque) ; null = automatique
  placementY: null,

  // --- Impression --------------------------------------------------------
  bed: 180, // plateau carré (mm) : A1 mini = 180, A1/P1/X1 = 256
  layerHeight: 0.16, // mm, appliqué au 3MF (0,12 / 0,16 / 0,20 / 0,28)
  plates: 2, // 2 = coque puis capuchon sur deux plateaux (moins de changements de filament) ; 1 = tout ensemble
});

/** Broches d'un switch MX vu de dessus (mm, par rapport au centre) : plot, ergots, pattes. */
export const PIN_HOLES = Object.freeze([
  { x: 0, y: 0, d: 4.2 }, // plot central
  { x: -5.08, y: 0, d: 1.9 }, // ergots plastique
  { x: 5.08, y: 0, d: 1.9 },
  { x: -3.81, y: 2.54, d: 1.7 }, // pattes
  { x: 2.54, y: 5.08, d: 1.7 },
]);

/** Constantes mécaniques internes (pas exposées dans l'UI). */
export const MECH = Object.freeze({
  floorSkin: 1.2, // fond plein sous les cavités à pattes
  collarH: 4.0, // hauteur des parois du logement 14 mm
  capH: 6.2, // hauteur minimale du capuchon (plancher : la hauteur réelle dépend du relief et du décor)
  travelMargin: 0.2, // jeu entre le plafond du relief et le dessus du boîtier, au fond de la course
  mouthRecess: 1.0, // le fourreau est en retrait du bord du capuchon
  socketDepth: 3.85, // profondeur de la croix
  capPocketRim: 14.8, // relief sous le capuchon : côté bord
  capPocketCeil: 11.8, // relief sous le capuchon : côté plafond
  crossSpan: 4.13, // envergure de la croix
  crossArm: 1.12, // épaisseur des branches
  topMargin: 0.2, // le capuchon enfoncé affleure juste sous le haut de la coque
  minCapWall: 1.2, // paroi mini du capuchon autour de son relief
  minCapFeature: 1.2, // plus petit détail du capuchon (mm)
  voidSize: 12.4, // cavité tolérante sous le switch (diamètre)
});

/**
 * Cotes dérivées (toutes en mm, repère : fond de la coque = 0, capuchon au repos).
 * @param {typeof DEFAULTS} p
 */
export function derive(p) {
  const s = SWITCH;
  const m = MECH;
  const pinDepth = s.pinLength + 0.5;
  const seat = m.floorSkin + pinDepth; // hauteur du fond du switch
  const cavityFloor = seat + m.collarH; // plancher de la cavité du capuchon
  const pocketDepth = m.mouthRecess + m.socketDepth; // profondeur du relief du capuchon
  const stemTop = seat + s.housingTop + s.stemAbove; // sommet de la tige au repos
  const capRim = stemTop - pocketDepth; // bord du capuchon au repos
  // Le plafond du relief (hors fourreau) descend avec le capuchon : il ne doit pas toucher le dessus du
  // boîtier avant la fin de la course. Au repos la tige dépasse de 3,6 mm du boîtier mais la course est de
  // 4,0 mm ; sans cette marge le capuchon butait à 3,6 mm. Seul le fourreau (la croix) descend plus bas.
  const reliefDepth = pocketDepth + Math.max(0, s.travel - s.stemAbove) + m.travelMargin;
  const capH = Math.max(m.capH, reliefDepth + p.artDepth + 0.55);
  const shellH = capRim - s.travel + capH + m.topMargin;
  const pocket = s.lowerBody + p.pocketFit;
  return {
    pinDepth,
    seat,
    cavityFloor,
    pocketDepth,
    reliefDepth,
    stemTop,
    capRim,
    capH,
    capTopRest: capRim + capH,
    shellH,
    pocket,
    capKeepOut: m.capPocketRim + 2 * m.minCapWall,
    capOffset: p.wall + p.clearance,
  };
}
