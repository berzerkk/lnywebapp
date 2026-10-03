// node blog/outils/couverture-reste-a-charge-cpf.js → blog/img/reste-a-charge-cpf-350-euros-loi-de-finances-2027.jpg
// Couverture de l'article « Reste à charge CPF » : illustration dessinée (SVG), rendue par Edge sans
// fenêtre en 1200 × 630, puis enregistrée en JPEG. Une pièce d'un euro colossale dressée dans un
// paysage au crépuscule, une porte de lumière à sa base (la formation), quelques marches qui montent,
// et la petite silhouette en veste terracotta (#BE6E54), fil conducteur des couvertures du blog.
// Tout l'essentiel tient dans le carré central (x 285 → 915) : WhatsApp recadre l'aperçu en carré.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ICI = require('os').tmpdir();                   // page de travail et rendu PNG temporaires
const R = path.resolve(__dirname, '..', '..');           // racine du site
const b64 = (f) => fs.readFileSync(path.join(R, f)).toString('base64');

// pseudo-aléatoire reproductible (même image à chaque rendu)
let graine = 7;
const alea = () => { graine = (graine * 16807) % 2147483647; return (graine - 1) / 2147483646; };

// nuages : un cumulus = des boules serrées au sommet bosselé, base plate ; chaque boule porte un
// dégradé vertical (sommet clair, base sombre) et un reflet doré côté horizon
function nuage(cx, base, l, h, n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), bosse = Math.sin(t * Math.PI);           // plus haut au milieu
    const r = (0.35 + 0.65 * bosse) * h * (0.42 + alea() * 0.28);
    const x = cx - l / 2 + t * l + (alea() - 0.5) * l * 0.08;
    const y = base - r * (0.55 + alea() * 0.35) - bosse * h * 0.35;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#gBoule)"/>`;
  }
  // base plate : les boules sont coupées net à la hauteur de la base (comme un vrai cumulus),
  // puis une bande d'ombre douce souligne cette base
  const id = 'cN' + Math.round(cx) + '_' + Math.round(base);
  return `<clipPath id="${id}"><rect x="${(cx - l).toFixed(1)}" y="0" width="${(2 * l).toFixed(1)}" height="${base.toFixed(1)}"/></clipPath>`
    + `<g clip-path="url(#${id})">${s}</g>`
    + `<ellipse cx="${cx.toFixed(1)}" cy="${(base - 4).toFixed(1)}" rx="${(l * 0.46).toFixed(1)}" ry="${(h * 0.05).toFixed(1)}" fill="#B9603B" opacity=".55"/>`;
}
// crans de la tranche : petits traits tout autour du disque
function crans(cx, cy, r, n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, x1 = cx + Math.cos(a) * (r - 9), y1 = cy + Math.sin(a) * (r - 9), x2 = cx + Math.cos(a) * r, y2 = cy + Math.sin(a) * r;
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  return s;
}
// poussière dorée qui monte devant la pièce
function braises(n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = 470 + alea() * 260, y = 150 + alea() * 330, r = 0.8 + alea() * 1.8;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#FFE2A0" opacity="${(0.25 + alea() * 0.55).toFixed(2)}"/>`;
  }
  return s;
}

