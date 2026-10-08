// ClickGen : câblage de l'interface (réglages, image ou texte, calcul en arrière-plan, aperçus, exports).

import { DEFAULTS } from './core/params.js';
import { detectLang, fmt, getLang, setLang, t } from './ui/i18n.js';
import { playKey, setSoundKind } from './ui/sound.js';
import { loadImage } from './imageio.js';
import { renderText } from './image/textimage.js';
import { Runner } from './runner.js';
import { Viewer } from './view/viewer.js';
import { TopView } from './view/topview.js';
import { assignFilaments } from './export/filaments.js';
import { layoutForPrint } from './export/layout.js';
import { build3mf } from './export/threemf.js';
import { meshToStl } from './export/stl.js';
import { bambuProjectSettings, loadBambuTemplate } from './export/bambuConfig.js';
import { strToU8, zipSync } from '../vendor/fflate/fflate.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const LS_PARAMS = 'clickgen.params.v1';
const LS_SHELL = 'clickgen.shellColor';
const LS_TEXT = 'clickgen.text.v1';
const LS_SOUND = 'clickgen.sound';
const FIT_KEYS = ['pocketFit', 'socketFit', 'clearance', 'wall', 'bossDiameter', 'chamfer', 'pinStyle'];
const SHELL_DARK = '#2b2f36';
const SHELL_LIGHT = '#e4e7ee';
const TEXT_BG = '#2a5de8'; // fond par défaut d'un clicker « texte » : le bleu des switches clicky
const NOT_PERSISTED = ['placementAngle', 'placementX', 'placementY', 'bgColor'];
// réglages qui changent la forme : la position du switch choisie à la main n'a plus de sens après eux
const SHAPE_KEYS = ['size', 'frame', 'frameZoom', 'frameContent', 'smooth', 'minDetail', 'closeGap', 'keepMain', 'wall', 'clearance', 'autoGrow', 'maskMode', 'tolerance', 'invert', 'fillHoles'];
// Seuls les réglages « machine » survivent d'une visite à l'autre : ajustements, imprimante, tailles.
// La forme, le cadre, l'anneau… dépendent de l'image et repartent des valeurs par défaut.
const PERSISTED = ['pocketFit', 'socketFit', 'clearance', 'wall', 'bossDiameter', 'chamfer', 'pinStyle', 'bed', 'layerHeight', 'plates', 'artDepth', 'relief', 'size', 'autoGrow'];

/**
 * Navigation au clavier d'un groupe d'onglets ou de boutons radio : flèches, Début, Fin, avec « tabindex
 * itinérant » (un seul bouton dans l'ordre de tabulation). `selectedAttr` : aria-selected ou aria-checked.
 */
function bindRovingGroup(group, selectedAttr, onActivate) {
  const buttons = () => $$('button', group);
  const sync = () => buttons().forEach((b) => { b.tabIndex = b.getAttribute(selectedAttr) === 'true' ? 0 : -1; });
  new MutationObserver(sync).observe(group, { subtree: true, attributes: true, attributeFilter: [selectedAttr] });
  sync();
  group.addEventListener('keydown', (e) => {
    const list = buttons();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    let j = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    else return;
    e.preventDefault();
    list[j].focus();
    onActivate(list[j]);
  });
}

// ------------------------------------------------------------------ état --
const store = {
  src: 'image', // 'image' | 'text'
  imageSource: null, // dernière image importée (pour revenir de l'onglet Texte)
  image: null, // image courante envoyée au worker : importée ou texte rendu
  thumbEl: null,
  thumbBox: null, // {ox, oy, w, h} zone de l'image dans la vignette
  analysis: null,
  result: null,
  overrides: {}, // couleurs choisies par l'utilisateur : index de couleur -> #rrggbb
  shellColor: safeGet(LS_SHELL) || SHELL_DARK,
  shellAuto: !safeGet(LS_SHELL), // tant que l'utilisateur n'a pas choisi, la coque contraste avec le capuchon
  text: loadText(),
  picking: false,
  view: '3d',
  msgs: [], // messages persistants : {kind, key, vars}
  toast: null,
  exporting: false,
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } }

