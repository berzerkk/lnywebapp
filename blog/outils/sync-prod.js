// Recopie en PRODUCTION les articles et les posts LinkedIn qui n'y sont pas.
// ⚠️ Un article est une DONNÉE (db.json), pas du code : un git push ne l'emporte pas.
// Le volume ls-data survit aux déploiements, donc ce qui est ici reste ici.
const PROD = 'https://languagesandsuccess.com';
const LOCAL = 'http://localhost:8000';

const POSTS = require('C:/Users/luluz/Documents/Claude/L&S/blog/posts-linkedin.js');

const appel = async (base, url, opt) => {
  const r = await fetch(base + url, opt);
  let d = null; try { d = await r.json(); } catch (e) {}
  return { s: r.status, d };
};

(async () => {
  const co = async (base, email, mdp) => (await appel(base, '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: mdp })
  })).d;

  // ⚠️ admin@ls.fr n'existe plus (compte admin de démo retiré le 05/08/2026) : les deux bases
  // utilisent le compte administrateur permanent.
  // ⚠️ AUCUN MOT DE PASSE EN CLAIR ICI : le dépôt GitHub est PUBLIC.  PowerShell :
  //     $env:LS_MDP_PROD = '…'
  const MDP = process.env.LS_MDP_PROD || '';
  if (!MDP) { console.error("Mot de passe administrateur absent : posez $env:LS_MDP_PROD avant de relancer."); return; }
  const L = await co(LOCAL, 'admin@languagesandsuccess.com', MDP);
  const P = await co(PROD, 'admin@languagesandsuccess.com', MDP);
  if (!L || !L.token) { console.error('connexion locale impossible'); return; }
  if (!P || !P.token) { console.error('connexion prod impossible'); return; }
  const HL = { Authorization: 'Bearer ' + L.token }, HP = { Authorization: 'Bearer ' + P.token, 'Content-Type': 'application/json' };

  const locaux = (await appel(LOCAL, '/api/blog/articles', { headers: HL })).d.articles;
  const prods = (await appel(PROD, '/api/blog/articles', { headers: HP })).d.articles;
  const parSlug = {}; prods.forEach(a => { parSlug[a.slug] = a; });

  for (const s of locaux) {
    const plein = (await appel(LOCAL, '/api/blog/articles/' + s.id, { headers: HL })).d.article;
    const corps = {
      titre: plein.titre, chapo: plein.chapo, categorie: plein.categorie, motCle: plein.motCle,
      slug: plein.slug, titreSeo: plein.titreSeo, metaDescription: plein.metaDescription,
      corps: plein.corps, faq: plein.faq || [], sources: plein.sources || [],
      image: plein.image, postsLi: POSTS[plein.slug] || plein.postsLi || []
    };
    const existant = parSlug[plein.slug];
    if (!existant) {
      const r = await appel(PROD, '/api/blog/articles', { method: 'POST', headers: HP, body: JSON.stringify(corps) });
      console.log((r.s === 200 ? '＋ créé   ' : '✗ échec  ') + plein.slug + (r.s !== 200 ? ' (' + r.s + ')' : ''));
      // le POST ignore certains champs : on complète par un PATCH
      if (r.s === 200) {
        const p2 = await appel(PROD, '/api/blog/articles/' + r.d.article.id, { method: 'PATCH', headers: HP, body: JSON.stringify(corps) });
        if (p2.s !== 200) console.log('   ✗ complément : ' + p2.s);
      }
    } else {
      const r = await appel(PROD, '/api/blog/articles/' + existant.id, { method: 'PATCH', headers: HP, body: JSON.stringify({ postsLi: corps.postsLi }) });
      console.log((r.s === 200 ? '↻ posts   ' : '✗ échec  ') + plein.slug);
    }
  }

  // contrôle final, vu depuis la production
  const apres = (await appel(PROD, '/api/blog/articles', { headers: HP })).d.articles;
  console.log('\nEn production : ' + apres.length + ' articles');
  for (const a of apres) {
    const p = (await appel(PROD, '/api/blog/articles/' + a.id, { headers: HP })).d.article;
    console.log('  [' + a.statut + '] ' + a.slug + ' — ' + ((p.postsLi || []).length) + ' post(s), image ' + (p.image ? 'ok' : 'MANQUANTE'));
  }
})();
