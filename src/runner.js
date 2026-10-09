// Côté page : pilote le worker de calcul. Un nouvel appel à run() annule le précédent (résultat ignoré).
//
// Garde-fou : un calcul qui ne donne plus signe de vie pendant `stallMs` (boucle sans fin sur une forme
// pathologique, WASM à court de mémoire…) ne doit pas figer l'application. Le worker est alors tué et
// recréé, l'image lui est renvoyée, et les demandes en attente échouent avec un code « timeout ».
// Si le worker échoue encore et encore (script introuvable, module non pris en charge…), on cesse de le
// recréer : toutes les demandes suivantes échouent tout de suite avec la dernière erreur.

const STALL_MS = 45000;
const MAX_RESTARTS = 3; // pas plus de 3 recréations en RESTART_WINDOW_MS
const RESTART_WINDOW_MS = 20000;

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
    this.stallMs = STALL_MS;
    this.stallTimer = 0;
    this.restarts = []; // dates des recréations récentes
    this.broken = null; // erreur définitive : le worker n'est plus recréé
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
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restarts.length >= MAX_RESTARTS) { this.broken = err; return; }
    this.restarts.push(now);
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
    }, this.stallMs);
  }

  #onMessage(m) {
    try {
      const w = m.type === 'progress' ? null : this.waiting.get(m.id);
      if (!w) return; // progression, ou réponse à une demande déjà remplacée
      this.waiting.delete(m.id);
      if (m.type === 'error') {
        const err = new Error(m.message);
        Object.assign(err, { code: m.code, extra: m.extra, workerStack: m.stack });
        w.reject(err);
      } else {
        w.resolve(m); // result, imageReady, coupon
      }
    } finally {
      this.#watch(true); // n'importe quel message prouve que le worker est vivant
    }
  }

  #sendImage({ width, height, data }, id) {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.worker.postMessage({ type: 'image', id, width, height, buffer }, [buffer]);
  }

  /** Enregistre une demande et l'envoie ; échoue tout de suite si le worker est hors service. */
  #request(msg, extra = {}) {
    if (this.broken) return Promise.reject(this.broken);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, ...extra });
      try {
        msg(id);
      } catch (e) {
        this.waiting.delete(id);
        reject(e);
        return;
      }
      this.#watch();
    });
  }

  /** Envoie l'image (RGBA) au worker. Le buffer est copié : l'appelant garde le sien. */
  setImage(image) {
    this.image = image;
    return this.#request((id) => this.#sendImage(image, id));
  }

  /** Génère le banc d'essai de calibration (maillage unique). */
  coupon(params) {
    return this.#request((id) => this.worker.postMessage({ type: 'coupon', id, params }));
  }

  /**
   * Lance un calcul. Les demandes plus anciennes encore en attente sont rejetées avec Superseded.
   * @param {{force?:boolean}} [o] force : le worker vide ses caches avant de calculer (bouton « Régénérer »)
   */
  run(params, { force = false } = {}) {
    for (const [oldId, w] of this.waiting) {
      if (w.isRun) { this.waiting.delete(oldId); w.reject(new Superseded()); }
    }
    return this.#request((id) => this.worker.postMessage({ type: 'run', id, params, force }), { isRun: true });
  }
}
