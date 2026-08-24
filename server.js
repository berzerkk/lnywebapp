/* ============================================================================
   L&S — Backend de l'espace documents (Node + Express)
   Modèle « DOSSIER à 3 » : un formateur ajoute un apprenant → dossier
   { formateur, apprenant, admin } (l'admin est membre de TOUS les dossiers).
   Deux canaux par dossier :
     - "commun"  : formateur + apprenant + admin
     - "prive"   : formateur + admin (l'apprenant n'y a PAS accès)
   Chaque canal = messagerie (chat) + documents. Notifications à chaque envoi.
   Vue admin centralisée : tous les comptes admin voient la même chose.
   Lancer : node server.js   (défaut http://localhost:3000 ; en local : node server.js 8000)
   ============================================================================ */
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const zlib = require('zlib');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Header, Footer, ImageRun, PageNumber, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ShadingType, VerticalAlign, VerticalMergeType, HeightRule, TableLayoutType } = require('docx');
const LOGO_PATH = path.join(__dirname, 'assets', 'ls-logo.png');
const QUALIOPI_CERT = 'CERT_S0226_0162';   // numéro du certificat QUALIOPI (mis à jour le 27/07/2026)
// tableau Word sans aucune bordure (mise en page en colonnes : pied de page, signatures…)
const NO_BORDERS = () => ({ top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } });
const LEGAL_LINES = [
  'ASSOCIATION Loi 1901 LANGUAGES & SUCCESS - L&S',
  'Siège social : 57, avenue Valéry Giscard d\'Estaing - BP 1052 - 06201 NICE CÉDEX 3 - France',
  'Tél. : 0778873201 - Adresse mail : contact@languagesandsuccess.com',
  'Numéro RNA : W061014363 - SIRET : 881 226 641 00028 - Certificat QUALIOPI : ' + QUALIOPI_CERT,
  'Enregistré sous le N° 93 060 886 106 auprès du Préfet de la région PACA'
];

// En-tête commun (rempli par le formateur) et modèles de questionnaires
const QS_HEADER_FIELDS = [
  { id: 'nomApprenant', label: "Nom de l'apprenant" }, { id: 'societe', label: 'Société' }, { id: 'langue', label: 'Langue' },
  { id: 'intitule', label: 'Intitulé de la formation' }, { id: 'formateur', label: 'Formateur' }, { id: 'date', label: 'Date' }
];
const SC4 = ['Pas du tout', 'Insuffisamment', 'En partie', 'Totalement'];
const QS_TEMPLATES = {
  qs_mid: {
    title: 'Questionnaire de satisfaction — en cours de formation',
    items: [
      { type: 'intro', text: 'Nous souhaitons nous assurer que la formation que vous suivez correspond à vos attentes ; merci de bien vouloir répondre aux questions ci-dessous.' },
      { type: 'radio', id: 'q1', label: 'Les objectifs de votre stage ont-ils été clairement formulés en début de session ?', options: ['Oui', 'Non'] },
      { type: 'radio', id: 'q2', label: 'Le rythme de cours vous convient-il ?', options: ['Oui', 'Non'] },
      { type: 'radio', id: 'q3', label: 'Votre formateur est-il à votre écoute ?', options: ['Oui', 'En partie', 'Pas suffisamment'] },
      { type: 'scale', id: 'q4', label: "Sur une échelle de 1 (pas du tout satisfaisant) à 10 (très satisfaisant), comment évaluez-vous le degré d'interactivité pendant les cours ?" },
      { type: 'radio', id: 'q5', label: 'Le rythme de progression pédagogique est-il adapté ?', options: ['Oui', 'En partie', 'Pas vraiment'], comment: 'Si « en partie » ou « pas vraiment », pourquoi ?' },
      { type: 'radio', id: 'q6', label: 'La formation vous aide-t-elle à combler vos besoins ?', options: ['Oui', 'Non'], comment: 'Si non, pourquoi ?' },
      { type: 'scale', id: 'q7', label: 'Sur une échelle de 1 (pas du tout) à 10 (parfaitement), la formation correspond-elle, pour le moment, à vos attentes ?', comment: 'Si non, pourquoi ?' },
      { type: 'text', id: 'q8', label: 'Y a-t-il des modifications que vous souhaiteriez apporter dans le déroulement de votre stage ?' },
      { type: 'text', id: 'q9', label: 'Commentaires éventuels' }
    ]
  },
  qs_end: {
    title: 'Questionnaire de fin de formation',
    items: [
      { type: 'intro', text: 'Merci de cocher une seule réponse par ligne.' },
      { type: 'section', label: 'Préparation de la formation' },
      { type: 'radio', id: 'q1', label: 'Les objectifs de la formation ont-ils été clairement annoncés ?', options: SC4 },
      { type: 'section', label: 'Organisation de la formation' },
      { type: 'radio', id: 'q2', label: 'La durée du stage vous a-t-elle semblé adaptée ?', options: SC4 },
      { type: 'section', label: 'Déroulement de la formation' },
      { type: 'radio', id: 'q3', label: 'Le formateur était-il explicite et dynamique ?', options: SC4 },
      { type: 'radio', id: 'q4', label: 'Les activités étaient-elles pertinentes ?', options: SC4 },
      { type: 'radio', id: 'q5', label: 'Le rythme de la formation était-il ?', options: ['Adapté', 'Trop rapide', 'Trop lent'] },
      { type: 'section', label: 'Contenu de la formation' },
      { type: 'radio', id: 'q6', label: 'Le programme était-il clair et précis ?', options: SC4 },
      { type: 'radio', id: 'q7', label: 'Le programme était-il adapté à vos besoins ?', options: SC4 },
      { type: 'radio', id: 'q8', label: 'Les supports de formation étaient-ils clairs et utiles ?', options: SC4 },
      { type: 'radio', id: 'q9', label: 'Les objectifs du programme sont-ils atteints ?', options: SC4 },
      { type: 'section', label: 'Efficacité de la formation' },
      { type: 'radio', id: 'q10', label: 'Cette formation améliore-t-elle vos compétences ?', options: ['Non', 'Un peu', 'Beaucoup'] },
      { type: 'radio', id: 'q11', label: 'Ces nouvelles compétences vont-elles être applicables dans votre travail ?', options: ['Non', 'Un peu', 'Beaucoup'] },
      { type: 'radio', id: 'q12', label: 'Recommanderiez-vous cette formation ?', options: ['Oui', 'Non'], comment: 'Si non, pourquoi ?' },
      { type: 'text', id: 'q13', label: 'Quels sont les points forts de cette formation ?' },
      { type: 'text', id: 'q14', label: 'Quels sont les points faibles de cette formation ?' },
      { type: 'text', id: 'q15', label: 'Autres remarques' }
    ]
  }
};

// formulaires remplis PAR le formateur (auto-rempli, téléchargé directement)
const SC4F = ['Oui tout à fait', 'Partiellement', 'Pas vraiment', 'Non, pas du tout'];
const FORM_TEMPLATES = {
  qs_formateur: {
    title: 'Fiche satisfaction formateur — bilan de formation',
    headerFields: [
      { id: 'formateur', label: 'Formateur' }, { id: 'langue', label: 'Langue' }, { id: 'nomApprenant', label: "Nom de l'apprenant" },
      { id: 'intitule', label: 'Intitulé de la formation' }, { id: 'date', label: 'Date' }
    ],
    items: [
      { type: 'intro', text: "Afin de poursuivre une amélioration continue de nos prestations de service, nous souhaiterions recueillir votre avis sur la qualité de notre travail. Vos réponses seront traitées afin d'améliorer nos prestations." },
      { type: 'section', label: 'En amont de la formation' },
      { type: 'radio', id: 'q1', label: "Le public accueilli avait-il les prérequis nécessaires à l'entrée en formation ?", options: SC4F },
      { type: 'radio', id: 'q2', label: 'Avez-vous disposé des documents administratifs et pédagogiques pour conduire la formation dans de bonnes conditions ?', options: SC4F },
      { type: 'section', label: 'Déroulement de la formation' },
      { type: 'radio', id: 'q3', label: "Avez-vous eu, l'apprenant ou vous-même, des problèmes de connexion dans le cadre d'une formation en distanciel ?", options: SC4F },
      { type: 'radio', id: 'q4', label: "Des adaptations liées aux situations ou au profil de l'apprenant ont-elles été nécessaires ?", options: SC4F },
      { type: 'section', label: 'Bilan de la formation' },
      { type: 'radio', id: 'q5', label: "La formation suivie est-elle en adéquation avec les besoins et attentes de l'apprenant pris en charge ?", options: SC4F },
      { type: 'radio', id: 'q6', label: "La formation s'est-elle déroulée comme prévue (retard, problèmes particuliers…) ?", options: SC4F },
      { type: 'radio', id: 'q7', label: "Quelles améliorations éventuelles pourrions-nous apporter afin d'améliorer l'organisation et la réalisation de l'action de formation ?", options: ['Oui', 'Non'], comment: 'Si oui, lesquelles ?', commentIf: 'Oui' }
    ]
  }
};

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = process.env.PORT || process.argv[2] || 3000;

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 60; // ~deux semaines de snapshots (démarrage + toutes les 6 h)

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ⚠️ Toute NOUVELLE collection doit figurer ici : normalizeDB la crée alors toute seule sur les
// bases déjà en service, production comprise. Oubliée, elle vaut undefined au premier accès.
const DB_DEFAULTS = () => ({ users: [], groups: [], docs: [], messages: [], notifs: [], worksheets: [], docgens: [], qs: [], presences: [], attestations: [], contrats: [], contratRefs: [], logins: [], demoSeeded: false, docVersions: {}, articles: [], secret: crypto.randomBytes(32).toString('hex') });
function normalizeDB(d) { const def = DB_DEFAULTS(); for (const k of Object.keys(def)) { if (d[k] == null) d[k] = def[k]; } return migrateGroups(d); }
// MIGRATION (27/07/2026) : un dossier passe de { prof, eleve } (une seule personne de chaque côté)
// à { profs: [...], eleves: [...] }. Les bases existantes (dont la prod) sont converties au chargement ;
// les anciens champs sont retirés pour qu'aucun code ne puisse en dépendre par accident.
function migrateGroups(d) {
  (d.groups || []).forEach(g => {
    if (!Array.isArray(g.profs)) g.profs = g.prof ? [g.prof] : [];
    if (Array.isArray(g.eleves)) { if (!g.eleve) g.eleve = g.eleves[0] || null; delete g.eleves; }
    delete g.prof;
  });
  return d;
}

function loadDB() {
  // 1) fichier principal
  if (fs.existsSync(DB_FILE)) {
    try { return normalizeDB(JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); }
    catch (e) { console.error('⚠ db.json illisible/corrompu :', e.message); }
  }
  // 2) restauration depuis le backup le plus récent valide
  try {
    const backups = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter(f => /^db-.*\.json$/.test(f)).sort().reverse() : [];
    for (const b of backups) {
      try { const d = normalizeDB(JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, b), 'utf8'))); console.warn('↻ Base restaurée depuis le backup ' + b); fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); return d; }
      catch (e) { /* backup suivant */ }
    }
  } catch (e) { }
  // 3) base neuve
  const init = DB_DEFAULTS();
  try { fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2)); } catch (e) { }
  return init;
}

// écriture ATOMIQUE : on écrit un .tmp puis on renomme (le rename est atomique → jamais de fichier à moitié écrit)
function save() {
  const json = JSON.stringify(db, null, 2);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, DB_FILE);
}

// snapshots horodatés rotatifs (récupération en cas de fausse manip ou de corruption)
function backupDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, 'db-' + stamp + '.json'));
    const files = fs.readdirSync(BACKUP_DIR).filter(f => /^db-.*\.json$/.test(f)).sort();
    while (files.length > MAX_BACKUPS) { try { fs.unlinkSync(path.join(BACKUP_DIR, files.shift())); } catch (e) { } }
  } catch (e) { console.error('backup:', e.message); }
}

let db = loadDB();
backupDB();                                   // snapshot au démarrage
setInterval(backupDB, 6 * 60 * 60 * 1000);    // + toutes les 6 h

// Un envoi de fichier interrompu (coupure réseau, mise à jour du serveur, onglet fermé)
// laisse un fichier partiel dans uploads/ qu'aucun document ne référence : invisible
// dans l'interface, mais il occuperait le disque et grossirait chaque sauvegarde.
// TROIS GARDE-FOUS, car on supprime des fichiers : (1) rien si la base ne contient
// aucun document (cas d'une base neuve ou d'un volume non monté : on ne veut surtout
// pas effacer de vrais fichiers) ; (2) uniquement ce qui n'est référencé par AUCUN
// document ; (3) uniquement les fichiers de plus de 24 h, jamais un envoi récent.
function cleanupOrphanUploads() {
  try {
    if (!db.docs || !db.docs.length) return;
    const known = new Set(db.docs.map(d => d.stored));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let removed = 0, freed = 0;
    for (const f of fs.readdirSync(UPLOADS_DIR)) {
      if (known.has(f)) continue;
      const p = path.join(UPLOADS_DIR, f);
      try {
        const st = fs.statSync(p);
        if (!st.isFile() || st.mtimeMs > cutoff) continue;
        freed += st.size; fs.unlinkSync(p); removed++;
      } catch (e) { }
    }
    if (removed) console.log('🧹 ' + removed + ' fichier(s) orphelin(s) d\'envois interrompus supprimé(s) (' + Math.round(freed / 1024) + ' ko libérés)');
  } catch (e) { console.error('🧹 nettoyage des orphelins :', e.message); }
}
cleanupOrphanUploads();

// ---- e-mails de notification (SMTP) ----------------------------------------
// Config HORS Git : fichier data/smtp.json {host,port,secure,user,pass,from,siteUrl}
// ou variables d'env SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM/SITE_URL.
// Sans config (ou sans module nodemailer), les e-mails sont simplement désactivés :
// le site et l'espace documents fonctionnent normalement.
let nodemailer = null; try { nodemailer = require('nodemailer'); } catch (e) { }
const MAIL_FILE = path.join(DATA_DIR, 'smtp.json');
// ⚠️ EXPÉDITEUR IMPOSÉ. Tous les e-mails du site partent de nepasrepondre@ : personne ne lit
// cette boîte, et chaque message le dit. On authentifie toujours avec le compte SMTP (admin@),
// mais l'en-tête From est celui-ci, QUELLE QUE SOIT la configuration : un MAIL_FROM oublié
// dans l'ENV_FILE de production ferait autrement repartir les mails de l'ancienne adresse,
// sans que personne s'en aperçoive.
const MAIL_EXPEDITEUR = '"Languages & Success" <nepasrepondre@languagesandsuccess.com>';
const MAIL_NOREPLY = 'Ce message est automatique. Merci de ne pas y répondre : cette adresse ne reçoit aucun courrier.';
function mailConfig() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return { host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465), secure: process.env.SMTP_SECURE !== 'false', user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: MAIL_EXPEDITEUR, siteUrl: process.env.SITE_URL || 'https://languagesandsuccess.com' };
  }
  try {
    const c = JSON.parse(fs.readFileSync(MAIL_FILE, 'utf8').replace(/^﻿/, ''));
    if (c && c.host && c.user && c.pass) return { host: c.host, port: +(c.port || 465), secure: c.secure !== false, user: c.user, pass: c.pass, from: MAIL_EXPEDITEUR, siteUrl: c.siteUrl || 'https://languagesandsuccess.com' };
  } catch (e) { }
  return null;
}
const MAIL = mailConfig();
const mailer = (MAIL && nodemailer) ? nodemailer.createTransport({ host: MAIL.host, port: MAIL.port, secure: MAIL.secure, auth: { user: MAIL.user, pass: MAIL.pass } }) : null;
console.log(mailer ? '✉ e-mails activés via ' + MAIL.host + ' (expéditeur : ' + MAIL.from + ')' : '✉ e-mails désactivés (pas de config SMTP dans data/smtp.json ni en variables d\'env)');
const SITE_URL = (MAIL && MAIL.siteUrl) || 'https://languagesandsuccess.com';
// envoi « fire and forget » : ne bloque jamais la réponse API, ne fait jamais planter le flux
const MAIL_LOGO = path.join(__dirname, 'assets', 'ls-logo.png');
// Composition du message, PARTAGÉE par tous les envois — les flux réels comme le test
// d'envoi. C'est ce qui garantit que le test prouve quelque chose : s'il passait par un
// chemin à lui, il ne vérifierait que lui-même.
function composerMail(to, subject, text, html, opts) {
  const brut = String(text == null ? '' : text);
  // la mention est ajoutée ICI : aucun appelant ne peut l'oublier.
  // ⚠️ Quand un Reply-To est posé (formulaire de contact), « merci de ne pas répondre » serait
  // un contre-sens : répondre est précisément le geste attendu, et la réponse part chez le
  // visiteur, pas vers nepasrepondre@.
  const mention = (opts && opts.replyTo)
    ? 'Vous pouvez répondre directement à cet e-mail : votre réponse partira à ' + opts.replyTo + '.'
    : MAIL_NOREPLY;
  const avecMention = brut.indexOf(mention) >= 0 ? brut : (brut + '\n\n---\n' + mention);
  // Auto-Submitted et X-Auto-Response-Suppress : ils évitent les réponses d'absence et les
  // accusés de réception automatiques, qui n'iraient de toute façon dans aucune boîte lue.
  const msg = { from: MAIL.from, to, subject, text: avecMention, html,
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' } };
  if (html && html.indexOf('cid:lslogo') !== -1 && fs.existsSync(MAIL_LOGO)) msg.attachments = [{ filename: 'ls-logo.png', path: MAIL_LOGO, cid: 'lslogo' }];
  return msg;
}
// opts.replyTo (facultatif) : utilisé par le formulaire de contact pour qu'un simple « Répondre »
// parte chez le visiteur, l'expéditeur nepasrepondre@ ne recevant rien.
function sendMailSafe(to, subject, text, html, opts) {
  if (!mailer || !to || !/@/.test(to)) return;
  if (/@ls\.fr$/i.test(to)) return; // adresses fictives des comptes démo — jamais d'envoi réel
  const msg = composerMail(to, subject, text, html, opts);
  if (opts && opts.replyTo && /@/.test(opts.replyTo)) msg.replyTo = opts.replyTo;
  mailer.sendMail(msg, (err) => {
    if (err) console.error('✉ échec envoi à ' + to + ' :', err.message);
    else console.log('✉ mail envoyé à ' + to + ' — ' + subject);
  });
}
// gabarit HTML : carte type « modal » (fond crème du site, case claire arrondie),
// logo en pièce inline (cid:lslogo, attaché par sendMailSafe), wordmark avec seul le & en accent
function mailHtml(title, lines, ctaLabel, ctaUrl) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div style="background:#f8f2e7;padding:36px 16px">'
    + '<div style="max-width:540px;margin:0 auto;background:#fffaf0;border:1px solid #e6dccb;border-radius:18px;padding:34px 30px;font-family:Arial,Helvetica,sans-serif;color:#2a241d">'
    + '<div style="text-align:center;margin-bottom:14px"><img src="cid:lslogo" width="56" height="56" alt="Languages & Success" style="display:inline-block;border:0"/></div>'
    + '<div style="text-align:center;font-size:13px;letter-spacing:.18em;text-transform:uppercase;font-weight:bold;color:#2a241d;margin-bottom:24px">Languages <span style="color:#be6e54;font-style:italic">&amp;</span> Success</div>'
    + '<h2 style="font-size:20px;margin:0 0 14px">' + esc(title) + '</h2>'
    + lines.map(l => '<p style="font-size:14px;line-height:1.6;margin:0 0 12px">' + esc(l) + '</p>').join('')
    + (ctaUrl ? '<p style="margin:24px 0 8px"><a href="' + ctaUrl + '" style="background:#be6e54;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px;font-weight:bold;display:inline-block">' + esc(ctaLabel) + '</a></p>' : '')
    + '<div style="margin-top:26px;padding:12px 14px;background:#f4ece0;border-radius:10px">'
    + '<p style="font-size:12px;line-height:1.55;color:#6b6055;margin:0"><strong>Message automatique.</strong> Merci de ne pas répondre à cet e-mail : l\'adresse nepasrepondre@languagesandsuccess.com ne reçoit aucun courrier. Pour nous joindre, écrivez à contact@languagesandsuccess.com.</p>'
    + '</div>'
    + '</div></div>';
}

// ---- sauvegarde OFFSITE quotidienne de data/ (Backblaze B2 ou disque local) -
// Config HORS Git : variables d'env B2_KEY_ID / B2_APP_KEY (le bucket est trouvé
// tout seul : clé limitée à un bucket, ou bucket unique du compte ; sinon préciser
// B2_BUCKET = nom, ou B2_BUCKET_ID) ou fichier data/backup.json {keyId, appKey,
// bucket|bucketId} — ou {local: "chemin"} pour déposer l'archive sur un disque local.
// Sans config → désactivée proprement, le site fonctionne normalement. Tout est
// isolé dans des try/catch : un échec de sauvegarde ne touche JAMAIS le site.
// Archive tar.gz de data/ (db.json + uploads + smtp.json ; hors backups/ locaux
// et db.json.tmp). Cadence : 4×/jour à 8/12/16/20 h heure de Paris (robuste aux
// redéploiements via db.lastOffsiteBackup). Rétention : toutes les archives des
// 3 derniers jours + la dernière de chaque jour sur 30 jours. Statut consultable :
// GET /api/admin/backup-status · déclenchement manuel : POST /api/admin/backup-run.
// Un échec envoie une alerte e-mail à l'administration (au plus 1 par 24 h).
const BACKUP_CFG_FILE = path.join(DATA_DIR, 'backup.json');
function backupCfg() {
  if (process.env.B2_KEY_ID && process.env.B2_APP_KEY) return { mode: 'b2', keyId: process.env.B2_KEY_ID, appKey: process.env.B2_APP_KEY, bucketId: process.env.B2_BUCKET_ID || '', bucket: process.env.B2_BUCKET || '' };
  try {
    const c = JSON.parse(fs.readFileSync(BACKUP_CFG_FILE, 'utf8').replace(/^﻿/, ''));
    if (c && c.local) return { mode: 'local', local: String(c.local) };
    if (c && c.keyId && c.appKey) return { mode: 'b2', keyId: c.keyId, appKey: c.appKey, bucketId: c.bucketId || '', bucket: c.bucket || '' };
  } catch (e) { }
  return null;
}
const OFFSITE = backupCfg();
console.log(OFFSITE ? ('🗄 sauvegarde offsite activée (' + (OFFSITE.mode === 'b2' ? 'Backblaze B2' : 'disque local') + ', 4×/jour à 8/12/16/20 h Paris)') : '🗄 sauvegarde offsite désactivée (pas de config B2 ni data/backup.json)');

// mini-écrivain tar POSIX (fichiers réguliers uniquement) + flux gzip
// ⚠️ le champ « name » ne fait que 100 octets : au-delà on utilise le champ « prefix »
// ustar (155 octets), et si le nom reste trop long on ÉCHOUE plutôt que de tronquer
// en silence (un nom tronqué = document irrécupérable à la restauration).
function tarHeader(name, size, mtimeMs) {
  const b = Buffer.alloc(512);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', name.length - 1);
    if (cut > 0 && Buffer.byteLength(name.slice(0, cut)) <= 155 && Buffer.byteLength(name.slice(cut + 1)) <= 100) {
      prefix = name.slice(0, cut); name = name.slice(cut + 1);
    } else throw new Error('nom de fichier trop long pour le format tar : ' + name);
  }
  b.write(name, 0, 100, 'utf8');
  if (prefix) b.write(prefix, 345, 155, 'utf8');
  b.write('0000644\0', 100, 8, 'ascii');
  b.write('0000000\0', 108, 8, 'ascii');
  b.write('0000000\0', 116, 8, 'ascii');
  b.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  b.write(Math.floor(mtimeMs / 1000).toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii');
  b.write('        ', 148, 8, 'ascii'); // champ checksum rempli d'espaces pour le calcul
  b.write('0', 156, 1, 'ascii');        // fichier régulier
  b.write('ustar', 257, 5, 'ascii');
  b.write('00', 263, 2, 'ascii');
  let sum = 0; for (let i = 0; i < 512; i++) sum += b[i];
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return b;
}
async function buildDataArchive(outPath) {
  const gz = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(outPath);
  let streamErr = null;
  const fail = (e) => { if (!streamErr) streamErr = e; };
  const done = new Promise((resolve, reject) => {
    out.on('close', resolve);
    out.on('error', e => { fail(e); reject(e); });
    gz.on('error', e => { fail(e); reject(e); });
  });
  done.catch(() => { }); // le rejet est traité via streamErr : jamais de rejet orphelin (qui tuerait le process)
  gz.pipe(out);
  const skipTop = new Set(['backups', 'db.json.tmp', 'backup.json']);
  const wr = (buf) => { if (streamErr) throw streamErr; return gz.write(buf) ? Promise.resolve() : new Promise(r => gz.once('drain', r)); };
  // ⚠️ Un fichier peut CHANGER pendant sa lecture (multer écrit les téléversements
  // directement à leur emplacement final, et save() réécrit db.json) : si on écrivait
  // plus ou moins d'octets que la taille annoncée dans l'en-tête, le flux tar serait
  // désynchronisé et TOUS les fichiers suivants deviendraient illisibles — en silence.
  // On borne donc la lecture à la taille annoncée et on complète au besoin par des zéros.
  async function addFile(rel, abs, st) {
    await wr(tarHeader(rel, st.size, st.mtimeMs));
    let written = 0;
    if (st.size > 0) {
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(abs, { start: 0, end: st.size - 1 });
        rs.on('error', reject);
        rs.on('data', chunk => {
          if (streamErr) { rs.destroy(); return reject(streamErr); }
          written += chunk.length;
          if (!gz.write(chunk)) { rs.pause(); gz.once('drain', () => rs.resume()); }
        });
        rs.on('end', resolve);
      });
    }
    if (written < st.size) await wr(Buffer.alloc(st.size - written)); // fichier tronqué entre-temps
    const pad = st.size % 512 ? 512 - (st.size % 512) : 0;
    if (pad) await wr(Buffer.alloc(pad));
  }
  async function walk(dir, prefix, top) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (top && skipTop.has(name)) continue;
      const abs = path.join(dir, name);
      let st; try { st = fs.statSync(abs); } catch (e) { continue; } // fichier disparu entre-temps
      if (st.isDirectory()) await walk(abs, prefix + name + '/', false);
      else if (st.isFile()) await addFile(prefix + name, abs, st);
    }
  }
  try {
    await walk(DATA_DIR, 'data/', true);
    await wr(Buffer.alloc(1024)); // fin d'archive (2 blocs nuls)
    gz.end();
    await done;
  } catch (e) {
    try { gz.destroy(); out.destroy(); } catch (e2) { } // pas de descripteur ni de flux qui fuit
    throw e;
  }
}
async function b2Fetch(url, opts, timeoutMs) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(timeoutMs || 120000) }, opts));
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d && (d.message || d.code)) || ('HTTP ' + r.status));
  return d;
}
// nom d'archive UNIQUE (secondes + suffixe aléatoire) : deux sauvegardes rapprochées
// ne doivent pas écrire le même objet, sinon la version masquée échappe à la rétention.
const ARCHIVE_RE = /^ls-data-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})(?:-(\d{2})-[0-9a-f]{4})?\.tar\.gz$/;
function archiveDate(fileName) {
  const m = ARCHIVE_RE.exec(fileName);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
}
const MAX_BUFFER = 350 * 1024 * 1024; // au-delà, refus explicite plutôt qu'un OOM du conteneur
async function runOffsiteBackup(reason, force) {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const stamp = d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + '-' + p2(d.getUTCHours()) + '-' + p2(d.getUTCMinutes()) + '-' + p2(d.getUTCSeconds()) + '-' + crypto.randomBytes(2).toString('hex');
  const name = 'ls-data-' + stamp + '.tar.gz';
  const tmp = path.join(os.tmpdir(), name);
  const users = (db.users || []).length, docs = (db.docs || []).length;
  try {
    // Garde-fou anti-« sauvegarde d'une base vide » : si le volume de données n'était pas
    // monté, on archiverait une base neuve et la rétention finirait par effacer les bonnes
    // archives. On refuse dès que le contenu s'effondre par rapport à la dernière réussie.
    const prev = db.backupStatus && db.backupStatus.ok ? db.backupStatus : null;
    if (!force && prev && prev.users > 2 && users < Math.ceil(prev.users / 2)) {
      throw new Error('contenu anormalement réduit (' + users + ' comptes contre ' + prev.users + ' à la dernière sauvegarde) — sauvegarde refusée, relancer avec force si c\'est voulu');
    }
    await buildDataArchive(tmp);
    const size = fs.statSync(tmp).size;
    if (OFFSITE.mode === 'local') {
      fs.mkdirSync(OFFSITE.local, { recursive: true });
      fs.copyFileSync(tmp, path.join(OFFSITE.local, name));
    } else {
      if (size > MAX_BUFFER) throw new Error('archive de ' + Math.round(size / 1048576) + ' Mo : au-delà de ' + Math.round(MAX_BUFFER / 1048576) + ' Mo il faut passer à l\'envoi par morceaux (API large-file B2)');
      const sha1 = await new Promise((res, rej) => { // SHA1 en flux : pas de 2e copie en mémoire
        const h = crypto.createHash('sha1'), rs = fs.createReadStream(tmp);
        rs.on('error', rej); rs.on('data', c => h.update(c)); rs.on('end', () => res(h.digest('hex')));
      });
      const auth = await b2Fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', { headers: { Authorization: 'Basic ' + Buffer.from(OFFSITE.keyId + ':' + OFFSITE.appKey).toString('base64') } });
      const api = (path_, payload, t) => b2Fetch(auth.apiUrl + '/b2api/v2/' + path_, { method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, t);
      // bucket cible : id explicite → bucket de la clé (clé limitée) → recherche par nom
      // → bucket unique du compte. Sinon on liste les noms disponibles dans l'erreur.
      let bucketId = OFFSITE.bucketId || (auth.allowed && auth.allowed.bucketId);
      if (!bucketId) {
        const q = { accountId: auth.accountId };
        if (OFFSITE.bucket) q.bucketName = OFFSITE.bucket;
        const bl = await api('b2_list_buckets', q);
        const buckets = bl.buckets || [];
        if (!buckets.length) throw new Error(OFFSITE.bucket ? ('aucun bucket nommé « ' + OFFSITE.bucket + ' »') : 'aucun bucket dans ce compte B2 — en créer un (privé)');
        if (buckets.length > 1) throw new Error('plusieurs buckets B2 (' + buckets.map(b => b.bucketName).join(', ') + ') : préciser lequel via B2_BUCKET');
        // l'archive contient des données personnelles + des secrets : jamais dans un bucket public
        if (buckets[0].bucketType && buckets[0].bucketType !== 'allPrivate') throw new Error('le bucket B2 « ' + buckets[0].bucketName + ' » est PUBLIC : la sauvegarde contient des données personnelles, le passer en privé');
        bucketId = buckets[0].bucketId;
      }
      // B2 impose de redemander une URL d'envoi et de réessayer sur les erreurs
      // transitoires (503, jeton expiré, « no tomes available ») : 4 tentatives espacées.
      const archive = fs.readFileSync(tmp);
      let sent = false, lastErr = null;
      for (let attempt = 1; attempt <= 4 && !sent; attempt++) {
        try {
          const up = await api('b2_get_upload_url', { bucketId });
          await b2Fetch(up.uploadUrl, { method: 'POST', headers: { Authorization: up.authorizationToken, 'X-Bz-File-Name': encodeURIComponent(name), 'Content-Type': 'application/gzip', 'Content-Length': String(archive.length), 'X-Bz-Content-Sha1': sha1 }, body: archive }, 600000);
          sent = true;
        } catch (e) {
          lastErr = e;
          console.error('🗄 envoi B2 tentative ' + attempt + '/4 : ' + e.message);
          if (attempt < 4) await new Promise(r => setTimeout(r, attempt * 3000));
        }
      }
      if (!sent) throw lastErr || new Error('envoi B2 impossible');
      // ---- rétention : toutes les archives des 3 derniers jours + la dernière de chaque
      // jour sur 30 jours. Ne touche QUE les noms au format exact généré ici, et garde
      // toujours les 5 plus récentes quoi qu'il arrive (garde-fou anti-effacement).
      try {
        let all = [], start = null;
        for (let page = 0; page < 20; page++) {
          const ls = await api('b2_list_file_names', { bucketId, prefix: 'ls-data-', maxFileCount: 1000, startFileName: start || undefined });
          all = all.concat(ls.files || []);
          if (!ls.nextFileName) break;
          start = ls.nextFileName;
        }
        const arch = all.map(f => ({ f, ts: archiveDate(f.fileName) })).filter(x => x.ts).sort((a, b) => a.ts - b.ts);
        const now = Date.now(), DAY = 86400000, keep = new Set();
        arch.forEach(x => { if (now - x.ts < 3 * DAY) keep.add(x.f.fileName); });
        const lastOfDay = new Map();
        arch.forEach(x => { if (now - x.ts < 30 * DAY) lastOfDay.set(x.f.fileName.slice(8, 18), x.f.fileName); });
        lastOfDay.forEach(n => keep.add(n));
        arch.slice(-5).forEach(x => keep.add(x.f.fileName));
        for (const x of arch) {
          if (keep.has(x.f.fileName)) continue;
          await api('b2_delete_file_version', { fileName: x.f.fileName, fileId: x.f.fileId });
        }
      } catch (e) { console.error('🗄 rétention :', e.message); }
    }
    db.backupStatus = { ok: true, name, size, users, docs, date: Date.now(), reason: reason || 'auto' };
    db.lastOffsiteBackup = Date.now(); save();
    console.log('🗄 sauvegarde offsite OK : ' + name + ' (' + Math.round(size / 1024) + ' ko, ' + users + ' comptes, ' + docs + ' documents)');
  } catch (e) {
    db.backupStatus = { ok: false, error: String((e && e.message) || e), users, docs, date: Date.now(), reason: reason || 'auto' };
    try { save(); } catch (e2) { }
    console.error('🗄 sauvegarde offsite ÉCHEC :', (e && e.message) || e);
    alertBackupFailure();
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { }
  }
  return db.backupStatus;
}
// alerte e-mail à l'administration en cas d'échec (au plus 1 par 24 h) : une sauvegarde
// morte en silence est le pire scénario — il faut que quelqu'un l'apprenne tout de suite.
function alertBackupFailure() {
  try {
    if (Date.now() - (db.lastBackupAlert || 0) < 24 * 60 * 60 * 1000) return;
    const to = ((db.users || []).find(u => u.role === 'admin') || {}).email || (MAIL && MAIL.user);
    if (!to) return;
    const st = db.backupStatus || {}, last = db.lastOffsiteBackup ? new Date(db.lastOffsiteBackup).toLocaleString('fr-FR') : 'jamais';
    db.lastBackupAlert = Date.now(); save();
    sendMailSafe(to, 'Alerte : la sauvegarde du site a échoué — Languages & Success',
      'La sauvegarde automatique des données a échoué.\n\nErreur : ' + (st.error || '?') + '\nDernière sauvegarde réussie : ' + last + '\n\nLanguages & Success',
      mailHtml('La sauvegarde a échoué', ['La sauvegarde automatique des données de l\'espace documents a échoué.', 'Erreur : ' + (st.error || '?'), 'Dernière sauvegarde réussie : ' + last], null, null));
  } catch (e) { }
}
let offsiteRunning = false;
// 4 sauvegardes par jour, à 8 h / 12 h / 16 h / 20 h HEURE DE PARIS (le conteneur est en
// UTC : on lit donc l'heure de Paris explicitement, changement d'heure compris).
const BACKUP_SLOTS = [8, 12, 16, 20];
const parisHour = (d) => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(d);
async function offsiteTick() {
  if (!OFFSITE || offsiteRunning) return;
  const now = Date.now();
  // alerte si plus aucune sauvegarde réussie depuis 48 h (panne silencieuse)
  if (db.lastOffsiteBackup && now - db.lastOffsiteBackup > 48 * 60 * 60 * 1000) alertBackupFailure();
  if (BACKUP_SLOTS.indexOf(parisHour(new Date(now))) < 0) return;
  if (now - (db.lastOffsiteBackup || 0) < 3.5 * 60 * 60 * 1000) return; // 1 seule fois par créneau
  offsiteRunning = true;
  try { await runOffsiteBackup('auto'); } catch (e) { console.error('🗄', e.message); } finally { offsiteRunning = false; }
}
if (OFFSITE) {
  // une destination locale placée DANS data/ ferait s'auto-archiver les archives
  if (OFFSITE.mode === 'local' && path.resolve(OFFSITE.local).startsWith(path.resolve(DATA_DIR))) {
    console.error('🗄 destination locale interdite (dans data/) — sauvegarde désactivée');
  } else {
    // ménage des archives temporaires laissées par un arrêt brutal
    try { fs.readdirSync(os.tmpdir()).forEach(f => { if (/^ls-data-.*\.tar\.gz$/.test(f)) { try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch (e) { } } }); } catch (e) { }
    setTimeout(offsiteTick, 60 * 1000);
    setInterval(offsiteTick, 15 * 60 * 1000);
  }
}

const ROLES = ['admin', 'eleve', 'prof'];
const ROLE_LABEL = { admin: 'Administrateur', eleve: 'Apprenant', prof: 'Formateur' };
const ADMIN_ID = 'admins';
const ADMIN_MEMBER = { id: ADMIN_ID, prenom: 'Administration', nom: 'L&S', role: 'admin' };

const pub = (u) => u ? ({ id: u.id, prenom: u.prenom, nom: u.nom, role: u.role, email: u.email }) : null;
const pubFull = (u) => u ? Object.assign(pub(u), { profile: u.profile || {} }) : null;

// ---- visite guidée de l'espace documents ----------------------------------
// La version VUE est enregistrée sur le COMPTE, pas dans le navigateur : elle suit la personne
// d'un poste à l'autre et survit à un vidage du cache. (Un localStorage obligerait en plus à
// rouvrir confidentialite.html § 6, qui énumère nommément ce que le site écrit dans le navigateur.)
// ⚠️ Le champ vit au premier niveau du user, JAMAIS dans `profile` : cleanProfile reconstruit
// `profile` par liste blanche à chaque PATCH /api/users/:id, le drapeau y serait effacé au premier
// enregistrement de fiche par l'admin — et `profile` est exposé aux tiers par pubFull.
// ⚠️ N'incrémenter TUTO_VERSION que si la visite doit être revue par TOUT LE MONDE (refonte de
// l'interface) : tous les formateurs et apprenants la reverraient à leur connexion suivante.
const TUTO_VERSION = 1;
const tutoAVoir = (u) => !!u && u.role !== 'admin' && +(u.tutoVu || 0) < TUTO_VERSION;
// Vue de SOI-MÊME. ⚠️ pubFull sert AUSSI à sérialiser les AUTRES membres d'un dossier (groupView)
// et tous les comptes (/api/admin/overview) : ce qui ne regarde que la personne elle-même se pose
// ici, jamais dans pub/pubFull — sinon un formateur saurait si son apprenant a vu la visite.
const meFull = (u) => Object.assign(pubFull(u), { tutoAVoir: tutoAVoir(u) });
const sTrim = (v) => String(v == null ? '' : v).trim();
function cleanProfile(role, p) {
  p = p || {};
  if (role === 'eleve') return { tel: sTrim(p.tel), societe: sTrim(p.societe), refProposition: sTrim(p.refProposition), heuresTotal: sTrim(p.heuresTotal), heuresDetail: sTrim(p.heuresDetail), intitule: sTrim(p.intitule), langue: sTrim(p.langue), dateDebut: sTrim(p.dateDebut), dateFin: sTrim(p.dateFin), lieu: sTrim(p.lieu), lieuAdresse: sTrim(p.lieuAdresse), certification: sTrim(p.certification), certificationText: sTrim(p.certificationText) };
  if (role === 'prof') return { langue: sTrim(p.langue), siret: sTrim(p.siret), nda: sTrim(p.nda), adresse: sTrim(p.adresse), tel: sTrim(p.tel), dateNaissance: sTrim(p.dateNaissance), nationalite: sTrim(p.nationalite) };
  return {};
}
// Version d'un document : 1.0 à la première génération, puis +0,1 à chaque nouvelle génération
// du MÊME document (même dossier, même modèle). Le compteur est persistant et INDÉPENDANT de
// l'historique db.docgens, qui lui est purgé au-delà de 40 entrées par dossier.
function bumpVersion(g, tpl) {
  if (!g || !tpl) return '1.0';
  db.docVersions = db.docVersions || {};
  const cle = g.id + '|' + tpl;
  const nb = (db.docVersions[cle] || 0) + 1;          // 1 = première génération
  db.docVersions[cle] = nb;
  save();
  return (1 + (nb - 1) / 10).toFixed(1);              // 1.0, 1.1, 1.2 …
}
// version COURANTE, sans incrémenter : une pièce déjà produite qu'on régénère dans un autre
// format n'est pas une nouvelle version du document, c'est le même document en .docx.
function verOf(g, tpl) {
  if (!g || !tpl) return '1.0';
  const nb = (db.docVersions || {})[g.id + '|' + tpl] || 1;
  return (1 + (nb - 1) / 10).toFixed(1);
}
// pied de page : lignes méta (présentes sur TOUS les documents générés)
function metaLines(user, ver) {
  const v = ver || '1.0';
  return [
    'Créé le 07/06/2026 par FPE',
    'Rédigé le ' + new Date().toLocaleDateString('fr-FR') + ' par ' + senderDisplay(user),
    v === '1.0' ? "Ce fichier n'a pas encore été modifié — Version 1.0" : 'Version ' + v
  ];
}
const realUser = (id) => db.users.find(u => u.id === id);
const userById = (id) => (id === ADMIN_ID ? ADMIN_MEMBER : realUser(id));
const fullName = (id) => { const u = realUser(id); return u ? `${u.prenom} ${u.nom}` : '—'; };
const senderDisplay = (u) => (u.role === 'admin' ? 'Administration L&S' : `${u.prenom} ${u.nom}`);
const nameDate = () => new Date().toLocaleDateString('fr-FR').replace(/\//g, '-'); // date sans « / » pour les noms de fichiers
const safeFile = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-');
// ⚠️ `channel` est le 4ᵉ paramètre, FACULTATIF : sans lui la notification n'appartient à aucun
// canal et sera consommée en ouvrant le dossier, quel que soit l'onglet. C'est ce qu'on veut pour
// tout ce qui n'est pas rattaché à une discussion (demande de signature, changement de dossier…).
function notify(userId, text, group, channel) { if (!userId) return; db.notifs.push({ id: crypto.randomUUID(), user: userId, text, group: group || null, channel: channel || null, read: false, date: Date.now() }); }

// ---- dossiers --------------------------------------------------------------
const groupById = (id) => db.groups.find(g => g.id === id);
// Un dossier compte AUTANT de formateurs et d'apprenants que voulu. Ces deux accesseurs sont le
// seul point de lecture des membres : ils tolèrent une base non encore migrée (prof/eleve seuls).
const gProfs = (g) => (g && (g.profs || (g.prof ? [g.prof] : []))) || [];
const gMembers = (g) => g && g.eleve ? [...gProfs(g), g.eleve] : gProfs(g);
// listes d'objets utilisateurs réels (comptes supprimés filtrés)
const gProfUsers = (g) => gProfs(g).map(realUser).filter(Boolean);
function groupsForUser(u) { return u.role === 'admin' ? db.groups.slice() : db.groups.filter(g => gMembers(g).includes(u.id)); }
function isMember(g, u) { return !!g && (u.role === 'admin' || gMembers(g).includes(u.id)); }
function canChannel(g, u, ch) { if (!isMember(g, u)) return false; return ch === 'prive' ? (u.role === 'prof' || u.role === 'admin') : true; }
// `me` = qui regarde. Un apprenant voit QUI est dans le dossier, mais pas la FICHE des autres
// (téléphone, société, heures, dates, SIRET du formateur…) : donnée personnelle d'un tiers.
function groupView(g, me) {
  const view = (id) => (me && me.role === 'eleve' && id !== me.id) ? pub(realUser(id)) : pubFull(realUser(id));
  return {
    id: g.id,
    profs: gProfs(g).map(view).filter(Boolean),
    eleve: view(g.eleve),
    admin: { id: ADMIN_ID, prenom: 'Administration', nom: 'L&S', role: 'admin' },
    date: g.date
  };
}
function channelRecipients(g, ch, senderId) {
  const ids = new Set();
  gProfs(g).forEach(id => ids.add(id));                 // le canal privé reste formateurs + admins
  if (ch === 'commun' && g.eleve) ids.add(g.eleve);
  db.users.filter(u => u.role === 'admin').forEach(a => ids.add(a.id));
  ids.delete(senderId);
  return [...ids];
}
// ⚠️ La notification porte le CANAL d'origine. Sans lui, ouvrir un dossier (qui atterrit toujours
// sur « commun ») effaçait aussi les notifications du canal privé : le formateur perdait l'alerte
// d'un message privé sans l'avoir jamais vue. Défaut réel, signalé par l'utilisateur le 05/08/2026.
function notifyChannel(g, ch, sender, text) { channelRecipients(g, ch, sender.id).forEach(id => notify(id, text, g.id, ch)); }

// ---- app -------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '2mb' })); // marge pour les signatures (data URL PNG)
// ⚠️ Le Dockerfile copie le dépôt ENTIER dans l'image, et express.static sert tout ce qui n'est
// pas filtré ici. Le filtre d'origine ne couvrait que data/, node_modules, server.js et
// package.json : le 05/08/2026, https://…/blog/outils/sync-prod.js répondait 200 avec
// l'identifiant ET le mot de passe du compte admin de production en clair, /CLAUDE.md livrait
// les mêmes mots de passe, et /blog/posts-linkedin.js les notes internes que l'API retire
// pourtant à tout non-admin. On bloque donc TOUT ce qui n'est pas le site lui-même.
// ⚠️ Ce qui doit rester public : les pages .html, assets/, blog/img/ (visuels des articles),
// robots.txt, et les scripts de la racine que les pages chargent (ls-engine.js, test-data.js,
// morph.js et les animations en réserve). Toute nouvelle ressource servie doit être vérifiée ici.
const PRIVE = [
  /^\/(data|node_modules)(\/|$)/,                                  // base, fichiers déposés, dépendances
  /^\/(server|process-logos)\.js$/,                                // code serveur et outils de build
  /^\/package(-lock)?\.json$/,
  /^\/blog\/(outils|articles-sources)(\/|$)/,                      // outillage : identifiants en clair
  /^\/blog\/(posts-linkedin\.js|sujets\.md)$/,                     // notes internes
  /^\/versions(\/|$)/,                                             // animations archivées
  /^\/\./,                                                         // .github, .gitignore, .dockerignore, .env…
  /^\/(Dockerfile|docker-compose\.ya?ml)$/i,
  /\.md$/i,                                                        // CLAUDE.md, RESTORE.md : mots de passe et procédures
];
app.use((req, res, next) => {
  if (PRIVE.some(r => r.test(req.path))) return res.status(404).end();
  next();
});

// ---- auth ------------------------------------------------------------------
function sign(user) { return jwt.sign({ id: user.id }, db.secret, { expiresIn: '30d' }); }
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });
  try {
    const u = realUser(jwt.verify(token, db.secret).id);
    if (!u) return res.status(401).json({ error: 'Session invalide.' });
    // ⚠️ DERNIÈRE ACTIVITÉ. L'historique des connexions ne voit que les LOGINS : quelqu'un qui
    // reste connecté (le jeton vit 30 jours) n'y réapparaît jamais, et on ne sait plus s'il
    // utilise la plateforme. On horodate donc chaque requête authentifiée.
    // ⚠️ Écriture BRIDÉE à 5 minutes : save() réécrit tout db.json, le faire à chaque appel
    // (la cloche est interrogée toutes les 20 s par onglet ouvert) userait le disque pour rien.
    const maintenant = Date.now();
    if (maintenant - (u.lastSeen || 0) > 5 * 60 * 1000) { u.lastSeen = maintenant; save(); }
    req.user = u; next();
  } catch (e) { return res.status(401).json({ error: 'Session expirée.' }); }
}

