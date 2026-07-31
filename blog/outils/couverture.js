// Génère l'image de couverture d'un article : un visuel SVG éditorial, aux couleurs du site.
//
// Pourquoi du SVG plutôt qu'une photo : aucune dépendance, aucun compte de banque d'images à
// renouveler, un fichier de ~2 ko qui reste net sur tous les écrans, et une identité visuelle
// cohérente d'un article à l'autre. La composition est DÉTERMINISTE (dérivée de l'identifiant
// de l'article) : le même article donne toujours la même image, mais deux articles diffèrent.
//
//   node blog/outils/couverture.js <slug> "<Catégorie>"     → écrit blog/img/<slug>.svg
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const IMG = path.join(RACINE, 'blog', 'img');
const L = 1200, H = 630;   // ratio proche du 1.91:1 attendu par les aperçus de partage

// palette du site (assets/site.css)
const CREME = '#f8f2e7', CARTE = '#fffaf0', ENCRE = '#2a241d';
const TEINTES = ['#be6e54', '#cf855f', '#a8593c', '#e8b9a6', '#f3ad99'];

// petit générateur pseudo-aléatoire déterministe : même slug → même composition
function graine(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function suite(g) { let x = g || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

const echapper = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function couverture(slug, categorie) {
  const r = suite(graine(slug || 'ls'));
  const t1 = TEINTES[Math.floor(r() * TEINTES.length)];
  const t2 = TEINTES[Math.floor(r() * TEINTES.length)];
  const t3 = TEINTES[Math.floor(r() * TEINTES.length)];

  // trois disques doux, posés dans des zones différentes pour éviter les compositions plates
  const disques = [
    { cx: 150 + r() * 220, cy: 90 + r() * 160, rr: 190 + r() * 130, c: t1, o: 0.30 },
    { cx: 780 + r() * 300, cy: 340 + r() * 200, rr: 210 + r() * 150, c: t2, o: 0.26 },
    { cx: 520 + r() * 260, cy: 60 + r() * 120, rr: 130 + r() * 90, c: t3, o: 0.20 }
  ].map(d => `<circle cx="${d.cx.toFixed(0)}" cy="${d.cy.toFixed(0)}" r="${d.rr.toFixed(0)}" fill="${d.c}" opacity="${d.o}" />`).join('');

  // deux arcs fins : ce sont eux qui donnent le côté « éditorial » plutôt que « fond coloré »
  const a1 = 260 + r() * 160, a2 = 420 + r() * 220;
  const arcs =
    `<circle cx="${(L * 0.72).toFixed(0)}" cy="${(H * 0.30).toFixed(0)}" r="${a1.toFixed(0)}" fill="none" stroke="${t1}" stroke-opacity="0.34" stroke-width="2" />` +
    `<circle cx="${(L * 0.24).toFixed(0)}" cy="${(H * 0.82).toFixed(0)}" r="${a2.toFixed(0)}" fill="none" stroke="${t2}" stroke-opacity="0.26" stroke-width="2" />`;

  const cat = String(categorie || '').toUpperCase();

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${H}" width="${L}" height="${H}" role="img" aria-label="Illustration — ${echapper(categorie)}">
  <defs>
    <linearGradient id="f" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${CARTE}"/><stop offset="1" stop-color="${CREME}"/>
    </linearGradient>
    <clipPath id="c"><rect width="${L}" height="${H}"/></clipPath>
  </defs>
  <rect width="${L}" height="${H}" fill="url(#f)"/>
  <g clip-path="url(#c)">${disques}${arcs}</g>
  <g clip-path="url(#c)" opacity="0.9">
    <rect x="72" y="${H - 132}" width="54" height="3" fill="${t1}"/>
    <text x="72" y="${H - 92}" font-family="'Work Sans', system-ui, sans-serif" font-size="26" font-weight="600" letter-spacing="6" fill="${t1}">${echapper(cat)}</text>
    <text x="72" y="${H - 52}" font-family="'Work Sans', system-ui, sans-serif" font-size="19" letter-spacing="2" fill="${ENCRE}" opacity="0.55">LANGUAGES &amp; SUCCESS</text>
  </g>
</svg>
`;
}

function ecrire(slug, categorie) {
  fs.mkdirSync(IMG, { recursive: true });
  const cible = path.join(IMG, slug + '.svg');
  fs.writeFileSync(cible, couverture(slug, categorie));
  return 'blog/img/' + slug + '.svg';
}

module.exports = { couverture, ecrire };

if (require.main === module) {
  const [slug, categorie] = process.argv.slice(2);
  if (!slug) { console.error('usage : node blog/outils/couverture.js <slug> "<Catégorie>"'); process.exit(1); }
  console.log('✔ ' + ecrire(slug, categorie || 'Conseils'));
}
