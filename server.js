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
const http = require('http');
const { fork } = require('child_process');
const zlib = require('zlib');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Header, Footer, ImageRun, PageNumber, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ShadingType, VerticalAlign, VerticalMergeType, HeightRule, TableLayoutType, Tab, TabStopType, ExternalHyperlink } = require('docx');
const { rendreDocxPortable } = require('./lib/docx-portable');
// ⚠️ TOUT .docx sort par là : les réglages que Word applique d'office y sont écrits en toutes lettres,
// pour qu'Apple Pages affiche le même interlignage (rendu Word inchangé, cf. lib/docx-portable.js)
const docxPortable = (doc) => Packer.toBuffer(doc).then(rendreDocxPortable);
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
// ⚠️ MODE SIMULATION (21/09/2026) : ce drapeau est posé par le serveur principal quand il lance
// le serveur de DÉMONSTRATION (bouton « Simulation » de l'administration). Ce processus-là a sa
// propre base, dans un dossier temporaire, et n'a le droit à AUCUN effet extérieur : e-mails,
// sauvegardes, Slack et registre Google y sont coupés par le code (voir mailConfig, backupCfg,
// slackConfig, sheetConfig), en plus de ne recevoir aucune de leurs variables d'environnement.
const SIMULATION = process.env.LS_SIMULATION === '1';
// Le dossier de données n'est déplaçable QUE pour le serveur de démonstration : une variable
// oubliée dans l'environnement de production ne doit jamais pouvoir faire changer de base au site.
const DATA_DIR = (SIMULATION && process.env.LS_DATA_DIR) ? path.resolve(process.env.LS_DATA_DIR) : path.join(ROOT, 'data');
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
const DB_DEFAULTS = () => ({ users: [], groups: [], docs: [], messages: [], notifs: [], worksheets: [], docgens: [], qs: [], presences: [], attestations: [], contrats: [], contratRefs: [], logins: [], demoSeeded: false, articles: [], secret: crypto.randomBytes(32).toString('hex') });
// ⚠️ db.docVersions (compteur de versions PAR GÉNÉRATION) est abandonné depuis le 16/09/2026 : la
// version d'un document est celle de son modèle (VERSIONS_MODELES). On retire le champ des bases
// existantes pour qu'aucun code ne soit tenté de le relire.
function normalizeDB(d) { const def = DB_DEFAULTS(); for (const k of Object.keys(def)) { if (d[k] == null) d[k] = def[k]; } delete d.docVersions; return migrateGroups(d); }
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
  if (SIMULATION) return null;   // serveur de démonstration : aucun effet extérieur, jamais
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
// opts.suivi (facultatif) : reçoit la RÉPONSE RÉELLE du serveur d'envoi ({etat, reponse|erreur}),
// pour les envois dont l'administration doit pouvoir vérifier le sort (invitations).
function sendMailSafe(to, subject, text, html, opts) {
  const suivi = (opts && typeof opts.suivi === 'function') ? opts.suivi : () => {};
  if (!mailer) return suivi({ etat: 'desactive', erreur: 'e-mails désactivés sur le serveur (aucune configuration SMTP)' });
  if (!to || !/@/.test(to)) return suivi({ etat: 'refuse', erreur: 'adresse invalide' });
  if (/@ls\.fr$/i.test(to)) return suivi({ etat: 'ignore', erreur: 'adresse de démonstration, jamais d\'envoi réel' }); // comptes démo
  const msg = composerMail(to, subject, text, html, opts);
  if (opts && opts.replyTo && /@/.test(opts.replyTo)) msg.replyTo = opts.replyTo;
  mailer.sendMail(msg, (err, info) => {
    if (err) { console.error('✉ échec envoi à ' + to + ' :', err.message); return suivi({ etat: 'refuse', erreur: String(err.message || err).slice(0, 300) }); }
    console.log('✉ mail envoyé à ' + to + ' — ' + subject);
    // le serveur peut accepter la connexion et refuser le destinataire : c'est un refus
    const rejete = info && Array.isArray(info.rejected) && info.rejected.length;
    suivi(rejete
      ? { etat: 'refuse', erreur: 'destinataire refusé : ' + String(info.response || '').slice(0, 300) }
      : { etat: 'accepte', reponse: String((info && info.response) || '').slice(0, 300) });
  });
}
// gabarit HTML : carte type « modal » (fond crème du site, case claire arrondie),
// logo en pièce inline (cid:lslogo, attaché par sendMailSafe), wordmark avec seul le & en accent
const mailEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// **gras** dans un texte d'e-mail (même convention que les brouillons relus avec l'utilisateur)
const mailRiche = s => mailEsc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const MAIL_PARA = 'font-size:14px;line-height:1.6;margin:0 0 12px';
const MAIL_BOUTON = 'background:#be6e54;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px;font-weight:bold;display:inline-block';
// Le CADRE (fond crème, carte, logo, wordmark, mention « message automatique ») est partagé par
// tous les e-mails : il n'existe qu'ici, sinon deux gabarits finiraient par diverger.
const mailCadre = (titre, corps) => '<div style="background:#f8f2e7;padding:36px 16px">'
  + '<div style="max-width:540px;margin:0 auto;background:#fffaf0;border:1px solid #e6dccb;border-radius:18px;padding:34px 30px;font-family:Arial,Helvetica,sans-serif;color:#2a241d">'
  + '<div style="text-align:center;margin-bottom:14px"><img src="cid:lslogo" width="56" height="56" alt="Languages & Success" style="display:inline-block;border:0"/></div>'
  + '<div style="text-align:center;font-size:13px;letter-spacing:.18em;text-transform:uppercase;font-weight:bold;color:#2a241d;margin-bottom:24px">Languages <span style="color:#be6e54;font-style:italic">&amp;</span> Success</div>'
  + '<h2 style="font-size:20px;margin:0 0 14px">' + mailEsc(titre) + '</h2>'
  + corps
  + '<div style="margin-top:26px;padding:12px 14px;background:#f4ece0;border-radius:10px">'
  + '<p style="font-size:12px;line-height:1.55;color:#6b6055;margin:0"><strong>Message automatique.</strong> Merci de ne pas répondre à cet e-mail : l\'adresse nepasrepondre@languagesandsuccess.com ne reçoit aucun courrier. Pour nous joindre, écrivez à contact@languagesandsuccess.com.</p>'
  + '</div>'
  + '</div></div>';
