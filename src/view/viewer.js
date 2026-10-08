// Visionneuse 3D (three.js) : coque, capuchon qu'on presse, switch fantôme, coupe, éclaté, cotes en SVG.
// Repère : Z vers le haut, millimètres, comme le modèle généré.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/BufferGeometryUtils.js';
import { SWITCH } from '../core/params.js';
import { playActuate, playBottom, playRelease } from '../ui/sound.js';
import { fmt, t } from '../ui/i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EXPLODE_MM = 34;
const ACTUATION = 2.0; // mm de course : le « clic »

function geometryFrom(mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const out = toCreasedNormals(g, Math.PI / 6);
  g.dispose();
  return out;
}

function meshBounds(mesh) {
  const v = mesh.positions;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < v.length; i += 3) {
    if (v[i] < x0) x0 = v[i]; if (v[i] > x1) x1 = v[i];
    if (v[i + 1] < y0) y0 = v[i + 1]; if (v[i + 1] > y1) y1 = v[i + 1];
  }
  return { x0, y0, x1, y1 };
}

export class Viewer {
  /** @param {HTMLCanvasElement} canvas @param {SVGSVGElement} svg */
  constructor(canvas, svg) {
    this.canvas = canvas;
    this.svg = svg;
    this.active = true;
    this.showDims = true;
    this.printLayout = false;
    this.cut = false;
    this.explode = 0;
    this.spring = { x: 0, v: 0, target: 0 };
    this.meta = null;
    this.dirty = true;
    this.framed = false;
    this.w = 1;
    this.h = 1;
    this._ptr = null;
    this._prevX = 0;
    this._last = 0;
    this.travel = SWITCH.travel;

    this._initScene();
    this._initInteraction(); // avant OrbitControls : on doit voir le clic en premier
    this._initControls();
    this._initDims();
    this._observe();
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  // ---------------------------------------------------------------- scène --
  _initScene() {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // pas de tone mapping : la couleur affichée doit rester celle du filament choisi
    r.toneMapping = THREE.NoToneMapping;
    r.localClippingEnabled = true;
    r.setClearColor(0x000000, 0);

    const scene = (this.scene = new THREE.Scene());
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.32;

    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
    this.camera.up.set(0, 0, 1);

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(70, -90, 140);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 10, far: 420 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.35;
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.5);
    fill.position.set(-90, 60, 70);
    // contre-jour froid : détache les pièces sombres du fond bleu
    const rim = new THREE.DirectionalLight(0xcfe2ff, 1.1);
    rim.position.set(-40, 110, 55);
    scene.add(key, key.target, fill, rim);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), new THREE.ShadowMaterial({ opacity: 0.38 }));
    ground.position.z = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);
    scene.add(this._makeGrid());

    this.root = new THREE.Group();
    scene.add(this.root);

    const mk = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: 0 });
    this.mats = { shell: mk('#2b2f36'), base: mk('#c9a46a'), switch: mk('#2a5de8'), art: new Map() };
    this.mats.switch.roughness = 0.4;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
  }

  /** Grille de 10 mm (traits forts tous les 50 mm) qui s'efface avec la distance. */
  _makeGrid() {
    const pos = [], major = [];
    for (let i = -100; i <= 100; i += 10) {
      const m = i % 50 === 0 ? 1 : 0;
      pos.push(-100, i, 0, 100, i, 0, i, -100, 0, i, 100, 0);
      major.push(m, m, m, m);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('major', new THREE.Float32BufferAttribute(major, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { color: { value: new THREE.Color('#eaf3ff') } },
      vertexShader: 'attribute float major; varying float vMajor; varying vec3 vPos; void main(){ vMajor = major; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vMajor; varying vec3 vPos; void main(){ float fade = 1.0 - smoothstep(48.0, 100.0, length(vPos.xy)); gl_FragColor = vec4(color, mix(0.12, 0.32, vMajor) * fade); }',
    });
    const grid = new THREE.LineSegments(g, mat);
    grid.renderOrder = -1;
    return grid;
  }

  _initControls() {
    const c = (this.controls = new OrbitControls(this.camera, this.canvas));
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.minDistance = 55;
    c.maxDistance = 520;
    c.maxPolarAngle = Math.PI / 2 - 0.03;
    c.target.set(0, 0, 9);
    c.addEventListener('change', () => { this.dirty = true; });
  }

  _observe() {
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.canvas.parentElement);
    this._resize();
  }

  _resize() {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  // ----------------------------------------------------------- interaction --
  _initInteraction() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this._hitCap(e)) return;
      e.stopImmediatePropagation(); // OrbitControls ne doit pas démarrer une rotation
      c.setPointerCapture(e.pointerId);
      this._ptr = e.pointerId;
      c.classList.add('pressing');
      this.pressDown();
    });
    const release = (e) => {
      if (this._ptr !== e.pointerId) return;
      this._ptr = null;
      c.classList.remove('pressing');
      this.pressUp();
    };
    c.addEventListener('pointerup', release);
    c.addEventListener('pointercancel', release);
    c.addEventListener('pointermove', (e) => {
      if (this._ptr == null) c.style.cursor = this._hitCap(e) ? 'pointer' : '';
    });
    c.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); this.pressDown(); }
    });
    c.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { e.preventDefault(); this.pressUp(); }
    });
  }

  _hitCap(e) {
    if (!this.capGroup) return false;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(this.capGroup.children, false).length > 0;
  }

  pressDown() { this.spring.target = this.travel; }
  pressUp() { this.spring.target = 0; }

  // ---------------------------------------------------------------- modèle --
  setModel(result) {
    this._clear();
    const { shell, capBody, arts } = result.meshes;
    this.shellMesh = this._mesh(shell.mesh, this.mats.shell, false);
    this.capGroup = new THREE.Group();
    this.capGroup.add(this._mesh(capBody.mesh, this.mats.base, true));
    for (const a of arts) this.capGroup.add(this._mesh(a.mesh, this._artMat(a.index), true));
    this.root.add(this.shellMesh, this.capGroup);
    this._buildSwitch(result.placement, result.dims);
    this.root.updateMatrixWorld(true);
    this.shellBox = new THREE.Box3().setFromObject(this.shellMesh);
    this.capBox = new THREE.Box3().setFromObject(this.capGroup);
    this.meta = {
      dims: result.dims,
      bounds: meshBounds(shell.mesh),
      placement: result.placement,
      outline: result.outline,
    };
    this.clipPlane.constant = -result.placement.y;
    this._applyCut();
    this._applyPrintLayout();
    if (!this.framed) this.frame();
    this.dirty = true;
  }

  _mesh(meshData, mat) {
    const m = new THREE.Mesh(geometryFrom(meshData), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  _artMat(index) {
    let m = this.mats.art.get(index);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, metalness: 0 });
      this.mats.art.set(index, m);
    }
    return m;
  }

  _clear() {
    for (const o of [this.shellMesh, this.capGroup, this.switchGroup]) {
      if (!o) continue;
      this.root.remove(o);
      o.traverse((n) => n.geometry?.dispose());
    }
    this.shellMesh = this.capGroup = this.switchGroup = this.stem = null;
  }

  /** Switch MX simplifié (boîtier, bride, chapeau, croix) pour visualiser ce qui se passe dedans. */
  _buildSwitch(placement, d) {
    const g = (this.switchGroup = new THREE.Group());
    g.position.set(placement.x, placement.y, d.seat);
    g.rotation.z = (placement.angle * Math.PI) / 180;
    const m = this.mats.switch;
    const box = (w, h, z, zc) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, z), m);
      b.position.z = zc;
      b.castShadow = true;
      return b;
    };
    g.add(box(13.8, 13.8, SWITCH.seatToFlange, SWITCH.seatToFlange / 2));
    g.add(box(SWITCH.flange, SWITCH.flange, 1.0, SWITCH.seatToFlange + 0.5));
    const hatH = SWITCH.housingTop - (SWITCH.seatToFlange + 1.0);
    const hat = new THREE.CylinderGeometry(6.4 / Math.SQRT2, 11.7 / Math.SQRT2, hatH, 4);
    hat.rotateX(Math.PI / 2);
    hat.rotateZ(Math.PI / 4);
    const hatMesh = new THREE.Mesh(hat, m);
    hatMesh.position.z = SWITCH.seatToFlange + 1.0 + hatH / 2;
    hatMesh.castShadow = true;
    g.add(hatMesh);
    const stem = (this.stem = new THREE.Group());
    stem.add(box(4.0, 1.2, SWITCH.stemAbove, SWITCH.housingTop + SWITCH.stemAbove / 2));
    stem.add(box(1.2, 4.0, SWITCH.stemAbove, SWITCH.housingTop + SWITCH.stemAbove / 2));
    g.add(stem);
    g.visible = !this.printLayout && (this._switchVisible ?? false);
    this.root.add(g);
  }

  /** Couleurs : {shell, base, art:{index: '#rrggbb'}} — pas besoin de recalculer la géométrie. */
  setColors(c) {
    this.mats.shell.color.set(c.shell);
    this.mats.base.color.set(c.base);
    for (const [i, hex] of Object.entries(c.art)) this._artMat(+i).color.set(hex);
    this.dirty = true;
  }

  setSwitchVisible(on) {
    this._switchVisible = on;
    if (this.switchGroup) this.switchGroup.visible = on;
    this.dirty = true;
  }

  setCut(on) { this.cut = on; this._applyCut(); }

  _applyCut() {
    const mats = [this.mats.shell, this.mats.base, this.mats.switch, ...this.mats.art.values()];
    for (const m of mats) {
      m.clippingPlanes = this.cut ? [this.clipPlane] : [];
      m.side = this.cut ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    }
    this.dirty = true;
  }

  setExplode(v) { this.explode = v; this.dirty = true; }
  setDims(on) { this.showDims = on; this._syncDimsVisibility(); this.dirty = true; }
  _syncDimsVisibility() { this.svg.style.display = this.showDims && !this.printLayout ? '' : 'none'; }

  /**
   * Vue « plateau d'impression » : la coque à l'endroit et le capuchon RETOURNÉ à côté (face décor contre
   * le plateau), tels qu'ils seront imprimés, sans aucun support.
   */
  setPrintLayout(on) {
    this.printLayout = on;
    this._applyPrintLayout();
    this._syncDimsVisibility();
    this.frame();
  }

  _applyPrintLayout() {
    if (!this.capGroup) return;
    if (this.switchGroup) this.switchGroup.visible = !this.printLayout && (this._switchVisible ?? false);
    if (!this.printLayout) { this.capGroup.rotation.set(0, 0, 0); return; }
    const sb = this.shellBox, cb = this.capBox;
    const capW = cb.max.x - cb.min.x;
    const tx = sb.max.x + 14 + capW / 2;
    this.capGroup.rotation.set(Math.PI, 0, 0);
    // rotation de π autour de X : (x, y, z) -> (x, -y, -z) ; on recentre en XY et on pose la face sur z = 0
    this.capGroup.position.set(tx - (cb.min.x + cb.max.x) / 2, (sb.min.y + sb.max.y) / 2 + (cb.min.y + cb.max.y) / 2, cb.max.z);
    this.printCenterX = (sb.min.x + tx + capW / 2) / 2;
    this.printSpan = tx + capW / 2 - sb.min.x;
  }
  setActive(on) { this.active = on; if (on) { this._resize(); this.dirty = true; } }

  /** Cadre la pièce en 3/4 face. */
  frame() {
    if (!this.meta) return;
    const size = this.printLayout ? this.printSpan : Math.max(this.meta.outline.w, this.meta.outline.h);
    const fov = (this.camera.fov * Math.PI) / 180;
    const half = Math.max(size * (this.printLayout ? 0.62 : 0.78), 30);
    const dist = Math.min(520, (half * 1.2) / Math.tan(fov / 2) / Math.min(1, this.camera.aspect * 1.05));
    const dir = new THREE.Vector3(0.52, -1.0, 0.82).normalize();
    this.controls.target.set(this.printLayout ? this.printCenterX : 0, 0, this.printLayout ? 4 : 8);
    this.camera.position.copy(dir.multiplyScalar(dist)).add(this.controls.target);
    this.controls.update();
    this.framed = true;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ boucle --
  _stepSpring(dt) {
    const s = this.spring;
    if (Math.abs(s.x - s.target) < 1e-3 && Math.abs(s.v) < 1e-3) { s.x = s.target; s.v = 0; return false; }
    const K = 520, C = 30, h = 0.004;
    for (let t0 = 0; t0 < dt; t0 += h) {
      s.v += (-K * (s.x - s.target) - C * s.v) * h;
      s.x += s.v * h;
      if (s.x < 0) { s.x = 0; s.v = -s.v * 0.25; }
      if (s.x > this.travel) { s.x = this.travel; s.v = 0; }
    }
    const a = this._prevX, b = s.x;
    if (a < ACTUATION && b >= ACTUATION) playActuate();
    if (a < this.travel - 0.15 && b >= this.travel - 0.15) playBottom();
    if (a > 1.4 && b <= 1.4 && s.target === 0) playRelease();
    this._prevX = b;
    return true;
  }

  _tick(now) {
    requestAnimationFrame(this._tick);
    const dt = Math.min(0.05, ((now - (this._last || now)) / 1000));
    this._last = now;
    if (!this.active) return;
    const moving = this._stepSpring(dt);
    const changed = this.controls.update();
    if (moving || changed || this.dirty) {
      this._apply();
      this.renderer.render(this.scene, this.camera);
      this._updateDims();
      this.dirty = false;
    }
  }

  _apply() {
    if (this.capGroup && !this.printLayout) this.capGroup.position.set(0, 0, -this.spring.x + this.explode * EXPLODE_MM);
    if (this.stem) this.stem.position.z = this.printLayout ? 0 : -this.spring.x;
  }

  // -------------------------------------------------------------------- cotes --
  _initDims() {
    const svg = this.svg;
    this.dimEls = {};
    const make = (id, soft) => {
      const g = document.createElementNS(SVG_NS, 'g');
      if (soft) g.setAttribute('class', 'soft');
      const path = document.createElementNS(SVG_NS, 'path');
      const text = document.createElementNS(SVG_NS, 'text');
      g.append(path, text);
      svg.append(g);
      this.dimEls[id] = { path, text };
    };
    make('w'); make('d'); make('h'); make('travel', true);
    this._v = new THREE.Vector3();
  }

  _screen(x, y, z) {
    this._v.set(x, y, z).project(this.camera);
    return [(this._v.x * 0.5 + 0.5) * this.w, (-this._v.y * 0.5 + 0.5) * this.h];
  }

  /** Trace une cote entre deux points 3D, avec traits d'attache optionnels vers les pièces. */
  _dim(id, A, B, label, ext = [], push = 14) {
    const el = this.dimEls[id];
    const a = this._screen(...A), b = this._screen(...B);
    let d = '';
    for (const [P, Q] of ext) {
      const p = this._screen(...P), q = this._screen(...Q);
      d += `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
    }
    d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (const [px, py] of [a, b]) {
      d += `M${(px - nx * 5).toFixed(1)} ${(py - ny * 5).toFixed(1)}L${(px + nx * 5).toFixed(1)} ${(py + ny * 5).toFixed(1)}`;
    }
    el.path.setAttribute('d', d);
    // étiquette au milieu, poussée du côté « extérieur » (vers le haut de l'écran si possible)
    let ox = nx, oy = ny;
    if (oy > 0) { ox = -ox; oy = -oy; }
    el.text.textContent = label;
    el.text.setAttribute('x', ((a[0] + b[0]) / 2 + ox * push).toFixed(1));
    el.text.setAttribute('y', ((a[1] + b[1]) / 2 + oy * push + 4).toFixed(1));
  }

  _updateDims() {
    if (!this.showDims || this.printLayout || !this.meta) return;
    const { bounds: bb, dims: d } = this.meta;
    const off = 8;
    const wmm = bb.x1 - bb.x0, hmm = bb.y1 - bb.y0;
    this._dim('w', [bb.x0, bb.y0 - off, 0], [bb.x1, bb.y0 - off, 0], `${fmt(wmm)} mm`,
      [[[bb.x0, bb.y0, 0], [bb.x0, bb.y0 - off - 2, 0]], [[bb.x1, bb.y0, 0], [bb.x1, bb.y0 - off - 2, 0]]]);
    this._dim('d', [bb.x1 + off, bb.y0, 0], [bb.x1 + off, bb.y1, 0], `${fmt(hmm)} mm`,
      [[[bb.x1, bb.y0, 0], [bb.x1 + off + 2, bb.y0, 0]], [[bb.x1, bb.y1, 0], [bb.x1 + off + 2, bb.y1, 0]]]);
    const top = d.capTopRest - this.spring.x;
    const hx = bb.x0 - off * 0.7, hy = bb.y0 - off * 0.7;
    this._dim('h', [hx, hy, 0], [hx, hy, top], `${fmt(top)} mm`,
      [[[bb.x0, bb.y0, top], [hx, hy, top]]], 18);
    const tx = bb.x1 + off * 0.7, ty = bb.y1 + off * 0.7;
    this._dim('travel', [tx, ty, d.capTopRest - this.travel], [tx, ty, d.capTopRest], `${t('view.travel')} ${fmt(this.travel)} mm`,
      [[[bb.x1, bb.y1, d.capTopRest], [tx, ty, d.capTopRest]]], 20);
  }

  /**
   * Miniature PNG (octets) de la vue courante, pour le 3MF. Facultative : en cas d'échec (contexte WebGL
   * perdu, toBlob qui renvoie null ou ne rappelle jamais) on résout `undefined` et l'export continue sans.
   * @returns {Promise<Uint8Array|undefined>}
   */
  thumbnail(size = 256) {
    try {
      this._apply();
      this.renderer.render(this.scene, this.camera);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#164a86';
      ctx.fillRect(0, 0, size, size);
      const w = this.canvas.width, h = this.canvas.height, s = Math.min(w, h);
      ctx.drawImage(this.canvas, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), 3000);
        c.toBlob(async (b) => {
          clearTimeout(timer);
          try { resolve(b ? new Uint8Array(await b.arrayBuffer()) : undefined); } catch { resolve(undefined); }
        }, 'image/png');
      });
    } catch (e) {
      console.warn('vignette 3MF indisponible', e);
      return Promise.resolve(undefined);
    }
  }
}
