// Lance un cas dans un worker_thread et le tue au bout de `ms` : une boucle infinie synchrone
// ne peut pas être interrompue depuis son propre fil, mais elle ne doit pas bloquer toute la suite de tests.

import { Worker } from 'node:worker_threads';

/** @returns {Promise<{ok:boolean, code?:string, size?:number, ms:number, hung?:boolean}>} */
export function runGuarded(name, ms = 20000) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./thin-worker.mjs', import.meta.url), { workerData: { name } });
    const timer = setTimeout(() => { w.terminate(); resolve({ ok: false, hung: true, ms }); }, ms);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); resolve(m); });
    w.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
