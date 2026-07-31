// Mécanique du blog : lecture du fichier de sujets, génération de l'index, mise en ligne d'un
// brouillon. La RÉDACTION n'est pas ici — elle est faite par Claude lors de la tâche planifiée ;
// ce script ne s'occupe que de ce qui doit être mécanique et reproductible.
//
//   node blog/outils/blog.js sujets              → tous les sujets, en JSON
//   node blog/outils/blog.js sujets --jour       → le sujet prévu aujourd'hui (rien sinon)
//   node blog/outils/blog.js sujets --jour 2026-08-03
//   node blog/outils/blog.js planning            → le planning en clair (pour Slack)
//   node blog/outils/blog.js statut <slug> <statut> [fichier]
//   node blog/outils/blog.js index               → régénère la grille de blog.html + sitemap.xml
//   node blog/outils/blog.js sitemap             → régénère seulement sitemap.xml
//   node blog/outils/blog.js publier <slug>      → brouillon → en ligne, puis régénère l'index
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const BLOG = path.join(RACINE, 'blog');
const BROUILLONS = path.join(BLOG, 'brouillons');
const SUJETS = path.join(BLOG, 'sujets.md');
const INDEX = path.join(RACINE, 'blog.html');
const NL = '\n';

// ---------------------------------------------------------------- utilitaires
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function aujourdhui() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dateLisible(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return JOURS[d.getDay()] + ' ' + (+m[3]) + ' ' + MOIS[+m[2] - 1] + ' ' + m[1];
}
// « CPF : financer sa formation » → « cpf-financer-sa-formation »
function slugifier(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, ' ').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 70);
}
const echapper = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------- lecture des sujets
// Format d'une entrée (cf. blog/sujets.md) :
//   ### 2026-08-03 — Titre du sujet          (la date est facultative : sans elle, « en réserve »)
//   - **Catégorie** : Financement
//   - **Statut** : planifié | brouillon | publié
//   - **Angle** : …
//   - **Sources** :
//     - https://…
//   - **Notes** : …
//   - **Fichier** : cpf-financer.html        (écrit par le script à la création du brouillon)
function lireSujets() {
  if (!fs.existsSync(SUJETS)) return [];
  // ⚠️ on retire d'abord les blocs de code : le mode d'emploi en tête de fichier contient un
  // exemple de sujet, qui serait sinon lu comme un vrai sujet à publier.
  const texte = fs.readFileSync(SUJETS, 'utf8').replace(/^```[\s\S]*?^```/gm, '');
  const blocs = texte.split(/^###\s+/m).slice(1);
  return blocs.map(bloc => {
    const lignes = bloc.split(/\r?\n/);
    const entete = lignes[0].trim();
    // « 2026-08-03 — Titre » ou « Titre »
    const m = /^(\d{4}-\d{2}-\d{2})\s*(?:\(([^)]*)\))?\s*[—–-]?\s*(.*)$/.exec(entete);
    const date = m && m[1] ? m[1] : null;
    const titre = (m && m[3] ? m[3] : entete).trim();
    // un champ peut courir sur plusieurs lignes : on absorbe les lignes indentées qui suivent,
    // tant qu'elles n'ouvrent pas un nouveau champ (sinon un « Angle » de trois lignes serait
    // tronqué à la première, ce qui est exactement ce qu'on écrit en pratique).
    const champ = (nom) => {
      const re = new RegExp('^\\s*-\\s*\\*\\*' + nom + '\\*\\*\\s*:?\\s*(.*)$', 'i');
      for (let i = 0; i < lignes.length; i++) {
        const mm = re.exec(lignes[i]);
        if (!mm) continue;
        const morceaux = [mm[1].trim()];
        for (let k = i + 1; k < lignes.length; k++) {
          const l = lignes[k];
          if (!l.trim()) break;
          if (/^\s*-\s*\*\*/.test(l)) break;      // champ suivant
          if (/^\s*-\s+/.test(l)) break;          // sous-puce (sources)
          if (!/^\s{2,}\S/.test(l)) break;        // ligne non indentée
          morceaux.push(l.trim());
        }
        return morceaux.join(' ').trim();
      }
      return '';
    };
    // sources : sous-puces sous « - **Sources** : »
    const sources = [];
    let dansSources = false;
    for (const l of lignes.slice(1)) {
      if (/^\s*-\s*\*\*Sources\*\*/i.test(l)) { dansSources = true; const reste = l.split(':').slice(1).join(':').trim(); if (/^https?:/.test(reste)) sources.push(reste); continue; }
      if (dansSources) {
        const mm = /^\s{2,}-\s*(.+)$/.exec(l);
        if (mm) { sources.push(mm[1].trim()); continue; }
        if (/^\s*-\s*\*\*/.test(l) || /^\s*$/.test(l)) dansSources = false;
      }
    }
    const titreNet = titre.replace(/\s*\(.*?\)\s*$/, '').trim();
    return {
      titre: titreNet,
      slug: slugifier(champ('Fichier').replace(/\.html$/, '') || titreNet),
      date,
      dateLisible: date ? dateLisible(date) : '',
      categorie: champ('Catégorie') || champ('Categorie') || 'Conseils',
      statut: (champ('Statut') || (date ? 'planifié' : 'en réserve')).toLowerCase(),
      angle: champ('Angle'),
      notes: champ('Notes'),
      fichier: champ('Fichier'),
      sources
    };
  });
}