// ---- comptes ---------------------------------------------------------------
// L'inscription publique est fermée : les comptes sont créés par l'administration
// (POST /api/admin/users ci-dessous). Les comptes démo restent seedés côté serveur.
app.post('/api/signup', (req, res) => {
  res.status(403).json({ error: 'Les inscriptions se font par l\'administration Languages & Success.' });
});
// création d'un compte (apprenant ou formateur) PAR un admin + e-mail de bienvenue
app.post('/api/admin/users', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const { prenom, nom, email, role, profile } = req.body || {};
  if (!prenom || !nom || !email) return res.status(400).json({ error: 'Champs manquants.' });
  if (!['eleve', 'prof'].includes(role)) return res.status(400).json({ error: 'Rôle invalide (apprenant ou formateur).' });
  const mail = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  if (db.users.some(u => u.email === mail)) return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });
  // L'administration ne choisit PAS le mot de passe : le compte est créé sans mot de passe
  // utilisable, et la personne définit le sien via un lien d'activation à usage unique.
  const user = {
    id: crypto.randomUUID(), prenom: prenom.trim(), nom: nom.trim(), email: mail, role,
    passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10), // inutilisable
    activation: newActivation(), mustActivate: true, profile: cleanProfile(role, profile),
    // ⚠️ dateCreation : sans elle, impossible de dire depuis COMBIEN DE TEMPS un compte attend.
    // Les comptes créés avant le 05/08/2026 n'en ont pas : on retombe alors sur la date du
    // lien d'activation (exp - 14 jours), qui est la meilleure approximation disponible.
    dateCreation: Date.now(), relances: 0
  };
  db.users.push(user); save();
  sendActivationMail(user, req.user);
  res.json({ ok: true, user: pubFull(user) });
});
// lien d'activation : jeton aléatoire, à usage unique, valable 14 jours
function newActivation() { return { token: crypto.randomBytes(32).toString('hex'), envoyeLe: Date.now(), exp: Date.now() + 14 * 24 * 60 * 60 * 1000 }; }
function sendActivationMail(user, byUser) {
  const url = SITE_URL + '/espace-documents.html#activation=' + user.activation.token;
  const par = byUser ? (' par ' + senderDisplay(byUser)) : '';
  sendMailSafe(user.email,
    'Votre compte espace documents est prêt — Languages & Success',
    'Bonjour ' + user.prenom + ',\n\nUn compte vient d\'être créé pour vous' + par + ' sur l\'espace documents Languages & Success.\nIdentifiant : ' + user.email + '\n\nChoisissez votre mot de passe (lien valable 14 jours) :\n' + url + '\n\nCe lien est personnel : ne le transmettez à personne.\n\nLanguages & Success',
    mailHtml('Votre compte est prêt ✓',
      ['Bonjour ' + user.prenom + ',', 'Un compte vient d\'être créé pour vous' + par + ' sur l\'espace documents Languages & Success.',
       'Identifiant : ' + user.email, 'Il ne reste qu\'à choisir votre mot de passe. Ce lien est personnel et valable 14 jours.'],
      'Choisir mon mot de passe', url));
}
const activationOf = (t) => db.users.find(u => u.activation && u.activation.token === t && u.activation.exp > Date.now());
// vérifie le lien avant d'afficher le formulaire (nom affiché, pas de fuite d'information)
app.get('/api/activate/:token', (req, res) => {
  const u = activationOf(req.params.token);
  if (!u) return res.status(404).json({ error: 'Ce lien est invalide ou a expiré. Demandez-en un nouveau à l\'administration.' });
  res.json({ ok: true, prenom: u.prenom, email: u.email });
});
// la personne choisit son mot de passe : le jeton est consommé et elle est connectée
app.post('/api/activate', async (req, res) => {
  const { token, password } = req.body || {};
  const u = activationOf(token);
  if (!u) return res.status(404).json({ error: 'Ce lien est invalide ou a expiré. Demandez-en un nouveau à l\'administration.' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
  u.passwordHash = await bcrypt.hash(String(password), 10);
  delete u.activation;                       // usage unique
  delete u.mustActivate;
  u.lastSeen = Date.now();   // une connexion compte comme une activite
  db.logins.push({ id: crypto.randomUUID(), user: u.id, email: u.email, ip: clientIp(req), date: Date.now() });
  if (db.logins.length > 1000) db.logins = db.logins.slice(-1000);
  save();
  // ⚠️ meFull et non pubFull : l'activation par lien e-mail CONNECTE automatiquement et alimente
  // ME depuis cette réponse, sans jamais passer par /api/me. C'est exactement la « première
  // connexion » visée par la visite guidée : l'oublier ici la ferait rater dans le seul cas qui compte.
  res.json({ token: sign(u), user: meFull(u) });
});
// Changer SON PROPRE mot de passe. La seule route qui le permettait était l'activation par lien
// e-mail, à usage unique : une fois le compte activé, plus personne ne pouvait changer son mot de
// passe, pas même l'administration sur son propre compte.
// ⚠️ On exige le mot de passe ACTUEL même si la personne est déjà authentifiée : le jeton vit
// 30 jours dans un localStorage partagé entre onglets, et un poste laissé ouvert suffirait sinon
// à verrouiller quelqu'un hors de son compte.
// ⚠️ On ne fait PAS de différence de message entre « mot de passe actuel faux » et le reste : la
// personne est déjà identifiée, il n'y a rien à deviner, mais autant garder l'habitude.
app.post('/api/me/password', auth, async (req, res) => {
  const { actuel, nouveau } = req.body || {};
  const u = realUser(req.user.id);
  if (!u) return res.status(404).json({ error: 'Compte introuvable.' });
  if (!(await bcrypt.compare(String(actuel || ''), u.passwordHash))) {
    return res.status(403).json({ error: 'Mot de passe actuel incorrect.' });
  }
  const n = String(nouveau || '');
  if (n.length < 6) return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 6 caractères.' });
  if (n === String(actuel || '')) return res.status(400).json({ error: 'Le nouveau mot de passe est identique à l\'ancien.' });
  u.passwordHash = await bcrypt.hash(n, 10);
  // ⚠️ un compte en attente d'activation qui change son mot de passe ici est activé de fait :
  // sans ça il resterait bloqué au 403 « compte non activé » de /api/login avec un mot de passe
  // pourtant valide. Le jeton d'activation est consommé au passage.
  delete u.activation;
  delete u.mustActivate;
  save();
  // le jeton reste valable : la personne n'est pas déconnectée de l'onglet où elle travaille
  res.json({ ok: true });
});
// ---- MOT DE PASSE OUBLIÉ (05/08/2026) --------------------------------------
// ⚠️ CHAMP DISTINCT `u.reset`, JAMAIS `u.activation`. Le champ d'activation est unique : y poser
// un jeton de réinitialisation écraserait l'invitation en cours, et — bien pire — activationOf
// ne distingue pas les deux natures de jeton, donc un lien de réinitialisation serait accepté par
// POST /api/activate, qui lèverait mustActivate au passage.
// ⚠️ Durée COURTE (1 heure) et non les 14 jours d'une invitation : celle-ci est posée par un
// administrateur, celui-là se déclenche par n'importe qui depuis un formulaire public.
const RESET_DUREE = 60 * 60 * 1000;
const resetOf = (t) => {
  // ⚠️ comparaison en minuscules : le motif côté navigateur est insensible à la casse, et un
  // client de messagerie qui capitaliserait le lien passerait le client pour échouer ici.
  const k = String(t || '').toLowerCase();
  return db.users.find(u => u.reset && u.reset.token === k && u.reset.exp > Date.now());
};
app.post('/api/password-reset/request', (req, res) => {
  const mail = String((req.body || {}).email || '').trim().toLowerCase();
  const u = mail ? db.users.find(x => x.email === mail) : null;
  if (u) {
    // ⚠️ Un compte encore en attente d'activation reçoit son lien d'ACTIVATION, pas un lien de
    // réinitialisation : c'est le même besoin (choisir un mot de passe) et cela évite de lui
    // poser deux jetons de natures différentes. Son invitation n'est pas écrasée pour autant.
    if (u.mustActivate) {
      if (!u.activation || u.activation.exp < Date.now()) u.activation = newActivation();
      sendActivationMail(u, null);
    } else {
      u.reset = { token: crypto.randomBytes(32).toString('hex'), exp: Date.now() + RESET_DUREE };
      const url = SITE_URL + '/espace-documents.html#reinit=' + u.reset.token;
      sendMailSafe(u.email, 'Réinitialiser votre mot de passe — Languages & Success',
        'Bonjour ' + u.prenom + ',\n\nVous avez demandé à réinitialiser le mot de passe de votre espace documents.\nChoisissez-en un nouveau (lien valable 1 heure, utilisable une seule fois) :\n' + url
          + "\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.\nPour nous joindre : contact@languagesandsuccess.com\n\nLanguages & Success",
        mailHtml('Réinitialiser votre mot de passe',
          ['Bonjour ' + u.prenom + ',', 'Vous avez demandé à réinitialiser le mot de passe de votre espace documents.',
           'Ce lien est valable une heure et ne fonctionne qu\'une fois.',
           "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable."],
          'Choisir un nouveau mot de passe', url));
    }
    save();
  }
  // ⚠️ RÉPONSE IDENTIQUE que l'adresse existe ou non : sinon ce formulaire, public et sans
  // limitation de débit, devient un annuaire qui dit qui est client de l'organisme.
  res.json({ ok: true });
});
app.get('/api/password-reset/:token', (req, res) => {
  const u = resetOf(req.params.token);
  if (!u) return res.status(404).json({ error: 'Ce lien est invalide ou a expiré. Demandez-en un nouveau.' });
  res.json({ ok: true, prenom: u.prenom, email: u.email });
});
app.post('/api/password-reset', async (req, res) => {
  const { token, password } = req.body || {};
  const u = resetOf(token);
  if (!u) return res.status(404).json({ error: 'Ce lien est invalide ou a expiré. Demandez-en un nouveau.' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
  u.passwordHash = await bcrypt.hash(String(password), 10);
  delete u.reset;                            // usage unique : sans ce delete, le lien reste rejouable une heure
  delete u.mustActivate;                     // par sécurité : un compte en attente ne doit pas rester bloqué
  u.lastSeen = Date.now();   // une connexion compte comme une activite
  db.logins.push({ id: crypto.randomUUID(), user: u.id, email: u.email, ip: clientIp(req), date: Date.now() });
  if (db.logins.length > 1000) db.logins = db.logins.slice(-1000);
  save();
  // meFull et non pubFull : comme l'activation, on connecte, et la visite guidée en dépend
  res.json({ token: sign(u), user: meFull(u) });
});
// l'administration renvoie le lien (perdu, expiré, adresse corrigée)
app.post('/api/admin/users/:id/reinvite', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const u = realUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'Compte introuvable.' });
  if (u.role === 'admin') return res.status(400).json({ error: 'Compte administrateur : non concerné.' });
  u.activation = newActivation();
  u.relances = (u.relances || 0) + 1;
  u.derniereRelance = Date.now();
  save();
  sendActivationMail(u, req.user);
  res.json({ ok: true });
});
// IP réelle du visiteur (derrière le tunnel Cloudflare en prod, direct en local)
function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const user = db.users.find(u => u.email === mail);
  // compte créé mais jamais activé : on l'explique au lieu du sec « mot de passe incorrect »
  // (un lien renvoyé à quelqu'un qui a DÉJÀ son mot de passe ne le bloque pas : mustActivate absent)
  if (user && user.mustActivate) {
    const vivant = user.activation && user.activation.exp > Date.now();
    return res.status(403).json({
      error: vivant
        ? 'Ce compte n\'est pas encore activé : utilisez le lien « Choisir mon mot de passe » reçu par e-mail.'
        : 'Ce compte n\'est pas encore activé et votre lien a expiré. Écrivez à admin@languagesandsuccess.com pour en recevoir un nouveau.'
    });
  }
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  user.lastSeen = Date.now();   // une connexion compte comme une activite
  // historique de connexions (borné aux 1000 dernières entrées)
  db.logins.push({ id: crypto.randomUUID(), user: user.id, email: user.email, ip: clientIp(req), date: Date.now() });
  if (db.logins.length > 1000) db.logins = db.logins.slice(-1000);
  save();
  res.json({ token: sign(user), user: meFull(user) });
});
// sauvegarde offsite : statut (admin) + déclenchement manuel (admin)
app.get('/api/admin/backup-status', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  res.json({ configured: !!OFFSITE, mode: OFFSITE ? OFFSITE.mode : null, status: db.backupStatus || null, last: db.lastOffsiteBackup || null });
});
app.post('/api/admin/backup-run', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  if (!OFFSITE) return res.status(400).json({ error: 'Sauvegarde non configurée.' });
  if (offsiteRunning) return res.status(409).json({ error: 'Une sauvegarde est déjà en cours.' });
  offsiteRunning = true;
  try { const st = await runOffsiteBackup('manuel', !!(req.body || {}).force); res.json({ ok: !!st.ok, status: st }); }
  finally { offsiteRunning = false; }
});
// historique de connexions (admin) — global ou filtré par compte (?user=<id>)
app.get('/api/admin/logins', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  let list = db.logins.slice();
  if (req.query.user) list = list.filter(l => l.user === req.query.user);
  list = list.sort((a, b) => b.date - a.date).slice(0, 200).map(l => {
    const u = realUser(l.user);
    return { id: l.id, userId: l.user, name: u ? `${u.prenom} ${u.nom}` : '(compte supprimé)', email: l.email, ip: l.ip, date: l.date };
  });
  res.json({ logins: list });
});
app.get('/api/me', auth, (req, res) => res.json({ user: meFull(req.user) }));

// ---- visite guidée : « je l'ai vue » ---------------------------------------
// Appelé une seule fois par visite, à la première sortie quelle qu'elle soit (Terminer, Passer,
// croix, Échap). Le bouton « Revoir la visite guidée » ne passe PAS par ici : il n'écrit rien.
app.post('/api/tuto/vu', auth, (req, res) => {
  // ⚠️ le jeton vit dans un localStorage PARTAGÉ par tous les onglets : un onglet resté ouvert
  // sur un compte pendant qu'un autre se connecte enverrait sa requête avec le nouveau jeton.
  // Le client annonce donc qui il croit être, et on refuse si la session a changé sous ses pieds.
  if (req.body && req.body.user && req.body.user !== req.user.id) return res.status(409).json({ error: 'Session changée.' });
  if (req.user.role === 'admin') return res.json({ ok: true });                 // sans objet
  if (+(req.user.tutoVu || 0) >= TUTO_VERSION) return res.json({ ok: true });   // déjà fait : pas de save() inutile
  req.user.tutoVu = TUTO_VERSION;   // req.user EST l'objet vivant de db.users (auth → realUser)
  save();
  res.json({ ok: true });
});
app.get('/api/users', auth, (req, res) => {
  let list = db.users.filter(u => u.id !== req.user.id);
  if (req.user.role !== 'admin') list = list.filter(u => u.role !== 'admin'); // non-admins ne voient pas les admins
  res.json({ users: list.map(pub) });
});

// ---- dossiers --------------------------------------------------------------
app.get('/api/groups', auth, (req, res) => {
  res.json({ groups: groupsForUser(req.user).sort((a, b) => b.date - a.date).map(g => groupView(g, req.user)) });
});
// libellé « Prénom Nom (Formateur) + … » utilisé dans les notifications et la vue admin
const membersLabel = (g) => [
  ...(g && g.eleve ? [`${fullName(g.eleve)} (Apprenant)`] : []),
  ...gProfs(g).map(id => `${fullName(id)} (Formateur)`)
].join(' + ') || '(dossier vide)';
// Un dossier peut compter plusieurs formateurs : on désigne celui que le document concerne.
// Par défaut, un formateur qui génère un document le fait EN SON NOM.
function targetProf(g, id, user) {
  const list = gProfs(g);
  if (!list.length) return { error: 'Ce dossier ne compte aucun formateur.' };
  if (id) {
    if (!list.includes(id)) return { error: 'Ce formateur ne fait pas partie du dossier.' };
    return { id };
  }
  if (user && user.role === 'prof' && list.includes(user.id)) return { id: user.id };
  if (list.length > 1) return { error: 'Ce dossier compte plusieurs formateurs : précisez lequel est concerné.' };
  return { id: list[0] };
}
// valide une liste d'identifiants pour un rôle donné : dédoublonne, refuse les inconnus
function pickMembers(ids, role, label) {
  const out = [];
  for (const id of (Array.isArray(ids) ? ids : (ids ? [ids] : []))) {
    const u = realUser(id);
    if (!u || u.role !== role) return { error: `${label} invalide.` };
    if (!out.includes(u.id)) out.push(u.id);
  }
  // ordre alphabétique STABLE : re-enregistrer une composition inchangée ne doit jamais
  // réordonner les membres (l'affichage et les valeurs par défaut en dépendent)
  out.sort((a, b) => fullName(a).localeCompare(fullName(b), 'fr'));
  return { ids: out };
}
// Les dossiers sont constitués par l'ADMINISTRATION UNIQUEMENT (30/07/2026). Avant, un formateur
// pouvait s'ajouter un apprenant lui-même via {targetId} : c'est retiré, côté serveur comme côté
// client, pour que la composition des dossiers reste une décision de l'administration.
app.post('/api/groups', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Les dossiers sont créés par l\'administration.' });
  const b = req.body || {};
  // un dossier = UN apprenant, mais AUTANT DE FORMATEURS que voulu
  const p = pickMembers(b.profIds != null ? b.profIds : b.profId, 'prof', 'Formateur');
  if (p.error) return res.status(400).json({ error: p.error });
  if (!p.ids.length) return res.status(400).json({ error: 'Choisissez au moins un formateur.' });
  const e = realUser(b.eleveId);
  if (!e || e.role !== 'eleve') return res.status(400).json({ error: 'Apprenant invalide.' });
  const profs = p.ids, eleve = e.id;
  const g = { id: crypto.randomUUID(), profs, eleve, date: Date.now() };
  db.groups.push(g);
  const label = membersLabel(g);
  gMembers(g).forEach(id => notify(id, `Vous avez été ajouté dans un dossier : ${label}.`, g.id));
  db.users.filter(u => u.role === 'admin').forEach(a => notify(a.id, `Nouveau dossier : ${label}.`, g.id));
  save();
  res.json({ ok: true, group: g.id });
});
// composition d'un dossier existant (admin) : ajouter / retirer des formateurs et des apprenants
app.patch('/api/groups/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const g = groupById(req.params.id);
  if (!g) return res.status(404).json({ error: 'Dossier introuvable.' });
  const b = req.body || {};
  const p = pickMembers(b.profIds, 'prof', 'Formateur');
  if (p.error) return res.status(400).json({ error: p.error });
  if (!p.ids.length) return res.status(400).json({ error: 'Un dossier doit garder au moins un formateur.' });
  const avant = gProfs(g);
  const ajoutes = p.ids.filter(id => !avant.includes(id));
  const retires = avant.filter(id => !p.ids.includes(id));
  // l'apprenant du dossier ne change pas ici : un dossier est le dossier d'UN apprenant
  g.profs = p.ids;
  const label = membersLabel(g);
  ajoutes.forEach(id => notify(id, `Vous avez été ajouté dans un dossier : ${label}.`, g.id));
  retires.forEach(id => {
    db.notifs = db.notifs.filter(n => !(n.user === id && n.group === g.id)); // sinon badge sur un dossier devenu invisible
    notify(id, `Vous avez été retiré d'un dossier.`, null);
  });
  save();
  res.json({ ok: true, group: groupView(g, req.user) });
});
// suppression (admin) : un dossier → supprime ses fichiers, messages, questionnaires, worksheets
function deleteGroupCascade(gid) {
  db.docs.filter(d => d.group === gid).forEach(d => { try { fs.unlinkSync(path.join(UPLOADS_DIR, d.stored)); } catch (e) { } });
  db.docs = db.docs.filter(d => d.group !== gid);
  db.messages = db.messages.filter(m => m.group !== gid);
  db.qs = db.qs.filter(q => q.group !== gid);
  db.presences = db.presences.filter(p => p.group !== gid); // sinon signatures manuscrites orphelines
  db.attestations = db.attestations.filter(a => a.group !== gid);   // idem : données personnelles
  db.contrats = db.contrats.filter(c => c.group !== gid);
  db.worksheets = db.worksheets.filter(w => w.group !== gid);
  db.docgens = db.docgens.filter(x => x.group !== gid);
  db.notifs = db.notifs.filter(n => n.group !== gid);   // sinon badges fantômes sur un dossier disparu
  db.groups = db.groups.filter(g => g.id !== gid);
}
app.delete('/api/groups/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const g = groupById(req.params.id);
  if (!g) return res.status(404).json({ error: 'Dossier introuvable.' });
  deleteGroupCascade(g.id); save();
  res.json({ ok: true });
});
app.delete('/api/users/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const u = realUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'Compte introuvable.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  // Un dossier peut compter PLUSIEURS FORMATEURS : supprimer l'un d'eux ne doit pas détruire le
  // dossier (ce serait détruire les documents de l'apprenant et le travail des autres formateurs).
  // Il en est simplement retiré ; le dossier n'est supprimé que s'il ne reste plus aucun formateur.
  // Supprimer l'APPRENANT, en revanche, supprime son dossier : c'est son dossier.
  db.groups.filter(g => g.eleve === u.id).map(g => g.id).forEach(deleteGroupCascade);
  db.groups.forEach(g => { g.profs = gProfs(g).filter(id => id !== u.id); });
  db.groups.filter(g => !gProfs(g).length).map(g => g.id).forEach(deleteGroupCascade);
  db.notifs = db.notifs.filter(n => n.user !== u.id);
  db.users = db.users.filter(x => x.id !== u.id);
  save();
  res.json({ ok: true });
});
// modification d'une fiche (admin) : infos de base + profil (apprenant/formateur)
app.patch('/api/users/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const u = realUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'Compte introuvable.' });
  const { prenom, nom, email, profile } = req.body || {};
  if (prenom != null && sTrim(prenom)) u.prenom = sTrim(prenom);
  if (nom != null && sTrim(nom)) u.nom = sTrim(nom);
  if (email != null) {
    const mail = String(email).trim().toLowerCase();
    if (mail && mail !== u.email) {
      if (db.users.some(x => x.id !== u.id && x.email === mail)) return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });
      u.email = mail;
    }
  }
  if (profile != null) u.profile = cleanProfile(u.role, Object.assign({}, u.profile, profile));
  save();
  res.json({ ok: true, user: pubFull(u) });
});

// ---- messagerie (par dossier + canal) --------------------------------------
app.get('/api/messages', auth, (req, res) => {
  const g = groupById(req.query.group);
  const ch = req.query.channel === 'prive' ? 'prive' : 'commun';
  if (!canChannel(g, req.user, ch)) return res.status(403).json({ error: 'Accès refusé.' });
  const msgs = db.messages.filter(m => m.group === g.id && m.channel === ch).sort((a, b) => a.date - b.date)
    .map(m => {
      const o = { id: m.id, from: m.from, fromAdmin: !!m.fromAdmin, fromName: m.fromAdmin ? 'Administration L&S' : fullName(m.from), text: m.text, date: m.date, kind: m.kind || 'text' };
      if (m.kind === 'qs') { const q = db.qs.find(x => x.id === m.qsId); o.qs = { id: m.qsId, type: m.qsType, title: (QS_TEMPLATES[m.qsType] || {}).title || 'Questionnaire', status: q ? q.status : 'pending', docId: q ? q.docId : null }; }
      if (m.kind === 'presence') { const p = db.presences.find(x => x.id === m.presenceId); o.presence = { id: m.presenceId, type: p ? p.type : null, title: (PRESENCE_TEMPLATES[p && p.type] || {}).title || 'Feuille de présence', status: p ? p.status : 'pending', docId: p ? p.docId : null }; }
      // ⚠️ Un kind non hydraté ici arrive au client avec un objet vide : la carte s'affiche sans
      // titre, sans statut et sans bouton, SANS la moindre erreur. Panne parfaitement silencieuse.
      if (m.kind === 'attestation') { const a = db.attestations.find(x => x.id === m.attestationId); o.attestation = { id: m.attestationId, title: 'Attestation de fin de formation', status: a ? a.status : 'pending', docId: a ? a.docId : null }; }
      if (m.kind === 'contrat') { const c = db.contrats.find(x => x.id === m.contratId); o.contrat = { id: m.contratId, title: 'Contrat de sous-traitance', status: c ? c.status : 'pending', docId: c ? c.docId : null, prof: c ? c.prof : null, ref: c ? c.ref : '' }; }
      return o;
    });
  res.json({ messages: msgs });
});
app.post('/api/messages', auth, (req, res) => {
  const { group, channel, text } = req.body || {};
  const ch = channel === 'prive' ? 'prive' : 'commun';
  const g = groupById(group);
  const msg = String(text || '').trim();
  if (!msg) return res.status(400).json({ error: 'Message vide.' });
  if (msg.length > 4000) return res.status(400).json({ error: 'Message trop long.' });
  if (!canChannel(g, req.user, ch)) return res.status(403).json({ error: 'Accès refusé.' });
  db.messages.push({ id: crypto.randomUUID(), group: g.id, channel: ch, from: req.user.id, fromAdmin: req.user.role === 'admin', text: msg, date: Date.now() });
  notifyChannel(g, ch, req.user, `${senderDisplay(req.user)} a écrit ${ch === 'prive' ? '(privé) ' : ''}dans un dossier : ${msg.slice(0, 70)}`);
  save();
  res.json({ ok: true });
});

// ---- documents (par dossier + canal) ---------------------------------------
const upload = multer({
  storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, UPLOADS_DIR), filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname || '')) }),
  limits: { fileSize: 25 * 1024 * 1024 }
});
const docPub = (d) => ({ id: d.id, name: d.name, size: d.size, type: d.type, from: d.from, fromAdmin: !!d.fromAdmin, fromName: d.fromAdmin ? 'Administration L&S' : fullName(d.from), channel: d.channel, group: d.group, date: d.date });

