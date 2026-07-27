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

const DB_DEFAULTS = () => ({ users: [], groups: [], docs: [], messages: [], notifs: [], worksheets: [], docgens: [], qs: [], presences: [], contratRefs: [], logins: [], secret: crypto.randomBytes(32).toString('hex') });
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
function mailConfig() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return { host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465), secure: process.env.SMTP_SECURE !== 'false', user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.MAIL_FROM || '"Languages & Success" <' + process.env.SMTP_USER + '>', siteUrl: process.env.SITE_URL || 'https://languagesandsuccess.com' };
  }
  try {
    const c = JSON.parse(fs.readFileSync(MAIL_FILE, 'utf8').replace(/^﻿/, ''));
    if (c && c.host && c.user && c.pass) return { host: c.host, port: +(c.port || 465), secure: c.secure !== false, user: c.user, pass: c.pass, from: c.from || '"Languages & Success" <' + c.user + '>', siteUrl: c.siteUrl || 'https://languagesandsuccess.com' };
  } catch (e) { }
  return null;
}
const MAIL = mailConfig();
const mailer = (MAIL && nodemailer) ? nodemailer.createTransport({ host: MAIL.host, port: MAIL.port, secure: MAIL.secure, auth: { user: MAIL.user, pass: MAIL.pass } }) : null;
console.log(mailer ? '✉ e-mails activés via ' + MAIL.host + ' (expéditeur : ' + MAIL.from + ')' : '✉ e-mails désactivés (pas de config SMTP dans data/smtp.json ni en variables d\'env)');
const SITE_URL = (MAIL && MAIL.siteUrl) || 'https://languagesandsuccess.com';
// envoi « fire and forget » : ne bloque jamais la réponse API, ne fait jamais planter le flux
const MAIL_LOGO = path.join(__dirname, 'assets', 'ls-logo.png');
function sendMailSafe(to, subject, text, html) {
  if (!mailer || !to || !/@/.test(to)) return;
  if (/@ls\.fr$/i.test(to)) return; // adresses fictives des comptes démo — jamais d'envoi réel
  const msg = { from: MAIL.from, to, subject, text, html };
  if (html && html.indexOf('cid:lslogo') !== -1 && fs.existsSync(MAIL_LOGO)) msg.attachments = [{ filename: 'ls-logo.png', path: MAIL_LOGO, cid: 'lslogo' }];
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
    + '<p style="font-size:12px;color:#6b6055;margin-top:24px;margin-bottom:0">Vous recevez cet e-mail car une action vous concerne dans l\'espace documents.</p>'
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
const sTrim = (v) => String(v == null ? '' : v).trim();
function cleanProfile(role, p) {
  p = p || {};
  if (role === 'eleve') return { tel: sTrim(p.tel), societe: sTrim(p.societe), refProposition: sTrim(p.refProposition), heuresTotal: sTrim(p.heuresTotal), heuresDetail: sTrim(p.heuresDetail), intitule: sTrim(p.intitule), langue: sTrim(p.langue), dateDebut: sTrim(p.dateDebut), dateFin: sTrim(p.dateFin), lieu: sTrim(p.lieu), lieuAdresse: sTrim(p.lieuAdresse), certification: sTrim(p.certification), certificationText: sTrim(p.certificationText) };
  if (role === 'prof') return { langue: sTrim(p.langue), siret: sTrim(p.siret), nda: sTrim(p.nda), adresse: sTrim(p.adresse), tel: sTrim(p.tel), dateNaissance: sTrim(p.dateNaissance), nationalite: sTrim(p.nationalite) };
  return {};
}
// pied de page : lignes méta (présentes sur TOUS les documents générés)
function metaLines(user) {
  return [
    'Créé le 07/06/2026 par FPE',
    'Rédigé le ' + new Date().toLocaleDateString('fr-FR') + ' par ' + senderDisplay(user),
    "Ce fichier n'a pas encore été modifié — Version 1.0"
  ];
}
const realUser = (id) => db.users.find(u => u.id === id);
const userById = (id) => (id === ADMIN_ID ? ADMIN_MEMBER : realUser(id));
const fullName = (id) => { const u = realUser(id); return u ? `${u.prenom} ${u.nom}` : '—'; };
const senderDisplay = (u) => (u.role === 'admin' ? 'Administration L&S' : `${u.prenom} ${u.nom}`);
const nameDate = () => new Date().toLocaleDateString('fr-FR').replace(/\//g, '-'); // date sans « / » pour les noms de fichiers
const safeFile = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-');
function notify(userId, text, group) { if (!userId) return; db.notifs.push({ id: crypto.randomUUID(), user: userId, text, group: group || null, read: false, date: Date.now() }); }

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
function notifyChannel(g, ch, sender, text) { channelRecipients(g, ch, sender.id).forEach(id => notify(id, text, g.id)); }

// ---- app -------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '2mb' })); // marge pour les signatures (data URL PNG)
app.use((req, res, next) => {
  if (/^\/(data|node_modules|server\.js|package(-lock)?\.json)(\/|$)/.test(req.path)) return res.status(404).end();
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
    activation: newActivation(), mustActivate: true, profile: cleanProfile(role, profile)
  };
  db.users.push(user); save();
  sendActivationMail(user, req.user);
  res.json({ ok: true, user: pubFull(user) });
});
// lien d'activation : jeton aléatoire, à usage unique, valable 14 jours
function newActivation() { return { token: crypto.randomBytes(32).toString('hex'), exp: Date.now() + 14 * 24 * 60 * 60 * 1000 }; }
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
  db.logins.push({ id: crypto.randomUUID(), user: u.id, email: u.email, ip: clientIp(req), date: Date.now() });
  if (db.logins.length > 1000) db.logins = db.logins.slice(-1000);
  save();
  res.json({ token: sign(u), user: pubFull(u) });
});
// l'administration renvoie le lien (perdu, expiré, adresse corrigée)
app.post('/api/admin/users/:id/reinvite', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const u = realUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'Compte introuvable.' });
  if (u.role === 'admin') return res.status(400).json({ error: 'Compte administrateur : non concerné.' });
  u.activation = newActivation(); save();
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
  // historique de connexions (borné aux 1000 dernières entrées)
  db.logins.push({ id: crypto.randomUUID(), user: user.id, email: user.email, ip: clientIp(req), date: Date.now() });
  if (db.logins.length > 1000) db.logins = db.logins.slice(-1000);
  save();
  res.json({ token: sign(user), user: pubFull(user) });
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
app.get('/api/me', auth, (req, res) => res.json({ user: pubFull(req.user) }));
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
app.post('/api/groups', auth, (req, res) => {
  const b = req.body || {};
  let profs, eleve;
  if (req.user.role === 'admin') {
    // un dossier = UN apprenant, mais AUTANT DE FORMATEURS que voulu
    const p = pickMembers(b.profIds != null ? b.profIds : b.profId, 'prof', 'Formateur');
    if (p.error) return res.status(400).json({ error: p.error });
    if (!p.ids.length) return res.status(400).json({ error: 'Choisissez au moins un formateur.' });
    const e = realUser(b.eleveId);
    if (!e || e.role !== 'eleve') return res.status(400).json({ error: 'Apprenant invalide.' });
    profs = p.ids; eleve = e.id;
  } else if (req.user.role === 'prof') {
    const target = realUser(b.targetId);
    if (!target || target.role !== 'eleve') return res.status(400).json({ error: 'Apprenant introuvable.' });
    profs = [req.user.id]; eleve = target.id;
    // un dossier identique existe déjà : on le réutilise au lieu d'en créer un doublon
    const same = db.groups.find(x => x.eleve === target.id && gProfs(x).length === 1 && gProfs(x)[0] === req.user.id);
    if (same) return res.json({ ok: true, group: same.id });
  } else {
    // un apprenant ne constitue plus de dossier lui-même
    return res.status(403).json({ error: 'Les dossiers sont créés par l\'administration ou votre formateur.' });
  }
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
  if (db.presences.some(p => p.docId === d.id) || db.qs.some(q => q.docId === d.id)) {
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

// ---- notifications ---------------------------------------------------------
app.get('/api/notifications', auth, (req, res) => res.json({ notifs: db.notifs.filter(n => n.user === req.user.id).sort((a, b) => b.date - a.date) }));
app.post('/api/notifications/read', auth, (req, res) => { db.notifs.forEach(n => { if (n.user === req.user.id) n.read = true; }); save(); res.json({ ok: true }); });
app.post('/api/notifications/delete', auth, (req, res) => { const id = (req.body || {}).id; db.notifs = db.notifs.filter(n => !(n.user === req.user.id && n.id === id)); save(); res.json({ ok: true }); });
app.post('/api/notifications/clear', auth, (req, res) => { db.notifs = db.notifs.filter(n => n.user !== req.user.id); save(); res.json({ ok: true }); });
// supprime les notifs de l'utilisateur liées à UN dossier (appelé quand il ouvre le dossier)
app.post('/api/notifications/clear-group', auth, (req, res) => { const gid = (req.body || {}).group; db.notifs = db.notifs.filter(n => !(n.user === req.user.id && n.group === gid)); save(); res.json({ ok: true }); });

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
  const users = db.users.map(u => Object.assign(pubFull(u), { pending: !!u.mustActivate }));
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
  return new TableCell({ width: o.width, columnSpan: o.span, verticalMerge: o.vMerge, borders: TBL_CELLBORDERS, verticalAlign: o.valign || V_CENTER, shading: o.fill ? { type: SH_CLEAR, color: 'auto', fill: o.fill } : undefined, margins: { top: 36, bottom: 36, left: 90, right: 90 }, children });
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
function buildWorksheetDocx(w, user) {
  const h = w.header || {}, n = h.notes || {}, sess = wsRows(w).sessions;
  const PC = (s) => ({ size: s, type: WidthType.PERCENTAGE });
  const kids = [];
  // bandeau titre
  kids.push(dxTable([
    new TableRow({ children: [dxCell('INTERACTIVE WORKSHEET', { align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 30, fill: HEADBG })] }),
    new TableRow({ children: [dxCell('Intitulé de la formation : ' + (h.intitule || ''), { bold: true })] }),
    new TableRow({ children: [dxCell("Interactive Worksheet à partager à l'apprenant après chaque cours.", { italics: true, color: SOFTC, align: AlignmentType.CENTER, size: 17 })] })
  ]));
  kids.push(dxSpacer());
  // en-tête infos (label/valeur sur 2 colonnes) + notes
  const lc = (t) => dxCell(t, { width: PC(20), fill: LBLBG, bold: true }), vc = (t, span) => dxCell(t || '', { width: span ? undefined : PC(30), span });
  const inforows = [
    new TableRow({ children: [lc("Nom de l'apprenant"), vc(h.nomApprenant), lc('Langue'), vc(h.langue)] }),
    new TableRow({ children: [lc('Société'), vc(h.societe), lc('Nom du formateur'), vc(h.nomFormateur)] }),
    new TableRow({ children: [lc('Tél apprenant'), vc(h.telApprenant), lc('Tél formateur'), vc(h.telFormateur)] }),
    new TableRow({ children: [lc('Mail apprenant'), vc(h.mailApprenant), lc('Mail formateur'), vc(h.mailFormateur)] })
  ];
  if (h.certification) inforows.push(new TableRow({ children: [lc('Certification'), dxCell(h.certification, { span: 3 })] }));
  inforows.push(new TableRow({ children: [dxCell('Objectifs et organisation de la formation — notes du formateur', { span: 4, fill: HEADBG, bold: true, color: DARKC })] }));
  [['Vocabulaire', n.vocabulaire], ['Structure', n.structure], ['Communication', n.communication], ['Autre', n.autre]].forEach(p =>
    inforows.push(dxRowMin([dxCell(p[0], { width: PC(20), fill: LBLBG, bold: true }), dxCell(p[1] || '', { span: 3, valign: VerticalAlign ? VerticalAlign.TOP : 'top' })], 420)));
  kids.push(dxTable(inforows));
  kids.push(dxSpacer());
  // séances (un tableau par séance)
  if (!sess.length) kids.push(new Paragraph({ children: [new TextRun({ text: 'Aucune séance renseignée.', italics: true, color: SOFTC, size: 20 })] }));
  sess.forEach((s, i) => {
    const rows = [new TableRow({ children: [dxCell('Séance ' + (i + 1), { span: 2, fill: HEADBG, bold: true, color: ACCENTC, size: 22 })] })];
    s.forEach(p => rows.push(dxRowMin([dxCell(p[0], { width: PC(34), fill: LBLBG, bold: true }), dxCell(p[1] || '', { width: PC(66), valign: VerticalAlign ? VerticalAlign.TOP : 'top' })], 380)));
    kids.push(dxTable(rows)); kids.push(dxSpacer());
  });
  const hf = docxHeaderFooter(user);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
// --- Interactive Worksheet → PDF (tableaux) ---
function buildWorksheetPdf(w, user) {
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
    pdfHeaderFooter(doc, user);
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
  let buf, ext, type;
  try {
    if (fmt === 'word') { buf = await buildWorksheetDocx(w, req.user); ext = 'docx'; type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildWorksheetPdf(w, req.user); ext = 'pdf'; type = 'application/pdf'; }
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
    else if (b.type === 'table') { const rows = (b.rows || []).map(cells => new TableRow({ children: (cells || []).map(cr => new TableCell({ borders: TBL_CELLBORDERS, margins: { top: 30, bottom: 30, left: 70, right: 70 }, children: [new Paragraph({ children: rtDxRuns(cr) })] })) })); if (rows.length) { kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })); kids.push(dxSpacer()); } }
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
function buildTestDocx(title, header, extra, user) {
  const H = header || {}, X = extra || {}, PC = (s) => ({ size: s, type: WidthType.PERCENTAGE });
  const cellH = (l, v) => dxCell(l + ' : ' + (v || ''), { width: PC(50) });
  const rows = [
    new TableRow({ children: [dxCell(title.toUpperCase(), { span: 2, align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 30, fill: HEADBG })] }),
    new TableRow({ children: [cellH("Nom de l'apprenant", H.nomApprenant), cellH('Société', H.societe)] }),
    new TableRow({ children: [cellH('Langue', H.langue), cellH('Intitulé de la formation', H.intitule)] }),
    new TableRow({ children: [cellH('Formateur', H.formateur), cellH('Date', H.date)] })
  ];
  rows.push(new TableRow({ children: [dxCell('Résultat', { span: 2, fill: HEADBG, bold: true, color: DARKC })] }));
  rows.push(dxRowMin([dxCell(X.resultat || '', { span: 2, valign: VerticalAlign ? VerticalAlign.TOP : 'top' })], 700));
  rows.push(new TableRow({ children: [dxCell('Appréciation formateur', { span: 2, fill: HEADBG, bold: true, color: DARKC })] }));
  rows.push(dxRowMin([dxCell(X.appreciation || '', { span: 2, valign: VerticalAlign ? VerticalAlign.TOP : 'top' })], 1000));
  const hf = docxHeaderFooter(user);
  const children = [dxTable(rows)].concat(richToDocx(X.libre));
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children }] }));
}
// --- Test mi-parcours / fin → PDF (tableau) ---
function buildTestPdf(title, header, extra, user) {
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
    pdfHeaderFooter(doc, user); doc.end();
  });
}
app.post('/api/testdoc/generate', auth, async (req, res) => {
  const { group, type, header, extra, format } = req.body || {};
  const tpl = TEST_TEMPLATES[type];
  const g = groupById(group);
  if (!tpl) return res.status(400).json({ error: 'Type de document inconnu.' });
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildTestDocx(tpl.title, header, extra, req.user); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildTestPdf(tpl.title, header, extra, req.user); ext = 'pdf'; ctype = 'application/pdf'; }
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
const SIGN_PRESIDENT = ['signature-antonin.png'];
const TAMPON_LS = ['tampon-ls.png'];
function imgSiPresent(noms) {
  for (const n of [].concat(noms)) {
    for (const dossier of [DATA_DIR, path.join(__dirname, 'assets')]) {
      const f = path.join(dossier, n);
      try { if (fs.existsSync(f)) return f; } catch (e) { }
    }
  }
  return null;
}
// Word : renvoie les paragraphes d'image à insérer (liste vide si les fichiers manquent)
function dxSignaturePresident(largeur) {
  const out = [];
  const w = largeur || 120;
  for (const f of [SIGN_PRESIDENT, TAMPON_LS]) {
    const p = imgSiPresent(f);
    if (!p) continue;
    try { out.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: fs.readFileSync(p), transformation: { width: w, height: Math.round(w * 0.45) } })] })); } catch (e) { }
  }
  return out;
}
// Le bloc de signature est dessiné à des coordonnées EXPLICITES : pdfkit ne pagine pas tout seul
// dans ce cas. On force donc une page si la place manque, sinon l'image déborderait sur le pied
// de page (ou hors de la feuille) quand le document est long.
function pdfPlacePourSignature(doc, hauteur) {
  if (doc.y + hauteur > doc.page.height - doc.page.margins.bottom) { doc.addPage(); return true; }
  return false;
}
// PDF : dessine la signature puis le tampon sous le nom et le titre, et renvoie la hauteur utilisée
function pdfSignaturePresident(doc, x, y, largeur) {
  let dy = 0;
  const w = largeur || 120;
  for (const f of [SIGN_PRESIDENT, TAMPON_LS]) {
    const p = imgSiPresent(f);
    if (!p) continue;
    try { doc.image(p, x, y + dy, { fit: [w, w * 0.45] }); dy += w * 0.45 + 4; } catch (e) { }
  }
  return dy;
}
function buildAttestationDocx(d, user) {
  const PC = (s) => ({ size: s, type: WidthType.PERCENTAGE });
  const lc = (t) => dxCell(t, { width: PC(34), fill: LBLBG, bold: true }), vc = (t) => dxCell(t || '', { width: PC(66) });
  const kids = [];
  kids.push(dxTable([new TableRow({ children: [dxCell('ATTESTATION DE FIN DE STAGE', { align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 30, fill: HEADBG })] })]));
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
  ]));
  kids.push(dxSpacer());
  kids.push(dxPara('Objectifs de la formation', { bold: true, color: DARKC, size: 24, before: 240, after: 140 }));
  (d.objectifs || '').split('\n').filter(x => x.trim()).forEach(o => kids.push(dxPara('• ' + o.trim(), { after: 40 })));
  kids.push(dxPara('Nature de la formation :', { bold: true, before: 240 }));
  kids.push(dxPara("Action d'acquisition, d'entretien ou de perfectionnement de la langue.", { after: 140 }));
  kids.push(dxPara("Résultat de l'évaluation des acquis :", { bold: true, color: DARKC, before: 240, after: 140 }));
  const compRows = [new TableRow({ tableHeader: true, children: [dxCell('Compétences', { width: PC(40), fill: HEADBG, bold: true })].concat(ATT_NIVEAUX.map(n => dxCell(n, { width: PC(20), fill: HEADBG, bold: true, align: AlignmentType.CENTER, size: 16 }))) })];
  (d.competences || []).filter(c => c && c.label && c.label.trim()).forEach(c => {
    compRows.push(new TableRow({ children: [dxCell(c.label, { width: PC(40) })].concat(ATT_NIVEAUX.map(n => { const sel = c.niveau === n; return dxCell(sel ? '✗' : '', { width: PC(20), align: AlignmentType.CENTER, bold: true, fill: sel ? ACCENTC : undefined, color: sel ? 'FFFFFF' : INKC, size: 22 }); })) }));
  });
  if (compRows.length > 1) { kids.push(dxTable(compRows)); kids.push(dxSpacer()); }
  // ligne dégagée au-dessus ET en dessous
  kids.push(dxPara("Niveau atteint à l'issue de la formation : " + (d.niveauAtteint || ''), { before: 240, after: 240 }));
  // la certification (TOEIC, Bright Language…) est mise en gras
  kids.push(new Paragraph({ spacing: { after: 140 }, children: [
    new TextRun({ text: 'Certification : ', color: INKC, size: 20 }),
    new TextRun({ text: d.certification || '', bold: true, color: INKC, size: 20 }),
    new TextRun({ text: '     Date : ' + (d.dateEval || '') + '     Résultat : ' + (d.resultat || ''), color: INKC, size: 20 })
  ] }));
  kids.push(dxPara('Commentaires du formateur :', { bold: true, after: 60 }));
  kids.push(dxPara(d.commentaires || '', { after: 160 }));
  kids.push(dxPara('Fait à ' + (d.lieuFait || 'Nice') + ', le ' + (d.dateFait || ''), { before: 160, after: 320 }));
  // bloc de signature sur une ligne horizontale complète : les trois signataires ne se touchent pas
  const sigCol = (lignes, extra) => new TableCell({ width: PC(33), borders: NO_BORDERS(), children: lignes.map(l => dxPara(l, { after: 20 })).concat(extra || []) });
  kids.push(new Table({ width: PC(100), borders: NO_BORDERS(), rows: [new TableRow({ children: [
    sigCol([(d.representant || 'Antonin HATTABE'), 'Président'], dxSignaturePresident(110)),
    sigCol(['Le Formateur']),
    sigCol(["L'apprenant"])
  ] })] }));
  const hf = docxHeaderFooter(user);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
