// Côté page : pilote le worker de calcul. Un nouvel appel à run() annule le précédent (résultat ignoré).

export class Superseded extends Error {
  constructor() {
    super('superseded');
    this.superseded = true;
  }
}

export class Runner {
  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.seq = 0;
    this.waiting = new Map(); // id -> {resolve, reject}
    this.worker.onmessage = (e) => this.#onMessage(e.data);
    this.worker.onerror = (e) => {
      for (const w of this.waiting.values()) w.reject(new Error(e.message || 'Le calcul a échoué.'));
      this.waiting.clear();
    };
  }

  #onMessage(m) {
    const w = this.waiting.get(m.id);
    if (!w) return;
    if (m.type === 'result') { this.waiting.delete(m.id); w.resolve(m); }
    else if (m.type === 'imageReady') { this.waiting.delete(m.id); w.resolve(m); }
    else if (m.type === 'error') {
      this.waiting.delete(m.id);
      const err = new Error(m.message);
      Object.assign(err, { code: m.code, extra: m.extra, workerStack: m.stack });
      w.reject(err);
    }
  }

  /** Envoie l'image (RGBA) au worker. Le buffer est copié : l'appelant garde le sien. */
  setImage({ width, height, data }) {
    const id = ++this.seq;
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'image', id, width, height, buffer }, [buffer]);
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
    });
  }
}