app.post('/api/documents', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier.' });
  const g = groupById(req.body.group);
  const ch = req.body.channel === 'prive' ? 'prive' : 'commun';
  if (!canChannel(g, req.user, ch)) return res.status(403).json({ error: 'Accès refusé.' });
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const doc = { id: crypto.randomUUID(), group: g.id, channel: ch, from: req.user.id, fromAdmin: req.user.role === 'admin', name: originalName, size: req.file.size, type: req.file.mimetype, stored: req.file.filename, date: Date.now() };
  db.docs.push(doc);
  notifyChannel(g, ch, req.user, `${senderDisplay(req.user)} a partagé un document ${ch === 'prive' ? '(privé) ' : ''}: ${originalName}`);
  save();
  res.json({ doc: docPub(doc) });
});
// suppression d'un document : par son expéditeur (formateur) ou par l'administration.
// Les pièces SIGNÉES (feuille de présence, questionnaire rempli) sont protégées : ce sont
// des pièces justificatives, et les retirer laisserait la demande dans un état incohérent.
app.delete('/api/documents/:id', auth, (req, res) => {
  const d = db.docs.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Document introuvable.' });
  const g = groupById(d.group);
  if (!canChannel(g, req.user, d.channel)) return res.status(403).json({ error: 'Accès refusé.' });
  const isMine = req.user.role === 'admin' ? true : (!d.fromAdmin && d.from === req.user.id);
  if (req.user.role === 'eleve' || !isMine) return res.status(403).json({ error: 'Seul l\'expéditeur ou l\'administration peut supprimer ce document.' });
  // ⚠️ Toute collection de pièces signées doit figurer ici, sinon la pièce justificative
  // redevient supprimable par son expéditeur ou par l'administration.
  if (db.presences.some(p => p.docId === d.id) || db.qs.some(q => q.docId === d.id)
    || db.attestations.some(a => a.docId === d.id) || db.contrats.some(c => c.docId === d.id)) {
    return res.status(400).json({ error: 'Ce document est une pièce signée : il ne peut pas être supprimé.' });
  }
  try { fs.unlinkSync(path.join(UPLOADS_DIR, d.stored)); } catch (e) { }
  db.docs = db.docs.filter(x => x.id !== d.id);
  save();
  res.json({ ok: true });
});
app.get('/api/documents', auth, (req, res) => {
  const g = groupById(req.query.group);
  const ch = req.query.channel === 'prive' ? 'prive' : 'commun';
  if (!canChannel(g, req.user, ch)) return res.status(403).json({ error: 'Accès refusé.' });
  res.json({ docs: db.docs.filter(d => d.group === g.id && d.channel === ch).sort((a, b) => b.date - a.date).map(docPub) });
});
app.get('/api/documents/:id/download', (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || null);
  let uid = null; if (token) { try { uid = jwt.verify(token, db.secret).id; } catch (e) {} }
  const u = realUser(uid);
  if (!u) return res.status(401).end();
  const doc = db.docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).end();
  if (!canChannel(groupById(doc.group), u, doc.channel)) return res.status(403).end();
  res.download(path.join(UPLOADS_DIR, doc.stored), safeFile(doc.name));
});

// ---- pièces signées : la même chose en Word --------------------------------
// Le questionnaire rempli et la feuille de présence signée sont déposés en PDF (l'apprenant ne
// choisit pas le format). Elles se téléchargent aussi en Word, régénérées à la demande à partir
// des réponses et des signatures conservées en base. ⚠️ La VERSION ne bouge pas : c'est le même
// document dans un autre format, pas une nouvelle génération.
// Jeton accepté en en-tête OU en ?token= : un <a href> ne peut pas porter d'en-tête Authorization.
function userDepuisRequete(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || null);
  if (!t) return null;
  try { return realUser(jwt.verify(t, db.secret).id) || null; } catch (e) { return null; }
}
function envoyerWord(res, buf, nom) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  // ⚠️ même forme que les autres téléchargements du fichier : un nom accentué (« Léa », « assiduité »)
  // dans un filename= brut fait échouer setHeader (ERR_INVALID_CHAR).
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(safeFile(nom) + '.docx'));
  res.send(buf);
}
app.get('/api/qs/:id/word', async (req, res) => {
  const u = userDepuisRequete(req); if (!u) return res.status(401).end();
  const qs = db.qs.find(x => x.id === req.params.id);
  if (!qs) return res.status(404).json({ error: 'Questionnaire introuvable.' });
  const g = groupById(qs.group);
  if (!canChannel(g, u, 'commun')) return res.status(403).json({ error: 'Accès refusé.' });
  if (qs.status !== 'done') return res.status(400).json({ error: 'Ce questionnaire n\'a pas encore été rempli.' });
  const tpl = QS_TEMPLATES[qs.type] || {};
  const docPdf = db.docs.find(d => d.id === qs.docId);
  const auteur = realUser(qs.by) || u;
  try {
    const buf = await buildQsDocx(qs, tpl, auteur, (docPdf && docPdf.ver) || verOf(g, qs.type));
    envoyerWord(res, buf, (qs.type === 'qs_mid' ? '2' : '3') + ' - ' + (tpl.title || 'Questionnaire') + ' - ' + ((qs.header && qs.header.nomApprenant) || 'apprenant') + ' - ' + nameDate());
  } catch (e) { console.error('QS word:', e); res.status(500).json({ error: 'Erreur de génération du document.' }); }
});
app.get('/api/presence/:id/word', async (req, res) => {
  const u = userDepuisRequete(req); if (!u) return res.status(401).end();
  const p = db.presences.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Feuille introuvable.' });
  const g = groupById(p.group);
  if (!canChannel(g, u, 'commun')) return res.status(403).json({ error: 'Accès refusé.' });
  if (p.status !== 'done') return res.status(400).json({ error: 'Cette feuille n\'est pas encore signée.' });
  const tpl = PRESENCE_TEMPLATES[p.type] || {};
  const docPdf = db.docs.find(d => d.id === p.docId);
  const auteur = realUser(p.by) || u;
  const d = Object.assign({}, p.fields, { formateurSig: p.formateurSig, apprenantSig: p.apprenantSig });
  try {
    const buf = await buildPresenceDocx(p.type, d, auteur, (docPdf && docPdf.ver) || verOf(g, 'presence-' + p.type));
    envoyerWord(res, buf, (tpl.title || 'Feuille de présence') + ' - ' + ((p.fields && p.fields.apprenant) || 'apprenant') + ' - ' + nameDate() + ' - signee');
  } catch (e) { console.error('présence word:', e); res.status(500).json({ error: 'Erreur de génération du document.' }); }
});

// ---- notifications ---------------------------------------------------------
app.get('/api/notifications', auth, (req, res) => res.json({ notifs: db.notifs.filter(n => n.user === req.user.id).sort((a, b) => b.date - a.date) }));
app.post('/api/notifications/read', auth, (req, res) => { db.notifs.forEach(n => { if (n.user === req.user.id) n.read = true; }); save(); res.json({ ok: true }); });
app.post('/api/notifications/delete', auth, (req, res) => { const id = (req.body || {}).id; db.notifs = db.notifs.filter(n => !(n.user === req.user.id && n.id === id)); save(); res.json({ ok: true }); });
app.post('/api/notifications/clear', auth, (req, res) => { db.notifs = db.notifs.filter(n => n.user !== req.user.id); save(); res.json({ ok: true }); });
// supprime les notifs de l'utilisateur liées à UN dossier (appelé quand il ouvre le dossier)
// Consomme les notifications d'un dossier. ⚠️ Si un canal est précisé, on ne consomme QUE celles
// de ce canal (plus celles sans canal, qui ne dépendent d'aucune discussion) : le formateur qui
// ouvre l'onglet commun ne doit pas perdre l'alerte d'un message arrivé dans le privé.
app.post('/api/notifications/clear-group', auth, (req, res) => {
  const { group: gid, channel } = req.body || {};
  const ch = (channel === 'commun' || channel === 'prive') ? channel : null;
  db.notifs = db.notifs.filter(n => {
    if (n.user !== req.user.id || n.group !== gid) return true;
    if (!ch) return false;                       // pas de canal demandé : on vide tout le dossier
    return !(n.channel === ch || !n.channel);    // sinon : ce canal + les notifs sans canal
  });
  save();
  res.json({ ok: true });
});

// ---- vue admin globale (centralisée) ---------------------------------------
app.get('/api/admin/overview', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const groups = db.groups.slice().sort((a, b) => b.date - a.date).map(g => ({
    id: g.id, label: membersLabel(g),
    profs: gProfs(g).map(id => ({ id, name: fullName(id) })),
    eleve: g.eleve ? { id: g.eleve, name: fullName(g.eleve) } : null,
    docs: db.docs.filter(d => d.group === g.id).length, date: g.date
  }));
  const docs = db.docs.slice().sort((a, b) => b.date - a.date).map(d => { const g = groupById(d.group); return Object.assign(docPub(d), { groupLabel: g ? membersLabel(g) : '—' }); });
  // `pending` = compte créé mais mot de passe pas encore choisi (jamais le jeton lui-même)
  const users = db.users.map(u => Object.assign(pubFull(u), {
    pending: !!u.mustActivate,
    // ⚠️ JAMAIS le jeton lui-même : seulement des dates.
    dateCreation: u.dateCreation || (u.activation && u.activation.exp ? u.activation.exp - 14 * 24 * 60 * 60 * 1000 : null),
    invitationEnvoyee: (u.activation && (u.activation.envoyeLe || (u.activation.exp ? u.activation.exp - 14 * 24 * 60 * 60 * 1000 : null))) || null,
    invitationExpire: (u.activation && u.activation.exp) || null,
    relances: u.relances || 0,
    derniereRelance: u.derniereRelance || null,
    lastSeen: u.lastSeen || null
  }));
  res.json({ users, groups, docs });
});

// ---- génération de documents : Interactive Worksheet -----------------------
const htmlEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nl2br = (s) => htmlEsc(s).replace(/\n/g, '<br>');
const wsFind = (gid) => db.worksheets.find(w => w.group === gid && w.type === 'interactive');
function wsBlank(g, user) {
  // le formateur qui ouvre la worksheet la préremplit à SON nom (et pas à celui d'un collègue)
  const P = (user && user.role === 'prof' && gProfs(g).includes(user.id)) ? user : gProfUsers(g)[0];
  const E = realUser(g.eleve);
  const ep = (E && E.profile) || {}, pp = (P && P.profile) || {};
  return {
    group: g.id, type: 'interactive',
    header: { intitule: ep.intitule || '', langue: ep.langue || pp.langue || '', societe: ep.societe || '', nomApprenant: E ? `${E.prenom} ${E.nom}` : '', nomFormateur: P ? `${P.prenom} ${P.nom}` : '', telApprenant: ep.tel || '', telFormateur: pp.tel || '', mailApprenant: E ? E.email : '', mailFormateur: P ? P.email : '', notes: { vocabulaire: '', structure: '', communication: '', autre: '' } },
    sessions: []
  };
}
function canEditWs(g, u) { return !!g && isMember(g, u) && (u.role === 'prof' || u.role === 'admin'); }

