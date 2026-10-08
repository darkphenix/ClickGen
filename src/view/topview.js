// Vue de dessus en 2D : ce que verra l'imprimante, avec le switch et ses broches à l'échelle.

import { PIN_HOLES, SWITCH } from '../core/params.js';
import { fmt } from '../ui/i18n.js';

const CHALK = '#eaf3ff';

/** Point dans un ensemble de contours (règle pair-impair : les trous comptent). */
function insideEvenOdd(polys, x, y) {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export class TopView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = null;
    this.active = false;
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.map = null; // repère écran <-> mm de la dernière image dessinée
    this.drag = null; // {x, y, ok} pendant un glisser du switch
    this.onPlace = null; // (x, y) => void, appelé quand on relâche à une position valide
    this._bindDrag();
    new ResizeObserver(() => { if (this.active) { this._resize(); this.draw(); } }).observe(canvas.parentElement);
  }

  setData(data) { this.data = data; this.drag = null; this.draw(); }

  _toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const m = this.map;
    return m ? { x: (px - m.ox) / m.s + m.bcx, y: m.bcy - (py - m.oy) / m.s } : null;
  }

  /** Le point (x, y) est-il sur le carré du switch (bride de 15,6 mm, avec un peu de tolérance) ? */
  _onSwitch(w) {
    const pl = this.data?.placement;
    if (!w || !pl) return false;
    const a = (pl.angle * Math.PI) / 180;
    const dx = w.x - pl.x, dy = w.y - pl.y;
    const u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(u) <= SWITCH.flange / 2 + 1 && Math.abs(v) <= SWITCH.flange / 2 + 1;
  }

  /** Le carré de sécurité (relief + parois) tient-il dans le capuchon à cette position ? */
  _fits(x, y) {
    const pl = this.data.placement, keep = this.data.keepOut ?? 17.2;
    const a = (pl.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const h = keep / 2;
    // coins et milieux des côtés + quelques points intérieurs
    const pts = [];
    for (const u of [-h, -h / 2, 0, h / 2, h]) for (const v of [-h, -h / 2, 0, h / 2, h]) pts.push([x + u * c - v * s, y + u * s + v * c]);
    return pts.every(([px, py]) => insideEvenOdd(this.data.preview.cap, px, py));
  }

  _bindDrag() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (!this.active || !this.data || e.button !== 0) return;
      const w = this._toWorld(e);
      if (!this._onSwitch(w)) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ }
      this.drag = { dx: w.x - this.data.placement.x, dy: w.y - this.data.placement.y, x: this.data.placement.x, y: this.data.placement.y, ok: true, pid: e.pointerId };
      c.style.cursor = 'grabbing';
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.active || !this.data) return;
      const w = this._toWorld(e);
      if (this.drag) {
        this.drag.x = w.x - this.drag.dx;
        this.drag.y = w.y - this.drag.dy;
        this.drag.ok = this._fits(this.drag.x, this.drag.y);
        this.draw();
      } else {
        c.style.cursor = this._onSwitch(w) ? 'grab' : '';
      }
    });
    const end = (e) => {
      if (!this.drag || this.drag.pid !== e.pointerId) return;
      const d = this.drag;
      this.drag = null;
      c.style.cursor = '';
      if (d.ok && (Math.abs(d.x - this.data.placement.x) > 0.05 || Math.abs(d.y - this.data.placement.y) > 0.05)) this.onPlace?.(d.x, d.y);
      else this.draw();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  setColors(colors) {
    if (!this.data) return;
    this.data.colors = colors;
    this.draw();
  }

  setActive(on) {
    this.active = on;
    if (on) { this._resize(); this.draw(); }
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.w = w; this.h = h; this.dpr = dpr;
  }

  draw() {
    if (!this.active || !this.data) return;
    this._resize();
    const { ctx, w, h } = this;
    const { preview, placement, outline, colors, keyring } = this.data;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // cadrage : la silhouette de la coque centrée dans la zone libre (marge pour la barre du bas)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of preview.shell) for (const [x, y] of p) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (keyring) {
      x0 = Math.min(x0, keyring.x - keyring.r); x1 = Math.max(x1, keyring.x + keyring.r);
      y0 = Math.min(y0, keyring.y - keyring.r); y1 = Math.max(y1, keyring.y + keyring.r);
    }
    const padX = 70, padTop = 70, padBottom = 120;
    const s = Math.max(0.5, Math.min((w - 2 * padX) / (x1 - x0), (h - padTop - padBottom) / (y1 - y0)));
    const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
    const ox = w / 2, oy = padTop + (h - padTop - padBottom) / 2;
    const X = (x) => ox + (x - bcx) * s;
    const Y = (y) => oy - (y - bcy) * s;
    this.map = { ox, oy, s, bcx, bcy };

    // grille de 10 mm (traits forts tous les 50 mm)
    const wx0 = bcx - ox / s, wx1 = bcx + (w - ox) / s, wy0 = bcy - (h - oy) / s, wy1 = bcy + oy / s;
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(wx0 / 10) * 10; gx <= wx1; gx += 10) {
      ctx.strokeStyle = gx % 50 === 0 ? 'rgba(234,243,255,.28)' : 'rgba(234,243,255,.1)';
      ctx.beginPath(); ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), h); ctx.stroke();
    }
    for (let gy = Math.ceil(wy0 / 10) * 10; gy <= wy1; gy += 10) {
      ctx.strokeStyle = gy % 50 === 0 ? 'rgba(234,243,255,.28)' : 'rgba(234,243,255,.1)';
      ctx.beginPath(); ctx.moveTo(0, Y(gy)); ctx.lineTo(w, Y(gy)); ctx.stroke();
    }

    const trace = (polys) => {
      ctx.beginPath();
      for (const p of polys) {
        p.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        ctx.closePath();
      }
    };

    // patte porte-clés (derrière la coque)
    if (keyring) {
      ctx.beginPath(); ctx.arc(X(keyring.x), Y(keyring.y), keyring.r * s, 0, Math.PI * 2);
      ctx.fillStyle = colors.shell; ctx.fill(); ctx.strokeStyle = CHALK; ctx.lineWidth = 1.6; ctx.stroke();
    }

    // coque, capuchon, décor : les vraies couleurs, vues de dessus
    ctx.save();
    ctx.shadowColor = 'rgba(0,20,60,.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    trace(preview.shell); ctx.fillStyle = colors.shell; ctx.fill('evenodd');
    ctx.restore();
    trace(preview.shell); ctx.strokeStyle = CHALK; ctx.lineWidth = 1.6; ctx.stroke();
    trace(preview.cap); ctx.fillStyle = colors.base; ctx.fill('evenodd');
    for (const a of preview.art) {
      trace(a.polys); ctx.fillStyle = colors.art[a.index] ?? colors.base; ctx.fill('evenodd');
    }
    trace(preview.cap); ctx.strokeStyle = 'rgba(12,35,79,.55)'; ctx.lineWidth = 1; ctx.stroke();

    if (keyring) { // trou de l'anneau : percé dans le dessin pour laisser voir le fond
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(X(keyring.x), Y(keyring.y), keyring.hole * s, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.arc(X(keyring.x), Y(keyring.y), keyring.hole * s, 0, Math.PI * 2); ctx.strokeStyle = CHALK; ctx.lineWidth = 1.2; ctx.stroke();
    }

    // switch : bride 15,6, logement 14,0, broches, croix de la tige
    const sx = this.drag ? this.drag.x : placement.x, sy = this.drag ? this.drag.y : placement.y;
    const blue = this.drag && !this.drag.ok ? '#ff5a4f' : '#2a5de8'; // rouge : le switch ne tiendrait pas ici
    ctx.save();
    ctx.translate(X(sx), Y(sy));
    ctx.rotate((-placement.angle * Math.PI) / 180);
    const sq = (side) => ctx.strokeRect((-side / 2) * s, (-side / 2) * s, side * s, side * s);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = CHALK; ctx.lineWidth = 1.2; sq(SWITCH.flange);
    ctx.setLineDash([]); ctx.fillStyle = this.drag && !this.drag.ok ? 'rgba(255,90,79,.32)' : 'rgba(42,93,232,.28)';
    ctx.fillRect((-SWITCH.lowerBody / 2) * s, (-SWITCH.lowerBody / 2) * s, SWITCH.lowerBody * s, SWITCH.lowerBody * s);
    ctx.strokeStyle = blue; ctx.lineWidth = 2; sq(SWITCH.lowerBody);
    ctx.fillStyle = CHALK;
    for (const p of PIN_HOLES) { ctx.beginPath(); ctx.arc(p.x * s, -p.y * s, (p.d / 2) * s, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = blue;
    ctx.fillRect(-2 * s, -0.6 * s, 4 * s, 1.2 * s);
    ctx.fillRect(-0.6 * s, -2 * s, 1.2 * s, 4 * s);
    ctx.restore();

    // cotes de la coque
    const dimText = (txt, x, y) => {
      ctx.font = '600 13px "IBM Plex Sans Condensed", sans-serif';
      ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#164a86'; ctx.fillStyle = CHALK;
      ctx.strokeText(txt, x, y); ctx.fillText(txt, x, y);
    };
    const yb = Y(y0) + 24;
    ctx.strokeStyle = CHALK; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X(x0), yb); ctx.lineTo(X(x1), yb);
    for (const x of [x0, x1]) { ctx.moveTo(X(x), Y(y0) + 4); ctx.lineTo(X(x), yb + 5); }
    ctx.stroke();
    dimText(`${fmt(outline.w)} mm`, (X(x0) + X(x1)) / 2, yb - 6);
    const xr = X(x1) + 24;
    ctx.beginPath(); ctx.moveTo(xr, Y(y0)); ctx.lineTo(xr, Y(y1));
    for (const y of [y0, y1]) { ctx.moveTo(X(x1) + 4, Y(y)); ctx.lineTo(xr + 5, Y(y)); }
    ctx.stroke();
    ctx.save(); ctx.translate(xr + 16, (Y(y0) + Y(y1)) / 2); ctx.rotate(-Math.PI / 2);
    dimText(`${fmt(outline.h)} mm`, 0, 0); ctx.restore();
  }
}
