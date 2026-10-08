import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from '../vendor/fflate/fflate.js';
import { analyzeImage, makeClicker } from '../src/pipeline.js';
import { DEFAULTS } from '../src/core/params.js';
import { arrangeOnBed, layoutForPrint, towerSize } from '../src/export/layout.js';
import { assignFilaments } from '../src/export/filaments.js';
import { bambuProjectSettings, loadBambuTemplate } from '../src/export/bambuConfig.js';
import { build3mf } from '../src/export/threemf.js';
import { meshToStl } from '../src/export/stl.js';
import { bearImage, checkMesh } from './helpers.mjs';

const p = { ...DEFAULTS };
const result = await makeClicker(analyzeImage(bearImage(500, true), p), p);

test('filaments : deux pièces de même couleur partagent un filament', () => {
  const { filaments, slots } = assignFilaments('#222222', '#aa5500', { 1: '#AA5500', 2: '#ffffff' });
  assert.equal(filaments.length, 3);
  assert.equal(slots.cap, slots.art[1]);
  assert.notEqual(slots.shell, slots.cap);
});

test('config Bambu : tous les vecteurs par filament ont la bonne longueur', async () => {
  const tpl = await loadBambuTemplate();
  const n0 = tpl.filament_colour.length;
  for (const n of [1, 2, 4]) {
    const cfg = bambuProjectSettings(tpl, Array.from({ length: n }, (_, i) => `#0000${i}${i}`), { tower: { x: 10, y: 20 } });
    for (const [k, v] of Object.entries(tpl)) {
      if (Array.isArray(v) && v.length === n0) assert.equal(cfg[k].length, n, k);
    }
    assert.equal(cfg.flush_volumes_matrix.length, n * n);
    assert.equal(cfg.flush_volumes_vector.length, 2 * n);
    assert.equal(cfg.different_settings_to_system.length, n + 2);
    assert.deepEqual(cfg.wipe_tower_x, ['10']);
  }
});

test('config Bambu : un gabarit à 4 filaments ne fausse pas le plateau ni les limites machine', async () => {
  // piège : 4 = longueur de printable_area ; 2 = longueur des machine_max_* — jamais traités comme « par filament »
  const tpl = structuredClone(await loadBambuTemplate());
  const four = (v) => Array.from({ length: 4 }, () => v);
  tpl.filament_colour = four('#111111');
  tpl.nozzle_temperature = four('220');
  tpl.printable_area = ['0x0', '180x0', '180x180', '0x180'];
  tpl.bed_exclude_area = four('0x0');
  tpl.machine_max_speed_x = ['500', '200'];
  const cfg = bambuProjectSettings(tpl, ['#AA0000', '#00AA00'], { tower: { x: 1, y: 2 } });
  assert.deepEqual(cfg.printable_area, tpl.printable_area);
  assert.deepEqual(cfg.bed_exclude_area, tpl.bed_exclude_area);
  assert.deepEqual(cfg.machine_max_speed_x, ['500', '200']);
  assert.equal(cfg.nozzle_temperature.length, 2, 'les réglages par filament suivent bien');
});

test('disposition : pièces et tour de purge tiennent sur un plateau de 180 mm', () => {
  const sizes = [{ w: 60, h: 58 }, { w: 54, h: 55 }];
  const tower = towerSize(4);
  const r = arrangeOnBed(180, sizes, tower);
  assert.ok(r.fits && r.tower);
  const box = (c, s) => [c.x - s.w / 2, c.y - s.h / 2, c.x + s.w / 2, c.y + s.h / 2];
  const boxes = [box(r.centers[0], sizes[0]), box(r.centers[1], sizes[1]), [r.tower.x, r.tower.y, r.tower.x + tower.w, r.tower.y + tower.d]];
  for (const b of boxes) assert.ok(b[0] >= 0 && b[1] >= 0 && b[2] <= 180 && b[3] <= 180, JSON.stringify(b));
  const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  assert.ok(!hit(boxes[0], boxes[1]) && !hit(boxes[0], boxes[2]) && !hit(boxes[1], boxes[2]));
});

test('tour de purge : l\'emprise couvre les mesures faites dans le G-code de Bambu Studio (2 à 7 filaments)', () => {
  // [côté mesuré en x, côté mesuré en y] de la tour imprimée, brim compris, tranchée avec le gabarit A1 mini ;
  // le brim déborde de 2,5 mm en x et 3,2 mm en y vers l'origine configurée.
  // Avant : une largeur fixe de 39 mm sortait du plateau (erreur -104 du CLI) dès 5 filaments.
  const measured = { 2: [31.8, 32.0], 3: [40.4, 40.3], 4: [47.0, 48.4], 5: [53.1, 55.0], 6: [58.0, 59.0], 7: [62.5, 64.2] };
  const sizes = [{ w: 60, h: 58 }, { w: 54, h: 55 }];
  for (const [n, [sx, sy]] of Object.entries(measured)) {
    const t = towerSize(+n);
    assert.ok(t.pad >= 3.2, `${n} filaments : décalage du brim couvert`);
    assert.ok(t.w >= sx + t.pad - 2.5 && t.d >= sy + t.pad - 3.2, `${n} filaments : ${t.w.toFixed(1)} × ${t.d.toFixed(1)} pour ${sx} × ${sy}`);
    // la tour réelle (origine configurée = coin + pad) reste dans l'emprise réservée, donc dans le plateau
    const r = arrangeOnBed(180, sizes, t);
    assert.ok(r.fits, `${n} filaments : les deux pièces et la tour tiennent sur 180 mm`);
    const x0 = r.tower.x + t.pad - 2.5, y0 = r.tower.y + t.pad - 3.2;
    assert.ok(x0 >= 0 && x0 + sx <= 180 && y0 >= 0 && y0 + sy <= 180, `${n} filaments : tour imprimée dans le plateau`);
  }
  assert.equal(towerSize(1), null);
});

