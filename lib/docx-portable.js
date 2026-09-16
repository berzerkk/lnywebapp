// Rend les .docx produits par la bibliothèque `docx` fidèles HORS de Word (Apple Pages, en premier lieu),
// SANS rien changer à leur rendu dans Word (vérifié document par document, cf. CLAUDE.md).
//
// Ce que la bibliothèque laisse implicite, et que Word et Pages ne complètent pas de la même façon :
//  1. aucun réglage de paragraphe par défaut (`<w:pPrDefault/>` vide) ni style « Normal » : Word applique
//     ses valeurs internes (0 avant, 0 après, interligne simple, contrôle des veuves et orphelines ACTIVÉ),
//     les autres logiciels les leurs. On écrit les valeurs de Word en toutes lettres.
//  2. `w:line` sans `w:lineRule` : la norme dit « auto » (multiple), on l'écrit.
//  3. espace APRÈS un paragraphe suivi d'un espace AVANT le suivant : Word garde le PLUS GRAND des deux,
//     Pages (comme pdfkit) les ADDITIONNE. On met le plus petit des deux à 0 : même rendu dans Word,
//     et la somme vaut alors le maximum partout ailleurs.
//  4. tableaux sans marges de cellule ni retrait : Word applique 0,5 pt à gauche et à droite (10 twips,
//     mesuré dans Word) et aucun retrait. On les écrit dans le tableau.
// Toute erreur rend le fichier d'origine : ce traitement ne doit jamais empêcher un téléchargement.
'use strict';
const JSZip = require('jszip');

const ESPACEMENT_WORD = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';
const PPR_WORD = '<w:pPr><w:widowControl/>' + ESPACEMENT_WORD + '</w:pPr>';
const STYLE_NORMAL = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>' + PPR_WORD + '</w:style>';
const MARGES_CELLULE_WORD = '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="10" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="10" w:type="dxa"/></w:tblCellMar>';
const RETRAIT_TABLEAU_WORD = '<w:tblInd w:w="0" w:type="dxa"/>';
// ordre imposé des enfants de w:tblPr (schéma OOXML) : un élément mal placé rend le fichier invalide pour Word
const ORDRE_TBLPR = ['w:tblStyle', 'w:tblpPr', 'w:tblOverlap', 'w:bidiVisual', 'w:tblStyleRowBandSize', 'w:tblStyleColBandSize',
  'w:tblW', 'w:jc', 'w:tblCellSpacing', 'w:tblInd', 'w:tblBorders', 'w:shd', 'w:tblLayout', 'w:tblCellMar', 'w:tblLook',
  'w:tblCaption', 'w:tblDescription', 'w:tblPrChange'];
// éléments sans effet sur la mise en page : ils ne séparent pas deux paragraphes voisins
const TRANSPARENTS = new Set(['w:bookmarkStart', 'w:bookmarkEnd', 'w:proofErr', 'w:permStart', 'w:permEnd',
  'w:commentRangeStart', 'w:commentRangeEnd', 'w:moveFromRangeStart', 'w:moveFromRangeEnd', 'w:moveToRangeStart', 'w:moveToRangeEnd']);
// réglages qui rendent l'espacement effectif incertain : on ne touche pas au paragraphe
const BLOQUANTS_PPR = new Set(['w:pStyle', 'w:numPr', 'w:contextualSpacing', 'w:sectPr', 'w:pPrChange']);

