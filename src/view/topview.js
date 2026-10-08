// Vue de dessus en 2D : ce que verra l'imprimante, avec le switch et ses broches à l'échelle.

import { PIN_HOLES, SWITCH } from '../core/params.js';
import { fmt } from '../ui/i18n.js';

const CHALK = '#eaf3ff';

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
    new ResizeObserver(() => { if (this.active) { this._resize(); this.draw(); } }).observe(canvas.parentElement);
  }

  setData(data) { this.data = data; this.draw(); }

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
    const { preview, placement, outline, colors } = this.data;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // cadrage : la silhouette de la coque centrée dans la zone libre (marge pour la barre du bas)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of preview.shell) for (const [x, y] of p) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const padX = 70, padTop = 70, padBottom = 120;
    const s = Math.max(0.5, Math.min((w - 2 * padX) / (x1 - x0), (h - padTop - padBottom) / (y1 - y0)));
    const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
    const ox = w / 2, oy = padTop + (h - padTop - padBottom) / 2;
    const X = (x) => ox + (x - bcx) * s;
    const Y = (y) => oy - (y - bcy) * s;

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

    // switch : bride 15,6, logement 14,0, broches, croix de la tige
    ctx.save();
    ctx.translate(X(placement.x), Y(placement.y));
    ctx.rotate((-placement.angle * Math.PI) / 180);
    const sq = (side) => ctx.strokeRect((-side / 2) * s, (-side / 2) * s, side * s, side * s);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = CHALK; ctx.lineWidth = 1.2; sq(SWITCH.flange);
    ctx.setLineDash([]); ctx.fillStyle = 'rgba(42,93,232,.28)';
    ctx.fillRect((-SWITCH.lowerBody / 2) * s, (-SWITCH.lowerBody / 2) * s, SWITCH.lowerBody * s, SWITCH.lowerBody * s);
    ctx.strokeStyle = '#2a5de8'; ctx.lineWidth = 2; sq(SWITCH.lowerBody);
    ctx.fillStyle = CHALK;
    for (const p of PIN_HOLES) { ctx.beginPath(); ctx.arc(p.x * s, -p.y * s, (p.d / 2) * s, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#2a5de8';
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