test('3MF : objets, filaments, signature Bambu et maillages étanches', async () => {
  const artColors = Object.fromEntries(result.meshes.arts.map((a) => [a.index, result.colors[a.index].hex]));
  const { filaments, slots } = assignFilaments('#2b2f36', result.colors[0].hex, artColors);
  const lay = layoutForPrint(result.meshes, {
    slots, names: { shell: 'Coque', cap: 'Capuchon', art: (i) => `decor_${i}` }, bed: 180, tower: towerSize(filaments.length),
  });
  const cfg = bambuProjectSettings(await loadBambuTemplate(), filaments.map((f) => f.color), { tower: lay.tower });
  const bytes = build3mf({ title: 'test', objects: lay.objects, filaments, projectSettings: cfg, application: 'BambuStudio-02.06.01.55' });
  const files = unzipSync(bytes);
  assert.deepEqual(Object.keys(files).sort(), ['3D/3dmodel.model', 'Metadata/model_settings.config', 'Metadata/project_settings.config', '[Content_Types].xml', '_rels/.rels']);
  const xml = strFromU8(files['3D/3dmodel.model']);
  assert.match(xml, /name="Application">BambuStudio-02\.06\.01\.55</);
  const nParts = lay.objects.reduce((a, o) => a + o.parts.length, 0);
  assert.equal((xml.match(/<object /g) || []).length, nParts + lay.objects.length);
  assert.equal((xml.match(/<item /g) || []).length, lay.objects.length);
  const settings = strFromU8(files['Metadata/model_settings.config']);
  const extruders = [...settings.matchAll(/<part [^>]*>[\s\S]*?key="extruder" value="(\d+)"/g)].map((m) => +m[1]);
  assert.deepEqual(extruders, [slots.shell + 1, slots.cap + 1, ...result.meshes.arts.map((a) => slots.art[a.index] + 1)]);
  assert.equal(JSON.parse(strFromU8(files['Metadata/project_settings.config'])).filament_colour.length, filaments.length);
  for (const o of lay.objects) for (const part of o.parts) assert.ok(checkMesh(part.mesh).watertight, part.name);
  // le capuchon imprimé est retourné : il repose sur le plateau (z min = 0)
  let zMin = Infinity;
  const capMesh = lay.objects[1].parts[0].mesh;
  for (let i = 2; i < capMesh.positions.length; i += 3) zMin = Math.min(zMin, capMesh.positions[i]);
  assert.ok(Math.abs(zMin) < 1e-3, `z min du capuchon ${zMin}`);
});

test('3MF : sans relief aucun support ; avec relief, supports sur le capuchon seulement', async () => {
  const printed = async (res) => {
    const artColors = Object.fromEntries(res.meshes.arts.map((a) => [a.index, res.colors[a.index].hex]));
    const { filaments, slots } = assignFilaments('#2b2f36', res.colors[0].hex, artColors);
    const lay = layoutForPrint(res.meshes, { slots, names: { shell: 'Coque', cap: 'Capuchon', art: (i) => `decor_${i}` }, bed: 180, tower: towerSize(filaments.length) });
    const bytes = build3mf({ title: 't', objects: lay.objects, filaments, application: 'BambuStudio-02.06.01.55' });
    return { lay, settings: strFromU8(unzipSync(bytes)['Metadata/model_settings.config']) };
  };
  const flat = await printed(result);
  assert.ok(!flat.lay.objects[1].settings && !/enable_support/.test(flat.settings), 'décor plat : pas de supports');

  const pr = { ...DEFAULTS, relief: 0.8 };
  const raised = await printed(await makeClicker(analyzeImage(bearImage(500, true), pr), pr));
  assert.ok(raised.lay.objects[1].settings?.enable_support === '1');
  // les clés sont dans l'objet « Capuchon », pas dans celui de la coque
  const [shellCfg, capCfg] = raised.settings.split(/<object id=/).slice(1);
  assert.ok(!/enable_support/.test(shellCfg) && /enable_support" value="1"/.test(capCfg));
});

test('STL binaire : taille et nombre de triangles', () => {
  const mesh = result.meshes.shell.mesh;
  const stl = meshToStl(mesh);
  assert.equal(stl.length, 84 + 50 * (mesh.indices.length / 3));
  assert.equal(new DataView(stl.buffer).getUint32(80, true), mesh.indices.length / 3);
});
