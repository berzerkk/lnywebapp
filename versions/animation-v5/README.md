# Animation V5 — sauvegarde

Snapshot validé le 2026-06-04. Évolution de V3.

## Description
Logo **plat** rose-gold au centre d'un nuage de particules.
- **Rotation 360° pilotée en JS** avec vitesse non-linéaire (lent de face, rapide sur
  la tranche → l'instant « plat » est quasi imperceptible).
- **Reflet lumineux synchronisé à l'angle** (s'éteint quand le logo est de profil).
- **Scintillement des couleurs** (saturation/luminosité) + **lueur** pulsée.
- Nuage de particules : noyau additif, rayons asymétriques, 3 scènes (anneau →
  cerveau/réseau → peinture), **bloom** (flou additif global), **twinkles** dosés.
- **Pause hors-écran** (IntersectionObserver).
- ⚠️ Parallaxe souris **retirée** (le logo/nuage ne suivent plus le curseur).

## Fichiers
- `morph.js` — moteur complet (particules + pilotage du logo plat).
- `medallion.css` — règles CSS du médaillon (extrait de assets/site.css).
- `medallion.js` — pièce 3D Three.js (NON utilisée, réserve).

## Restaurer
1. Copier `morph.js` à la racine.
2. Recoller `medallion.css` dans `assets/site.css`.
3. Dans `index.html` : garder `<script src="morph.js"></script>` ; recréer le DOM
   `.morph-logo > .logo-img + .logo-sheen` est fait par morph.js. Ne pas charger de
   script de sphère/pièce 3D.