/** Ne garde que les réglages connus, du bon type et dans les bornes de leur contrôle (données non fiables). */
function sanitizeParams(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (!(k in src) || k === 'placementAngle' || k === 'placementX' || k === 'placementY') continue;
    let v = src[k];
    if (k === 'bgColor') { if (v === null || (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))) out[k] = v === null ? null : v.toLowerCase(); continue; }
    if (typeof v !== typeof def) continue;
    const el = document.querySelector(`[data-param="${k}"]`);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue;
      if (el?.tagName === 'SELECT') { if (![...el.options].some((o) => Number(o.value) === v)) continue; }
      else if (el && el.min !== '' && el.max !== '') v = Math.min(parseFloat(el.max), Math.max(parseFloat(el.min), v));
    } else if (typeof v === 'string' && el?.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) continue;
    out[k] = v;
  }
  return out;
}

function loadParams() {
  let saved = {};
  try { saved = JSON.parse(safeGet(LS_PARAMS) || '{}'); } catch { /* réglages illisibles */ }
  const keep = Object.fromEntries(Object.entries(sanitizeParams(saved)).filter(([k]) => PERSISTED.includes(k)));
  return { ...DEFAULTS, ...keep, placementAngle: null, placementX: null, placementY: null, bgColor: null };
}
function saveParams() {
  safeSet(LS_PARAMS, JSON.stringify(Object.fromEntries(PERSISTED.map((k) => [k, params[k]]))));
}

function loadText() {
  try {
    const s = JSON.parse(safeGet(LS_TEXT) || '{}');
    return { value: typeof s.value === 'string' ? s.value.slice(0, 40) : 'CLICK', font: typeof s.font === 'string' ? s.font : 'condensed' };
  } catch { return { value: 'CLICK', font: 'condensed' }; }
}

const params = loadParams();

// ------------------------------------------------------- moteurs (worker, 3D) --
let runner = null, viewer = null;
try { runner = new Runner(); } catch { store.msgs.push({ kind: 'error', key: 'msg.workerFail' }); }
try { viewer = new Viewer($('#gl'), $('#dims')); } catch (e) { console.error(e); store.msgs.push({ kind: 'warn', key: 'msg.noWebgl' }); }
const topview = new TopView($('#top2d'));

// ------------------------------------------------------------ réglages ↔ DOM --
function readEl(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range') return parseFloat(el.value);
  if (el.hasAttribute('data-number')) return Number(el.value);
  return el.value;
}

function setPct(el) {
  const min = parseFloat(el.min || 0), max = parseFloat(el.max || 100);
  el.style.setProperty('--pct', `${((parseFloat(el.value) - min) / (max - min)) * 100}%`);
}

function syncEl(el) {
  const v = params[el.dataset.param];
  if (el.type === 'checkbox') el.checked = !!v;
  else el.value = v;
  if (el.type === 'range') setPct(el);
}

function syncAll() {
  $$('[data-param]').forEach(syncEl);
  $$('button', $('#colorCount')).forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.val) === params.colorCount)));
  updateOutputs();
  syncVisibility();
}

function updateOutputs() {
  for (const o of $$('output[data-for]')) {
    const v = params[o.dataset.for];
    if (typeof v !== 'number') continue;
    const digits = Number(o.dataset.digits ?? 0);
    const sign = o.hasAttribute('data-signed') && v > 0 ? '+' : '';
    o.textContent = `${sign}${fmt(v * Number(o.dataset.scale ?? 1), digits)}${o.dataset.unit ? ` ${o.dataset.unit}` : ''}`;
  }
}

/** Montre ou cache les contrôles qui n'ont de sens que dans certains modes. */
function syncVisibility() {
  const framed = params.frame !== 'image';
  $('#frameOpts').hidden = !framed;
  $('#outlineOpts').hidden = framed;
  $('#ringAngleField').hidden = !params.keyring;
  // la tolérance du fond ne sert que si l'on détoure par couleur (et, dans un cadre, seulement pour « sujet détouré »)
  const asColor = store.analysis?.mode === 'color' || params.maskMode === 'color' || !!params.bgColor;
  $('#toleranceField').hidden = !asColor || (framed && params.frameContent !== 'subject');
  $('#clearBg').hidden = !params.bgColor;
  $('#pickBg').setAttribute('aria-pressed', String(store.picking));
  $('#drop').classList.toggle('picking', store.picking);
}

