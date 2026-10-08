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

/** Copie un Manifold en tableaux typés indépendants de la mémoire WASM. */
export function toMesh(manifold) {
  const m = manifold.getMesh();
  const np = m.numProp;
  const n = m.vertProperties.length / np;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = m.vertProperties[i * np];
    positions[i * 3 + 1] = m.vertProperties[i * np + 1];
    positions[i * 3 + 2] = m.vertProperties[i * np + 2];
  }
  const indices = new Uint32Array(m.triVerts);
  return { positions, indices };
}
