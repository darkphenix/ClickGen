// Export 3MF multi-filaments, à la manière de Bambu Studio / OrcaSlicer :
//   3D/3dmodel.model            maillages + objets (une coque, un capuchon à plusieurs volumes)
//   Metadata/model_settings.config   noms, volumes et filament (extruder) de chaque volume
//   Metadata/project_settings.config couleurs des filaments (facultatif)

import { strToU8, zipSync } from '../../vendor/fflate/fflate.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => (Math.abs(v) < 5e-6 ? '0' : String(+v.toFixed(5)));

/**
 * @param {{title:string, objects:import('./layout.js').PrintObject[], filaments:{color:string,name:string}[], thumbnail?:Uint8Array, projectSettings?:Record<string,any>}} o
 *   projectSettings : contenu de project_settings.config (voir bambuConfig.js), facultatif
 * @returns {Uint8Array}
 */
export function build3mf(o) {
  const files = {};
  const meshXml = [];
  const partIds = [];
  let nextId = 1;

  // 1) un <object> par volume ----------------------------------------------------------------------
  for (const obj of o.objects) {
    const ids = [];
    for (const part of obj.parts) {
      const id = nextId++;
      ids.push(id);
      meshXml.push(meshObjectXml(id, part.mesh));
    }
    partIds.push(ids);
  }
  // 2) un <object> « assemblage » par pièce imprimée ----------------------------------------------------
  const assemblyIds = [];
  const assemblyXml = o.objects.map((obj, i) => {
    const id = nextId++;
    assemblyIds.push(id);
    const comps = partIds[i].map((pid) => `    <component objectid="${pid}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`).join('\n');
    return `  <object id="${id}" type="model">\n   <components>\n${comps}\n   </components>\n  </object>`;
  });
  const items = o.objects.map((obj, i) =>
    `  <item objectid="${assemblyIds[i]}" transform="1 0 0 0 1 0 0 0 1 ${num(obj.x)} ${num(obj.y)} 0" printable="1"/>`);

  files['3D/3dmodel.model'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">${esc(o.application ?? 'ClickGen')}</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${esc(o.title)}</metadata>
 <metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>
 <resources>
${meshXml.join('\n')}
${assemblyXml.join('\n')}
 </resources>
 <build>
${items.join('\n')}
 </build>
</model>
`);

  // 3) réglages par objet / volume (filament = extruder, numéroté à partir de 1) ---------------------------
  const objCfg = o.objects.map((obj, i) => {
    const parts = obj.parts.map((part, j) => `    <part id="${partIds[i][j]}" subtype="normal_part">
      <metadata key="name" value="${esc(part.name)}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="${part.slot + 1}"/>
      <mesh_stat face_count="${part.mesh.indices.length / 3}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>`).join('\n');
    return `  <object id="${assemblyIds[i]}">
    <metadata key="name" value="${esc(obj.name)}"/>
    <metadata key="extruder" value="${obj.parts[0].slot + 1}"/>
${parts}
  </object>`;
  });
  const instances = o.objects.map((obj, i) => `    <model_instance>
      <metadata key="object_id" value="${assemblyIds[i]}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${100 + i}"/>
    </model_instance>`);
  const nFil = o.filaments.length;
  const plateFilaments = o.projectSettings
    ? `    <metadata key="filament_map_mode" value="Auto For Flush"/>
    <metadata key="filament_maps" value="${Array.from({ length: nFil }, () => 1).join(' ')}"/>
`
    : '';
  files['Metadata/model_settings.config'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<config>
${objCfg.join('\n')}
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
${plateFilaments}${instances.join('\n')}
  </plate>
</config>
`);

  if (o.projectSettings) {
    files['Metadata/project_settings.config'] = strToU8(JSON.stringify(o.projectSettings, null, 4));
  }

  // 4) paquet OPC -------------------------------------------------------------------------------------------
  const rels = [
    `<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`,
  ];
  if (o.thumbnail) {
    files['Auxiliaries/.thumbnails/thumbnail_3mf.png'] = o.thumbnail;
    rels.push(`<Relationship Target="/Auxiliaries/.thumbnails/thumbnail_3mf.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>`);
  }
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 ${rels.join('\n ')}
</Relationships>
`);
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="config" ContentType="text/xml"/>
</Types>
`);

  // [Content_Types].xml d'abord (convention OPC)
  const ordered = { '[Content_Types].xml': files['[Content_Types].xml'] };
  for (const k of Object.keys(files)) if (!(k in ordered)) ordered[k] = files[k];
  return zipSync(ordered, { level: 6 });
}

function meshObjectXml(id, mesh) {
  const v = mesh.positions, t = mesh.indices;
  const verts = new Array(v.length / 3);
  for (let i = 0; i < verts.length; i++) {
    verts[i] = `     <vertex x="${num(v[i * 3])}" y="${num(v[i * 3 + 1])}" z="${num(v[i * 3 + 2])}"/>`;
  }
  const tris = new Array(t.length / 3);
  for (let i = 0; i < tris.length; i++) {
    tris[i] = `     <triangle v1="${t[i * 3]}" v2="${t[i * 3 + 1]}" v3="${t[i * 3 + 2]}"/>`;
  }
  return `  <object id="${id}" type="model">
   <mesh>
    <vertices>
${verts.join('\n')}
    </vertices>
    <triangles>
${tris.join('\n')}
    </triangles>
   </mesh>
  </object>`;
}