function bindParams() {
  for (const el of $$('[data-param]')) {
    el.addEventListener('input', () => {
      params[el.dataset.param] = readEl(el);
      if (SHAPE_KEYS.includes(el.dataset.param)) { params.placementX = params.placementY = null; params.placementAngle = null; }
      if (el.type === 'range') setPct(el);
      updateOutputs();
      syncVisibility();
      saveParams();
      requestRun();
    });
  }
  $('#colorCount').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-val]');
    if (!b) return;
    params.colorCount = Number(b.dataset.val);
    syncAll(); saveParams(); requestRun();
  });
  bindRovingGroup($('#colorCount'), 'aria-checked', (b) => b.click());
  $('#resetFit').addEventListener('click', () => {
    for (const k of FIT_KEYS) params[k] = DEFAULTS[k];
    syncAll(); saveParams(); requestRun(0);
  });
  syncAll();
}

// ----------------------------------------------------------------- image --
const drop = $('#drop');

/**
 * Définit l'image courante (importée ou rendue depuis un texte) et lance le calcul.
 * @param {{resetColors?:boolean, colors?:Record<number,string>}} [o]
 */
async function useImage(img, o = {}) {
  const { resetColors = true, colors = {} } = o;
  store.image = img;
  if (resetColors) store.overrides = { ...colors };
  store.analysis = null;
  params.placementAngle = null;
  params.placementX = params.placementY = null;
  params.bgColor = null;
  store.picking = false;
  store.thumbEl = new Image();
  store.thumbEl.onload = drawThumb;
  store.thumbEl.src = img.previewUrl;
  drop.classList.add('has-image');
  syncVisibility();
  await runner.setImage(img);
  requestRun(0);
}

let loadSeq = 0;

/** @returns {Promise<boolean>} vrai si l'image a été appliquée (faux si une demande plus récente l'a remplacée) */
async function loadFrom(source, name) {
  const my = ++loadSeq;
  try {
    if (!runner) throw new Error(t('msg.workerFail'));
    const img = await loadImage(source, name);
    if (my !== loadSeq) return false; // deux images en vol : la dernière demandée gagne, pas la dernière décodée
    store.imageSource = img;
    if (store.src === 'text') setSource('image', { reuse: false });
    await useImage(img);
    return true;
  } catch (e) {
    console.error(e);
    if (my === loadSeq) {
      store.msgs = [{ kind: 'error', key: 'img.loadError', vars: { message: e.message } }];
      renderMessages();
      setBusy(false);
    }
    return false;
  }
}

function drawThumb() {
  const c = $('#thumb');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const el = store.thumbEl;
  if (!el?.complete || !el.naturalWidth) return;
  const k = Math.min(c.width / el.naturalWidth, c.height / el.naturalHeight);
  const w = el.naturalWidth * k, h = el.naturalHeight * k;
  const ox = (c.width - w) / 2, oy = (c.height - h) / 2;
  store.thumbBox = { ox, oy, w, h };
  ctx.drawImage(el, ox, oy, w, h);
  const a = store.analysis;
  if (!a) return;
  const s = w / a.width;
  ctx.beginPath();
  for (const loop of a.loops) {
    loop.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * s, oy + y * s) : ctx.moveTo(ox + x * s, oy + y * s)));
    ctx.closePath();
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 4.5; ctx.stroke();
  ctx.strokeStyle = '#2a5de8'; ctx.lineWidth = 2.2; ctx.stroke();
}

/** Pipette : couleur du pixel de l'image sous le clic dans la vignette. */
function pickBackground(e) {
  const img = store.image, box = store.thumbBox;
  if (!img || !box) return;
  const c = $('#thumb'), r = c.getBoundingClientRect();
  const cx = ((e.clientX - r.left) * c.width) / r.width, cy = ((e.clientY - r.top) * c.height) / r.height;
  const x = Math.floor(((cx - box.ox) / box.w) * img.width), y = Math.floor(((cy - box.oy) / box.h) * img.height);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  const a = img.data[i + 3] / 255;
  const ch = (v) => Math.round(v * a + 255 * (1 - a)).toString(16).padStart(2, '0');
  params.bgColor = `#${ch(img.data[i])}${ch(img.data[i + 1])}${ch(img.data[i + 2])}`;
  store.picking = false;
  syncVisibility();
  requestRun(0);
}

