// Images d'aperçu du site (og:image, 1200 × 630), rendues par Edge sans fenêtre, avec les polices et
// les couleurs du site (25/09/2026). Elles s'écrivent directement dans assets/ :
//   node blog/outils/og-images.js general  → assets/og-cover.png          (toutes les pages sauf l'espace documents)
//   node blog/outils/og-images.js espace   → assets/og-espace-documents.png
// Polices et logo EMBARQUÉS (base64) : une page locale ne peut pas charger une police locale (CORS).
// ⚠️ Tout le message tient dans le CARRÉ CENTRAL (x 285 → 915) : WhatsApp, iMessage et d'autres
// découpent l'aperçu en carré au centre ; les décors des côtés peuvent tomber sans dommage.
// ⚠️ Après avoir refait og-cover.png, faire avancer ?v= dans la balise og:image des pages (et dans le
// repli des articles de server.js) : les réseaux gardent en mémoire l'image d'une adresse déjà vue.
// Edge : chemin par défaut de Windows, ou variable d'environnement EDGE.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const R = path.resolve(__dirname, '..', '..');           // racine du site
const D = require('os').tmpdir();                           // page de travail et profil Edge temporaires
const b64 = (f) => fs.readFileSync(path.join(R, f)).toString('base64');
const police = (fam, style, f) => `@font-face{font-family:'${fam}';font-style:${style};font-weight:300 700;src:url(data:font/woff2;base64,${b64(f)}) format('woff2')}`;
const quoi = process.argv[2] || 'general';

const commun = `
${police('Newsreader', 'normal', 'assets/fonts/newsreader-latin-normal.woff2')}
${police('Newsreader', 'italic', 'assets/fonts/newsreader-latin-italic.woff2')}
${police('Work Sans', 'normal', 'assets/fonts/worksans-latin-normal.woff2')}
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{position:relative;background:#f8f2e7;font-family:'Work Sans',sans-serif;color:#2a241d}
.lueur{position:absolute;border-radius:50%;filter:blur(8px)}
.l1{width:620px;height:620px;right:-170px;top:-250px;background:radial-gradient(circle,rgba(243,173,153,.42),rgba(243,173,153,0) 68%)}
.l2{width:560px;height:560px;left:-190px;bottom:-260px;background:radial-gradient(circle,rgba(190,110,84,.20),rgba(190,110,84,0) 68%)}
.cadre{position:absolute;inset:26px;border:1.5px solid rgba(190,110,84,.28);border-radius:22px}
main{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:560px;text-align:center}
.logo{display:block;width:138px;height:auto;margin:0 auto 20px;filter:drop-shadow(0 10px 18px rgba(42,33,24,.14))}
.trait{width:66px;height:2px;border-radius:2px;background:#be6e54;margin:24px auto 20px}
em{font-style:italic;color:#be6e54}
`;