const CX = 600, CY = 282, RAY = 196;            // la pièce
const SOL = CY + RAY;                            // la pièce touche le sol ici (y = 478)
const PORTE = { l: 74, h: 112 };

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <linearGradient id="gCiel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1F4D47"/><stop offset=".38" stop-color="#2E6E63"/>
    <stop offset=".62" stop-color="#7FB2A2"/><stop offset=".74" stop-color="#F2C98A"/><stop offset=".80" stop-color="#F0A86A"/>
  </linearGradient>
  <radialGradient id="gHalo" cx="600" cy="470" r="520" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#FFE9B8" stop-opacity=".85"/><stop offset=".35" stop-color="#F6B57A" stop-opacity=".35"/><stop offset="1" stop-color="#F6B57A" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="gNuage" cx=".45" cy=".75" r=".8">
    <stop offset="0" stop-color="#FCE3C2"/><stop offset=".45" stop-color="#F2A65E"/><stop offset="1" stop-color="#C9663A"/>
  </radialGradient>
  <linearGradient id="gBoule" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFEBD2"/><stop offset=".42" stop-color="#F7B577"/><stop offset=".8" stop-color="#E07F4C"/><stop offset="1" stop-color="#C46A42"/>
  </linearGradient>
  <filter id="fFlou3" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.4"/></filter>
  <linearGradient id="gColline1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5E8A80"/><stop offset="1" stop-color="#3E625B"/></linearGradient>
  <linearGradient id="gColline2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#355650"/><stop offset="1" stop-color="#22383A"/></linearGradient>
  <linearGradient id="gSol" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A403C"/><stop offset="1" stop-color="#141F1E"/></linearGradient>
  <radialGradient id="gOr" cx="${CX - 70}" cy="${CY - 90}" r="${RAY * 1.35}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#FFF0C2"/><stop offset=".3" stop-color="#F2C879"/><stop offset=".72" stop-color="#C8913A"/><stop offset="1" stop-color="#7E5222"/>
  </radialGradient>
  <linearGradient id="gTranche" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE2A0"/><stop offset=".5" stop-color="#B9822F"/><stop offset="1" stop-color="#6B4519"/></linearGradient>
  <linearGradient id="gEuro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E9B95E"/><stop offset="1" stop-color="#9C6A27"/></linearGradient>
  <radialGradient id="gPorte" cx=".5" cy=".85" r=".9"><stop offset="0" stop-color="#FFFBEF"/><stop offset=".55" stop-color="#FFE6B0"/><stop offset="1" stop-color="#F3A65E"/></radialGradient>
  <radialGradient id="gFlaque" cx="${CX}" cy="${SOL + 30}" r="230" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#FFE3A6" stop-opacity=".75"/><stop offset=".5" stop-color="#F2A65E" stop-opacity=".22"/><stop offset="1" stop-color="#F2A65E" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="gChemin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9C48A"/><stop offset="1" stop-color="#6E5A40"/></linearGradient>
  <linearGradient id="gMarche" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3DDB3"/><stop offset="1" stop-color="#B89A6E"/></linearGradient>
  <linearGradient id="gBrume" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6D3A4" stop-opacity="0"/><stop offset=".55" stop-color="#F6D3A4" stop-opacity=".34"/><stop offset="1" stop-color="#F6D3A4" stop-opacity="0"/></linearGradient>
  <radialGradient id="gVignette" cx=".5" cy=".46" r=".75"><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#0B1413" stop-opacity=".55"/></radialGradient>
  <filter id="fFlou18" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="18"/></filter>
  <filter id="fFlou6" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="fFlou2"><feGaussianBlur stdDeviation="1.6"/></filter>
  <filter id="fLueur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="fGrain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" result="b"/>
    <feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .09"/></feComponentTransfer>
  </filter>
  <clipPath id="cPiece"><circle cx="${CX}" cy="${CY}" r="${RAY}"/></clipPath>
</defs>

<!-- ciel et halo de l'horizon -->
<rect width="1200" height="630" fill="url(#gCiel)"/>
<rect width="1200" height="630" fill="url(#gHalo)"/>

<!-- nuages -->
<!-- voile lointain, puis cumulus dessinés -->
<g filter="url(#fFlou18)" opacity=".55"><ellipse cx="260" cy="300" rx="300" ry="90" fill="#F2A65E"/><ellipse cx="960" cy="290" rx="320" ry="95" fill="#F2A65E"/></g>
<g filter="url(#fFlou3)" opacity=".62">${nuage(600, 168, 330, 70, 8)}</g>
<g filter="url(#fFlou3)">${nuage(205, 352, 430, 190, 12)}${nuage(1000, 345, 450, 205, 12)}</g>
<g filter="url(#fFlou3)" opacity=".9">${nuage(70, 380, 220, 110, 7)}${nuage(1150, 376, 200, 100, 7)}</g>

