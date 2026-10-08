// Passage du repère « assemblé » au repère d'impression + disposition sur le plateau.
//
//  - la coque s'imprime telle quelle (fond sur le plateau, cavité vers le haut) ;
//  - le capuchon s'imprime RETOURNÉ : face décor contre le plateau (belle surface, couleurs dans
//    les premières couches) et la tige en croix qui pousse vers le haut, sans aucun support.

/**
 * @typedef {{positions:Float32Array, indices:Uint32Array}} Mesh
 * @typedef {{name:string, mesh:Mesh, slot:number}} Part  slot = index de filament (0-based)
 * @typedef {{name:string, parts:Part[], x:number, y:number}} PrintObject
 */

function boundsOf(meshes) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const m of meshes) {
    const v = m.positions;
    for (let i = 0; i < v.length; i += 3) {
      if (v[i] < x0) x0 = v[i]; if (v[i] > x1) x1 = v[i];
      if (v[i + 1] < y0) y0 = v[i + 1]; if (v[i + 1] > y1) y1 = v[i + 1];
      if (v[i + 2] < z0) z0 = v[i + 2]; if (v[i + 2] > z1) z1 = v[i + 2];
    }
  }
  return { x0, y0, z0, x1, y1, z1 };
}

function mapMesh(mesh, fn) {
  const src = mesh.positions;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) fn(src[i], src[i + 1], src[i + 2], out, i);
  return { positions: out, indices: mesh.indices };
}

/** Encombrement de la tour de purge Bambu (l = largeur réglée, profondeur ~ 16 + 7 mm par filament). */
export function towerSize(nFilaments, width = 35) {
  return nFilaments > 1 ? { w: width + 4, d: 16 + 7 * nFilaments + 6 } : null;
}

/**
 * Dispose les pièces et la tour de purge sur le plateau (carré de côté `bed`).
 * @param {{w:number,h:number}[]} sizes encombrement des pièces
 * @param {{w:number,d:number}|null} tower
 * @returns {{centers:{x:number,y:number}[], tower:{x:number,y:number}|null, fits:boolean}}
 */
export function arrangeOnBed(bed, sizes, tower, { gap = 10, margin = 6 } = {}) {
  const rects = [];
  const full = { x: 0, y: 0, w: bed, h: bed };
  const towerSpots = tower
    ? [
        { x: bed - margin - tower.w, y: bed - margin - tower.d },
        { x: margin, y: bed - margin - tower.d },
        { x: bed - margin - tower.w, y: margin },
        { x: margin, y: margin },
      ]
    : [null];
  const tryRect = (r, spot) => {
    const w = sizes.reduce((a, s) => a + s.w, 0) + gap * (sizes.length - 1);
    const h = Math.max(...sizes.map((s) => s.h));
    const rowOK = w <= r.w - 2 * margin && h <= r.h - 2 * margin;
    const cw = Math.max(...sizes.map((s) => s.w));
    const ch = sizes.reduce((a, s) => a + s.h, 0) + gap * (sizes.length - 1);
    const colOK = cw <= r.w - 2 * margin && ch <= r.h - 2 * margin;
    if (!rowOK && !colOK) return null;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const centers = [];
    if (rowOK) {
      let x = cx - w / 2;
      for (const s of sizes) { centers.push({ x: x + s.w / 2, y: cy }); x += s.w + gap; }
    } else {
      let y = cy - ch / 2;
      for (const s of sizes) { centers.push({ x: cx, y: y + s.h / 2 }); y += s.h + gap; }
    }
    return { centers, tower: spot, fits: true };
  };
  for (const spot of towerSpots) {
    // zones libres : au-dessus/dessous de la tour (pleine largeur), puis à gauche/droite (pleine hauteur)
    const zones = [];
    if (spot) {
      const above = spot.y > bed / 2;
      zones.push(above ? { x: 0, y: 0, w: bed, h: spot.y - gap } : { x: 0, y: spot.y + tower.d + gap, w: bed, h: bed - spot.y - tower.d - gap });
      const right = spot.x > bed / 2;
      zones.push(right ? { x: 0, y: 0, w: spot.x - gap, h: bed } : { x: spot.x + tower.w + gap, y: 0, w: bed - spot.x - tower.w - gap, h: bed });
    } else {
      zones.push(full);
    }
    for (const z of zones) {
      const res = tryRect(z, spot);
      if (res) return res;
    }
  }
  // rien ne tient : disposition centrée, tour en haut à droite (l'utilisateur ajustera)
  const w = sizes.reduce((a, s) => a + s.w, 0) + gap * (sizes.length - 1);
  let x = bed / 2 - w / 2;
  const centers = sizes.map((s) => { const c = { x: x + s.w / 2, y: bed / 2 }; x += s.w + gap; return c; });
  return { centers, tower: tower ? towerSpots[0] : null, fits: false };
}

/**
 * @param {{shell:{mesh:Mesh}, capBody:{mesh:Mesh}, arts:{index:number, mesh:Mesh}[]}} meshes
 * @param {{slots:{shell:number, cap:number, art:Record<number,number>}, names:{shell:string,cap:string,art:(i:number)=>string}, bed:number, tower?:{w:number,d:number}|null}} cfg
 * @returns {{objects:PrintObject[], fits:boolean, tower:{x:number,y:number}|null, bounds:any}}
 */
export function layoutForPrint(meshes, cfg) {
  // --- coque : recentrée en XY, posée sur z = 0 -------------------------------------------------
  const sb = boundsOf([meshes.shell.mesh]);
  const scx = (sb.x0 + sb.x1) / 2, scy = (sb.y0 + sb.y1) / 2;
  const shellMesh = mapMesh(meshes.shell.mesh, (x, y, z, o, i) => { o[i] = x - scx; o[i + 1] = y - scy; o[i + 2] = z - sb.z0; });

  // --- capuchon : retourné (rotation de 180° autour de X), face décor sur le plateau ---------
  const capMeshes = [meshes.capBody.mesh, ...meshes.arts.map((a) => a.mesh)];
  const cb = boundsOf(capMeshes);
  const ccx = (cb.x0 + cb.x1) / 2, ccy = (cb.y0 + cb.y1) / 2;
  const flip = (m) => mapMesh(m, (x, y, z, o, i) => { o[i] = x - ccx; o[i + 1] = -(y - ccy); o[i + 2] = cb.z1 - z; });

  const shellObj = { name: cfg.names.shell, parts: [{ name: 'shell', mesh: shellMesh, slot: cfg.slots.shell }], x: 0, y: 0 };
  const capParts = [{ name: 'cap_body', mesh: flip(meshes.capBody.mesh), slot: cfg.slots.cap }];
  for (const a of meshes.arts) {
    capParts.push({ name: cfg.names.art(a.index), mesh: flip(a.mesh), slot: cfg.slots.art[a.index] ?? cfg.slots.cap });
  }
  const capObj = { name: cfg.names.cap, parts: capParts, x: 0, y: 0 };

  const arranged = arrangeOnBed(
    cfg.bed,
    [{ w: sb.x1 - sb.x0, h: sb.y1 - sb.y0 }, { w: cb.x1 - cb.x0, h: cb.y1 - cb.y0 }],
    cfg.tower ?? null,
  );
  [shellObj.x, shellObj.y] = [arranged.centers[0].x, arranged.centers[0].y];
  [capObj.x, capObj.y] = [arranged.centers[1].x, arranged.centers[1].y];

  return { objects: [shellObj, capObj], fits: arranged.fits, tower: arranged.tower, bounds: { shell: sb, cap: cb } };
}
