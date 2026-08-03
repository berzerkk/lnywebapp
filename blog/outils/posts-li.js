// Règles des posts LinkedIn d'un article, et leur contrôle.
//
// ⚠️ RÈGLE DE FONCTIONNEMENT : un article NE PEUT PAS être créé sans ses trois posts.
// creer.js refuse. Ce n'est pas une politesse, c'est ce qui rend la chose automatique :
// on ne peut pas oublier ce que l'outil exige.
'use strict';

// Les trois angles d'accroche. Un même article, trois entrées en matière différentes :
// on choisit celle qui colle au moment de publier.
const ANGLES = ['La question', 'Le chiffre', 'Le terrain'];

// LinkedIn replie le texte au-delà d'environ 210 caractères (« …voir plus »). Tout ce qui
// décide de la lecture — l'accroche — et tout ce que la recherche indexe le mieux — le
// mot-clé — doit tenir avant ce pli.
const ACCROCHE_MAX = 210;
const MOTCLE_AVANT = 250;

const norm = (s) => String(s == null ? '' : s)
  .replace(/’/g, "'")            // l'apostrophe typographique du mot-clé n'est pas celle du texte
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ');

// Retourne { erreurs, alertes, mesures }. Une erreur bloque la création, une alerte s'affiche.
function verifierPosts(posts, motCle) {
  const erreurs = [], alertes = [], mesures = [];
  if (!Array.isArray(posts) || posts.length !== 3) {
    erreurs.push('il faut EXACTEMENT trois versions du post LinkedIn (postsLi), ' + ((posts || []).length) + ' fournie(s)');
    return { erreurs, alertes, mesures };
  }
  const mc = norm(motCle);
  posts.forEach((p, i) => {
    const nom = 'version ' + (i + 1) + ' (' + (p && p.angle ? p.angle : '?') + ')';
    const t = (p && p.texte) || '';
    if (!t.trim()) { erreurs.push(nom + ' : texte vide'); return; }

    const accroche = t.split('\n')[0].trim();
    const pos = mc ? norm(t).indexOf(mc) : 0;
    const tags = (t.match(/#[\wÀ-ÿ]+/g) || []).length;
    const lien = /https?:\/\//.test(t);

    if (!accroche) erreurs.push(nom + ' : pas d\'accroche en première ligne');
    if (accroche.length > ACCROCHE_MAX) erreurs.push(nom + ' : accroche de ' + accroche.length + ' caractères (' + ACCROCHE_MAX + ' maximum, sinon elle est repliée)');
    if (mc && pos < 0) erreurs.push(nom + ' : le mot-clé « ' + motCle + ' » n\'apparaît pas');
    else if (mc && pos > MOTCLE_AVANT) erreurs.push(nom + ' : mot-clé au caractère ' + pos + ' (avant ' + MOTCLE_AVANT + ', sinon il est sous le pli)');
    if (tags < 3) erreurs.push(nom + ' : ' + tags + ' hashtag(s), 3 minimum');
    if (tags > 5) alertes.push(nom + ' : ' + tags + ' hashtags, 5 suffisent');
    if (lien) erreurs.push(nom + ' : un lien dans le corps réduit la portée — renvoyez au premier commentaire');
    if (!/commentaire/i.test(t)) alertes.push(nom + ' : ne renvoie pas au premier commentaire');
    if (t.length > 2600) alertes.push(nom + ' : ' + t.length + ' caractères (LinkedIn coupe à 3000)');

    // deux fois la même phrase longue dans un même post : signe d'un copier-coller mal recousu
    const vues = {};
    t.split(/[.\n]/).map(x => x.trim()).filter(x => x.split(' ').length > 8)
      .forEach(x => { if (vues[x]) alertes.push(nom + ' : phrase répétée — « ' + x.slice(0, 50) + '… »'); vues[x] = 1; });

    mesures.push(nom + ' : ' + t.length + ' car., accroche ' + accroche.length + ', mot-clé au ' + pos + ', ' + tags + ' hashtags');
  });
  return { erreurs, alertes, mesures };
}

module.exports = { ANGLES, verifierPosts, ACCROCHE_MAX, MOTCLE_AVANT };
