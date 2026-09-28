// Globe du logo Coloris AU SURVOL (bandeau clients de l'accueil et de la page Entreprises), 28/09/2026.
// Au survol, le texte du logo passe à la couleur d'accent du site (#be6e54) ; le globe prend la même couleur
// en gardant ses différences de ton, sinon on ne reconnaîtrait plus le logo :
//   - l'anneau (ton d'origine #aea391) devient EXACTEMENT la couleur d'accent ;
//   - chaque tache est cette même couleur, plus claire ou plus foncée, DANS LE MÊME ORDRE qu'au repos ;
//   - clarté visée (OKLab) : L_accent + ECARTS × (L_origine − L_anneau) ; ECARTS = 0,8 resserre un peu les
//     écarts pour que le globe se lise d'une seule couleur ;
//   - teinte et saturation de l'accent ; pour les tons plus clairs, la saturation glisse vers celle du fond
//     (#f8f2e7), comme une couleur diluée ;
//   - transparence et bords lissés intacts : les deux images se superposent au pixel près.
// Remplace l'ancien filtre CSS (grayscale sepia saturate hue-rotate), qui donnait un jaune-orangé sans
// rapport avec l'accent. À relancer si l'accent du site ou le globe au repos changent :
//   node blog/outils/coloris-survol.js   → assets/clients/coloris-globe-survol.png
'use strict';
const path = require('path');
const Jimp = require('jimp');
const DOSSIER = path.resolve(__dirname, '..', '..', 'assets', 'clients');
const ACCENT = 'be6e54', FOND = 'f8f2e7', ANNEAU = 'aea391', ECARTS = 0.8;

const hex = (h) => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const srgb = (x) => { x = Math.max(0, Math.min(1, x)); return Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255); };
function oklab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function lineaire(L, a, b) { // OKLab → sRGB linéaire
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
const [La, aa, ba] = oklab(hex(ACCENT)), [Lf, af, bf] = oklab(hex(FOND)), Lanneau = oklab(hex(ANNEAU))[0];
function ton(L) {
  let a = aa, b = ba;
  if (L > La) { const t = Math.min(1, (L - La) / (Lf - La)); a = aa + t * (af - aa); b = ba + t * (bf - ba); }
  let rgb = lineaire(L, a, b), k = 1;
  while (rgb.some(v => v < 0 || v > 1) && k > 0) { k -= 0.02; rgb = lineaire(L, a * k, b * k); } // rester affichable
  return rgb.map(srgb);
}

(async () => {
  const img = await Jimp.read(path.join(DOSSIER, 'coloris-globe.png'));
  const d = img.bitmap.data, deja = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const cle = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let c = deja.get(cle);
    if (!c) { c = ton(La + ECARTS * (oklab([d[i], d[i + 1], d[i + 2]])[0] - Lanneau)); deja.set(cle, c); }
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];                // alpha inchangé
  }
  const sortie = path.join(DOSSIER, 'coloris-globe-survol.png');
  await img.writeAsync(sortie);
  console.log('image : ' + sortie + ' (' + img.bitmap.width + ' × ' + img.bitmap.height + ')');
})();
