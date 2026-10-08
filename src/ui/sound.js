// Sons synthétisés (Web Audio) : pas de fichier audio, pas de dépendance.
// Trois familles de switches, comme sur un vrai clavier :
//   blue  (clicky)   un tic aigu à l'actuation + un choc sourd en fin de course
//   brown (tactile)  une petite bosse sourde à l'actuation, pas de tic
//   red   (linéaire) pas d'actuation audible, juste le « thock » du fond de course

let ctx = null;
let noiseBuf = null;
let kind = 'blue'; // 'off' | 'blue' | 'brown' | 'red'

export const SOUND_KINDS = ['off', 'blue', 'brown', 'red'];
export function setSoundKind(k) { kind = SOUND_KINDS.includes(k) ? k : 'blue'; }
export function getSoundKind() { return kind; }
/** Compatibilité : activer / couper le son. */
export function setSoundEnabled(on) { if (!on) kind = 'off'; else if (kind === 'off') kind = 'blue'; }
export function isSoundEnabled() { return kind !== 'off'; }

function audio() {
  if (kind === 'off') return null;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    noiseBuf ??= makeNoise(ctx);
    return ctx;
  } catch {
    return null;
  }
}

function makeNoise(c) {
  const len = Math.floor(c.sampleRate * 0.12);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function tick(c, t, freq, gain, dur, q = 1.4) {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function thud(c, t, f0, gain, dur) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Actuation (milieu de course) : le « clic » du bleu, la bosse du brun, rien pour le rouge. */
export function playActuate() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  if (kind === 'blue') {
    tick(c, t, 3800, 0.55, 0.045, 2.2);
    tick(c, t + 0.004, 7200, 0.22, 0.03, 1.2);
    thud(c, t, 220, 0.18, 0.05);
  } else if (kind === 'brown') {
    thud(c, t, 150, 0.16, 0.05);
    tick(c, t, 900, 0.1, 0.035, 0.7);
  }
}

/** Fond de course : le choc du capuchon. */
export function playBottom() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  if (kind === 'red') {
    thud(c, t, 130, 0.55, 0.14); // thock plus grave et plus rond
    tick(c, t, 700, 0.22, 0.07, 0.6);
  } else {
    thud(c, t, 170, kind === 'brown' ? 0.42 : 0.5, 0.11);
    tick(c, t, 1100, 0.3, 0.06, 0.8);
  }
}

/** Remontée : petit claquement de ressort. */
export function playRelease() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  if (kind === 'blue') {
    tick(c, t, 5200, 0.3, 0.035, 2.0);
    thud(c, t, 260, 0.08, 0.04);
  } else {
    tick(c, t, 2600, 0.12, 0.03, 1.2);
    thud(c, t, 200, 0.05, 0.04);
  }
}

/** Touche du logo : un clic complet, légèrement différent à chaque fois. */
export function playKey(pitch = 1) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  tick(c, t, 3500 * pitch, 0.5, 0.04, 2.0);
  thud(c, t, 200 * pitch, 0.3, 0.07);
  tick(c, t + 0.075, 4800 * pitch, 0.18, 0.03, 1.8);
}
