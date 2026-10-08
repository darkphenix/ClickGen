// ClickGen : câblage de l'interface (réglages, image, calcul en arrière-plan, aperçus, exports).

import { DEFAULTS } from './core/params.js';
import { applyI18n, detectLang, fmt, getLang, setLang, t } from './ui/i18n.js';
import { playKey, setSoundEnabled } from './ui/sound.js';
import { loadImage } from './imageio.js';
import { Runner } from './runner.js';
import { Viewer } from './view/viewer.js';
import { TopView } from './view/topview.js';
import { assignFilaments } from './export/filaments.js';
import { layoutForPrint, towerSize } from './export/layout.js';
import { build3mf } from './export/threemf.js';
import { meshToStl } from './export/stl.js';
import { bambuProjectSettings, loadBambuTemplate } from './export/bambuConfig.js';
import { strToU8, zipSync } from '../vendor/fflate/fflate.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const LS_PARAMS = 'clickgen.params.v1';
const LS_SHELL = 'clickgen.shellColor';
const FIT_KEYS = ['pocketFit', 'socketFit', 'clearance', 'wall', 'bossDiameter', 'chamfer', 'pinStyle'];
const DEFAULT_SHELL = '#2b2f36';

// ------------------------------------------------------------------ état --
const params = loadParams();
const store = {
  image: null, // {name, width, height, data, previewUrl}
  thumbEl: null, // HTMLImageElement pour la vignette
  analysis: null,
  result: null,
  overrides: {}, // couleurs choisies par l'utilisateur : index de couleur -> #rrggbb
  shellColor: safeGet(LS_SHELL) || DEFAULT_SHELL,
  view: '3d',
  msgs: [], // messages persistants : {kind, key, vars}
  toast: null,
  exporting: false,
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } }

function loadParams() {
  const p = { ...DEFAULTS };
  try {
    const saved = JSON.parse(safeGet(LS_PARAMS) || '{}');
    for (const k of Object.keys(DEFAULTS)) if (k in saved && k !== 'placementAngle') p[k] = saved[k];
  } catch { /* réglages illisibles : valeurs par défaut */ }
  p.placementAngle = null;
  return p;
}
function saveParams() { safeSet(LS_PARAMS, JSON.stringify(params)); }

// ------------------------------------------------------- moteurs (worker, 3D) --
let runner = null, viewer = null, topview = null;
try { runner = new Runner(); } catch { store.msgs.push({ kind: 'error', key: 'msg.workerFail' }); }
try { viewer = new Viewer($('#gl'), $('#dims')); } catch (e) { console.error(e); }
topview = new TopView($('#top2d'));

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

function updateOutputs() {
  for (const o of $$('output[data-for]')) {
    const key = o.dataset.for;
    const v = params[key];
    if (typeof v !== 'number') continue;
    const digits = Number(o.dataset.digits ?? 0);
    const sign = o.hasAttribute('data-signed') && v > 0 ? '+' : '';
    o.textContent = `${sign}${fmt(v, digits)}${o.dataset.unit ? ` ${o.dataset.unit}` : ''}`;
  }
}

function bindParams() {
  for (const el of $$('[data-param]')) {
    syncEl(el);
    el.addEventListener('input', () => {
      params[el.dataset.param] = readEl(el);
      if (el.type === 'range') setPct(el);
      updateOutputs();
      saveParams();
      requestRun();
    });
  }
  const seg = $('#colorCount');
  const markSeg = () => $$('button', seg).forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.val) === params.colorCount)));
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-val]');
    if (!b) return;
    params.colorCount = Number(b.dataset.val);
    markSeg(); updateOutputs(); saveParams(); requestRun();
  });
  markSeg();
  $('#resetFit').addEventListener('click', () => {
    for (const k of FIT_KEYS) params[k] = DEFAULTS[k];
    $$('[data-param]').forEach(syncEl);
    updateOutputs(); saveParams(); requestRun(0);
  });
  updateOutputs();
}

// ----------------------------------------------------------------- image --
const drop = $('#drop');

async function useImage(img) {
  store.image = img;
  store.overrides = {};
  store.analysis = null;
  params.placementAngle = null;
  store.thumbEl = new Image();
  store.thumbEl.onload = drawThumb;
  store.thumbEl.src = img.previewUrl;
  drop.classList.add('has-image');
  await runner.setImage(img);
  requestRun(0);
}

