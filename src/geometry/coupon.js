// Banc d'essai de calibration : une petite impression (~25 min) pour choisir les bons réglages
// AVANT d'imprimer un vrai clicker.
//
//  - une plaque de 4 mm avec 4 logements carrés, de plus en plus larges (à essayer avec le switch) ;
//  - une platine avec 4 fourreaux à croix, de plus en plus larges (à essayer sur la tige du switch).
//
// Les écarts sont relatifs aux réglages en cours : après avoir choisi, réglez « Logement du switch »
// et « Serrage de la croix » sur l'écart retenu, puis refaites un banc si besoin.

import { MECH, SWITCH } from '../core/params.js';
import { toMesh } from './engine.js';

/** Écarts testés (mm) par rapport au réglage courant, du plus serré au plus lâche. */
export const COUPON_STEPS = [-0.1, 0, 0.1, 0.2];

/**
 * @param {{Manifold:any, CrossSection:any}} wasm
 * @param {{add:(o:any)=>any}} scope
 * @param {import('../core/params.js').DEFAULTS} p
 * @returns {{manifold:any, info:{steps:number[], pockets:number[], sockets:number[], size:{w:number,h:number}}}}
 */
export function buildCoupon(wasm, scope, p) {
  const { Manifold, CrossSection } = wasm;
  const T = (x) => scope.add(x);
  const n = COUPON_STEPS.length;

  // ---- A : plaque des logements -------------------------------------------------------
  const pitchA = SWITCH.lowerBody + 5; // 19 mm entre deux logements
  const wA = n * pitchA + 3, hA = pitchA;
  const thickA = MECH.collarH;
  const xA = (i) => (i - (n - 1) / 2) * pitchA;
  let plate = T(T(CrossSection.square([wA, hA], true)).extrude(thickA));
  const pockets = COUPON_STEPS.map((s) => SWITCH.lowerBody + p.pocketFit + s);
  pockets.forEach((side, i) => {
    const hole = T(T(T(CrossSection.square([side, side], true)).extrude(thickA + 0.2)).translate(xA(i), 0, -0.1));
    plate = T(plate.subtract(hole));
  });
  // repères : i + 1 plots sur le bord du haut, devant chaque logement
  const dots = [];
  COUPON_STEPS.forEach((_, i) => {
    for (let k = 0; k <= i; k++) {
      const x = xA(i) + (k - i / 2) * 2.4;
      dots.push(T(T(Manifold.cylinder(0.6, 0.8, 0.8, 24)).translate(x, hA / 2 - 1.4, thickA)));
    }
  });
  plate = T(Manifold.union([plate, ...dots]));
  plate = T(plate.translate(0, hA / 2 + 6, 0));

  // ---- B : platine des croix ------------------------------------------------------------
  const pitchB = 15;
  const wB = n * pitchB + 3, hB = pitchB;
  const baseH = 1.6;
  const bossH = 3.6; // longueur du fourreau du capuchon
  const depth = MECH.socketDepth;
  const xB = (i) => (i - (n - 1) / 2) * pitchB;
  let board = T(T(CrossSection.square([wB, hB], true)).extrude(baseH));
  const bossR = p.bossDiameter / 2;
  const sockets = COUPON_STEPS.map((s) => MECH.crossArm + p.socketFit + s);
  const bosses = COUPON_STEPS.map((_, i) => T(T(Manifold.cylinder(bossH + 0.1, bossR, bossR, 64)).translate(xB(i), 0, baseH - 0.1)));
  board = T(Manifold.union([board, ...bosses]));
  sockets.forEach((arm, i) => {
    const span = MECH.crossSpan + p.socketFit + COUPON_STEPS[i];
    const a = T(CrossSection.square([span, arm], true));
    const b = T(CrossSection.square([arm, span], true));
    const cross = T(a.add(b));
    const cut = T(T(T(cross.extrude(depth + 0.1)).translate(xB(i), 0, baseH + bossH - depth)));
    board = T(board.subtract(cut));
  });
  board = T(board.translate(0, -(hB / 2 + 6), 0));

  const manifold = T(Manifold.compose([plate, board]));
  return {
    manifold,
    info: { steps: COUPON_STEPS, pockets, sockets, size: { w: Math.max(wA, wB), h: hA + hB + 12 } },
  };
}

export function couponToMesh(res) {
  return toMesh(res.manifold);
}