const BALISE = /<(\/?)([A-Za-z][\w.-]*:[\w.-]+|[A-Za-z][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const lireAttributs = (s) => { const a = {}; for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) a[m[1]] = m[2]; return a; };
const ecrireEspacement = (a) => '<w:spacing' + Object.keys(a).map(k => ' ' + k + '="' + a[k] + '"').join('') + '/>';

// Parcourt une partie XML et renvoie la liste des retouches à appliquer (positions dans la chaîne).
function retoucherPartie(xml, { fusion, tableaux }) {
  const retouches = []; // { debut, fin, texte }
  const pile = [];
  const espacements = new Map(); // début de balise → { debut, fin, attrs, modifie }
  for (const m of xml.matchAll(BALISE)) {
    const [tout, fermante, nom, attrs, autoFermee] = m;
    const debut = m.index, fin = m.index + tout.length;
    const parent = pile[pile.length - 1];
    if (fermante) {
      const cadre = pile.pop();
      if (!cadre || cadre.nom !== nom) throw new Error('XML mal imbriqué (' + nom + ')');
      if (cadre.nom === 'w:tblPr' && tableaux) completerTblPr(cadre, debut, retouches);
      if (cadre.enfants && fusion) fusionnerVoisins(cadre.enfants);
      continue;
    }
    const cadre = { nom, debut, enfants: [], paragraphe: nom === 'w:p' ? { espacement: null, bloque: false } : null };
    if (parent) {
      if (!TRANSPARENTS.has(nom)) parent.enfants.push({ nom, debut, paragraphe: cadre.paragraphe });
      // réglages du paragraphe : enfants DIRECTS du w:pPr d'un w:p
      if (parent.nom === 'w:pPr') {
        const p = pile[pile.length - 2];
        if (nom === 'w:spacing') {
          const e = { debut, fin, attrs: lireAttributs(attrs), modifie: false };
          if (e.attrs['w:line'] !== undefined && e.attrs['w:lineRule'] === undefined) { e.attrs['w:lineRule'] = 'auto'; e.modifie = true; }
          espacements.set(debut, e);
          if (p && p.paragraphe) {
            p.paragraphe.espacement = e;
            const a = e.attrs;
            if (['w:beforeAutospacing', 'w:afterAutospacing', 'w:beforeLines', 'w:afterLines'].some(k => a[k] !== undefined && a[k] !== '0' && a[k] !== 'false')) p.paragraphe.bloque = true;
            if (['w:before', 'w:after'].some(k => a[k] !== undefined && !/^\d+$/.test(a[k]))) p.paragraphe.bloque = true;
          }
        } else if (BLOQUANTS_PPR.has(nom) && p && p.paragraphe) p.paragraphe.bloque = true;
      }
    }
    if (autoFermee) {
      if (nom === 'w:tblPr' && tableaux) retouches.push({ debut, fin, texte: '<w:tblPr>' + RETRAIT_TABLEAU_WORD + MARGES_CELLULE_WORD + '</w:tblPr>' });
      continue;
    }
    pile.push(cadre);
  }
  if (pile.length) throw new Error('XML incomplet');
  for (const e of espacements.values()) if (e.modifie) retouches.push({ debut: e.debut, fin: e.fin, texte: ecrireEspacement(e.attrs) });
  return appliquer(xml, retouches);
}

// Deux paragraphes qui se suivent sous le même parent : le plus petit des deux espaces passe à 0.
function fusionnerVoisins(enfants) {
  for (let i = 1; i < enfants.length; i++) {
    const p1 = enfants[i - 1].paragraphe, p2 = enfants[i].paragraphe;
    if (!p1 || !p2 || p1.bloque || p2.bloque || !p1.espacement || !p2.espacement) continue;
    const apres = +(p1.espacement.attrs['w:after'] || 0), avant = +(p2.espacement.attrs['w:before'] || 0);
    if (!(apres > 0 && avant > 0)) continue;
    // le plus grand reste où il est : le paragraphe qui le porte n'est pas modifié du tout
    const cible = apres <= avant ? [p1.espacement, 'w:after'] : [p2.espacement, 'w:before'];
    cible[0].attrs[cible[1]] = '0';
    cible[0].modifie = true;
  }
}

// Ajoute au tableau le retrait et les marges que Word applique quand ils manquent.
function completerTblPr(cadre, positionFermeture, retouches) {
  const presents = new Set(cadre.enfants.map(e => e.nom));
  for (const [nom, texte] of [['w:tblInd', RETRAIT_TABLEAU_WORD], ['w:tblCellMar', MARGES_CELLULE_WORD]]) {
    if (presents.has(nom)) continue;
    const rang = ORDRE_TBLPR.indexOf(nom);
    const suivant = cadre.enfants.find(e => ORDRE_TBLPR.indexOf(e.nom) > rang);
    retouches.push({ debut: suivant ? suivant.debut : positionFermeture, fin: suivant ? suivant.debut : positionFermeture, texte });
  }
}

function appliquer(xml, retouches) {
  // insertions et remplacements, de la fin vers le début (à position égale, l'ordre d'ajout est conservé)
  const tri = retouches.map((r, i) => Object.assign({ i }, r)).sort((a, b) => b.debut - a.debut || b.i - a.i);
  let out = xml;
  for (const r of tri) out = out.slice(0, r.debut) + r.texte + out.slice(r.fin);
  return out;
}

function retoucherStyles(xml) {
  let s = retoucherPartie(xml, { fusion: false, tableaux: false });
  if (/<w:pPrDefault\s*\/>|<w:pPrDefault>\s*<\/w:pPrDefault>/.test(s)) {
    s = s.replace(/<w:pPrDefault\s*\/>|<w:pPrDefault>\s*<\/w:pPrDefault>/, '<w:pPrDefault>' + PPR_WORD + '</w:pPrDefault>');
  } else if (!/<w:pPrDefault[\s>]/.test(s)) {
    if (/<\/w:rPrDefault>/.test(s)) s = s.replace('</w:rPrDefault>', '</w:rPrDefault><w:pPrDefault>' + PPR_WORD + '</w:pPrDefault>');
    else if (/<w:docDefaults\s*\/>/.test(s)) s = s.replace(/<w:docDefaults\s*\/>/, '<w:docDefaults><w:pPrDefault>' + PPR_WORD + '</w:pPrDefault></w:docDefaults>');
    else if (/<w:docDefaults>/.test(s)) s = s.replace('<w:docDefaults>', '<w:docDefaults><w:pPrDefault>' + PPR_WORD + '</w:pPrDefault>');
  }
  const aDejaUnDefaut = /<w:style\b[^>]*w:type="paragraph"[^>]*w:default="(1|true|on)"|<w:style\b[^>]*w:default="(1|true|on)"[^>]*w:type="paragraph"/.test(s);
  if (!aDejaUnDefaut && !/w:styleId="Normal"/.test(s)) {
    const i = s.search(/<w:style[\s>]/);
    s = i >= 0 ? s.slice(0, i) + STYLE_NORMAL + s.slice(i) : s.replace('</w:styles>', STYLE_NORMAL + '</w:styles>');
  }
  return s;
}

const PARTIES_TEXTE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

async function rendreDocxPortable(buf) {
  try {
    const zip = await JSZip.loadAsync(buf);
    for (const nom of Object.keys(zip.files)) {
      const f = zip.files[nom];
      if (f.dir) continue;
      if (nom === 'word/styles.xml') zip.file(nom, retoucherStyles(await f.async('string')));
      else if (PARTIES_TEXTE.test(nom)) zip.file(nom, retoucherPartie(await f.async('string'), { fusion: true, tableaux: true }));
    }
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (e) {
    console.error('docx-portable : fichier laissé tel quel —', e.message);
    return buf;
  }
}

module.exports = { rendreDocxPortable, retoucherPartie, retoucherStyles };
