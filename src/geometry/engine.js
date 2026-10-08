// Chargement de manifold-3d (WASM) + suivi des objets à libérer.
// Même fichier en navigateur et sous Node : manifold.js localise manifold.wasm via import.meta.url.

import Module from '../../vendor/manifold/manifold.js';

let ready = null;

/** @returns {Promise<{Manifold: any, CrossSection: any}>} */
export function getEngine() {
  ready ??= Module().then((wasm) => {
    wasm.setup();
    return wasm;
  });
  return ready;
}

/**
 * Les objets manifold vivent dans la mémoire WASM : il faut les libérer à la main.
 * Tout ce qui est créé via `scope.add()` est détruit par `scope.dispose()`.
 */
export class Scope {
  constructor() {
    this.items = [];
  }

  add(obj) {
    this.items.push(obj);
    return obj;
  }

  dispose() {
    for (const o of this.items) {
      try {
        o.delete();
      } catch {
        /* déjà libéré */
      }
    }
    this.items.length = 0;
  }
}

/**
 * Copie un Manifold en tableaux typés indépendants de la mémoire WASM.
 * Les sommets dupliqués par manifold (mergeFromVert -> mergeToVert) sont refusionnés, les triangles
 * dégénérés retirés et les sommets inutilisés compactés : le maillage exporté est un vrai 2-manifold.
 */
export function toMesh(manifold) {
  const m = manifold.getMesh();
  const np = m.numProp;
  const n = m.vertProperties.length / np;
  const remap = new Uint32Array(n);
  for (let i = 0; i < n; i++) remap[i] = i;
  const from = m.mergeFromVert, to = m.mergeToVert;
  if (from && from.length) for (let k = 0; k < from.length; k++) remap[from[k]] = to[k];
  // les cibles de fusion peuvent elles-mêmes être fusionnées : on suit la chaîne
  for (let i = 0; i < n; i++) { let r = remap[i]; while (remap[r] !== r) r = remap[r]; remap[i] = r; }

  const tri = m.triVerts;
  const kept = [];
  const used = new Int32Array(n).fill(-1);
  let nv = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const a = remap[tri[t]], b = remap[tri[t + 1]], c = remap[tri[t + 2]];
    if (a === b || b === c || a === c) continue; // triangle dégénéré
    for (const v of [a, b, c]) if (used[v] < 0) used[v] = nv++;
    kept.push(used[a], used[b], used[c]);
  }
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < n; i++) {
    const j = used[i];
    if (j < 0) continue;
    positions[j * 3] = m.vertProperties[i * np];
    positions[j * 3 + 1] = m.vertProperties[i * np + 1];
    positions[j * 3 + 2] = m.vertProperties[i * np + 2];
  }
  return { positions, indices: Uint32Array.from(kept) };
}