function bindImageInput() {
  const file = $('#file');
  drop.addEventListener('click', (e) => {
    e.preventDefault();
    if (store.picking) { pickBackground(e); return; }
    if (e.target !== file) file.click();
  });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => { if (file.files[0]) loadFrom(file.files[0]); file.value = ''; });
  for (const ev of ['dragenter', 'dragover']) {
    document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement || !e.relatedTarget) drop.classList.remove('over'); });
  }
  document.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    const project = files.find((x) => /\.json$/i.test(x.name));
    if (project) { openProject(project); return; }
    const f = files.find((x) => x.type.startsWith('image/') || /\.svg$/i.test(x.name));
    if (f) loadFrom(f);
  });
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('textarea, input')) return;
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); loadFrom(f); }
  });
  $$('[data-sample]').forEach((b) => b.addEventListener('click', () => loadFrom(`samples/${b.dataset.sample}.svg`)));
  $('#pickBg').addEventListener('click', () => { store.picking = !store.picking; syncVisibility(); });
  $('#clearBg').addEventListener('click', () => { params.bgColor = null; syncVisibility(); requestRun(0); });
}

// ----------------------------------------------------------------- texte --
let textTimer = 0;

function bindText() {
  const value = $('#textValue'), font = $('#textFont');
  value.value = store.text.value;
  font.value = store.text.font;
  const changed = () => {
    store.text = { value: value.value, font: font.value };
    safeSet(LS_TEXT, JSON.stringify(store.text));
    if (store.src === 'text') scheduleText();
  };
  value.addEventListener('input', changed);
  font.addEventListener('input', changed);
  $('#srcTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-src]');
    if (b) setSource(b.dataset.src);
  });
  bindRovingGroup($('#srcTabs'), 'aria-selected', (b) => setSource(b.dataset.src));
}

function scheduleText(delay = 320) {
  clearTimeout(textTimer);
  setBusy(true);
  textTimer = setTimeout(applyText, delay);
}

let textSeq = 0;

async function applyText(first = false) {
  const my = ++textSeq;
  try {
    const img = await renderText({ text: store.text.value, font: store.text.font, color: '#ffffff' });
    if (my !== textSeq) return; // un rendu plus récent est en cours : il s'occupera de l'affichage
    if (!img || store.src !== 'text') { setBusy(false); return; } // texte vide, ou l'utilisateur a changé d'onglet entre-temps
    if (params.frame === 'image') { params.frame = 'pill'; syncAll(); saveParams(); } // un texte seul n'a pas de contour utile
    await useImage(img, first ? { colors: { 0: TEXT_BG, 1: '#ffffff' } } : { resetColors: false });
  } catch (e) {
    console.error(e);
    setBusy(false);
  }
}

/** Bascule entre l'image importée et le texte. */
function setSource(src, { reuse = true } = {}) {
  store.src = src;
  $$('#srcTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.src === src)));
  $('#srcImage').hidden = src !== 'image';
  $('#srcText').hidden = src !== 'text';
  if (!reuse) return;
  if (src === 'text') applyText(true);
  else if (store.imageSource) useImage(store.imageSource);
}

// ---------------------------------------------------------------- calcul --
let runTimer = 0, runSeq = 0;

function setBusy(on) { $('#busy').hidden = !on; }

function requestRun(delay = 240) {
  if (!store.image || !runner) return;
  clearTimeout(runTimer);
  setBusy(true);
  runTimer = setTimeout(runNow, delay);
}

async function runNow() {
  const my = ++runSeq;
  try {
    const msg = await runner.run({ ...params });
    if (my !== runSeq) return;
    onResult(msg);
  } catch (e) {
    if (e.superseded) return;
    if (my === runSeq) onError(e);
  } finally {
    if (my === runSeq) setBusy(false);
  }
}

function onError(e) {
  // un refus normal (forme introuvable, trop fine, ne tient pas) n'est pas un bogue : pas de trace rouge
  (['empty', 'vanished', 'nofit'].includes(e.code) ? console.info : console.error)(e.workerStack || e);
  const key = { empty: 'msg.empty', vanished: 'msg.vanished', nofit: 'msg.nofit', geometry: 'msg.geometry', timeout: 'msg.timeout' }[e.code] ?? 'msg.internal';
  const x = e.extra ?? {};
  store.msgs = [{ kind: 'error', key, vars: {
    size: x.size ? fmt(x.size) : '',
    minDetail: Number.isFinite(x.minDetail) ? fmt(x.minDetail) : '',
    message: e.message,
  } }];
  renderMessages();
  setExportEnabled(false);
}

function onResult(msg) {
  store.analysis = msg.analysis;
  store.result = msg.result;
  const r = msg.result;
  if (store.shellAuto) store.shellColor = contrastShell(currentColors().base);
  const colors = currentColors();
  viewer?.setModel(r);
  viewer?.setColors(colors);
  topview.setData({ preview: r.preview, placement: r.placement, outline: r.outline, colors, keyring: r.keyring, keepOut: r.dims.capKeepOut });
  store.msgs = r.warnings.flatMap((w) => {
    if (w.code === 'grown') {
      const out = [{ kind: 'info', key: 'msg.grown', vars: { size: fmt(w.size) } }];
      // forme très fine : le switch n'entre qu'à une taille démesurée, un cadre est la bonne réponse
      if (w.size > params.size * 1.3 && params.frame === 'image') out.push({ kind: 'info', key: 'msg.growTip' });
      return out;
    }
    if (w.code === 'toobig') return [{ kind: 'warn', key: 'msg.toobig', vars: { size: fmt(w.size), bed: params.bed } }];
    if (w.code === 'dropped') return [{ kind: 'info', key: 'msg.dropped', vars: { count: w.count } }];
    if (w.code === 'relief') return [{ kind: 'warn', key: 'msg.relief', vars: { height: fmt(w.height) } }];
    if (w.code === 'manualReset') { params.placementX = params.placementY = null; return [{ kind: 'info', key: 'msg.manualReset' }]; }
    return [{ kind: 'info', raw: w.text }];
  });
  renderMessages();
  renderSwatches();
  renderStats();
  syncAngle();
  drawThumb();
  syncVisibility();
  setExportEnabled(true);
}

// ----------------------------------------------------------------- couleurs --
const luminance = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
};

