// Visuels d'un article : la couverture ET les illustrations de section.
//
// En PNG et non en SVG : aucune plateforme sociale n'accepte le SVG comme image de partage
// (vérifié le 31/07/2026 — Instagram n'accepte que le JPEG, LinkedIn JPG/GIF/PNG, et il faut
// même y téléverser l'image au préalable pour obtenir une vignette).
//
// La composition est DÉTERMINISTE, dérivée de l'identifiant de l'article : le même article
// donne toujours le même visuel, deux articles en donnent deux différents.
//
//   node blog/outils/visuels.js <slug> "<Catégorie>" ["<Titre>"]
//     → blog/img/<slug>.png        couverture 1200×630 (partage, vignette, tête d'article)
//     → blog/img/<slug>-a.png      illustration de section 1200×500
//     → blog/img/<slug>-b.png      idem, autre composition
'use strict';
const fs = require('fs');
const path = require('path');
const Jimp = require(path.resolve(__dirname, '..', '..', 'node_modules', 'jimp'));

const RACINE = path.resolve(__dirname, '..', '..');
const IMG = path.join(RACINE, 'blog', 'img');

// palette du site (assets/site.css)
const CREME = { r: 248, g: 242, b: 231 };
const CARTE = { r: 255, g: 250, b: 240 };
const ENCRE = { r: 42, g: 36, b: 29 };
const TEINTES = [
  { r: 190, g: 110, b: 84 },   // accent
  { r: 207, g: 133, b: 95 },
  { r: 168, g: 89, b: 60 },
  { r: 232, g: 185, b: 166 },
  { r: 243, g: 173, b: 153 }
];

// suite pseudo-aléatoire déterministe : même slug → même image
function graine(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function suite(g) { let x = g || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

const mel = (a, b, t) => ({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) });
const ent = (c) => Jimp.rgbaToInt(c.r, c.g, c.b, 255);

function fondDegrade(img, L, H) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < L; x++) {
      img.setPixelColor(ent(mel(CARTE, CREME, (x / L * 0.6 + y / H * 0.4))), x, y);
    }
  }
}
// disque doux : l'opacité décroît vers le bord, ce qui évite l'effet « pastille »
function disque(img, L, H, cx, cy, r, teinte, alphaMax) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(L, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H, Math.ceil(cy + r));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      const a = alphaMax * (1 - Math.pow(d / r, 2.2));
      if (a <= 0.002) continue;
      const f = img.getPixelColor(x, y);
      const cur = { r: (f >> 24) & 255, g: (f >> 16) & 255, b: (f >> 8) & 255 };
      img.setPixelColor(ent(mel(cur, teinte, a)), x, y);
    }
  }
}
// anneau fin : c'est lui qui donne le côté « dessiné » plutôt que « fond coloré »
function anneau(img, L, H, cx, cy, r, ep, teinte, alpha) {
  const x0 = Math.max(0, Math.floor(cx - r - ep)), x1 = Math.min(L, Math.ceil(cx + r + ep));
  const y0 = Math.max(0, Math.floor(cy - r - ep)), y1 = Math.min(H, Math.ceil(cy + r + ep));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.abs(Math.hypot(x - cx, y - cy) - r);
      if (d > ep) continue;
      const a = alpha * (1 - d / ep);
      const f = img.getPixelColor(x, y);
      const cur = { r: (f >> 24) & 255, g: (f >> 16) & 255, b: (f >> 8) & 255 };
      img.setPixelColor(ent(mel(cur, teinte, a)), x, y);
    }
  }
}
// trame de points : la signature graphique du site (le fond des sections en porte une)
function trame(img, L, H, pas, teinte, alpha) {
  for (let y = pas; y < H; y += pas) {
    for (let x = pas; x < L; x += pas) {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const px = x + dx, py = y + dy;
        if (px >= L || py >= H) continue;
        const f = img.getPixelColor(px, py);
        const cur = { r: (f >> 24) & 255, g: (f >> 16) & 255, b: (f >> 8) & 255 };
        img.setPixelColor(ent(mel(cur, teinte, alpha)), px, py);
      }
    }
  }
}
function barre(img, x, y, l, h, teinte) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + l; i++) img.setPixelColor(ent(teinte), i, j);
}

async function composer(slug, categorie, opts) {
  const o = opts || {};
  const L = o.largeur || 1200, H = o.hauteur || 630;
  const r = suite(graine(slug + (o.variante || '')));
  const img = new Jimp(L, H, ent(CREME));
  fondDegrade(img, L, H);
  trame(img, L, H, 26, TEINTES[0], 0.05);

  const t1 = TEINTES[Math.floor(r() * TEINTES.length)];
  const t2 = TEINTES[Math.floor(r() * TEINTES.length)];
  const t3 = TEINTES[Math.floor(r() * TEINTES.length)];

  disque(img, L, H, L * (0.10 + r() * 0.22), H * (0.12 + r() * 0.28), Math.min(L, H) * (0.30 + r() * 0.18), t1, 0.34);
  disque(img, L, H, L * (0.66 + r() * 0.26), H * (0.52 + r() * 0.32), Math.min(L, H) * (0.32 + r() * 0.22), t2, 0.28);
  disque(img, L, H, L * (0.42 + r() * 0.22), H * (0.06 + r() * 0.16), Math.min(L, H) * (0.18 + r() * 0.12), t3, 0.22);
  anneau(img, L, H, L * (0.74 + r() * 0.12), H * (0.26 + r() * 0.2), Math.min(L, H) * (0.42 + r() * 0.2), 2.2, t1, 0.38);
  anneau(img, L, H, L * (0.18 + r() * 0.14), H * (0.82 + r() * 0.14), Math.min(L, H) * (0.5 + r() * 0.24), 2.2, t2, 0.3);

  if (o.libelle !== false) {
    const petit = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
    const moyen = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
    barre(img, 72, H - 128, 54, 3, TEINTES[0]);
    img.print(moyen, 70, H - 112, String(categorie || '').toUpperCase());
    img.print(petit, 72, H - 62, 'LANGUAGES & SUCCESS');
  }

  fs.mkdirSync(IMG, { recursive: true });
  const nom = slug + (o.variante ? '-' + o.variante : '') + '.png';
  await img.quality(90).writeAsync(path.join(IMG, nom));
  return { fichier: 'blog/img/' + nom, ko: Math.round(fs.statSync(path.join(IMG, nom)).size / 1024) };
}

// couverture + deux illustrations de section
async function visuels(slug, categorie) {
  const out = [];
  out.push(await composer(slug, categorie, {}));
  out.push(await composer(slug, categorie, { variante: 'a', hauteur: 500, libelle: false }));
  out.push(await composer(slug, categorie, { variante: 'b', hauteur: 500, libelle: false }));
  return out;
}

module.exports = { visuels, composer };

if (require.main === module) {
  const [slug, categorie] = process.argv.slice(2);
  if (!slug) { console.error('usage : node blog/outils/visuels.js <slug> "<Catégorie>"'); process.exit(1); }
  visuels(slug, categorie || 'Conseils').then(l => l.forEach(x => console.log('✔ ' + x.fichier + '  ' + x.ko + ' ko')));
}