function mailHtml(title, lines, ctaLabel, ctaUrl) {
  return mailCadre(title,
    lines.map(l => '<p style="' + MAIL_PARA + '">' + mailEsc(l) + '</p>').join('')
    + (ctaUrl ? '<p style="margin:24px 0 8px"><a href="' + ctaUrl + '" style="' + MAIL_BOUTON + '">' + mailEsc(ctaLabel) + '</a></p>' : ''));
}
// Variante à INTERTITRES et à listes, pour le seul e-mail qui ait tout un espace de travail à
// présenter : l'invitation à la première connexion. Même cadre, mêmes couleurs.
function mailHtmlSections(titre, intro, sections, signature) {
  const corps = intro.map(p => '<p style="' + MAIL_PARA + '">' + mailRiche(p) + '</p>').join('')
    + sections.map(s => '<div style="margin:26px 0 0">'
      + '<p style="margin:0 0 10px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:bold;color:#be6e54">' + mailEsc(s.titre) + '</p>'
      + (s.paras || []).map(p => '<p style="' + MAIL_PARA + '">' + mailRiche(p) + '</p>').join('')
      + (s.cta ? '<p style="margin:16px 0 14px"><a href="' + s.cta.url + '" style="' + MAIL_BOUTON + '">' + mailEsc(s.cta.libelle) + '</a></p>' : '')
      + (s.apres || []).map(p => '<p style="font-size:13px;line-height:1.55;margin:0 0 10px;color:#6b6055">' + mailRiche(p) + '</p>').join('')
      + (s.puces ? '<ul style="margin:0;padding:0 0 0 18px">' + s.puces.map(p => '<li style="font-size:14px;line-height:1.6;margin:0 0 10px">' + mailRiche(p) + '</li>').join('') + '</ul>' : '')
      + '</div>').join('')
    + '<p style="' + MAIL_PARA + ';margin-top:26px">' + signature.map(mailEsc).join('<br>') + '</p>';
  return mailCadre(titre, corps);
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
  if (SIMULATION) return null;   // serveur de démonstration : aucun effet extérieur, jamais
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
// ---- VERSION D'UN MODÈLE DE DOCUMENT (16/09/2026, décision de l'utilisateur) ----------------
// La version n'avance PLUS à chaque génération (c'était un compteur par dossier, db.docVersions,
// supprimé) : elle suit les modifications du MODÈLE, faites par le développeur avec Claude.
// Tous les modèles sont repartis de 1.0 le 16/09/2026.
// ⚠️ RÈGLE : toute modification qui change ce qu'un document affiche (texte, champs, mise en page)
// fait avancer SA version de 0,1 ici (1.0 → 1.1 … 1.9 → 2.0), dans le même commit. Une modification
// d'une partie COMMUNE (en-tête, pied de page, LEGAL_LINES, signature d'Antonin) les fait toutes
// avancer. Une clé absente vaut 1.0 : ne pas compter sur ce repli, chaque modèle a sa ligne.
// 1.1 pour tous le 16/09/2026 : pied de page Word refait (sans tableau, numéro de page en bas, comme le PDF)
// 1.2 pour tous (contrat 1.3) le 21/09/2026 : rendu PDF commun — caractères hors Europe de l'Ouest (→ ≠ phonétique, russe…)
// enfin lisibles, et case plus haute qu'une page coupée proprement entre deux pages
const VERSIONS_MODELES = {
  interactive: '1.2',            // Interactive Worksheet
  qs_mid: '1.2',                 // Questionnaire de satisfaction en cours de formation
  qs_end: '1.2',                 // Questionnaire de fin de formation
  attestation: '1.3',            // Attestation de fin de formation (1.3 : tableau des acquis toujours présent)
  test_mid: '1.3',               // Test de mi-parcours (1.3 : liens cliquables dans la zone libre)
  test_end: '1.3',               // Test de fin de formation (1.3 : liens cliquables dans la zone libre)
  contrat: '1.3',                // Contrat de sous-traitance (1.1 : « Languages & Success » ; 1.2 : pied de page ; 1.3 : caractères spéciaux et cases longues)
  qs_formateur: '1.2',           // Fiche satisfaction formateur
  leveltest: '1.2',              // Level Test
  'presence-elearning': '1.3',   // Suivi assiduité e-learning (1.3 : signature administratif centrée)
  'presence-presentiel': '1.2',  // Feuille de présence présentiel / distanciel
  'presence-test': '1.3',        // Feuille de présence Certification (1.3 : signature administratif centrée)
};
function versionModele(tpl) { return VERSIONS_MODELES[tpl] || '1.0'; }
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

// ---- MODE SIMULATION : un espace documents de démonstration, dans un AUTRE processus -------------
// (21/09/2026, demande de l'utilisateur : présenter à ses formateurs leur interface, sans rien toucher)
// ⚠️⚠️ POURQUOI UN AUTRE PROCESSUS, et non des comptes « démo » glissés dans la vraie base :
// (1) n'importe quel compte connecté peut lister TOUS les utilisateurs (GET /api/users) — un
// compte de démo y aurait vu les vrais apprenants ; (2) l'administration est membre de TOUS les
// dossiers, chaque vue d'administration aurait dû filtrer la démo, et le moindre oubli l'aurait
// mêlée aux vrais dossiers ; (3) remettre la démo à zéro aurait voulu dire SUPPRIMER des dossiers
// dans la base de production. Ici la démo a sa propre base, dans un dossier temporaire : elle ne
// peut ni voir ni toucher les vraies données, et le serveur de démo n'a aucun moyen d'envoyer quoi
// que ce soit (voir SIMULATION en tête de fichier).
// ⚠️ AIGUILLAGE PAR LE JETON : l'onglet en simulation envoie « sim.<jeton> » (en-tête ou ?token=),
// et ces requêtes-là, elles seules, sont relayées au serveur de démo. Le navigateur n'a donc
// AUCUNE adresse à changer : les soixante appels existants fonctionnent tels quels.
// ⚠️ Le relais est posé AVANT express.json : il transmet le corps brut (JSON, fichiers envoyés,
// signatures) tel qu'il arrive — une fois lu par express.json, il n'y aurait plus rien à relayer.
const SIM_DIR = path.join(os.tmpdir(), 'ls-simulation-' + String(PORT).replace(/\D/g, ''));
const SIM_INACTIF = 3 * 60 * 60 * 1000;   // arrêt au bout de 3 h sans requête : la fois suivante, la démo repart neuve
const SIM_ADMIN = 'sim-admin';
const simulation = { proc: null, port: null, secret: null, pret: false, demarrage: null, derniere: 0 };
// Les personnes de la démo. ⚠️ Adresses en @example.com : domaine RÉSERVÉ par l'IANA, qui ne
// reçoit jamais de courrier — une adresse « crédible » en .fr pourrait appartenir à quelqu'un.
const jourIso = (decalage) => new Date(Date.now() + decalage * 86400000).toISOString().slice(0, 10);
const SIM_PERSONNES = {
  formatrice: { id: 'sim-formatrice', prenom: 'Sophie', nom: 'DUPONT', email: 'sophie.dupont@example.com', role: 'prof',
    profile: { langue: 'Anglais, Espagnol, Italien', siret: '123 456 789 00012', nda: '93 06 12345 06', adresse: '12 rue de la République, 06000 Nice', tel: '06 12 34 56 78', dateNaissance: '1986-04-12', nationalite: 'Française' } },
  lucas: { id: 'sim-lucas', prenom: 'Lucas', nom: 'MARTIN', email: 'lucas.martin@example.com', role: 'eleve',
    profile: { tel: '06 98 76 54 32', societe: 'Riviera Tech', heuresTotal: '30', heuresDetail: '30 h de cours individuels', intitule: 'Anglais professionnel : réunions et négociation', langue: 'Anglais', dateDebut: jourIso(-14), dateFin: jourIso(60), lieu: 'distanciel', certification: 'oui', certificationText: 'TOEIC' } },
  emma: { id: 'sim-emma', prenom: 'Emma', nom: 'BERNARD', email: 'emma.bernard@example.com', role: 'eleve',
    profile: { tel: '07 11 22 33 44', societe: 'Hôtel Belvédère', heuresTotal: '20', heuresDetail: '20 h en petit groupe', intitule: 'Espagnol : accueil de la clientèle', langue: 'Espagnol', dateDebut: jourIso(-7), dateFin: jourIso(45), lieu: 'presentiel', lieuAdresse: '5 promenade des Anglais, 06000 Nice', certification: 'non' } },
  // dossier VIDE (demande de l'utilisateur, 21/09/2026) : une formation qui commence la semaine
  // prochaine, rien que le règlement intérieur — pour montrer à quoi ressemble un dossier tout neuf
  hugo: { id: 'sim-hugo', prenom: 'Hugo', nom: 'PETIT', email: 'hugo.petit@example.com', role: 'eleve',
    profile: { tel: '06 55 44 33 22', societe: '', heuresTotal: '15', heuresDetail: '15 h de cours individuels', intitule: 'Italien : prendre la parole au quotidien', langue: 'Italien', dateDebut: jourIso(7), dateFin: jourIso(70), lieu: 'distanciel', certification: 'non' } },
};
// ⚠️ LISTE BLANCHE, jamais « tout sauf » : le serveur de démo ne reçoit que ce qu'il faut pour
// tourner. Les identifiants SMTP, Backblaze (dont la rétention supprime des archives !), Slack
// et Google Sheet de la production ne peuvent donc pas y arriver, même ajoutés un jour à l'ENV_FILE.
const SIM_ENV_PERMIS = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'NODE_PATH', 'LANG'];
function envSimulation() {
  const e = {};
  for (const k of SIM_ENV_PERMIS) if (process.env[k] != null) e[k] = process.env[k];
  // mot de passe administrateur aléatoire : aucun compte de la démo n'est joignable par mot de passe
  return Object.assign(e, { LS_SIMULATION: '1', LS_DATA_DIR: SIM_DIR, ADMIN_PASSWORD: crypto.randomBytes(24).toString('hex') });
}
function arreterSimulation() {
  const p = simulation.proc;
  simulation.proc = null; simulation.pret = false; simulation.port = null;
  if (!p || p.exitCode !== null) return Promise.resolve();
  return new Promise(ok => { const t = setTimeout(ok, 3000); p.once('exit', () => { clearTimeout(t); ok(); }); p.kill(); });
}
// Le contenu de la démo passe par les VRAIES routes du serveur de démo (création de dossier, qui
// y dépose le règlement intérieur ; messages ; contrat ; questionnaire) : ce que l'on montre aux
// formateurs est exactement ce que le site produit, pas une maquette qui pourrait diverger.
// ⚠️ Chaque étape est indépendante : si l'une échoue, la démo s'ouvre quand même avec le reste.
async function remplirSimulation() {
  const base = 'http://127.0.0.1:' + simulation.port;
  const jeton = (id) => jwt.sign({ id }, simulation.secret, { expiresIn: '1h' });
  const appel = async (id, chemin, corps) => {
    const r = await fetch(base + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton(id) }, body: JSON.stringify(corps), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(chemin + ' → ' + r.status + ' ' + (j.error || ''));
    return j;
  };
  const etape = async (nom, f) => { try { return await f(); } catch (e) { console.error('🎭 simulation, étape « ' + nom + ' » :', e.message); return null; } };
  const P = SIM_PERSONNES, F = P.formatrice.id;
  const gLucas = await etape('dossier de Lucas', async () => (await appel(SIM_ADMIN, '/api/groups', { profIds: [F], eleveId: P.lucas.id })).group);
  const gEmma = await etape('dossier d\'Emma', async () => (await appel(SIM_ADMIN, '/api/groups', { profIds: [F], eleveId: P.emma.id })).group);
  const msg = (qui, g, ch, text) => etape('message', () => g && appel(qui, '/api/messages', { group: g, channel: ch, text }));
  await msg(P.lucas.id, gLucas, 'commun', 'Bonjour Sophie, je vous envoie mes disponibilités pour la semaine prochaine : mardi et jeudi en fin de journée.');
  await msg(F, gLucas, 'commun', 'Parfait Lucas, on garde mardi à 18h. Pensez à relire le vocabulaire de notre dernière séance sur les réunions.');
  await msg(P.lucas.id, gLucas, 'commun', 'Très bien, merci ! À mardi.');
  await msg(SIM_ADMIN, gLucas, 'prive', 'Bonjour Sophie, bienvenue dans l\'équipe ! Votre contrat de sous-traitance pour la formation de Lucas est prêt : vous pouvez le relire et le signer juste ici.');
  if (gLucas) await etape('contrat', () => appel(SIM_ADMIN, '/api/contrat/send', { group: gLucas, prof: F, fields: {
    stnom: 'Sophie DUPONT', stNaissance: '12/04/1986', stNationalite: 'Française', stAdresse: '12 rue de la République, 06000 Nice',
    stSiret: '123 456 789 00012', stNda: '93 06 12345 06', intitule: P.lucas.profile.intitule, langue: 'Anglais', stagiaire: 'Lucas MARTIN',
    programme: '30 h de formation : 24 h de cours synchrones et 6 h en e-learning.', mission: '24 h de cours synchrones en distanciel.',
    heuresSync: '24', dateDebut: P.lucas.profile.dateDebut, dateFin: P.lucas.profile.dateFin, lieu: 'Distanciel',
    tauxHoraire: '35', montantTotal: '840', lieuFait: 'Nice', dateFait: jourIso(0) } }));
  await msg(P.emma.id, gEmma, 'commun', 'Bonjour, à quelle heure commence notre prochain cours ?');
  if (gEmma) await etape('questionnaire', () => appel(F, '/api/qs/send', { group: gEmma, type: 'qs_mid', header: {
    nomApprenant: 'Emma BERNARD', societe: P.emma.profile.societe, langue: 'Espagnol', intitule: P.emma.profile.intitule, formateur: 'Sophie DUPONT', date: jourIso(0) } }));
  // le dossier vide : la création y dépose le règlement intérieur, et rien d'autre
  await etape('dossier de Hugo', () => appel(SIM_ADMIN, '/api/groups', { profIds: [F], eleveId: P.hugo.id }));
}
// ⚠️ LES NOTIFICATIONS REVIENNENT À CHAQUE ENTRÉE (21/09/2026, demande de l'utilisateur). Ouvrir
// un dossier ou vider la cloche SUPPRIME les notifications : sans ceci, en revenant dans la démo
// (la même, tant qu'elle tourne), on retrouvait une cloche vide et des dossiers sans pastille.
// Le serveur de démo photographie ses notifications à la fin de la préparation et les remet telles
// quelles à chaque nouvelle entrée. « Recommencer la démo » n'en a pas besoin : tout repart de zéro.
async function notifsSimulation(action) {
  try {
    const r = await fetch('http://127.0.0.1:' + simulation.port + '/api/simulation/notifications', {
      method: 'POST', body: JSON.stringify({ action }), signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id: SIM_ADMIN }, simulation.secret, { expiresIn: '5m' }) } });
    if (!r.ok) throw new Error('réponse ' + r.status);
  } catch (e) { console.error('🎭 simulation, notifications (' + action + ') :', e.message); }   // jamais bloquant
}
const simulationVivante = () => !!(simulation.pret && simulation.proc && simulation.proc.exitCode === null && simulation.port);
function demarrerSimulation(recommencer) {
  if (simulation.demarrage) return simulation.demarrage;   // deux clics simultanés : un seul démarrage
  // démo déjà lancée : on y retourne, et ses notifications reviennent comme au premier jour
  if (simulationVivante() && !recommencer) { simulation.derniere = Date.now(); return notifsSimulation('restaurer'); }
  simulation.demarrage = (async () => {
    await arreterSimulation();
    fs.rmSync(SIM_DIR, { recursive: true, force: true });
    fs.mkdirSync(SIM_DIR, { recursive: true });
    // ⚠️ le SECRET des jetons de la démo est posé ici, dans sa base neuve : le serveur principal peut
    // donc vérifier un jeton « sim. » AVANT de le relayer (un jeton forgé ne va jamais plus loin),
    // et en fabriquer sans qu'aucun mot de passe de la démo n'existe.
    simulation.secret = crypto.randomBytes(32).toString('hex');
    const inutilisable = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    const users = [{ id: SIM_ADMIN, prenom: 'Administration', nom: 'L&S', email: ADMIN_EMAIL, role: 'admin', passwordHash: inutilisable, profile: {} }]
      .concat(Object.values(SIM_PERSONNES).map(p => Object.assign({ passwordHash: inutilisable, dateCreation: Date.now() }, p)));
    // demoSeeded : pas de « Paul » ni de « Léa » dans la démo, seulement ses propres personnes
    fs.writeFileSync(path.join(SIM_DIR, 'db.json'), JSON.stringify({ secret: simulation.secret, demoSeeded: true, users }));
    const proc = fork(path.join(ROOT, 'server.js'), ['0'], { cwd: ROOT, env: envSimulation(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    // ⚠️ les sorties du serveur de démo DOIVENT être lues : un tube jamais vidé finit par bloquer le
    // processus qui écrit dedans (piège rencontré par la relecture adversariale du 17/09/2026).
    // (un lancement raté — trop de fichiers ouverts — rend des flux NULS : on ne les lit que s'ils existent)
    const relayer = (flux, vers) => flux && flux.on('data', d => String(d).split('\n').filter(Boolean).forEach(l => vers.write('🎭 ' + l + '\n')));
    relayer(proc.stdout, process.stdout); relayer(proc.stderr, process.stderr);
    proc.on('exit', () => { if (simulation.proc === proc) { simulation.proc = null; simulation.pret = false; simulation.port = null; } });
    // ⚠️ SANS cet écouteur, un lancement raté (mémoire épuisée, exécutable introuvable) émet un
    // « error » que personne n'écoute — et Node fait alors tomber le SITE ENTIER, pas la démo.
    let erreurLancement = null;
    // ⚠️ après une erreur de lancement, Node n'émet PAS « exit » : l'état est remis à zéro ici aussi
    proc.on('error', e => {
      erreurLancement = e; console.error('🎭 simulation : lancement impossible :', e.message);
      if (simulation.proc === proc) { simulation.proc = null; simulation.pret = false; simulation.port = null; }
    });
    simulation.proc = proc;
    try {
      simulation.port = await new Promise((ok, ko) => {
        const t = setTimeout(() => ko(new Error('le serveur de démonstration ne répond pas')), 20000);
        proc.on('message', m => { if (m && m.simulationPrete) { clearTimeout(t); ok(m.simulationPrete); } });
        proc.once('error', e => { clearTimeout(t); ko(e); });
        proc.once('exit', c => { clearTimeout(t); ko(new Error('le serveur de démonstration s\'est arrêté (code ' + c + ')')); });
      });
      await remplirSimulation();
      await notifsSimulation('photographier');
      // ⚠️ mort PENDANT le remplissage : chaque étape a échoué sans bruit, et sans ce contrôle la démo
      // se déclarait prête sans processus — plus aucune entrée ne fonctionnait pendant trois heures
      if (erreurLancement || simulation.proc !== proc || proc.exitCode !== null) throw new Error('le serveur de démonstration s\'est arrêté pendant sa préparation');
    } catch (e) { await arreterSimulation(); throw e; }
    simulation.pret = true; simulation.derniere = Date.now();
    console.log('🎭 simulation prête (port ' + simulation.port + ')');
  })().finally(() => { simulation.demarrage = null; });
  return simulation.demarrage;
}
// ⚠️ AUCUNE RÉPONSE DE L'API N'EST MISE EN CACHE PAR LE NAVIGATEUR. Depuis la simulation, deux
// identités (l'administrateur et la formatrice fictive) interrogent les MÊMES adresses dans le même
// navigateur (/api/me, /api/groups…) : une réponse gardée pour l'une pourrait être resservie à
// l'autre. Chrome, en particulier, garde un 410 SANS LIMITE DE DURÉE quand rien ne l'interdit — le
// premier jet du relais répondait 410 « simulation terminée », et cette réponse aurait pu revenir
// au vrai /api/me de l'administrateur, qui ne pouvait alors plus se connecter depuis ce navigateur
// (défaut trouvé par la relecture adversariale du 21/09/2026).
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
if (!SIMULATION) {
  setInterval(() => { if (simulation.pret && Date.now() - simulation.derniere > SIM_INACTIF) { console.log('🎭 simulation arrêtée (inactive)'); arreterSimulation(); } }, 10 * 60 * 1000).unref();
  process.on('exit', () => { if (simulation.proc) { try { simulation.proc.kill(); } catch (e) { } } });
  const SAUT_ENTETES = new Set(['connection', 'keep-alive', 'proxy-connection', 'upgrade', 'te', 'trailer']);
  const sansSaut = (h) => { const o = {}; for (const k in h) if (!SAUT_ENTETES.has(k.toLowerCase())) o[k] = h[k]; return o; };
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const h = req.headers.authorization || '';
    const parEntete = h.startsWith('Bearer sim.');
    const m = parEntete ? null : /[?&]token=sim\.([^&#]*)/.exec(req.originalUrl);
    if (!parEntete && !m) return next();
    // ⚠️ À PARTIR D'ICI, JAMAIS next() : une requête de démonstration ne doit en aucun cas
    // atteindre les vraies routes, même quand la démo est arrêtée ou que le jeton ne vaut rien.
    let brut = parEntete ? h.slice(11) : m[1];
    try { brut = decodeURIComponent(brut); } catch (e) { }
    // 401 et non 410 : un 410 est « définitivement parti », et les navigateurs se croient autorisés
    // à le garder en cache (voir plus haut).
    const fin = () => res.status(401).json({ error: 'Cette simulation est terminée.', simulationFinie: true });
    if (!simulationVivante()) return fin();
    try { jwt.verify(brut, simulation.secret); } catch (e) { return fin(); }
    simulation.derniere = Date.now();
    const entetes = sansSaut(req.headers);
    entetes.host = '127.0.0.1:' + simulation.port;
    if (parEntete) entetes.authorization = 'Bearer ' + brut;
    const chemin = parEntete ? req.originalUrl : req.originalUrl.replace(/([?&]token=)sim\./, '$1');
    const relais = http.request({ host: '127.0.0.1', port: simulation.port, method: req.method, path: chemin, headers: entetes }, r => {
      const h = sansSaut(r.headers); h['cache-control'] = 'no-store';
      res.writeHead(r.statusCode, h);
      r.pipe(res);
    });
    relais.on('error', () => { if (!res.headersSent) fin(); else res.end(); });
    // le navigateur abandonne (onglet fermé, téléchargement annulé) : on lâche aussi la demande
    // faite au serveur de démo, sinon la connexion restait ouverte jusqu'à son arrêt
    res.on('close', () => { if (!res.writableFinished) relais.destroy(); });
    req.pipe(relais);
  });
}

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
  /^\/lib(\/|$)/,                                                  // modules du serveur
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
  sendActivationMail(user, req.user, 'creation');
  res.json({ ok: true, user: pubFull(user) });
});
// lien d'activation : jeton aléatoire, à usage unique, valable 14 jours
function newActivation() { return { token: crypto.randomBytes(32).toString('hex'), envoyeLe: Date.now(), exp: Date.now() + 14 * 24 * 60 * 60 * 1000 }; }
// ⚠️ HISTORIQUE DES ENVOIS D'INVITATION (16/09/2026) : des apprenants n'ont rien reçu à la création
// de leur compte, et le site ne gardait AUCUNE trace de ce que le serveur d'envoi avait répondu
// (tout partait dans le journal du conteneur). Chaque envoi est désormais noté sur le compte,
// avec la réponse réelle d'OVH, et affiché dans la fenêtre « En attente ». ⚠️ « accepte » veut dire
// « pris en charge par le serveur d'envoi », PAS « arrivé dans la boîte » : la messagerie du
// destinataire peut encore le classer en indésirable ou le mettre en quarantaine.
// Le champ vit au premier niveau du compte (et non dans `activation`, supprimé à l'activation).
function noterEnvoi(user, type) {
  const e = { date: Date.now(), type, etat: 'en_cours' };
  user.envois = (user.envois || []).concat([e]).slice(-10);
  return (res) => { Object.assign(e, res, { fin: Date.now() }); save(); };
}
// type : 'creation' | 'relance' | 'oubli' (lien d'activation redemandé par « Mot de passe oublié »)
// ---- E-MAIL D'INVITATION (première connexion) -------------------------------
// ⚠️ DEUX VERSIONS, UNE PAR RÔLE (mises en service le 18/09/2026, brouillons relus et validés
// par l'utilisateur la veille) : ce qui attend un formateur — des dossiers, un canal privé, des
// documents à générer, un contrat à signer — n'a rien à voir avec ce qui attend un apprenant.
// ⚠️ CHAQUE AFFIRMATION A ÉTÉ VÉRIFIÉE DANS LE CODE avant d'être écrite (le bouton « Revoir la
// visite guidée » existe et s'affiche à tout non-admin ; l'apprenant reçoit bien un e-mail pour
// un questionnaire comme pour une feuille de présence ; le règlement intérieur est déposé
// d'office). Un e-mail qui promet un bouton qui n'existe pas est pire que pas d'e-mail du tout :
// toute retouche du texte se revérifie de la même façon.
// ⚠️ LE TEXTE BRUT ET LE HTML SORTENT DU MÊME TABLEAU : écrits deux fois, l'un des deux finirait
// par mentir. `**gras**` est rendu en HTML et simplement retiré en texte brut.
const INVITATION = {
  prof: {
    objet: 'Votre espace formateur est prêt — Languages & Success',
    titre: 'Bienvenue parmi nos formateurs',
    ouverture: 'Votre compte sur l\'espace documents de Languages & Success vient d\'être créé. C\'est ici que se passe le suivi de vos formations : les documents, les échanges avec vos apprenants et avec l\'administration, les signatures.',
    sections: [
      { titre: '2. Ce qui vous attend dans votre espace', puces: [
        '**Un dossier par apprenant.** L\'administration le crée et vous y ajoute : il apparaît alors dans « Mes dossiers », avec les documents et la messagerie de l\'apprenant.',
        '**Deux canaux par dossier.** La « Discussion commune » est partagée avec l\'apprenant. Le canal « Privé » est réservé aux formateurs et à l\'administration : l\'apprenant n\'y voit rien. C\'est par là que vous nous transmettez vos documents, et que vous recevrez votre contrat de sous-traitance à signer en ligne.',
        '**Des modèles prêts à l\'emploi.** Le bouton « Générer un document » propose worksheet, questionnaires, tests, attestation, Level Test et feuilles de présence, préremplis avec la fiche de l\'apprenant.',
        '**Des signatures sans papier.** Questionnaires, feuilles de présence et attestation de fin de formation partent directement chez l\'apprenant, qui les remplit ou les signe en ligne. Le document finalisé revient tout seul dans le dossier, et un e-mail vous prévient.',
        '**La cloche**, en haut de la page, signale chaque nouveau message et chaque nouveau document.',
      ] },
      { titre: '3. Laissez-vous guider', paras: [
        'Une fois votre mot de passe choisi, vous arrivez directement dans votre espace, où une visite guidée de deux minutes vous présente chaque bouton. Vous pourrez la relancer à tout moment avec **« Revoir la visite guidée »**, en haut de la page.',
        'Votre espace fonctionne sur ordinateur comme sur téléphone. Nous vous conseillons l\'**ordinateur** : les documents à générer et les formulaires à remplir y sont plus confortables.',
      ] },
    ],
    signature: ['À très bientôt,', 'L\'équipe Languages & Success'],
  },
  eleve: {
    objet: 'Votre espace de formation est prêt — Languages & Success',
    titre: 'Bienvenue chez Languages & Success',
    ouverture: 'Pour accompagner votre formation, nous vous avons ouvert un espace documents personnel. Vous y retrouverez au même endroit vos documents, vos échanges avec votre formateur et tout ce que vous aurez à remplir ou à signer.',
    sections: [
      { titre: '2. Ce qui vous attend dans votre espace', puces: [
        '**Votre dossier de formation**, partagé avec votre formateur et l\'équipe Languages & Success.',
        '**Vos documents**, à télécharger quand vous le souhaitez : ceux que votre formateur partage avec vous, et le règlement intérieur de l\'organisme, à lire dès votre arrivée. Vous pouvez aussi nous envoyer vos propres fichiers.',
        '**Une messagerie** pour poser vos questions à votre formateur ou à notre équipe.',
        '**Vos questionnaires et signatures en ligne.** Au fil de la formation, vous recevrez des questionnaires, des feuilles de présence et votre attestation de fin de formation. Un e-mail vous prévient, vous répondez ou signez en quelques clics (à la souris ou au doigt), puis le document est rangé dans votre dossier.',
      ] },
      { titre: '3. Laissez-vous guider', paras: [
        'Une fois votre mot de passe choisi, vous arrivez directement dans votre espace, où une visite guidée de deux minutes vous le présente. Vous pourrez la relancer à tout moment avec **« Revoir la visite guidée »**, en haut de la page.',
        'Votre espace fonctionne sur ordinateur comme sur téléphone. Nous vous conseillons l\'**ordinateur** : les documents et les questionnaires y sont plus confortables à lire et à remplir.',
      ] },
    ],
    signature: ['Bonne formation,', 'L\'équipe Languages & Success'],
  },
};
// ⚠️ Un lien RENVOYÉ (relance, ou « Mot de passe oublié ? » sur un compte jamais activé) ne peut
// pas dire « votre compte vient d'être créé » : il part parfois deux semaines après.
const INVITATION_RENVOI = 'Voici votre lien de première connexion à l\'espace documents de Languages & Success. Vous y retrouverez tout ce qui concerne votre formation.';
function invitationBlocs(user, url, type) {
  const m = INVITATION[user.role] || INVITATION.eleve;
  const sections = [{
    titre: '1. Choisissez votre mot de passe',
    paras: ['Votre identifiant : **' + user.email + '**'],
    cta: { libelle: 'Choisir mon mot de passe', url },
    apres: ['Ce lien est personnel, valable 14 jours et utilisable une seule fois. S\'il a expiré, cliquez sur « Mot de passe oublié ? » sur la page de connexion : un nouveau lien vous sera envoyé.'],
  }].concat(m.sections);
  return { m, intro: ['Bonjour ' + user.prenom + ',', type === 'creation' ? m.ouverture : INVITATION_RENVOI], sections };
}
// Texte brut tiré des MÊMES blocs (les puces deviennent des tirets, le bouton devient l'adresse).
function invitationTexte(b) {
  const nu = s => String(s).replace(/\*\*/g, '');
  const lignes = b.intro.map(nu);
  for (const s of b.sections) {
    lignes.push('', s.titre.toUpperCase());
    (s.paras || []).forEach(p => lignes.push(nu(p)));
    if (s.cta) lignes.push('', s.cta.libelle + ' : ' + s.cta.url);
    (s.apres || []).forEach(p => lignes.push('', nu(p)));
    (s.puces || []).forEach(p => lignes.push('- ' + nu(p)));
  }
  return lignes.concat(['', ...b.m.signature]).join('\n');
}
function sendActivationMail(user, byUser, type) {
  const url = SITE_URL + '/espace-documents.html#activation=' + user.activation.token;
  const suivi = noterEnvoi(user, type || 'relance');
  // ⚠️ Un compte administrateur garde le message court : les deux versions décrivent un espace
  // de formateur ou d'apprenant, qui n'est pas le sien. (Cas de bord : `reinvite` refuse déjà un
  // compte admin, seul « Mot de passe oublié ? » sur un admin jamais activé passerait ici.)
  if (user.role === 'admin') {
    return sendMailSafe(user.email, 'Votre compte espace documents est prêt — Languages & Success',
      'Bonjour ' + user.prenom + ',\n\nChoisissez votre mot de passe (lien valable 14 jours) :\n' + url + '\n\nCe lien est personnel : ne le transmettez à personne.\n\nLanguages & Success',
      mailHtml('Votre compte est prêt ✓',
        ['Bonjour ' + user.prenom + ',', 'Identifiant : ' + user.email,
         'Il ne reste qu\'à choisir votre mot de passe. Ce lien est personnel et valable 14 jours.'],
        'Choisir mon mot de passe', url),
      { suivi });
  }
  const b = invitationBlocs(user, url, type || 'relance');
  sendMailSafe(user.email, b.m.objet, invitationTexte(b),
    mailHtmlSections(b.m.titre, b.intro, b.sections, b.m.signature), { suivi });
}
const activationOf = (t) => db.users.find(u => u.activation && u.activation.token === t && u.activation.exp > Date.now());
// vérifie le lien avant d'afficher le formulaire (nom affiché, pas de fuite d'information)
app.get('/api/activate/:token', (req, res) => {
  const u = activationOf(req.params.token);
  // ⚠️ message COURT : l'écran « Lien expiré » ajoute la marche à suivre (« Mot de passe oublié ? »,
  // qui renvoie un lien d'activation neuf à un compte jamais activé). Il disait « demandez-en un
  // nouveau à l'administration », ce qui envoyait la personne écrire un e-mail pour rien.
  if (!u) return res.status(404).json({ error: 'Ce lien est invalide ou a expiré.' });
  res.json({ ok: true, prenom: u.prenom, email: u.email });
});
// la personne choisit son mot de passe : le jeton est consommé et elle est connectée
app.post('/api/activate', async (req, res) => {
  const { token, password } = req.body || {};
  const u = activationOf(token);
  if (!u) return res.status(404).json({ error: 'Ce lien est invalide ou a expiré.' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
  u.passwordHash = await bcrypt.hash(String(password), 10);
  delete u.activation;                       // usage unique
  delete u.mustActivate;
  oublierEchecsConnexion(u.email, clientIp(req));   // elle vient de prouver que c'est bien elle
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
  oublierEchecsConnexion(u.email, clientIp(req));   // le mot de passe a changé : l'ardoise n'a plus de sens
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
// ⚠️ ANTI-BOMBARDEMENT (17/09/2026, question de l'utilisateur : « il peut pas spam le bouton ? »).
// Ce formulaire est PUBLIC et déclenche un envoi d'e-mail : sans garde-fou, n'importe qui pouvait
// demander des liens en boucle et noyer la boîte de quelqu'un dont il connaît l'adresse — en brûlant
// au passage notre quota d'envoi OVH et la réputation du domaine. Deux verrous, l'un sur l'IP,
// l'autre sur l'ADRESSE (une IP changeante ne suffit donc pas à contourner) :
const RESET_PAR_IP = 8;                          // demandes par IP et par 10 min (fenêtre de tropDeDemandes)
const RESET_ATTENTE = 3 * 60 * 1000;             // délai minimal entre deux e-mails pour une même adresse
const RESET_PAR_JOUR = 5;                        // e-mails par adresse et par 24 h
// ⚠️ Quand l'adresse est bridée, la réponse reste **200 {ok:true}**, identique au cas normal et au cas
// « adresse inconnue » : sinon ce formulaire dirait qui a un compte et qui vient d'en demander un.
// Le compte porte les horodatages de ses 10 dernières demandes (`demandesLien`) : la bride SUIT donc
// l'adresse, quelle que soit l'IP, et survit à un redémarrage du serveur.
function lienTropDemande(u) {
  const maintenant = Date.now();
  const recentes = (u.demandesLien || []).filter(t => maintenant - t < 24 * 60 * 60 * 1000);
  const trop = recentes.length >= RESET_PAR_JOUR || (recentes.length && maintenant - Math.max(...recentes) < RESET_ATTENTE);
  u.demandesLien = recentes.slice(-9).concat(trop ? [] : [maintenant]);   // une demande bridée n'allonge pas la file
  if (trop) console.log('✉ demande de lien bridée pour ' + u.email + ' (' + recentes.length + ' dans les 24 h)');
  return trop;
}
app.post('/api/password-reset/request', (req, res) => {
  const mail = String((req.body || {}).email || '').trim().toLowerCase();
  if (tropDeDemandes(clientIp(req), 'reset', RESET_PAR_IP)) return res.status(429).json({ error: 'Trop de demandes. Patientez quelques minutes puis réessayez.' });
  const u = mail ? db.users.find(x => x.email === mail) : null;
  if (u && !lienTropDemande(u)) {
    // ⚠️ Un compte encore en attente d'activation reçoit son lien d'ACTIVATION, pas un lien de
    // réinitialisation : c'est le même besoin (choisir un mot de passe) et cela évite de lui
    // poser deux jetons de natures différentes. Son invitation n'est pas écrasée pour autant.
    if (u.mustActivate) {
      if (!u.activation || u.activation.exp < Date.now()) u.activation = newActivation();
      sendActivationMail(u, null, 'oubli');
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
  // ⚠️ RÉPONSE IDENTIQUE que l'adresse existe ou non, et qu'un e-mail soit parti ou non : sinon ce
  // formulaire public devient un annuaire qui dit qui est client de l'organisme.
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
  // ⚠️ Sans cet oubli, quelqu'un qui débloque son compte par « Mot de passe oublié ? » serait
  // encore retenu par l'attente en cours à sa prochaine connexion : l'issue de secours que
  // désigne le message « Trop de tentatives » ne mènerait nulle part.
  oublierEchecsConnexion(u.email, clientIp(req));
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
  sendActivationMail(u, req.user, 'relance');
  res.json({ ok: true });
});
// IP réelle du visiteur (derrière le tunnel Cloudflare en prod, direct en local)
function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
// ---- ANTI-FORCE BRUTE SUR LA CONNEXION (17/09/2026, demande de l'utilisateur) ---------------
// Rien ne comptait les essais : bcrypt ralentit chaque tentative (~100 ms) mais n'en refuse
// aucune, et un mot de passe peut n'avoir que 6 caractères. Deux freins, comme pour le lien de
// mot de passe oublié — mais pensés pour qu'on ne puisse JAMAIS prendre un compte en otage.
const LOGIN_LIBRE = 5;                  // échecs tolérés sans la moindre attente : taper de travers ne gêne personne
const LOGIN_ATTENTES = [60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3, 15 * 60e3];   // puis attente avant l'essai suivant
// ⚠️ Garde-fou contre la RAFALE, seul frein qui vise une IP ENTIÈRE : il compte les essais qui
// vont jusqu'à la vérification du mot de passe, à un niveau qu'aucun usage normal n'atteint
// (60 en 10 min depuis une même adresse, quand un bureau de dix personnes en fait dix par jour).
// Sans lui, mille requêtes lancées EN MÊME TEMPS franchissent tous les contrôles avant que le
// moindre compteur ne bouge, chacune occupant le serveur ~100 ms de bcrypt.
// ⚠️⚠️ IL N'Y A PLUS DE QUOTA D'ÉCHECS PAR IP (il a existé quelques heures le 17/09/2026, à 20
// échecs / 10 min ; la relecture adversariale l'a démoli et il a été retiré avant d'être mis en
// ligne). Deux défauts, tous deux reproduits : (1) il REFUSAIT DES IDENTIFIANTS CORRECTS — le
// contrôle a lieu avant même de chercher le compte, donc la collègue et l'administrateur,
// derrière le même NAT, recevaient « Trop de tentatives » avec le bon mot de passe ; (2) RIEN ne
// le remettait à zéro (ni une connexion réussie, ni une réinitialisation : `oublierEchecsConnexion`
// ne touche que `echecsConnexion`), et une seule personne le remplissait sans jamais rencontrer
// d'attente, en essayant quatre orthographes de son adresse (chacune rouvre ses 5 essais libres).
// Ce qu'il apportait contre l'essai d'un mot de passe sur tous les comptes est négligeable ici
// (~15 comptes : le sondage tient largement sous n'importe quel quota), et l'attente par couple
// reste la vraie barrière compte par compte.
const LOGIN_RAFALE_IP = 60;
// Refus « ce compte n'est pas encore activé » : seau SÉPARÉ, par IP et par 10 min. Ce chemin ne
// vérifie aucun mot de passe et ne peut donc pas porter d'attente personnelle, mais sa réponse
// dit qu'un compte existe : le seau borne l'énumération. ⚠️ SÉPARÉ, justement, pour qu'une
// personne dont l'invitation dort en quarantaine (le cas réel d'allios.fr) ne ferme pas la
// connexion à tout son bureau en cliquant vingt fois « Se connecter ».
const LOGIN_NON_ACTIVE_IP = 20;
const LOGIN_OUBLI = 30 * 60 * 1000;     // 30 min sans échec : le compteur repart de zéro
// ⚠️⚠️ L'ATTENTE EST COMPTÉE PAR (IP + ADRESSE), JAMAIS PAR ADRESSE SEULE. Une bride par adresse
// seule transformerait ce garde-fou en arme : il suffirait d'une requête toutes les 15 min sur
// l'adresse de Jenny pour qu'elle ne puisse plus jamais se connecter, en pleine séance. Ici,
// l'attaquant ne bloque que LUI-MÊME ; le titulaire, qui vient d'une autre IP, n'est pas touché.
// Le frein contre l'essai d'un même mot de passe sur tous les comptes, lui, est le quota d'IP.
// ⚠️ EN MÉMOIRE et non sur le compte : (1) écrire sur le compte appellerait save(), qui réécrit
// TOUT db.json — une attaque de mots de passe deviendrait une attaque sur le disque ; (2) la
// table porte aussi les adresses INCONNUES, qui n'ont aucun compte où écrire. Un redémarrage
// remet les compteurs à zéro, ce qui est acceptable ici (personne d'autre que nous ne le
// provoque), là où la bride du lien de mot de passe oublié se compte en jours et vit, elle, sur
// le compte.
const echecsConnexion = new Map();
const cleEchec = (ip, mail) => ip + '|' + mail;
function attenteConnexion(cle) {
  const e = echecsConnexion.get(cle);
  if (!e) return 0;
  const maintenant = Date.now();
  if (maintenant - e.dernier > LOGIN_OUBLI) { echecsConnexion.delete(cle); return 0; }
  // ⚠️ « + 1 » : l'attente commence DÈS que les 5 essais libres sont consommés. Sans lui, le
  // 6e essai passait encore et LOGIN_LIBRE valait 6 dans les faits (défaut attrapé au banc).
  const rang = e.n - LOGIN_LIBRE + 1;
  if (rang < 1) return 0;
  return Math.max(0, e.dernier + LOGIN_ATTENTES[Math.min(rang, LOGIN_ATTENTES.length) - 1] - maintenant);
}
// ⚠️ Un essai REFUSÉ pour cause d'attente n'est PAS noté : sinon celui qui martèle rallongerait
// sa punition sans fin, et l'attente ne retomberait jamais.
function noterEchecConnexion(cle) {
  const maintenant = Date.now();
  const e = echecsConnexion.get(cle) || { n: 0, dernier: 0 };
  echecsConnexion.set(cle, { n: (maintenant - e.dernier > LOGIN_OUBLI ? 0 : e.n) + 1, dernier: maintenant });
  // la table ne doit pas grossir sans fin (mêmes précautions que les quotas de formulaire)
  if (echecsConnexion.size > 5000) {
    for (const [k, v] of echecsConnexion) { if (maintenant - v.dernier > LOGIN_OUBLI) echecsConnexion.delete(k); }
  }
}
// Efface l'ardoise du POSTE d'où vient la personne, quand elle prouve qu'elle est bien elle
// (connexion réussie, activation, réinitialisation, changement de mot de passe). Sans cela,
// quelqu'un qui débloque son compte par « Mot de passe oublié ? » resterait retenu par l'attente
// en cours à sa connexion suivante depuis ce même poste.
// ⚠️⚠️ BORNÉ À L'IP DE LA REQUÊTE, jamais à toutes. Effacer partout faisait du 429 un MOUCHARD
// (défaut trouvé et reproduit par la relecture adversariale du 17/09/2026) : quelqu'un met une
// adresse en attente depuis chez lui, puis la sonde — un essai déjà refusé ne coûte rien, ne
// laisse aucune trace et ne rallonge rien. Le jour où le 429 retombe en 401, il sait que
// l'adresse a un compte chez nous ET que son titulaire vient d'ouvrir sa session, à la minute
// près. C'est exactement l'énumération que les messages identiques et le hachage factice
// cherchent à empêcher. Une attente n'appartient qu'au couple (IP + adresse) : la seule qui
// puisse retenir la personne est celle de son poste, les autres ne la gênent pas.
function oublierEchecsConnexion(mail, ip) {
  echecsConnexion.delete(cleEchec(String(ip || ''), String(mail || '').trim().toLowerCase()));
}
// ⚠️ Hachage FACTICE, comparé quand l'adresse est inconnue : sans lui la réponse revient
// immédiatement pour une adresse qui n'existe pas, et après ~100 ms de bcrypt pour une adresse
// connue. Le TEMPS de réponse disait donc qui a un compte chez nous, et tout le soin pris à
// rendre les messages identiques n'y changeait rien.
const HASH_FACTICE = bcrypt.hashSync('adresse inconnue - egalise le temps de reponse', 10);
const MSG_TROP_ESSAIS = 'Trop de tentatives de connexion. Patientez quelques minutes, puis réessayez ou cliquez sur « Mot de passe oublié ? ».';
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const ip = clientIp(req);
  // ⚠️ AVANT toute autre réponse, et sans regarder si le compte existe : sinon ce sont les refus
  // pour excès d'essais qui diraient qui a un compte, à la place des messages qu'on a pris soin
  // de rendre identiques.
  const attente = attenteConnexion(cleEchec(ip, mail));
  if (attente > 0 || quotaAtteint(ip, 'rafale', LOGIN_RAFALE_IP)) {
    res.set('Retry-After', String(Math.ceil((attente || QUOTA_FENETRE) / 1000)));
    return res.status(429).json({ error: MSG_TROP_ESSAIS });
  }
  const user = db.users.find(u => u.email === mail);
  // compte créé mais jamais activé : on l'explique au lieu du sec « mot de passe incorrect »
  // (un lien renvoyé à quelqu'un qui a DÉJÀ son mot de passe ne le bloque pas : mustActivate absent)
  if (user && user.mustActivate) {
    // ⚠️ Seau à part (voir LOGIN_NON_ACTIVE_IP) : aucun mot de passe n'est essayé ici, donc pas
    // d'attente personnelle, mais la réponse dit qu'un compte existe — au-delà de 20 par IP et
    // par 10 min, on cesse de le dire. Ce refus ne ferme QUE ce chemin : les autres personnes du
    // même bureau continuent de se connecter normalement.
    if (tropDeDemandes(ip, 'attente', LOGIN_NON_ACTIVE_IP)) {
      res.set('Retry-After', String(Math.ceil(QUOTA_FENETRE / 1000)));
      return res.status(429).json({ error: MSG_TROP_ESSAIS });
    }
    const vivant = user.activation && user.activation.exp > Date.now();
    return res.status(403).json({
      error: vivant
        ? 'Ce compte n\'est pas encore activé : utilisez le lien « Choisir mon mot de passe » reçu par e-mail.'
        : 'Ce compte n\'est pas encore activé et votre lien a expiré. Cliquez sur « Mot de passe oublié ? » : un nouveau lien vous sera envoyé.'
    });
  }
  // ⚠️ L'ESSAI EST NOTÉ AVANT LA COMPARAISON, et effacé plus bas s'il était bon. Le noter après
  // laisserait une fenêtre de ~100 ms (le temps de bcrypt) pendant laquelle des requêtes
  // simultanées passeraient TOUTES le contrôle : le frein ne freinerait que les impatients qui
  // essaient l'un après l'autre.
  noterEchecConnexion(cleEchec(ip, mail));
  tropDeDemandes(ip, 'rafale', LOGIN_RAFALE_IP);   // enregistré ici, donc sans compter les refus d'emblée
  // ⚠️ La comparaison a lieu MÊME si l'adresse est inconnue (hachage factice) : voir plus haut,
  // c'est le temps de réponse qui trahissait l'existence d'un compte.
  const bonMotDePasse = await bcrypt.compare(String(password || ''), user ? user.passwordHash : HASH_FACTICE);
  if (!user || !bonMotDePasse) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  oublierEchecsConnexion(mail, ip);   // elle a prouvé que c'était bien elle : l'ardoise de son poste est effacée
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
// Entrer en simulation (bouton « 🎭 Simulation », administration seulement) : démarre le serveur de
// démonstration s'il ne tourne pas, puis rend un jeton « sim. » au nom de la formatrice fictive.
// { recommencer: true } efface tout ce qui a été fait dans la démo et la reconstruit à neuf.
// ⚠️ Le jeton de la démo ne vaut RIEN ici : il est signé avec le secret de la démo, pas celui du
// site, et le relais l'intercepte avant qu'il n'atteigne une seule route réelle.
// Côté SERVEUR DE DÉMO uniquement : photographier / remettre les notifications (voir notifsSimulation).
// ⚠️ Réservée au compte d'administration INTERNE de la démo, dont le jeton ne quitte jamais le serveur
// principal : la formatrice fictive — seul jeton que le navigateur détienne et que le relais transmette —
// reçoit 403. La route n'existe pas du tout sur le vrai site.
if (SIMULATION) {
  let notifsInitiales = null;
  app.post('/api/simulation/notifications', auth, (req, res) => {
    if (req.user.id !== SIM_ADMIN) return res.status(403).json({ error: 'Accès refusé.' });
    const action = (req.body || {}).action;
    if (action === 'photographier') { notifsInitiales = JSON.parse(JSON.stringify(db.notifs)); return res.json({ ok: true, n: notifsInitiales.length }); }
    if (action === 'restaurer' && notifsInitiales) { db.notifs = JSON.parse(JSON.stringify(notifsInitiales)); save(); return res.json({ ok: true, n: db.notifs.length }); }
    res.status(400).json({ error: 'Action impossible.' });
  });
}
if (!SIMULATION) app.post('/api/admin/simulation', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  try {
    await demarrerSimulation(!!(req.body || {}).recommencer);
    res.json({ token: 'sim.' + jwt.sign({ id: SIM_PERSONNES.formatrice.id }, simulation.secret, { expiresIn: '12h' }) });
  } catch (e) {
    console.error('🎭 simulation :', e.message);
    res.status(500).json({ error: 'La simulation n\'a pas pu démarrer. Réessayez dans un instant.' });
  }
});

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
  const liste = groupsForUser(req.user);
  // l'administration lit ses dossiers dans le même ordre que la vue globale (par formateur)
  const tries = req.user.role === 'admin' ? ordreAdmin().trierGroupes(liste) : liste.sort((a, b) => b.date - a.date);
  res.json({ groups: tries.map(g => groupView(g, req.user)) });
});
// libellé « Prénom Nom (Formateur) + … » utilisé dans les notifications et la vue admin
// ⚠️ FORMATEUR(S) D'ABORD, puis l'apprenant (16/09/2026, demande de l'utilisateur : la vue globale
// se lit par formateur ; avant, l'apprenant venait en premier).
const membersLabel = (g) => [
  ...gProfs(g).map(id => `${fullName(id)} (Formateur)`),
  ...(g && g.eleve ? [`${fullName(g.eleve)} (Apprenant)`] : [])
].join(' + ') || '(dossier vide)';
// ---- ordre de lecture de l'administration (16/09/2026) --------------------------------------
// Les dossiers sont regroupés PAR FORMATEUR, dans l'ordre de création des comptes formateurs
// (celui de la liste des comptes : le plus ancien d'abord), puis du plus récent au plus ancien
// dans chaque groupe. Un dossier à plusieurs formateurs se range sous CELUI QUI OUVRE SON LIBELLÉ
// (le premier de sa liste, triée par nom) : on le trouve là où son nom l'annonce. Les comptes suivent
// le même fil : l'administration, puis chaque formateur suivi des apprenants de ses dossiers, puis
// ce qui reste (apprenant sans dossier…).
function ordreAdmin() {
  const rang = new Map();
  db.users.filter(u => u.role === 'prof').forEach((u, i) => rang.set(u.id, i));
  const premierProf = (g) => gProfs(g).find(id => rang.has(id)) || null;
  const rangDe = (g) => { const p = premierProf(g); return p === null ? Infinity : rang.get(p); };
  const trierGroupes = (liste) => liste.slice().sort((a, b) => {
    const ra = rangDe(a), rb = rangDe(b);
    return ra !== rb ? (ra < rb ? -1 : 1) : (b.date - a.date);
  });
  const trierComptes = (liste) => {
    const vus = new Set(), out = [];
    const ajouter = (u) => { if (u && !vus.has(u.id)) { vus.add(u.id); out.push(u); } };
    const groupes = trierGroupes(db.groups);
    liste.filter(u => u.role === 'admin').forEach(ajouter);
    liste.filter(u => u.role === 'prof').forEach(p => {
      ajouter(p);
      groupes.filter(g => premierProf(g) === p.id).forEach(g => ajouter(liste.find(u => u.id === g.eleve)));
    });
    liste.forEach(ajouter);
    return out;
  };
  return { trierGroupes, trierComptes };
}
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
// ---- règlement intérieur déposé d'office dans tout NOUVEAU dossier (11/09/2026) ------------
// Qualiopi demande que le règlement intérieur soit porté à la connaissance de l'apprenant : il
// est donc copié dans le canal commun dès la création du dossier, comme un document ordinaire
// (l'administration peut le supprimer, et la suppression du dossier l'emporte avec le reste).
// ⚠️ COPIE et non référence partagée vers assets/ : un document de db.docs pointe un fichier de
// data/uploads/ que `deleteGroupCascade` SUPPRIME — référencer le modèle le ferait disparaître
// à la première suppression de dossier, pour tous les dossiers à la fois.
// ⚠️ Ne vaut QUE pour les nouveaux dossiers (demande de l'utilisateur) : rien n'est ajouté
// rétroactivement à ceux qui existent déjà.
// ⚠️ Jamais bloquant : fichier absent ou disque en erreur, le dossier se crée quand même.
const RI_SOURCE = path.join(ROOT, 'assets', 'reglement-interieur.pdf');
const RI_NOM = 'Règlement intérieur - Languages & Success.pdf';
function deposerReglementInterieur(g, par) {
  try {
    if (!fs.existsSync(RI_SOURCE)) { console.warn('📄 règlement intérieur absent de assets/ : non déposé'); return false; }
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const stored = crypto.randomUUID() + '.pdf';
    fs.copyFileSync(RI_SOURCE, path.join(UPLOADS_DIR, stored));
    db.docs.push({
      id: crypto.randomUUID(), group: g.id, channel: 'commun',
      from: par.id, fromAdmin: true, name: RI_NOM,
      size: fs.statSync(RI_SOURCE).size, type: 'application/pdf',
      stored, date: Date.now()
    });
    return true;
  } catch (e) { console.error('📄 règlement intérieur non déposé :', e.message); return false; }
}

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
  // le règlement intérieur attend l'apprenant dans le dossier dès son ouverture. Pas de
  // notification : la personne en reçoit déjà une pour son ajout au dossier, deux alertes
  // pour le même événement seraient du bruit.
  deposerReglementInterieur(g, req.user);
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
  // l'adresse est vérifiée AVANT toute modification : un refus ne doit rien laisser à moitié changé
  const mail = email != null ? String(email).trim().toLowerCase() : '';
  if (mail && mail !== u.email && db.users.some(x => x.id !== u.id && x.email === mail)) return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });
  const avant = ficheReportable(u);
  if (prenom != null && sTrim(prenom)) u.prenom = sTrim(prenom);
  if (nom != null && sTrim(nom)) u.nom = sTrim(nom);
  const mailChange = !!(mail && mail !== u.email);
  if (mail) u.email = mail;
  if (profile != null) u.profile = cleanProfile(u.role, Object.assign({}, u.profile, profile));
  const reportes = reporterFiche(u, avant);
  // ⚠️ ADRESSE CORRIGÉE SUR UN COMPTE EN ATTENTE → L'INVITATION REPART TOUTE SEULE (22/09/2026, demande de
  // l'utilisateur). Le cas réel : une faute de frappe à la création, la personne n'a donc jamais rien reçu ;
  // corriger l'adresse ne servait à rien tant qu'on ne pensait pas à cliquer « Envoyer une relance ».
  // Le lien est RÉGÉNÉRÉ : l'ancien est parti à une adresse qui n'est pas la sienne, il ne doit plus valoir.
  // Un compte déjà activé ne reçoit rien : son mot de passe reste valable, seul son identifiant change.
  let invitationRenvoyee = false;
  if (mailChange && u.mustActivate && u.role !== 'admin') {
    u.activation = newActivation(); u.relances = (u.relances || 0) + 1; u.derniereRelance = Date.now(); invitationRenvoyee = true;
  }
  save();
  if (invitationRenvoyee) sendActivationMail(u, req.user, 'relance');
  res.json({ ok: true, user: pubFull(u), reportes, invitationRenvoyee });
});
// ⚠️ REPORTER UNE FICHE CORRIGÉE (16/09/2026) : le brouillon d'Interactive Worksheet d'un dossier est
// ENREGISTRÉ (une fois créé, il ne se relit plus depuis la fiche), et un document envoyé pour
// signature ou pour remplissage garde les valeurs saisies à l'envoi. Renommer « Christiane » en
// « Vanessa » laissait donc « Christiane ZOUGGARI » sur le worksheet de son dossier (cas réel).
// On remplace l'ANCIENNE valeur par la nouvelle, UNIQUEMENT là où le champ contient encore exactement
// l'ancienne valeur : une saisie personnalisée n'est jamais écrasée. Les documents déjà signés ou
// remplis, eux, sont des pièces définitives : on n'y touche pas.
function ficheReportable(u) {
  const p = u.profile || {};
  return { nom: `${u.prenom} ${u.nom}`, email: u.email, tel: p.tel, societe: p.societe, intitule: p.intitule,
    naissance: p.dateNaissance, nationalite: p.nationalite, adresse: p.adresse, siret: p.siret, nda: p.nda };
}
function reporterFiche(u, avant) {
  const apres = ficheReportable(u);
  let n = 0;
  const rempl = (obj, champ, cle) => {
    const a = avant[cle], b = apres[cle];
    if (obj && a && b != null && a !== b && obj[champ] === a) { obj[champ] = b; n++; }
  };
  const enAttente = (liste, g) => liste.filter(x => x.group === g.id && x.status !== 'done');
  if (u.role === 'eleve') {
    for (const g of db.groups.filter(x => x.eleve === u.id)) {
      const w = wsFind(g.id);
      if (w && w.header) [['nomApprenant', 'nom'], ['mailApprenant', 'email'], ['telApprenant', 'tel'], ['societe', 'societe'], ['intitule', 'intitule']].forEach(([c, k]) => rempl(w.header, c, k));
      enAttente(db.qs, g).forEach(q => [['nomApprenant', 'nom'], ['societe', 'societe'], ['intitule', 'intitule']].forEach(([c, k]) => rempl(q.header, c, k)));
      enAttente(db.presences, g).forEach(p => rempl(p.fields, 'apprenant', 'nom'));
      enAttente(db.attestations, g).forEach(a => [['apprenant', 'nom'], ['societe', 'societe'], ['intitule', 'intitule']].forEach(([c, k]) => rempl(a.fields, c, k)));
      enAttente(db.contrats, g).forEach(c => [['stagiaire', 'nom'], ['intitule', 'intitule']].forEach(([ch, k]) => rempl(c.fields, ch, k)));
    }
  } else if (u.role === 'prof') {
    for (const g of db.groups.filter(x => gProfs(x).includes(u.id))) {
      const w = wsFind(g.id);
      if (w && w.header) {
        [['nomFormateur', 'nom'], ['mailFormateur', 'email'], ['telFormateur', 'tel']].forEach(([c, k]) => rempl(w.header, c, k));
        (w.sessions || []).forEach(s => rempl(s, 'formateur', 'nom'));
      }
      enAttente(db.qs, g).forEach(q => rempl(q.header, 'formateur', 'nom'));
      enAttente(db.presences, g).forEach(p => rempl(p.fields, 'formateur', 'nom'));
      enAttente(db.attestations, g).forEach(a => rempl(a.fields, 'formateur', 'nom'));
      enAttente(db.contrats, g).filter(c => c.prof === u.id).forEach(c => [['stnom', 'nom'], ['stNaissance', 'naissance'], ['stNationalite', 'nationalite'], ['stAdresse', 'adresse'], ['stSiret', 'siret'], ['stNda', 'nda']].forEach(([ch, k]) => rempl(c.fields, ch, k)));
    }
  }
  return n;
}

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
  const auteur = realUser(qs.by) || u;
  try {
    const buf = await buildQsDocx(qs, tpl, auteur, versionModele(qs.type));
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
  const auteur = realUser(p.by) || u;
  const d = Object.assign({}, p.fields, { formateurSig: p.formateurSig, apprenantSig: p.apprenantSig });
  try {
    const buf = await buildPresenceDocx(p.type, d, auteur, versionModele('presence-' + p.type));
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
  const ordre = ordreAdmin();
  const groups = ordre.trierGroupes(db.groups).map(g => ({
    id: g.id, label: membersLabel(g),
    profs: gProfs(g).map(id => ({ id, name: fullName(id) })),
    eleve: g.eleve ? { id: g.eleve, name: fullName(g.eleve) } : null,
    docs: db.docs.filter(d => d.group === g.id).length, date: g.date
  }));
  const docs = db.docs.slice().sort((a, b) => b.date - a.date).map(d => { const g = groupById(d.group); return Object.assign(docPub(d), { groupLabel: g ? membersLabel(g) : '—' }); });
  // `pending` = compte créé mais mot de passe pas encore choisi (jamais le jeton lui-même)
  const users = ordre.trierComptes(db.users).map(u => Object.assign(pubFull(u), {
    pending: !!u.mustActivate,
    // ⚠️ JAMAIS le jeton lui-même : seulement des dates.
    dateCreation: u.dateCreation || (u.activation && u.activation.exp ? u.activation.exp - 14 * 24 * 60 * 60 * 1000 : null),
    invitationEnvoyee: (u.activation && (u.activation.envoyeLe || (u.activation.exp ? u.activation.exp - 14 * 24 * 60 * 60 * 1000 : null))) || null,
    invitationExpire: (u.activation && u.activation.exp) || null,
    relances: u.relances || 0,
    derniereRelance: u.derniereRelance || null,
    // sort réel des invitations envoyées (réponse du serveur d'envoi), jamais le lien lui-même
    envois: (u.envois || []).map(e => ({ date: e.date, type: e.type, etat: e.etat, reponse: e.reponse || null, erreur: e.erreur || null })),
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
// ---- CARACTÈRES HORS HELVETICA (21/09/2026, défaut signalé par l'utilisateur sur l'Interactive
// Worksheet de Yohan MARCHAND, case « Structure et grammaire ») ---------------------------------
// Les polices standard de pdfkit ne connaissent que l'alphabet d'Europe de l'Ouest (WinAnsi). Tout
// autre caractère sortait EN CHARABIA, sans la moindre erreur : « since 3 years → for 3 years »
// devenait « since 3 years !’ for 3 years », « ≠ » devenait « "` », la phonétique /ɪd/ « /&¦Bð » —
// et un mot russe, serbe ou hongrois (langues enseignées) une suite de signes. Exactement ce que
// les formateurs tapent en grammaire, en prononciation et dans les listes de mots.
// ⚠️ Correctif CENTRAL : pdfUnicode() enveloppe text / heightOfString / widthOfString du document.
// Une chaîne qui contient un caractère hors WinAnsi est composée en DejaVu Sans (lib/polices/, libre),
// de même graisse, puis la police d'origine est remise. ⚠️ UNE CHAÎNE SANS CARACTÈRE SPÉCIAL NE CHANGE
// PAS D'UN OCTET : les documents déjà produits restent identiques, aucune version de modèle n'avance.
// ⚠️ La chaîne ENTIÈRE change de police, pas le seul caractère : mélanger deux polices dans une ligne
// demanderait de refaire le repli des lignes de pdfkit. DejaVu étant plus large qu'Helvetica, le corps
// est réduit à 93 % pour que la case garde le même gris que ses voisines.
// ⚠️ Non couverts : chinois, japonais, coréen (une police CJK pèse 16 Mo) — ils sortent en cases vides
// « □ », ce qui est honnête, et non plus en signes trompeurs. Le Word, lui, n'a jamais eu ce défaut
// (Word choisit seul une police de repli).
const PDF_HORS_WINANSI = /[^\u0000-\u007F\u00A0-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/;
const PDF_REPLI = { 'Helvetica': 'DejaVuSans', 'Helvetica-Bold': 'DejaVuSans-Bold', 'Helvetica-Oblique': 'DejaVuSans-Oblique', 'Helvetica-BoldOblique': 'DejaVuSans-BoldOblique' };
const PDF_REPLI_CORPS = 0.93;
const pdfPolices = {};   // lues une seule fois ; absentes → les documents sortent comme avant, jamais d'échec
for (const n of Object.values(PDF_REPLI)) { try { pdfPolices[n] = fs.readFileSync(path.join(ROOT, 'lib', 'polices', n + '.ttf')); } catch (e) { console.error('police de repli absente :', n); } }
// exécute f() avec la police de repli si `chaine` en a besoin ; rend la main dans l'état d'origine
function pdfAvecRepli(doc, chaine, f) {
  const nom = doc._font && doc._font.name, repli = PDF_REPLI[nom];
  if (!repli || !pdfPolices[repli] || !PDF_HORS_WINANSI.test(String(chaine == null ? '' : chaine))) return f();
  const corps = doc._fontSize;
  doc.font(repli).fontSize(corps * PDF_REPLI_CORPS);
  try { return f(); } finally { doc.font(nom).fontSize(corps); }
}
function pdfUnicode(doc) {
  for (const n of Object.keys(pdfPolices)) doc.registerFont(n, pdfPolices[n]);
  ['text', 'heightOfString', 'widthOfString'].forEach(m => {
    const origine = doc[m];
    doc[m] = function (chaine) { const args = arguments; return pdfAvecRepli(doc, chaine, () => origine.apply(doc, args)); };
  });
  return doc;
}
// Lignes VISUELLES d'un texte dans une largeur donnée (police et corps déjà posés) : sert à couper
// une case trop haute entre deux pages. Un mot plus large que la case est coupé lettre à lettre.
function pdfLignes(doc, texte, largeur) {
  const lignes = [];
  String(texte == null ? '' : texte).replace(/\r/g, '').split('\n').forEach(para => {
    let cours = '';
    para.split(/ +/).forEach(mot => {
      const essai = cours ? cours + ' ' + mot : mot;
      if (doc.widthOfString(essai) <= largeur) { cours = essai; return; }
      if (cours) lignes.push(cours);
      cours = mot;
      while (doc.widthOfString(cours) > largeur && cours.length > 1) {
        let k = cours.length - 1; while (k > 1 && doc.widthOfString(cours.slice(0, k)) > largeur) k--;
        lignes.push(cours.slice(0, k)); cours = cours.slice(k);
      }
    });
    lignes.push(cours);
  });
  return lignes;
}
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
const PDF_LIGNE_INSECABLE = 140;   // en points (~12 lignes) : en dessous, une ligne de tableau ne se coupe pas
// Dessine UNE ligne de tableau en plusieurs morceaux, page après page. Les cases courtes (libellés)
// sont répétées sur chaque morceau, suivies de « (suite) » ; le texte long est coupé entre deux
// lignes visuelles, jamais au milieu d'une ligne.
function pdfRowDecoupee(doc, row, left) {
  const bas = () => doc.page.height - doc.page.margins.bottom;
  const police = (c) => doc.font(c.bold ? 'Helvetica-Bold' : (c.italics ? 'Helvetica-Oblique' : 'Helvetica')).fontSize(c.size || 9.5);
  const infos = row.cells.map(c => {
    police(c);
    const texte = String(c.text == null ? '' : c.text);
    return pdfAvecRepli(doc, texte, () => ({ c, texte, lignes: pdfLignes(doc, texte, c.w - 14), lh: doc.currentLineHeight(true) }));
  });
  const plusLongue = Math.max(...infos.map(i => i.lignes.length));
  infos.forEach(i => { i.etiquette = i.lignes.length <= 3 && plusLongue > 3; });
  let premier = true;
  while (infos.some(i => !i.etiquette && i.lignes.length)) {
    if (bas() - doc.y < 64) doc.addPage();                   // pas la place pour quatre lignes : page suivante
    const dispo = bas() - doc.y, y = doc.y;
    infos.forEach(i => { i.prises = i.etiquette ? 0 : Math.min(i.lignes.length, Math.max(1, Math.floor((dispo - 11) / i.lh))); });
    const hh = Math.max(premier && row.minH ? row.minH : 16, ...infos.map(i => i.prises * i.lh + 11));
    let x = left;
    infos.forEach(i => {
      const c = i.c;
      if (i.etiquette) pdfCell(doc, x, y, c.w, hh, i.texte && !premier ? i.texte + ' (suite)' : i.texte, c);
      else {
        pdfCell(doc, x, y, c.w, hh, '', c);                   // fond et cadre
        police(c); doc.fillColor(c.color || '#2a241d');
        const morceau = i.lignes.splice(0, i.prises);
        pdfAvecRepli(doc, i.texte, () => morceau.forEach((l, k) => {
          const dx = c.align === 'center' ? Math.max(0, (c.w - 14 - doc.widthOfString(l)) / 2) : 0;
          if (l) doc.text(l, x + 7 + dx, y + 5 + k * i.lh, { lineBreak: false });
        }));
      }
      x += c.w;
    });
    doc.y = y + hh; premier = false;
    if (infos.some(i => !i.etiquette && i.lignes.length)) doc.addPage();
  }
}
// rend une liste de lignes { cells:[{text,w,...}], minH } avec sauts de page
function pdfRows(doc, rows, left) {
  rows.forEach(row => {
    let hh = 16;
    row.cells.forEach(c => { doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(c.size || 9.5); hh = Math.max(hh, doc.heightOfString(String(c.text == null ? '' : c.text), { width: c.w - 14 }) + 11); });
    if (row.minH) hh = Math.max(hh, row.minH);
    if (doc.y + hh > doc.page.height - doc.page.margins.bottom) {
      // ⚠️ UNE CASE HAUTE SE COUPE ENTRE DEUX PAGES (21/09/2026). Avant, la ligne partait d'un bloc à
      // la page suivante — et quand elle était plus haute qu'une PAGE (longue note de grammaire), son
      // cadre sortait de la feuille, le libellé centré dans ce cadre tombait hors page et entraînait
      // un saut : une page entièrement VIDE, puis le texte sans cadre sur les pages suivantes.
      // Une petite ligne, elle, reste d'un seul tenant et passe à la page suivante, comme avant.
      if (hh > PDF_LIGNE_INSECABLE) { pdfRowDecoupee(doc, row, left); return; }
      doc.addPage();
    }
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
  return docxPortable(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INKC } } } }, sections: [{ properties: hf.proprietes, headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
// --- Interactive Worksheet → PDF (tableaux) ---
function buildWorksheetPdf(w, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = pdfUnicode(new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } }));
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

// Une séance d'Interactive Worksheet compte si l'un de ses champs de CONTENU est saisi (le
// formateur est prérempli d'office). Même liste que seanceRemplie() dans account.js.
const SEANCE_CHAMPS = ['dateDuree', 'objectifs', 'mots', 'grammaire', 'pronunciation', 'erreurs', 'prochaine'];
// ⚠️ les caractères INVISIBLES (espaces sans largeur, trait d'union conditionnel), souvent ramenés
// par un copier-coller, ne font pas une séance : trim() ne les retire pas.
const seanceRemplie = (s) => !!s && SEANCE_CHAMPS.some(k => String(s[k] || '').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').trim());
// ⚠️ « ENVOYER » AU LIEU DE « GÉNÉRER » (22/09/2026, demande de l'utilisateur : avec l'aperçu en direct,
// télécharger le fichier pour le relire puis le redéposer à la main n'a plus de sens). Quand le
// formulaire demande `envoyer`, le document produit est DÉPOSÉ dans le dossier, dans le canal de
// l'onglet ouvert (`channel`), comme un fichier partagé : mêmes droits (`canChannel`), même
// notification. Sans `envoyer`, l'ancien téléchargement direct reste servi (outils, anciens onglets).
// `canalImpose` : la fiche satisfaction formateur est destinée à l'administration, elle ne part
// JAMAIS dans la discussion commune, quel que soit l'onglet.
function rendreDocument(req, res, g, buf, name, ctype, canalImpose) {
  if (!(req.body && req.body.envoyer)) {
    res.setHeader('Content-Type', ctype);
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
    return res.send(buf);
  }
  const ch = canalImpose || (req.body.channel === 'prive' ? 'prive' : 'commun');
  if (!canChannel(g, req.user, ch)) return res.status(403).json({ error: 'Accès refusé.' });
  const stored = crypto.randomUUID() + (ctype === 'application/pdf' ? '.pdf' : '.docx');
  try { fs.writeFileSync(path.join(UPLOADS_DIR, stored), buf); }
  catch (e) { console.error('dépôt du document généré :', e.message); return res.status(500).json({ error: "Le document n'a pas pu être déposé dans le dossier." }); }
  const doc = { id: crypto.randomUUID(), group: g.id, channel: ch, from: req.user.id, fromAdmin: req.user.role === 'admin', name, size: buf.length, type: ctype, stored, date: Date.now() };
  db.docs.push(doc);
  notifyChannel(g, ch, req.user, `${senderDisplay(req.user)} a partagé un document ${ch === 'prive' ? '(privé) ' : ''}: ${name}`);
  save();
  res.json({ ok: true, doc: docPub(doc), channel: ch });
}
app.post('/api/worksheet/generate', auth, async (req, res) => {
  const { group, format } = req.body || {};
  const fmt = (format === 'word' || format === 'docx') ? 'word' : 'pdf';
  const g = groupById(group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const w = wsFind(g.id) || wsBlank(g, req.user);
  // ⚠️ AU MOINS UNE SÉANCE REMPLIE (21/09/2026, demande de l'utilisateur) : sans séance, le
  // document n'est qu'un en-tête. « Remplie » = un vrai champ saisi ; le nom du formateur, lui,
  // est prérempli d'office dans chaque séance et ne compte pas. Le formulaire fait le même contrôle
  // et explique quoi faire ; celui-ci garantit la règle quel que soit le client.
  if (!(w.sessions || []).some(seanceRemplie)) return res.status(400).json({ error: 'Ajoutez au moins une séance avant d\'envoyer l\'Interactive Worksheet.' });
  const ver = versionModele('interactive');
  let buf, ext, type;
  try {
    if (fmt === 'word') { buf = await buildWorksheetDocx(w, req.user, ver); ext = 'docx'; type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildWorksheetPdf(w, req.user, ver); ext = 'pdf'; type = 'application/pdf'; }
  } catch (e) { console.error('Génération worksheet:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'interactive', title: 'Interactive Worksheet', format: fmt, apprenant: (w.header && w.header.nomApprenant) || 'apprenant', sessionCount: (w.sessions || []).length, snapshot: { header: w.header || {}, sessions: w.sessions || [] } });
  const name = `1 - Interactive Worksheet - ${safeFile((w.header && w.header.nomApprenant) || 'apprenant')} - ${nameDate()}.${ext}`;
  return rendreDocument(req, res, g, buf, name, type);
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
// ⚠️ LIENS CLIQUABLES (22/09/2026, question de l'utilisateur) : l'éditeur n'a pas de bouton « lien », mais une
// adresse collée (https://…) est RECONNUE au rendu et devient un vrai lien, en PDF comme en Word. Le
// texte reste celui saisi ; seuls le soulignement et la couleur bleue s'ajoutent.
const RT_URL = /(https?:\/\/[^\s<>«»"']+?)([.,;:!?)]*)(?=\s|$)/g;
function rtSegments(texte) {   // découpe un texte en [{t, lien?}]
  const out = []; let i = 0; const s = String(texte == null ? '' : texte);
  for (const m of s.matchAll(RT_URL)) { if (m.index > i) out.push({ t: s.slice(i, m.index) }); out.push({ t: m[1], lien: m[1] }); if (m[2]) out.push({ t: m[2] }); i = m.index + m[0].length; }
  if (i < s.length) out.push({ t: s.slice(i) });
  return out;
}
function rtDxRuns(runs) {
  const out = [];
  (runs || []).forEach(r => { String(r.text == null ? '' : r.text).split('\n').forEach((ln, i) => { if (i > 0) out.push(new TextRun({ break: 1 })); rtSegments(ln).forEach(sg => {
    if (sg.lien) out.push(new ExternalHyperlink({ link: sg.lien, children: [new TextRun({ text: sg.t, bold: !!r.bold, italics: !!r.italic, underline: {}, color: '1155CC', size: 20 })] }));
    else if (sg.t !== '') out.push(new TextRun({ text: sg.t, bold: !!r.bold, italics: !!r.italic, underline: r.underline ? {} : undefined, color: rtHexClean(r.color) || '000000', size: 20 }));
  }); }); });
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
    const rs = [];
    (runs || []).forEach(r => rtSegments(r.text).forEach(sg => rs.push(Object.assign({}, r, { text: sg.t, lien: sg.lien }))));
    if (!rs.length) { if (prefix) doc.text(' '); else doc.moveDown(0.2); return; }
    rs.forEach((r, i) => {
      doc.font(rtPdfFont(r)).fontSize(10).fillColor(r.lien ? '#1155cc' : (r.color ? ('#' + (rtHexClean(r.color) || '000000')) : '#000000'));
      const opts = { continued: i < rs.length - 1, width: w, underline: !!r.underline || !!r.lien };
      // ⚠️ pdfkit reporte les options d'un segment « continued » sur le suivant : le lien doit être posé
      // EXPLICITEMENT à null sur les segments sans lien, sinon tout ce qui suit une adresse reste cliquable.
      opts.link = r.lien || null;
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
  return docxPortable(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INKC } } } }, sections: [{ properties: hf.proprietes, headers: { default: hf.header }, footers: { default: hf.footer }, children }] }));
}
// --- Test mi-parcours / fin → PDF (tableau) ---
function buildTestPdf(title, header, extra, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = pdfUnicode(new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } }));
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
  const ver = versionModele(type);
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildTestDocx(tpl.title, header, extra, req.user, ver); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildTestPdf(tpl.title, header, extra, req.user, ver); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('testdoc:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'test', tpl: type, title: tpl.title, format: ext === 'docx' ? 'word' : 'pdf', apprenant: (header && header.nomApprenant) || 'apprenant' });
  const name = (type === 'test_mid' ? '5' : '6') + ' - ' + safeFile(tpl.title) + ' - ' + safeFile((header && header.nomApprenant) || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  return rendreDocument(req, res, g, buf, name, ctype);
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
// `caseL` / `caseH` (facultatifs) : dimensions de la case où CENTRER la signature (x, y = son coin).
function pdfSignatureAntonin(doc, x, y, largeur, variante, hMax, caseL, caseH) {
  const p = imgSiPresent(variante || SIGN_ANTONIN);
  if (!p) return 0;
  // ⚠️ Le rapport se lit DANS le fichier (même correction que côté Word, cf. dxSignatureAntonin) :
  // le 0,45 codé en dur pour le tampon était faux (l'image fait 453 × 263, soit 0,58), et comme
  // `fit` conserve les proportions, la hauteur calculée bridait la largeur réelle — une demande
  // d'agrandissement restait donc sans effet visible. Repli sur les constantes si l'en-tête PNG
  // est illisible.
  let ratio = (variante === SIGN_ANTONIN_TAMPON ? 0.58 : RATIO_SIGN);
  try { const dims = pngDims(fs.readFileSync(p)); if (dims && dims.w && dims.h) ratio = dims.h / dims.w; } catch (e) { }
  let w = largeur || 120;
  if (hMax && w * ratio > hMax) w = hMax / ratio;      // on rétrécit à proportions constantes
  const h = w * ratio;
  if (caseL) x += Math.max(0, (caseL - w) / 2);
  if (caseH) y += Math.max(0, (caseH - h) / 2);
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
  // ⚠️ le tableau figure TOUJOURS (21/09/2026) : sans compétence saisie, une ligne vide — l'aperçu le montre dès l'ouverture
  if (compRows.length === 1) compRows.push(dxRowMin([dxCell('', { width: PC(40), size: 19, margins: M })].concat(ATT_NIVEAUX.map(() => dxCell('', { width: PC(20), margins: M }))), 480));
  kids.push(dxTable(compRows, dxCols([47, 17.7, 17.7, 17.6]))); kids.push(dxGap());
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
  return docxPortable(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INKC } } } }, sections: [{ properties: hf.proprietes, headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
function buildAttestationPdf(d, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = pdfUnicode(new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } }));
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
    // ⚠️ le tableau figure TOUJOURS (21/09/2026) : sans compétence saisie, une ligne vide
    if (!comps.length) comps.push({ label: '', niveau: '' });
    {
      const cw = totalW * 0.4, ow = (totalW * 0.6) / 3;
      const crows = [{ cells: [{ text: 'Compétences', w: cw, fill: '#f3e7e0', bold: true, size: 9 }].concat(ATT_NIVEAUX.map(n => ({ text: n, w: ow, fill: '#f3e7e0', bold: true, align: 'center', size: 8 }))) }];
      comps.forEach(c => crows.push({ minH: 22, cells: [{ text: c.label, w: cw, size: 9 }].concat(ATT_NIVEAUX.map(n => { const sel = c.niveau === n; return { text: sel ? 'X' : '', w: ow, align: 'center', bold: true, fill: sel ? '#be6e54' : null, color: '#ffffff', size: 11 }; })) }));
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
    const buf = await buildAttestationPdf(Object.assign({}, a.fields, { formateurSig: a.formateurSig, apprenantSig: a.apprenantSig }), u, versionModele('attestation'));
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
    // « Languages & Success » avec l'esperluette (demande de l'utilisateur, 16/09/2026). Le gras vient
    // du terme « LANGUAGES & SUCCESS » de CT_TERMES : la recherche y est insensible à la casse.
    { p: "Ci-après dénommé « Languages & Success » ou « le Donneur d'ordre ».", bold: true, italics: true },
    // ⚠️ `memeEspaceApres` : l'espace SOUS le « ET » égale celui du DESSUS (demande de l'utilisateur,
    // 16/09/2026). Au-dessus, il s'ajoute l'espace après du paragraphe précédent et le saut `before` ;
    // en dessous il n'y avait que l'espace après ordinaire, le « ET » paraissait collé au nom.
    { p: 'ET', bold: true, before: true, memeEspaceApres: true },
    // ⚠️ `serre` : les lignes d'identité du sous-traitant sont des paragraphes distincts (une
    // information par ligne), mais elles doivent avoir l'INTERLIGNE du paragraphe de Languages &
    // Success au-dessus du « ET », sans espace entre elles (demande de l'utilisateur, 16/09/2026 :
    // « après le ET ce n'est pas le même espacement de ligne qu'avant »). La dernière (NDA) garde
    // l'espace ordinaire avant « Ci-après dénommé… », comme côté Languages & Success.
    { p: `${d.stnom || ''}`, bold: true, serre: true },
    { p: `Né(e) le ${d.stNaissance || '…'}, de nationalité ${d.stNationalite || '…'}.`, serre: true },
    { p: `Demeurant : ${d.stAdresse || '…'}`, serre: true },
    { p: `Inscrit au répertoire INSEE en qualité d'auto-entrepreneur sous le numéro : ${d.stSiret || '…'}`, serre: true },
    { p: `Numéro d'activité (NDA) : ${d.stNda || '…'}` },
    { p: `Ci-après dénommé « ${d.stnom || 'le Sous-traitant'} » ou « le Sous-traitant ».`, bold: true, italics: true },
    { p: 'IL A ÉTÉ CONVENU CE QUI SUIT :', bold: true, before: true, after: true },
    { art: 'ARTICLE 1 – OBJET ET NATURE DU CONTRAT DE FORMATION' },
    { p: "Le présent contrat est conclu dans le cadre d'une prestation de formation ponctuelle réalisée par le sous-traitant au bénéfice du donneur d'ordre." },
    // en gras : le nom de la formation, la langue, les volumes horaires et les dates
    { rp: [{ t: 'La formation est dénommée : ' }, { t: `« ${d.intitule || '…'} » en ${d.langue || '…'}`, b: 1 }, { t: '.' }] },
    // ⚠️ Bloc descriptif en DEUX COLONNES (`def`) : le libellé à gauche, la valeur à droite sur
    // un axe vertical commun, et un repli de la valeur qui reste dans sa colonne (demande de
    // l'utilisateur du 11/09/2026, exemple à l'appui). Avant, tout était un paragraphe continu
    // et les valeurs commençaient à une abscisse différente à chaque ligne.
    { def: { label: "Type d'action de formation (art. L6313-1 du code du travail) :", segs: [{ t: "action d'acquisition, d'entretien ou de perfectionnement de la langue." }] } },
    { def: { label: 'Stagiaire(s) :', segs: [{ t: d.stagiaire || '…', b: 1 }] } },
    { def: { label: "Programme global de l'action de formation (pour information) :", segs: ctHeuresGras(d.programme || '…') } },
    { def: { label: 'Mission confiée au Sous-traitant :', segs: ctHeuresGras(d.mission || "l'animation des seules heures de formation synchrones, selon la ou les modalités précisées ci-dessus (présentiel et/ou distanciel). Les autres composantes du programme global demeurent mises en œuvre par le Donneur d'ordre dans les conditions de l'article 2.") } },
    { def: { label: 'Lieu de la formation :', segs: [{ t: d.lieu || 'en distanciel (Visioconférence)' }] } },
    { def: { label: 'Dates de formation :', segs: [{ t: `du ${d.dateDebut || '…'} au ${d.dateFin || '…'}`, b: 1 }] } },
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
    { sign: { gauche: ["Pour le Donneur d'ordre, Languages & Success", rep, 'Président'], droite: ['Pour le Sous-traitant,', d.stnom || ''], tampon: true, sigDroite: d.sousTraitantSig || null } }
  ];
}
// ---- mise en page du contrat (aérée, 11/09/2026) -------------------------------------------
// L'utilisateur trouvait le contrat trop serré. Les trois réglages tiennent ici, pour que PDF et
// Word restent accordés : interligne, retrait des puces, largeur de la colonne des libellés.
const CT_INTERLIGNE = 300;        // Word : 300/240 = 1,25 ligne (240 = interligne simple)
const CT_APRES_PARA = 160;        // Word : espace après un paragraphe, en vingtièmes de point
const CT_AVANT_SAUT = 240;        // Word : saut ajouté AVANT un paragraphe marqué `before`
// ⚠️ Word n'ADDITIONNE PAS l'espace après d'un paragraphe et l'espace avant du suivant : il garde le
// PLUS GRAND des deux (mesuré dans Word 16 le 16/09/2026 : 8 pt après + 30 pt avant = 30 pt). pdfkit,
// lui, additionne ses moveDown. D'où les deux formules différentes de `memeEspaceApres`.
const CT_PDF_APRES = 0.6;         // PDF : espace après un paragraphe, en lignes
const CT_PDF_AVANT_SAUT = 0.6;    // PDF : saut ajouté avant un paragraphe marqué `before`, en lignes
const CT_PUCE_RETRAIT = 360;      // Word : 360 twips = 0,63 cm entre la puce et le texte (≈ une tabulation)
const CT_PDF_INTERLIGNE = 2.6;    // PDF : lineGap en points (l'interligne passe de 10,6 à 13,2 pt)
const CT_PDF_RETRAIT = 18;        // PDF : 18 pt = les mêmes 0,63 cm
const CT_LABEL_PART = 0.40;       // largeur de la colonne des libellés du bloc descriptif
// Signatures : nettement plus grandes qu'avant (130 × 62 pt pour le tampon, 120 × 54 pour la
// signature du sous-traitant), elles se voyaient à peine sur un contrat de dix articles.
const CT_TAMPON_L = 190;          // largeur du tampon L&S, en points
const CT_SIG_L = 170, CT_SIG_H = 120;   // boîte de la signature manuscrite du sous-traitant

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
      const imgST = sigST ? [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: sigST.type, data: sigST.buffer, transformation: sigBox(sigST, CT_SIG_L, CT_SIG_H) })] })] : [];
      // ⚠️ grille FIXE et marges nulles : sans elles, Word répartit les colonnes d'après leur
      // contenu et le bloc « Pour le Sous-traitant » ne tombe plus sur la marge droite.
      kids.push(new Table({ layout: TableLayoutType.FIXED, columnWidths: [4513, 4513], width: { size: 9026, type: WidthType.DXA }, borders: NO_BORDERS(), rows: [new TableRow({ children: [
        // ⚠️ `dxSignatureAntonin` compte en PIXELS (la bibliothèque docx travaille à 96 dpi) alors
        // que le PDF compte en points : passer 190 tel quel donnait un tampon de 143 pt dans le
        // Word contre 190 pt dans le PDF. La conversion aligne enfin les deux formats.
        col(b.sign.gauche, AlignmentType.LEFT, b.sign.tampon ? dxSignatureAntonin(Math.round(CT_TAMPON_L * 96 / 72), SIGN_ANTONIN_TAMPON) : []),
        col(b.sign.droite, AlignmentType.RIGHT, imgST)
      ] })] }));
    }
    // bloc descriptif en deux colonnes : tableau SANS bordure, grille fixe, pour que les valeurs
    // partent toutes du même axe et que leur repli y reste (cf. CT_LABEL_PART)
    else if (b.def) {
      const LG = Math.round(9026 * CT_LABEL_PART), DR = 9026 - LG;
      const cellule = (enfants, largeur, droite) => new TableCell({
        width: { size: largeur, type: WidthType.DXA }, borders: NO_BORDERS(),
        margins: { top: 0, bottom: 90, left: 0, right: droite ? 0 : 160 }, children: enfants
      });
      kids.push(new Table({
        layout: TableLayoutType.FIXED, columnWidths: [LG, DR], width: { size: 9026, type: WidthType.DXA }, borders: NO_BORDERS(),
        rows: [new TableRow({ children: [
          cellule([new Paragraph({ spacing: { line: CT_INTERLIGNE }, children: runs(ctSeg(b.def.label), { size: 19 }) })], LG, false),
          cellule([new Paragraph({ spacing: { line: CT_INTERLIGNE }, children: runs(b.def.segs, { size: 19 }) })], DR, true)
        ] })]
      }));
    }
    // ⚠️ VRAIES listes à retrait suspendu : la puce vit dans le retrait négatif (`hanging`), donc
    // le texte part plus loin ET ses lignes repliées restent alignées sous la première. Avant, la
    // puce était un simple caractère du texte et le repli revenait coller à la marge.
    // ⚠️ La tabulation doit être un vrai objet `Tab` : un caractère TAB glissé dans le texte est
    // rendu comme une simple espace par Word, et le texte restait collé à la puce (défaut trouvé
    // en relisant le XML du .docx produit). C'est `Tab` qui envoie le texte au taquet du retrait.
    else if (b.li) kids.push(new Paragraph({ spacing: { after: 90, line: CT_INTERLIGNE }, indent: { left: CT_PUCE_RETRAIT, hanging: CT_PUCE_RETRAIT }, children: [new TextRun({ text: '•', color: INKC, size: 18 }), new TextRun({ children: [new Tab()], color: INKC, size: 18 })].concat(runs(ctSeg(b.li), { size: 18 })) }));
    else if (b.li2) kids.push(new Paragraph({ spacing: { after: 70, line: CT_INTERLIGNE }, indent: { left: CT_PUCE_RETRAIT * 2, hanging: CT_PUCE_RETRAIT }, children: [new TextRun({ text: '–', color: INKC, size: 18 }), new TextRun({ children: [new Tab()], color: INKC, size: 18 })].concat(runs(ctSeg(b.li2), { size: 18 })) }));
    else kids.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: b.before ? CT_AVANT_SAUT : 0, after: b.memeEspaceApres ? Math.max(CT_APRES_PARA, CT_AVANT_SAUT) : (b.after ? 260 : (b.serre ? 0 : CT_APRES_PARA)), line: CT_INTERLIGNE }, children: runs(segs(b, b.p), { bold: b.bold, italics: b.italics }) }));
  });
  const hf = docxHeaderFooter(user, ver);
  return docxPortable(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 19, color: INKC } } } }, sections: [{ properties: hf.proprietes, headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
function buildContratPdf(d, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = pdfUnicode(new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } }));
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const left = doc.page.margins.left, totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const p = (t, o) => { o = o || {}; doc.font(o.bold ? 'Helvetica-Bold' : (o.italics ? 'Helvetica-Oblique' : 'Helvetica')).fontSize(o.size || 9).fillColor(o.color || '#2a241d').text(String(t == null ? '' : t), left, doc.y, { width: totalW, align: o.align || 'left' }); doc.moveDown(o.after != null ? o.after : 0.35); };
    // paragraphe à segments : chaque segment peut être en gras (termes contractuels, montants…)
    // ⚠️ `x` et `width` permettent d'écrire dans une COLONNE (bloc descriptif, texte d'une puce) :
    // pdfkit retient l'abscisse du premier `text()` d'une chaîne `continued` et y replie les
    // lignes suivantes, donc l'indentation tient sur tout le paragraphe.
    const rich = (segs, o) => {
      o = o || {};
      if (o.before) doc.moveDown(o.before);
      const x0 = o.x != null ? o.x : left;
      const w = o.width != null ? o.width : totalW;
      const ecart = o.lineGap != null ? o.lineGap : CT_PDF_INTERLIGNE;
      const police = (s) => (s.b || o.bold) ? (o.italics ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : (o.italics ? 'Helvetica-Oblique' : 'Helvetica');
      segs.forEach((s, i) => {
        doc.font(police(s)).fontSize(o.size || 9.2).fillColor('#2a241d');
        if (i === 0) doc.text(s.t, x0, doc.y, { width: w, continued: segs.length > 1, lineGap: ecart });
        else doc.text(s.t, { width: w, continued: i < segs.length - 1, lineGap: ecart });
      });
      doc.moveDown(o.after != null ? o.after : 0.45);
    };
    // une puce (ou un tiret) posée à part, puis le texte dans une colonne en retrait : c'est ce
    // retrait qui remplace l'espace unique d'avant, et les lignes repliées s'y alignent.
    const puce = (marque, segs, xMarque, xTexte, o) => {
      o = o || {};
      const y0 = doc.y;
      doc.font('Helvetica').fontSize(o.size || 9).fillColor('#2a241d');
      doc.text(marque, xMarque, y0, { lineBreak: false });
      doc.y = y0;
      rich(segs, Object.assign({}, o, { x: xTexte, width: left + totalW - xTexte }));
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
        // réservation : trois lignes de texte + la plus haute des deux images agrandies
        pdfPlacePourSignature(doc, 40 + Math.max(CT_TAMPON_L * 0.58, CT_SIG_H) + 20);
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
        const hT = b.sign.tampon ? pdfSignatureAntonin(doc, left, yG + 8, CT_TAMPON_L, SIGN_ANTONIN_TAMPON) : 0;
        const sST = sigImg(b.sign.sigDroite);
        let hS = 0;
        if (sST) {
          // la signature est calée sur la marge DROITE : on mesure la place qu'elle prendra
          // réellement dans sa boîte (proportions conservées) pour l'y poser sans la déborder.
          const dims = pngDims(sST.buffer);
          const r = dims && dims.w && dims.h ? Math.min(CT_SIG_L / dims.w, CT_SIG_H / dims.h) : 0;
          const wReel = r ? dims.w * r : CT_SIG_L, hReel = r ? dims.h * r : CT_SIG_H;
          try { doc.image(sST.buffer, left + totalW - wReel, yD + 8, { fit: [CT_SIG_L, CT_SIG_H] }); hS = hReel + 8; } catch (e) { }
        }
        doc.y = Math.max(yG + hT, yD + hS); doc.moveDown(0.5);
      }
      // bloc descriptif en deux colonnes : le libellé à gauche (il peut se replier), la valeur
      // sur un axe vertical commun. On écrit le libellé, on revient à la hauteur de départ, on
      // écrit la valeur, puis on repart du plus bas des deux.
      else if (b.def) {
        const labW = Math.round(totalW * CT_LABEL_PART), gouttiere = 12;
        const xVal = left + labW + gouttiere, wVal = totalW - labW - gouttiere;
        pdfPlacePourSignature(doc, 46);   // pas de libellé orphelin en bas de page
        const y0 = doc.y;
        doc.font('Helvetica').fontSize(9.2).fillColor('#2a241d')
          .text(b.def.label, left, y0, { width: labW, lineGap: CT_PDF_INTERLIGNE });
        const yLabel = doc.y;
        doc.y = y0;
        rich(b.def.segs, { size: 9.2, x: xVal, width: wVal, after: 0 });
        doc.y = Math.max(yLabel, doc.y);
        doc.moveDown(0.35);
      }
      else if (b.li) puce('•', ctSeg(b.li), left, left + CT_PDF_RETRAIT, { size: 9, after: 0.3 });
      else if (b.li2) puce('–', ctSeg(b.li2), left + CT_PDF_RETRAIT, left + CT_PDF_RETRAIT * 2, { size: 9, after: 0.26 });
      else rich(b.rp || ctSeg(b.p), { size: 9.2, after: b.memeEspaceApres ? CT_PDF_APRES + CT_PDF_AVANT_SAUT : (b.after ? 1 : (b.serre ? 0 : CT_PDF_APRES)), bold: b.bold, italics: b.italics, before: b.before ? CT_PDF_AVANT_SAUT : 0 });
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
  const ver = versionModele('contrat');
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
// ---- pied de page Word SANS TABLEAU, calqué sur le PDF (16/09/2026) -------------------------
// ⚠️ Apple Pages ne prend PAS en charge les tableaux dans un pied de page (page de compatibilité
// d'Apple) : l'ancien pied, un tableau 40/60, y sortait en vrac. Chaque ligne est UN paragraphe :
// la mention de gauche, puis une tabulation droite qui cale la ligne légale sur la marge.
// ⚠️ Deuxième version, après une capture de Pages : la première gardait le numéro de page (8 pt)
// sur la ligne de « Numéro RNA… » en forçant la hauteur de la ligne (interligne exact) et en
// abaissant le numéro de 2 pt. Pages lit ces deux réglages autrement que Word : la barre du
// « 2 / 5 » remontait au-dessus des chiffres et les lignes légales se tassaient. Désormais le pied
// suit le PDF et n'emploie plus rien d'autre que des lignes ordinaires : toutes les lignes en 6 pt
// (le bloc légal tient sur 5 lignes, comme dans le PDF), puis le numéro de page SEUL sur la
// dernière ligne, en bas à gauche, comme dans le PDF. Ne réintroduire ni interligne exact ni
// décalage vertical (`position`) dans ce pied.
const PIED_TAB_DROITE = 9011;       // twips : tabulation droite (fin des lignes légales, calée au pixel sur l'ancien rendu Word)
const PIED_RETRAIT_G = 10, PIED_RETRAIT_D = 15;   // twips : marges de l'ancienne cellule
const PIED_LARG_UTILE = 450;        // pt : largeur de la ligne entre les deux retraits (9026 − 25 twips)
const PIED_ECART_MIN = 12;          // pt : écart minimal entre la mention de gauche et la ligne légale
const PIED_LARG_GAUCHE = 179.5;     // pt : largeur maximale d'une mention de gauche (celle de l'ancienne colonne)
// hauteurs d'une ligne d'Arial dans Word, mesurées : 6 pt → 6,9 pt, 8 pt → 9,2 pt (en twips)
const PIED_LIGNE_6PT = 138, PIED_LIGNE_8PT = 184;
const PIED_DISTANCE = 708;          // twips : distance du pied au bas de la page (valeur par défaut de la bibliothèque)
// Replier une ligne trop longue : Arial et Helvetica ont les mêmes chasses, les mesures de pdfkit
// valent donc celles de Word. Coupure après une espace ou un trait d'union.
let _mesurePied = null;
function replierPied(texte, largeur, taille) {
  _mesurePied = _mesurePied || new PDFDocument({ autoFirstPage: false });
  const larg = (s) => _mesurePied.font('Helvetica').fontSize(taille).widthOfString(s.trimEnd());
  const lignes = []; let cour = '';
  for (const mot of String(texte).match(/[^ -]*-+ *|[^ -]+ *| +/g) || []) {
    if (cour && larg(cour + mot) > largeur) { lignes.push(cour.trimEnd()); cour = mot.trimStart(); }
    else cour += mot;
  }
  if (cour.trim()) lignes.push(cour.trimEnd());
  return lignes.length ? lignes : [''];
}
const largeurPied = (s) => { _mesurePied = _mesurePied || new PDFDocument({ autoFirstPage: false }); return _mesurePied.font('Helvetica').fontSize(6).widthOfString(s); };
function docxFooterFor(user, ver) {
  const couleur = '6F6253';
  const gauche = [].concat(...metaLines(user, ver).map(l => replierPied(l, PIED_LARG_GAUCHE, 6)));
  // les lignes légales prennent toute la place que laisse la plus longue mention de gauche : la
  // ligne « Numéro RNA… » tient alors d'un seul tenant, comme dans le PDF (un nom de rédacteur très
  // long la replie, sans jamais la faire chevaucher la mention)
  const largDroite = PIED_LARG_UTILE - Math.max(0, ...gauche.map(largeurPied)) - PIED_ECART_MIN;
  const droite = [].concat(...LEGAL_LINES.map(l => replierPied(l, largDroite, 6)));
  const rangees = [];
  const n = Math.max(gauche.length, droite.length);
  const ligne = (runs) => new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: PIED_TAB_DROITE }],
    indent: { left: PIED_RETRAIT_G, right: PIED_RETRAIT_D },
    children: runs,
  });
  for (let i = 0; i < n; i++) {
    const runs = gauche[i] !== undefined ? [new TextRun({ text: gauche[i], size: 12, color: couleur })] : [];
    if (droite[i] !== undefined) runs.push(new TextRun({ children: [new Tab(), droite[i]], size: 12, color: couleur }));
    rangees.push(ligne(runs));
  }
  // numéro de page : seul, sur la dernière ligne, comme dans le PDF
  rangees.push(ligne([new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16, color: couleur })]));
  // ⚠️ La zone de texte du document ne doit pas bouger. Word pousse le bas du texte au-dessus du
  // pied quand celui-ci dépasse la marge : on garde donc le HAUT du pied là où l'ancien tableau le
  // mettait (hauteur de sa plus haute colonne), en rapprochant le pied du bas de la page d'autant
  // que sa hauteur a grandi.
  const gaucheTableau = [].concat(...metaLines(user, ver).map(l => replierPied(l, PIED_LARG_GAUCHE, 6))).length * PIED_LIGNE_6PT + PIED_LIGNE_8PT;
  const droiteTableau = [].concat(...LEGAL_LINES.map(l => replierPied(l, 269.8, 6))).length * PIED_LIGNE_6PT;
  const hauteurTableau = Math.max(gaucheTableau, droiteTableau);
  const hauteur = n * PIED_LIGNE_6PT + PIED_LIGNE_8PT;
  const distance = Math.max(0, PIED_DISTANCE - (hauteur - hauteurTableau));
  return { footer: new Footer({ children: rangees }), distance };
}
function docxHeaderFooter(user, ver) {
  let logoRun = null; try { logoRun = new ImageRun({ type: 'png', data: fs.readFileSync(LOGO_PATH), transformation: { width: 44, height: 44 } }); } catch (e) { }
  const header = new Header({ children: [new Paragraph({ children: logoRun ? [logoRun] : [] })] });
  const pied = docxFooterFor(user, ver);
  // `proprietes` : à passer à la section de chaque document (distance du pied, cf. ci-dessus)
  return { header, footer: pied.footer, proprietes: { page: { margin: { footer: pied.distance } } } };
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
    const doc = pdfUnicode(new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } }));
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
  return docxPortable(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 20, color: INK } } } }, sections: [{ properties: hf.proprietes, headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
async function generateQsDoc(qs, format, fromUser) {
  const tpl = QS_TEMPLATES[qs.type];
  let buf, ext, type;
  const verQ = versionModele(qs.type);
  if (format === 'word' || format === 'docx') { buf = await buildQsDocx(qs, tpl, fromUser, verQ); ext = 'docx'; type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
  else { buf = await buildQsPdf(qs, tpl, fromUser, verQ); ext = 'pdf'; type = 'application/pdf'; }
  const stored = crypto.randomUUID() + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, stored), buf);
  const name = (qs.type === 'qs_mid' ? '2' : '3') + ' - ' + safeFile(tpl.title) + ' - ' + safeFile((qs.header && qs.header.nomApprenant) || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  // la version est retenue sur la pièce : la régénérer en Word ne doit pas la faire avancer,
  // c'est le même document dans un autre format
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
  const ver = versionModele(type);
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildQsDocx(qs, tpl, req.user, ver); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildQsPdf(qs, tpl, req.user, ver); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('form gen:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'form', tpl: type, title: tpl.title, format: ext === 'docx' ? 'word' : 'pdf', apprenant: (header && header.nomApprenant) || 'apprenant' });
  const name = (req.user.role === 'admin' ? '8' : '7') + ' - ' + safeFile(tpl.title) + ' - ' + safeFile((header && header.nomApprenant) || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  return rendreDocument(req, res, g, buf, name, ctype, 'prive');
});

// ---- APERÇU EN DIRECT des documents à générer (21/09/2026, demande de l'utilisateur) --------------
// À droite de chaque fenêtre « Générer un document », le navigateur affiche le document tel qu'il
// sortira, et le redemande à chaque modification du formulaire.
// ⚠️⚠️ L'APERÇU EST LE VRAI PDF, produit par les MÊMES constructeurs que la génération — jamais une
// imitation en HTML, qui finirait par diverger du document réel (pagination, replis, tableaux).
// ⚠️ Cette route NE LAISSE AUCUNE TRACE : pas de recordDocgen (l'historique se remplirait d'une
// ligne par frappe), pas de save(), pas d'e-mail, pas de notification, et surtout PAS de
// newContratRef() — chaque appel consomme un numéro de contrat pour toujours. L'aperçu du contrat
// porte une référence d'attente, la vraie est attribuée à l'envoi ou au téléchargement.
// Mêmes droits que la génération : canEditWs sur le dossier, contrat réservé à l'administration.
// Les données viennent du FORMULAIRE (corps de la requête), jamais de la base : rien ne fuit.
const apercuRefContrat = () => 'Réf. n° ' + new Date().getFullYear() + '/L&S - attribuée à l\'envoi';
app.post('/api/apercu', auth, async (req, res) => {
  const { group, tpl, donnees } = req.body || {};
  const g = groupById(group), d = donnees || {};
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  try {
    let buf;
    if (tpl === 'interactive') buf = await buildWorksheetPdf({ header: d.header || {}, sessions: Array.isArray(d.sessions) ? d.sessions : [] }, req.user, versionModele('interactive'));
    else if (QS_TEMPLATES[tpl]) buf = await buildQsPdf({ header: d.header || {}, answers: {} }, QS_TEMPLATES[tpl], req.user, versionModele(tpl));
    else if (FORM_TEMPLATES[tpl]) buf = await buildQsPdf({ header: d.header || {}, answers: d.answers || {} }, FORM_TEMPLATES[tpl], req.user, versionModele(tpl));
    else if (TEST_TEMPLATES[tpl]) buf = await buildTestPdf(TEST_TEMPLATES[tpl].title, d.header || {}, d.extra || {}, req.user, versionModele(tpl));
    else if (tpl === 'attestation') buf = await buildAttestationPdf(Object.assign({}, d.fields, { formateurSig: d.formateurSig || null }), req.user, versionModele('attestation'));
    else if (tpl === 'contrat') {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
      buf = await buildContratPdf(Object.assign({}, d.fields, { ref: apercuRefContrat(), representant: 'Antonin HATTABE' }), req.user, versionModele('contrat'));
    }
    else if (tpl === 'leveltest' && req.user.role !== 'admin') return res.status(403).json({ error: MSG_LEVELTEST_RESERVE });
    else if (tpl === 'leveltest') buf = await buildLevelTestPdf(d.fields || {}, req.user, versionModele('leveltest'));
    else if (tpl === 'presence' && presenceReservee(PRESENCE_TEMPLATES[d.type], req.user)) return res.status(403).json({ error: MSG_PRESENCE_RESERVEE });
    else if (tpl === 'presence' && PRESENCE_TEMPLATES[d.type]) buf = await buildPresencePdf(d.type, Object.assign({}, d.fields, { formateurSig: d.formateurSig || null }), req.user, versionModele('presence-' + d.type));
    else return res.status(400).json({ error: 'Modèle inconnu.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buf);
  } catch (e) { console.error('aperçu (' + tpl + ') :', e.message); res.status(500).json({ error: 'Aperçu indisponible.' }); }
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
  return docxPortable(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 19, color: INKC } } } }, sections: [{ properties: hf.proprietes, headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
function buildLevelTestPdf(d, user, ver) {
  return new Promise((resolve, reject) => {
    const doc = pdfUnicode(new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } }));
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
// ⚠️ LE LEVEL TEST EST FOURNI PAR L'ADMINISTRATION (22/09/2026, demande de l'utilisateur) : le formateur
// ne le produit pas. Refus côté serveur sur les trois entrées (modèle, génération, aperçu), pas seulement dans la liste.
const MSG_LEVELTEST_RESERVE = "Le Level Test est établi par l'administration.";
app.get('/api/leveltest', auth, (req, res) => { if (req.user.role !== 'admin') return res.status(403).json({ error: MSG_LEVELTEST_RESERVE }); res.json({ tpl: LEVEL_TEST }); });
app.post('/api/leveltest/generate', auth, async (req, res) => {
  const { group, fields, format } = req.body || {};
  const g = groupById(group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: MSG_LEVELTEST_RESERVE });
  const ver = versionModele('leveltest');
  const d = fields || {};
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildLevelTestDocx(d, req.user, ver); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildLevelTestPdf(d, req.user, ver); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('leveltest:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'leveltest', title: LEVEL_TEST.title, format: ext === 'docx' ? 'word' : 'pdf', apprenant: d.prenom || d.nom || 'apprenant' });
  const name = '9 - ' + safeFile(LEVEL_TEST.title) + ' - ' + safeFile(d.prenom || d.nom || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  return rendreDocument(req, res, g, buf, name, ctype);
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
    title: 'Feuille de présence — Certification', kind: 'grid', signAdmin: true, adminOnly: true,
    headerRows: [
      [['mois', 'Mois'], ['langue', 'Contrat langue']],
      [['formateur', 'Administratif'], ['formation', 'Formation']],
      [['apprenant', 'Apprenant'], ['dureePrevue', 'Durée prévue']],
      [['compte', 'Compte'], ['lieu', 'Lieu']],
      [['ref', 'Ref proposition'], ['ville', 'Ville']]
    ]
  }
};
// ⚠️ La feuille « Certification » (clé `test`) ne se choisit QUE par l'administration (21/09/2026) :
// contrôlé ici et pas seulement dans le formulaire, qui se contourne.
const presenceReservee = (tpl, user) => !!(tpl && tpl.adminOnly && user.role !== 'admin');
const MSG_PRESENCE_RESERVEE = "Ce type de feuille est réservé à l'administration.";
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
    if (hasData && signAdmin) pdfSignatureAntonin(doc, sfX + 3, y + 2, W.sf - 6, null, rowH - 4, W.sf - 6, rowH - 4);   // centrée dans sa case
    else if (hasData && sigF) { try { doc.image(sigF.buffer, sfX + 3, y + 2, { fit: [W.sf - 6, rowH - 4], align: 'center', valign: 'center' }); } catch (e) { } }
    if (hasData && sigA) { try { doc.image(sigA.buffer, ssX + 3, y + 2, { fit: [W.ss - 6, rowH - 4], align: 'center', valign: 'center' }); } catch (e) { } }
    doc.y = y + rowH;
  });
}
function buildPresencePdf(type, d, user, ver) {
  const tpl = PRESENCE_TEMPLATES[type];
  return new Promise((resolve, reject) => {
    const doc = pdfUnicode(new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 96, bottom: 92, left: 50, right: 50 } }));
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
      if (tpl.signAdmin) pdfSignatureAntonin(doc, valX + 10, sigY + 6, valW - 20, null, 44, valW - 20, 44);   // centrée, comme la signature de l'apprenant en dessous
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
  return docxPortable(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 19, color: INKC } } } }, sections: [{ properties: hf.proprietes, headers: { default: hf.header }, footers: { default: hf.footer }, children: kids }] }));
}
app.get('/api/presence', auth, (req, res) => res.json({ templates: PRESENCE_TEMPLATES }));
app.post('/api/presence/generate', auth, async (req, res) => {
  const { group, type, fields, format } = req.body || {};
  const tpl = PRESENCE_TEMPLATES[type];
  const g = groupById(group);
  if (!tpl) return res.status(400).json({ error: 'Type de feuille inconnu.' });
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  if (presenceReservee(tpl, req.user)) return res.status(403).json({ error: MSG_PRESENCE_RESERVEE });
  const ver = versionModele('presence-' + type);
  const d = fields || {};
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildPresenceDocx(type, d, req.user, ver); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildPresencePdf(type, d, req.user, ver); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('presence:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  recordDocgen(g, req.user, { kind: 'presence', title: tpl.title, format: ext === 'docx' ? 'word' : 'pdf', apprenant: d.apprenant || 'apprenant' });
  const name = (req.user.role === 'admin' ? '10' : '8') + ' - ' + safeFile(tpl.title) + ' - ' + safeFile(d.apprenant || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

// ---- Feuilles de présence : flux de signatures (formateur signe → apprenant signe → dépôt) ----
async function depositPresenceDoc(p, byUser) {
  const tpl = PRESENCE_TEMPLATES[p.type] || {};
  const d = Object.assign({}, p.fields, { formateurSig: p.formateurSig, apprenantSig: p.apprenantSig });
  const ver = versionModele('presence-' + p.type);
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
  if (presenceReservee(tpl, req.user)) return res.status(403).json({ error: MSG_PRESENCE_RESERVEE });
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
  if (presenceReservee(tpl, req.user)) return res.status(403).json({ error: MSG_PRESENCE_RESERVEE });
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
  if (signaturesEnCours.has(p.id)) return res.status(409).json({ error: 'Signature déjà en cours.' });
  signaturesEnCours.add(p.id);
  try { doc = await depositPresenceDoc(Object.assign({}, p, { apprenantSig: sig }), byUser); }
  catch (e) { signaturesEnCours.delete(p.id); console.error('presence sign:', e); return res.status(500).json({ error: 'Erreur de génération du document. La feuille reste à signer, réessayez.' }); }
  signaturesEnCours.delete(p.id);
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
// ⚠️ Le contrôle « déjà signé » précède un `await` (génération du PDF) : deux requêtes lancées en même
// temps le franchissaient toutes les deux et déposaient DEUX pièces signées. Verrou par pièce, en mémoire.
const signaturesEnCours = new Set();
async function depositAttestationDoc(a, byUser) {
  const d = Object.assign({}, a.fields, { formateurSig: a.formateurSig, apprenantSig: a.apprenantSig });
  const ver = versionModele('attestation');
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
  if (signaturesEnCours.has(a.id)) return res.status(409).json({ error: 'Signature déjà en cours.' });
  signaturesEnCours.add(a.id);
  try { doc = await depositAttestationDoc(Object.assign({}, a, { apprenantSig: sig }), byUser); }
  catch (e) { signaturesEnCours.delete(a.id); console.error('attestation sign:', e); return res.status(500).json({ error: 'Erreur de génération du document. L\'attestation reste à signer, réessayez.' }); }
  signaturesEnCours.delete(a.id);
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
  const ver = versionModele('contrat');
  const buf = await buildContratPdf(d, adminUser, ver);
  const stored = crypto.randomUUID() + '.pdf';
  fs.writeFileSync(path.join(UPLOADS_DIR, stored), buf);
  const name = '7 - ' + safeFile('Contrat de sous-traitance') + ' - ' + safeFile((c.fields && c.fields.stnom) || 'formateur') + ' - ' + nameDate() + ' - signé.pdf';
  const doc = { id: crypto.randomUUID(), group: c.group, channel: 'prive', from: adminUser.id, fromAdmin: true, name, size: buf.length, type: 'application/pdf', stored, date: Date.now(), ver };
  db.docs.push(doc);
  return doc;
}
// ⚠️ De quel contrat parle-t-on ? (16/09/2026, demande de l'utilisateur) : un formateur a plusieurs
// apprenants, donc plusieurs contrats. Les e-mails et notifications nomment l'apprenant du dossier
// (le compte, à jour même après un changement de nom), la référence et l'intitulé de la formation.
function contratEnClair(g, c) {
  const f = (c && c.fields) || {};
  const apprenant = (g && g.eleve && realUser(g.eleve) ? fullName(g.eleve) : '') || f.stagiaire || '';
  const details = [String(c.ref || f.ref || '').trim(), f.intitule ? 'Formation : ' + String(f.intitule).trim() : ''].filter(Boolean);
  return { apprenant, details, pourQui: apprenant ? ' (apprenant : ' + apprenant + ')' : '' };
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
  const ce = contratEnClair(g, c);
  notify(cibP.id, `${senderDisplay(req.user)} vous a envoyé un contrat de sous-traitance à signer${ce.pourQui}.`, g.id);
  db.users.filter(u => u.role === 'admin' && u.id !== req.user.id).forEach(x => notify(x.id, `${senderDisplay(req.user)} a envoyé un contrat de sous-traitance à ${fullName(cibP.id)}${ce.pourQui}.`, g.id));
  const profU = realUser(cibP.id);
  if (profU) {
    const url = SITE_URL + '/espace-documents.html';
    const ligne = "L'administration vous a envoyé un contrat de sous-traitance" + (ce.apprenant ? ' pour la formation de ' + ce.apprenant : '') + '. Relisez-le sur votre espace documents : vous pourrez le signer directement en ligne.';
    sendMailSafe(profU.email, 'Contrat de sous-traitance à signer' + ce.pourQui + ' — Languages & Success',
      'Bonjour ' + profU.prenom + ',\n\n' + ligne + (ce.details.length ? '\n' + ce.details.join('\n') : '') + '\n\n' + url + '\n\nLanguages & Success',
      mailHtml('Un contrat à relire et à signer',
        ['Bonjour ' + profU.prenom + ',', ligne].concat(ce.details),
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
    const buf = await buildContratPdf(Object.assign({}, c.fields, { sousTraitantSig: c.profSig }), u, versionModele('contrat'));
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
  if (signaturesEnCours.has(c.id)) return res.status(409).json({ error: 'Signature déjà en cours.' });
  signaturesEnCours.add(c.id);
  try { doc = await depositContratDoc(Object.assign({}, c, { profSig: sig }), adminU); }
  catch (e) { signaturesEnCours.delete(c.id); console.error('contrat sign:', e); return res.status(500).json({ error: 'Erreur de génération du document. Le contrat reste à signer, réessayez.' }); }
  signaturesEnCours.delete(c.id);
  c.profSig = sig; c.status = 'done'; c.signedAt = Date.now(); c.docId = doc.id;
  recordDocgen(g, adminU, { kind: 'contrat', tpl: 'contrat', title: 'Contrat de sous-traitance', format: 'pdf', apprenant: (c.fields && c.fields.stnom) || 'formateur' });
  // ⚠️ canal PRIVÉ : notifyChannel n'y prévient que les formateurs du dossier et les admins.
  const ce = contratEnClair(g, c);
  notifyChannel(g, 'prive', req.user, `${senderDisplay(req.user)} a signé le contrat de sous-traitance${ce.pourQui} — document déposé dans le canal privé.`);
  if (adminU && adminU.id !== req.user.id) {
    const urlS = SITE_URL + '/espace-documents.html';
    const phrase = senderDisplay(req.user) + ' a signé le contrat de sous-traitance' + (ce.apprenant ? ' pour la formation de ' + ce.apprenant : '') + '.';
    const fin = 'Le document final est déposé dans le canal privé du dossier' + (ce.apprenant ? ' de ' + ce.apprenant : '') + '.';
    sendMailSafe(adminU.email, 'Contrat signé par ' + senderDisplay(req.user) + ce.pourQui + ' — Languages & Success',
      'Bonjour ' + adminU.prenom + ',\n\n' + phrase + (ce.details.length ? '\n' + ce.details.join('\n') : '') + '\n' + fin + '\n\n' + urlS + '\n\nLanguages & Success',
      mailHtml('Le contrat est signé ✓',
        ['Bonjour ' + adminU.prenom + ',', phrase].concat(ce.details, [fin]),
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
  if (SIMULATION) return null;   // serveur de démonstration : aucun effet extérieur, jamais
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
  if (SIMULATION) return null;   // serveur de démonstration : aucun effet extérieur, jamais
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
const QUOTA_FENETRE = 10 * 60 * 1000;
// Même compteur, en LECTURE SEULE. Il faut pouvoir REGARDER le quota sans le consommer : la
// connexion ne doit compter que les ÉCHECS, jamais une connexion réussie (sinon un bureau entier
// derrière une seule IP finirait par se bloquer à force de travailler normalement).
function quotaAtteint(ip, route, max) {
  const maintenant = Date.now();
  return (quotasFormulaires.get(route + '|' + ip) || []).filter(t => maintenant - t < QUOTA_FENETRE).length >= max;
}
function tropDeDemandes(ip, route, max) {
  const FENETRE = QUOTA_FENETRE;
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
  if (!u || u.role !== 'admin') { delete plein.postLinkedin; delete plein.postsLi; delete plein.promptImage; }
  res.json({ article: plein });
});
// Posts LinkedIn reçus du navigateur : on ne garde que les champs connus, et UN SEUL post peut
// porter `choisi` (« c'est celui-là que je publie », case cochée dans la modale de modification
// ou dans la boîte sous l'article, 14/09/2026). Deux cases cochées par un client bricolé : la
// première gagne, les autres sont décochées.
function artPostsLi(liste) {
  let pris = false;
  return (Array.isArray(liste) ? liste : []).map(p => {
    const choisi = !!(p && p.choisi) && !pris;
    if (choisi) pris = true;
    const propre = { angle: String((p && p.angle) || ''), texte: String((p && p.texte) || '') };
    if (choisi) propre.choisi = true;
    return propre;
  });
}
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
    postsLi: artPostsLi(b.postsLi),
    // note interne aussi : le prompt qui décrirait l'image idéale de couverture (affiché dans
    // l'encadré du brouillon, pour regénérer l'image si celle en place ne convient pas)
    promptImage: b.promptImage || '',
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
  for (const k of ['titre', 'chapo', 'categorie', 'motCle', 'titreSeo', 'metaDescription', 'corps', 'image', 'postLinkedin', 'promptImage']) {
    if (b[k] != null) a[k] = b[k];
  }
  if (Array.isArray(b.postsLi)) a.postsLi = artPostsLi(b.postsLi);
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
  effacerImageBlog(a.id); // l'image téléversée part avec l'article
  res.json({ ok: true, titre: a.titre });
});

// ---- image de couverture téléversée (remplaçable depuis le site, 24/08/2026) --------------
// L'image d'un article est une DONNÉE : elle vit dans le volume (data/uploads/blog/), pas dans
// Git, et survit donc aux déploiements comme db.json. Servie par la route publique /blog-img/.
const BLOG_IMG_DIR = path.join(UPLOADS_DIR, 'blog');
const BLOG_IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const uploadImgBlog = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
function effacerImageBlog(id) {
  try {
    for (const ext of ['jpg', 'png', 'webp']) {
      const f = path.join(BLOG_IMG_DIR, id + '.' + ext);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  } catch (e) {}
}
app.post('/api/blog/articles/:id/image', auth, uploadImgBlog.single('image'), (req, res) => {
  if (!adminSeul(req, res)) return;
  const a = db.articles.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Article introuvable.' });
  const f = req.file;
  if (!f || !f.buffer || !f.buffer.length) return res.status(400).json({ error: 'Aucune image reçue.' });
  const ext = BLOG_IMG_TYPES[f.mimetype];
  if (!ext) return res.status(400).json({ error: 'Format accepté : JPEG, PNG ou WebP.' });
  try {
    fs.mkdirSync(BLOG_IMG_DIR, { recursive: true });
    effacerImageBlog(a.id); // une seule image par article, quel que soit son format
    fs.writeFileSync(path.join(BLOG_IMG_DIR, a.id + '.' + ext), f.buffer);
  } catch (e) {
    return res.status(500).json({ error: "L'image n'a pas pu être enregistrée." });
  }
  // le ?v= casse le cache navigateur au remplacement (la route sert l'image en cache long)
  a.image = '/blog-img/' + a.id + '.' + ext + '?v=' + Date.now();
  a.dateMaj = new Date().toISOString();
  save();
  res.json({ article: artPub(a) });
});
// service public de l'image (les visiteurs d'un article publié en ont besoin). Nom strictement
// borné à « <uuid>.<extension d'image> » : rien d'autre ne sort de data/.
app.get('/blog-img/:nom', (req, res, next) => {
  const nom = String(req.params.nom || '');
  if (!/^[a-f0-9-]{10,60}\.(jpg|png|webp)$/i.test(nom)) return next();
  const f = path.join(BLOG_IMG_DIR, nom);
  if (!fs.existsSync(f)) return next();
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(f);
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
// Heure de Paris, « 9h30 ». ⚠️ `hourCycle:'h23'` et non `hour12:false` : ce dernier fait sortir
// minuit en « 24 » sur plusieurs moteurs, et un article programmé à minuit s'afficherait « 24h00 ».
function artHeureLisible(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: TZ_FR, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)) {
    if (x.type !== 'literal') p[x.type] = x.value;
  }
  return p.hour == null ? '' : (+p.hour) + 'h' + p.minute;
}
// « samedi 12 septembre 2026 à 9h30 » : réservé à ce qui est PROGRAMMÉ. Sans l'heure, un article
// programmé n'affichait que son jour et l'heure choisie restait invisible partout une fois la
// modale fermée (signalé par l'utilisateur le 11/09/2026). La date de publication d'un article
// déjà en ligne, elle, reste au jour seul : c'est du contenu public.
const artQuandLisible = (iso) => {
  const j = artDateLisible(iso), h = artHeureLisible(iso);
  return j && h ? j + ' à ' + h : j;
};
const artIso = (iso) => { const p = iso ? partsParis(iso) : null; return p ? p.year + '-' + p.month + '-' + p.day : ''; };

// carte d'un article dans la grille de blog.html
function artCarte(a) {
  const vignette = a.image
    ? '<img class="thumb" src="' + htmlEsc(a.image) + '" alt="' + htmlEsc(a.categorie + ' — ' + a.titre) + '" loading="lazy" width="1200" height="630" />'
    : '<div class="thumb cat"><span>' + htmlEsc(a.categorie) + '</span></div>';
  const etat = artEnLigne(a) ? '' :
    '<span class="art-etat ' + (a.statut === 'programme' ? 'prog' : 'brou') + '">' +
    (a.statut === 'programme' ? 'Programmé · ' + artQuandLisible(a.datePublication) : 'Brouillon') + '</span>';
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
      ? 'Article programmé pour le ' + htmlEsc(artQuandLisible(a.datePublication)) + ' — visible de vous seul en attendant.'
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
    + '    <a class="btn btn-primary art-cta" href="/contact.html#rappel">Être recontacté →</a>' + NL
    + '  </div>' + NL + '</header>' + NL + NL
    + '<section class="sec" style="padding-top:14px">' + NL + '  <div class="wrap">' + NL
    + bandeau
    // point d'accroche des commandes d'administration (blog-admin.js n'y écrit que pour un admin)
    + '    <div id="ls-art-adm" data-art="' + a.id + '"></div>' + NL
    + '    <div class="art-layout">' + NL
    + '    <div class="art-main">' + NL
    + (a.image ? '    <img class="art-cover" id="ls-art-cover" src="' + htmlEsc(a.image) + '" alt="' + htmlEsc(a.titre) + '" width="1200" height="630" />' + NL : '')
    // encadré d'administration de l'image, UNIQUEMENT en brouillon (une page non publiée n'est
    // servie qu'à l'administration) : le prompt de l'image idéale + le remplacement direct.
    // Les boutons sont câblés par blog-admin.js (le jeton admin vit dans le navigateur).
    + (!artEnLigne(a)
      ? '    <div class="art-imgadm" id="ls-art-imgadm" data-art="' + a.id + '">' + NL
      + '      <div class="art-imgadm-t">Image de couverture · brouillon</div>' + NL
      + '      <p class="art-imgadm-prompt">' + (a.promptImage ? htmlEsc(a.promptImage) : 'Aucun prompt d\'image enregistré pour cet article.') + '</p>' + NL
      + '      <div class="art-imgadm-acts">' + NL
      + (a.promptImage ? '        <button type="button" class="art-imgadm-copier">Copier le prompt</button>' + NL : '')
      + '        <label class="art-imgadm-remplacer">Remplacer l\'image<input type="file" accept="image/jpeg,image/png,image/webp" hidden /></label>' + NL
      + '      </div>' + NL
      + '      <p class="art-imgadm-etat" aria-live="polite"></p>' + NL
      + '    </div>' + NL
      : '')
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
  // ⚠️ Article inconnu, supprimé, dépublié, ou brouillon demandé sans jeton : on REDIRIGE vers la
  // liste des articles. Avant, on tombait dans le repli général qui sert index.html **sous
  // l'adresse /blog/…** : les chemins relatifs de la page d'accueil (assets/site.css) se
  // résolvaient alors en /blog/assets/… → 404 → page d'accueil SANS AUCUN STYLE (défaut trouvé
  // à la vérification mobile du 11/09/2026). La réponse est identique dans tous les cas, elle ne
  // révèle donc pas l'existence d'un brouillon.
  if (!a) return res.redirect(302, '/blog.html');
  const u = userSiConnecte(req);
  if (!artVisiblePar(a, u)) return res.redirect(302, '/blog.html');
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
  fs.access(file, fs.constants.F_OK, (err) => {
    // ⚠️ Même piège que pour /blog/<slug> : servir l'accueil SOUS une adresse en sous-dossier
    // casse tous ses chemins relatifs (page sans style). On redirige donc vers la racine plutôt
    // que de servir une page mal habillée à une adresse qui n'existe pas.
    if (err && (req.path.match(/\//g) || []).length > 1) return res.redirect(302, '/');
    sendHtml(res, err ? path.join(ROOT, 'index.html') : file, req);
  });
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

ensureDemo().then(() => {
  if (SIMULATION) {
    // Serveur de démonstration : n'écoute que sur la machine elle-même (seul le serveur principal
    // lui parle), annonce son port par le canal du parent, et s'arrête avec lui.
    const srv = app.listen(PORT, '127.0.0.1', () => { if (process.send) process.send({ simulationPrete: srv.address().port }); });
    process.on('disconnect', () => process.exit(0));
    return;
  }
  app.listen(PORT, () => console.log(`L&S server → http://localhost:${PORT}`));
});