function renderWorksheetHTML(w, user) {
  const h = w.header || {}, notes = h.notes || {};
  const sess = (w.sessions || []).map((s, i) => `
    <div class="session"><h3>Séance ${i + 1}</h3><table>
      <tr><th>Date et durée du cours</th><td>${htmlEsc(s.dateDuree)}</td></tr>
      <tr><th>Formateur</th><td>${htmlEsc(s.formateur)}</td></tr>
      <tr><th>Objectifs de la séance</th><td>${nl2br(s.objectifs)}</td></tr>
      <tr><th>Liste des mots</th><td>${nl2br(s.mots)}</td></tr>
      <tr><th>Structure et grammaire</th><td>${nl2br(s.grammaire)}</td></tr>
      <tr><th>Pronunciation</th><td>${nl2br(s.pronunciation)}</td></tr>
      <tr><th>Erreurs à éviter</th><td>${nl2br(s.erreurs)}</td></tr>
      <tr><th>Pour la prochaine fois</th><td>${nl2br(s.prochaine)}</td></tr>
    </table></div>`).join('');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Interactive Worksheet</title><style>
  body{font-family:Arial,Helvetica,sans-serif;color:#2a241d;max-width:820px;margin:24px auto;padding:0 24px;line-height:1.5}
  h1{color:#be6e54;font-size:24px;border-bottom:3px solid #be6e54;padding-bottom:8px;margin-bottom:4px}
  h2{font-size:16px;margin-top:26px;color:#a8593c}
  h3{font-size:15px;color:#be6e54;margin:0 0 8px}
  table{width:100%;border-collapse:collapse;margin:10px 0 18px}
  th,td{border:1px solid #e6dccb;padding:8px 10px;text-align:left;vertical-align:top;font-size:13.5px}
  th{background:#faf2e7;width:34%;font-weight:600}
  .session{border:1px solid #e6dccb;border-radius:8px;padding:14px 16px;margin:14px 0;background:#fffaf0}
  .meta{color:#6f6253;font-size:12px;margin-top:24px;border-top:1px solid #e6dccb;padding-top:10px}
  .sub{color:#6f6253;font-style:italic;margin:0 0 4px}
  @media print{body{margin:0}}</style></head><body>
  <h1>Interactive Worksheet</h1><p class="sub">À partager à l'apprenant après chaque cours.</p>
  <h2>Formation</h2><table>
    <tr><th>Intitulé de la formation</th><td>${htmlEsc(h.intitule)}</td></tr>
    <tr><th>Langue</th><td>${htmlEsc(h.langue)}</td></tr>
    <tr><th>Société</th><td>${htmlEsc(h.societe)}</td></tr>
    <tr><th>Nom de l'apprenant</th><td>${htmlEsc(h.nomApprenant)}</td></tr>
    <tr><th>Nom du formateur</th><td>${htmlEsc(h.nomFormateur)}</td></tr>
    <tr><th>Tél apprenant</th><td>${htmlEsc(h.telApprenant)}</td></tr>
    <tr><th>Tél formateur</th><td>${htmlEsc(h.telFormateur)}</td></tr>
    <tr><th>Mail apprenant</th><td>${htmlEsc(h.mailApprenant)}</td></tr>
    <tr><th>Mail formateur</th><td>${htmlEsc(h.mailFormateur)}</td></tr></table>
  <h2>Objectifs et organisation — notes du formateur</h2><table>
    <tr><th>Vocabulaire</th><td>${nl2br(notes.vocabulaire)}</td></tr>
    <tr><th>Structure</th><td>${nl2br(notes.structure)}</td></tr>
    <tr><th>Communication</th><td>${nl2br(notes.communication)}</td></tr>
    <tr><th>Autre</th><td>${nl2br(notes.autre)}</td></tr></table>
  <h2>Séances</h2>${sess || '<p class="sub">Aucune séance renseignée.</p>'}
  <p class="meta">Rédigé le ${new Date().toLocaleDateString('fr-FR')} · Languages &amp; Success · Par ${htmlEsc(senderDisplay(user))}</p>
  </body></html>`;
}

app.get('/api/worksheet', auth, (req, res) => {
  const g = groupById(req.query.group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  res.json({ worksheet: wsFind(g.id) || wsBlank(g, req.user) });
});
app.post('/api/worksheet', auth, (req, res) => {
  const { group, header, sessions } = req.body || {};
  const g = groupById(group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  let w = wsFind(g.id);
  if (!w) { w = { id: crypto.randomUUID(), group: g.id, type: 'interactive' }; db.worksheets.push(w); }
  w.header = header || {}; w.sessions = Array.isArray(sessions) ? sessions : []; w.updatedBy = req.user.id; w.date = Date.now();
  save();
  res.json({ ok: true });
});
// --- Interactive Worksheet → Word (.docx) ---
// ---- helpers de TABLEAUX (pour reproduire la mise en page des Word) --------
const TBL_BD = { style: BorderStyle.SINGLE, size: 4, color: 'D9CABE' };
const TBL_CELLBORDERS = { top: TBL_BD, bottom: TBL_BD, left: TBL_BD, right: TBL_BD };
const HEADBG = 'F3E7E0', LBLBG = 'F7EEE9', ACCENTC = 'BE6E54', DARKC = 'A8593C', INKC = '2A241D', SOFTC = '6F6253';
// cellule docx
function dxCell(text, o) {
  o = o || {};
  const children = String(text == null ? '' : text).split('\n').map(ln => new Paragraph({ alignment: o.align || AlignmentType.LEFT, children: [new TextRun({ text: ln, bold: !!o.bold, italics: !!o.italics, color: o.color || INKC, size: o.size || 19 })] }));
  // ⚠️ marges surchargeables : le PDF utilise 7 pt horizontaux et 11 pt verticaux (pdfCell),
  // les 90/36 twips par défaut valent 4,5 et 3,6 pt — le texte ne démarre pas au même endroit
  // et les lignes sont plus plates que dans le PDF.
  return new TableCell({ width: o.width, columnSpan: o.span, verticalMerge: o.vMerge, borders: TBL_CELLBORDERS, verticalAlign: o.valign || V_CENTER, shading: o.fill ? { type: SH_CLEAR, color: 'auto', fill: o.fill } : undefined, margins: o.margins || { top: 36, bottom: 36, left: 90, right: 90 }, children });
}
function dxPara(text, o) {
  o = o || {};
  const runs = String(text == null ? '' : text).split('\n').map((ln, i) => new TextRun({ text: ln, break: i > 0 ? 1 : undefined, bold: !!o.bold, italics: !!o.italics, color: o.color || INKC, size: o.size || 20 }));
  return new Paragraph({ alignment: o.align || AlignmentType.LEFT, spacing: { before: o.before || 0, after: o.after == null ? 80 : o.after }, children: runs });
}
// dxTable(rows) = table 100% (grille égalisée par Word). dxTable(rows, cols) = LAYOUT FIXE
// avec grille de colonnes proportionnelle (twips) → Word respecte enfin les largeurs (sinon il égalise tout).
const dxTable = (rows, cols) => new Table(cols
  ? { rows, layout: TableLayoutType.FIXED, columnWidths: cols, width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA } }
  : { width: { size: 100, type: WidthType.PERCENTAGE }, rows });
const dxSpacer = () => new Paragraph({ text: '', spacing: { after: 120 } });
// ⚠️ dxSpacer occupe une LIGNE ENTIÈRE (≈13 pt) en plus de son espacement : entre deux tableaux
// il creuse ~19 pt là où le PDF laisse 4 à 5 pt. dxGap ne coûte que 1 pt de hauteur de ligne.
const dxGap = (after) => new Paragraph({ children: [new TextRun({ text: '', size: 2 })], spacing: { after: after == null ? 80 : after } });
// grille de colonnes en twips à partir de proportions (la largeur utile d'une page est 9026 tw)
// Dimensions réelles d'un PNG (bloc IHDR) : sans elles on ne peut pas préserver le rapport
// d'aspect d'une signature, et l'image sort écrasée ou étirée dans le Word.
function pngDims(buf) {
  try { if (buf && buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; } catch (e) {}
  return null;
}
// Cadre en POINTS (comme le PDF) → taille en PIXELS pour la bibliothèque docx, qui compte en
// 96 dpi. Sans la conversion, une signature calée sur 150 pt sort 25 % trop petite dans le Word.
function sigBox(sig, wPt, hPt) {
  const K = 96 / 72;
  const d = sig && pngDims(sig.buffer);
  let w = wPt, h = hPt;
  if (d && d.w && d.h) { const r = Math.min(wPt / d.w, hPt / d.h); w = d.w * r; h = d.h * r; }
  return { width: Math.max(1, Math.round(w * K)), height: Math.max(1, Math.round(h * K)) };
}
const dxCols = (parts) => { const t = parts.reduce((a, b) => a + b, 0); const c = parts.map(p => Math.round(9026 * p / t)); c[c.length - 1] = 9026 - c.slice(0, -1).reduce((a, b) => a + b, 0); return c; };
const dxRowMin = (children, twips) => new TableRow({ children, height: twips ? { value: twips, rule: HeightRule.ATLEAST } : undefined });
// cellule pdf (fond + bordure + texte ; valign 'top'|'center')
function pdfCell(doc, x, y, w, hh, text, o) {
  o = o || {};
  if (o.fill) doc.rect(x, y, w, hh).fillColor(o.fill).fill();
  doc.rect(x, y, w, hh).lineWidth(0.6).strokeColor('#d9cabe').stroke();
  if (text != null && text !== '') {
    doc.fillColor(o.color || '#2a241d').font(o.bold ? 'Helvetica-Bold' : (o.italics ? 'Helvetica-Oblique' : 'Helvetica')).fontSize(o.size || 9.5);
    const padX = o.padX != null ? o.padX : 7, availW = w - padX * 2;
    const th = doc.heightOfString(String(text), { width: availW, align: o.align || 'left' });
    const ty = o.valign === 'top' ? y + 5 : y + Math.max((hh - th) / 2, 3);
    doc.text(String(text), x + padX, ty, { width: availW, align: o.align || 'left' });
  }
}
// rend une liste de lignes { cells:[{text,w,...}], minH } avec sauts de page
function pdfRows(doc, rows, left) {
  rows.forEach(row => {
    let hh = 16;
    row.cells.forEach(c => { doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(c.size || 9.5); hh = Math.max(hh, doc.heightOfString(String(c.text == null ? '' : c.text), { width: c.w - 14 }) + 11); });
    if (row.minH) hh = Math.max(hh, row.minH);
    if (doc.y + hh > doc.page.height - doc.page.margins.bottom) doc.addPage();
    let x = left; const y = doc.y;
    row.cells.forEach(c => { pdfCell(doc, x, y, c.w, hh, c.text, c); x += c.w; });
    doc.y = y + hh;
  });
}
// besoins du Level Test : tableau 3 colonnes avec la catégorie fusionnée à gauche (fidèle au Word)
function pdfBesoins(doc, groups, left, catW, HB, LB) {
  const pageH = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
  groups.forEach(g => {
    const H = g.rows.map(r => {
      let h = 18; doc.font('Helvetica').fontSize(9);
      if (r.label) h = Math.max(h, doc.heightOfString(String(r.label), { width: r.lw - 14 }) + 11);
      h = Math.max(h, doc.heightOfString(String(r.ans || ''), { width: (r.label ? r.aw : r.lw + r.aw) - 14 }) + 11);
      return h;
    });
    // la cellule catégorie (texte vertical) doit pouvoir afficher tout son libellé : si le cumul
    // des lignes est plus court que le texte, on rehausse les lignes pour que la cellule tienne.
    doc.font('Helvetica-Bold').fontSize(10);
    const catH = doc.heightOfString(String(g.cat), { width: catW - 14 }) + 10;
    let total = H.reduce((a, b) => a + b, 0);
    if (total < catH) { const extra = (catH - total) / H.length; for (let k = 0; k < H.length; k++) H[k] += extra; total = catH; }
    // garder la catégorie d'un seul tenant : si elle ne tient pas dans l'espace restant mais tiendrait
    // sur une page neuve, on saute la page AVANT (sinon sa cellule serait coupée en deux pages).
    if (doc.y + total > doc.page.height - doc.page.margins.bottom && total <= pageH) doc.addPage();
    let i = 0;
    while (i < g.rows.length) {
      let startY = doc.y;
      if (startY + H[i] > doc.page.height - doc.page.margins.bottom) { doc.addPage(); startY = doc.y; }
      const pbottom = doc.page.height - doc.page.margins.bottom;
      let j = i, segH = 0;
      while (j < g.rows.length && startY + segH + H[j] <= pbottom) { segH += H[j]; j++; }
      if (j === i) { segH = H[i]; j = i + 1; }
      pdfCell(doc, left, startY, catW, segH, g.cat, { fill: HB, bold: true, color: '#a8593c', size: 10 });
      let y = startY;
      for (let k = i; k < j; k++) {
        const r = g.rows[k];
        if (r.label) {
          pdfCell(doc, left + catW, y, r.lw, H[k], r.label, { fill: LB, size: 9, valign: 'top' });
          pdfCell(doc, left + catW + r.lw, y, r.aw, H[k], r.ans, { size: 9, valign: 'top' });
        } else {
          pdfCell(doc, left + catW, y, r.lw + r.aw, H[k], r.ans, { size: 9, valign: 'top' });
        }
        y += H[k];
      }
      doc.y = startY + segH;
      i = j;
    }
  });
}
function wsRows(w) {
  const h = w.header || {}, n = h.notes || {};
  const formation = [['Intitulé de la formation', h.intitule], ['Langue', h.langue], ['Société', h.societe], ["Nom de l'apprenant", h.nomApprenant], ['Nom du formateur', h.nomFormateur], ['Tél apprenant', h.telApprenant], ['Tél formateur', h.telFormateur], ['Mail apprenant', h.mailApprenant], ['Mail formateur', h.mailFormateur]];
  const notes = [['Vocabulaire', n.vocabulaire], ['Structure', n.structure], ['Communication', n.communication], ['Autre', n.autre]];
  const sessions = (w.sessions || []).map(s => [['Date et durée du cours', s.dateDuree], ['Formateur', s.formateur], ['Objectifs de la séance', s.objectifs], ['Liste des mots', s.mots], ['Structure et grammaire', s.grammaire], ['Pronunciation', s.pronunciation], ['Erreurs à éviter', s.erreurs], ['Pour la prochaine fois', s.prochaine]]);
  return { formation, notes, sessions };
}
// --- Interactive Worksheet → Word (tableaux comme l'original) ---
function buildWorksheetDocx(w, user, ver) {
  const h = w.header || {}, n = h.notes || {}, sess = wsRows(w).sessions;
  const PC = (s) => ({ size: s, type: WidthType.PERCENTAGE });
  // marges internes calées sur pdfCell (7 pt horizontaux, 11 pt verticaux)
  const M = { top: 110, bottom: 110, left: 140, right: 140 };
  const kids = [];
  // bandeau titre — grille fixe pleine largeur, sinon Word recalcule tout seul
  kids.push(dxTable([
    new TableRow({ children: [dxCell('INTERACTIVE WORKSHEET', { align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 30, fill: HEADBG, margins: M })] }),
    new TableRow({ children: [dxCell('Intitulé de la formation : ' + (h.intitule || ''), { bold: true, size: 20, margins: M })] }),
    new TableRow({ children: [dxCell("Interactive Worksheet à partager à l'apprenant après chaque cours.", { italics: true, color: SOFTC, align: AlignmentType.CENTER, size: 17, margins: M })] })
  ], [9026]));
  kids.push(dxGap());
  // en-tête infos (label/valeur sur 2 colonnes) + notes — proportions du PDF : 20/30/20/30
  const lc = (t) => dxCell(t, { width: PC(20), fill: LBLBG, bold: true, size: 18, margins: M }), vc = (t, span) => dxCell(t || '', { width: span ? undefined : PC(30), span, size: 18, margins: M });
  const inforows = [
    new TableRow({ children: [lc("Nom de l'apprenant"), vc(h.nomApprenant), lc('Langue'), vc(h.langue)] }),
    new TableRow({ children: [lc('Société'), vc(h.societe), lc('Nom du formateur'), vc(h.nomFormateur)] }),
    new TableRow({ children: [lc('Tél apprenant'), vc(h.telApprenant), lc('Tél formateur'), vc(h.telFormateur)] }),
    new TableRow({ children: [lc('Mail apprenant'), vc(h.mailApprenant), lc('Mail formateur'), vc(h.mailFormateur)] })
  ];
  if (h.certification) inforows.push(new TableRow({ children: [lc('Certification'), dxCell(h.certification, { span: 3, size: 18, margins: M })] }));
  inforows.push(new TableRow({ children: [dxCell('Objectifs et organisation de la formation — notes du formateur', { span: 4, fill: HEADBG, bold: true, color: DARKC, size: 20, margins: M })] }));
  [['Vocabulaire', n.vocabulaire], ['Structure', n.structure], ['Communication', n.communication], ['Autre', n.autre]].forEach(p =>
    inforows.push(dxRowMin([dxCell(p[0], { width: PC(20), fill: LBLBG, bold: true, size: 18, margins: M }), dxCell(p[1] || '', { span: 3, valign: VerticalAlign ? VerticalAlign.TOP : 'top', size: 18, margins: M })], 520)));
  kids.push(dxTable(inforows, dxCols([20, 30, 20, 30])));
  kids.push(dxGap());
  // séances (un tableau par séance) — proportions du PDF : 34/66
  if (!sess.length) kids.push(new Paragraph({ children: [new TextRun({ text: 'Aucune séance renseignée.', italics: true, color: SOFTC, size: 20 })] }));
  sess.forEach((s, i) => {
    const rows = [new TableRow({ children: [dxCell('Séance ' + (i + 1), { span: 2, fill: HEADBG, bold: true, color: ACCENTC, size: 22, margins: M })] })];
    s.forEach(p => rows.push(dxRowMin([dxCell(p[0], { width: PC(34), fill: LBLBG, bold: true, size: 18, margins: M }), dxCell(p[1] || '', { width: PC(66), valign: VerticalAlign ? VerticalAlign.TOP : 'top', size: 18, margins: M })], 480)));
    kids.push(dxTable(rows, dxCols([34, 66]))); kids.push(dxGap());
  });
  const hf = docxHeaderFooter(user, ver);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
// --- Interactive Worksheet → PDF (tableaux) ---
function buildWorksheetPdf(w, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const left = doc.page.margins.left, totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const h = w.header || {}, n = h.notes || {}, sess = wsRows(w).sessions;
    const HB = '#f3e7e0', LB = '#f7eee9';
    // bandeau titre
    pdfRows(doc, [
      { cells: [{ text: 'INTERACTIVE WORKSHEET', w: totalW, align: 'center', bold: true, color: '#be6e54', size: 15, fill: HB }], minH: 26 },
      { cells: [{ text: 'Intitulé de la formation : ' + (h.intitule || ''), w: totalW, bold: true, size: 10 }] },
      { cells: [{ text: "Interactive Worksheet à partager à l'apprenant après chaque cours.", w: totalW, italics: true, color: '#6f6253', align: 'center', size: 8.5 }] }
    ], left);
    doc.moveDown(0.5);
    // en-tête infos (4 colonnes)
    const lw = totalW * 0.2, vw = totalW * 0.3;
    const inforows = [
      ["Nom de l'apprenant", h.nomApprenant, 'Langue', h.langue],
      ['Société', h.societe, 'Nom du formateur', h.nomFormateur],
      ['Tél apprenant', h.telApprenant, 'Tél formateur', h.telFormateur],
      ['Mail apprenant', h.mailApprenant, 'Mail formateur', h.mailFormateur]
    ].map(r => ({ cells: [{ text: r[0], w: lw, fill: LB, bold: true, size: 9 }, { text: r[1] || '', w: vw, size: 9 }, { text: r[2], w: lw, fill: LB, bold: true, size: 9 }, { text: r[3] || '', w: vw, size: 9 }] }));
    if (h.certification) inforows.push({ cells: [{ text: 'Certification', w: lw, fill: LB, bold: true, size: 9 }, { text: h.certification, w: totalW - lw, size: 9 }] });
    inforows.push({ cells: [{ text: 'Objectifs et organisation de la formation — notes du formateur', w: totalW, fill: HB, bold: true, color: '#a8593c', size: 10 }], minH: 22 });
    [['Vocabulaire', n.vocabulaire], ['Structure', n.structure], ['Communication', n.communication], ['Autre', n.autre]].forEach(p =>
      inforows.push({ cells: [{ text: p[0], w: lw, fill: LB, bold: true, size: 9 }, { text: p[1] || '', w: totalW - lw, size: 9, valign: 'top' }], minH: 26 }));
    pdfRows(doc, inforows, left);
    doc.moveDown(0.5);
    // séances
    if (!sess.length) doc.fillColor('#6f6253').font('Helvetica-Oblique').fontSize(10).text('Aucune séance renseignée.', left, doc.y);
    const lw2 = totalW * 0.34, vw2 = totalW * 0.66;
    sess.forEach((s, i) => {
      const rows = [{ cells: [{ text: 'Séance ' + (i + 1), w: totalW, fill: HB, bold: true, color: '#be6e54', size: 11 }], minH: 22 }];
      s.forEach(p => rows.push({ cells: [{ text: p[0], w: lw2, fill: LB, bold: true, size: 9 }, { text: p[1] || '', w: vw2, size: 9, valign: 'top' }], minH: 24 }));
      pdfRows(doc, rows, left); doc.moveDown(0.4);
    });
    pdfHeaderFooter(doc, user, ver);
    doc.end();
  });
}

// historique de génération (réouvrable) — normalisé pour TOUS les types de documents, 40 derniers par dossier.
// Tout générateur de document doit l'appeler pour apparaître dans l'onglet « Historique ».
function recordDocgen(g, user, info) {
  if (!g) return;
  db.docgens.push({ id: crypto.randomUUID(), group: g.id, kind: info.kind, tpl: info.tpl || info.kind, title: info.title, format: info.format || 'pdf', date: Date.now(), byName: senderDisplay(user), apprenant: info.apprenant || 'apprenant', sessionCount: info.sessionCount, snapshot: info.snapshot || null });
  const gh = db.docgens.filter(x => x.group === g.id).sort((a, b) => a.date - b.date);
  while (gh.length > 40) { const old = gh.shift(); db.docgens = db.docgens.filter(x => x.id !== old.id); }
  save();
}

app.post('/api/worksheet/generate', auth, async (req, res) => {
  const { group, format } = req.body || {};
  const fmt = (format === 'word' || format === 'docx') ? 'word' : 'pdf';
  const g = groupById(group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const w = wsFind(g.id) || wsBlank(g, req.user);
  const ver = bumpVersion(g, 'interactive');
  let buf, ext, type;
  try {
    if (fmt === 'word') { buf = await buildWorksheetDocx(w, req.user, ver); ext = 'docx'; type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildWorksheetPdf(w, req.user, ver); ext = 'pdf'; type = 'application/pdf'; }
  } catch (e) { console.error('Génération worksheet:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'interactive', title: 'Interactive Worksheet', format: fmt, apprenant: (w.header && w.header.nomApprenant) || 'apprenant', sessionCount: (w.sessions || []).length, snapshot: { header: w.header || {}, sessions: w.sessions || [] } });
  // on renvoie directement le fichier en téléchargement (aucun dépôt dans le dossier)
  const name = `1 - Interactive Worksheet - ${safeFile((w.header && w.header.nomApprenant) || 'apprenant')} - ${nameDate()}.${ext}`;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

app.get('/api/worksheet/history', auth, (req, res) => {
  const g = groupById(req.query.group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const history = db.docgens.filter(x => x.group === g.id).sort((a, b) => b.date - a.date)
    .map(x => ({ id: x.id, kind: x.kind || 'interactive', tpl: x.tpl || x.kind || 'interactive', title: x.title || 'Interactive Worksheet', format: x.format, date: x.date, byName: x.byName, apprenant: x.apprenant, sessionCount: x.sessionCount, snapshot: x.snapshot }));
  res.json({ history });
});

// ---- tests (mi-parcours / fin) : en-tête + résultat + appréciation ---------
const TEST_TEMPLATES = {
  test_mid: { title: 'Test de mi-parcours de formation' },
  test_end: { title: 'Test de fin de formation' }
};
// ---- contenu libre enrichi (gras/italique/souligné/couleur/listes/tableaux) ----
function rtHexClean(c) {
  if (!c) return undefined; c = String(c).trim(); if (c[0] === '#') c = c.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(c)) c = c.split('').map(x => x + x).join('');
  if (/^[0-9a-fA-F]{6}$/.test(c)) return c.toUpperCase();
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (m) return [m[1], m[2], m[3]].map(n => ('0' + (+n).toString(16)).slice(-2)).join('').toUpperCase();
  return undefined;
}
function rtDxRuns(runs) {
  const out = [];
  (runs || []).forEach(r => { String(r.text == null ? '' : r.text).split('\n').forEach((ln, i) => { if (i > 0) out.push(new TextRun({ break: 1 })); if (ln !== '') out.push(new TextRun({ text: ln, bold: !!r.bold, italics: !!r.italic, underline: r.underline ? {} : undefined, color: rtHexClean(r.color) || '000000', size: 20 })); }); });
  return out.length ? out : [new TextRun({ text: '' })];
}
function richToDocx(blocks) {
  const kids = []; if (!Array.isArray(blocks) || !blocks.length) return kids;
  kids.push(dxSpacer());
  blocks.forEach(b => {
    if (b.type === 'p') kids.push(new Paragraph({ children: rtDxRuns(b.runs), spacing: { after: 60 } }));
    else if (b.type === 'ul') (b.items || []).forEach(it => kids.push(new Paragraph({ children: rtDxRuns(it), bullet: { level: 0 }, spacing: { after: 40 } })));
    else if (b.type === 'ol') (b.items || []).forEach((it, i) => kids.push(new Paragraph({ children: [new TextRun({ text: (i + 1) + '. ', size: 20 })].concat(rtDxRuns(it)), spacing: { after: 40 } })));
    // ⚠️ colonnes ÉGALES et fixes, comme richToPdf (cw = totalW / n) : sans grille, Word
    // recalcule d'après le contenu et une colonne courte devient minuscule.
    else if (b.type === 'table') { const nb = Math.max(1, ((b.rows || [])[0] || []).length); const cols = dxCols(new Array(nb).fill(1)); const rows = (b.rows || []).map(cells => new TableRow({ children: (cells || []).map(cr => new TableCell({ borders: TBL_CELLBORDERS, margins: { top: 30, bottom: 30, left: 70, right: 70 }, children: [new Paragraph({ children: rtDxRuns(cr) })] })) })); if (rows.length) { kids.push(dxTable(rows, cols)); kids.push(dxSpacer()); } }
    else if (b.type === 'qcm') {
      kids.push(new Paragraph({ children: [new TextRun({ text: b.question || '', bold: true, color: '000000', size: 21 })], spacing: { before: 80, after: 50 } }));
      (b.options || []).forEach((opt, i) => {
        const sel = b.answer === i;
        kids.push(new Paragraph({
          shading: sel ? { type: SH_CLEAR, color: 'auto', fill: 'F1E2D9' } : undefined,
          children: [new TextRun({ text: (sel ? '(X)  ' : '(  )  '), bold: true, color: sel ? ACCENTC : '000000', size: 20 }), new TextRun({ text: String(opt || ''), bold: sel, color: sel ? ACCENTC : '000000', size: 20 })],
          spacing: { after: 30 }
        }));
      });
      kids.push(dxSpacer());
    }
  });
  return kids;
}
const rtPdfFont = (r) => (r.bold && r.italic) ? 'Helvetica-BoldOblique' : r.bold ? 'Helvetica-Bold' : r.italic ? 'Helvetica-Oblique' : 'Helvetica';
function richToPdf(doc, blocks, left, totalW) {
  if (!Array.isArray(blocks) || !blocks.length) return;
  doc.moveDown(0.5);
  function drawRuns(runs, x, w, prefix) {
    if (prefix) doc.font('Helvetica').fontSize(10).fillColor('#000000').text(prefix, x, doc.y, { continued: true, width: w });
    const rs = runs || [];
    if (!rs.length) { if (prefix) doc.text(' '); else doc.moveDown(0.2); return; }
    rs.forEach((r, i) => {
      doc.font(rtPdfFont(r)).fontSize(10).fillColor(r.color ? ('#' + (rtHexClean(r.color) || '000000')) : '#000000');
      const opts = { continued: i < rs.length - 1, width: w, underline: !!r.underline };
      if (i === 0 && !prefix) doc.text(String(r.text), x, doc.y, opts); else doc.text(String(r.text), opts);
    });
  }
  blocks.forEach(b => {
    if (b.type === 'p') { drawRuns(b.runs, left, totalW); doc.moveDown(0.3); }
    else if (b.type === 'ul' || b.type === 'ol') { (b.items || []).forEach((it, i) => { drawRuns(it, left + 14, totalW - 14, b.type === 'ol' ? (i + 1) + '.  ' : '•  '); doc.moveDown(0.12); }); doc.moveDown(0.2); }
    else if (b.type === 'table') { const rows = (b.rows || []).map(cells => { const n = (cells || []).length || 1, cw = totalW / n; return { cells: (cells || []).map(cr => ({ text: (cr || []).map(r => r.text).join(''), w: cw, size: 9.5, valign: 'top' })) }; }); if (rows.length) { pdfRows(doc, rows, left); doc.moveDown(0.3); } }
    else if (b.type === 'qcm') {
      const bottom = doc.page.height - doc.page.margins.bottom;
      if (doc.y + 42 > bottom) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000000').text(b.question || '', left, doc.y, { width: totalW }); doc.moveDown(0.15);
      (b.options || []).forEach((opt, i) => {
        const sel = b.answer === i, txt = (sel ? '(X)  ' : '(  )  ') + String(opt || '');
        doc.font(sel ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
        const th = doc.heightOfString(txt, { width: totalW - 16 });
        if (doc.y + th + 5 > bottom) doc.addPage();
        const y0 = doc.y;
        if (sel) { doc.save(); doc.rect(left, y0 - 1, totalW, th + 4).fillColor('#f4e6df').fill(); doc.restore(); }
        doc.fillColor(sel ? '#a85c44' : '#000000').text(txt, left + 8, y0 + 1.5, { width: totalW - 16 });
        doc.y = y0 + th + 5;
      });
      doc.moveDown(0.3);
    }
  });
}
// --- Test mi-parcours / fin → Word (tableau comme l'original) ---
function buildTestDocx(title, header, extra, user, ver) {
  const H = header || {}, X = extra || {}, PC = (s) => ({ size: s, type: WidthType.PERCENTAGE });
  const M = { top: 110, bottom: 110, left: 140, right: 140 };   // marges internes du PDF
  const cellH = (l, v) => dxCell(l + ' : ' + (v || ''), { width: PC(50), size: 19, margins: M });
  const rows = [
    dxRowMin([dxCell(title.toUpperCase(), { span: 2, align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 30, fill: HEADBG, margins: M })], 560),
    new TableRow({ children: [cellH("Nom de l'apprenant", H.nomApprenant), cellH('Société', H.societe)] }),
    new TableRow({ children: [cellH('Langue', H.langue), cellH('Intitulé de la formation', H.intitule)] }),
    new TableRow({ children: [cellH('Formateur', H.formateur), cellH('Date', H.date)] })
  ];
  rows.push(dxRowMin([dxCell('Résultat', { span: 2, fill: HEADBG, bold: true, color: DARKC, size: 20, margins: M })], 480));
  rows.push(dxRowMin([dxCell(X.resultat || '', { span: 2, valign: VerticalAlign ? VerticalAlign.TOP : 'top', size: 19, margins: M })], 1400));
  rows.push(dxRowMin([dxCell('Appréciation formateur', { span: 2, fill: HEADBG, bold: true, color: DARKC, size: 20, margins: M })], 480));
  rows.push(dxRowMin([dxCell(X.appreciation || '', { span: 2, valign: VerticalAlign ? VerticalAlign.TOP : 'top', size: 19, margins: M })], 2000));
  const hf = docxHeaderFooter(user, ver);
  // deux colonnes strictement égales, comme le PDF (half = totalW / 2)
  const children = [dxTable(rows, dxCols([1, 1]))].concat(richToDocx(X.libre));
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children }] }));
}
// --- Test mi-parcours / fin → PDF (tableau) ---
function buildTestPdf(title, header, extra, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const left = doc.page.margins.left, totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right, half = totalW / 2;
    const H = header || {}, X = extra || {}, HB = '#f3e7e0';
    const rows = [
      { cells: [{ text: title.toUpperCase(), w: totalW, align: 'center', bold: true, color: '#be6e54', size: 15, fill: HB }], minH: 28 },
      { cells: [{ text: "Nom de l'apprenant : " + (H.nomApprenant || ''), w: half, size: 10 }, { text: 'Société : ' + (H.societe || ''), w: half, size: 10 }] },
      { cells: [{ text: 'Langue : ' + (H.langue || ''), w: half, size: 10 }, { text: 'Intitulé de la formation : ' + (H.intitule || ''), w: half, size: 10 }] },
      { cells: [{ text: 'Formateur : ' + (H.formateur || ''), w: half, size: 10 }, { text: 'Date : ' + (H.date || ''), w: half, size: 10 }] }
    ];
    rows.push({ cells: [{ text: 'Résultat', w: totalW, fill: HB, bold: true, color: '#a8593c', size: 11 }], minH: 20 });
    rows.push({ cells: [{ text: X.resultat || '', w: totalW, size: 10, valign: 'top' }], minH: 60 });
    rows.push({ cells: [{ text: 'Appréciation formateur', w: totalW, fill: HB, bold: true, color: '#a8593c', size: 11 }], minH: 20 });
    rows.push({ cells: [{ text: X.appreciation || '', w: totalW, size: 10, valign: 'top' }], minH: 90 });
    pdfRows(doc, rows, left);
    richToPdf(doc, X.libre, left, totalW);
    pdfHeaderFooter(doc, user, ver); doc.end();
  });
}
app.post('/api/testdoc/generate', auth, async (req, res) => {
  const { group, type, header, extra, format } = req.body || {};
  const tpl = TEST_TEMPLATES[type];
  const g = groupById(group);
  if (!tpl) return res.status(400).json({ error: 'Type de document inconnu.' });
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const ver = bumpVersion(g, type);
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildTestDocx(tpl.title, header, extra, req.user, ver); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildTestPdf(tpl.title, header, extra, req.user, ver); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('testdoc:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'test', tpl: type, title: tpl.title, format: ext === 'docx' ? 'word' : 'pdf', apprenant: (header && header.nomApprenant) || 'apprenant' });
  const name = (type === 'test_mid' ? '5' : '6') + ' - ' + safeFile(tpl.title) + ' - ' + safeFile((header && header.nomApprenant) || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

// ---- Attestation de fin de stage (formateur + admin) -----------------------
const ATT_NIVEAUX = ['Acquis', "En cours d'acquisition", 'Non acquis'];
// Signature du président et tampon de l'association, incrustés automatiquement sur les documents
// qui les demandent. Fichiers cherchés dans data/ D'ABORD (permet de remplacer l'image sur un
// serveur sans toucher au code), puis dans assets/ où ils sont livrés avec le site — ainsi rien
// n'est à faire au déploiement. Ils sont FACULTATIFS : absents, rien n'est dessiné et aucune
// génération n'échoue.
// DEUX variantes : la signature SEULE (feuilles administratives) et la signature SUR LE TAMPON
// (attestation de fin de stage). Le tampon retombe sur la signature seule s'il n'est pas fourni.
const SIGN_ANTONIN = ['signature-antonin.png'];
const SIGN_ANTONIN_TAMPON = ['signature-antonin-tampon.png', 'signature-antonin.png'];
const RATIO_SIGN = 147 / 203;          // proportions de l'image de signature
function imgSiPresent(noms) {
  for (const n of [].concat(noms)) {
    for (const dossier of [DATA_DIR, path.join(__dirname, 'assets')]) {
      const f = path.join(dossier, n);
      try { if (fs.existsSync(f)) return f; } catch (e) { }
    }
  }
  return null;
}
// Word : paragraphe d'image (liste vide si le fichier manque — aucune génération n'échoue)
function dxSignatureAntonin(largeur, variante) {
  const p = imgSiPresent(variante || SIGN_ANTONIN);
  if (!p) return [];
  try {
    const buf = fs.readFileSync(p);
    // ⚠️ Le rapport se lit DANS le fichier, il n'est plus codé en dur. L'ancien 0,45 du tampon
    // était faux (l'image fait 453 × 263, soit 0,58) et Word, qui impose largeur ET hauteur,
    // l'écrasait de 22 % — le PDF ne le montrait pas, doc.image conservant les proportions.
    // Repli sur les constantes si l'en-tête PNG est illisible.
    const dims = pngDims(buf);
    const ratio = (dims && dims.w && dims.h) ? (dims.h / dims.w) : (variante === SIGN_ANTONIN_TAMPON ? 0.58 : RATIO_SIGN);
    const w = largeur || 120, h = Math.round(w * ratio);
    return [new Paragraph({ children: [new ImageRun({ type: 'png', data: buf, transformation: { width: w, height: h } })] })];
  } catch (e) { return []; }
}
// Word : la MÊME image dans une cellule de tableau (case « signature administratif »)
function dxSignatureCell(largeur, hMax) {
  const p = imgSiPresent(SIGN_ANTONIN);
  if (!p) return [];
  let w = largeur || 90;
  if (hMax && w * RATIO_SIGN > hMax) w = hMax / RATIO_SIGN;   // bornée en hauteur : jamais hors de sa case
  try { return [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: fs.readFileSync(p), transformation: { width: Math.round(w), height: Math.round(w * RATIO_SIGN) } })] })]; } catch (e) { return []; }
}
// Le bloc de signature est dessiné à des coordonnées EXPLICITES : pdfkit ne pagine pas tout seul
// dans ce cas. On force donc une page si la place manque, sinon l'image déborderait sur le pied
// de page (ou hors de la feuille) quand le document est long.
function pdfPlacePourSignature(doc, hauteur) {
  if (doc.y + hauteur > doc.page.height - doc.page.margins.bottom) { doc.addPage(); return true; }
  return false;
}
// PDF : dessine la signature (seule ou sur le tampon) et renvoie la hauteur utilisée.
// `hMax` borne la HAUTEUR : sans elle, une signature large débordait de sa case et mordait sur
// la ligne suivante (cas signalé sur le récapitulatif « Suivi assiduité »).
function pdfSignatureAntonin(doc, x, y, largeur, variante, hMax) {
  const p = imgSiPresent(variante || SIGN_ANTONIN);
  if (!p) return 0;
  const ratio = (variante === SIGN_ANTONIN_TAMPON ? 0.45 : RATIO_SIGN);
  let w = largeur || 120;
  if (hMax && w * ratio > hMax) w = hMax / ratio;      // on rétrécit à proportions constantes
  const h = w * ratio;
  try { doc.image(p, x, y, { fit: [w, h] }); return h + 4; } catch (e) { return 0; }
}
function buildAttestationDocx(d, user, ver) {
  const PC = (s) => ({ size: s, type: WidthType.PERCENTAGE });
  const M = { top: 110, bottom: 110, left: 140, right: 140 };   // marges internes du PDF
  const lc = (t) => dxCell(t, { width: PC(34), fill: LBLBG, bold: true, size: 19, margins: M }), vc = (t) => dxCell(t || '', { width: PC(66), size: 19, margins: M });
  const kids = [];
  kids.push(dxTable([new TableRow({ children: [dxCell('ATTESTATION DE FIN DE STAGE', { align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 30, fill: HEADBG, margins: M })] })], [9026]));
  kids.push(dxSpacer()); kids.push(dxSpacer());   // le titre respire
  kids.push(dxPara("Je soussigné, " + (d.representant || 'Antonin HATTABE') + ", représentant de l'organisme de formation LANGUAGES & SUCCESS - L&S, numéro de déclaration d'activité 93 060 886 106, certificat QUALIOPI " + QUALIOPI_CERT + ", atteste que :", { after: 140 }));
  kids.push(dxTable([
    new TableRow({ children: [lc("L'apprenant"), vc(d.apprenant)] }),
    new TableRow({ children: [lc('De la société'), vc(d.societe)] }),
    new TableRow({ children: [lc('A suivi la formation'), vc(d.intitule)] }),
    new TableRow({ children: [lc('Période'), vc('Du ' + (d.dateDebut || '…') + ' au ' + (d.dateFin || '…'))] }),
    new TableRow({ children: [lc('Durée totale'), vc(d.dureeTotale)] }),
    new TableRow({ children: [lc('Dont'), vc(d.dureeDetail)] }),
    new TableRow({ children: [lc('À'), vc(d.lieu || 'Distanciel')] }),
    new TableRow({ children: [lc('Avec'), vc(d.formateur)] })
  ], dxCols([34, 66])));   // proportions du PDF : libellé à x57, valeur à x225
  kids.push(dxSpacer());
  kids.push(dxSpacer()); kids.push(dxSpacer());
  kids.push(dxPara('Objectifs de la formation', { bold: true, color: DARKC, size: 24, after: 140 }));
  (d.objectifs || '').split('\n').filter(x => x.trim()).forEach(o => kids.push(dxPara('• ' + o.trim(), { after: 40 })));
  kids.push(dxSpacer()); kids.push(dxSpacer());
  kids.push(dxPara('Nature de la formation :', { bold: true }));
  kids.push(dxPara("Action d'acquisition, d'entretien ou de perfectionnement de la langue.", { after: 140 }));
  kids.push(dxSpacer()); kids.push(dxSpacer());
  kids.push(dxPara("Résultat de l'évaluation des acquis :", { bold: true, color: DARKC, after: 140 }));
  const compRows = [new TableRow({ tableHeader: true, children: [dxCell('Compétences', { width: PC(40), fill: HEADBG, bold: true, size: 19, margins: M })].concat(ATT_NIVEAUX.map(n => dxCell(n, { width: PC(20), fill: HEADBG, bold: true, align: AlignmentType.CENTER, size: 16, margins: M }))) })];
  (d.competences || []).filter(c => c && c.label && c.label.trim()).forEach(c => {
    compRows.push(dxRowMin([dxCell(c.label, { width: PC(40), size: 19, margins: M })].concat(ATT_NIVEAUX.map(n => { const sel = c.niveau === n; return dxCell(sel ? '✗' : '', { width: PC(20), align: AlignmentType.CENTER, bold: true, fill: sel ? ACCENTC : undefined, color: sel ? 'FFFFFF' : INKC, size: 22, margins: M }); })), 480));
  });
  // proportions du PDF : « Compétences » de x50 à x284 (≈47 %), puis 3 colonnes égales
  if (compRows.length > 1) { kids.push(dxTable(compRows, dxCols([47, 17.7, 17.7, 17.6]))); kids.push(dxGap()); }
  // ligne dégagée au-dessus ET en dessous
  kids.push(dxSpacer()); kids.push(dxSpacer());
  kids.push(new Paragraph({ spacing: { after: 240 }, children: [
    new TextRun({ text: "Niveau atteint à l'issue de la formation : ", bold: true, color: INKC, size: 20 }),
    new TextRun({ text: d.niveauAtteint || '', bold: true, color: INKC, size: 20 })
  ] }));
  // la certification (TOEIC, Bright Language…) est mise en gras
  kids.push(new Paragraph({ spacing: { after: 140 }, children: [
    new TextRun({ text: 'Certification : ', color: INKC, size: 20 }),
    new TextRun({ text: d.certification || '', bold: true, color: INKC, size: 20 }),
    new TextRun({ text: '     Date : ' + (d.dateEval || '') + '     Résultat : ' + (d.resultat || ''), color: INKC, size: 20 })
  ] }));
  kids.push(dxSpacer()); kids.push(dxSpacer());
  kids.push(dxPara('Commentaires du formateur :', { bold: true, after: 60 }));
  kids.push(dxPara(d.commentaires || '', { after: 160 }));
  kids.push(dxPara('Fait à ' + (d.lieuFait || 'Nice') + ', le ' + (d.dateFait || ''), { before: 160, after: 320 }));
  // bloc de signature sur une ligne horizontale complète : les trois signataires ne se touchent pas
  // ⚠️ Chaque colonne porte désormais NOM puis qualité puis signature. Le nom au-dessus de
  // « Le Formateur » et de « L'apprenant » est une demande de l'utilisateur (05/08/2026) : sans lui,
  // le document ne disait pas QUI avait signé.
  const sigCol = (lignes, extra) => new TableCell({ width: { size: 3009, type: WidthType.DXA }, borders: NO_BORDERS(), margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: lignes.filter(l => l != null && l !== '').map(l => dxPara(l, { after: 20 })).concat(extra || []) });
  // ⚠️ sigBox (et non un ratio en dur) : une signature manuscrite n'a ni le rapport de la signature
  // d'Antonin ni celui du tampon, elle sortirait écrasée.
  const sigParaAtt = (sig) => sig ? [new Paragraph({ children: [new ImageRun({ type: sig.type, data: sig.buffer, transformation: sigBox(sig, 110, 52) })] })] : [];
  const sigFatt = sigImg(d.formateurSig), sigAatt = sigImg(d.apprenantSig);
  // trois colonnes égales et fixes, comme le PDF (signataires à x50, x221, x392)
  kids.push(new Table({ layout: TableLayoutType.FIXED, columnWidths: [3009, 3009, 3008], width: { size: 9026, type: WidthType.DXA }, borders: NO_BORDERS(), rows: [new TableRow({ children: [
    sigCol([(d.representant || 'Antonin HATTABE'), 'Président'], dxSignatureAntonin(110, SIGN_ANTONIN_TAMPON)),
    sigCol([d.formateur, 'Le Formateur'], sigParaAtt(sigFatt)),
    sigCol([d.apprenant, "L'apprenant"], sigParaAtt(sigAatt))
  ] })] }));
  const hf = docxHeaderFooter(user, ver);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
function buildAttestationPdf(d, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const left = doc.page.margins.left, totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const p = (t, o) => { o = o || {}; doc.font(o.bold ? 'Helvetica-Bold' : (o.italics ? 'Helvetica-Oblique' : 'Helvetica')).fontSize(o.size || 9.5).fillColor(o.color || '#2a241d').text(String(t == null ? '' : t), left, doc.y, { width: totalW, align: o.align || 'left' }); doc.moveDown(o.after != null ? o.after : 0.4); };
    pdfRows(doc, [{ cells: [{ text: 'ATTESTATION DE FIN DE STAGE', w: totalW, align: 'center', bold: true, color: '#be6e54', size: 15, fill: '#f3e7e0' }], minH: 28 }], left);
    doc.moveDown(1.2);   // le titre respire
    p("Je soussigné, " + (d.representant || 'Antonin HATTABE') + ", représentant de l'organisme de formation LANGUAGES & SUCCESS - L&S, numéro de déclaration d'activité 93 060 886 106, certificat QUALIOPI " + QUALIOPI_CERT + ", atteste que :", { after: 0.5 });
    const lw = totalW * 0.34, vw = totalW * 0.66;
    const inf = [["L'apprenant", d.apprenant], ['De la société', d.societe], ['A suivi la formation', d.intitule], ['Période', 'Du ' + (d.dateDebut || '…') + ' au ' + (d.dateFin || '…')], ['Durée totale', d.dureeTotale], ['Dont', d.dureeDetail], ['À', d.lieu || 'Distanciel'], ['Avec', d.formateur]];
    pdfRows(doc, inf.map(r => ({ cells: [{ text: r[0], w: lw, fill: '#f7eee9', bold: true, size: 9 }, { text: r[1] || '', w: vw, size: 9 }] })), left);
    doc.moveDown(0.5);
    doc.moveDown(1.6); p('Objectifs de la formation', { bold: true, color: '#a8593c', size: 12, after: 0.55 });
    (d.objectifs || '').split('\n').filter(x => x.trim()).forEach(o => p('• ' + o.trim(), { after: 0.15 }));
    doc.moveDown(1.6); p('Nature de la formation :', { bold: true, after: 0.15 });
    p("Action d'acquisition, d'entretien ou de perfectionnement de la langue.", { after: 0.5 });
    doc.moveDown(1.6); p("Résultat de l'évaluation des acquis :", { bold: true, color: '#a8593c', size: 11, after: 0.55 });
    const comps = (d.competences || []).filter(c => c && c.label && c.label.trim());
    if (comps.length) {
      const cw = totalW * 0.4, ow = (totalW * 0.6) / 3;
      const crows = [{ cells: [{ text: 'Compétences', w: cw, fill: '#f3e7e0', bold: true, size: 9 }].concat(ATT_NIVEAUX.map(n => ({ text: n, w: ow, fill: '#f3e7e0', bold: true, align: 'center', size: 8 }))) }];
      comps.forEach(c => crows.push({ cells: [{ text: c.label, w: cw, size: 9 }].concat(ATT_NIVEAUX.map(n => { const sel = c.niveau === n; return { text: sel ? 'X' : '', w: ow, align: 'center', bold: true, fill: sel ? '#be6e54' : null, color: '#ffffff', size: 11 }; })) }));
      pdfRows(doc, crows, left); doc.moveDown(0.5);
    }
    // ligne dégagée au-dessus ET en dessous
    doc.moveDown(1.6);
    p("Niveau atteint à l'issue de la formation : " + (d.niveauAtteint || ''), { bold: true, after: 0.9 });
    // la certification (TOEIC, Bright Language…) est mise en gras
    doc.font('Helvetica').fontSize(9.5).fillColor('#2a241d').text('Certification : ', left, doc.y, { width: totalW, continued: true });
    doc.font('Helvetica-Bold').text(d.certification || '', { continued: true });
    doc.font('Helvetica').text('     Date : ' + (d.dateEval || '') + '     Résultat : ' + (d.resultat || ''), { width: totalW });
    doc.moveDown(0.5);
    doc.moveDown(1.2); p('Commentaires du formateur :', { bold: true, after: 0.2 }); p(d.commentaires || '', { after: 0.6 });
    p('Fait à ' + (d.lieuFait || 'Nice') + ', le ' + (d.dateFait || ''), { after: 1.4 });
    // bloc de signature sur une ligne horizontale complète : les trois signataires ne se touchent pas
    // ⚠️ Chaque colonne porte NOM, qualité, puis signature (demande de l'utilisateur, 05/08/2026).
    // ⚠️ 150 pt réservés et non 110 : les trois colonnes portent maintenant une image, et
    // pdfkit ne pagine pas tout seul un bloc dessiné à des coordonnées absolues.
    const sigFatt = sigImg(d.formateurSig), sigAatt = sigImg(d.apprenantSig);
    pdfPlacePourSignature(doc, 150);
    const colW = totalW / 3 - 12, y0 = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor('#2a241d');
    const xs = [left, left + totalW / 3 + 6, left + (2 * totalW) / 3 + 12];
    // ⚠️ chaque colonne repart de y0 : doc.y avance colonne par colonne, on ne peut pas
    // l'utiliser comme référence commune.
    const colAtt = (x, nom, role) => { doc.text(nom || '', x, y0, { width: colW }); doc.text(role, x, doc.y, { width: colW }); return doc.y; };
    const yRep = colAtt(xs[0], (d.representant || 'Antonin HATTABE'), 'Président');
    const hRep = pdfSignatureAntonin(doc, xs[0], yRep + 4, colW * 0.8, SIGN_ANTONIN_TAMPON, 58);
    const poseSig = (sig, x, y) => { if (!sig) return 0; try { doc.image(sig.buffer, x, y + 4, { fit: [colW * 0.8, 52] }); return 56; } catch (e) { return 0; } };
    const yFor = colAtt(xs[1], d.formateur, 'Le Formateur');
    const hFor = poseSig(sigFatt, xs[1], yFor);
    const yApp = colAtt(xs[2], d.apprenant, "L'apprenant");
    const hApp = poseSig(sigAatt, xs[2], yApp);
    doc.y = Math.max(yRep + hRep, yFor + hFor, yApp + hApp) + 12;
    pdfHeaderFooter(doc, user, ver); doc.end();
  });
}
// ⚠️ POST /api/attestation/generate (téléchargement direct, sans signature) est SUPPRIMÉE le
// 05/08/2026, à la demande de l'utilisateur : l'attestation ne s'obtient plus que signée du
// formateur ET de l'apprenant. Le circuit est plus bas : /api/attestation/send puis /:id/sign.
// Le buildAttestationDocx reste utilisé par la route Word de la pièce signée.
// Aperçu du document AVANT signature, pour que l'apprenant relise ce qu'il signe.
// ⚠️ jeton en query (userDepuisRequete) : le lien est un <a href>, qui ne peut pas porter
// d'en-tête Authorization.
app.get('/api/attestation/:id/apercu', async (req, res) => {
  const u = userDepuisRequete(req);
  if (!u) return res.status(401).json({ error: 'Non authentifié.' });
  const a = db.attestations.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Attestation introuvable.' });
  const g = groupById(a.group);
  if (!isMember(g, u)) return res.status(403).json({ error: 'Accès refusé.' });
  try {
    // verOf et non bumpVersion : relire ne doit pas faire avancer la version du document
    const buf = await buildAttestationPdf(Object.assign({}, a.fields, { formateurSig: a.formateurSig, apprenantSig: a.apprenantSig }), u, verOf(g, 'attestation'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', "inline; filename*=UTF-8''" + encodeURIComponent(safeFile('Attestation de fin de formation') + '.pdf'));
    res.send(buf);
  } catch (e) { console.error('attestation apercu:', e); res.status(500).json({ error: 'Erreur de génération.' }); }
});

// ---- Contrat de sous-traitance (admin uniquement) --------------------------
// ---- contrat de sous-traitance : mise en forme demandée par l'organisme ------
// Les trois termes contractuels sont EN GRAS partout où ils apparaissent : on découpe donc
// chaque paragraphe en segments {t, b} plutôt que de les baliser un par un à la main.
const CT_TERMES = ['LANGUAGES & SUCCESS - L&S', 'Languages and Success', 'LANGUAGES & SUCCESS', "Donneur d'ordre", 'Sous-traitant'];
function ctSeg(texte) {
  let segs = [{ t: String(texte == null ? '' : texte) }];
  for (const terme of CT_TERMES) {                       // du plus long au plus court : pas de chevauchement
    const cible = terme.toLowerCase();
    const out = [];
    for (const s of segs) {
      if (s.b) { out.push(s); continue; }
      let reste = s.t, i;
      // recherche INSENSIBLE À LA CASSE (le contrat écrit parfois « le sous-traitant » en
      // minuscules) mais la casse d'origine est conservée : on ne réécrit pas le texte du contrat.
      while ((i = reste.toLowerCase().indexOf(cible)) >= 0) {
        if (i > 0) out.push({ t: reste.slice(0, i) });
        out.push({ t: reste.slice(i, i + terme.length), b: 1 });
        reste = reste.slice(i + terme.length);
      }
      if (reste) out.push({ t: reste });
    }
    segs = out;
  }
  return segs.filter(s => s.t);
}
// heures toujours au format « 20h00 » (40H00, 40 H, 40h → 40h00)
const ctHeures = (s) => String(s == null ? '' : s).replace(/(\d+)\s*[hH](?:\s*(\d{2}))?/g, (m, h, mn) => h + 'h' + (mn || '00'));
// normalise les heures d'un texte libre ET les met en gras (« 40h00 dont … puis 20h00 »)
function ctHeuresGras(texte) {
  const t = ctHeures(texte);
  const out = [];
  const re = /\d+h\d{2}/g;
  let i = 0, m;
  while ((m = re.exec(t))) {
    if (m.index > i) out.push({ t: t.slice(i, m.index) });
    out.push({ t: m[0], b: 1 });
    i = m.index + m[0].length;
  }
  if (i < t.length) out.push({ t: t.slice(i) });
  return out.length ? out : [{ t }];
}
// montants toujours avec deux décimales et séparateur de milliers : « 1 000,00 € »
function ctMontant(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const n = parseFloat(s.replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'));
  if (!isFinite(n)) return s;
  return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/, ' ') + ' €';
}
function contratBlocks(d) {
  const rep = d.representant || 'Antonin HATTABE';
  return [
    { h1: 'CONTRAT DE SOUS-TRAITANCE DE FORMATION' },
    { sub: d.ref || 'Réf. n° 2023/L&S0701' },
    { p: 'ENTRE LES SOUSSIGNÉS :', bold: true },
    { p: `LANGUAGES & SUCCESS - L&S (enregistré sous le N° 93 060 886 106 auprès du Préfet de la région PACA - Certificat QUALIOPI ${QUALIOPI_CERT}) - 57, avenue Valéry Giscard d'Estaing - BP 1052 - 06201 NICE CÉDEX 3, représenté par ${rep}, Président, auquel il est conclu la convention suivante, en application des dispositions de la partie VI du Code du travail portant organisation de la formation professionnelle continue dans le cadre de la formation professionnelle tout au long de la vie.` },
    { p: 'Ci-après dénommé « Languages and Success ».', bold: true, italics: true },
    { p: 'ET', bold: true, before: true },
    { p: `${d.stnom || ''}`, bold: true },
    { p: `Né(e) le ${d.stNaissance || '…'}, de nationalité ${d.stNationalite || '…'}.` },
    { p: `Demeurant : ${d.stAdresse || '…'}` },
    { p: `Inscrit au répertoire INSEE en qualité d'auto-entrepreneur sous le numéro : ${d.stSiret || '…'}` },
    { p: `Numéro d'activité (NDA) : ${d.stNda || '…'}` },
    { p: `Ci-après dénommé « ${d.stnom || 'le Sous-traitant'} » ou « le Sous-traitant ».`, bold: true, italics: true },
    { p: 'IL A ÉTÉ CONVENU CE QUI SUIT :', bold: true, before: true, after: true },
    { art: 'ARTICLE 1 – OBJET ET NATURE DU CONTRAT DE FORMATION' },
    { p: "Le présent contrat est conclu dans le cadre d'une prestation de formation ponctuelle réalisée par le sous-traitant au bénéfice du donneur d'ordre." },
    // en gras : le nom de la formation, la langue, les volumes horaires et les dates
    { rp: [{ t: 'La formation est dénommée : ' }, { t: `« ${d.intitule || '…'} » en ${d.langue || '…'}`, b: 1 }, { t: '.' }] },
    { p: "Type d'action de formation (art. L6313-1 du code du travail) : action d'acquisition, d'entretien ou de perfectionnement de la langue." },
    { rp: [{ t: 'Stagiaire(s) : ' }, { t: d.stagiaire || '…', b: 1 }] },
    { rp: [{ t: "Programme global de l'action de formation (pour information) : " }].concat(ctHeuresGras(d.programme || '…')) },
    { rp: [{ t: 'Mission confiée au Sous-traitant : ' }].concat(ctHeuresGras(d.mission || "l'animation des seules heures de formation synchrones, selon la ou les modalités précisées ci-dessus (présentiel et/ou distanciel). Les autres composantes du programme global demeurent mises en œuvre par le Donneur d'ordre dans les conditions de l'article 2.")) },
    { p: `Lieu de la formation : ${d.lieu || 'en distanciel (Visioconférence)'}` },
    { rp: [{ t: 'Dates de formation : ' }, { t: `du ${d.dateDebut || '…'} au ${d.dateFin || '…'}`, b: 1 }] },
    { art: 'ARTICLE 2 – PÉRIMÈTRE DE LA MISSION CONFIÉE AU SOUS-TRAITANT' },
    { p: "La mission confiée au Sous-traitant porte exclusivement sur l'animation des heures de formation synchrones, en présentiel et/ou en distanciel, visées à l'article 1." },
    { p: "Le Donneur d'ordre conserve la mise en œuvre directe de l'ensemble des autres composantes de l'action de formation, et notamment, le cas échéant :" },
    { li: "les modules Elearning, en ce compris la mise à disposition de la plateforme et des contenus, l'envoi des identifiants de connexion, l'assistance technique et pédagogique, le suivi de l'assiduité et les relances des apprenants ;" },
    { li: "la certification, en ce compris l'inscription, l'organisation des passages et la transmission des résultats ;" },
    { li: "la gestion administrative et logistique de l'action." },
    { p: "En conséquence, les documents de suivi afférents, le cas échéant, aux modules Elearning et à la certification sont établis, complétés et signés exclusivement par le Donneur d'ordre. Le Sous-traitant n'est ni tenu ni habilité à les remplir ou à les signer. Les heures correspondantes ne constituent pas des heures sous-traitées au sens de la réglementation applicable au Compte Personnel de Formation." },
    { art: 'ARTICLE 3 – DURÉE DU CONTRAT' },
    { p: "Le présent contrat est strictement limité à la prestation de formation visée à l'article 1. Il cesse de plein droit à son terme." },
    { art: 'ARTICLE 4 – OBLIGATIONS DU SOUS-TRAITANT' },
    { li: "Respecter les objectifs imposés par le Donneur d'ordre." },
    { li: "Ne pas déléguer sa mission à un autre formateur et, d'une manière générale, ne pas avoir lui-même recours à la sous-traitance." },
    { li: "Pendant la formation, le Sous-traitant s'engage à effectuer un test mi-parcours, un test de fin de parcours et à remplir l'Interactive Worksheet en la communiquant après chaque cours au stagiaire." },
    { li: "Informer immédiatement le Donneur d'ordre en cas de difficultés rencontrées avec le stagiaire et/ou l'entreprise (absentéisme répété, cours non annulés, travail Elearning non effectué, attitude inadéquate, etc.)." },
    { li: "Après la formation, le Sous-traitant s'engage à remplir l'attestation de fin de formation et à la faire signer au stagiaire." },
    { li: "Communiquer au Donneur d'ordre l'ensemble des documents dûment remplis et signés par le formateur et le stagiaire, nécessaires à la bonne exécution de la mission confiée au Sous-traitant telle que définie aux articles 1 et 2 :" },
    { li2: "feuilles de présence (visio/téléphone/Face to Face) afférentes aux seules heures synchrones animées par le Sous-traitant — les relevés de suivi Elearning et les documents de certification/examen sont établis par le Donneur d'ordre conformément à l'article 2," },
    { li2: "Interactive Worksheet," },
    { li2: "questionnaire et test mi-parcours de formation," },
    { li2: "questionnaire et test de fin de formation," },
    { li2: "attestation de fin de formation," },
    { li2: "le questionnaire du formateur," },
    { li2: "ainsi que tout autre document obligatoire dans le cadre de la certification QUALIOPI et dont la liste lui serait communiquée au cours de la formation." },
    { p: "L'ensemble de ces documents est à transmettre au plus tard 5 jours après la fin de la formation ; cette liste peut évoluer en fonction des obligations légales du Donneur d'ordre." },
    { li: "Le Sous-traitant s'engage à respecter la réglementation applicable aux pratiques commerciales par les sous-traitants, notamment dans le cadre de la promotion de formations par des influenceurs, conformément à la loi du 19 décembre 2022 visant à lutter contre la fraude au CPF et à interdire le démarchage téléphonique, et à la loi du 9 juin 2023 visant notamment à lutter contre les dérives des influenceurs sur les réseaux sociaux." },
    { li: "Dans le cadre des formations, le Sous-traitant garantit une qualité d'enseignement en adéquation avec les besoins et les objectifs de l'Apprenant." },
    { li: "Appliquer un devoir de réserve et de confidentialité au regard du stagiaire et/ou de l'entreprise auprès duquel ou de laquelle il (elle) intervient." },
    { li: "Avoir une excellente présentation et une attitude en adéquation avec l'image et la qualité des prestations dispensées par le Donneur d'ordre, qu'il s'agisse de cours en présentiel ou en distanciel." },
    { li: "Souscrire une police d'assurance RCP et en fournir une copie au Donneur d'ordre." },
    { li: "Fournir une copie de « l'attestation de compte à jour et de fourniture de déclarations et de paiements » éditée par l'Urssaf." },
    { li: "Posséder un Numéro de Déclaration d'Activité (NDA) et en fournir une copie au Donneur d'ordre." },
    { li: "Fournir une copie de « l'attestation fiscale » de l'année précédente éditée par l'Urssaf." },
    { art: "ARTICLE 5 – OBLIGATIONS DU DONNEUR D'ORDRE" },
    { li: "Confier au Sous-traitant la mission définie aux articles 1 et 2." },
    { li: "Communiquer au Sous-traitant l'ensemble des informations et des documents utiles afin qu'il puisse travailler dans de bonnes conditions (test de niveau, feuilles de présence, programme de formation)." },
    { li: "Assurer la gestion et la logistique de la formation, en ce compris la mise en œuvre des modules Elearning et de la certification conformément à l'article 2." },
    { li: "Respecter la propriété intellectuelle du contenu et des supports de la formation." },
    { li: "Informer le sous-traitant de l'annulation et des changements éventuels de date de la formation, au plus tard 5 jours à l'avance." },
    { li: "Le Donneur d'ordre se porte fort du respect par le Sous-traitant des dispositions du code de la consommation et met en place toute mesure utile visant à prévenir la mise en œuvre par le Sous-traitant de pratiques commerciales interdites à l'encontre des titulaires de compte CPF." },
    { li: "Le Donneur d'ordre s'assure que le sous-traitant remplit bien les obligations mentionnées à l'article L. 6323-9-1 du Code du travail." },
    { li: "Le Donneur d'ordre se porte fort du respect de la réglementation applicable et de la qualité de l'enseignement du Sous-traitant, qui doit être conforme au référentiel national qualité QUALIOPI." },
    { art: 'ARTICLE 6 – MODALITÉS FINANCIÈRES' },
    // Seuls le PRIX HORAIRE et le TOTAL sont mis en gras ici (avec deux décimales) ; le reste
    // est en texte normal, les termes contractuels étant mis en gras automatiquement.
    { rp: [{ t: 'En contrepartie de ses prestations, le ' }, { t: 'Sous-traitant', b: 1 }, { t: ' percevra une rémunération de ' }, { t: ctMontant(d.tauxHoraire) || '…', b: 1 }, { t: ' HT par heure de cours synchrone effectuée,' }] },
    { rp: [{ t: 'soit un total de ' }, { t: ctMontant(d.montantTotal) || '…', b: 1 }, { t: " HT correspondant à l'intégralité de la mission définie aux articles 1 et 2" }]
        .concat(d.heuresSync ? [{ t: ', soit ' }, { t: ctHeures(d.heuresSync), b: 1 }] : []).concat([{ t: '.' }]) },
    { p: "Le règlement sera effectué dans un délai de 5 jours maximum, à réception d'une facture accompagnée des feuilles de présence des heures synchrones effectuées dans le mois, dûment remplies et signées (par le Sous-traitant et le stagiaire), au plus tard le 5 de chaque mois." },
    { p: "Le règlement de la facture finale est conditionné par l'envoi de l'ensemble des documents visés à l'article 4, afférents à la mission confiée au Sous-traitant, au Donneur d'ordre dûment remplis et signés par le formateur et le stagiaire, dans le respect des procédures QUALIOPI : les feuilles de présence (visio/téléphone/Face to Face), l'Interactive Worksheet, le questionnaire et test mi-parcours de formation, le questionnaire et test de fin de formation, l'attestation de fin de formation, le questionnaire du formateur, ainsi que tout autre document obligatoire dans le cadre de la certification QUALIOPI et dont la liste lui serait communiquée au cours de la formation." },
    { p: "Le Sous-traitant remettra à l'association LANGUAGES & SUCCESS - L&S un relevé d'identité bancaire (RIB), afin de faciliter les règlements du prix de ses prestations." },
    { art: 'ARTICLE 7 – OBLIGATION DE LOYAUTÉ ET DE NON-CAPTATION DE CLIENTÈLE' },
    { p: "Les parties s'engagent à toujours se comporter l'une envers l'autre comme des partenaires loyaux et de bonne foi et notamment à s'informer mutuellement de toute difficulté qu'elles pourraient rencontrer dans le cadre de l'exécution du présent contrat." },
    { p: "L'Association LANGUAGES & SUCCESS - L&S s'engage à respecter le caractère indépendant de la mission effectuée par le Sous-traitant, et à ce titre, à ne pas entraver les cours que le Sous-traitant effectuerait en dehors de ceux dispensés pour l'Association LANGUAGES & SUCCESS - L&S." },
    { p: "De son côté, le Sous-traitant reconnaît que les clients de l'Association LANGUAGES & SUCCESS - L&S demeurent la propriété exclusive de l'Association pendant toute la durée d'exploitation des conventions de formation, mais également après, sans limitation de temps." },
    { p: "Le Sous-traitant s'engage, aussi longtemps qu'il exercera des missions pour le compte de l'Association LANGUAGES & SUCCESS - L&S et ce de façon définitive après la cessation du contrat, à ne pas entrer en contact directement ou indirectement, sous quelque forme ou quelque mode que ce soit, avec les clients de l'Association LANGUAGES & SUCCESS - L&S, et, de manière corollaire, à ne pas démarcher lesdits clients existants et à venir, et ce même s'il fait l'objet de sollicitations de leur part." },
    { art: 'ARTICLE 8 – CONFIDENTIALITÉ' },
    { p: "Le Sous-traitant s'engage à considérer comme strictement confidentielles toutes les informations qui lui auront été communiquées comme telles par le Donneur d'ordre dans le cadre de l'exécution du présent contrat, et notamment toutes informations concernant ledit Donneur d'ordre, les produits et services objet du présent contrat, les outils et méthodes pédagogiques, les contenus de cours et les procédés d'apprentissage fournis par le Donneur d'ordre pour la bonne exécution des cours et plus généralement des formations linguistiques, et s'interdit, en conséquence, pendant toute la durée du présent contrat et sans limitation de durée après son expiration, à condition que les informations susvisées ne soient pas tombées dans le domaine public, de les divulguer à quelque titre, sous quelque forme et à quelque personne que ce soit." },
    { art: 'ARTICLE 9 – RÉSILIATION ANTICIPÉE' },
    { p: '9.1 Inexécution fautive', bold: true },
    { p: "Le présent contrat pourra être résilié par anticipation, par l'une ou l'autre des parties, en cas d'inexécution de l'une quelconque des obligations y figurant et/ou de l'une quelconque des obligations inhérentes à l'activité exercée." },
    { p: "Sauf stipulations contraires du présent contrat prévoyant une résiliation immédiate lorsqu'il n'est pas possible de remédier au manquement, la résiliation anticipée interviendra 8 jours après une mise en demeure signifiée par lettre recommandée avec accusé de réception à la partie défaillante, indiquant l'intention de faire application de la présente clause résolutoire expresse, restée sans effet." },
    { p: "9.2 Cessation d'activité", bold: true },
    { p: "Le présent contrat pourra également être résilié par anticipation en cas de liquidation ou redressement judiciaire de l'une ou l'autre des parties dans les conditions légales et réglementaires en vigueur, et sous réserve, le cas échéant, des dispositions d'ordre public applicables." },
    { p: "Dans tous les cas de figure, au terme de la date d'effet de la résiliation, le Sous-traitant s'engage à mettre à la disposition du Donneur d'ordre tous documents et supports appartenant au Donneur d'ordre en sa possession." },
    { art: 'ARTICLE 10 – LITIGES' },
    { p: "De convention expresse entre les parties, le présent contrat est soumis au droit français." },
    { p: "Tout différend ou litige né à l'occasion du présent contrat, portant sur son application, son interprétation et/ou les responsabilités encourues, et qui n'aurait pu être réglé à l'amiable par les Parties, sera soumis à la compétence exclusive du Tribunal de Commerce de NICE (06). Les Parties font élection de domicile à leur adresse respective indiquée au présent contrat." },
    // Zone de date et de signature nettement dégagée du corps du contrat (au moins deux lignes
    // vides au-dessus de la date, puis au-dessus des signatures).
    { vide: 2 },
    { p: `Fait à ${d.lieuFait || 'Nice'}, le ${d.dateFait || ''}` },
    { vide: 2 },
    // ⚠️ Le tampon L&S se pose SOUS « Antonin HATTABE / Président » et la signature manuscrite du
    // sous-traitant sous son nom (demande de l'utilisateur, 05/08/2026). Les deux images sont
    // FACULTATIVES : sans elles le bloc reste exactement celui d'avant.
    { sign: { gauche: ["Pour le Donneur d'ordre, Languages and Success", rep, 'Président'], droite: ['Pour le Sous-traitant,', d.stnom || ''], tampon: true, sigDroite: d.sousTraitantSig || null } }
  ];
}
function buildContratDocx(d, user, ver) {
  const kids = [];
  // segments d'un bloc : les rp gardent leur gras explicite, le reste passe par ctSeg
  const segs = (b, txt) => b.rp ? b.rp : ctSeg(txt);
  const runs = (list, o) => list.map(s => new TextRun({ text: s.t, bold: !!s.b || !!(o && o.bold), italics: !!(o && o.italics), color: INKC, size: (o && o.size) || 19 }));
  contratBlocks(d).forEach(b => {
    if (b.h1) kids.push(dxPara(b.h1, { bold: true, color: ACCENTC, size: 28, align: AlignmentType.CENTER, after: 40 }));
    else if (b.sub) kids.push(dxPara(b.sub, { color: SOFTC, italics: true, align: AlignmentType.CENTER, after: 140 }));
    // saut de ligne AVANT chaque article + espace conservé entre les articles
    else if (b.art) kids.push(dxPara(b.art, { bold: true, color: DARKC, size: 23, before: 400, after: 120 }));
    else if (b.vide) { for (let i = 0; i < b.vide; i++) kids.push(dxPara('', { size: 19, after: 120 })); }
    else if (b.sign) {
      // les deux blocs de signature aux extrémités, sur la même ligne
      // ⚠️ Les images vont DANS la cellule, sous les lignes de texte : la grille reste fixe, donc
      // la colonne droite ne décolle pas de la marge (c'est ce que prévient le commentaire ci-dessous).
      const col = (lignes, align, images) => new TableCell({ width: { size: 4513, type: WidthType.DXA }, borders: NO_BORDERS(), margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: lignes.map(l => new Paragraph({ alignment: align, children: runs(ctSeg(l), { size: 19 }) })).concat(images || []) });
      const sigST = sigImg(b.sign.sigDroite);
      const imgST = sigST ? [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: sigST.type, data: sigST.buffer, transformation: sigBox(sigST, 120, 56) })] })] : [];
      // ⚠️ grille FIXE et marges nulles : sans elles, Word répartit les colonnes d'après leur
      // contenu et le bloc « Pour le Sous-traitant » ne tombe plus sur la marge droite.
      kids.push(new Table({ layout: TableLayoutType.FIXED, columnWidths: [4513, 4513], width: { size: 9026, type: WidthType.DXA }, borders: NO_BORDERS(), rows: [new TableRow({ children: [
        col(b.sign.gauche, AlignmentType.LEFT, b.sign.tampon ? dxSignatureAntonin(130, SIGN_ANTONIN_TAMPON) : []),
        col(b.sign.droite, AlignmentType.RIGHT, imgST)
      ] })] }));
    }
    else if (b.li) kids.push(new Paragraph({ spacing: { after: 50 }, children: runs([{ t: '• ' }].concat(ctSeg(b.li)), { size: 18 }) }));
    else if (b.li2) kids.push(new Paragraph({ spacing: { after: 40 }, children: runs([{ t: '        –  ' }].concat(ctSeg(b.li2)), { size: 18 }) }));
    else kids.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: b.before ? 200 : 0, after: b.after ? 200 : 90 }, children: runs(segs(b, b.p), { bold: b.bold, italics: b.italics }) }));
  });
  const hf = docxHeaderFooter(user, ver);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 19, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