<!-- collines lointaines, puis proches -->
<path d="M0 452 C 120 420, 230 430, 330 444 S 520 452, 600 448 S 800 430, 900 438 S 1100 424, 1200 440 L1200 630 L0 630Z" fill="url(#gColline1)" opacity=".9"/>
<rect x="0" y="380" width="1200" height="120" fill="url(#gBrume)"/>
<path d="M0 486 C 140 466, 260 470, 380 480 S 560 476, 600 478 S 820 470, 960 474 S 1120 466, 1200 472 L1200 630 L0 630Z" fill="url(#gColline2)"/>
<path d="M0 512 C 200 500, 420 498, 600 500 S 1000 498, 1200 506 L1200 630 L0 630Z" fill="url(#gSol)"/>

<!-- lumière de la porte sur le sol -->
<ellipse cx="${CX}" cy="${SOL + 34}" rx="300" ry="70" fill="url(#gFlaque)"/>

<!-- ombre portée de la pièce -->
<ellipse cx="${CX + 18}" cy="${SOL + 6}" rx="${RAY * 0.78}" ry="12" fill="#0E1817" opacity=".55" filter="url(#fFlou6)"/>

<!-- la pièce : tranche, face dorée, anneau, euro en relief -->
<!-- épaisseur de la pièce (tranche visible à droite) -->
<circle cx="${CX + 15}" cy="${CY + 3}" r="${RAY}" fill="url(#gTranche)"/>
<g stroke="#5E3D15" stroke-width="1.6" opacity=".45">${crans(CX + 15, CY + 3, RAY, 150)}</g>
<circle cx="${CX}" cy="${CY}" r="${RAY}" fill="url(#gOr)"/>
<g stroke="#8A5A22" stroke-width="2.2" opacity=".55">${crans(CX, CY, RAY, 150)}</g>
<circle cx="${CX}" cy="${CY}" r="${RAY - 22}" fill="none" stroke="#A8742C" stroke-width="3" opacity=".7"/>
<circle cx="${CX}" cy="${CY}" r="${RAY - 27}" fill="none" stroke="#FFE7A8" stroke-width="1.4" opacity=".6"/>
<g clip-path="url(#cPiece)">
  <!-- étoiles de l'anneau, comme sur les pièces en euro -->
  ${Array.from({ length: 12 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 6, r = RAY - 46; const x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r; return `<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(.85)" d="M0 -8 L2.3 -2.5 L8 -2.4 L3.6 1.2 L5 6.8 L0 3.5 L-5 6.8 L-3.6 1.2 L-8 -2.4 L-2.3 -2.5Z" fill="#B07A30" opacity=".75"/>`; }).join('')}
  <!-- l'euro en relief : ombre, face, arête lumineuse -->
  <text x="${CX + 4}" y="${CY + 64}" text-anchor="middle" font-family="Newsreader, serif" font-weight="600" font-size="230" fill="#6E4718" opacity=".45">€</text>
  <text x="${CX}" y="${CY + 60}" text-anchor="middle" font-family="Newsreader, serif" font-weight="600" font-size="230" fill="url(#gEuro)">€</text>
  <text x="${CX - 2}" y="${CY + 58}" text-anchor="middle" font-family="Newsreader, serif" font-weight="600" font-size="230" fill="none" stroke="#FFF1C8" stroke-width="1.6" opacity=".55">€</text>
  <!-- reflet du soleil couchant sur la face -->
  <ellipse cx="${CX - 80}" cy="${CY - 96}" rx="120" ry="70" fill="#FFF6D8" opacity=".22" filter="url(#fFlou18)"/>
</g>

<!-- la porte de lumière à la base de la pièce -->
<path d="M${CX - PORTE.l / 2} ${SOL} L${CX - PORTE.l / 2} ${SOL - PORTE.h + PORTE.l / 2} A ${PORTE.l / 2} ${PORTE.l / 2} 0 0 1 ${CX + PORTE.l / 2} ${SOL - PORTE.h + PORTE.l / 2} L${CX + PORTE.l / 2} ${SOL}Z" fill="#FFE2A6" filter="url(#fLueur)" opacity=".9"/>
<path d="M${CX - PORTE.l / 2} ${SOL} L${CX - PORTE.l / 2} ${SOL - PORTE.h + PORTE.l / 2} A ${PORTE.l / 2} ${PORTE.l / 2} 0 0 1 ${CX + PORTE.l / 2} ${SOL - PORTE.h + PORTE.l / 2} L${CX + PORTE.l / 2} ${SOL}Z" fill="url(#gPorte)" stroke="#7E5222" stroke-width="2.5"/>