/** Coque sombre ou claire, selon ce qui contraste le plus avec la couleur du capuchon. */
function contrastShell(baseHex) {
  const lb = luminance(baseHex);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(lb, luminance(SHELL_DARK)) >= ratio(lb, luminance(SHELL_LIGHT)) ? SHELL_DARK : SHELL_LIGHT;
}

function currentColors() {
  const r = store.result;
  const get = (i) => store.overrides[i] ?? r?.colors?.[i]?.hex ?? '#c9a46a';
  const art = {};
  for (const i of r?.used ?? []) if (i > 0) art[i] = get(i);
  return { shell: store.shellColor, base: get(0), art };
}

function renderSwatches() {
  const r = store.result;
  const box = $('#swatches');
  box.replaceChildren();
  if (!r) return;
  const colors = currentColors();
  const entries = [{ key: 'shell', name: t('col.shell'), hex: colors.shell }, { key: 0, name: t('col.base'), hex: colors.base }];
  for (const i of r.used) if (i > 0) entries.push({ key: i, name: t('col.decor', { n: i }), hex: colors.art[i] });
  for (const e of entries) {
    const label = document.createElement('label');
    label.className = 'sw';
    label.innerHTML = '<span class="chipcolor"></span><span><span class="nm"></span><span class="hex"></span></span>';
    const chip = $('.chipcolor', label), hex = $('.hex', label);
    $('.nm', label).textContent = e.name;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = e.hex;
    input.setAttribute('aria-label', e.name);
    label.append(input);
    const paint = (v) => { chip.style.background = v; hex.textContent = v.toUpperCase(); };
    paint(e.hex);
    input.addEventListener('input', () => {
      if (e.key === 'shell') { store.shellColor = input.value; store.shellAuto = false; safeSet(LS_SHELL, input.value); } else store.overrides[e.key] = input.value;
      paint(input.value);
      const c = currentColors();
      viewer?.setColors(c);
      topview.setColors(c);
      renderStats();
      renderMessages();
    });
    box.append(label);
  }
}

// ---------------------------------------------------- stats, messages, angle --
function renderStats() {
  const r = store.result;
  const el = $('#stats');
  if (!r) { el.replaceChildren(); return; }
  const d = r.dims;
  const capVol = r.meshes.capBody.volume + r.meshes.arts.reduce((a, x) => a + x.volume, 0);
  const grams = (r.meshes.shell.volume * 0.92 + capVol * 1.1) / 1000;
  const rows = [
    [t('stat.shell'), `${fmt(r.outline.w)} × ${fmt(r.outline.h)} × ${fmt(d.shellH)} mm`],
    [t('stat.cap'), `${fmt(d.capH)} mm`],
    [t('stat.height'), `${fmt(d.capTopRest + (r.relief ?? 0))} mm ${t('stat.rest')}, ${fmt(d.shellH)} ${t('stat.pressed')}`],
    [t('stat.switch'), `MX 14,0 mm, ${fmt(r.placement.angle, 0)}°`],
    [t('stat.filaments'), String(assignedFilaments().filaments.length)],
    [t('stat.mass'), t('stat.massValue', { g: fmt(grams, 0) })],
  ];
  el.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v;
    return [dt, dd];
  }));
}

