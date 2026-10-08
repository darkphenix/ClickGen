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

test('STL binaire : taille et nombre de triangles', () => {
  const mesh = result.meshes.shell.mesh;
  const stl = meshToStl(mesh);
  assert.equal(stl.length, 84 + 50 * (mesh.indices.length / 3));
  assert.equal(new DataView(stl.buffer).getUint32(80, true), mesh.indices.length / 3);
});