<!-- les marches qui montent vers la porte -->
${[0, 1, 2, 3].map(i => { const y = SOL + i * 11, l = 92 + i * 30, hh = 11; return `<path d="M${CX - l / 2} ${y} L${CX + l / 2} ${y} L${CX + l / 2 + 6} ${y + hh} L${CX - l / 2 - 6} ${y + hh}Z" fill="url(#gMarche)" stroke="#6E5A40" stroke-width=".8" opacity="${(1 - i * 0.06).toFixed(2)}"/>`; }).join('')}

<!-- le chemin, éclairé par la porte -->
<path d="M${CX - 66} ${SOL + 44} L${CX + 66} ${SOL + 44} L${CX + 96} 630 L${CX - 214} 630Z" fill="url(#gChemin)" opacity=".8"/>
<path d="M${CX - 66} ${SOL + 44} L${CX + 66} ${SOL + 44} L${CX + 96} 630 L${CX - 214} 630Z" fill="#0E1817" opacity=".22"/>
<!-- dalles du chemin, plus espacées vers le bas (perspective) -->
<g stroke="#3B3226" stroke-width="1.2" opacity=".38">${[0.07, 0.17, 0.3, 0.46, 0.66, 0.9].map(t => { const y = SOL + 44 + t * (630 - SOL - 44); const g = (CX - 66) + t * ((CX - 214) - (CX - 66)), d = (CX + 66) + t * ((CX + 96) - (CX + 66)); return `<line x1="${g.toFixed(1)}" y1="${y.toFixed(1)}" x2="${d.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')}</g>

<!-- poussière dorée -->
${braises(46)}

<!-- la silhouette, vue de dos, veste terracotta -->
<g transform="translate(${CX - 36} ${SOL + 92})">
  <ellipse cx="0" cy="25" rx="12" ry="3" fill="#0E1817" opacity=".5"/>
  <rect x="-5.2" y="10" width="4.2" height="15" rx="1.6" fill="#1E2422"/>
  <rect x="1" y="10" width="4.2" height="15" rx="1.6" fill="#1E2422"/>
  <path d="M-8 -6 Q-8 -10 -4 -11 L4 -11 Q8 -10 8 -6 L8.6 12 L-8.6 12Z" fill="#BE6E54"/>
  <path d="M-8.6 12 L8.6 12 L8 -6 Q8 -10 4 -11 L2 -11 L2 12Z" fill="#9C553F" opacity=".55"/>
  <circle cx="0" cy="-16.5" r="5.6" fill="#2A241D"/>
</g>

<!-- brume basse, vignette, grain -->
<rect x="0" y="470" width="1200" height="90" fill="url(#gBrume)" opacity=".6"/>
<rect width="1200" height="630" fill="url(#gVignette)"/>
<rect width="1200" height="630" filter="url(#fGrain)"/>
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Newsreader';font-style:normal;font-weight:300 700;src:url(data:font/woff2;base64,${b64('assets/fonts/newsreader-latin-normal.woff2')}) format('woff2')}
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#1F4D47}
svg{display:block}
</style></head><body>${svg}</body></html>`;

const page = path.join(ICI, 'illustration.html');
fs.writeFileSync(page, html);
fs.writeFileSync(path.join(ICI, 'illustration.svg'), svg);
const png = path.join(ICI, 'illustration.png');
const edge = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
execFileSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=4000',
  '--user-data-dir=' + path.join(require('os').tmpdir(), 'ls-illu-profil-edge'), '--screenshot=' + png, 'file:///' + page.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 90000 });

// JPEG 1200 × 630, qualité 92 : la fenêtre « Modifier » le réencode à 0,82 en l'envoyant (une seule perte sensible)
const Jimp = require(path.join(R, 'node_modules', 'jimp'));
const SORTIE = path.join(R, 'blog', 'img', 'reste-a-charge-cpf-350-euros-loi-de-finances-2027.jpg');
Jimp.read(png).then(im => im.quality(92).writeAsync(SORTIE)).then(() => console.log('couverture :', SORTIE, Math.round(fs.statSync(SORTIE).size / 1024) + ' ko')).catch(e => { console.error(e); process.exit(1); });