function renderMessages() {
  const box = $('#messages');
  const extra = [];
  if (store.result) {
    const { filaments, slots } = assignedFilaments();
    // deux plateaux : seuls les filaments du capuchon sont chargés ensemble (la coque a son propre plateau)
    const n = params.plates === 2 && filaments.length > 1
      ? new Set([slots.cap, ...Object.values(slots.art)]).size
      : filaments.length;
    if (n > 4) extra.push({ kind: 'warn', key: 'msg.manyFilaments', vars: { n } });
  }
  const items = [...store.msgs, ...extra, ...(store.toast ? [store.toast] : [])];
  box.replaceChildren(...items.map((m) => {
    const d = document.createElement('div');
    d.className = `msg ${m.kind}`;
    d.textContent = m.raw ?? t(m.key, m.vars);
    return d;
  }));
}

function flash(kind, key, vars) {
  store.toast = { kind, key, vars };
  renderMessages();
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { store.toast = null; renderMessages(); }, 4200);
}

function syncAngle() {
  const r = store.result;
  if (!r) return;
  const a = Math.round(params.placementAngle ?? r.placement.angle);
  $('#angle').value = a;
  setPct($('#angle'));
  $('#angleOut').textContent = `${a}°`;
}

// -------------------------------------------------------------------- exports --
function assignedFilaments() {
  const r = store.result;
  const c = currentColors();
  const art = {};
  for (const a of r?.meshes.arts ?? []) art[a.index] = c.art[a.index] ?? c.base;
  return assignFilaments(c.shell, c.base, art);
}

function fileBase() {
  const raw = store.src === 'text' ? store.text.value.split('\n')[0] : (store.image?.name ?? 'clicker').replace(/\.[^.]+$/, '');
  const n = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `clickgen-${n || 'clicker'}`;
}

