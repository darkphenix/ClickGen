// STL binaire.

/**
 * @param {{positions:Float32Array, indices:Uint32Array}} mesh
 * @returns {Uint8Array}
 */
export function meshToStl(mesh, header = 'ClickGen') {
  const nTri = mesh.indices.length / 3;
  const buf = new ArrayBuffer(84 + nTri * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf, 0, 80).set(new TextEncoder().encode(header.slice(0, 79)));
  dv.setUint32(80, nTri, true);
  const v = mesh.positions;
  let o = 84;
  for (let t = 0; t < nTri; t++) {
    const a = mesh.indices[t * 3] * 3, b = mesh.indices[t * 3 + 1] * 3, c = mesh.indices[t * 3 + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true);
    dv.setFloat32(o + 4, ny / l, true);
    dv.setFloat32(o + 8, nz / l, true);
    let q = o + 12;
    for (const i of [a, b, c]) {
      dv.setFloat32(q, v[i], true);
      dv.setFloat32(q + 4, v[i + 1], true);
      dv.setFloat32(q + 8, v[i + 2], true);
      q += 12;
    }
    dv.setUint16(q, 0, true);
    o += 50;
  }
  return new Uint8Array(buf);
}
