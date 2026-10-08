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
| 9,0 → 18,35 | cavité du capuchon, paroi de 2 mm |
| 15,35 | bord du capuchon au repos (11,35 enfoncé) |
| 16,6 | dessus du boîtier du switch |
| 20,2 | sommet de la tige au repos = fond de la croix du capuchon |
| 20,8 | plafond du relief du capuchon au repos (16,8 enfoncé, soit 0,2 mm au-dessus du boîtier) |
| 22,15 | face du capuchon au repos (18,15 enfoncé : il affleure sous le haut de la coque) |

Capuchon (repère local, bord = 0) : hauteur 6,8 mm ; relief sous le capuchon de 14,8 → 11,8 mm sur 5,45 mm (loge le chapeau du switch, sans surplomb à l'impression) ; fourreau Ø5,9 en retrait de 1,0 mm, croix de 4,13 × 1,12 mm profonde de 3,85 mm avec entrée évasée ; décor dans les 0,8 mm du haut.

**Pourquoi le relief est plus profond que la croix (+0,6 mm).** La tige dépasse du boîtier de 3,6 mm mais la course est de 4,0 mm. Si le plafond du relief (hors fourreau) était au niveau du sommet de la tige, il viendrait toucher le dessus du boîtier après 3,6 mm de course : le capuchon butait avant le fond. Seul le fourreau, qui entre dans la cheminée du boîtier, doit descendre plus bas. Le plafond du relief est donc relevé de `travel − stemAbove + 0,2 mm` (`reliefDepth` dans `derive()`), et le test d'interférences balaie toute la course (0 à 4,0 mm). Le modèle de switch du test est simplifié (chapeau tronconique, fenêtre Ø6,2) : la cote reste à confirmer avec un vrai switch.

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

## Cadres, texte, anneau, banc d'essai

- **Cadres** (`src/geometry/frames.js`) : polygones analytiques convexes (cercle, carré lisse, carré arrondi, hexagone, octogone, écusson, pilule), plus grande dimension = 1, mis à l'échelle de la taille demandée. La silhouette de la coque est le cadre ; l'image n'est plus que le décor. Un sujet détouré (fond transparent) est ajusté par son **enveloppe convexe** (`fitInside`) pour qu'aucune extrémité ne soit rognée ; une image entière (photo) recouvre tout le cadre.
- **Fond réservé** : avec un sujet détouré, l'indice de couleur 0 (couleur du capuchon) est le fond du cadre, les couleurs du sujet prennent les indices 1..k, y compris le blanc (sinon un sujet blanc se confondrait avec le fond).
- **Texte** (`src/image/textimage.js`) : le texte est rendu sur un canvas transparent puis suit le même chemin qu'une image importée. Les emojis passent par la police du système.
- **Anneau** : disque de rayon 4,4 mm, épaisseur 3,6 mm, trou de 3,6 mm, centré à 3,2 mm au-delà du contour dans la direction choisie ; fixé au pied de la coque (z de 0 à 3,6), donc sans supports.
- **Banc d'essai** (`src/geometry/coupon.js`) : plaque de 4 mm avec 4 logements (réglage courant + −0,10 / 0 / +0,10 / +0,20 mm) et platine avec 4 fourreaux à croix (mêmes écarts). Les écarts sont relatifs aux curseurs : après avoir choisi, réglez les curseurs sur la valeur retenue.

## Performances

Mesures sur un ours de 800 px (mono-fil, machine de développement) : détourage + couleurs ~0,2 s, recalcul complet de la 3D ~0,45 s, recalcul avec un seul élément à refaire ~0,2 s.
- Placement du switch : passe grossière (0,6 mm, 12 angles) puis affinage local fin autour du meilleur résultat (rastérisation d'une boîte seulement) : ~50 ms au lieu de ~400 ms.
- Agrandissement automatique : progression géométrique (× 1,25) puis dichotomie (≤ 5 essais) au lieu de pas de 6 %.
- Cache par pièce (`makeClicker(..., {cache})`) : la coque et le capuchon sont conservés tant que leurs entrées (contours, position, réglages utiles) ne changent pas.
- Chanfreins : décalages à jointure « Miter » sur 2 marches ; les décalages arrondis dominaient le coût.
- Quantification des couleurs sur les couleurs **distinctes** (clés RGB 5 bits) et non sur chaque pixel.

## Pièges rencontrés

- `CrossSection.extrude(h, n, twist, scaleTop)` : un `scaleTop` numérique ne réduit que l'axe X dans manifold 3.5 ; il faut un couple `[x, y]`. Le test d'interférences (`test/mechanics.test.mjs`) l'a révélé.
- Les maillages de manifold peuvent contenir des sommets de même position mais d'indices différents (pincement quand deux régions de décor se touchent en un point) : ils sont fermés **en indices** ; on vérifie donc l'étanchéité sans souder par position.
- Un contour de décor exactement confondu avec celui du capuchon crée des faces coïncidentes : le décor déborde de 0,5 mm et la découpe 3D l'ajuste.
- `CrossSection.bounds()` d'une section **vide** renvoie ±1,8e308 (pas une boîte vide) : une forme plus fine que « Détail minimum » donnait une taille infinie, une échelle de départ nulle et une recherche d'agrandissement sans fin. Le pipeline refuse maintenant ce cas (`vanished`) et borne la boucle ; `test/pipeline.test.mjs` l'exerce dans un `worker_thread` qu'il peut tuer.
- Un pixel transparent **à l'intérieur** d'une silhouette comblée n'a pas de couleur : il ne doit pas voter dans le k-means (sinon son RGB brut 0,0,0 devient un « noir » imprimé) et prend la couleur de base.
- Course réelle ≠ course annoncée tant que le plafond du relief colle au sommet de la tige (voir plus haut).

## Garde-fous du calcul

- Le worker envoie un signe de vie à chaque étape (`progress`). Si la page n'a aucune nouvelle pendant 45 s, `runner.js` tue le worker, en recrée un, lui renvoie l'image et fait échouer les demandes en cours avec le code `timeout`. Seules les réponses du worker prolongent ce délai : bouger un curseur ne relance pas le chronomètre d'un worker figé.
- La vignette du 3MF est facultative : si `toBlob` échoue ou ne rappelle pas (contexte WebGL perdu), l'export continue sans elle.

## Export 3MF (Bambu Studio / OrcaSlicer)

- `3D/3dmodel.model` : un `<object>` par volume (coque, corps du capuchon, une couche par couleur) et un objet « assemblage » par pièce imprimée ; transformation de 180° du capuchon appliquée aux sommets.
- `Metadata/model_settings.config` : nom, volumes et **filament (`extruder`, base 1)** de chaque volume.
- `Metadata/project_settings.config` : gabarit A1 mini enregistré par Bambu Studio, redimensionné au nombre de filaments (`bambuConfig.js`) ; tour de purge placée hors des pièces (`layout.js`).
- **Piège** : Bambu Studio n'applique la config projet que si `<metadata name="Application">` commence par `BambuStudio-`. Sans cela : un seul filament, réglages par défaut.
- **Deux plateaux** (`plates: 2`, par défaut) : un `<plate>` par plateau dans `model_settings.config`, chacun avec son `<model_instance>`. Les positions des objets sont des coordonnées de la **scène** : le plateau 2 est décalé de 1,2 × la taille du plateau (`PLATE_PITCH`, 216 mm pour 180). Avec des coordonnées locales le CLI refuse (`-50`, « un plateau n'a aucun objet entièrement dedans »). `wipe_tower_x/y` a une entrée par plateau (repère local). Seul le plateau du capuchon reçoit une tour, dimensionnée sur ses filaments ; un capuchon d'une seule couleur n'en a pas.
- **Pourquoi** : sur un seul plateau, Bambu Studio imprime couche par couche et change de filament à chaque couche où coque et capuchon coexistent (42 couches pour 6,8 mm de capuchon), même avec 2 filaments. Mesures du CLI (disque de 60 mm, A1 mini, 0,16 mm) : 2 filaments 2 h 32 / 40 g contre 1 h 17 / 25 g ; 4 filaments 2 h 55 / 45 g (20 g de purge) contre 1 h 40 / 29 g ; 5 couleurs de décor 2 h 01 / 33 g en deux plateaux. Avec un seul filament, un seul plateau suffit.
- **Tour de purge** (`towerSize`) : emprise carrée mesurée dans le G-code (brim compris) de 32, 40, 47, 53, 58 et 62 mm pour 2 à 7 filaments, soit un côté² d'environ 600 mm² par filament, avec un débordement de 2,5 à 3,2 mm vers l'origine configurée. Une largeur fixe sortait du plateau (`-104`) dès 5 filaments. Les mesures sont liées au gabarit (tour de 35 mm, brim de 3 mm) : à refaire si le gabarit change.
- **Supports du relief** : si le décor dépasse de la face (`relief > 0`), le capuchon retourné ne repose que sur ses plots ; le 3MF écrit `enable_support`, `support_type`, `support_on_build_plate_only` dans l'objet capuchon uniquement (mesuré : lignes « Support » dans le tranchage).
- Validation : `bambu-studio --slice 0 --outputdir <dossier> fichier.3mf` puis lecture de `result.json` (`return_code` 0) et de l'en-tête du G-code (`; filament: 1,2,3,4`).