function download(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function setExportEnabled(on) {
  for (const id of ['#dl3mf', '#dlstl']) $(id).disabled = !on || store.exporting;
}

/** @param {{withTower:boolean, plates:1|2}} o */
function printLayout(slots, { withTower, plates }) {
  return layoutForPrint(store.result.meshes, {
    slots,
    names: { shell: t('col.shell'), cap: t('col.base'), art: (i) => `decor_${i}` },
    bed: params.bed,
    plates,
    tower: withTower ? undefined : null, // undefined : dimensionnée d'après les filaments de chaque plateau
  });
}

async function export3mf() {
  if (!store.result || store.exporting) return;
  store.exporting = true; setExportEnabled(false);
  try {
    const { filaments, slots } = assignedFilaments();
    // avec un seul filament, séparer les pièces n'économise rien : un plateau suffit
    const plates = params.plates === 2 && filaments.length > 1 ? 2 : 1;
    const lay = printLayout(slots, { withTower: true, plates });
    if (!lay.fits) flash('warn', 'msg.layout');
    const cfg = bambuProjectSettings(await loadBambuTemplate(), filaments.map((f) => f.color), { towers: lay.towers, layerHeight: params.layerHeight });
    const thumbnail = viewer ? await viewer.thumbnail(256) : undefined;
    const bytes = build3mf({
      title: `ClickGen ${store.image?.name ?? ''}`.trim(),
      objects: lay.objects, filaments, projectSettings: cfg, thumbnail,
      plates: lay.plates, plateNames: lay.plates.map((idx) => idx.map((i) => lay.objects[i].name).join(' + ')),
      application: 'BambuStudio-02.06.01.55', // Bambu Studio n'applique la config projet que pour cette signature
    });
    const name = `${fileBase()}.3mf`;
    download(bytes, name, 'model/3mf');
    if (lay.fits) flash('info', plates === 2 ? 'exp.twoPlates' : 'exp.done', { name });
  } catch (e) {
    console.error(e);
    store.msgs = [{ kind: 'error', key: 'msg.internal', vars: { message: e.message } }];
    renderMessages();
  } finally {
    store.exporting = false; setExportEnabled(true);
  }
}

function exportStl() {
  if (!store.result || store.exporting) return;
  const { filaments, slots } = assignedFilaments();
  const lay = printLayout(slots, { withTower: false, plates: 1 });
  const files = {};
  const raised = (store.result.relief ?? 0) > 0; // décor en relief : la face du capuchon flotte une fois retourné
  const notes = ['ClickGen : pièces en repère d\'impression.', '', raised ? 'Imprimer à plat ; supports sur le capuchon (décor en relief) :' : 'Imprimer à plat, sans supports :'];
  for (const obj of lay.objects) {
    for (const part of obj.parts) {
      const fname = obj.name === t('col.shell') ? 'coque.stl' : part.name === 'cap_body' ? 'capuchon.stl' : `capuchon_${part.name}.stl`;
      files[fname] = meshToStl(part.mesh, `ClickGen ${fname}`);
      notes.push(`- ${fname} : filament ${filaments[part.slot].color}`);
    }
  }
  notes.push('', 'Le capuchon est retourné : face décor sur le plateau, croix vers le haut.');
  files['LISEZMOI.txt'] = strToU8(notes.join('\n'));
  const name = `${fileBase()}-stl.zip`;
  download(zipSync(files, { level: 6 }), name, 'application/zip');
  flash('info', 'exp.done', { name });
}

async function exportCoupon() {
  if (!runner) return;
  const btn = $('#coupon');
  btn.disabled = true;
  try {
    const msg = await runner.coupon({ ...params });
    const name = 'clickgen-banc-essai.stl';
    download(meshToStl(msg.mesh, 'ClickGen banc d essai'), name, 'model/stl');
    flash('info', 'exp.done', { name });
  } catch (e) {
    console.error(e);
    store.msgs = [{ kind: 'error', key: 'msg.internal', vars: { message: e.message } }];
    renderMessages();
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ projets --
function saveProject() {
  const proj = {
    app: 'ClickGen',
    version: 1,
    params: Object.fromEntries(Object.entries(params).filter(([k]) => !NOT_PERSISTED.includes(k))),
    shellColor: store.shellColor,
    shellAuto: store.shellAuto,
    overrides: store.overrides,
    src: store.src,
    text: store.text,
    image: store.src === 'image' && store.imageSource ? { name: store.imageSource.name, dataUrl: store.imageSource.previewUrl } : null,
  };
  download(JSON.stringify(proj), `${fileBase()}.clickgen.json`, 'application/json');
}

async function openProject(file) {
  try {
    const proj = JSON.parse(await file.text());
    if (proj?.app !== 'ClickGen' || typeof proj.params !== 'object') throw new Error('format inconnu');
    Object.assign(params, sanitizeParams(proj.params), { placementAngle: null, bgColor: null });
    const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
    store.shellColor = hex(proj.shellColor) ?? SHELL_DARK;
    store.shellAuto = proj.shellAuto !== false;
    store.overrides = {};
    for (const [k, v] of Object.entries(proj.overrides ?? {})) if (/^\d$/.test(k) && hex(v)) store.overrides[k] = hex(v);
    if (typeof proj.text?.value === 'string') {
      store.text = { value: proj.text.value.slice(0, 40), font: typeof proj.text.font === 'string' ? proj.text.font : 'condensed' };
      $('#textValue').value = store.text.value;
      $('#textFont').value = store.text.font;
    }
    syncAll(); saveParams();
    if (proj.src === 'text') {
      store.src = 'text';
      setSource('text', { reuse: false });
      await applyTextKeepingColors();
    } else if (typeof proj.image?.dataUrl === 'string' && proj.image.dataUrl.startsWith('data:image/')) {
      setSource('image', { reuse: false });
      const keep = { ...store.overrides };
      if (await loadFrom(proj.image.dataUrl, String(proj.image.name ?? 'image'))) {
        store.overrides = keep; // les couleurs du projet, pas celles que l'image vient de proposer
        requestRun(0);
      }
    }
  } catch (e) {
    console.error(e);
    store.msgs = [{ kind: 'error', key: 'proj.error', vars: { message: e.message } }];
    renderMessages();
  }
}

async function applyTextKeepingColors() {
  const keep = { ...store.overrides };
  await applyText(false);
  store.overrides = keep;
  requestRun(0);
}

// ------------------------------------------------------------------- vues 3D --
function bindStage() {
  const tabs = $('#viewTabs');
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    store.view = b.dataset.view;
    $$('button', tabs).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    const is3d = store.view === '3d';
    $('#gl').hidden = !is3d; $('#dims').style.visibility = is3d ? '' : 'hidden';
    $('#top2d').hidden = is3d;
    $('#bar3d').hidden = !is3d; $('#barTop').hidden = is3d;
    $('.hint-press').hidden = !is3d;
    viewer?.setActive(is3d);
    topview.setActive(!is3d);
  });

  bindRovingGroup(tabs, 'aria-selected', (b) => b.click());

  const press = $('#press');
  const down = () => { viewer?.pressDown(); press.classList.add('down'); };
  const up = () => { viewer?.pressUp(); press.classList.remove('down'); };
  press.addEventListener('pointerdown', (e) => { try { press.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ } down(); });
  for (const ev of ['pointerup', 'pointercancel']) press.addEventListener(ev, up);
  press.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); down(); } });
  press.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); up(); } });

  const explode = $('#explode');
  explode.addEventListener('input', () => { setPct(explode); viewer?.setExplode(Number(explode.value)); });
  $('#tSwitch').addEventListener('change', (e) => viewer?.setSwitchVisible(e.target.checked));
  $('#tCut').addEventListener('change', (e) => viewer?.setCut(e.target.checked));
  $('#tDims').addEventListener('change', (e) => viewer?.setDims(e.target.checked));
  $('#tPrint').addEventListener('change', (e) => viewer?.setPrintLayout(e.target.checked));
  const soundSel = $('#soundKind');
  soundSel.value = safeGet(LS_SOUND) || 'blue';
  setSoundKind(soundSel.value);
  soundSel.addEventListener('change', () => { setSoundKind(soundSel.value); safeSet(LS_SOUND, soundSel.value); });
  setPct(explode);

  const angle = $('#angle');
  angle.addEventListener('input', () => {
    params.placementAngle = Number(angle.value);
    setPct(angle);
    $('#angleOut').textContent = `${angle.value}°`;
    requestRun();
  });
  $('#angleAuto').addEventListener('click', () => { params.placementAngle = null; params.placementX = params.placementY = null; requestRun(0); });
  // glisser le switch dans la vue de dessus : position et angle sont alors imposés
  topview.onPlace = (x, y) => {
    params.placementX = x; params.placementY = y;
    params.placementAngle = store.result ? store.result.placement.angle : (params.placementAngle ?? 0);
    requestRun(0);
  };
  $('#dl3mf').addEventListener('click', export3mf);
  $('#dlstl').addEventListener('click', exportStl);
  $('#coupon').addEventListener('click', exportCoupon);
  $('#saveProject').addEventListener('click', saveProject);
  const pf = $('#projectFile');
  $('#openProject').addEventListener('click', () => pf.click());
  pf.addEventListener('change', () => { if (pf.files[0]) openProject(pf.files[0]); pf.value = ''; });
}

