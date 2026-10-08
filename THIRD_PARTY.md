# Composants tiers / Third-party components

Tout est embarqué dans le dépôt (aucun CDN, aucune requête réseau à l'exécution).
Everything is bundled in the repository (no CDN, no network request at runtime).

| Composant | Version | Licence | Emplacement |
| --- | --- | --- | --- |
| [manifold-3d](https://github.com/elalish/manifold) (géométrie, WASM) | 3.5.4 | Apache-2.0 | `vendor/manifold/` |
| [three.js](https://threejs.org) (aperçu 3D, minifié avec esbuild) + `OrbitControls`, `RoomEnvironment`, `BufferGeometryUtils` | 0.186.1 | MIT | `vendor/three/` |
| [fflate](https://github.com/101arrowz/fflate) (ZIP du 3MF et des STL) | 0.8.3 | MIT | `vendor/fflate/` |
| [IBM Plex Sans / Plex Sans Condensed](https://github.com/IBM/plex) | latin, 400 à 700 | SIL OFL 1.1 | `assets/fonts/` |

Le fichier `src/export/templates/bambu-a1mini.json` est un `project_settings.config` enregistré par Bambu Studio
(profil système « Bambu Lab A1 mini 0.4 nozzle », ses valeurs par défaut) : il sert de gabarit pour que Bambu Studio
retrouve les filaments du projet.

ClickGen n'est affilié ni à Cherry, ni à Bambu Lab, ni à ClickerFactory.
ClickGen is not affiliated with Cherry, Bambu Lab or ClickerFactory.