const pages = {
  espace: {
    fichier: 'og-espace-documents.png',
    css: `
h1{font-family:'Newsreader',serif;font-weight:500;font-size:74px;line-height:1.02;letter-spacing:-.6px;margin:0}
.marque{font-family:'Newsreader',serif;font-weight:400;font-size:31px;margin:0;letter-spacing:.2px}
.sous{font-size:21px;color:#6b6055;margin:14px 0 0;letter-spacing:.3px}
.feuille{position:absolute;width:176px;height:236px;background:#fffaf0;border:1px solid #e6dccb;border-radius:14px;box-shadow:0 22px 44px -22px rgba(42,33,24,.35);padding:22px 20px;box-sizing:border-box}
.f1{left:78px;top:186px;transform:rotate(-7deg)}
.f2{right:78px;top:196px;transform:rotate(6deg)}
.ligne{height:7px;border-radius:4px;background:#ede3d2;margin:0 0 11px}
.ligne.t{height:9px;width:62%;background:#be6e54;opacity:.75;margin-bottom:17px}
.ligne.c{width:78%}.ligne.m{width:88%}
.sig{position:absolute;left:20px;bottom:22px;width:112px;height:44px}
.coche{position:absolute;right:18px;bottom:18px;width:46px;height:46px;border-radius:50%;background:#be6e54;display:flex;align-items:center;justify-content:center}`,
    corps: `
<div class="feuille f1"><div class="ligne t"></div><div class="ligne"></div><div class="ligne m"></div><div class="ligne c"></div><div class="ligne"></div>
<svg class="sig" viewBox="0 0 112 44" fill="none" stroke="#be6e54" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 30c8-14 14-22 18-20s-8 22-2 22 12-20 18-18-4 16 2 16 10-12 16-12 4 8 10 8 12-6 20-8"/><path d="M8 40h96" stroke="#e6dccb" stroke-width="1.6"/></svg></div>
<div class="feuille f2"><div class="ligne t"></div><div class="ligne m"></div><div class="ligne"></div><div class="ligne c"></div><div class="ligne m"></div><div class="ligne c"></div>
<div class="coche"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div></div>
<main><img class="logo" src="data:image/png;base64,${b64('assets/ls-logo.png')}" alt="">
<h1>Espace documents</h1><div class="trait"></div>
<p class="marque">Languages <em>&amp;</em> Success</p><p class="sous">Dossiers · documents · signatures</p></main>`
  },
  general: {
    fichier: 'og-cover.png',
    css: `
h1{font-family:'Newsreader',serif;font-weight:500;font-size:60px;line-height:1.05;letter-spacing:-.4px;margin:0;white-space:nowrap;display:inline-block}
.sous{font-family:'Newsreader',serif;font-weight:400;font-size:30px;margin:0;letter-spacing:.1px}
.info{font-size:20px;color:#6b6055;margin:14px 0 0;letter-spacing:.3px}
.bulle{position:absolute;padding:14px 26px 16px;background:#fffaf0;border:1px solid #e6dccb;border-radius:20px;box-shadow:0 20px 40px -22px rgba(42,33,24,.35);
  font-family:'Newsreader',serif;font-style:italic;font-size:34px;line-height:1;color:#be6e54}
.bulle::after{content:'';position:absolute;bottom:-9px;width:18px;height:18px;background:#fffaf0;border-right:1px solid #e6dccb;border-bottom:1px solid #e6dccb}
.bg::after{left:30px;transform:rotate(45deg)}
.bd::after{right:30px;transform:rotate(45deg)}
.b1{left:92px;top:170px;transform:rotate(-6deg)}
.b2{left:132px;top:330px;transform:rotate(4deg)}
.b3{right:96px;top:176px;transform:rotate(5deg)}
.b4{right:128px;top:338px;transform:rotate(-5deg)}`,
    corps: `
<div class="bulle bg b1">Hello</div><div class="bulle bg b2">Hola</div>
<div class="bulle bd b3">Ciao</div><div class="bulle bd b4">Hallo</div>
<main><img class="logo" src="data:image/png;base64,${b64('assets/ls-logo.png')}" alt="">
<h1 id="t">Languages <em>&amp;</em> Success</h1><div class="trait"></div>
<p class="sous">Formations en langues sur mesure</p><p class="info">Nice · Certifié Qualiopi · CPF, OPCO, entreprises</p></main>
<script>
  // le nom tient sur UNE ligne et dans le carré central : on réduit la taille jusqu'à ce qu'il y tienne
  document.fonts.ready.then(function () { var h = document.getElementById('t'), s = 60; while (h.getBoundingClientRect().width > 530 && s > 36) { s -= 1; h.style.fontSize = s + 'px'; } document.body.setAttribute('data-taille', s); });
</script>`
  }
};

const p = pages[quoi]; if (!p) throw new Error('general ou espace');
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${commun}${p.css}</style></head><body>
<div class="lueur l1"></div><div class="lueur l2"></div><div class="cadre"></div>${p.corps}
</body></html>`;
const page = path.join(D, 'ls-og-' + quoi + '.html'); fs.writeFileSync(page, html);
const edge = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const out = path.join(R, 'assets', p.fichier);
try { fs.unlinkSync(out); } catch (e) { }
// --virtual-time-budget : laisse les polices se charger et le réglage de taille s'exécuter avant la capture
execFileSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=4000',
  '--user-data-dir=' + path.join(D, 'ls-og-profil-edge'), '--screenshot=' + out, 'file:///' + page.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 90000 });
console.log(fs.existsSync(out) ? 'image : ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' ko)' : 'ÉCHEC : aucune image produite');