function buildAttestationPdf(d, user) {
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
    doc.moveDown(0.5); p('Objectifs de la formation', { bold: true, color: '#a8593c', size: 12, after: 0.55 });
    (d.objectifs || '').split('\n').filter(x => x.trim()).forEach(o => p('• ' + o.trim(), { after: 0.15 }));
    doc.moveDown(0.6); p('Nature de la formation :', { bold: true, after: 0.15 });
    p("Action d'acquisition, d'entretien ou de perfectionnement de la langue.", { after: 0.5 });
    doc.moveDown(0.5); p("Résultat de l'évaluation des acquis :", { bold: true, color: '#a8593c', size: 11, after: 0.55 });
    const comps = (d.competences || []).filter(c => c && c.label && c.label.trim());
    if (comps.length) {
      const cw = totalW * 0.4, ow = (totalW * 0.6) / 3;
      const crows = [{ cells: [{ text: 'Compétences', w: cw, fill: '#f3e7e0', bold: true, size: 9 }].concat(ATT_NIVEAUX.map(n => ({ text: n, w: ow, fill: '#f3e7e0', bold: true, align: 'center', size: 8 }))) }];
      comps.forEach(c => crows.push({ cells: [{ text: c.label, w: cw, size: 9 }].concat(ATT_NIVEAUX.map(n => { const sel = c.niveau === n; return { text: sel ? 'X' : '', w: ow, align: 'center', bold: true, fill: sel ? '#be6e54' : null, color: '#ffffff', size: 11 }; })) }));
      pdfRows(doc, crows, left); doc.moveDown(0.5);
    }
    // ligne dégagée au-dessus ET en dessous
    doc.moveDown(0.6);
    p("Niveau atteint à l'issue de la formation : " + (d.niveauAtteint || ''), { after: 0.9 });
    // la certification (TOEIC, Bright Language…) est mise en gras
    doc.font('Helvetica').fontSize(9.5).fillColor('#2a241d').text('Certification : ', left, doc.y, { width: totalW, continued: true });
    doc.font('Helvetica-Bold').text(d.certification || '', { continued: true });
    doc.font('Helvetica').text('     Date : ' + (d.dateEval || '') + '     Résultat : ' + (d.resultat || ''), { width: totalW });
    doc.moveDown(0.5);
    p('Commentaires du formateur :', { bold: true, after: 0.2 }); p(d.commentaires || '', { after: 0.6 });
    p('Fait à ' + (d.lieuFait || 'Nice') + ', le ' + (d.dateFait || ''), { after: 1.4 });
    // bloc de signature sur une ligne horizontale complète : les trois signataires ne se touchent pas
    pdfPlacePourSignature(doc, 110);
    const colW = totalW / 3 - 12, y0 = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor('#2a241d');
    doc.text((d.representant || 'Antonin HATTABE'), left, y0, { width: colW });
    doc.text('Président', left, doc.y, { width: colW });
    const hSig = pdfSignaturePresident(doc, left, doc.y + 4, colW * 0.8);
    doc.text('Le Formateur', left + totalW / 3 + 6, y0, { width: colW });
    doc.text("L'apprenant", left + (2 * totalW) / 3 + 12, y0, { width: colW });
    doc.y = y0 + 26 + hSig;
    pdfHeaderFooter(doc, user); doc.end();
  });
}
app.post('/api/attestation/generate', auth, async (req, res) => {
  const { group, fields, format } = req.body || {};
  const g = groupById(group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const d = fields || {};
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildAttestationDocx(d, req.user); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildAttestationPdf(d, req.user); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('attestation:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'attestation', title: 'Attestation de fin de formation', format: ext === 'docx' ? 'word' : 'pdf', apprenant: d.apprenant || 'apprenant' });
  const name = '4 - ' + safeFile('Attestation de fin de formation') + ' - ' + safeFile(d.apprenant || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
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
    { sign: { gauche: ["Pour le Donneur d'ordre, Languages and Success", rep, 'Président'], droite: ['Pour le Sous-traitant,', d.stnom || ''] } }
  ];
}
function buildContratDocx(d, user) {
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
      const col = (lignes, align) => new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: NO_BORDERS(), children: lignes.map(l => new Paragraph({ alignment: align, children: runs(ctSeg(l), { size: 19 }) })) });
      kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_BORDERS(), rows: [new TableRow({ children: [col(b.sign.gauche, AlignmentType.LEFT), col(b.sign.droite, AlignmentType.RIGHT)] })] }));
    }
    else if (b.li) kids.push(new Paragraph({ spacing: { after: 50 }, children: runs([{ t: '• ' }].concat(ctSeg(b.li)), { size: 18 }) }));
    else if (b.li2) kids.push(new Paragraph({ spacing: { after: 40 }, children: runs([{ t: '        –  ' }].concat(ctSeg(b.li2)), { size: 18 }) }));
    else kids.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: b.before ? 200 : 0, after: b.after ? 200 : 90 }, children: runs(segs(b, b.p), { bold: b.bold, italics: b.italics }) }));
  });
  const hf = docxHeaderFooter(user);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 19, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
