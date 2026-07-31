// Crée un article EN BROUILLON dans la base, visuels compris.
//
//   node blog/outils/creer.js <fichier-de-definition.js> [http://localhost:8000]
//
// Le fichier de définition exporte un objet :
//   { titre, chapo, categorie, motCle, slug, titreSeo, metaDescription, corps, faq[], sources[] }
// Le corps peut contenir {{ILLU_A}} et {{ILLU_B}} : ils sont remplacés par les illustrations
// générées pour cet article. Rien n'est publié — l'article apparaît en brouillon sur la page
// blog, visible de l'administration seule.
'use strict';
const path = require('path');
const { visuels } = require('./visuels');

const IDENT = { email: process.env.LS_ADMIN || 'admin@ls.fr', motDePasse: process.env.LS_MDP || 'demo1234' };

async function creer(def, base) {
  const B = (base || 'http://localhost:8000').replace(/\/$/, '');
  const j = async (url, opt) => {
    const r = await fetch(B + url, opt);
    let d = null; try { d = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status + ' sur ' + url));
    return d;
  };

  const login = await j('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: IDENT.email, password: IDENT.motDePasse })
  });
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };

  const slug = def.slug || '';
  const imgs = await visuels(slug, def.categorie);
  const illu = (v, alt) => '      <img class="art-illu" src="/blog/img/' + slug + '-' + v + '.png" alt="' + alt + '" width="1200" height="500" />';
  const corps = String(def.corps || '')
    .replace(/\{\{ILLU_A\}\}/g, illu('a', (def.altA || def.titre)))
    .replace(/\{\{ILLU_B\}\}/g, illu('b', (def.altB || def.titre)));

  const art = await j('/api/blog/articles', {
    method: 'POST', headers: H,
    body: JSON.stringify({
      titre: def.titre, chapo: def.chapo, categorie: def.categorie, motCle: def.motCle,
      slug, titreSeo: def.titreSeo, metaDescription: def.metaDescription,
      image: '/blog/img/' + slug + '.png',
      corps, faq: def.faq || [], sources: def.sources || []
    })
  });

  // contrôles SEO immédiats — inutile de laisser passer un titre trop long
  const alertes = [];
  if ((def.titreSeo || '').length > 60) alertes.push('titre Google : ' + def.titreSeo.length + ' caractères (60 maximum)');
  if ((def.metaDescription || '').length < 150 || (def.metaDescription || '').length > 160) alertes.push('meta description : ' + (def.metaDescription || '').length + ' caractères (cible 150-160)');
  if ((def.faq || []).length < 4) alertes.push('FAQ : ' + (def.faq || []).length + ' questions (4 minimum)');
  if (!(def.sources || []).length) alertes.push('aucune source citée');
  const mc = (def.motCle || '').toLowerCase();
  if (mc && corps.toLowerCase().indexOf(mc) < 0) alertes.push('le mot-clé n\'apparaît pas dans le corps');
  if (mc && !/<h2[^>]*>[^<]*/i.test(corps)) alertes.push('aucun <h2> dans le corps');

  return { article: art.article, visuels: imgs, alertes };
}

module.exports = { creer };

if (require.main === module) {
  const [fichier, base] = process.argv.slice(2);
  if (!fichier) { console.error('usage : node blog/outils/creer.js <definition.js> [base]'); process.exit(1); }
  const def = require(path.resolve(fichier));
  creer(def, base).then(r => {
    console.log('✔ brouillon créé : ' + r.article.titre);
    console.log('   adresse : /blog/' + r.article.slug);
    r.visuels.forEach(v => console.log('   visuel  : ' + v.fichier + '  ' + v.ko + ' ko'));
    if (r.alertes.length) { console.log('   ⚠ ' + r.alertes.length + ' point(s) à revoir :'); r.alertes.forEach(a => console.log('     · ' + a)); }
    else console.log('   contrôles SEO : rien à signaler');
  }).catch(e => { console.error('✖ ' + e.message); process.exit(1); });
}
