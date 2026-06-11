# Animation V3 — sauvegarde

Snapshot de l'animation du héros (logo + nuage de particules) validée le 2026-06-04.

## Description
- **Logo plat rose-gold** (`assets/ls-logo.png`) au centre :
  - rotation **360°** continue (axe Y, ~13 s/tour) ;
  - **scintillement des couleurs** (saturation + luminosité qui pulsent) ;
  - **reflet lumineux** qui balaie le sceau (effet métal) ;
  - **halo chaud** qui pulse.
- **Nuage de particules 3D** autour (`morph.js`) : noyau lumineux additif,
  rayons asymétriques, 3 scènes en boucle (anneau → cerveau/réseau → peinture).

## Fichiers de ce snapshot
- `morph.js` — moteur canvas des particules + lueur (copie).
- `medallion.css` — règles CSS du médaillon (extrait de `assets/site.css`).
- `medallion.js` — pièce 3D Three.js (NON utilisée en V3, gardée en réserve).

## Restaurer cette version
1. Copier `morph.js` à la racine du projet.
2. Recoller le bloc de `medallion.css` dans `assets/site.css` (zone `.medallion-stage`).
3. Dans `index.html`, garder `<script src="morph.js"></script>` et NE PAS charger `medallion.js`.