// ------------------------------------------------------------------- logo --
function bindLogo() {
  const keys = $$('#logo .key');
  for (const k of keys) {
    k.addEventListener('pointerdown', () => { k.classList.add('down'); playKey(0.88 + Math.random() * 0.3); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) k.addEventListener(ev, () => k.classList.remove('down'));
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  keys.forEach((k, i) => setTimeout(() => {
    k.classList.add('down');
    setTimeout(() => k.classList.remove('down'), 110);
  }, 350 + i * 85));
}

// -------------------------------------------------------------------- démarrage --
function renderDynamic() {
  renderMessages();
  renderSwatches();
  renderStats();
  updateOutputs();
}

function init() {
  setLang(detectLang());
  bindParams();
  bindImageInput();
  bindText();
  bindStage();
  bindLogo();
  $('#lang').addEventListener('click', () => { setLang(getLang() === 'fr' ? 'en' : 'fr'); renderDynamic(); });
  renderMessages();
  setExportEnabled(false);
  setBusy(true);
  if (!viewer) $('#viewTabs button[data-view="top"]').click(); // sans WebGL : vue de dessus + exports
  loadFrom('samples/cat.svg');
}

init();
if (new URLSearchParams(location.search).has('debug')) window.__cg = { params, store, viewer, topview, runner, requestRun };
