# Notes de conception

## Principe mécanique

Un clicker = **une coque** (silhouette extrudée, avec le logement du switch) + **un capuchon** qui coulisse dans la coque et s'emboîte sur la tige en croix du switch. Tout est construit comme une pile de prismes 2D (CrossSection de manifold-3d) combinés en 3D : pas de CSG sur des surfaces gauches, donc des maillages toujours étanches.

### Cotes du switch (datasheet Cherry MX)

| Cote | Valeur |
| --- | --- |
| Boîtier bas (trou de plaque) | 14,0 mm |
| Bride / boîtier haut | 15,6 mm |
| Fond du switch → dessous de la bride | 5,0 mm |
| Fond du switch → dessus du boîtier | 11,6 mm |
| Tige au-dessus du boîtier | 3,6 mm |
| Course totale | 4,0 mm (actuation vers 2,0 mm) |
| Pattes sous le boîtier | 3,3 mm |

### Empilement vertical (repère : fond de la coque = 0)

| z (mm) | Élément |
| --- | --- |
| 0 → 1,2 | fond plein |
| 1,2 → 5,0 | cavité sous le switch (pattes, plot, ergots) : Ø12,4 « tolérante » ou 5 trous exacts |
| 5,0 | plancher du switch (fond du boîtier) |
| 5,0 → 9,0 | collerette : carré de 14,0 mm tenant le boîtier par friction |
| 9,0 → 17,75 | cavité du capuchon, paroi de 2 mm |
| 15,35 | bord du capuchon au repos (11,35 enfoncé) |
| 20,2 | sommet de la tige au repos = plafond de la croix du capuchon |
| 21,55 | face du capuchon au repos (17,55 enfoncé : il affleure sous le haut de la coque) |

Capuchon (repère local, bord = 0) : hauteur 6,2 mm ; relief sous le capuchon de 14,8 → 11,8 mm sur 4,85 mm (loge le chapeau du switch, sans surplomb à l'impression) ; fourreau Ø5,9 en retrait de 1,0 mm, croix de 4,13 × 1,12 mm profonde de 3,85 mm avec entrée évasée ; décor dans les 0,8 mm du haut.

### Impression

- Coque : à l'endroit, cavité vers le haut, bord du fond chanfreiné (pied d'éléphant).
- Capuchon : **retourné**, face décor contre le plateau. Les couleurs sont dans les premières couches, la tige en croix pousse vers le haut, le relief évasé évite tout pont : aucun support.
- Jeu capuchon/coque 0,6 mm par côté, paroi 2,0 mm, distance capuchon-silhouette = 2,6 mm.

## Chaîne de traitement

1. `src/image/segment.js` : champ d'avant-plan doux (alpha, ou distance Lab à la couleur de fond) ; fond relié au bord par remplissage, trous bouchés (option).
2. `src/image/contours.js` : marching squares sous-pixel, simplification de Douglas-Peucker.
3. `src/geometry/outline.js` : contours en mm ; fermeture / ouverture / arrondi par décalages (Clipper2 via manifold) ; plus grande pièce.
4. `src/geometry/placement.js` : carré de côté 17,2 mm (relief + 2 × 1,2 mm de paroi) à loger dans le capuchon ; chaque angle (pas de 7,5°, puis 2,5°) est rastérisé et testé par image intégrale. `scoreCandidate()` choisit parmi les positions possibles (par défaut : proche du centre de gravité).
5. `src/image/quantize.js` : k-means en Lab, fusion des teintes proches, filtre majoritaire 3 × 3 contre l'anticrénelage, couleur = médiane des pixels.
6. `src/geometry/clicker.js` : coque, capuchon, couches de décor (découpées dans la face, pas superposées).
7. `src/pipeline.js` : orchestre, agrandit la forme jusqu'à ce que le switch rentre (pas de 6 %).

## Export 3MF (Bambu Studio / OrcaSlicer)

- `3D/3dmodel.model` : un `<object>` par volume (coque, corps du capuchon, une couche par couleur) et un objet « assemblage » par pièce imprimée ; transformation de 180° du capuchon appliquée aux sommets.
- `Metadata/model_settings.config` : nom, volumes et **filament (`extruder`, base 1)** de chaque volume.
- `Metadata/project_settings.config` : gabarit A1 mini enregistré par Bambu Studio, redimensionné au nombre de filaments (`bambuConfig.js`) ; tour de purge placée hors des pièces (`layout.js`).
- **Piège** : Bambu Studio n'applique la config projet que si `<metadata name="Application">` commence par `BambuStudio-`. Sans cela : un seul filament, réglages par défaut.
- Validation : `bambu-studio --slice 0 --outputdir <dossier> fichier.3mf` puis lecture de `result.json` (`return_code` 0) et de l'en-tête du G-code (`; filament: 1,2,3,4`).
