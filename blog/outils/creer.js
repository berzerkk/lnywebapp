// Crée un article EN BROUILLON dans la base, visuels compris.
//
//   node blog/outils/creer.js <fichier-de-definition.js> [http://localhost:8000]
//
// Le fichier de définition exporte un objet :
//   { titre, chapo, categorie, motCle, slug, titreSeo, metaDescription, corps, faq[], sources[], postsLi[] }
//
// ⚠️ postsLi est OBLIGATOIRE : trois versions du post LinkedIn, chacune avec son angle
//    d'accroche. L'outil REFUSE de créer l'article sans elles, et refuse aussi celles qui ne
//    respectent pas les règles (cf. posts-li.js). C'est ce qui rend la chose automatique :
//    générer un article, c'est générer ses posts.
// Le corps peut contenir {{ILLU_A}} et {{ILLU_B}} : ils sont remplacés par les illustrations
// générées pour cet article. Rien n'est publié — l'article apparaît en brouillon sur la page
// blog, visible de l'administration seule.
'use strict';
const path = require('path');
const { visuels } = require('./visuels');
const { verifierPosts } = require('./posts-li');

// ⚠️ LA CIBLE PAR DÉFAUT EST LA PRODUCTION, et c'est délibéré. Un article est une DONNÉE
// (db.json), pas du code : un git push ne l'emporte JAMAIS. Un article créé en local n'existe
// que sur le poste où il a été créé — l'utilisateur, lui, regarde le site en ligne et ne voit
// rien. Erreur commise deux fois ; le défaut a été inversé pour qu'elle ne se reproduise pas.
// Pour travailler en local : node blog/outils/creer.js <def.js> http://localhost:8000
const CIBLE_DEFAUT = process.env.LS_BASE || 'https://languagesandsuccess.com';
const IDENT_PROD = { email: 'admin@languagesandsuccess.com', motDePasse: process.env.LS_MDP_PROD || 'changez-ce-mot-de-passe' };
const IDENT_LOCAL = { email: process.env.LS_ADMIN || 'admin@ls.fr', motDePasse: process.env.LS_MDP || 'demo1234' };

async function creer(def, base) {
  // ⚠️ On vérifie AVANT de créer quoi que ce soit : un article créé sans ses posts serait à
  // reprendre à la main, et c'est exactement ce qu'on veut rendre impossible.
  const ctrl = verifierPosts(def.postsLi, def.motCle);
  // ⚠️ Tiret cadratin PROSCRIT du contenu publié (demande de l'utilisateur, 03/08/2026).
  // Contrôlé ici sur l'article, et dans verifierPosts sur les trois posts.
  const cadratins = [];
  const scruter = (ou, t) => { const n = (String(t == null ? '' : t).match(/—/g) || []).length; if (n) cadratins.push(ou + ' (' + n + ')'); };
  ['titre', 'chapo', 'titreSeo', 'metaDescription', 'corps'].forEach(k => scruter(k, def[k]));
  (def.faq || []).forEach((q, i) => { scruter('faq[' + i + '].q', q.q); scruter('faq[' + i + '].r', q.r); });
  (def.sources || []).forEach((s, i) => scruter('sources[' + i + '].titre', s.titre));
  if (cadratins.length) {
    ctrl.erreurs.push('tiret cadratin interdit dans : ' + cadratins.join(', ') + '. Employez deux-points, virgule, point ou parenthèses.');
  }
  if (ctrl.erreurs.length) {
    throw new Error("Contenu non conforme, rien n'a été créé :\n  - " + ctrl.erreurs.join('\n  - '));
  }
  const B = (base || CIBLE_DEFAUT).replace(/\/$/, '');
  const IDENT = /localhost|127\.0\.0\.1/.test(B) ? IDENT_LOCAL : IDENT_PROD;
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
      corps, faq: def.faq || [], sources: def.sources || [], postsLi: def.postsLi
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

  ctrl.alertes.forEach(a => alertes.push('LinkedIn — ' + a));
  return { article: art.article, visuels: imgs, alertes, postsLi: ctrl.mesures };
}

module.exports = { creer };

if (require.main === module) {
  const [fichier, base] = process.argv.slice(2);
  if (!fichier) { console.error('usage : node blog/outils/creer.js <definition.js> [base]'); process.exit(1); }
  const def = require(path.resolve(fichier));
  creer(def, base).then(r => {
    console.log('✔ brouillon créé sur ' + (base || CIBLE_DEFAUT) + ' : ' + r.article.titre);
    console.log('   adresse : /blog/' + r.article.slug);
    // les visuels sont écrits sur le disque : sans commit, la page en ligne pointe dans le vide
    console.log('   ⚠ pensez à committer blog/img/' + r.article.slug + '*.png — les visuels ne');
    console.log('     partent en ligne qu\'avec le déploiement, contrairement à l\'article.');
    r.visuels.forEach(v => console.log('   visuel  : ' + v.fichier + '  ' + v.ko + ' ko'));
    if (r.alertes.length) { console.log('   ⚠ ' + r.alertes.length + ' point(s) à revoir :'); r.alertes.forEach(a => console.log('     · ' + a)); }
    else console.log('   contrôles SEO : rien à signaler');
  }).catch(e => { console.error('✖ ' + e.message); process.exit(1); });
}