function buildContratPdf(d, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const left = doc.page.margins.left, totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const p = (t, o) => { o = o || {}; doc.font(o.bold ? 'Helvetica-Bold' : (o.italics ? 'Helvetica-Oblique' : 'Helvetica')).fontSize(o.size || 9).fillColor(o.color || '#2a241d').text(String(t == null ? '' : t), left, doc.y, { width: totalW, align: o.align || 'left' }); doc.moveDown(o.after != null ? o.after : 0.35); };
    // paragraphe à segments : chaque segment peut être en gras (termes contractuels, montants…)
    const rich = (segs, o) => {
      o = o || {};
      if (o.before) doc.moveDown(o.before);
      const police = (s) => (s.b || o.bold) ? (o.italics ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : (o.italics ? 'Helvetica-Oblique' : 'Helvetica');
      segs.forEach((s, i) => {
        doc.font(police(s)).fontSize(o.size || 9.2).fillColor('#2a241d');
        if (i === 0) doc.text(s.t, left, doc.y, { width: totalW, continued: segs.length > 1 });
        else doc.text(s.t, { width: totalW, continued: i < segs.length - 1 });
      });
      doc.moveDown(o.after != null ? o.after : 0.45);
    };
    contratBlocks(d).forEach(b => {
      if (b.h1) p(b.h1, { bold: true, color: '#be6e54', size: 15, align: 'center', after: 0.25 });
      else if (b.sub) p(b.sub, { color: '#6f6253', italics: true, align: 'center', size: 9, after: 0.7 });
      // saut de ligne AVANT chaque article + espace conservé entre les articles
      else if (b.art) { doc.moveDown(0.75); p(b.art, { bold: true, color: '#a8593c', size: 11, after: 0.45 }); }
      else if (b.vide) doc.moveDown(b.vide * 1.2);
      else if (b.sign) {
        // les deux blocs de signature aux extrémités, sur la même ligne
        // ⚠️ Ce bloc dessine à des coordonnées ABSOLUES : pdfkit ne le pagine pas tout seul, et le
        // contrat fait dix articles, donc la position de fin varie. Sans cette réservation, le
        // tampon et la signature déborderaient sur le pied de page quand le texte finit bas.
        pdfPlacePourSignature(doc, 130);
        const y0 = doc.y, colW = totalW / 2 - 10;
        doc.font('Helvetica').fontSize(9.2).fillColor('#2a241d');
        // ⚠️ On ne passe PLUS par { align, continued }. pdfkit aligne CHAQUE segment séparément
        // dans la largeur donnée : sur la colonne de droite, les trois morceaux de
        // « Pour le / Sous-traitant / , » étaient donc chacun collés au bord droit, l'un
        // par-dessus l'autre. Le Word ne montrait rien, c'est lui qui compose la ligne.
        // On mesure la ligne entière, on en déduit son abscisse de départ, puis on pose les
        // segments à la suite — l'alignement redevient celui de la LIGNE, pas du morceau.
        const largeurSeg = (s) => { doc.font(s.b ? 'Helvetica-Bold' : 'Helvetica'); return doc.widthOfString(s.t); };
        const bloc = (lignes, x, align) => {
          let y = y0;
          const h = doc.currentLineHeight(true);
          lignes.forEach(l => {
            const segs = ctSeg(l);
            const total = segs.reduce((a, s) => a + largeurSeg(s), 0);
            let cx = align === 'right' ? x + colW - Math.min(total, colW) : x;
            segs.forEach(s => {
              doc.font(s.b ? 'Helvetica-Bold' : 'Helvetica');
              doc.text(s.t, cx, y, { lineBreak: false });    // lineBreak:false : pas de retour à la ligne parasite
              cx += largeurSeg(s);
            });
            y += h;
          });
          doc.y = y;
          return y;
        };
        const yG = bloc(b.sign.gauche, left, 'left');
        const yD = bloc(b.sign.droite, left + totalW / 2 + 10, 'right');
        // le tampon sous « Antonin HATTABE / Président », la signature du sous-traitant sous son nom
        const hT = b.sign.tampon ? pdfSignatureAntonin(doc, left, yG + 6, 130, SIGN_ANTONIN_TAMPON, 62) : 0;
        const sST = sigImg(b.sign.sigDroite);
        let hS = 0;
        if (sST) { try { doc.image(sST.buffer, left + totalW - 120, yD + 6, { fit: [120, 54] }); hS = 58; } catch (e) { } }
        doc.y = Math.max(yG + hT, yD + hS); doc.moveDown(0.5);
      }
      else if (b.li || b.li2) rich((b.li ? [{ t: '•  ' }] : [{ t: '        –  ' }]).concat(ctSeg(b.li || b.li2)), { size: 9, after: b.li ? 0.2 : 0.18 });
      else rich(b.rp || ctSeg(b.p), { size: 9.2, after: b.after ? 0.9 : 0.45, bold: b.bold, italics: b.italics, before: b.before ? 0.5 : 0 });
    });
    pdfHeaderFooter(doc, user, ver); doc.end();
  });
}
// génère une référence de contrat avec 5 chiffres aléatoires JAMAIS réutilisés
function newContratRef() {
  db.contratRefs = db.contratRefs || [];
  let num;
  do { num = String(Math.floor(10000 + Math.random() * 90000)); } while (db.contratRefs.indexOf(num) >= 0);
  db.contratRefs.push(num); save();
  return 'Réf. n° ' + new Date().getFullYear() + '/L&S' + num;
}
app.post('/api/contrat/generate', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const { group, fields, format } = req.body || {};
  const g = groupById(group);
  if (!g) return res.status(400).json({ error: 'Dossier introuvable.' });
  // le contrat lie L&S à UN formateur : on valide lequel
  const cibP = targetProf(g, (req.body || {}).prof, req.user);
  if (cibP.error) return res.status(400).json({ error: cibP.error });
  const d = fields || {};
  d.ref = newContratRef(); // référence unique générée serveur (5 chiffres uniques)
  d.representant = 'Antonin HATTABE'; // représentant L&S fixe par défaut
  const ver = bumpVersion(g, 'contrat');
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildContratDocx(d, req.user, ver); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildContratPdf(d, req.user, ver); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('contrat:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'contrat', title: 'Contrat de sous-traitance', format: ext === 'docx' ? 'word' : 'pdf', apprenant: d.stnom || 'formateur' });
  const name = '7 - ' + safeFile('Contrat de sous-traitance') + ' - ' + safeFile(d.stnom || 'formateur') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

// ---- questionnaires (QS mi-parcours / fin de formation) --------------------
function pdfHeaderFooter(doc, user, ver) {
  const legal = LEGAL_LINES.join('\n');
  const meta = metaLines(user, ver).join('\n');
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;
    try { doc.image(LOGO_PATH, 50, 26, { width: 44 }); } catch (e) { }
    doc.font('Helvetica').fontSize(6.5).fillColor('#6f6253').text(meta, 50, doc.page.height - 74, { width: 220, align: 'left' });
    doc.font('Helvetica').fontSize(8).fillColor('#6f6253').text((i + 1) + ' / ' + range.count, 50, doc.page.height - 30, { lineBreak: false });
    doc.font('Helvetica').fontSize(6.5).fillColor('#6f6253').text(legal, doc.page.width - 50 - 320, doc.page.height - 74, { width: 320, align: 'right' });
  }
}
function docxFooterFor(user, ver) {
  const NB = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } };
  // ⚠️ comme dans le PDF, le numéro de page vient APRÈS les lignes de méta (tout en bas à gauche)
  const leftChildren = metaLines(user, ver).map(l => new Paragraph({ children: [new TextRun({ text: l, size: 12, color: '6F6253' })] }))
    .concat([new Paragraph({ children: [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16, color: '6F6253' })] })]);
  // ⚠️ grille FIXE : sans elle Word ignore le 40/60 et coupe le pied en deux moitiés égales,
  // ce qui replie le bloc légal sur trois lignes de plus que dans le PDF.
  return new Footer({ children: [new Table({ layout: TableLayoutType.FIXED, columnWidths: [3610, 5416], width: { size: 9026, type: WidthType.DXA }, borders: NB, rows: [new TableRow({ children: [
    new TableCell({ width: { size: 3610, type: WidthType.DXA }, borders: NB, children: leftChildren }),
    new TableCell({ width: { size: 5416, type: WidthType.DXA }, borders: NB, children: LEGAL_LINES.map(l => new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: l, size: 12, color: '6F6253' })] })) })
  ] })] })] });
}
function docxHeaderFooter(user, ver) {
  let logoRun = null; try { logoRun = new ImageRun({ type: 'png', data: fs.readFileSync(LOGO_PATH), transformation: { width: 44, height: 44 } }); } catch (e) { }
  const header = new Header({ children: [new Paragraph({ children: logoRun ? [logoRun] : [] })] });
  return { header, footer: docxFooterFor(user, ver) };
}
// regroupe les items : les questions radio consécutives partageant les mêmes options
// forment une MATRICE (tableau critères × options), comme les Word d'origine.
function sameOpts(a, b) { return !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]); }
function qsBlocks(items) {
  const blocks = []; let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.type === 'radio') {
      const opts = it.options || []; const questions = [];
      while (i < items.length && items[i].type === 'radio' && sameOpts(items[i].options, opts)) { questions.push(items[i]); i++; }
      blocks.push({ kind: 'matrix', options: opts, questions });
    } else { blocks.push({ kind: it.type, item: it }); i++; }
  }
  return blocks;
}
function buildQsPdf(qs, tpl, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const h = qs.header || {}, ans = qs.answers || {};
    const left = doc.page.margins.left, right = doc.page.width - doc.page.margins.right, totalW = right - left;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensure = (need) => { if (doc.y + need > bottom()) doc.addPage(); };
    // titre + filet
    doc.fillColor('#be6e54').fontSize(18).font('Helvetica-Bold').text(tpl.title, left, doc.y, { width: totalW });
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(1.4).strokeColor('#be6e54').stroke();
    doc.moveDown(0.55);
    // en-tête (label : valeur)
    (tpl.headerFields || QS_HEADER_FIELDS).forEach(f => { doc.fillColor('#2a241d').fontSize(10).font('Helvetica-Bold').text(f.label + ' : ', left, doc.y, { continued: true }).font('Helvetica').text(String(h[f.id] || '—')); doc.moveDown(0.35); });
    if (h.certification) { doc.fillColor('#2a241d').fontSize(10).font('Helvetica-Bold').text('Certification : ', left, doc.y, { continued: true }).font('Helvetica').text(String(h.certification)); doc.moveDown(0.1); }
    doc.moveDown(0.9);
    // dessin d'une cellule (fond + bordure + texte centré verticalement)
    function cell(x, y, w, hh, text, o) {
      o = o || {};
      if (o.fill) doc.rect(x, y, w, hh).fillColor(o.fill).fill();
      doc.rect(x, y, w, hh).lineWidth(0.6).strokeColor('#d9cabe').stroke();
      if (text != null && text !== '') {
        doc.fillColor(o.color || '#2a241d').font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 9);
        const padX = o.padX != null ? o.padX : 6, availW = w - padX * 2;
        const th = doc.heightOfString(String(text), { width: availW, align: o.align || 'left' });
        doc.text(String(text), x + padX, y + Math.max((hh - th) / 2, 2), { width: availW, align: o.align || 'left' });
      }
    }
    function precision(q) { if (!(q.comment && ans[q.id + '_c'])) return; ensure(16); doc.fillColor('#6f6253').font('Helvetica-Oblique').fontSize(8.5).text('Précision : ' + ans[q.id + '_c'], left, doc.y, { width: totalW }); doc.moveDown(0.3); }
    function matrix(options, questions) {
      const optW = Math.min(88, Math.max(50, (totalW * 0.46) / options.length));
      const firstW = totalW - optW * options.length;
      doc.font('Helvetica-Bold').fontSize(7.6); let headerH = 18; options.forEach(o => { headerH = Math.max(headerH, doc.heightOfString(o, { width: optW - 8, align: 'center' }) + 9); });
      const drawHeader = () => { const y = doc.y; cell(left, y, firstW, headerH, '', { fill: '#f3e7e0' }); options.forEach((o, k) => cell(left + firstW + optW * k, y, optW, headerH, o, { fill: '#f3e7e0', bold: true, align: 'center', size: 7.6 })); doc.y = y + headerH; };
      ensure(headerH + 24); drawHeader();
      questions.forEach(q => {
        doc.font('Helvetica').fontSize(9); const rh = Math.max(doc.heightOfString(q.label, { width: firstW - 12 }) + 11, 22);
        if (doc.y + rh > bottom()) { doc.addPage(); drawHeader(); }
        const y = doc.y;
        cell(left, y, firstW, rh, q.label, { size: 9 });
        options.forEach((o, k) => { const sel = ans[q.id] === o; cell(left + firstW + optW * k, y, optW, rh, sel ? 'X' : '', { fill: sel ? '#be6e54' : null, color: '#ffffff', bold: true, align: 'center', size: 11 }); });
        doc.y = y + rh;
      });
      doc.moveDown(1.1); questions.forEach(precision);
    }
    function scale(item) {
      ensure(30); doc.fillColor('#2a241d').font('Helvetica-Bold').fontSize(9.5).text(item.label, left, doc.y, { width: totalW }); doc.moveDown(0.3);
      const cw = totalW / 10, hh = 22; ensure(hh + 4); const y = doc.y;
      for (let k = 1; k <= 10; k++) { const sel = String(ans[item.id]) === String(k); cell(left + cw * (k - 1), y, cw, hh, String(k), { fill: sel ? '#be6e54' : '#f3e7e0', color: sel ? '#ffffff' : '#2a241d', bold: true, align: 'center', size: 10 }); }
      doc.y = y + hh; doc.moveDown(1.1); precision(item);
    }
    function textItem(item) {
      ensure(34); doc.fillColor('#2a241d').font('Helvetica-Bold').fontSize(9.5).text(item.label, left, doc.y, { width: totalW }); doc.moveDown(0.3);
      const valTxt = String(ans[item.id] || ''); doc.font('Helvetica').fontSize(9.5); const innerW = totalW - 16;
      const boxH = Math.max(doc.heightOfString(valTxt || ' ', { width: innerW }) + 12, 28); ensure(boxH + 4); const y = doc.y;
      doc.rect(left, y, totalW, boxH).lineWidth(0.6).strokeColor('#d9cabe').stroke();
      if (valTxt) doc.fillColor('#2a241d').text(valTxt, left + 8, y + 6, { width: innerW });
      doc.y = y + boxH; doc.moveDown(1.1);
    }
    qsBlocks(tpl.items).forEach(b => {
      if (b.kind === 'intro') { ensure(24); doc.fillColor('#6f6253').font('Helvetica-Oblique').fontSize(9.5).text(b.item.text, left, doc.y, { width: totalW }); doc.moveDown(0.9); return; }
      if (b.kind === 'section') { ensure(26); doc.fillColor('#a8593c').font('Helvetica-Bold').fontSize(12).text(b.item.label, left, doc.y, { width: totalW }); doc.moveDown(0.6); return; }
      if (b.kind === 'scale') return scale(b.item);
      if (b.kind === 'text') return textItem(b.item);
      if (b.kind === 'matrix') return matrix(b.options, b.questions);
    });
    pdfHeaderFooter(doc, user, ver);
    doc.end();
  });
}
const SH_CLEAR = ShadingType ? ShadingType.CLEAR : 'clear';
const V_CENTER = VerticalAlign ? VerticalAlign.CENTER : 'center';
function buildQsDocx(qs, tpl, user, ver) {
  const ACCENT = 'BE6E54', DARK = 'A8593C', INK = '2A241D', SOFT = '6F6253', HEADBG = 'F3E7E0';
  const h = qs.header || {}, ans = qs.answers || {};
  const BD = { style: BorderStyle.SINGLE, size: 4, color: 'D9CABE' };
  const cellBorders = { top: BD, bottom: BD, left: BD, right: BD };
  function tcell(text, o) {
    o = o || {};
    return new TableCell({
      width: o.width, borders: cellBorders, verticalAlign: o.valign === 'top' ? (VerticalAlign ? VerticalAlign.TOP : 'top') : V_CENTER,
      shading: o.fill ? { type: SH_CLEAR, color: 'auto', fill: o.fill } : undefined,
      margins: { top: 110, bottom: 110, left: 140, right: 140 },   // mêmes marges que pdfCell
      children: [new Paragraph({ alignment: o.align || AlignmentType.LEFT, children: [new TextRun({ text: String(text == null ? '' : text), bold: !!o.bold, color: o.color || INK, size: o.size || 19 })] })]
    });
  }
  const precisionPara = (txt) => new Paragraph({ children: [new TextRun({ text: 'Précision : ' + txt, italics: true, color: SOFT, size: 18 })], spacing: { after: 60 } });
  const kids = [];
  kids.push(new Paragraph({ children: [new TextRun({ text: tpl.title, bold: true, color: ACCENT, size: 34 })], spacing: { after: 70 }, border: { bottom: { color: ACCENT, style: BorderStyle.SINGLE, size: 18, space: 6 } } }));
  (tpl.headerFields || QS_HEADER_FIELDS).forEach(f => kids.push(new Paragraph({ children: [new TextRun({ text: f.label + ' : ', bold: true, color: INK, size: 21 }), new TextRun({ text: String(h[f.id] || '—'), color: INK, size: 21 })], spacing: { after: 140 } })));
  if (h.certification) kids.push(new Paragraph({ children: [new TextRun({ text: 'Certification : ', bold: true, color: INK, size: 21 }), new TextRun({ text: String(h.certification), color: INK, size: 21 })], spacing: { after: 40 } }));
  // une ligne vide APRES chaque element : c'est ce qui aere le document
  const gap = () => kids.push(new Paragraph({ text: '', spacing: { after: 240 } }));
  qsBlocks(tpl.items).forEach(b => {
    if (b.kind === 'intro') { kids.push(new Paragraph({ children: [new TextRun({ text: b.item.text, italics: true, color: SOFT, size: 20 })], spacing: { before: 200, after: 240 } })); return; }
    if (b.kind === 'section') { kids.push(new Paragraph({ children: [new TextRun({ text: b.item.label, bold: true, color: DARK, size: 25 })], spacing: { before: 400, after: 200 } })); return; }
    if (b.kind === 'text') {
      kids.push(new Paragraph({ children: [new TextRun({ text: b.item.label, bold: true, color: INK, size: 21 })], spacing: { before: 260, after: 90 } }));
      kids.push(dxTable([dxRowMin([tcell(ans[b.item.id] || ' ', { width: { size: 9026, type: WidthType.DXA }, valign: 'top' })], 900)], [9026]));
      gap(); return;
    }
    if (b.kind === 'scale') {
      kids.push(new Paragraph({ children: [new TextRun({ text: b.item.label, bold: true, color: INK, size: 21 })], spacing: { before: 260, after: 90 } }));
      // dix colonnes rigoureusement égales, comme le PDF (cases relevées tous les ~49,6 pt)
      const COLS10 = dxCols([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      const cw = { size: COLS10[0], type: WidthType.DXA };
      const numRow = dxRowMin([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => { const sel = String(ans[b.item.id]) === String(k); return tcell(String(k), { width: cw, align: AlignmentType.CENTER, bold: true, fill: sel ? ACCENT : HEADBG, color: sel ? 'FFFFFF' : INK, size: 20 }); }), 420);
      kids.push(dxTable([numRow], COLS10));
      gap(); if (b.item.comment && ans[b.item.id + '_c']) kids.push(precisionPara(ans[b.item.id + '_c'])); return;
    }
    if (b.kind === 'matrix') {
      // grille FIXE : colonne des critères à 52 %, options à parts égales sur les 48 % restants
      const opts = b.options;
      const COLSM = dxCols([52].concat(opts.map(() => 48 / opts.length)));
      const firstW = { size: COLSM[0], type: WidthType.DXA }, optW = { size: COLSM[1], type: WidthType.DXA };
      const header = new TableRow({ tableHeader: true, children: [tcell('', { width: firstW, fill: HEADBG })].concat(opts.map(o => tcell(o, { width: optW, fill: HEADBG, bold: true, align: AlignmentType.CENTER, size: 16 }))) });
      const rows = [header].concat(b.questions.map(q => dxRowMin([tcell(q.label, { width: firstW, size: 19 })].concat(opts.map(o => { const sel = ans[q.id] === o; return tcell(sel ? '✗' : '', { width: optW, align: AlignmentType.CENTER, bold: true, fill: sel ? ACCENT : undefined, color: sel ? 'FFFFFF' : INK, size: 22 }); })), 460)));
      kids.push(dxTable(rows, COLSM));
      gap(); b.questions.forEach(q => { if (q.comment && ans[q.id + '_c']) kids.push(precisionPara(ans[q.id + '_c'])); }); return;
    }
  });
  const hf = docxHeaderFooter(user, ver);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INK } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
async function generateQsDoc(qs, format, fromUser) {
  const tpl = QS_TEMPLATES[qs.type];
  let buf, ext, type;
  const verQ = bumpVersion(groupById(qs.group), qs.type);
  if (format === 'word' || format === 'docx') { buf = await buildQsDocx(qs, tpl, fromUser, verQ); ext = 'docx'; type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
  else { buf = await buildQsPdf(qs, tpl, fromUser, verQ); ext = 'pdf'; type = 'application/pdf'; }
  const stored = crypto.randomUUID() + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, stored), buf);
  const name = (qs.type === 'qs_mid' ? '2' : '3') + ' - ' + safeFile(tpl.title) + ' - ' + safeFile((qs.header && qs.header.nomApprenant) || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  // la version est retenue sur la pièce : la régénérer en Word ne doit pas la faire avancer,
  // c'est le même document dans un autre format
  const doc = { id: crypto.randomUUID(), group: qs.group, channel: 'commun', from: fromUser.id, fromAdmin: fromUser.role === 'admin', name, size: buf.length, type, stored, date: Date.now(), ver: verQ };
  db.docs.push(doc);
  return doc;
}

// le formateur (ou admin) remplit l'en-tête et envoie le questionnaire à l'apprenant
app.post('/api/qs/send', auth, (req, res) => {
  const { group, type, header } = req.body || {};
  const tpl = QS_TEMPLATES[type];
  const g = groupById(group);
  if (!tpl) return res.status(400).json({ error: 'Type de questionnaire inconnu.' });
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  if (!g.eleve) return res.status(400).json({ error: 'Ce dossier ne compte aucun apprenant.' });
  const qs = { id: crypto.randomUUID(), group: g.id, type, header: header || {}, answers: {}, status: 'pending', docId: null, by: req.user.id, date: Date.now() };
  db.qs.push(qs);
  db.messages.push({ id: crypto.randomUUID(), group: g.id, channel: 'commun', from: req.user.id, fromAdmin: req.user.role === 'admin', kind: 'qs', qsId: qs.id, qsType: type, text: 'Demande de remplissage : ' + tpl.title, date: Date.now() });
  notify(g.eleve, `${senderDisplay(req.user)} vous demande de remplir : ${tpl.title}`, g.id);
  db.users.filter(u => u.role === 'admin' && u.id !== req.user.id).forEach(a => notify(a.id, `${senderDisplay(req.user)} a envoyé un questionnaire à remplir (${tpl.title}).`, g.id));
  // e-mail à l'apprenant concerné : un questionnaire l'attend
  const eleveQ = realUser(g.eleve);
  if (eleveQ) {
    const urlQ = SITE_URL + '/espace-documents.html';
    sendMailSafe(eleveQ.email,
      'Un questionnaire à remplir vous attend — Languages & Success',
      'Bonjour ' + eleveQ.prenom + ',\n\n' + senderDisplay(req.user) + ' vous demande de remplir le questionnaire « ' + tpl.title + ' ».\n\nConnectez-vous à votre espace documents pour le remplir :\n' + urlQ + '\n\nLanguages & Success',
      mailHtml('Un questionnaire à remplir vous attend',
        ['Bonjour ' + eleveQ.prenom + ',', senderDisplay(req.user) + ' vous demande de remplir le questionnaire « ' + tpl.title + ' ».', 'Connectez-vous à votre espace documents pour le remplir.'],
        'Remplir le questionnaire', urlQ));
  }
  save();
  res.json({ ok: true, id: qs.id });
});
// récupérer un questionnaire (en-tête + items + réponses)
app.get('/api/qs/:id', auth, (req, res) => {
  const qs = db.qs.find(x => x.id === req.params.id);
  if (!qs) return res.status(404).json({ error: 'Questionnaire introuvable.' });
  if (!isMember(groupById(qs.group), req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const tpl = QS_TEMPLATES[qs.type] || {};
  res.json({ qs: { id: qs.id, type: qs.type, title: tpl.title, items: tpl.items, headerFields: QS_HEADER_FIELDS, header: qs.header, answers: qs.answers, status: qs.status, docId: qs.docId } });
});
// l'apprenant répond → génère le document et le dépose dans le canal commun
app.post('/api/qs/:id/submit', auth, async (req, res) => {
  const qs = db.qs.find(x => x.id === req.params.id);
  if (!qs) return res.status(404).json({ error: 'Questionnaire introuvable.' });
  const g = groupById(qs.group);
  if (!isMember(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  // seul l'APPRENANT du dossier répond : ni le formateur ni un admin à sa place (pièce nominative)
  if (req.user.id !== g.eleve) return res.status(403).json({ error: 'Seul l\'apprenant peut remplir ce questionnaire.' });
  if (qs.status === 'done') return res.status(400).json({ error: 'Ce questionnaire a déjà été rempli.' });
  qs.answers = (req.body || {}).answers || {}; qs.status = 'done'; qs.filledBy = req.user.id; qs.filledAt = Date.now();
  let doc;
  try { doc = await generateQsDoc(qs, (req.body || {}).format, req.user); } catch (e) { console.error('QS gen:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  qs.docId = doc.id;
  notifyChannel(g, 'commun', req.user, `${senderDisplay(req.user)} a rempli et déposé : ${(QS_TEMPLATES[qs.type] || {}).title}`);
  // e-mail au formateur (l'envoyeur) : le questionnaire est rempli
  const senderQ = realUser(qs.by);
  if (senderQ && senderQ.id !== req.user.id) {
    const urlS = SITE_URL + '/espace-documents.html';
    const titreQ = (QS_TEMPLATES[qs.type] || {}).title || 'Questionnaire';
    sendMailSafe(senderQ.email,
      'Questionnaire rempli par ' + senderDisplay(req.user) + ' — Languages & Success',
      'Bonjour ' + senderQ.prenom + ',\n\n' + senderDisplay(req.user) + ' a rempli le questionnaire « ' + titreQ + ' ».\nLe document est disponible sur votre espace documents.\n\n' + urlS + '\n\nLanguages & Success',
      mailHtml('Le questionnaire est rempli ✓',
        ['Bonjour ' + senderQ.prenom + ',', senderDisplay(req.user) + ' a rempli le questionnaire « ' + titreQ + ' ».', 'Le document est disponible sur votre espace documents.'],
        'Voir le document', urlS));
  }
  save();
  res.json({ ok: true, doc: docPub(doc) });
});
// l'envoyeur (ou un admin) annule un questionnaire en attente, tant que l'apprenant n'a pas répondu
app.post('/api/qs/:id/cancel', auth, (req, res) => {
  const qs = db.qs.find(x => x.id === req.params.id);
  if (!qs) return res.status(404).json({ error: 'Questionnaire introuvable.' });
  if (req.user.id !== qs.by && req.user.role !== 'admin') return res.status(403).json({ error: 'Seul l\'envoyeur peut annuler.' });
  if (qs.status === 'done') return res.status(400).json({ error: 'Déjà rempli par l\'apprenant : annulation impossible.' });
  const g = groupById(qs.group);
  db.qs = db.qs.filter(x => x.id !== qs.id);
  db.messages = db.messages.filter(m => !(m.kind === 'qs' && m.qsId === qs.id));
  if (g) notify(g.eleve, `${senderDisplay(req.user)} a annulé une demande de questionnaire.`, g.id);
  save();
  res.json({ ok: true });
});

// ---- formulaires auto-remplis par le formateur (téléchargés directement) ---
app.get('/api/form/:type', auth, (req, res) => {
  const tpl = FORM_TEMPLATES[req.params.type];
  if (!tpl) return res.status(404).json({ error: 'Document inconnu.' });
  res.json({ tpl: { title: tpl.title, headerFields: tpl.headerFields, items: tpl.items } });
});
app.post('/api/form/generate', auth, async (req, res) => {
  const { group, type, header, answers, format } = req.body || {};
  const tpl = FORM_TEMPLATES[type];
  const g = groupById(group);
  if (!tpl) return res.status(400).json({ error: 'Type de document inconnu.' });
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const qs = { header: header || {}, answers: answers || {} };
  const ver = bumpVersion(g, type);
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildQsDocx(qs, tpl, req.user, ver); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildQsPdf(qs, tpl, req.user, ver); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('form gen:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'form', tpl: type, title: tpl.title, format: ext === 'docx' ? 'word' : 'pdf', apprenant: (header && header.nomApprenant) || 'apprenant' });
  const name = (req.user.role === 'admin' ? '8' : '7') + ' - ' + safeFile(tpl.title) + ' - ' + safeFile((header && header.nomApprenant) || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

// ---- Level Test : Évaluation orale / Questionnaire d'objectifs (formateur + admin) ----
const LEVEL_TEST = {
  title: "Évaluation orale / Questionnaire d'objectifs",
  headerRows: [
    [['dateEval', 'Date évaluation'], ['niveau', 'Level / Niveau']],
    [['societe', 'Société'], ['langue', 'Langue']],
    [['nom', 'Nom'], ['fonction', 'Fonction']],
    [['prenom', 'Prénom'], ['planning', 'Planning']],
    [['tel', 'Tél'], ['mail', 'Mail']]
  ],
  textFields: [
    { id: 'objectifs', label: 'Principaux objectifs de la formation (professionnels, personnels et/ou linguistiques)' },
    { id: 'niveauLangue', label: "Niveau de langue — appréciation d'examinateur" },
    { id: 'experiences', label: 'Expériences précédentes (niveau scolaire, test, cours…)' },
    { id: 'handicap', label: "Besoins spécifiques d'accès à la formation liés à un handicap" }
  ],
  besoins: [
    { cat: 'Expression orale', items: [
      { id: 'eo_tel', label: 'Téléphone' }, { id: 'eo_type', label: 'Si oui, quel type de conversation ?' },
      { id: 'eo_visio', label: 'Visioconférence' }, { id: 'eo_f2f', label: 'Face à face' },
      { id: 'eo_contexte', label: 'Dans quel contexte conversez-vous avec des interlocuteurs étrangers ?' },
      { id: 'eo_freq', label: 'À quelle fréquence ?' }, { id: 'eo_horspro', label: 'Utilisez-vous cette langue hors du domaine professionnel ?' }
    ] },
    { cat: 'Compréhension orale', items: [
      { id: 'co_tel', label: 'Difficultés au téléphone ?' }, { id: 'co_visio', label: 'Difficultés en visioconférence ?' },
      { id: 'co_f2f', label: 'Difficultés en face à face ?' }, { id: 'co_vocab', label: 'Liées au vocabulaire spécifique' },
      { id: 'co_debit', label: "Liées au débit d'élocution" }, { id: 'co_accent', label: 'Liées à un accent' }
    ] },
    { cat: 'Expression écrite', items: [{ id: 'ee_mails', label: 'Mails' }, { id: 'ee_autres', label: 'Autres' }] },
    { cat: 'Compréhension écrite', items: [{ id: 'ce_mails', label: 'Mails' }, { id: 'ce_autres', label: 'Autres' }] },
    { cat: "Centres d'intérêt", items: [{ id: 'interets', label: '' }] }
  ],
  evalEcrite: { titre: 'Évaluation écrite', fields: [['typeTestE', 'Type de test', 'Cambridge Aptitude Test'], ['dateEvalE', 'Date évaluation'], ['resultatE', 'Résultat'], ['niveauE', 'Level / Niveau']] },
  evalOrale: { titre: 'Évaluation orale', fields: [['typeTestO', 'Type de test', 'TOEIC Test Level Projector'], ['dateEvalO', 'Date évaluation'], ['resultatO', 'Résultat'], ['niveauO', 'Level / Niveau']] }
};
// case "objectifs" du Level Test : les libellés "Besoin :" / "Objectif :" en gras + souligné
const OBJ_LABEL_RE = /^(\s*)(Besoin(?:\(s\))?|Objectif(?:\(s\))?)(\s*:)(.*)$/;
function objectifsParasDocx(text) {
  return String(text == null ? '' : text).split('\n').map(ln => {
    const m = ln.match(OBJ_LABEL_RE);
    const runs = m
      ? [new TextRun({ text: m[2] + m[3], bold: true, underline: {}, color: INKC, size: 19 }), new TextRun({ text: m[4], color: INKC, size: 19 })]
      : [new TextRun({ text: ln, color: INKC, size: 19 })];
    return new Paragraph({ children: runs });
  });
}
// ligne "objectifs" du Level Test en PDF : libellés "Besoin :" / "Objectif :" en gras + souligné
function pdfObjectifsRow(doc, left, totalW, label, value, LB) {
  const lw = totalW * 0.5, vw = totalW * 0.5, padX = 7;
  if (doc.y + 40 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const startY = doc.y, vx = left + lw + padX, vAvail = vw - padX * 2;
  let yy = startY + 5;
  String(value == null ? '' : value).split('\n').forEach(ln => {
    const m = ln.match(OBJ_LABEL_RE);
    doc.fillColor('#2a241d').fontSize(9);
    if (m) {
      doc.font('Helvetica-Bold').text(m[2] + m[3], vx, yy, { width: vAvail, underline: true, continued: true });
      doc.font('Helvetica').text(m[4] || '', { underline: false });
    } else { doc.font('Helvetica').text(ln || ' ', vx, yy, { width: vAvail }); }
    yy = doc.y;
  });
  const hh = Math.max(yy + 5 - startY, 26);
  doc.rect(left, startY, lw, hh).fillColor(LB).fill();
  doc.rect(left, startY, lw, hh).lineWidth(0.6).strokeColor('#d9cabe').stroke();
  doc.fillColor('#2a241d').font('Helvetica-Bold').fontSize(8.5).text(label, left + padX, startY + 5, { width: lw - padX * 2 });
  doc.rect(left + lw, startY, vw, hh).lineWidth(0.6).strokeColor('#d9cabe').stroke();
  doc.y = startY + hh;
}
function buildLevelTestDocx(d, user, ver) {
  const PC = (s) => ({ size: s, type: WidthType.PERCENTAGE });
  // grilles de colonnes en twips (largeur utile A4 = 9026) → layout fixe, Word respecte les proportions
  const COL_HEAD = [1625, 2888, 1625, 2888], COL_TF = [4513, 4513], COL_BES = [1986, 1760, 5280], COL_EVAL = [3610, 5416];
  const kids = [];
  kids.push(dxTable([new TableRow({ children: [dxCell(LEVEL_TEST.title.toUpperCase(), { align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 26, fill: HEADBG })] })], [9026]));
  kids.push(dxSpacer());
  const Lc = (t) => dxCell(t, { width: PC(18), fill: LBLBG, bold: true }), Vc = (t) => dxCell(t || '', { width: PC(32) });
  const headRows = LEVEL_TEST.headerRows.map(row => new TableRow({ children: row.reduce((acc, pair) => { acc.push(pair ? Lc(pair[1]) : dxCell('', { width: PC(18) })); acc.push(pair ? Vc(d[pair[0]]) : dxCell('', { width: PC(32) })); return acc; }, []) }));
  (d.extraHeader || []).forEach(ex => { if (ex && (ex.label || ex.value)) headRows.push(new TableRow({ children: [Lc(ex.label || ''), dxCell(ex.value || '', { span: 3, width: PC(82) })] })); });
  kids.push(dxTable(headRows, COL_HEAD));
  kids.push(dxSpacer());
  kids.push(dxTable(LEVEL_TEST.textFields.map(f => new TableRow({ children: [dxCell(f.label, { width: PC(50), fill: LBLBG, bold: true }), f.id === 'objectifs' ? new TableCell({ width: PC(50), borders: TBL_CELLBORDERS, verticalAlign: VerticalAlign ? VerticalAlign.TOP : 'top', margins: { top: 36, bottom: 36, left: 90, right: 90 }, children: objectifsParasDocx(d.objectifs) }) : dxCell(d[f.id] || '', { width: PC(50), valign: VerticalAlign ? VerticalAlign.TOP : 'top' })] })), COL_TF));
  kids.push(dxSpacer());
  kids.push(dxPara('BESOINS', { bold: true, color: DARKC, size: 24, after: 60 }));
  const besoinRows = [];
  LEVEL_TEST.besoins.forEach(b => {
    b.items.forEach((it, idx) => {
      const catCell = dxCell(idx === 0 ? b.cat : '', { width: PC(22), fill: HEADBG, bold: true, color: DARKC, vMerge: idx === 0 ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE });
      if (it.label === '') besoinRows.push(new TableRow({ cantSplit: true, children: [catCell, dxCell(d[it.id] || '', { span: 2, width: PC(78) })] }));
      else besoinRows.push(new TableRow({ cantSplit: true, children: [catCell, dxCell(it.label, { width: PC(19.5), fill: LBLBG }), dxCell(d[it.id] || '', { width: PC(58.5) })] }));
    });
  });
  kids.push(dxTable(besoinRows, COL_BES)); kids.push(dxSpacer());
  [LEVEL_TEST.evalEcrite, LEVEL_TEST.evalOrale].forEach(ev => {
    const rows = [new TableRow({ children: [dxCell(ev.titre, { span: 2, fill: HEADBG, bold: true, color: ACCENTC })] })];
    ev.fields.forEach(f => rows.push(new TableRow({ children: [dxCell(f[1], { width: PC(40), fill: LBLBG, bold: true }), dxCell(d[f[0]] || '', { width: PC(60), bold: f[0] === 'typeTestE' || f[0] === 'typeTestO' })] })));
    kids.push(dxTable(rows, COL_EVAL)); kids.push(dxSpacer());
  });
  const hf = docxHeaderFooter(user, ver);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 19, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
function buildLevelTestPdf(d, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const left = doc.page.margins.left, totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right, HB = '#f3e7e0', LB = '#f7eee9';
    pdfRows(doc, [{ cells: [{ text: LEVEL_TEST.title.toUpperCase(), w: totalW, align: 'center', bold: true, color: '#be6e54', size: 14, fill: HB }], minH: 26 }], left);
    doc.moveDown(0.4);
    const lw = totalW * 0.18, vw = totalW * 0.32;
    const headPdfRows = LEVEL_TEST.headerRows.map(row => ({ cells: row.reduce((acc, pair) => { acc.push({ text: pair ? pair[1] : '', w: lw, fill: pair ? LB : null, bold: !!pair, size: 8.5 }); acc.push({ text: pair ? (d[pair[0]] || '') : '', w: vw, size: 9 }); return acc; }, []) }));
    (d.extraHeader || []).forEach(ex => { if (ex && (ex.label || ex.value)) headPdfRows.push({ cells: [{ text: ex.label || '', w: lw, fill: LB, bold: true, size: 8.5 }, { text: ex.value || '', w: totalW - lw, size: 9 }] }); });
    pdfRows(doc, headPdfRows, left);
    doc.moveDown(0.4);
    pdfObjectifsRow(doc, left, totalW, LEVEL_TEST.textFields[0].label, d.objectifs || '', LB);
    pdfRows(doc, LEVEL_TEST.textFields.slice(1).map(f => ({ cells: [{ text: f.label, w: totalW * 0.5, fill: LB, bold: true, size: 8.5, valign: 'top' }, { text: d[f.id] || '', w: totalW * 0.5, size: 9, valign: 'top' }], minH: 26 })), left);
    doc.moveDown(0.4);
    doc.fillColor('#a8593c').font('Helvetica-Bold').fontSize(12).text('BESOINS', left, doc.y); doc.moveDown(0.2);
    const catW = totalW * 0.22, qW = totalW * 0.195, aW = totalW * 0.585;
    pdfBesoins(doc, LEVEL_TEST.besoins.map(b => ({ cat: b.cat, rows: b.items.map(it => ({ label: it.label, ans: d[it.id] || '', lw: qW, aw: aW })) })), left, catW, HB, LB);
    doc.moveDown(0.4);
    [LEVEL_TEST.evalEcrite, LEVEL_TEST.evalOrale].forEach(ev => {
      const rows = [{ cells: [{ text: ev.titre, w: totalW, fill: HB, bold: true, color: '#be6e54', size: 10 }], minH: 20 }];
      ev.fields.forEach(f => rows.push({ cells: [{ text: f[1], w: totalW * 0.4, fill: LB, bold: true, size: 9 }, { text: d[f[0]] || '', w: totalW * 0.6, size: 9, bold: f[0] === 'typeTestE' || f[0] === 'typeTestO' }] }));
      pdfRows(doc, rows, left); doc.moveDown(0.3);
    });
    pdfHeaderFooter(doc, user, ver); doc.end();
  });
}
app.get('/api/leveltest', auth, (req, res) => res.json({ tpl: LEVEL_TEST }));
app.post('/api/leveltest/generate', auth, async (req, res) => {
  const { group, fields, format } = req.body || {};
  const g = groupById(group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const ver = bumpVersion(g, 'leveltest');
  const d = fields || {};
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildLevelTestDocx(d, req.user, ver); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildLevelTestPdf(d, req.user, ver); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('leveltest:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'leveltest', title: LEVEL_TEST.title, format: ext === 'docx' ? 'word' : 'pdf', apprenant: d.prenom || d.nom || 'apprenant' });
  const name = (req.user.role === 'admin' ? '9' : '8') + ' - ' + safeFile(LEVEL_TEST.title) + ' - ' + safeFile(d.prenom || d.nom || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

// ---- Feuilles de présence (formateur + admin) : 3 types -------------------
const PRESENCE_TIMES = ['0:30', '1:00', '1:30', '2:00', '2:30', '3:00', '3:30', '4:00', '4:30', '5:00', '5:30', '6:00', '6:30', '7:00', '7:30', '8:00', '8:30', '9:00', '9:30', '10:00'];
const PRESENCE_GRID_HEADER = [['', 'chk', 6], ['', 'time', 7], ['Date', 'date', 12], ['Jour', 'jour', 11], ['H début', 'hDebut', 10], ['H fin', 'hFin', 10], ['Durée', 'duree', 10], ['Sign Formateur', 'sf', 17], ['Sign Apprenant', 'ss', 17]];
// data URL (png/jpeg) → buffer pour l'incrustation des signatures (pdfkit + docx)
function sigImg(d) { if (!d || typeof d !== 'string') return null; const m = d.match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/); if (!m) return null; try { return { buffer: Buffer.from(m[2], 'base64'), type: /jpe?g/.test(m[1]) ? 'jpg' : 'png' }; } catch (e) { return null; } }
const PRESENCE_TEMPLATES = {
  elearning: {
    title: 'Suivi assiduité — E-learning', docTitle: "SUIVI ASSIDUITÉ", kind: 'summary', signAdmin: true,
    headerRows: [
      [['mois', 'Mois'], ['langue', 'Langue']],
      [['formateur', 'Administratif'], ['formation', 'Formation']],
      [['apprenant', 'Apprenant'], ['debut', 'Début de la formation']],
      [['compte', 'Compte'], ['fin', 'Fin de la formation']],
      [['ref', 'Ref proposition'], ['lieu', 'Lieu']]
    ],
    summaryRows: [['heuresPrevues', "Nombre d'heures prévues"], ['heuresRealisees', "Nombre d'heures connexion réalisées"], ['dateRapport', 'Date du rapport']]
  },
  presentiel: {
    title: 'Feuille de présence — Présentiel-Distanciel', kind: 'grid',
    headerRows: [
      [['mois', 'Mois'], ['langue', 'Contrat langue']],
      [['formateur', 'Formateur'], ['formation', 'Formation']],
      [['apprenant', 'Apprenant'], ['dureePrevue', 'Durée prévue']],
      [['compte', 'Compte'], ['lieu', 'Lieu']],
      [['ref', 'Ref proposition'], ['ville', 'Ville']]
    ]
  },
  test: {
    title: 'Feuille de présence — Test', kind: 'grid', signAdmin: true,
    headerRows: [
      [['mois', 'Mois'], ['langue', 'Contrat langue']],
      [['formateur', 'Administratif'], ['formation', 'Formation']],
      [['apprenant', 'Apprenant'], ['dureePrevue', 'Durée prévue']],
      [['compte', 'Compte'], ['lieu', 'Lieu']],
      [['ref', 'Ref proposition'], ['ville', 'Ville']]
    ]
  }
};
// grille PDF : créneaux 0:30→10:00 (case à cocher) + colonnes séance (+ signatures par séance remplie)
function pdfPresenceGrid(doc, left, totalW, sessions, HB, sigF, sigA, signAdmin) {
  const W = {}; PRESENCE_GRID_HEADER.forEach(c => { W[c[1]] = totalW * c[2] / 100; });
  const rowH = 21;
  let y = doc.y, x = left;
  PRESENCE_GRID_HEADER.forEach(c => { pdfCell(doc, x, y, W[c[1]], rowH, (signAdmin && c[1] === 'sf') ? 'Sign administratif' : c[0], { fill: HB, bold: true, size: 8, align: 'center' }); x += W[c[1]]; });
  doc.y = y + rowH;
  const slotMap = {}; (sessions || []).forEach(s => { if (s && s.slot && PRESENCE_TIMES.indexOf(s.slot) >= 0) slotMap[s.slot] = s; });
  PRESENCE_TIMES.forEach((t, i) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) doc.addPage();
    y = doc.y; x = left; const s = slotMap[t] || {};
    const hasData = !!slotMap[t];
    pdfCell(doc, x, y, W.chk, rowH, '', {});
    const sq = 9, cx = x + (W.chk - sq) / 2, cy = y + (rowH - sq) / 2;
    if (hasData) doc.rect(cx, cy, sq, sq).fillColor('#be6e54').fill();
    doc.rect(cx, cy, sq, sq).lineWidth(0.8).strokeColor('#9a8b7e').stroke();
    x += W.chk;
    const vals = { time: t, date: s.date || '', jour: s.jour || '', hDebut: s.hDebut || '', hFin: s.hFin || '', duree: s.duree || '', sf: '', ss: '' };
    let sfX = 0, ssX = 0;
    ['time', 'date', 'jour', 'hDebut', 'hFin', 'duree', 'sf', 'ss'].forEach(k => { if (k === 'sf') sfX = x; if (k === 'ss') ssX = x; pdfCell(doc, x, y, W[k], rowH, vals[k], { size: 8, align: 'center', bold: k === 'time' }); x += W[k]; });
    if (hasData && signAdmin) pdfSignatureAntonin(doc, sfX + 3, y + 2, Math.min(W.sf - 6, (rowH - 4) / RATIO_SIGN));
    else if (hasData && sigF) { try { doc.image(sigF.buffer, sfX + 3, y + 2, { fit: [W.sf - 6, rowH - 4], align: 'center', valign: 'center' }); } catch (e) { } }
    if (hasData && sigA) { try { doc.image(sigA.buffer, ssX + 3, y + 2, { fit: [W.ss - 6, rowH - 4], align: 'center', valign: 'center' }); } catch (e) { } }
    doc.y = y + rowH;
  });
}
function buildPresencePdf(type, d, user, ver) {
  const tpl = PRESENCE_TEMPLATES[type];
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const left = doc.page.margins.left, totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right, HB = '#f3e7e0', LB = '#f7eee9';
    const sigF = sigImg(d.formateurSig), sigA = sigImg(d.apprenantSig);
    pdfRows(doc, [{ cells: [{ text: tpl.docTitle || 'FEUILLES DE PRÉSENCE', w: totalW, align: 'center', bold: true, color: '#be6e54', size: 14, fill: HB }], minH: 26 }], left);
    doc.moveDown(0.4);
    const lw = totalW * 0.16, vw = totalW * 0.34;
    pdfRows(doc, tpl.headerRows.map(row => ({ cells: row.reduce((acc, pair) => { acc.push({ text: pair ? pair[1] : '', w: lw, fill: pair ? LB : null, bold: !!pair, size: 8.5 }); acc.push({ text: pair ? (d[pair[0]] || '') : '', w: vw, size: 9 }); return acc; }, []) })), left);
    doc.moveDown(0.5);
    if (tpl.kind === 'summary') {
      pdfRows(doc, tpl.summaryRows.map(r => ({ cells: [{ text: r[1], w: totalW * 0.5, fill: LB, bold: true, size: 9 }, { text: d[r[0]] || '', w: totalW * 0.5, size: 9, bold: r[0] === 'heuresPrevues' }], minH: 22 })), left);
      doc.moveDown(0.8);
      const sigY = doc.y, valX = left + totalW * 0.32, valW = totalW * 0.68;
      pdfRows(doc, [
        { cells: [{ text: tpl.signAdmin ? 'Signature administratif' : 'Signature Formateur', w: totalW * 0.32, fill: LB, bold: true, size: 9, valign: 'top' }, { text: '', w: valW }], minH: 56 },
        { cells: [{ text: 'Signature Apprenant', w: totalW * 0.32, fill: LB, bold: true, size: 9, valign: 'top' }, { text: '', w: valW }], minH: 56 }
      ], left);
      // feuille administrative : la signature d'Antonin (sans tampon) remplace celle du formateur
      if (tpl.signAdmin) pdfSignatureAntonin(doc, valX + 10, sigY + 6, valW - 20, null, 44);
      else if (sigF) { try { doc.image(sigF.buffer, valX + 10, sigY + 6, { fit: [valW - 20, 44], align: 'center', valign: 'center' }); } catch (e) { } }
      if (sigA) { try { doc.image(sigA.buffer, valX + 10, sigY + 62, { fit: [valW - 20, 44], align: 'center', valign: 'center' }); } catch (e) { } }
    } else {
      pdfPresenceGrid(doc, left, totalW, d.sessions || [], HB, sigF, sigA, tpl.signAdmin);
    }
    pdfHeaderFooter(doc, user, ver); doc.end();
  });
}
function buildPresenceDocx(type, d, user, ver) {
  const tpl = PRESENCE_TEMPLATES[type];
  const PC = (s) => ({ size: s, type: WidthType.PERCENTAGE });
  const M = { top: 110, bottom: 110, left: 140, right: 140 };
  const sigF = sigImg(d.formateurSig), sigA = sigImg(d.apprenantSig);
  const sigCell = (sig, widthPC, w, h) => new TableCell({ width: PC(widthPC), borders: TBL_CELLBORDERS, verticalAlign: V_CENTER, margins: { top: 20, bottom: 20, left: 40, right: 40 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: sig ? [new ImageRun({ type: sig.type, data: sig.buffer, transformation: sigBox(sig, w, h) })] : [] })] });
  // case « signature administratif » : la signature d'Antonin (sans tampon), incrustée d'office
  // hauteur bornee pour que la signature ne deborde pas de sa case
  const adminSigCell = (widthPC, w, hMax) => new TableCell({ width: PC(widthPC), borders: TBL_CELLBORDERS, verticalAlign: V_CENTER, margins: { top: 20, bottom: 20, left: 40, right: 40 }, children: dxSignatureCell(w || 100, hMax).concat(dxSignatureCell(w || 100, hMax).length ? [] : [new Paragraph('')]) });
  const kids = [];
  kids.push(dxTable([new TableRow({ children: [dxCell(tpl.docTitle || 'FEUILLES DE PRÉSENCE', { align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 26, fill: HEADBG, margins: M })] })], [9026]));
  kids.push(dxGap());
  const Lc = (t) => dxCell(t, { width: PC(16), fill: LBLBG, bold: true, size: 18, margins: M }), Vc = (t) => dxCell(t || '', { width: PC(34), size: 18, margins: M });
  kids.push(dxTable(tpl.headerRows.map(row => new TableRow({ children: row.reduce((acc, pair) => { acc.push(pair ? Lc(pair[1]) : dxCell('', { width: PC(16), margins: M })); acc.push(pair ? Vc(d[pair[0]]) : dxCell('', { width: PC(34), margins: M })); return acc; }, []) })), dxCols([16, 34, 16, 34])));
  kids.push(dxGap());
  if (tpl.kind === 'summary') {
    kids.push(dxTable(tpl.summaryRows.map(r => new TableRow({ children: [dxCell(r[1], { width: PC(50), fill: LBLBG, bold: true, size: 18, margins: M }), dxCell(d[r[0]] || '', { width: PC(50), bold: r[0] === 'heuresPrevues', size: 18, margins: M })] })), dxCols([1, 1])));
    kids.push(dxGap(240));
    // les deux signatures dans UN SEUL tableau, comme le PDF : deux tableaux séparés par un
    // espaceur laissaient une coupure au milieu du bloc
    kids.push(dxTable([
      dxRowMin([dxCell(tpl.signAdmin ? 'Signature administratif' : 'Signature Formateur', { width: PC(32), fill: LBLBG, bold: true, valign: VerticalAlign ? VerticalAlign.TOP : 'top', size: 18, margins: M }), tpl.signAdmin ? adminSigCell(68, 64, 46) : sigCell(sigF, 68, 150, 49)], 900),
      dxRowMin([dxCell('Signature Apprenant', { width: PC(32), fill: LBLBG, bold: true, valign: VerticalAlign ? VerticalAlign.TOP : 'top', size: 18, margins: M }), sigCell(sigA, 68, 150, 49)], 900)
    ], dxCols([32, 68])));
  } else {
    // ⚠️ « Sign administratif » sur les feuilles signées par l'administration (e-learning, Test) :
    // le PDF le fait déjà (pdfPresenceGrid), le Word affichait « Sign Formateur » à tort.
    const rows = [new TableRow({ tableHeader: true, children: PRESENCE_GRID_HEADER.map(c => dxCell((tpl.signAdmin && c[1] === 'sf') ? 'Sign administratif' : c[0], { width: PC(c[2]), fill: HEADBG, bold: true, align: AlignmentType.CENTER, size: 16, margins: { top: 60, bottom: 60, left: 40, right: 40 } })) })];
    const slotMap = {}; (d.sessions || []).forEach(s => { if (s && s.slot && PRESENCE_TIMES.indexOf(s.slot) >= 0) slotMap[s.slot] = s; });
    PRESENCE_TIMES.forEach((t) => {
      const s = slotMap[t] || {}; const hasData = !!slotMap[t];
      const vals = { chk: hasData ? '✗' : '', time: t, date: s.date || '', jour: s.jour || '', hDebut: s.hDebut || '', hFin: s.hFin || '', duree: s.duree || '', sf: '', ss: '' };
      rows.push(dxRowMin(PRESENCE_GRID_HEADER.map(c => {
        if (c[1] === 'sf' && hasData && tpl.signAdmin) return adminSigCell(c[2], 46, 17);
        if ((c[1] === 'sf' || c[1] === 'ss') && hasData) return sigCell(c[1] === 'sf' ? sigF : sigA, c[2], 52, 17);
        // le PDF dessine un carré contouré sur les 20 lignes, rempli quand le créneau est pris
        if (c[1] === 'chk') return dxCell(hasData ? '■' : '☐', { width: PC(c[2]), align: AlignmentType.CENTER, bold: true, color: hasData ? ACCENTC : '9a8b7c', size: 20, margins: { top: 40, bottom: 40, left: 20, right: 20 } });
        return dxCell(vals[c[1]], { width: PC(c[2]), align: AlignmentType.CENTER, bold: c[1] === 'time', size: c[1] === 'time' ? 18 : 17, margins: { top: 40, bottom: 40, left: 40, right: 40 } });
      }), 420));
    });
    // largeurs de la grille reprises telles quelles du PDF (colonne 3 de PRESENCE_GRID_HEADER)
    kids.push(dxTable(rows, dxCols(PRESENCE_GRID_HEADER.map(c => c[2]))));
  }
  const hf = docxHeaderFooter(user, ver);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 19, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
app.get('/api/presence', auth, (req, res) => res.json({ templates: PRESENCE_TEMPLATES }));
app.post('/api/presence/generate', auth, async (req, res) => {
  const { group, type, fields, format } = req.body || {};
  const tpl = PRESENCE_TEMPLATES[type];
  const g = groupById(group);
  if (!tpl) return res.status(400).json({ error: 'Type de feuille inconnu.' });
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const ver = bumpVersion(g, 'presence-' + type);
  const d = fields || {};
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildPresenceDocx(type, d, req.user, ver); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildPresencePdf(type, d, req.user, ver); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('presence:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'presence', title: tpl.title, format: ext === 'docx' ? 'word' : 'pdf', apprenant: d.apprenant || 'apprenant' });
  const name = (req.user.role === 'admin' ? '10' : '9') + ' - ' + safeFile(tpl.title) + ' - ' + safeFile(d.apprenant || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

// ---- Feuilles de présence : flux de signatures (formateur signe → apprenant signe → dépôt) ----
async function depositPresenceDoc(p, byUser) {
  const tpl = PRESENCE_TEMPLATES[p.type] || {};
  const d = Object.assign({}, p.fields, { formateurSig: p.formateurSig, apprenantSig: p.apprenantSig });
  const ver = bumpVersion(groupById(p.group), 'presence-' + p.type);
  const buf = await buildPresencePdf(p.type, d, byUser, ver);
  const stored = crypto.randomUUID() + '.pdf';
  fs.writeFileSync(path.join(UPLOADS_DIR, stored), buf);
  const name = safeFile(tpl.title || 'Feuille de présence') + ' - ' + safeFile((p.fields && p.fields.apprenant) || 'apprenant') + ' - ' + nameDate() + ' - signée.pdf';
  // version retenue sur la pièce : la régénérer en Word ne doit pas la faire avancer
  const doc = { id: crypto.randomUUID(), group: p.group, channel: 'commun', from: byUser.id, fromAdmin: byUser.role === 'admin', name, size: buf.length, type: 'application/pdf', stored, date: Date.now(), ver };
  db.docs.push(doc);
  return doc;
}
// Deux séances placées sur le MÊME créneau : la seconde écrase la première dans la grille
// (slotMap), et une séance saisie par le formateur disparaît en silence du document signé.
// On refuse l'envoi en nommant le créneau fautif.
function duplicateSlot(fields) {
  const ss = (fields && fields.sessions) || [];
  const seen = new Set();
  for (const s of ss) {
    if (!s || !s.slot) continue;
    if (seen.has(s.slot)) return s.slot;
    seen.add(s.slot);
  }
  return null;
}
// le formateur (ou admin) remplit, signe, puis envoie à l'apprenant pour signature
app.post('/api/presence/send', auth, (req, res) => {
  const { group, type, fields, formateurSig } = req.body || {};
  const tpl = PRESENCE_TEMPLATES[type];
  const g = groupById(group);
  if (!tpl) return res.status(400).json({ error: 'Type de feuille inconnu.' });
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  // feuilles administratives : la signature d'Antonin est apposée d'office, le formateur ne signe pas
  if (!tpl.signAdmin && !sigImg(formateurSig)) return res.status(400).json({ error: 'Signature du formateur manquante.' });
  const dupS = duplicateSlot(fields);
  if (dupS) return res.status(400).json({ error: 'Deux séances utilisent le créneau ' + dupS + '. Chaque séance doit avoir un créneau différent.' });
  if (!g.eleve) return res.status(400).json({ error: 'Ce dossier ne compte aucun apprenant.' });
  const p = { id: crypto.randomUUID(), group: g.id, type, fields: fields || {}, formateurSig, apprenantSig: null, status: 'pending', docId: null, by: req.user.id, date: Date.now() };
  db.presences.push(p);
  db.messages.push({ id: crypto.randomUUID(), group: g.id, channel: 'commun', from: req.user.id, fromAdmin: req.user.role === 'admin', kind: 'presence', presenceId: p.id, text: 'Feuille de présence à signer : ' + tpl.title, date: Date.now() });
  notify(g.eleve, `${senderDisplay(req.user)} vous demande de signer une feuille de présence (${tpl.title}).`, g.id);
  db.users.filter(u => u.role === 'admin' && u.id !== req.user.id).forEach(a => notify(a.id, `${senderDisplay(req.user)} a envoyé une feuille de présence à signer (${tpl.title}).`, g.id));
  // e-mail à l'apprenant : un document l'attend pour signature
  const eleveU = realUser(g.eleve);
  if (eleveU) {
    const url = SITE_URL + '/espace-documents.html';
    // ⚠️ le mois ne figure NI dans l'objet NI dans le corps (demande de l'utilisateur, 04/08/2026) :
    // le document lui-même le porte, le répéter dans l'e-mail alourdissait l'objet pour rien.
    const objet = 'Feuille de présence à signer — Languages & Success';
    const ligne = senderDisplay(req.user) + ' vous a envoyé une feuille de présence à signer (' + tpl.title + ').';
    sendMailSafe(eleveU.email, objet,
      'Bonjour ' + eleveU.prenom + ',\n\n' + ligne + '\n\nConnectez-vous à votre espace documents pour la signer :\n' + url + '\n\nLanguages & Success',
      mailHtml('Un document à signer vous attend',
        ['Bonjour ' + eleveU.prenom + ',', ligne, 'Connectez-vous à votre espace documents pour la signer.'],
        'Signer le document', url));
  }
  save();
  res.json({ ok: true, id: p.id });
});
// statut d'une feuille (pour l'apprenant)
app.get('/api/presence/:id', auth, (req, res) => {
  const p = db.presences.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Feuille introuvable.' });
  if (!isMember(groupById(p.group), req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  // `fields` est renvoyé à tous les membres : c'est le contenu que l'apprenant doit pouvoir
  // RELIRE avant de signer. La signature manuscrite du formateur, elle, reste réservée à son
  // auteur et à l'administration (elle ne sort qu'incrustée dans le PDF final).
  const out = { id: p.id, type: p.type, title: (PRESENCE_TEMPLATES[p.type] || {}).title, status: p.status, docId: p.docId, fields: p.fields || {} };
  if (req.user.id === p.by || req.user.role === 'admin') out.formateurSig = p.formateurSig || null;
  res.json({ presence: out });
});
// mise à jour d'une feuille EN ATTENTE par son envoyeur (« Modifier ») : on conserve l'id,
// le message du chat et la demande en cours — rien n'est détruit, l'apprenant n'est pas
// re-sollicité par un second e-mail.
app.post('/api/presence/:id/update', auth, (req, res) => {
  const p = db.presences.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Feuille introuvable.' });
  if (p.status === 'done') return res.status(400).json({ error: 'Feuille déjà signée : modification impossible.' });
  if (req.user.id !== p.by && req.user.role !== 'admin') return res.status(403).json({ error: 'Seul l\'envoyeur peut modifier cette feuille.' });
  const { type, fields, formateurSig } = req.body || {};
  const tpl = PRESENCE_TEMPLATES[type || p.type];
  if (!tpl) return res.status(400).json({ error: 'Type de feuille inconnu.' });
  const dup = duplicateSlot(fields);
  if (dup) return res.status(400).json({ error: 'Deux séances utilisent le créneau ' + dup + '. Chaque séance doit avoir un créneau différent.' });
  p.type = type || p.type;
  p.fields = fields || {};
  if (formateurSig && sigImg(formateurSig)) p.formateurSig = formateurSig; // sinon on garde l'existante
  const g = groupById(p.group);
  const msg = db.messages.find(m => m.kind === 'presence' && m.presenceId === p.id);
  if (msg) msg.text = 'Feuille de présence à signer : ' + tpl.title;
  if (g) notify(g.eleve, `${senderDisplay(req.user)} a mis à jour la feuille de présence à signer.`, g.id);
  save();
  res.json({ ok: true, id: p.id });
});
// l'apprenant signe → génère le doc final (2 signatures) et le dépose dans le canal commun
app.post('/api/presence/:id/sign', auth, async (req, res) => {
  const p = db.presences.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Feuille introuvable.' });
  const g = groupById(p.group);
  if (!isMember(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  // c'est l'APPRENANT du dossier qui atteste sa présence : ni le formateur, ni un admin
  // ne peuvent signer à sa place (la feuille est une pièce justificative Qualiopi).
  if (req.user.id !== g.eleve) return res.status(403).json({ error: 'Seul l\'apprenant peut signer cette feuille de présence.' });
  if (p.status === 'done') return res.status(400).json({ error: 'Feuille déjà signée.' });
  const sig = (req.body || {}).sig;
  if (!sigImg(sig)) return res.status(400).json({ error: 'Signature manquante.' });
  const byUser = db.users.find(u => u.id === p.by) || req.user;
  // on GÉNÈRE D'ABORD (sur une copie), on ne bascule l'état qu'ensuite : si la génération
  // échoue, la feuille reste signable au lieu de rester bloquée en « signée » sans document.
  let doc;
  try { doc = await depositPresenceDoc(Object.assign({}, p, { apprenantSig: sig }), byUser); }
  catch (e) { console.error('presence sign:', e); return res.status(500).json({ error: 'Erreur de génération du document. La feuille reste à signer, réessayez.' }); }
  p.apprenantSig = sig; p.status = 'done'; p.signedBy = req.user.id; p.signedAt = Date.now();
  p.docId = doc.id;
  recordDocgen(g, byUser, { kind: 'presence', tpl: 'presence', title: (PRESENCE_TEMPLATES[p.type] || {}).title, format: 'pdf', apprenant: (p.fields && p.fields.apprenant) || 'apprenant' });
  notifyChannel(g, 'commun', req.user, `${senderDisplay(req.user)} a signé la feuille de présence — document déposé dans le dossier.`);
  // e-mail au formateur (l'envoyeur) : le document signé est prêt
  if (byUser && byUser.id !== req.user.id) {
    const urlS = SITE_URL + '/espace-documents.html';
    const tplTitle = (PRESENCE_TEMPLATES[p.type] || {}).title || 'Feuille de présence';
    sendMailSafe(byUser.email,
      'Document signé par ' + senderDisplay(req.user) + ' — Languages & Success',
      'Bonjour ' + byUser.prenom + ',\n\n' + senderDisplay(req.user) + ' a signé la feuille de présence (' + tplTitle + ').\nLe document final avec les deux signatures est disponible sur votre espace documents.\n\n' + urlS + '\n\nLanguages & Success',
      mailHtml('Le document est signé ✓',
        ['Bonjour ' + byUser.prenom + ',', senderDisplay(req.user) + ' a signé la feuille de présence (' + tplTitle + ').', 'Le document final avec les deux signatures est disponible sur votre espace documents.'],
        'Voir le document', urlS));
  }
  save();
  res.json({ ok: true, doc: docPub(doc) });
});
// l'envoyeur (ou un admin) annule une feuille de présence en attente, tant que l'apprenant n'a pas signé
app.post('/api/presence/:id/cancel', auth, (req, res) => {
  const p = db.presences.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Feuille introuvable.' });
  if (req.user.id !== p.by && req.user.role !== 'admin') return res.status(403).json({ error: 'Seul l\'envoyeur peut annuler.' });
  if (p.status === 'done') return res.status(400).json({ error: 'Déjà signée par l\'apprenant : annulation impossible.' });
  const g = groupById(p.group);
  db.presences = db.presences.filter(x => x.id !== p.id);
  db.messages = db.messages.filter(m => !(m.kind === 'presence' && m.presenceId === p.id));
  if (g) notify(g.eleve, `${senderDisplay(req.user)} a annulé une demande de signature.`, g.id);
  save();
  res.json({ ok: true });
});

// ---- ATTESTATION DE FIN DE STAGE : circuit de signature ---------------------
// (05/08/2026) Le formateur remplit et signe, l'apprenant relit et signe, le PDF final se dépose
// dans le canal commun. La génération directe a été RETIRÉE : l'attestation ne s'obtient plus
// que signée des deux parties (décision de l'utilisateur).
// ⚠️ Même ordre que la feuille de présence : on génère AVANT de basculer l'état, sinon un échec
// laisserait une attestation « signée » sans document et non re-signable.
async function depositAttestationDoc(a, byUser) {
  const d = Object.assign({}, a.fields, { formateurSig: a.formateurSig, apprenantSig: a.apprenantSig });
  const ver = bumpVersion(groupById(a.group), 'attestation');
  const buf = await buildAttestationPdf(d, byUser, ver);
  const stored = crypto.randomUUID() + '.pdf';
  fs.writeFileSync(path.join(UPLOADS_DIR, stored), buf);
  const name = '4 - ' + safeFile('Attestation de fin de formation') + ' - ' + safeFile((a.fields && a.fields.apprenant) || 'apprenant') + ' - ' + nameDate() + ' - signée.pdf';
  const doc = { id: crypto.randomUUID(), group: a.group, channel: 'commun', from: byUser.id, fromAdmin: byUser.role === 'admin', name, size: buf.length, type: 'application/pdf', stored, date: Date.now(), ver };
  db.docs.push(doc);
  return doc;
}
app.post('/api/attestation/send', auth, (req, res) => {
  const { group, fields, formateurSig } = req.body || {};
  const g = groupById(group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  if (!sigImg(formateurSig)) return res.status(400).json({ error: 'Signature du formateur manquante.' });
  if (!g.eleve) return res.status(400).json({ error: 'Ce dossier ne compte aucun apprenant.' });
  const a = { id: crypto.randomUUID(), group: g.id, fields: fields || {}, formateurSig, apprenantSig: null, status: 'pending', docId: null, by: req.user.id, date: Date.now() };
  db.attestations.push(a);
  db.messages.push({ id: crypto.randomUUID(), group: g.id, channel: 'commun', from: req.user.id, fromAdmin: req.user.role === 'admin', kind: 'attestation', attestationId: a.id, text: 'Attestation de fin de formation à signer', date: Date.now() });
  notify(g.eleve, `${senderDisplay(req.user)} vous demande de signer votre attestation de fin de formation.`, g.id);
  db.users.filter(u => u.role === 'admin' && u.id !== req.user.id).forEach(x => notify(x.id, `${senderDisplay(req.user)} a envoyé une attestation de fin de formation à signer.`, g.id));
  const eleveU = realUser(g.eleve);
  if (eleveU) {
    const url = SITE_URL + '/espace-documents.html';
    const ligne = senderDisplay(req.user) + ' vous a envoyé votre attestation de fin de formation à signer.';
    sendMailSafe(eleveU.email, 'Attestation de fin de formation à signer — Languages & Success',
      'Bonjour ' + eleveU.prenom + ',\n\n' + ligne + '\n\nConnectez-vous à votre espace documents pour la relire et la signer :\n' + url + '\n\nLanguages & Success',
      mailHtml('Un document à signer vous attend',
        ['Bonjour ' + eleveU.prenom + ',', ligne, 'Connectez-vous à votre espace documents pour la relire et la signer.'],
        'Signer le document', url));
  }
  save();
  res.json({ ok: true, id: a.id });
});
app.get('/api/attestation/:id', auth, (req, res) => {
  const a = db.attestations.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Attestation introuvable.' });
  if (!isMember(groupById(a.group), req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  // les champs sont lisibles par tous les membres : c'est ce que l'apprenant doit RELIRE avant de
  // signer. La signature manuscrite du formateur reste réservée à son auteur et à l'administration.
  const out = { id: a.id, title: 'Attestation de fin de formation', status: a.status, docId: a.docId, fields: a.fields || {} };
  if (req.user.id === a.by || req.user.role === 'admin') out.formateurSig = a.formateurSig || null;
  res.json({ attestation: out });
});
app.post('/api/attestation/:id/update', auth, (req, res) => {
  const a = db.attestations.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Attestation introuvable.' });
  if (req.user.id !== a.by && req.user.role !== 'admin') return res.status(403).json({ error: 'Seul l\'envoyeur peut modifier.' });
  if (a.status === 'done') return res.status(400).json({ error: 'Déjà signée : modification impossible.' });
  const { fields, formateurSig } = req.body || {};
  if (fields) a.fields = fields;
  if (formateurSig && sigImg(formateurSig)) a.formateurSig = formateurSig;   // sinon on garde l'existante
  const g = groupById(a.group);
  if (g) notify(g.eleve, `${senderDisplay(req.user)} a mis à jour l'attestation à signer.`, g.id);
  save();
  res.json({ ok: true, id: a.id });
});
app.post('/api/attestation/:id/sign', auth, async (req, res) => {
  const a = db.attestations.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Attestation introuvable.' });
  const g = groupById(a.group);
  if (!isMember(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  // c'est l'APPRENANT qui atteste avoir suivi la formation : personne ne signe à sa place
  if (req.user.id !== g.eleve) return res.status(403).json({ error: 'Seul l\'apprenant peut signer son attestation.' });
  if (a.status === 'done') return res.status(400).json({ error: 'Attestation déjà signée.' });
  const sig = (req.body || {}).sig;
  if (!sigImg(sig)) return res.status(400).json({ error: 'Signature manquante.' });
  const byUser = db.users.find(u => u.id === a.by) || req.user;
  let doc;
  try { doc = await depositAttestationDoc(Object.assign({}, a, { apprenantSig: sig }), byUser); }
  catch (e) { console.error('attestation sign:', e); return res.status(500).json({ error: 'Erreur de génération du document. L\'attestation reste à signer, réessayez.' }); }
  a.apprenantSig = sig; a.status = 'done'; a.signedBy = req.user.id; a.signedAt = Date.now(); a.docId = doc.id;
  recordDocgen(g, byUser, { kind: 'attestation', tpl: 'attestation', title: 'Attestation de fin de formation', format: 'pdf', apprenant: (a.fields && a.fields.apprenant) || 'apprenant' });
  notifyChannel(g, 'commun', req.user, `${senderDisplay(req.user)} a signé son attestation de fin de formation — document déposé dans le dossier.`);
  if (byUser && byUser.id !== req.user.id) {
    const urlS = SITE_URL + '/espace-documents.html';
    sendMailSafe(byUser.email, 'Document signé par ' + senderDisplay(req.user) + ' — Languages & Success',
      'Bonjour ' + byUser.prenom + ',\n\n' + senderDisplay(req.user) + " a signé l'attestation de fin de formation.\nLe document final avec les signatures est disponible sur votre espace documents.\n\n" + urlS + '\n\nLanguages & Success',
      mailHtml('Le document est signé ✓',
        ['Bonjour ' + byUser.prenom + ',', senderDisplay(req.user) + " a signé l'attestation de fin de formation.", 'Le document final avec les signatures est disponible sur votre espace documents.'],
        'Voir le document', urlS));
  }
  save();
  res.json({ ok: true, doc: docPub(doc) });
});
app.post('/api/attestation/:id/cancel', auth, (req, res) => {
  const a = db.attestations.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Attestation introuvable.' });
  if (req.user.id !== a.by && req.user.role !== 'admin') return res.status(403).json({ error: 'Seul l\'envoyeur peut annuler.' });
  if (a.status === 'done') return res.status(400).json({ error: 'Déjà signée : annulation impossible.' });
  const g = groupById(a.group);
  db.attestations = db.attestations.filter(x => x.id !== a.id);
  db.messages = db.messages.filter(m => !(m.kind === 'attestation' && m.attestationId === a.id));
  if (g) notify(g.eleve, `${senderDisplay(req.user)} a annulé une demande de signature.`, g.id);
  save();
  res.json({ ok: true });
});

// ---- CONTRAT DE SOUS-TRAITANCE : circuit de signature -----------------------
// (05/08/2026) L'administration envoie le contrat au formateur, qui le relit sur le site et le
// signe. ⚠️ TOUT SE PASSE DANS LE CANAL PRIVÉ : le contrat porte la rémunération du formateur et
// son SIRET, l'apprenant ne doit ni le voir ni être notifié.
// ⚠️ La référence est FIGÉE à l'envoi : newContratRef() consomme un numéro à chaque appel, la
// régénérer à la signature donnerait deux références pour un même contrat.
async function depositContratDoc(c, adminUser) {
  const d = Object.assign({}, c.fields, { sousTraitantSig: c.profSig });
  const ver = bumpVersion(groupById(c.group), 'contrat');
  const buf = await buildContratPdf(d, adminUser, ver);
  const stored = crypto.randomUUID() + '.pdf';
  fs.writeFileSync(path.join(UPLOADS_DIR, stored), buf);
  const name = '7 - ' + safeFile('Contrat de sous-traitance') + ' - ' + safeFile((c.fields && c.fields.stnom) || 'formateur') + ' - ' + nameDate() + ' - signé.pdf';
  const doc = { id: crypto.randomUUID(), group: c.group, channel: 'prive', from: adminUser.id, fromAdmin: true, name, size: buf.length, type: 'application/pdf', stored, date: Date.now(), ver };
  db.docs.push(doc);
  return doc;
}
app.post('/api/contrat/send', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const { group, fields, prof } = req.body || {};
  const g = groupById(group);
  if (!g) return res.status(404).json({ error: 'Dossier introuvable.' });
  // ⚠️ le signataire est un IDENTIFIANT vérifié contre le dossier, pas le nom libre saisi dans le
  // formulaire : sans ça un contrat pourrait partir au nom de quelqu'un qui n'est pas du dossier.
  const cibP = targetProf(g, prof, req.user);
  if (!cibP || cibP.error || !cibP.id) return res.status(400).json({ error: (cibP && cibP.error) || 'Précisez le formateur concerné.' });
  const f = (fields || {});
  const c = { id: crypto.randomUUID(), group: g.id, prof: cibP.id, fields: Object.assign({}, f, { ref: f.ref || newContratRef() }), profSig: null, status: 'pending', docId: null, by: req.user.id, date: Date.now() };
  c.ref = c.fields.ref;
  db.contrats.push(c);
  db.messages.push({ id: crypto.randomUUID(), group: g.id, channel: 'prive', from: req.user.id, fromAdmin: true, kind: 'contrat', contratId: c.id, text: 'Contrat de sous-traitance à signer', date: Date.now() });
  notify(cibP.id, `${senderDisplay(req.user)} vous a envoyé un contrat de sous-traitance à signer.`, g.id);
  db.users.filter(u => u.role === 'admin' && u.id !== req.user.id).forEach(x => notify(x.id, `${senderDisplay(req.user)} a envoyé un contrat de sous-traitance à ${fullName(cibP.id)}.`, g.id));
  const profU = realUser(cibP.id);
  if (profU) {
    const url = SITE_URL + '/espace-documents.html';
    const ligne = "L'administration vous a envoyé un contrat de sous-traitance. Relisez-le sur votre espace documents : vous pourrez le signer directement en ligne.";
    sendMailSafe(profU.email, 'Contrat de sous-traitance à signer — Languages & Success',
      'Bonjour ' + profU.prenom + ',\n\n' + ligne + '\n\n' + url + '\n\nLanguages & Success',
      mailHtml('Un contrat à relire et à signer',
        ['Bonjour ' + profU.prenom + ',', ligne],
        'Ouvrir le contrat', url));
  }
  save();
  res.json({ ok: true, id: c.id });
});
app.get('/api/contrat/:id', auth, (req, res) => {
  const c = db.contrats.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Contrat introuvable.' });
  // ⚠️ canChannel 'prive' et non isMember : l'apprenant est membre du dossier mais n'a AUCUN
  // accès au canal privé, donc aucun droit de lire ce contrat.
  if (!canChannel(groupById(c.group), req.user, 'prive')) return res.status(403).json({ error: 'Accès refusé.' });
  res.json({ contrat: { id: c.id, title: 'Contrat de sous-traitance', status: c.status, docId: c.docId, prof: c.prof, ref: c.ref || '', fields: c.fields || {} } });
});
// aperçu du contrat AVANT signature : le formateur doit pouvoir lire ce qu'il signe.
// ⚠️ jeton en query (userDepuisRequete) et non middleware auth : le lien est un <a href>, qui
// ne peut pas porter d'en-tête Authorization.
app.get('/api/contrat/:id/apercu', async (req, res) => {
  const u = userDepuisRequete(req);
  if (!u) return res.status(401).json({ error: 'Non authentifié.' });
  const c = db.contrats.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Contrat introuvable.' });
  if (!canChannel(groupById(c.group), u, 'prive')) return res.status(403).json({ error: 'Accès refusé.' });
  try {
    // verOf et non bumpVersion : relire un contrat ne doit pas faire avancer sa version
    const buf = await buildContratPdf(Object.assign({}, c.fields, { sousTraitantSig: c.profSig }), u, verOf(groupById(c.group), 'contrat'));
    const name = safeFile('Contrat de sous-traitance') + ' - ' + safeFile((c.fields && c.fields.stnom) || 'formateur') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', "inline; filename*=UTF-8''" + encodeURIComponent(name));
    res.send(buf);
  } catch (e) { console.error('contrat apercu:', e); res.status(500).json({ error: 'Erreur de génération.' }); }
});
app.post('/api/contrat/:id/sign', auth, async (req, res) => {
  const c = db.contrats.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Contrat introuvable.' });
  const g = groupById(c.group);
  // ⚠️ SEUL le formateur désigné signe : ni un autre formateur du dossier, ni l'administration.
  // Un contrat est un engagement personnel, on ne signe pas à la place de quelqu'un.
  if (req.user.id !== c.prof) return res.status(403).json({ error: 'Seul le formateur concerné peut signer ce contrat.' });
  if (c.status === 'done') return res.status(400).json({ error: 'Contrat déjà signé.' });
  const sig = (req.body || {}).sig;
  if (!sigImg(sig)) return res.status(400).json({ error: 'Signature manquante.' });
  const adminU = db.users.find(u => u.id === c.by) || req.user;
  let doc;
  try { doc = await depositContratDoc(Object.assign({}, c, { profSig: sig }), adminU); }
  catch (e) { console.error('contrat sign:', e); return res.status(500).json({ error: 'Erreur de génération du document. Le contrat reste à signer, réessayez.' }); }
  c.profSig = sig; c.status = 'done'; c.signedAt = Date.now(); c.docId = doc.id;
  recordDocgen(g, adminU, { kind: 'contrat', tpl: 'contrat', title: 'Contrat de sous-traitance', format: 'pdf', apprenant: (c.fields && c.fields.stnom) || 'formateur' });
  // ⚠️ canal PRIVÉ : notifyChannel n'y prévient que les formateurs du dossier et les admins.
  notifyChannel(g, 'prive', req.user, `${senderDisplay(req.user)} a signé le contrat de sous-traitance — document déposé dans le canal privé.`);
  if (adminU && adminU.id !== req.user.id) {
    const urlS = SITE_URL + '/espace-documents.html';
    sendMailSafe(adminU.email, 'Contrat signé par ' + senderDisplay(req.user) + ' — Languages & Success',
      'Bonjour ' + adminU.prenom + ',\n\n' + senderDisplay(req.user) + ' a signé le contrat de sous-traitance.\nLe document final est déposé dans le canal privé du dossier.\n\n' + urlS + '\n\nLanguages & Success',
      mailHtml('Le contrat est signé ✓',
        ['Bonjour ' + adminU.prenom + ',', senderDisplay(req.user) + ' a signé le contrat de sous-traitance.', 'Le document final est déposé dans le canal privé du dossier.'],
        'Voir le document', urlS));
  }
  save();
  res.json({ ok: true, doc: docPub(doc) });
});
app.post('/api/contrat/:id/cancel', auth, (req, res) => {
  const c = db.contrats.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Contrat introuvable.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  if (c.status === 'done') return res.status(400).json({ error: 'Déjà signé : annulation impossible.' });
  db.contrats = db.contrats.filter(x => x.id !== c.id);
  db.messages = db.messages.filter(m => !(m.kind === 'contrat' && m.contratId === c.id));
  notify(c.prof, `${senderDisplay(req.user)} a annulé la demande de signature du contrat.`, c.group);
  save();
  res.json({ ok: true });
});

// comptes démo (email + mot de passe affichés sur la page de connexion)
// ⚠️ GET /api/demo-accounts EST SUPPRIMÉE (05/08/2026, demande de l'utilisateur). Ouverte à tous
// sans authentification, elle distribuait l'adresse ET le mot de passe en clair des comptes de
// démonstration. L'encart de connexion rapide qui la consommait est parti avec elle : ne pas la
// réintroduire. Les comptes démo restent seedés pour les essais, mais plus rien ne les annonce.

// ---- test d'envoi (admin) --------------------------------------------------
// Vérifier la configuration SMTP sans attendre qu'un vrai flux se déclenche. Contrairement à
// sendMailSafe, qui n'échoue jamais bruyamment, cette route ATTEND le résultat et le renvoie :
// c'est tout l'intérêt d'un test.
app.post('/api/admin/mail-test', auth, async (req, res) => {
  if (!adminSeul(req, res)) return;
  const to = ((req.body || {}).to || '').trim();
  if (!to || !/@/.test(to)) return res.status(400).json({ error: 'Adresse destinataire manquante.' });
  if (!mailer) return res.status(400).json({ error: 'E-mails désactivés : aucune configuration SMTP.' });
  const lignes = [
    'Ceci est un test d\'envoi déclenché depuis l\'espace documents.',
    'Il vérifie que les e-mails du site partent bien de nepasrepondre@languagesandsuccess.com, et que le gabarit s\'affiche correctement.',
    'Aucune action n\'est attendue de votre part.'
  ];
  // ⚠️ on passe par composerMail, exactement comme les flux réels : sans cela le test ne
  // vérifierait que lui-même, et une mention manquante dans les vrais e-mails passerait au travers.
  const msg = composerMail(to, 'Test d\'envoi automatique — Languages & Success',
    lignes.join('\n\n'), mailHtml('Test d\'envoi', lignes, null, null));
  try {
    const info = await mailer.sendMail(msg);
    console.log('✉ test envoyé à ' + to + ' (' + (info.messageId || '') + ')');
    res.json({ ok: true, expediteur: MAIL.from, destinataire: to, accepte: info.accepted, refuse: info.rejected, reponse: info.response });
  } catch (e) {
    console.error('✉ ÉCHEC du test vers ' + to + ' :', e.message);
    res.status(502).json({ error: e.message, expediteur: MAIL.from, code: e.code, commande: e.command });
  }
});

// ---- formulaires publics du site vitrine : contact + test de niveau ---------
// (19/08/2026) Jusqu'ici les deux formulaires n'envoyaient RIEN : le message « votre demande a
// bien été prise en compte » s'affichait sans qu'aucune donnée ne parte nulle part.
// Désormais : contact → Slack #contact + e-mail à contact@ ; test → Slack #contact (repli
// e-mail). ⚠️ La route ne répond « ok » que si AU MOINS UN canal a réellement accepté l'envoi :
// répondre « merci » quand tout a échoué serait exactement le défaut d'origine.

// Webhook entrant Slack du canal #contact. ⚠️ L'URL d'un webhook vaut un SECRET (quiconque la
// connaît peut poster dans le canal) : config HORS Git — data/slack.json {webhook} en local,
// variable SLACK_WEBHOOK en production (via l'ENV_FILE). Sans config → désactivé proprement.
// Deux modes, au choix : un webhook entrant {webhook}, OU le jeton du robot de l'application
// Slack créée par l'utilisateur {token, channel} (scope chat:write vérifié le 19/08/2026).
// ⚠️ En mode jeton, le robot doit être MEMBRE du canal : « /invite @claude » dans #contact,
// sinon Slack répond not_in_channel et le repli e-mail prend le relais.
function slackConfig() {
  if (process.env.SLACK_WEBHOOK) return { webhook: process.env.SLACK_WEBHOOK };
  if (process.env.SLACK_TOKEN) return { token: process.env.SLACK_TOKEN, channel: process.env.SLACK_CHANNEL || 'C0BRDPD17C4' };
  try {
    let t = fs.readFileSync(path.join(DATA_DIR, 'slack.json'), 'utf8');
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);   // BOM des fichiers créés sous Windows
    const c = JSON.parse(t);
    if (c && c.webhook) return c;
    if (c && c.token) return { token: c.token, channel: c.channel || 'C0BRDPD17C4' };
    return null;
  } catch (e) { return null; }
}
const SLACK = slackConfig();
console.log(SLACK ? ('💬 notifications Slack activées (' + (SLACK.webhook ? 'webhook' : 'jeton de robot, canal ' + SLACK.channel) + ')')
  : '💬 notifications Slack désactivées (poser data/slack.json {"webhook":…} ou {"token":…,"channel":…})');
// ⚠️ ÉCHAPPEMENT mrkdwn OBLIGATOIRE sur tout texte saisi par un visiteur : sans lui,
// « <!channel> » dans un message pinge toute l'équipe, et « <https://hameçon|Cliquez ici> »
// s'affiche dans #contact comme un lien légitime. Slack ne demande que ces trois caractères.
function slackEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// Renvoie une promesse qui dit si le message est PARTI : les routes de formulaire en dépendent.
// Jamais de rejet : un Slack en panne ne doit pas faire planter la route.
function notifierSlack(texte) {
  if (!SLACK) return Promise.resolve(false);
  if (SLACK.webhook) {
    return fetch(SLACK.webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texte }),
      signal: AbortSignal.timeout(8000)
    }).then(r => {
      if (!r.ok) { console.error('💬 Slack a refusé l\'envoi (' + r.status + ')'); return false; }
      return true;
    }).catch(e => { console.error('💬 envoi Slack impossible :', e.message); return false; });
  }
  // mode jeton de robot : l'API répond 200 même en échec, la vérité est dans le corps JSON
  return fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SLACK.token },
    body: JSON.stringify({ channel: SLACK.channel, text: texte }),
    signal: AbortSignal.timeout(8000)
  }).then(r => r.json()).then(j => {
    if (!j.ok) { console.error('💬 Slack a refusé l\'envoi : ' + j.error + (j.error === 'not_in_channel' ? ' (taper « /invite @claude » dans le canal)' : '')); return false; }
    return true;
  }).catch(e => { console.error('💬 envoi Slack impossible :', e.message); return false; });
}
// Registre des prospects : un Google Sheet, alimenté par une « application web » Apps Script
// dont l'URL vaut un SECRET (même modèle que le webhook Slack). Config HORS Git :
// data/sheet.json {url} en local, SHEET_WEBHOOK en production. Sans config → désactivé
// proprement. ⚠️ C'est un REGISTRE, pas une alerte : il s'ajoute à Slack et à l'e-mail, il ne
// remplace ni l'un ni l'autre — les trois tuyaux sont indépendants.
function sheetConfig() {
  if (process.env.SHEET_WEBHOOK) return { url: process.env.SHEET_WEBHOOK };
  try {
    let t = fs.readFileSync(path.join(DATA_DIR, 'sheet.json'), 'utf8');
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    const c = JSON.parse(t);
    return (c && c.url) ? c : null;
  } catch (e) { return null; }
}
const SHEET = sheetConfig();
console.log(SHEET ? '📊 registre des prospects activé (Google Sheet)'
  : '📊 registre des prospects désactivé (poser data/sheet.json {"url":…} ou SHEET_WEBHOOK)');
// Promesse booléenne, jamais de rejet. ⚠️ Apps Script répond par une REDIRECTION vers
// script.googleusercontent.com : fetch la suit tout seul, il ne faut surtout pas l'interdire.
function ecrireAuRegistre(donnees) {
  if (!SHEET) return Promise.resolve(false);
  return fetch(SHEET.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(donnees),
    signal: AbortSignal.timeout(10000)
  }).then(r => r.ok ? r.json().then(j => !!(j && j.ok), () => false) : false)
    .then(ok => { if (!ok) console.error('📊 le registre a refusé la ligne'); return ok; })
    .catch(e => { console.error('📊 écriture au registre impossible :', e.message); return false; });
}
// Envoi e-mail ATTENDU (promesse booléenne), contrairement à sendMailSafe qui est muet par
// construction : ici la route doit savoir si l'e-mail est parti pour répondre honnêtement.
function envoyerMailAttendu(to, subject, text, html, opts) {
  return new Promise((resolve) => {
    if (!mailer || !to || !/@/.test(to) || /@ls\.fr$/i.test(to)) return resolve(false);
    const msg = composerMail(to, subject, text, html, opts);
    if (opts && opts.replyTo && /@/.test(opts.replyTo)) msg.replyTo = opts.replyTo;
    mailer.sendMail(msg, (err) => {
      if (err) { console.error('✉ échec envoi à ' + to + ' :', err.message); resolve(false); }
      else { console.log('✉ mail envoyé à ' + to + ' — ' + subject); resolve(true); }
    });
  });
}

// Limite par IP des routes publiques, en mémoire. Sans elle, n'importe qui inonde le canal
// Slack et la boîte contact@ en boucle. ⚠️ Elle tourne APRÈS la validation : un e-mail mal
// tapé ne consomme pas le quota (sinon cinq fautes de frappe fermaient la porte au prospect).
// ⚠️ Le quota du test est plus large que celui du contact : une classe ou une entreprise
// entière peut passer le test derrière UNE seule IP (NAT).
const quotasFormulaires = new Map();
function tropDeDemandes(ip, route, max) {
  const FENETRE = 10 * 60 * 1000;
  const k = route + '|' + ip, maintenant = Date.now();
  const liste = (quotasFormulaires.get(k) || []).filter(t => maintenant - t < FENETRE);
  if (liste.length >= max) { quotasFormulaires.set(k, liste); return true; }
  liste.push(maintenant);
  quotasFormulaires.set(k, liste);
  // la table ne doit pas grossir sans fin : purge des entrées éteintes au-delà de 5000 clés
  if (quotasFormulaires.size > 5000) {
    for (const [ck, ts] of quotasFormulaires) { if (!ts.some(t => maintenant - t < FENETRE)) quotasFormulaires.delete(ck); }
  }
  return false;
}
const CONTACT_DEST = 'contact@languagesandsuccess.com';
const champCourt = (v, max) => sTrim(v).slice(0, max || 120);
const EMAIL_VALIDE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Formulaire de contact → Slack #contact + e-mail à contact@ (Reply-To = le visiteur : un
// simple « Répondre » lui écrit directement).
app.post('/api/contact', async (req, res) => {
  const b = req.body || {};
  // pot de miel : le champ « website » est invisible pour un humain. Un robot qui le remplit
  // reçoit un faux succès et rien n'est transmis — le faire échouer lui apprendrait à s'adapter.
  if (sTrim(b.website)) return res.json({ ok: true });
  const prenom = champCourt(b.prenom, 80), nom = champCourt(b.nom, 80);
  const email = champCourt(b.email, 160).toLowerCase(), tel = champCourt(b.tel, 40);
  const message = sTrim(b.message).slice(0, 5000);
  // les 5 champs sont TOUS obligatoires (téléphone compris, demande de l'utilisateur du
  // 21/08/2026) et le message doit faire 15 caractères. Le navigateur exige déjà tout ça
  // (required + minlength) mais sa validation se contourne en deux clics. ⚠️ trim() ne retire
  // ni les largeurs nulles (U+200B…) ni les blancs INTÉRIEURS : la présence se juge sur les
  // caractères réels, et les 15 se comptent après repli des suites de blancs — sans quoi un
  // champ « rempli » d'invisible ou « a » + 13 espaces + « b » franchissait tout (défaut
  // trouvé par la relecture adversariale). Les valeurs ENVOYÉES restent les originales.
  const reel = (v) => String(v == null ? '' : v).replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');
  if (!reel(prenom) || !reel(nom) || !reel(tel) || !reel(message)) return res.status(400).json({ error: 'Champs manquants.' });
  const compteMsg = sTrim(message.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')).replace(/\s+/g, ' ');
  if (compteMsg.length < 15) return res.status(400).json({ error: 'Votre message est trop court (15 caractères minimum).' });
  if (!EMAIL_VALIDE.test(email)) return res.status(400).json({ error: 'Vérifiez votre adresse e-mail.' });
  if (tropDeDemandes(clientIp(req), 'contact', 5)) return res.status(429).json({ error: 'Trop de demandes. Patientez quelques minutes puis réessayez.' });
  const qui = prenom + ' ' + nom + ' — ' + email + (tel ? ' — ' + tel : '');
  // version HTML de l'e-mail : bornée à 40 lignes, AVEC marque de troncature (le texte brut,
  // lui, porte toujours le message entier)
  const lignesMsg = String(message).split('\n').filter(l => l.trim());
  const lignesHtml = [qui].concat(lignesMsg.slice(0, 40));
  if (lignesMsg.length > 40) lignesHtml.push('[…] Message tronqué ici — le texte complet est dans la version texte de cet e-mail.');
  const [slackOk, mailOk, sheetOk] = await Promise.all([
    notifierSlack('📩 *Nouvelle demande de contact*\n' + slackEsc(qui) + '\n\n' + slackEsc(message)),
    envoyerMailAttendu(CONTACT_DEST, 'Nouvelle demande de contact — ' + prenom + ' ' + nom,
      qui + '\n\n' + message,
      mailHtml('Nouvelle demande de contact', lignesHtml, null, null),
      { replyTo: email }),
    ecrireAuRegistre({ origine: 'Formulaire de contact', prenom, nom, email, tel, message })
  ]);
  if (!slackOk && !mailOk && !sheetOk) {
    // rien n'est parti NULLE PART : on le DIT, et la demande entière va au journal — dernière trace
    console.error('📩 DEMANDE DE CONTACT NON TRANSMISE (aucun canal) : ' + qui + ' — ' + message.slice(0, 300));
    return res.status(502).json({ error: 'Votre demande n\'a pas pu être transmise. Écrivez-nous directement à contact@languagesandsuccess.com.' });
  }
  console.log('📩 demande de contact reçue de ' + email + (slackOk ? ' [Slack]' : '') + (mailOk ? ' [e-mail]' : '') + (sheetOk ? ' [registre]' : ''));
  res.json({ ok: true });
});

// Test de niveau terminé → Slack #contact, repli e-mail si Slack est absent ou en panne :
// la personne a coché « j'accepte d'être recontactée », on ne perd JAMAIS un prospect en silence.
app.post('/api/test-niveau', async (req, res) => {
  const b = req.body || {};
  if (sTrim(b.website)) return res.json({ ok: true });
  const prenom = champCourt(b.prenom, 80), nom = champCourt(b.nom, 80);
  const email = champCourt(b.email, 160).toLowerCase(), tel = champCourt(b.tel, 40);
  const langueTestee = champCourt(b.langueTestee, 40), langueVoulue = champCourt(b.langueVoulue, 40);
  const niveau = champCourt(b.niveau, 8);
  const score = Math.max(0, Math.min(50, parseInt(b.score, 10) || 0));
  const total = Math.max(1, Math.min(50, parseInt(b.total, 10) || 10));
  // ⚠️ chaque refus est JOURNALISÉ avec les coordonnées : c'est un prospect consentant, le
  // journal est la dernière trace si le client n'affiche pas l'erreur
  if (!prenom || !nom || !EMAIL_VALIDE.test(email)) {
    console.warn('🧪 coordonnées refusées (champs/e-mail invalides) : ' + (b.prenom || '?') + ' ' + (b.nom || '?') + ' — ' + (b.email || '?') + ' — ' + (b.tel || '?'));
    return res.status(400).json({ error: !EMAIL_VALIDE.test(email) ? 'Vérifiez votre adresse e-mail.' : 'Champs manquants.' });
  }
  if (tropDeDemandes(clientIp(req), 'test', 15)) {
    console.warn('🧪 quota atteint pour ' + clientIp(req) + ' — coordonnées non transmises : ' + prenom + ' ' + nom + ' — ' + email + ' — ' + tel);
    return res.status(429).json({ error: 'Trop de demandes. Patientez quelques minutes puis réessayez.' });
  }
  const lignes = [
    prenom + ' ' + nom + ' — ' + email + (tel ? ' — ' + tel : ''),
    'Test passé : ' + (langueTestee || '?') + ' · Résultat : ' + (niveau || '?') + ' (' + score + '/' + total + ')',
    'Langue qui l\'intéresse : ' + (langueVoulue || langueTestee || '?')
  ];
  const [parti, sheetOk] = await Promise.all([
    notifierSlack('🧪 *Test de niveau terminé*\n' + lignes.map(slackEsc).join('\n')),
    ecrireAuRegistre({ origine: 'Test de niveau', prenom, nom, email, tel, langueTestee, langueVoulue, niveau, score, total })
  ]);
  let mailOk = false;
  if (!parti) {
    mailOk = await envoyerMailAttendu(CONTACT_DEST, 'Test de niveau terminé — ' + prenom + ' ' + nom + ' (' + (niveau || '?') + ')',
      lignes.join('\n') + '\n\n(Envoyé par e-mail car Slack n\'a pas pu être joint.)',
      mailHtml('Test de niveau terminé', lignes, null, null));
  }
  if (!parti && !mailOk && !sheetOk) {
    console.error('🧪 PROSPECT NON TRANSMIS (aucun canal) : ' + lignes.join(' | '));
    return res.status(502).json({ error: 'Vos coordonnées n\'ont pas pu être transmises.' });
  }
  console.log('🧪 test de niveau : ' + email + ' → ' + (niveau || '?') + ' (' + score + '/' + total + ')' + (parti ? ' [Slack]' : '') + (mailOk ? ' [e-mail]' : '') + (sheetOk ? ' [registre]' : ''));
  res.json({ ok: true });
});

// ---- statique (site) -------------------------------------------------------

// ============================================================================
//  BLOG — les articles vivent en BASE (db.articles), pas dans des fichiers.
//  Raison : le conteneur est reconstruit à chaque déploiement, seul le volume
//  data/ survit. Un article édité depuis la page admin doit donc être en base,
//  sinon il disparaîtrait au prochain push.
//  Visibilité : publié = tout le monde ; brouillon et programmé = ADMIN seul.
// ============================================================================
const SITE_URL_PUB = (process.env.SITE_URL || 'https://languagesandsuccess.com').replace(/\/$/, '');
const ART_STATUTS = ['brouillon', 'programme', 'publie'];

function artSlug(titre, exclureId) {
  let base = String(titre || 'article').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/['\u2019]/g, ' ').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 70) || 'article';
  let slug = base, n = 2;
  while (db.articles.some(a => a.slug === slug && a.id !== exclureId)) slug = base + '-' + (n++);
  return slug;
}
// un article est-il visible du public ? (programmé dont l'heure est passée = publié)
function artEnLigne(a) {
  if (a.statut === 'publie') return true;
  if (a.statut === 'programme' && a.datePublication) return new Date(a.datePublication).getTime() <= Date.now();
  return false;
}
function artVisiblePar(a, user) { return artEnLigne(a) || (user && user.role === 'admin'); }
function artPub(a) {
  return {
    id: a.id, slug: a.slug, titre: a.titre, chapo: a.chapo, categorie: a.categorie,
    statut: a.statut, enLigne: artEnLigne(a), datePublication: a.datePublication,
    dateCreation: a.dateCreation, dateMaj: a.dateMaj, image: a.image, motCle: a.motCle,
    url: '/blog/' + a.slug
  };
}
// utilisateur éventuel porté par l'en-tête Authorization ou ?token= (pour la prévisualisation
// d'un brouillon, une navigation de page ne pouvant pas poser d'en-tête)
function userSiConnecte(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : (req.query && req.query.token) || '';
  if (!t) return null;
  try { const d = jwt.verify(t, db.secret); return realUser(d.id) || null; } catch (e) { return null; }
}
function adminSeul(req, res) {
  if (!req.user || req.user.role !== 'admin') { res.status(403).json({ error: 'Réservé à l\'administration.' }); return false; }
  return true;
}

// ---- API ------------------------------------------------------------------
app.get('/api/blog/articles', (req, res) => {
  const u = userSiConnecte(req);
  const liste = db.articles.filter(a => artVisiblePar(a, u))
    .sort((x, y) => String(y.datePublication || y.dateCreation).localeCompare(String(x.datePublication || x.dateCreation)));
  res.json({ articles: liste.map(artPub), admin: !!(u && u.role === 'admin') });
});
app.get('/api/blog/articles/:id', (req, res) => {
  const u = userSiConnecte(req);
  const a = db.articles.find(x => x.id === req.params.id || x.slug === req.params.id);
  if (!a || !artVisiblePar(a, u)) return res.status(404).json({ error: 'Article introuvable.' });
  const plein = Object.assign({}, a, { enLigne: artEnLigne(a) });
  // ⚠️ le post LinkedIn est une note interne : il ne sort JAMAIS de l'administration, alors que
  // cette route sert l'article complet à tout le monde dès qu'il est publié.
  if (!u || u.role !== 'admin') { delete plein.postLinkedin; delete plein.postsLi; }
  res.json({ article: plein });
});
app.post('/api/blog/articles', auth, (req, res) => {
  if (!adminSeul(req, res)) return;
  const b = req.body || {};
  if (!b.titre) return res.status(400).json({ error: 'Le titre est obligatoire.' });
  const now = new Date().toISOString();
  const a = {
    id: crypto.randomUUID(), slug: artSlug(b.slug || b.titre),
    titre: b.titre, chapo: b.chapo || '', categorie: b.categorie || 'Conseils',
    motCle: b.motCle || '', titreSeo: b.titreSeo || '', metaDescription: b.metaDescription || '',
    corps: b.corps || '', faq: Array.isArray(b.faq) ? b.faq : [], sources: Array.isArray(b.sources) ? b.sources : [],
    image: b.image || '',
    // notes internes : TROIS versions du post LinkedIn, à copier-coller. Jamais rendues sur le site.
    postsLi: Array.isArray(b.postsLi) ? b.postsLi : [],
    statut: 'brouillon', datePublication: null,
    dateCreation: now, dateMaj: now, auteur: senderDisplay(req.user)
  };
  db.articles.push(a); save();
  res.json({ article: artPub(a) });
});
app.patch('/api/blog/articles/:id', auth, (req, res) => {
  if (!adminSeul(req, res)) return;
  const a = db.articles.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Article introuvable.' });
  const b = req.body || {};
  for (const k of ['titre', 'chapo', 'categorie', 'motCle', 'titreSeo', 'metaDescription', 'corps', 'image', 'postLinkedin']) {
    if (b[k] != null) a[k] = b[k];
  }
  if (Array.isArray(b.postsLi)) a.postsLi = b.postsLi;
  if (Array.isArray(b.faq)) a.faq = b.faq;
  if (Array.isArray(b.sources)) a.sources = b.sources;
  if (b.slug) a.slug = artSlug(b.slug, a.id);
  a.dateMaj = new Date().toISOString();
  save();
  res.json({ article: artPub(a) });
});
app.delete('/api/blog/articles/:id', auth, (req, res) => {
  if (!adminSeul(req, res)) return;
  const i = db.articles.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Article introuvable.' });
  const [a] = db.articles.splice(i, 1); save();
  res.json({ ok: true, titre: a.titre });
});
// publier tout de suite, ou programmer pour plus tard
app.post('/api/blog/articles/:id/publier', auth, (req, res) => {
  if (!adminSeul(req, res)) return;
  const a = db.articles.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Article introuvable.' });
  const quand = (req.body || {}).datePublication;
  if (quand) {
    const t = new Date(quand).getTime();
    if (isNaN(t)) return res.status(400).json({ error: 'Date de publication invalide.' });
    a.statut = t <= Date.now() ? 'publie' : 'programme';
    a.datePublication = new Date(quand).toISOString();
  } else {
    a.statut = 'publie';
    a.datePublication = new Date().toISOString();
  }
  a.dateMaj = new Date().toISOString();
  save();
  res.json({ article: artPub(a) });
});
// dupliquer : une copie en brouillon, « Copie — » en tête du titre (et donc du slug)
app.post('/api/blog/articles/:id/dupliquer', auth, (req, res) => {
  if (!adminSeul(req, res)) return;
  const a = db.articles.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Article introuvable.' });
  const now = new Date().toISOString();
  const titre = 'Copie — ' + a.titre;
  const copie = Object.assign({}, a, {
    id: crypto.randomUUID(), slug: artSlug(titre), titre,
    faq: (a.faq || []).map(q => Object.assign({}, q)),
    postsLi: (a.postsLi || []).map(x => Object.assign({}, x)),
    sources: (a.sources || []).map(s => Object.assign({}, s)),
    statut: 'brouillon', datePublication: null,
    dateCreation: now, dateMaj: now, auteur: senderDisplay(req.user)
  });
  db.articles.push(copie); save();
  res.json({ article: artPub(copie) });
});
app.post('/api/blog/articles/:id/depublier', auth, (req, res) => {
  if (!adminSeul(req, res)) return;
  const a = db.articles.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Article introuvable.' });
  a.statut = 'brouillon'; a.datePublication = null; a.dateMaj = new Date().toISOString();
  save();
  res.json({ article: artPub(a) });
});

// ---- publication programmée ------------------------------------------------
// Le serveur tourne en continu : c'est LUI qui bascule un article programmé à l'heure dite.
// (Une tâche planifiée côté poste de travail ne le pourrait pas, l'application devant être ouverte.)
function tickProgrammation() {
  try {
    let bouge = false;
    for (const a of db.articles) {
      if (a.statut !== 'programme' || !a.datePublication) continue;
      if (new Date(a.datePublication).getTime() > Date.now()) continue;
      a.statut = 'publie'; a.dateMaj = new Date().toISOString(); bouge = true;
      console.log('📝 article publié automatiquement : ' + a.titre);
    }
    if (bouge) save();
  } catch (e) { console.error('programmation blog :', e.message); }
}
setInterval(tickProgrammation, 60 * 1000);

// ⚠️ AUCUNE diffusion automatique sur les réseaux sociaux (retirée le 05/08/2026, à la demande
// de l'utilisateur : il publie lui-même). Mettre un article en ligne n'appelle plus rien vers
// l'extérieur. Les posts LinkedIn de l'article vivent dans la boîte sous l'article, prêts à être
// copiés-collés à la main. Ne pas réintroduire d'appel sortant ici sans le lui demander.

// ---- rendu des pages du blog ----------------------------------------------
const NL = '\n';   // retour à la ligne des gabarits HTML ci-dessous
// ⚠️ TOUTES les dates d'articles s'affichent à l'HEURE DE PARIS, jamais à celle du processus :
// le conteneur de production tourne en UTC, et un article programmé entre minuit et 2 h du matin
// affichait donc la date de la VEILLE — y compris dans le datePublished envoyé à Google.
// Le déclenchement, lui, n'est pas concerné : il compare des millisecondes absolues.
const TZ_FR = 'Europe/Paris';
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
// composantes de date telles qu'on les lit à Paris
function partsParis(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: TZ_FR, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)) {
    if (x.type !== 'literal') p[x.type] = x.value;
  }
  return p;
}
function artDateLisible(iso) {
  if (!iso) return '';
  const p = partsParis(iso);
  if (!p) return '';
  const jour = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay();
  return JOURS_FR[jour] + ' ' + (+p.day) + ' ' + MOIS_FR[+p.month - 1] + ' ' + p.year;
}
const artIso = (iso) => { const p = iso ? partsParis(iso) : null; return p ? p.year + '-' + p.month + '-' + p.day : ''; };

// carte d'un article dans la grille de blog.html
function artCarte(a) {
  const vignette = a.image
    ? '<img class="thumb" src="' + htmlEsc(a.image) + '" alt="' + htmlEsc(a.categorie + ' — ' + a.titre) + '" loading="lazy" width="1200" height="630" />'
    : '<div class="thumb cat"><span>' + htmlEsc(a.categorie) + '</span></div>';
  const etat = artEnLigne(a) ? '' :
    '<span class="art-etat ' + (a.statut === 'programme' ? 'prog' : 'brou') + '">' +
    (a.statut === 'programme' ? 'Programmé · ' + artDateLisible(a.datePublication) : 'Brouillon') + '</span>';
  return '      <article class="post' + (artEnLigne(a) ? '' : ' post-hors') + '" data-art="' + a.id + '" data-reveal>' + NL
    + '        <a class="post-lien" href="/blog/' + htmlEsc(a.slug) + '">' + NL
    + '          ' + vignette + NL
    + '          <div class="pad">' + etat + '<span class="tag">' + htmlEsc(a.categorie) + '</span><h3>' + htmlEsc(a.titre) + '</h3>'
    + '<p>' + htmlEsc(a.chapo) + '</p><div class="date">' + htmlEsc(artDateLisible(a.datePublication) || 'Non publié') + '</div></div>' + NL
    + '        </a>' + NL
    + '      </article>';
}

// page complète d'un article, balisage SEO compris
// ---- page article : sommaire ancré + boutons « Résumer avec une IA » ----
// Chaque <h2> du corps reçoit un id stable dérivé de son titre (unique, accents retirés) ;
// la liste {id, titre} alimente la colonne « Sommaire » de la page.
function artAncreId(txt, pris) {
  const base = String(txt).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
  let id = base, n = 2;
  while (pris.has(id)) id = base + '-' + (n++);
  pris.add(id);
  return id;
}
function artSommaire(corps, reserves) {
  const pris = new Set(reserves || []), toc = [];
  const html = String(corps || '').replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi, (m, attrs, contenu) => {
    // balises retirées PUIS entités décodées (&amp; en dernier, sinon &amp;lt; serait sur-décodé) :
    // le titre redevient du texte brut — le sommaire le ré-échappe proprement, et l'ancre ne
    // contient plus le « amp » d'un « &amp; » resté encodé
    const titre = contenu.replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').trim();
    if (!titre) return m;
    // un id posé à la main est gardé s'il est LIBRE ; déjà pris (ou en collision avec les ids
    // réservés), il est REMPLACÉ — sans quoi deux ancres identiques cohabitent et la seconde
    // est injoignable (défaut trouvé par la relecture). Détection insensible à la casse et aux
    // guillemets simples : un id non reconnu se verrait sinon PRÉFIXER un second attribut id.
    const deja = (attrs || '').match(/\sid\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const manuel = deja ? (deja[2] !== undefined ? deja[2] : (deja[3] !== undefined ? deja[3] : deja[4])) : null;
    if (manuel && !pris.has(manuel)) { pris.add(manuel); toc.push({ id: manuel, titre }); return m; }
    const id = artAncreId(titre, pris);
    toc.push({ id, titre });
    const attrsSans = (attrs || '').replace(/\sid\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '');
    return '<h2 id="' + id + '"' + attrsSans + '>' + contenu + '</h2>';
  });
  return { html, toc };
}
// Les 5 destinations « Résumer avec une IA » (mêmes adresses que les widgets du genre :
// chacune ouvre l'IA avec le texte « Résume cet article : <url> » prérempli). Les glyphes
// SVG sont des pictogrammes de marque simplifiés, dessinés en currentColor.
const IA_CIBLES = [
  { nom: 'ChatGPT', base: 'https://chatgpt.com/?q=', svg: '<path d="M22.28 9.82a5.99 5.99 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a6 6 0 0 0-4 2.9 6.04 6.04 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.99 5.99 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06l-4.84 2.8A4.5 4.5 0 0 1 3.6 18.3zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.97V11.6a.77.77 0 0 0 .39.68l5.82 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87v.03zm16.6 3.86l-5.83-3.39L15.12 7.2a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.65zm2.01-3.02l-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66v.02zm-12.64 4.13l-2.02-1.16a.08.08 0 0 1-.04-.06V6.08a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.8.8 0 0 0-.39.68l-.01 6.72zm1.1-2.37l2.6-1.5 2.61 1.5v3l-2.6 1.5-2.61-1.5v-3z" fill="currentColor"/>' },
  { nom: 'Claude', base: 'https://claude.ai/new?q=', svg: '<path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" fill="currentColor"/>' },
  { nom: 'Perplexity', base: 'https://www.perplexity.ai/search?q=', svg: '<path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z" fill="currentColor"/>' },
  // ⚠️ gemini.google.com/app?q= ne préremplit PAS le prompt (constaté le 24/08/2026) :
  // on passe par le mode IA de Google (udm=50), propulsé par Gemini — et si le mode IA
  // n'est pas disponible pour le visiteur, Google fait une recherche normale du prompt.
  { nom: 'Gemini', base: 'https://www.google.com/search?udm=50&q=', svg: '<path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" fill="currentColor"/>' },
  { nom: 'Mistral', base: 'https://chat.mistral.ai/chat?q=', svg: '<path d="M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z" fill="currentColor"/>' },
  { nom: 'Grok', base: 'https://grok.com/?q=', vb: '0 0 34 33', svg: '<path d="M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436" fill="currentColor"/><path d="M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341" fill="currentColor"/>' },
];

function artPage(a) {
  const url = SITE_URL_PUB + '/blog/' + a.slug;
  const img = a.image ? (a.image.startsWith('http') ? a.image : SITE_URL_PUB + '/' + a.image.replace(/^\//, '')) : SITE_URL_PUB + '/assets/og-cover.png';
  const desc = a.metaDescription || a.chapo || '';
  const faq = (a.faq || []).filter(q => q && q.q && q.r);
  const graphe = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article', headline: a.titre, description: desc, image: img,
        datePublished: artIso(a.datePublication) || artIso(a.dateCreation),
        dateModified: artIso(a.dateMaj) || artIso(a.dateCreation),
        inLanguage: 'fr-FR', articleSection: a.categorie, mainEntityOfPage: url,
        author: { '@type': 'Organization', name: 'Languages & Success' },
        publisher: { '@type': 'Organization', name: 'Languages & Success', logo: { '@type': 'ImageObject', url: SITE_URL_PUB + '/assets/ls-logo.png' } }
      },
      {
        '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Accueil', item: SITE_URL_PUB + '/' },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: SITE_URL_PUB + '/blog.html' },
          { '@type': 'ListItem', position: 3, name: a.titre }
        ]
      }
    ]
  };
  if (faq.length) graphe['@graph'].push({
    '@type': 'FAQPage',
    mainEntity: faq.map(q => ({ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: q.r } }))
  });

  const faqHtml = faq.length
    ? '      <h2 id="questions-frequentes">Questions fréquentes</h2>' + NL + '      <div class="faq">' + NL
      + faq.map(q => '        <h3>' + htmlEsc(q.q) + '</h3>' + NL + '        <p>' + htmlEsc(q.r) + '</p>').join(NL) + NL
      + '      </div>' + NL
    : '';
  const srcHtml = (a.sources || []).length
    ? '      <h2 id="sources">Sources</h2>' + NL + '      <ul>' + NL
      + (a.sources || []).map(x => '        <li><a href="' + htmlEsc(x.url) + '" target="_blank" rel="noopener">' + htmlEsc(x.titre || x.url) + '</a></li>').join(NL) + NL
      + '      </ul>' + NL
    : '';

  // sommaire : ancres posées sur les <h2> du corps (les ids des sections fixes sont réservés
  // pour qu'un titre d'article identique ne les percute pas), + FAQ et Sources s'ils existent
  const som = artSommaire(a.corps, ['questions-frequentes', 'sources']);
  const toc = som.toc.slice();
  if (faq.length) toc.push({ id: 'questions-frequentes', titre: 'Questions fréquentes' });
  if ((a.sources || []).length) toc.push({ id: 'sources', titre: 'Sources' });
  const somHtml = toc.length >= 2
    ? '      <nav class="art-carte art-som" aria-label="Sommaire de l\'article">' + NL
      + '        <div class="art-cote-titre">Sommaire</div>' + NL
      + toc.map(x => '        <a href="#' + htmlEsc(x.id) + '">' + htmlEsc(x.titre) + '</a>').join(NL) + NL
      + '      </nav>' + NL
    : '';
  const iaQ = encodeURIComponent('Résume cet article : ' + url);
  const iaHtml = IA_CIBLES.map(x =>
    '          <a href="' + x.base + iaQ + '" target="_blank" rel="noopener nofollow"><svg viewBox="' + (x.vb || '0 0 24 24') + '" aria-hidden="true">' + x.svg + '</svg>' + x.nom + '</a>'
  ).join(NL);
  const bandeau = artEnLigne(a) ? '' :
    '    <div class="art-bandeau">' + (a.statut === 'programme'
      ? 'Article programmé pour le ' + htmlEsc(artDateLisible(a.datePublication)) + ' — visible de vous seul en attendant.'
      : 'Brouillon — visible de vous seul, il n\'apparaît pas sur le blog.') + '</div>' + NL;

  return '<!DOCTYPE html>' + NL + '<html lang="fr">' + NL + '<head>' + NL
    + '<meta charset="UTF-8" />' + NL
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' + NL
    + '<title>' + htmlEsc(a.titreSeo || a.titre) + '</title>' + NL
    + '<meta name="description" content="' + htmlEsc(desc) + '" />' + NL
    + (artEnLigne(a) ? '<link rel="canonical" href="' + url + '" />' + NL : '<meta name="robots" content="noindex,nofollow" />' + NL)
    + '<meta property="og:type" content="article" />' + NL
    + '<meta property="og:locale" content="fr_FR" />' + NL
    + '<meta property="og:site_name" content="Languages &amp; Success" />' + NL
    + '<meta property="og:title" content="' + htmlEsc(a.titre) + '" />' + NL
    + '<meta property="og:description" content="' + htmlEsc(desc) + '" />' + NL
    + '<meta property="og:url" content="' + url + '" />' + NL
    + '<meta property="og:image" content="' + htmlEsc(img) + '" />' + NL
    + '<meta name="twitter:card" content="summary_large_image" />' + NL
    + '<meta name="theme-color" content="#be6e54" />' + NL
    + '<link rel="icon" type="image/png" href="/assets/ls-logo.png" />' + NL
    + '<link rel="stylesheet" href="/assets/fonts.css?v=' + ASSET_VER + '" />' + NL
    + '<link rel="stylesheet" href="/assets/site.css?v=' + ASSET_VER + '" />' + NL
    + '<script type="application/ld+json">' + NL + JSON.stringify(graphe, null, 2) + NL + '</script>' + NL
    + '</head>' + NL + '<body>' + NL + '<div id="ls-nav"></div>' + NL + NL
    + '<header class="page-hero" style="padding-bottom:20px">' + NL
    + '  <div class="wrap">' + NL
    + '    <div class="crumbs"><a href="/index.html">Accueil</a> · <a href="/blog.html">Blog</a> · ' + htmlEsc(a.categorie) + '</div>' + NL
    + '    <div class="art-meta"><span class="eyebrow">' + htmlEsc(a.categorie) + '</span><span class="art-date">'
    + (artEnLigne(a) ? 'Publié le ' + htmlEsc(artDateLisible(a.datePublication)) : 'Non publié') + '</span></div>' + NL
    + '    <h1 style="font-size:clamp(30px,4.4vw,52px)">' + htmlEsc(a.titre) + '</h1>' + NL
    + '    <p class="lead">' + htmlEsc(a.chapo) + '</p>' + NL
    // le bouton d'appel à l'action du bandeau (agencement calqué sur la référence du 24/08/2026)
    + '    <a class="btn btn-primary art-cta" href="/contact.html#rappel">Être rappelé →</a>' + NL
    + '  </div>' + NL + '</header>' + NL + NL
    + '<section class="sec" style="padding-top:14px">' + NL + '  <div class="wrap">' + NL
    + bandeau
    // point d'accroche des commandes d'administration (blog-admin.js n'y écrit que pour un admin)
    + '    <div id="ls-art-adm" data-art="' + a.id + '"></div>' + NL
    + '    <div class="art-layout">' + NL
    + '    <div class="art-main">' + NL
    + (a.image ? '    <img class="art-cover" src="' + htmlEsc(a.image) + '" alt="' + htmlEsc(a.titre) + '" width="1200" height="630" />' + NL : '')
    + '    <div class="prose">' + NL + NL
    + som.html + NL + NL
    + faqHtml + srcHtml
    // ancre du post LinkedIn : le SERVEUR n'y écrit rien, blog-admin.js la remplit à partir de
    // l'API — qui ne renvoie le post qu'à un compte admin. Un visiteur reçoit une div vide.
    + '      <div id="ls-art-linkedin"></div>' + NL
    + '      <p class="art-retour"><a href="/blog.html">← Tous les articles</a></p>' + NL
    + '    </div>' + NL + '    </div>' + NL
    // colonne latérale collante : auteur, « Résumer avec une IA », sommaire
    + '    <aside class="art-aside">' + NL
    + '      <div class="art-carte art-auteur">' + NL
    + '        <img src="/assets/ls-logo.png" alt="" width="52" height="52" />' + NL
    + '        <div><b>Languages <em class="art-amp">&amp;</em> Success</b><span>L\'équipe pédagogique · Organisme certifié Qualiopi</span></div>' + NL
    + '      </div>' + NL
    // la carte IA n'apparaît que sur un article EN LIGNE : sur un brouillon, l'URL publique
    // du prompt tombe sur le soft-404 du site et l'IA résumerait la page d'accueil sans erreur
    + (artEnLigne(a)
      ? '      <div class="art-carte art-ia">' + NL
      + '        <div class="art-cote-titre">Résumer avec une IA</div>' + NL
      + '        <div class="art-ia-liste">' + NL + iaHtml + NL + '        </div>' + NL
      + '      </div>' + NL
      : '')
    + somHtml
    + '    </aside>' + NL
    + '    </div>' + NL + '  </div>' + NL + '</section>' + NL + NL
    + '<div id="ls-footer"></div>' + NL
    + '<script>window.LS_CONFIG={key:\'sub\'};</script>' + NL
    + '<script src="/assets/partials.js?v=' + ASSET_VER + '"></script>' + NL
    + '<script src="/assets/blog-admin.js?v=' + ASSET_VER + '"></script>' + NL
    + '<script src="/ls-engine.js"></script>' + NL
    // surbrillance de la section en cours dans le sommaire (le défilement doux, lui, est le
    // scroll-behavior:smooth global de site.css)
    + '<script>' + NL
    + '(function(){' + NL
    + '  var liens = [].slice.call(document.querySelectorAll(".art-som a[href^=\'#\']"));' + NL
    + '  if (!liens.length) return;' + NL
    + '  var cibles = liens.map(function(l){ return document.getElementById(l.getAttribute("href").slice(1)); }).filter(Boolean);' + NL
    // ⚠️ pas de requestAnimationFrame ici : il ne tourne pas dans un onglet en arrière-plan
    // (piège documenté sur la visite guidée), et le travail est minuscule (quelques comparaisons)
    + '  function maj(){' + NL
    + '    var y = window.scrollY + 130, actif = null;' + NL
    + '    cibles.forEach(function(h){ if (h.offsetTop <= y) actif = h; });' + NL
    + '    liens.forEach(function(l){ l.classList.toggle("on", !!actif && l.getAttribute("href") === "#" + actif.id); });' + NL
    + '  }' + NL
    + '  addEventListener("scroll", maj, { passive: true });' + NL
    + '  addEventListener("hashchange", maj);' + NL
    + '  maj();' + NL
    + '})();' + NL
    + '</script>' + NL
    + '</body>' + NL + '</html>' + NL;
}

// sitemap.xml généré à la volée : les articles étant en base, un plan de site figé dans un
// fichier mentirait dès la première publication.
const PRIO_PAGES = { 'index.html': '1.0', 'formations.html': '0.9', 'financement.html': '0.9', 'entreprises.html': '0.9', 'blog.html': '0.8', 'a-propos.html': '0.7', 'contact.html': '0.7', 'test-de-niveau.html': '0.7' };
const HORS_PLAN = ['espace-documents.html'];
app.get('/sitemap.xml', (req, res) => {
  const urls = [];
  try {
    for (const f of fs.readdirSync(ROOT).filter(x => /\.html$/i.test(x)).sort()) {
      if (HORS_PLAN.includes(f)) continue;
      let maj = null;
      try { maj = fs.statSync(path.join(ROOT, f)).mtime.toISOString().slice(0, 10); } catch (e) {}
      urls.push({ loc: SITE_URL_PUB + (f === 'index.html' ? '/' : '/' + f), maj, prio: PRIO_PAGES[f] || '0.5' });
    }
  } catch (e) {}
  db.articles.filter(artEnLigne).forEach(a => {
    urls.push({ loc: SITE_URL_PUB + '/blog/' + a.slug, maj: artIso(a.dateMaj || a.datePublication), prio: '0.6' });
  });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(u => '  <url>\n    <loc>' + u.loc + '</loc>\n'
      + (u.maj ? '    <lastmod>' + u.maj + '</lastmod>\n' : '')
      + '    <priority>' + u.prio + '</priority>\n  </url>').join('\n')
    + '\n</urlset>\n';
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/xml').send(xml);
});

// /blog/<slug> : un brouillon n'est servi qu'à l'administration (jeton en en-tête ou ?token=)
app.get('/blog/:slug', (req, res, next) => {
  const slug = String(req.params.slug || '').replace(/\.html$/, '');
  const a = db.articles.find(x => x.slug === slug);
  if (!a) return next();
  const u = userSiConnecte(req);
  if (!artVisiblePar(a, u)) return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(artPage(a));
});

// blog.html : la grille est injectée côté SERVEUR (donc indexable). Les articles hors ligne
// n'y figurent que pour l'administration.
const MARQUE_A = '<!-- ARTICLES:DEBUT -->', MARQUE_B = '<!-- ARTICLES:FIN -->';
function blogIndexHtml(html, user) {
  const i = html.indexOf(MARQUE_A), j = html.indexOf(MARQUE_B);
  if (i < 0 || j < 0) return html;
  const liste = db.articles.filter(a => artVisiblePar(a, user))
    .sort((x, y) => String(y.datePublication || y.dateCreation).localeCompare(String(x.datePublication || x.dateCreation)));
  const dedans = liste.length
    ? NL + liste.map(artCarte).join(NL) + NL + '    '
    : NL + '      <p class="ds-empty" style="grid-column:1/-1;text-align:center">Les premiers articles arrivent très bientôt.</p>' + NL + '    ';
  return html.slice(0, i + MARQUE_A.length) + dedans + html.slice(j);
}

// Cache-busting AUTOMATIQUE : version d'assets calculée au démarrage (donc nouvelle à CHAQUE
// déploiement, puisque le conteneur redémarre). Les pages HTML écrivent `?v=BUILD`, et le serveur
// remplace `BUILD` par cette version à la volée → le navigateur et Cloudflare rechargent forcément
// le CSS/JS frais après un déploiement, sans bump manuel. (account.js est injecté avec ?v=Date.now().)
const ASSET_VER = Date.now().toString(36);
function sendHtml(res, file, req) {
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) { res.status(404).json({ error: 'Not found' }); return; }
    res.setHeader('Cache-Control', 'no-cache');
    let out = html.replace(/\?v=BUILD/g, '?v=' + ASSET_VER);
    // la grille du blog est remplie côté serveur : le contenu est indexable, et un brouillon
    // n'apparaît que si c'est l'administration qui regarde
    if (/blog\.html$/i.test(file)) out = blogIndexHtml(out, req ? userSiConnecte(req) : null);
    res.type('html').send(out);
  });
}
// HTML (pages + extensionless + "/") : injection de version + no-cache, avant le statique
app.get(/.*/, (req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  let p = req.path === '/' ? '/index.html' : (path.extname(req.path) ? req.path : req.path + '.html');
  if (!p.endsWith('.html')) return next();
  let file;
  try { file = path.normalize(path.join(ROOT, decodeURIComponent(p))); } catch (e) { return next(); }
  if (!file.startsWith(ROOT)) return next();
  fs.access(file, fs.constants.F_OK, (err) => sendHtml(res, err ? path.join(ROOT, 'index.html') : file, req));
});
// assets (css/js/images…) : no-cache sur js/css (ETag → 304 si inchangé)
app.use(express.static(ROOT, {
  setHeaders: (res, filePath) => { if (/\.(js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache'); }
}));
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return sendHtml(res, path.join(ROOT, 'index.html'));
  res.status(404).json({ error: 'Not found' });
});
// ---- comptes démo (affichés sur la page de connexion) ----------------------
// ⚠️ AUCUN compte ADMIN en démo (retiré le 05/08/2026, demande de l'utilisateur). Le mot de
// passe des comptes démo est affiché en clair sur la page de connexion : un admin dans cette
// liste, c'est la totalité de l'espace documents ouverte à qui passe. L'administration se
// connecte avec le compte permanent ci-dessous.
const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS = [
  { email: 'prof@ls.fr', prenom: 'Paul', nom: 'Formateur', role: 'prof', profile: { langue: 'Anglais', siret: '881 226 641 00028', nda: '93 060 886 106', adresse: '57 avenue Valéry Giscard d\'Estaing, 06200 Nice', tel: '06 12 34 56 78', dateNaissance: '12/04/1985', nationalite: 'Française' } },
  { email: 'eleve@ls.fr', prenom: 'Léa', nom: 'Apprenante', role: 'eleve', profile: { tel: '06 98 76 54 32', societe: 'ACME SAS', heuresTotal: '40 h', heuresDetail: '20 h en visioconférence + 20 h en présentiel', intitule: 'Anglais professionnel', langue: 'Anglais', dateDebut: '15/09/2026', dateFin: '20/12/2026', lieu: 'distanciel', lieuAdresse: '', certification: 'oui', certificationText: 'Certification LINGUASKILL (Cambridge)' } }
];
// Compte administrateur permanent. Le mot de passe ci-dessous ne sert QU'À LA CRÉATION : le
// compte n'est jamais réécrasé s'il existe déjà, donc un changement fait depuis « Mot de passe »
// dans l'espace documents (POST /api/me/password) est définitivement conservé. Pour repartir
// d'un autre mot de passe sur une base neuve : variable d'environnement ADMIN_PASSWORD.
const ADMIN_EMAIL = 'admin@languagesandsuccess.com';
// ⚠️ AUCUN VRAI MOT DE PASSE ICI : le dépôt GitHub est PUBLIC. Cette valeur n'est qu'un
// bouchon, pour qu'une base neuve soit utilisable ; le mot de passe réel se pose ensuite avec
// « Changer mon mot de passe » dans l'espace documents, ou d'emblée via ADMIN_PASSWORD.
const ADMIN_MDP_INITIAL = process.env.ADMIN_PASSWORD || 'changez-ce-mot-de-passe';
async function ensureDemo() {
  let changed = false;
  // Le compte administrateur permanent, lui, est TOUJOURS garanti : sans lui personne ne peut
  // plus entrer, et une suppression accidentelle serait irréparable.
  if (!db.users.some(u => u.email === ADMIN_EMAIL)) {
    db.users.push({ id: crypto.randomUUID(), prenom: 'Administration', nom: 'L&S', email: ADMIN_EMAIL, passwordHash: await bcrypt.hash(ADMIN_MDP_INITIAL, 10), role: 'admin', profile: {} });
    changed = true;
  }
  // ⚠️ LES COMPTES DE DÉMO NE SONT SEMÉS QU'UNE SEULE FOIS DANS LA VIE DE LA BASE (demande de
  // l'utilisateur, 05/08/2026 : « à chaque fois que tu déploies Paul et Léa reviennent, c'est
  // relou »). Avant, la boucle les recréait à CHAQUE démarrage : les supprimer ne servait à
  // rien, le déploiement suivant relançait le conteneur et ils repoussaient.
  // ⚠️ Le drapeau `db.demoSeeded` est INDISPENSABLE : une condition du genre « la base est-elle
  // vide ? » ne suffit pas — quand on supprime les deux comptes de démo et qu'il ne reste que
  // l'administrateur, la base redevient « vide » et ils repoussent. Défaut réellement produit
  // par le premier essai de ce correctif.
  if (!db.demoSeeded) {
    for (const d of DEMO_ACCOUNTS) {
      if (!db.users.some(u => u.email === d.email)) {
        db.users.push({ id: crypto.randomUUID(), prenom: d.prenom, nom: d.nom, email: d.email, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10), role: d.role, profile: d.profile });
        changed = true;
      }
    }
    const prof = db.users.find(u => u.email === 'prof@ls.fr'), eleve = db.users.find(u => u.email === 'eleve@ls.fr');
    if (prof && eleve && !db.groups.some(g => gProfs(g).includes(prof.id) && g.eleve === eleve.id)) { db.groups.push({ id: crypto.randomUUID(), profs: [prof.id], eleve: eleve.id, date: Date.now() }); changed = true; }
    db.demoSeeded = true;   // une fois posé, ce drapeau ne se lève plus jamais
    changed = true;
  }
  if (changed) save();
}

ensureDemo().then(() => app.listen(PORT, () => console.log(`L&S server → http://localhost:${PORT}`)));
