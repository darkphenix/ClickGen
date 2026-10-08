# ClickGen

**Transformez une image en clicker 3D à switch mécanique.** Déposez un logo, une mascotte ou un dessin : ClickGen détoure la forme, y loge un switch de clavier (compatible Cherry MX), colore le capuchon avec les couleurs de l'image et exporte un **.3mf multicolore pour Bambu Studio / OrcaSlicer** (ou des STL).

![ClickGen : vue éclatée et en coupe, avec le switch en bleu](docs/screenshot.jpg)

Tout se calcule dans votre navigateur : vos images ne quittent pas votre ordinateur, aucune requête réseau n'est faite une fois la page chargée.

[English version](README.en.md)

## Utiliser

- **En local** : `npm run serve` (Node 18 ou plus), puis <http://localhost:5173>. Un serveur HTTP est nécessaire : le calcul 3D tourne dans un Web Worker avec du WebAssembly, ce qui ne fonctionne pas depuis `file://`.
- **En ligne** : le dossier est un site statique, il se publie tel quel (GitHub Pages, Netlify…). Rien à construire.

## Ce qu'il vous faut

- Un **switch mécanique compatible MX** (Cherry, Gateron, Kailh, Outemu…). Un switch *clicky* (« blue ») donne le vrai clic.
- Une imprimante FDM, buse 0,4 mm, PLA. Aucun support nécessaire.
- Pour le décor multicolore : un filament par couleur distincte (AMS, AMS lite ou changements à la main).

## Ce qu'il sait faire

- **Image → clicker** : le contour de l'image devient la forme de la coque, ses couleurs deviennent le décor du capuchon.
- **Cadres** : cercle, carré arrondi, hexagone, octogone, écusson, pilule… L'image (une photo, un logo compliqué) devient alors le décor d'une forme propre, ajustée pour que rien ne dépasse.
- **Texte et emojis** : tapez un prénom (jusqu'à trois lignes, six polices), choisissez un cadre et les couleurs.
- **Anneau porte-clés** : une patte plate percée, à l'endroit voulu du contour.
- **Banc d'essai** : une petite plaque à imprimer en 25 minutes (4 logements, 4 croix) pour régler le serrage *avant* un gros clicker.
- **Aperçu vivant** : on presse le capuchon (clic, Espace ou bouton) avec le son d'un switch clicky, tactile ou linéaire ; vue éclatée, coupe, switch visible, cotes, vue de dessus, **vue plateau** (le capuchon retourné, tel qu'il s'imprime, sans supports).
- **Projets** : enregistrez et rouvrez un projet (`.clickgen.json`) avec l'image, les couleurs et tous les réglages.
- **Export** : `.3mf` multicolore (Bambu Studio / OrcaSlicer, hauteur de couche au choix) ou zip de STL.

## Comment ça marche

1. **Détourage** : transparence de l'image, ou couleur du fond (détectée sur les bords, ou choisie à la pipette ; tolérance réglable). Le contour est tracé au sous-pixel, lissé, puis nettoyé en millimètres (fentes comblées, détails trop fins retirés).
2. **Deux pièces** : la **coque** reprend la silhouette (ou le cadre) ; le **capuchon** est cette forme réduite de la paroi (2 mm) et du jeu (0,6 mm). Il coulisse dans la coque.
3. **Placement du switch** : ClickGen cherche, dans le capuchon, la position et l'angle où le carré du switch (relief de 14,8 mm + parois) tient entièrement, au plus près du centre de gravité. Si la forme est trop petite, elle est agrandie au minimum nécessaire (désactivable).
4. **Couleurs** : l'image est réduite à 1–5 couleurs (k-means en Lab, couleur finale = médiane des pixels). Avec un sujet détouré, le fond est la couleur du capuchon et chaque couleur du sujet devient un décor ; les couches de décor sont imprimées contre le plateau.
5. **Export** : un `.3mf` avec deux objets (coque à l'endroit, **capuchon retourné** face décor sur le plateau), un filament par couleur distincte, la tour de purge placée dans le plateau ; ou un zip de STL.

## Imprimer et assembler

1. Ouvrez le `.3mf` dans Bambu Studio ou OrcaSlicer, vérifiez les filaments, lancez l'impression.
2. Enfoncez le switch par le haut dans le logement de la coque (broches vers la cavité) : il tient par friction.
3. Poussez le capuchon sur la tige en croix du switch. Il doit pouvoir descendre de 4 mm ; la coque l'enveloppe presque jusqu'en bas.

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
npm test          # 32 tests : image, placement, cotes mécaniques, interférences, cadres, 3MF, STL
npm run serve     # serveur de développement sur le port 5173
```

- `src/image/` détourage, contours, couleurs · `src/geometry/` placement et solides ([manifold-3d](https://github.com/elalish/manifold)) · `src/export/` 3MF, STL, mise en plateau · `src/view/` aperçus 3D et 2D · `src/worker.js` calcul hors du fil principal.
- Notes de conception (cotes, empilement vertical, orientation d'impression, format 3MF Bambu) : [`docs/DESIGN.md`](docs/DESIGN.md).
- Les 3MF produits ont été tranchés avec le CLI de Bambu Studio (`return_code 0`, filaments et couleurs conservés).

## Limites connues

- Le contour d'une image très détaillée ou d'une photo est compliqué : choisissez plutôt un **cadre** (le décor reste l'image) ou un logo, une mascotte, un aplat sur fond transparent ou uni.
- Au-delà de 4 couleurs distinctes (coque comprise), un AMS lite ne suffit plus : donnez la même couleur à deux pièces ou réduisez le nombre de couleurs.
- Une seule pièce est conservée (la plus grande) ; les îlots détachés sont ignorés.
- Seul le profil de l'A1 mini est embarqué dans le 3MF.

## Licence

MIT, voir [`LICENSE`](LICENSE). Composants tiers (manifold-3d, three.js, fflate, IBM Plex) : [`THIRD_PARTY.md`](THIRD_PARTY.md). ClickGen n'est affilié ni à Cherry, ni à Bambu Lab, ni à ClickerFactory.