function buildContratPdf(d, user) {
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
        const y0 = doc.y, colW = totalW / 2 - 10;
        doc.font('Helvetica').fontSize(9.2).fillColor('#2a241d');
        const bloc = (lignes, x, align) => {
          let y = y0;
          lignes.forEach(l => {
            ctSeg(l).forEach((s, i) => {
              doc.font(s.b ? 'Helvetica-Bold' : 'Helvetica');
              doc.text(s.t, i === 0 ? x : doc.x, i === 0 ? y : doc.y, { width: colW, align: align, continued: i < ctSeg(l).length - 1 });
            });
            y = doc.y;
          });
          return y;
        };
        const yG = bloc(b.sign.gauche, left, 'left');
        const yD = bloc(b.sign.droite, left + totalW / 2 + 10, 'right');
        doc.y = Math.max(yG, yD); doc.moveDown(0.5);
      }
      else if (b.li || b.li2) rich((b.li ? [{ t: '•  ' }] : [{ t: '        –  ' }]).concat(ctSeg(b.li || b.li2)), { size: 9, after: b.li ? 0.2 : 0.18 });
      else rich(b.rp || ctSeg(b.p), { size: 9.2, after: b.after ? 0.9 : 0.45, bold: b.bold, italics: b.italics, before: b.before ? 0.5 : 0 });
    });
    pdfHeaderFooter(doc, user); doc.end();
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
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildContratDocx(d, req.user); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildContratPdf(d, req.user); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('contrat:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'contrat', title: 'Contrat de sous-traitance', format: ext === 'docx' ? 'word' : 'pdf', apprenant: d.stnom || 'formateur' });
  const name = '7 - ' + safeFile('Contrat de sous-traitance') + ' - ' + safeFile(d.stnom || 'formateur') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

// ---- questionnaires (QS mi-parcours / fin de formation) --------------------
function pdfHeaderFooter(doc, user) {
  const legal = LEGAL_LINES.join('\n');
  const meta = metaLines(user).join('\n');
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
function docxFooterFor(user) {
  const NB = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } };
  const leftChildren = [new Paragraph({ children: [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16, color: '6F6253' })] })]
    .concat(metaLines(user).map(l => new Paragraph({ children: [new TextRun({ text: l, size: 12, color: '6F6253' })] })));
  return new Footer({ children: [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NB, rows: [new TableRow({ children: [
    new TableCell({ width: { size: 40, type: WidthType.PERCENTAGE }, borders: NB, children: leftChildren }),
    new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, borders: NB, children: LEGAL_LINES.map(l => new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: l, size: 12, color: '6F6253' })] })) })
  ] })] })] });
}
function docxHeaderFooter(user) {
  let logoRun = null; try { logoRun = new ImageRun({ type: 'png', data: fs.readFileSync(LOGO_PATH), transformation: { width: 44, height: 44 } }); } catch (e) { }
  const header = new Header({ children: [new Paragraph({ children: logoRun ? [logoRun] : [] })] });
  return { header, footer: docxFooterFor(user) };
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
function buildQsPdf(qs, tpl, user) {
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
    (tpl.headerFields || QS_HEADER_FIELDS).forEach(f => { doc.fillColor('#2a241d').fontSize(10).font('Helvetica-Bold').text(f.label + ' : ', left, doc.y, { continued: true }).font('Helvetica').text(String(h[f.id] || '—')); doc.moveDown(0.1); });
    if (h.certification) { doc.fillColor('#2a241d').fontSize(10).font('Helvetica-Bold').text('Certification : ', left, doc.y, { continued: true }).font('Helvetica').text(String(h.certification)); doc.moveDown(0.1); }
    doc.moveDown(0.4);
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
      doc.moveDown(0.45); questions.forEach(precision);
    }
    function scale(item) {
      ensure(30); doc.fillColor('#2a241d').font('Helvetica-Bold').fontSize(9.5).text(item.label, left, doc.y, { width: totalW }); doc.moveDown(0.12);
      const cw = totalW / 10, hh = 22; ensure(hh + 4); const y = doc.y;
      for (let k = 1; k <= 10; k++) { const sel = String(ans[item.id]) === String(k); cell(left + cw * (k - 1), y, cw, hh, String(k), { fill: sel ? '#be6e54' : '#f3e7e0', color: sel ? '#ffffff' : '#2a241d', bold: true, align: 'center', size: 10 }); }
      doc.y = y + hh; doc.moveDown(0.45); precision(item);
    }
    function textItem(item) {
      ensure(34); doc.fillColor('#2a241d').font('Helvetica-Bold').fontSize(9.5).text(item.label, left, doc.y, { width: totalW }); doc.moveDown(0.1);
      const valTxt = String(ans[item.id] || ''); doc.font('Helvetica').fontSize(9.5); const innerW = totalW - 16;
      const boxH = Math.max(doc.heightOfString(valTxt || ' ', { width: innerW }) + 12, 28); ensure(boxH + 4); const y = doc.y;
      doc.rect(left, y, totalW, boxH).lineWidth(0.6).strokeColor('#d9cabe').stroke();
      if (valTxt) doc.fillColor('#2a241d').text(valTxt, left + 8, y + 6, { width: innerW });
      doc.y = y + boxH; doc.moveDown(0.45);
    }
    qsBlocks(tpl.items).forEach(b => {
      if (b.kind === 'intro') { ensure(24); doc.fillColor('#6f6253').font('Helvetica-Oblique').fontSize(9.5).text(b.item.text, left, doc.y, { width: totalW }); doc.moveDown(0.4); return; }
      if (b.kind === 'section') { ensure(26); doc.fillColor('#a8593c').font('Helvetica-Bold').fontSize(12).text(b.item.label, left, doc.y, { width: totalW }); doc.moveDown(0.22); return; }
      if (b.kind === 'scale') return scale(b.item);
      if (b.kind === 'text') return textItem(b.item);
      if (b.kind === 'matrix') return matrix(b.options, b.questions);
    });
    pdfHeaderFooter(doc, user);
    doc.end();
  });
}
const SH_CLEAR = ShadingType ? ShadingType.CLEAR : 'clear';
const V_CENTER = VerticalAlign ? VerticalAlign.CENTER : 'center';
function buildQsDocx(qs, tpl, user) {
  const ACCENT = 'BE6E54', DARK = 'A8593C', INK = '2A241D', SOFT = '6F6253', HEADBG = 'F3E7E0';
  const h = qs.header || {}, ans = qs.answers || {};
  const BD = { style: BorderStyle.SINGLE, size: 4, color: 'D9CABE' };
  const cellBorders = { top: BD, bottom: BD, left: BD, right: BD };
  function tcell(text, o) {
    o = o || {};
    return new TableCell({
      width: o.width, borders: cellBorders, verticalAlign: V_CENTER,
      shading: o.fill ? { type: SH_CLEAR, color: 'auto', fill: o.fill } : undefined,
      margins: { top: 30, bottom: 30, left: 70, right: 70 },
      children: [new Paragraph({ alignment: o.align || AlignmentType.LEFT, children: [new TextRun({ text: String(text == null ? '' : text), bold: !!o.bold, color: o.color || INK, size: o.size || 19 })] })]
    });
  }
  const precisionPara = (txt) => new Paragraph({ children: [new TextRun({ text: 'Précision : ' + txt, italics: true, color: SOFT, size: 18 })], spacing: { after: 60 } });
  const kids = [];
  kids.push(new Paragraph({ children: [new TextRun({ text: tpl.title, bold: true, color: ACCENT, size: 34 })], spacing: { after: 70 }, border: { bottom: { color: ACCENT, style: BorderStyle.SINGLE, size: 18, space: 6 } } }));
  (tpl.headerFields || QS_HEADER_FIELDS).forEach(f => kids.push(new Paragraph({ children: [new TextRun({ text: f.label + ' : ', bold: true, color: INK, size: 21 }), new TextRun({ text: String(h[f.id] || '—'), color: INK, size: 21 })], spacing: { after: 40 } })));
  if (h.certification) kids.push(new Paragraph({ children: [new TextRun({ text: 'Certification : ', bold: true, color: INK, size: 21 }), new TextRun({ text: String(h.certification), color: INK, size: 21 })], spacing: { after: 40 } }));
  const gap = () => kids.push(new Paragraph({ text: '', spacing: { after: 90 } }));
  qsBlocks(tpl.items).forEach(b => {
    if (b.kind === 'intro') { kids.push(new Paragraph({ children: [new TextRun({ text: b.item.text, italics: true, color: SOFT, size: 20 })], spacing: { before: 120, after: 80 } })); return; }
    if (b.kind === 'section') { kids.push(new Paragraph({ children: [new TextRun({ text: b.item.label, bold: true, color: DARK, size: 25 })], spacing: { before: 180, after: 90 } })); return; }
    if (b.kind === 'text') {
      kids.push(new Paragraph({ children: [new TextRun({ text: b.item.label, bold: true, color: INK, size: 21 })], spacing: { before: 100, after: 40 } }));
      kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [tcell(ans[b.item.id] || ' ', { width: { size: 100, type: WidthType.PERCENTAGE } })] })] }));
      gap(); return;
    }
    if (b.kind === 'scale') {
      kids.push(new Paragraph({ children: [new TextRun({ text: b.item.label, bold: true, color: INK, size: 21 })], spacing: { before: 100, after: 40 } }));
      const cw = { size: 10, type: WidthType.PERCENTAGE };
      const numRow = new TableRow({ children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => { const sel = String(ans[b.item.id]) === String(k); return tcell(String(k), { width: cw, align: AlignmentType.CENTER, bold: true, fill: sel ? ACCENT : HEADBG, color: sel ? 'FFFFFF' : INK, size: 20 }); }) });
      kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [numRow] }));
      gap(); if (b.item.comment && ans[b.item.id + '_c']) kids.push(precisionPara(ans[b.item.id + '_c'])); return;
    }
    if (b.kind === 'matrix') {
      const opts = b.options, firstW = { size: 52, type: WidthType.PERCENTAGE }, optW = { size: 48 / opts.length, type: WidthType.PERCENTAGE };
      const header = new TableRow({ tableHeader: true, children: [tcell('', { width: firstW, fill: HEADBG })].concat(opts.map(o => tcell(o, { width: optW, fill: HEADBG, bold: true, align: AlignmentType.CENTER, size: 16 }))) });
      const rows = [header].concat(b.questions.map(q => new TableRow({ children: [tcell(q.label, { width: firstW, size: 19 })].concat(opts.map(o => { const sel = ans[q.id] === o; return tcell(sel ? '✗' : '', { width: optW, align: AlignmentType.CENTER, bold: true, fill: sel ? ACCENT : undefined, color: sel ? 'FFFFFF' : INK, size: 22 }); })) })));
      kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
      gap(); b.questions.forEach(q => { if (q.comment && ans[q.id + '_c']) kids.push(precisionPara(ans[q.id + '_c'])); }); return;
    }
  });
  const hf = docxHeaderFooter(user);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INK } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
