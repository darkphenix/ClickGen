// Côté page : pilote le worker de calcul. Un nouvel appel à run() annule le précédent (résultat ignoré).
//
// Garde-fou : un calcul qui ne donne plus signe de vie pendant STALL_MS (boucle sans fin sur une forme
// pathologique, WASM à court de mémoire…) ne doit pas figer l'application. Le worker est alors tué et
// recréé, l'image lui est renvoyée, et les demandes en attente échouent avec un code « timeout ».

const STALL_MS = 45000;

export class Superseded extends Error {
  constructor() {
    super('superseded');
    this.superseded = true;
  }
}

export class Runner {
  constructor() {
    this.seq = 0;
    this.waiting = new Map(); // id -> {resolve, reject, isRun}
    this.image = null; // dernière image envoyée, pour réarmer un worker recréé
    this.stallTimer = 0;
    this.#spawn();
  }

  #spawn() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.#onMessage(e.data);
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this.#restart(Object.assign(new Error(e.message || 'Le calcul a échoué.'), { code: 'internal' }));
    };
  }

  /** Tue le worker, en crée un neuf (avec l'image courante) et fait échouer les demandes en cours. */
  #restart(err) {
    clearTimeout(this.stallTimer);
    this.stallTimer = 0;
    this.worker.onmessage = this.worker.onerror = null;
    this.worker.terminate();
    const pending = [...this.waiting.values()];
    this.waiting.clear();
    for (const w of pending) w.reject(err);
    this.#spawn();
    if (this.image) this.#sendImage(this.image, ++this.seq);
  }

  /**
   * Chronomètre « sans nouvelles du worker » tant qu'une demande attend une réponse.
   * @param {boolean} alive vrai quand le worker vient de se manifester : le délai repart de zéro.
   *   Une nouvelle demande ne le relance pas, sinon un worker figé ne serait jamais redémarré tant que
   *   l'utilisateur continue à bouger un curseur.
   */
  #watch(alive = false) {
    if (!this.waiting.size) { clearTimeout(this.stallTimer); this.stallTimer = 0; return; }
    if (this.stallTimer && !alive) return;
    clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      this.stallTimer = 0;
      this.#restart(Object.assign(new Error('Le calcul a été arrêté (trop long).'), { code: 'timeout' }));
    }, STALL_MS);
  }

  #onMessage(m) {
    if (m.type === 'progress') { this.#watch(true); return; } // signe de vie : le worker avance
    const w = this.waiting.get(m.id);
    if (!w) return;
    if (m.type === 'result') { this.waiting.delete(m.id); w.resolve(m); }
    else if (m.type === 'imageReady' || m.type === 'coupon') { this.waiting.delete(m.id); w.resolve(m); }
    else if (m.type === 'error') {
      this.waiting.delete(m.id);
      const err = new Error(m.message);
      Object.assign(err, { code: m.code, extra: m.extra, workerStack: m.stack });
      w.reject(err);
    }
    this.#watch(true);
  }

  #sendImage({ width, height, data }, id) {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.worker.postMessage({ type: 'image', id, width, height, buffer }, [buffer]);
  }

  /** Envoie l'image (RGBA) au worker. Le buffer est copié : l'appelant garde le sien. */
  setImage(image) {
    this.image = image;
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.#sendImage(image, id);
      this.#watch();
    });
  }

  /** Génère le banc d'essai de calibration (maillage unique). */
  coupon(params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'coupon', id, params });
      this.#watch();
    });
  }

  /** Lance un calcul. Les demandes plus anciennes encore en attente sont rejetées avec Superseded. */
  run(params) {
    for (const [oldId, w] of this.waiting) {
      if (w.isRun) { this.waiting.delete(oldId); w.reject(new Superseded()); }
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, isRun: true });
      this.worker.postMessage({ type: 'run', id, params });
      this.#watch();
    });
  }
}