async function loadFrom(source) {
  try {
    if (!runner) throw new Error(t('msg.workerFail'));
    await useImage(await loadImage(source));
  } catch (e) {
    console.error(e);
    store.msgs = [{ kind: 'error', key: 'img.loadError', vars: { message: e.message } }];
    renderMessages();
    setBusy(false);
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

function bindImageInput() {
  const file = $('#file');
  drop.addEventListener('click', (e) => { if (e.target !== file) file.click(); e.preventDefault(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => { if (file.files[0]) loadFrom(file.files[0]); file.value = ''; });
  for (const ev of ['dragenter', 'dragover']) {
    document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement || !e.relatedTarget) drop.classList.remove('over'); });
  }
  document.addEventListener('drop', (e) => {
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/') || /\.svg$/i.test(x.name));
    if (f) loadFrom(f);
  });
  document.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); loadFrom(f); }
  });
  $$('[data-sample]').forEach((b) => b.addEventListener('click', () => loadFrom(`samples/${b.dataset.sample}.svg`)));
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
  console.error(e.workerStack || e);
  const key = { empty: 'msg.empty', nofit: 'msg.nofit', geometry: 'msg.geometry' }[e.code] ?? 'msg.internal';
  store.msgs = [{ kind: 'error', key, vars: { size: e.extra?.size ? fmt(e.extra.size) : '', message: e.message } }];
  renderMessages();
  setExportEnabled(false);
}

function onResult(msg) {
  store.analysis = msg.analysis;
  store.result = msg.result;
  const r = msg.result;
  const colors = currentColors();
  viewer?.setModel(r);
  viewer?.setColors(colors);
  topview.setData({ preview: r.preview, placement: r.placement, outline: r.outline, colors });
  store.msgs = r.warnings.map((w) => {
    if (w.code === 'grown') return { kind: 'info', key: 'msg.grown', vars: { size: fmt(w.size) } };
    if (w.code === 'toobig') return { kind: 'warn', key: 'msg.toobig', vars: { size: fmt(w.size), bed: params.bed } };
    if (w.code === 'dropped') return { kind: 'info', key: 'msg.dropped', vars: { count: w.count } };
    return { kind: 'info', raw: w.text };
  });
  renderMessages();
  renderSwatches();
  renderStats();
  syncAngle();
  drawThumb();
  $('#toleranceField').hidden = msg.analysis.mode !== 'color';
  setExportEnabled(true);
}

// ----------------------------------------------------------------- couleurs --
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
      if (e.key === 'shell') { store.shellColor = input.value; safeSet(LS_SHELL, input.value); } else store.overrides[e.key] = input.value;
      paint(input.value);
      const c = currentColors();
      viewer?.setColors(c);
      topview.setColors(c);
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
    [t('stat.height'), `${fmt(d.capTopRest)} mm ${t('stat.rest')}, ${fmt(d.shellH)} ${t('stat.pressed')}`],
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
  const items = [...store.msgs, ...(store.toast ? [store.toast] : [])];
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
  const n = (store.image?.name ?? 'clicker').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
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

function printLayout(filaments, slots, withTower) {
  return layoutForPrint(store.result.meshes, {
    slots,
    names: { shell: t('col.shell'), cap: t('col.base'), art: (i) => `decor_${i}` },
    bed: params.bed,
    tower: withTower ? towerSize(filaments.length) : null,
  });
}

async function export3mf() {
  if (!store.result || store.exporting) return;
  store.exporting = true; setExportEnabled(false);
  try {
    const { filaments, slots } = assignedFilaments();
    const lay = printLayout(filaments, slots, true);
    if (!lay.fits) flash('warn', 'msg.layout');
    const cfg = bambuProjectSettings(await loadBambuTemplate(), filaments.map((f) => f.color), { tower: lay.tower });
    const thumbnail = viewer ? await viewer.thumbnail(256) : undefined;
    const bytes = build3mf({
      title: `ClickGen ${store.image?.name ?? ''}`.trim(),
      objects: lay.objects, filaments, projectSettings: cfg, thumbnail,
      application: 'BambuStudio-02.06.01.55', // Bambu Studio n'applique la config projet que pour cette signature
    });
    const name = `${fileBase()}.3mf`;
    download(bytes, name, 'model/3mf');
    if (lay.fits) flash('info', 'exp.done', { name });
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
  const lay = printLayout(filaments, slots, false);
  const files = {};
  const notes = ['ClickGen : pièces en repère d\'impression.', '', 'Imprimer à plat, sans supports :'];
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
  $('#tSound').addEventListener('change', (e) => setSoundEnabled(e.target.checked));
  setPct(explode);

  const angle = $('#angle');
  angle.addEventListener('input', () => {
    params.placementAngle = Number(angle.value);
    setPct(angle);
    $('#angleOut').textContent = `${angle.value}°`;
    requestRun();
  });
  $('#angleAuto').addEventListener('click', () => { params.placementAngle = null; requestRun(0); });
  $('#dl3mf').addEventListener('click', export3mf);
  $('#dlstl').addEventListener('click', exportStl);
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
  bindStage();
  bindLogo();
  $('#lang').addEventListener('click', () => { setLang(getLang() === 'fr' ? 'en' : 'fr'); renderDynamic(); });
  renderMessages();
  setExportEnabled(false);
  setBusy(true);
  loadFrom('samples/cat.svg');
}

init();
if (new URLSearchParams(location.search).has('debug')) window.__cg = { params, store, viewer, topview, runner, requestRun };