async function generateQsDoc(qs, format, fromUser) {
  const tpl = QS_TEMPLATES[qs.type];
  let buf, ext, type;
  if (format === 'word' || format === 'docx') { buf = await buildQsDocx(qs, tpl, fromUser); ext = 'docx'; type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
  else { buf = await buildQsPdf(qs, tpl, fromUser); ext = 'pdf'; type = 'application/pdf'; }
  const stored = crypto.randomUUID() + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, stored), buf);
  const name = (qs.type === 'qs_mid' ? '2' : '3') + ' - ' + safeFile(tpl.title) + ' - ' + safeFile((qs.header && qs.header.nomApprenant) || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  const doc = { id: crypto.randomUUID(), group: qs.group, channel: 'commun', from: fromUser.id, fromAdmin: fromUser.role === 'admin', name, size: buf.length, type, stored, date: Date.now() };
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
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildQsDocx(qs, tpl, req.user); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildQsPdf(qs, tpl, req.user); ext = 'pdf'; ctype = 'application/pdf'; }
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
function buildLevelTestDocx(d, user) {
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
  const hf = docxHeaderFooter(user);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 19, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
function buildLevelTestPdf(d, user) {
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
    pdfHeaderFooter(doc, user); doc.end();
  });
}
app.get('/api/leveltest', auth, (req, res) => res.json({ tpl: LEVEL_TEST }));
app.post('/api/leveltest/generate', auth, async (req, res) => {
  const { group, fields, format } = req.body || {};
  const g = groupById(group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const d = fields || {};
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildLevelTestDocx(d, req.user); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildLevelTestPdf(d, req.user); ext = 'pdf'; ctype = 'application/pdf'; }
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
    title: 'Suivi assiduité — E-learning', docTitle: "SUIVI ASSIDUITÉ", kind: 'summary', president: true,
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
    title: 'Feuille de présence — Test', kind: 'grid', president: true,
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
function pdfPresenceGrid(doc, left, totalW, sessions, HB, sigF, sigA) {
  const W = {}; PRESENCE_GRID_HEADER.forEach(c => { W[c[1]] = totalW * c[2] / 100; });
  const rowH = 21;
  let y = doc.y, x = left;
  PRESENCE_GRID_HEADER.forEach(c => { pdfCell(doc, x, y, W[c[1]], rowH, c[0], { fill: HB, bold: true, size: 8, align: 'center' }); x += W[c[1]]; });
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
    if (hasData && sigF) { try { doc.image(sigF.buffer, sfX + 3, y + 2, { fit: [W.sf - 6, rowH - 4], align: 'center', valign: 'center' }); } catch (e) { } }
    if (hasData && sigA) { try { doc.image(sigA.buffer, ssX + 3, y + 2, { fit: [W.ss - 6, rowH - 4], align: 'center', valign: 'center' }); } catch (e) { } }
    doc.y = y + rowH;
  });
}
function buildPresencePdf(type, d, user) {
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
        { cells: [{ text: 'Signature Formateur', w: totalW * 0.32, fill: LB, bold: true, size: 9, valign: 'top' }, { text: '', w: valW }], minH: 56 },
        { cells: [{ text: 'Signature Apprenant', w: totalW * 0.32, fill: LB, bold: true, size: 9, valign: 'top' }, { text: '', w: valW }], minH: 56 }
      ], left);
      if (sigF) { try { doc.image(sigF.buffer, valX + 10, sigY + 6, { fit: [valW - 20, 44], align: 'center', valign: 'center' }); } catch (e) { } }
      if (sigA) { try { doc.image(sigA.buffer, valX + 10, sigY + 62, { fit: [valW - 20, 44], align: 'center', valign: 'center' }); } catch (e) { } }
    } else {
      pdfPresenceGrid(doc, left, totalW, d.sessions || [], HB, sigF, sigA);
    }
    // signature du président incrustée automatiquement (documents administratifs)
    if (tpl.president) {
      doc.moveDown(0.8);
      pdfPlacePourSignature(doc, 100);
      const y0 = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor('#2a241d').text('Pour Languages & Success', left, y0, { width: totalW * 0.5 });
      doc.text('Antonin HATTABE, Président', left, doc.y, { width: totalW * 0.5 });
      pdfSignaturePresident(doc, left, doc.y + 4, 120);
    }
    pdfHeaderFooter(doc, user); doc.end();
  });
}
function buildPresenceDocx(type, d, user) {
  const tpl = PRESENCE_TEMPLATES[type];
  const PC = (s) => ({ size: s, type: WidthType.PERCENTAGE });
  const sigF = sigImg(d.formateurSig), sigA = sigImg(d.apprenantSig);
  const sigCell = (sig, widthPC, w, h) => new TableCell({ width: PC(widthPC), borders: TBL_CELLBORDERS, verticalAlign: V_CENTER, margins: { top: 20, bottom: 20, left: 40, right: 40 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: sig ? [new ImageRun({ type: sig.type, data: sig.buffer, transformation: { width: w, height: h } })] : [] })] });
  const kids = [];
  kids.push(dxTable([new TableRow({ children: [dxCell(tpl.docTitle || 'FEUILLES DE PRÉSENCE', { align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 26, fill: HEADBG })] })]));
  kids.push(dxSpacer());
  const Lc = (t) => dxCell(t, { width: PC(16), fill: LBLBG, bold: true }), Vc = (t) => dxCell(t || '', { width: PC(34) });
  kids.push(dxTable(tpl.headerRows.map(row => new TableRow({ children: row.reduce((acc, pair) => { acc.push(pair ? Lc(pair[1]) : dxCell('', { width: PC(16) })); acc.push(pair ? Vc(d[pair[0]]) : dxCell('', { width: PC(34) })); return acc; }, []) }))));
  kids.push(dxSpacer());
  if (tpl.kind === 'summary') {
    kids.push(dxTable(tpl.summaryRows.map(r => new TableRow({ children: [dxCell(r[1], { width: PC(50), fill: LBLBG, bold: true }), dxCell(d[r[0]] || '', { width: PC(50), bold: r[0] === 'heuresPrevues' })] }))));
    kids.push(dxSpacer()); kids.push(dxSpacer());
    kids.push(dxTable([dxRowMin([dxCell('Signature Formateur', { width: PC(32), fill: LBLBG, bold: true, valign: VerticalAlign ? VerticalAlign.TOP : 'top' }), sigCell(sigF, 68, 150, 49)], 900)]));
    kids.push(dxSpacer());
    kids.push(dxTable([dxRowMin([dxCell('Signature Apprenant', { width: PC(32), fill: LBLBG, bold: true, valign: VerticalAlign ? VerticalAlign.TOP : 'top' }), sigCell(sigA, 68, 150, 49)], 900)]));
  } else {
    const rows = [new TableRow({ children: PRESENCE_GRID_HEADER.map(c => dxCell(c[0], { width: PC(c[2]), fill: HEADBG, bold: true, align: AlignmentType.CENTER })) })];
    const slotMap = {}; (d.sessions || []).forEach(s => { if (s && s.slot && PRESENCE_TIMES.indexOf(s.slot) >= 0) slotMap[s.slot] = s; });
    PRESENCE_TIMES.forEach((t) => {
      const s = slotMap[t] || {}; const hasData = !!slotMap[t];
      const vals = { chk: hasData ? '✗' : '', time: t, date: s.date || '', jour: s.jour || '', hDebut: s.hDebut || '', hFin: s.hFin || '', duree: s.duree || '', sf: '', ss: '' };
      rows.push(dxRowMin(PRESENCE_GRID_HEADER.map(c => {
        if ((c[1] === 'sf' || c[1] === 'ss') && hasData) return sigCell(c[1] === 'sf' ? sigF : sigA, c[2], 52, 17);
        if (c[1] === 'chk') return dxCell(vals.chk, { width: PC(c[2]), align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 20, fill: hasData ? '#f3e7e0' : undefined });
        return dxCell(vals[c[1]], { width: PC(c[2]), align: AlignmentType.CENTER, bold: c[1] === 'time', size: c[1] === 'time' ? 18 : 17 });
      }), 360));
    });
    kids.push(dxTable(rows));
  }
  // signature du président incrustée automatiquement (documents administratifs)
  if (tpl.president) {
    kids.push(dxSpacer());
    kids.push(dxPara('Pour Languages & Success', { after: 20 }));
    kids.push(dxPara('Antonin HATTABE, Président', { after: 40 }));
    dxSignaturePresident(120).forEach(x => kids.push(x));
  }
  const hf = docxHeaderFooter(user);
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 19, color: INKC } } } }, sections: [{ headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
app.get('/api/presence', auth, (req, res) => res.json({ templates: PRESENCE_TEMPLATES }));
app.post('/api/presence/generate', auth, async (req, res) => {
  const { group, type, fields, format } = req.body || {};
  const tpl = PRESENCE_TEMPLATES[type];
  const g = groupById(group);
  if (!tpl) return res.status(400).json({ error: 'Type de feuille inconnu.' });
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const d = fields || {};
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildPresenceDocx(type, d, req.user); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildPresencePdf(type, d, req.user); ext = 'pdf'; ctype = 'application/pdf'; }
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
  const buf = await buildPresencePdf(p.type, d, byUser);
  const stored = crypto.randomUUID() + '.pdf';
  fs.writeFileSync(path.join(UPLOADS_DIR, stored), buf);
  const name = safeFile(tpl.title || 'Feuille de présence') + ' - ' + safeFile((p.fields && p.fields.apprenant) || 'apprenant') + ' - ' + nameDate() + ' - signée.pdf';
  const doc = { id: crypto.randomUUID(), group: p.group, channel: 'commun', from: byUser.id, fromAdmin: byUser.role === 'admin', name, size: buf.length, type: 'application/pdf', stored, date: Date.now() };
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
  if (!sigImg(formateurSig)) return res.status(400).json({ error: 'Signature du formateur manquante.' });
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
    // le MOIS concerné figure dans l'e-mail : l'apprenant sait de quelle période il s'agit
    const moisTxt = (fields && fields.mois) ? String(fields.mois).trim() : '';
    const objet = 'Feuille de présence à signer' + (moisTxt ? ' — ' + moisTxt : '') + ' — Languages & Success';
    const ligne = senderDisplay(req.user) + ' vous a envoyé une feuille de présence à signer (' + tpl.title + (moisTxt ? ', ' + moisTxt : '') + ').';
    sendMailSafe(eleveU.email, objet,
      'Bonjour ' + eleveU.prenom + ',\n\n' + ligne + '\n\nConnectez-vous à votre espace documents pour la signer :\n' + url + '\n\nLanguages & Success',
      mailHtml('Un document à signer vous attend' + (moisTxt ? ' — ' + moisTxt : ''),
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

// comptes démo (email + mot de passe affichés sur la page de connexion)
app.get('/api/demo-accounts', (req, res) => res.json({ accounts: DEMO_ACCOUNTS.map(d => ({ email: d.email, password: DEMO_PASSWORD, role: d.role, name: `${d.prenom} ${d.nom}` })) }));

// ---- statique (site) -------------------------------------------------------
// Cache-busting AUTOMATIQUE : version d'assets calculée au démarrage (donc nouvelle à CHAQUE
// déploiement, puisque le conteneur redémarre). Les pages HTML écrivent `?v=BUILD`, et le serveur
// remplace `BUILD` par cette version à la volée → le navigateur et Cloudflare rechargent forcément
// le CSS/JS frais après un déploiement, sans bump manuel. (account.js est injecté avec ?v=Date.now().)
const ASSET_VER = Date.now().toString(36);
function sendHtml(res, file) {
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) { res.status(404).json({ error: 'Not found' }); return; }
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html.replace(/\?v=BUILD/g, '?v=' + ASSET_VER));
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
  fs.access(file, fs.constants.F_OK, (err) => sendHtml(res, err ? path.join(ROOT, 'index.html') : file));
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
const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS = [
  { email: 'admin@ls.fr', prenom: 'Alice', nom: 'Admin', role: 'admin', profile: {} },
  { email: 'prof@ls.fr', prenom: 'Paul', nom: 'Formateur', role: 'prof', profile: { langue: 'Anglais', siret: '881 226 641 00028', nda: '93 060 886 106', adresse: '57 avenue Valéry Giscard d\'Estaing, 06200 Nice', tel: '06 12 34 56 78', dateNaissance: '12/04/1985', nationalite: 'Française' } },
  { email: 'eleve@ls.fr', prenom: 'Léa', nom: 'Apprenante', role: 'eleve', profile: { tel: '06 98 76 54 32', societe: 'ACME SAS', heuresTotal: '40 h', heuresDetail: '20 h en visioconférence + 20 h en présentiel', intitule: 'Anglais professionnel', langue: 'Anglais', dateDebut: '15/09/2026', dateFin: '20/12/2026', lieu: 'distanciel', lieuAdresse: '', certification: 'oui', certificationText: 'Certification LINGUASKILL (Cambridge)' } }
];
// compte administrateur permanent (mot de passe surchargeable via ADMIN_PASSWORD ;
// jamais réécrasé s'il existe déjà — un changement de mot de passe ultérieur est conservé)
const ADMIN_EMAIL = 'admin@languagesandsuccess.com';
async function ensureDemo() {
  let changed = false;
  if (!db.users.some(u => u.email === ADMIN_EMAIL)) {
    db.users.push({ id: crypto.randomUUID(), prenom: 'Administration', nom: 'L&S', email: ADMIN_EMAIL, passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'changez-ce-mot-de-passe', 10), role: 'admin', profile: {} });
    changed = true;
  }
  for (const d of DEMO_ACCOUNTS) {
    if (!db.users.some(u => u.email === d.email)) {
      db.users.push({ id: crypto.randomUUID(), prenom: d.prenom, nom: d.nom, email: d.email, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10), role: d.role, profile: d.profile });
      changed = true;
    }
  }
  const prof = db.users.find(u => u.email === 'prof@ls.fr'), eleve = db.users.find(u => u.email === 'eleve@ls.fr');
  if (prof && eleve && !db.groups.some(g => gProfs(g).includes(prof.id) && g.eleve === eleve.id)) { db.groups.push({ id: crypto.randomUUID(), profs: [prof.id], eleve: eleve.id, date: Date.now() }); changed = true; }
  if (changed) save();
}

ensureDemo().then(() => app.listen(PORT, () => console.log(`L&S server → http://localhost:${PORT}`)));
