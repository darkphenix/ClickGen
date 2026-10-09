# ClickGen

**Transformez une image en clicker 3D à switch mécanique.** Déposez un logo, une mascotte ou un dessin : ClickGen détoure la forme, y loge un switch de clavier (compatible Cherry MX), colore le capuchon avec les couleurs de l'image et exporte un **.3mf multicolore pour Bambu Studio / OrcaSlicer** (ou des STL).

![ClickGen : vue éclatée et en coupe, avec le switch en bleu](docs/screenshot.jpg)

Tout se calcule dans votre navigateur : vos images ne quittent pas votre ordinateur, aucune requête réseau n'est faite une fois la page chargée.

[English version](README.en.md)

## Utiliser

- **En local** : `npm run serve` (Node 18 ou plus), puis <http://localhost:5173>. Un serveur HTTP est nécessaire : le calcul 3D tourne dans un Web Worker avec du WebAssembly, ce qui ne fonctionne pas depuis `file://`.
- **En ligne** : le dossier est un site statique, il se publie tel quel (GitHub Pages, Netlify…). Rien à construire. Tous les chemins sont relatifs : le site fonctionne aussi sous un préfixe (`/clickgen/`). Derrière un proxy inverse, `NODE_ENV=production HOST=0.0.0.0 PORT=8034 node tools/serve.mjs` sert le site avec ETag, gzip et cache (les fichiers cachés et les méthodes d'écriture sont refusés).

## Ce qu'il vous faut

- Un **switch mécanique compatible MX** (Cherry, Gateron, Kailh, Outemu…). Un switch *clicky* (« blue ») donne le vrai clic.
- Une imprimante FDM, buse 0,4 mm, PLA. Aucun support nécessaire.
- Pour le décor multicolore : un filament par couleur distincte (AMS, AMS lite ou changements à la main).

## Ce qu'il sait faire

- **Image → clicker** : le contour de l'image devient la forme de la coque, ses couleurs deviennent le décor du capuchon.
- **Cadres** : cercle, carré arrondi, hexagone, octogone, écusson, pilule… L'image (une photo, un logo compliqué) devient alors le décor d'une forme propre, ajustée pour que rien ne dépasse.
- **Texte et emojis** : tapez un prénom (jusqu'à trois lignes, six polices), choisissez un cadre et les couleurs.
- **Plusieurs switches** : 2 ou 3 switches dans le même clicker (réglage « Switches dans le clicker ») : le capuchon, tenu en plusieurs points, bascule moins quand on appuie sur un côté. Le groupe se place tout seul (même angle, écart d'au moins 16 mm) et se déplace d'un bloc dans la vue de dessus.
- **Anneau porte-clés** : une patte plate percée, à l'endroit voulu du contour.
- **Banc d'essai** : une petite plaque à imprimer en 25 minutes (4 logements, 4 croix) pour régler le serrage *avant* un gros clicker.
- **Aperçu vivant** : on presse le capuchon (clic, Espace ou bouton) avec le son d'un switch clicky, tactile ou linéaire ; vue éclatée, coupe, switch visible, cotes, vue de dessus, **vue plateau** (le capuchon retourné, tel qu'il s'imprime, sans supports). Le bouton **Régénérer** relance tout le calcul sans réutiliser les résultats déjà mémorisés.
- **Projets** : enregistrez et rouvrez un projet (`.clickgen.json`) avec l'image, les couleurs et tous les réglages.
- **Export** : `.3mf` multicolore (Bambu Studio / OrcaSlicer, hauteur de couche au choix) ou zip de STL. Par défaut le `.3mf` contient **deux plateaux** (la coque, puis le capuchon) : bien moins de changements de filament (voir plus bas).

## Comment ça marche

1. **Détourage** : transparence de l'image, ou couleur du fond (détectée sur les bords, ou choisie à la pipette ; tolérance réglable). Le contour est tracé au sous-pixel, lissé, puis nettoyé en millimètres (fentes comblées, détails trop fins retirés).
2. **Deux pièces** : la **coque** reprend la silhouette (ou le cadre) ; le **capuchon** est cette forme réduite de la paroi (2 mm) et du jeu (0,6 mm). Il coulisse dans la coque.
3. **Placement du switch** : ClickGen cherche, dans le capuchon, la position et l'angle où le carré du switch (relief de 14,8 mm + parois) tient entièrement, au plus près du centre de gravité. Avec 2 ou 3 switches, il cherche un arrangement (même angle, écart minimal de 16 mm entre carrés) qui les écarte et les équilibre autour du centre de gravité. Si la forme est trop petite, elle est agrandie au minimum nécessaire (désactivable).
4. **Couleurs** : l'image est réduite à 1–5 couleurs (k-means en Lab, couleur finale = médiane des pixels). Avec un sujet détouré, le fond est la couleur du capuchon et chaque couleur du sujet devient un décor ; les couches de décor sont imprimées contre le plateau.
5. **Export** : un `.3mf` avec la coque à l'endroit (plateau 1) et le **capuchon retourné**, face décor sur le plateau (plateau 2), un filament par couleur distincte et une tour de purge là où il y a des changements de couleur ; ou un zip de STL. Un seul plateau reste possible.

## Imprimer et assembler

1. Ouvrez le `.3mf` dans Bambu Studio ou OrcaSlicer, vérifiez les filaments, imprimez le plateau 1 (coque) puis le plateau 2 (capuchon).
2. Enfoncez chaque switch par le haut dans son logement de la coque (broches vers la cavité) : il tient par friction.
3. Poussez le capuchon sur les tiges en croix des switches. Il doit pouvoir descendre de 4 mm ; la coque l'enveloppe presque jusqu'en bas. Avec plusieurs switches, présentez bien le capuchon à plat avant de pousser : toutes les tiges doivent entrer ensemble.

### Temps et PLA : un plateau ou deux ?

Sur un seul plateau, Bambu Studio imprime les pièces couche par couche et change de filament à chaque couche où la coque et le capuchon sont présents ensemble. Mesures du slicer (CLI de Bambu Studio, A1 mini, 0,16 mm, disque de 60 mm) :

| Filaments | Un plateau | Deux plateaux | Changements de filament |
| --- | --- | --- | --- |
| 2 (coque + capuchon uni) | 2 h 32, 40 g | 1 h 17, 25 g | 42 → 0 |
| 4 (capuchon à 3 couleurs) | 2 h 55, 45 g | 1 h 40, 29 g | 52 → 10 |
| 6 (capuchon à 5 couleurs) | non mesuré | 2 h 01, 33 g | 20 sur le plateau du capuchon |

Ce sont des estimations du slicer, pas des temps chronométrés. Avec un seul filament la disposition ne change rien. Avec deux plateaux, un clicker à capuchon uni se fait même sans AMS : une bobine pour la coque, une autre pour le capuchon.

Le 3MF embarque les réglages d'une **Bambu Lab A1 mini** (buse 0,4 mm, 0,16 mm, 2 parois, 15 % de remplissage). Sur une autre machine, changez d'imprimante dans le slicer : les pièces et les filaments sont conservés.

## Ajuster le serrage

Les cotes par défaut (logement 14,0 mm, croix 4,13 × 1,12 mm, jeu capuchon/coque 0,6 mm) viennent du datasheet Cherry MX et de clickers imprimés par d'autres makers. **Elles n'ont pas encore été validées par l'auteur sur toutes les imprimantes** : chaque machine imprime les trous un peu plus petits ou plus grands. Section « Ajustements » :

- *Logement du switch* : + élargit le carré de 14 mm, − le resserre.
- *Serrage de la croix* : + élargit la croix du capuchon, − la resserre.
- *Jeu capuchon / coque* : plus grand si le capuchon frotte.
- *Diamètre du fourreau* : diminuez-le si votre switch a un « boîtier » autour de la tige (type Box).

Corrigez par pas de 0,05 à 0,1 mm après un premier essai.

## Développement

```bash
npm test          # 70 tests : image, placement (1 à 3 switches), cotes mécaniques, interférences sur toute la course, cadres, 3MF, STL, garde-fous du worker
npm run serve     # serveur de développement sur le port 5173
```

- `src/image/` détourage, contours, couleurs · `src/geometry/` placement et solides ([manifold-3d](https://github.com/elalish/manifold)) · `src/export/` 3MF, STL, mise en plateau · `src/view/` aperçus 3D et 2D · `src/worker.js` calcul hors du fil principal.
- Notes de conception (cotes, empilement vertical, orientation d'impression, format 3MF Bambu) : [`docs/DESIGN.md`](docs/DESIGN.md).
- Les 3MF produits sont tranchés avec le CLI de Bambu Studio (`return_code 0`, filaments, couleurs et plateaux conservés, jusqu'à 7 filaments). La taille de la tour de purge a été mesurée dans le G-code produit (2 à 7 filaments).

## Limites connues

- Le contour d'une image très détaillée ou d'une photo est compliqué : choisissez plutôt un **cadre** (le décor reste l'image) ou un logo, une mascotte, un aplat sur fond transparent ou uni.
- Au-delà de 4 filaments chargés en même temps, un AMS lite ne suffit plus : réduisez le nombre de couleurs ou donnez la même couleur à deux pièces. En deux plateaux seul le capuchon compte (4 couleurs au plus, la coque se charge à part) ; sur un plateau, la coque compte aussi.
- Une seule pièce est conservée (la plus grande) ; les îlots détachés sont ignorés.
- **Plusieurs switches** : leurs ressorts s'additionnent (il faut appuyer deux ou trois fois plus fort). Un seul switch *clicky* suffit pour le clic, les autres peuvent être linéaires. Seule la croix du premier switch serre la tige ; celles des autres ont 0,1 mm de jeu en plus pour ne pas sur-contraindre le capuchon (hypothèse de conception, pas encore essayée sur une pièce imprimée). Les formes trop fines ou trop creuses n'en logent pas trois, même agrandies : ClickGen le dit.
- Seul le profil de l'A1 mini est embarqué dans le 3MF. Le choix « 256 mm » change la disposition et la taille maximale, pas le profil embarqué (plateau de 180 mm dans la config) : choisissez ensuite votre imprimante dans le slicer (non vérifié avec un vrai profil P1S/X1).
- Le **relief** du décor (curseur « Relief ») rend la face du capuchon flottante une fois retourné : le 3MF active alors des supports sur le capuchon, la face est un peu rugueuse.
- Le capuchon descend de 4 mm dans la simulation d'interférences (modèle de switch simplifié) ; aucun prototype n'a encore été imprimé et essayé avec un vrai switch par l'auteur.

## Licence

MIT, voir [`LICENSE`](LICENSE). Composants tiers (manifold-3d, three.js, fflate, IBM Plex) : [`THIRD_PARTY.md`](THIRD_PARTY.md). ClickGen n'est affilié ni à Cherry, ni à Bambu Lab, ni à ClickerFactory.