// écrit/remplace un champ dans l'entrée dont le slug correspond
function majSujet(slug, champs) {
  let texte = fs.readFileSync(SUJETS, 'utf8');
  const sujets = lireSujets();
  const cible = sujets.find(s => s.slug === slug);
  if (!cible) throw new Error('sujet introuvable : ' + slug);
  const blocs = texte.split(/^(###\s+.*)$/m);
  // on reconstruit en repérant le bloc dont l'entête contient le titre du sujet
  for (let i = 1; i < blocs.length; i += 2) {
    const entete = blocs[i], corps = blocs[i + 1] || '';
    if (entete.indexOf(cible.titre) < 0) continue;
    let nouveau = corps;
    for (const [nom, valeur] of Object.entries(champs)) {
      const re = new RegExp('^(\\s*-\\s*\\*\\*' + nom + '\\*\\*\\s*:?\\s*).*$', 'im');
      if (re.test(nouveau)) nouveau = nouveau.replace(re, '$1' + valeur);
      else nouveau = nouveau.replace(/(\r?\n)/, '$1- **' + nom + '** : ' + valeur + '$1');
    }
    blocs[i + 1] = nouveau;
    break;
  }
  fs.writeFileSync(SUJETS, blocs.join(''));
}

// ------------------------------------------------- métadonnées d'un article
// Chaque article généré embarque sa fiche : l'index se reconstruit donc à partir des
// fichiers réellement présents, jamais d'une liste tenue à part qui pourrait mentir.
function metaArticle(fichier) {
  const html = fs.readFileSync(fichier, 'utf8');
  const m = /<script type="application\/json" id="ls-meta">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return Object.assign(JSON.parse(m[1]), { fichier: path.basename(fichier) }); }
  catch (e) { return null; }
}
function articlesEnLigne() {
  if (!fs.existsSync(BLOG)) return [];
  return fs.readdirSync(BLOG)
    .filter(f => f.endsWith('.html'))
    .map(f => metaArticle(path.join(BLOG, f)))
    .filter(Boolean)
    // garde-fou : un fichier dont la fiche contient encore des {{marqueurs}} est un gabarit,
    // pas un article — il ne doit jamais atterrir dans la grille du blog.
    .filter(a => !/\{\{/.test(a.titre + a.chapo + a.categorie + a.date))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ------------------------------------------------------ génération de l'index
const MARQUE_DEBUT = '<!-- ARTICLES:DEBUT -->';
const MARQUE_FIN = '<!-- ARTICLES:FIN -->';

function carte(a) {
  // la vignette est l'image de couverture de l'article ; on retombe sur la pastille de
  // catégorie pour un article ancien qui n'en aurait pas encore
  const vignette = a.image
    ? '<img class="thumb" src="blog/' + echapper(a.image) + '" alt="' + echapper(a.categorie) + ' — ' + echapper(a.titre) + '" loading="lazy" width="1200" height="630" />'
    : '<div class="thumb cat"><span>' + echapper(a.categorie) + '</span></div>';
  return '      <article class="post" data-reveal>' + NL
    + '        <a class="post-lien" href="blog/' + echapper(a.fichier) + '">' + NL
    + '          ' + vignette + NL
    + '          <div class="pad"><span class="tag">' + echapper(a.categorie) + '</span><h3>' + echapper(a.titre) + '</h3>'
    + '<p>' + echapper(a.chapo) + '</p><div class="date">' + echapper(dateLisible(a.date)) + '</div></div>' + NL
    + '        </a>' + NL
    + '      </article>';
}

function genererIndex() {
  const arts = articlesEnLigne();
  let html = fs.readFileSync(INDEX, 'utf8');
  const i = html.indexOf(MARQUE_DEBUT), j = html.indexOf(MARQUE_FIN);
  if (i < 0 || j < 0) throw new Error('marqueurs ARTICLES:DEBUT / ARTICLES:FIN absents de blog.html');
  const contenu = arts.length
    ? NL + arts.map(carte).join(NL) + NL + '    '
    : NL + '      <p class="ds-empty" style="grid-column:1/-1;text-align:center">Les premiers articles arrivent très bientôt.</p>' + NL + '    ';
  html = html.slice(0, i + MARQUE_DEBUT.length) + contenu + html.slice(j);
  fs.writeFileSync(INDEX, html);
  return arts;
}

// ------------------------------------------------------ plan du site (sitemap)
// Régénéré à chaque mise en ligne : un nouvel article y entre tout seul. Les pages privées
// et les brouillons en sont exclus (ils le sont aussi dans robots.txt).
const SITE = 'https://languagesandsuccess.com';
const HORS_PLAN = ['espace-documents.html'];
const PRIORITE = { 'index.html': '1.0', 'formations.html': '0.9', 'financement.html': '0.9', 'entreprises.html': '0.9', 'blog.html': '0.8', 'a-propos.html': '0.7', 'contact.html': '0.7', 'test-de-niveau.html': '0.7' };

function genererSitemap() {
  const urls = [];
  const jour = (f) => { try { return fs.statSync(f).mtime.toISOString().slice(0, 10); } catch (e) { return null; } };
  for (const f of fs.readdirSync(RACINE).filter(x => /\.html$/i.test(x)).sort()) {
    if (HORS_PLAN.indexOf(f) >= 0) continue;
    urls.push({ loc: SITE + (f === 'index.html' ? '/' : '/' + f), maj: jour(path.join(RACINE, f)), prio: PRIORITE[f] || '0.5' });
  }
  for (const a of articlesEnLigne()) {
    urls.push({ loc: SITE + '/blog/' + a.fichier, maj: a.date || jour(path.join(BLOG, a.fichier)), prio: '0.6' });
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' + NL +
    '<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">'.replace('sitemap.org', 'sitemaps.org') + NL +
    urls.map(u => '  <url>' + NL + '    <loc>' + u.loc + '</loc>' + NL +
      (u.maj ? '    <lastmod>' + u.maj + '</lastmod>' + NL : '') +
      '    <priority>' + u.prio + '</priority>' + NL + '  </url>').join(NL) + NL +
    '</urlset>' + NL;
  fs.writeFileSync(path.join(RACINE, 'sitemap.xml'), xml);
  return urls;
}

// --------------------------------------------------- brouillon → mise en ligne
function publier(slug) {
  const src = path.join(BROUILLONS, slug + '.html');
  if (!fs.existsSync(src)) throw new Error('brouillon introuvable : ' + path.relative(RACINE, src));
  const dst = path.join(BLOG, slug + '.html');
  let html = fs.readFileSync(src, 'utf8');
  // la fiche passe en « en ligne » et le lien de retour pointe vers le blog public
  html = html.replace(/("statut"\s*:\s*")[^"]*(")/, '$1en ligne$2')
             .replace(/<!--\s*BROUILLON[\s\S]*?-->\s*/g, '');
  fs.writeFileSync(dst, html);
  fs.unlinkSync(src);
  const meta = metaArticle(dst);
  try { majSujet(slug, { 'Statut': 'publié', 'Fichier': slug + '.html' }); } catch (e) { console.error('  (sujets.md non mis à jour : ' + e.message + ')'); }
  const arts = genererIndex();
  genererSitemap();
  return { meta, total: arts.length, chemin: 'blog/' + slug + '.html' };
}

// ------------------------------------------------------------------ commandes
const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'sujets') {
    const sujets = lireSujets();
    const iJour = args.indexOf('--jour');
    if (iJour >= 0) {
      const jour = args[iJour + 1] && /^\d{4}-\d{2}-\d{2}$/.test(args[iJour + 1]) ? args[iJour + 1] : aujourdhui();
      const dujour = sujets.filter(s => s.date === jour && s.statut !== 'publié');
      console.log(JSON.stringify({ jour, dateLisible: dateLisible(jour), sujets: dujour }, null, 2));
    } else {
      console.log(JSON.stringify(sujets, null, 2));
    }
  } else if (cmd === 'planning') {
    const sujets = lireSujets();
    const auj = aujourdhui();
    const aVenir = sujets.filter(s => s.date && s.date >= auj && s.statut !== 'publié').sort((a, b) => a.date.localeCompare(b.date));
    const reserve = sujets.filter(s => !s.date && s.statut !== 'publié');
    const lignes = aVenir.map(s => '• ' + dateLisible(s.date) + ' — ' + s.titre + '  [' + s.categorie + ']');
    if (reserve.length) lignes.push('', 'En réserve (sans date) : ' + reserve.length + ' sujet(s)');
    console.log(lignes.join(NL) || 'Aucun sujet planifié.');
  } else if (cmd === 'statut') {
    const [slug, statut, fichier] = args;
    if (!slug || !statut) throw new Error('usage : statut <slug> <statut> [fichier]');
    const champs = { 'Statut': statut };
    if (fichier) champs['Fichier'] = fichier;
    majSujet(slug, champs);
    console.log('✔ ' + slug + ' → ' + statut);
  } else if (cmd === 'index') {
    const arts = genererIndex();
    const u = genererSitemap();
    console.log('✔ blog.html régénéré : ' + arts.length + ' article(s) en ligne, sitemap.xml : ' + u.length + ' URL');
    arts.forEach(a => console.log('   · ' + a.date + '  ' + a.titre));
  } else if (cmd === 'sitemap') {
    const u = genererSitemap();
    console.log('✔ sitemap.xml régénéré : ' + u.length + ' URL');
  } else if (cmd === 'publier') {
    const r = publier(args[0]);
    console.log('✔ en ligne : ' + r.chemin + '  (' + r.total + ' article(s) au total)');
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split(NL).filter(l => l.startsWith('//')).join(NL));
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error('✖ ' + e.message);
  process.exit(1);
}
