/* ============================================================================
   L&S — Backend de l'espace documents (Node + Express)
   Modèle « DOSSIER à 3 » : un formateur ajoute un apprenant → dossier
   { formateur, apprenant, admin } (l'admin est membre de TOUS les dossiers).
   Deux canaux par dossier :
     - "commun"  : formateur + apprenant + admin
     - "prive"   : formateur + admin (l'apprenant n'y a PAS accès)
   Chaque canal = messagerie (chat) + documents. Notifications à chaque envoi.
   Vue admin centralisée : tous les comptes admin voient la même chose.
   Lancer : node server.js   (http://localhost:3000)
   ============================================================================ */
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Header, Footer, ImageRun, PageNumber, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ShadingType, VerticalAlign, HeightRule } = require('docx');
const LOGO_PATH = path.join(__dirname, 'assets', 'ls-logo.png');
const LEGAL_LINES = [
  'ASSOCIATION Loi 1901 LANGUAGES & SUCCESS - L&S',
  'Siège social : 57, route de Grenoble - BP 1052 - 06201 NICE CÉDEX 3 - France',
  'Tél. : 0778873201 - Adresse mail : lny.cambridge@gmail.com',
  'Numéro RNA : W061014363 - SIRET : 881 226 641 00028 - Certificat QUALIOPI : F1017',
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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const init = { users: [], groups: [], docs: [], messages: [], notifs: [], worksheets: [], docgens: [], qs: [], contratRefs: [], secret: crypto.randomBytes(32).toString('hex') };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  d.groups = d.groups || []; d.docs = d.docs || []; d.messages = d.messages || []; d.notifs = d.notifs || []; d.worksheets = d.worksheets || []; d.docgens = d.docgens || []; d.qs = d.qs || []; d.contratRefs = d.contratRefs || [];
  return d;
}
let db = loadDB();
function save() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

const ROLES = ['admin', 'eleve', 'prof'];
const ROLE_LABEL = { admin: 'Administrateur', eleve: 'Apprenant', prof: 'Formateur' };
const ADMIN_ID = 'admins';
const ADMIN_MEMBER = { id: ADMIN_ID, prenom: 'Administration', nom: 'L&S', role: 'admin' };

const pub = (u) => u ? ({ id: u.id, prenom: u.prenom, nom: u.nom, role: u.role, email: u.email }) : null;
const pubFull = (u) => u ? Object.assign(pub(u), { profile: u.profile || {} }) : null;
const sTrim = (v) => String(v == null ? '' : v).trim();
function cleanProfile(role, p) {
  p = p || {};
  if (role === 'eleve') return { tel: sTrim(p.tel), societe: sTrim(p.societe), heuresTotal: sTrim(p.heuresTotal), heuresDetail: sTrim(p.heuresDetail), intitule: sTrim(p.intitule), langue: sTrim(p.langue), dateDebut: sTrim(p.dateDebut), dateFin: sTrim(p.dateFin), lieu: sTrim(p.lieu), lieuAdresse: sTrim(p.lieuAdresse), certification: sTrim(p.certification), certificationText: sTrim(p.certificationText) };
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
function notify(userId, text) { db.notifs.push({ id: crypto.randomUUID(), user: userId, text, read: false, date: Date.now() }); }

// ---- dossiers --------------------------------------------------------------
const groupById = (id) => db.groups.find(g => g.id === id);
function groupsForUser(u) { return u.role === 'admin' ? db.groups.slice() : db.groups.filter(g => g.prof === u.id || g.eleve === u.id); }
function isMember(g, u) { return !!g && (u.role === 'admin' || g.prof === u.id || g.eleve === u.id); }
function canChannel(g, u, ch) { if (!isMember(g, u)) return false; return ch === 'prive' ? (u.role === 'prof' || u.role === 'admin') : true; }
function groupView(g) {
  return { id: g.id, prof: pubFull(realUser(g.prof)), eleve: pubFull(realUser(g.eleve)), admin: { id: ADMIN_ID, prenom: 'Administration', nom: 'L&S', role: 'admin' }, date: g.date };
}
function channelRecipients(g, ch, senderId) {
  const ids = new Set();
  ids.add(g.prof);
  if (ch === 'commun') ids.add(g.eleve);
  db.users.filter(u => u.role === 'admin').forEach(a => ids.add(a.id));
  ids.delete(senderId);
  return [...ids];
}
function notifyChannel(g, ch, sender, text) { channelRecipients(g, ch, sender.id).forEach(id => notify(id, text)); }

// ---- app -------------------------------------------------------------------
const app = express();
app.use(express.json());
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
app.post('/api/signup', async (req, res) => {
  const { prenom, nom, email, password, role, profile } = req.body || {};
  if (!prenom || !nom || !email || !password) return res.status(400).json({ error: 'Champs manquants.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
  const mail = String(email).trim().toLowerCase();
  if (db.users.some(u => u.email === mail)) return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });
  const user = { id: crypto.randomUUID(), prenom: prenom.trim(), nom: nom.trim(), email: mail, passwordHash: await bcrypt.hash(password, 10), role, profile: cleanProfile(role, profile) };
  db.users.push(user); save();
  res.json({ token: sign(user), user: pubFull(user) });
});
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const user = db.users.find(u => u.email === mail);
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  res.json({ token: sign(user), user: pubFull(user) });
});
app.get('/api/me', auth, (req, res) => res.json({ user: pubFull(req.user) }));
app.get('/api/users', auth, (req, res) => {
  let list = db.users.filter(u => u.id !== req.user.id);
  if (req.user.role !== 'admin') list = list.filter(u => u.role !== 'admin'); // non-admins ne voient pas les admins
  res.json({ users: list.map(pub) });
});

// ---- dossiers --------------------------------------------------------------
app.get('/api/groups', auth, (req, res) => {
  res.json({ groups: groupsForUser(req.user).sort((a, b) => b.date - a.date).map(groupView) });
});
app.post('/api/groups', auth, (req, res) => {
  const target = realUser((req.body || {}).targetId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  let prof, eleve;
  if (req.user.role === 'prof' && target.role === 'eleve') { prof = req.user.id; eleve = target.id; }
  else if (req.user.role === 'eleve' && target.role === 'prof') { prof = target.id; eleve = req.user.id; }
  else return res.status(400).json({ error: 'Un formateur ajoute un apprenant (ou inversement).' });
  let g = db.groups.find(x => x.prof === prof && x.eleve === eleve);
  if (!g) {
    g = { id: crypto.randomUUID(), prof, eleve, date: Date.now() };
    db.groups.push(g);
    notify(eleve, `${fullName(prof)} (Formateur) vous a ajouté dans un dossier.`);
    notify(prof, `Dossier ouvert avec ${fullName(eleve)} (Apprenant).`);
    db.users.filter(u => u.role === 'admin').forEach(a => notify(a.id, `Nouveau dossier : ${fullName(prof)} (Formateur) + ${fullName(eleve)} (Apprenant).`));
    save();
  }
  res.json({ ok: true, group: g.id });
});
// suppression (admin) : un dossier → supprime ses fichiers, messages, questionnaires, worksheets
function deleteGroupCascade(gid) {
  db.docs.filter(d => d.group === gid).forEach(d => { try { fs.unlinkSync(path.join(UPLOADS_DIR, d.stored)); } catch (e) { } });
  db.docs = db.docs.filter(d => d.group !== gid);
  db.messages = db.messages.filter(m => m.group !== gid);
  db.qs = db.qs.filter(q => q.group !== gid);
  db.worksheets = db.worksheets.filter(w => w.group !== gid);
  db.docgens = db.docgens.filter(x => x.group !== gid);
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
  db.groups.filter(g => g.prof === u.id || g.eleve === u.id).map(g => g.id).forEach(deleteGroupCascade);
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

// ---- vue admin globale (centralisée) ---------------------------------------
app.get('/api/admin/overview', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const groups = db.groups.slice().sort((a, b) => b.date - a.date).map(g => ({ id: g.id, prof: fullName(g.prof), eleve: fullName(g.eleve), profId: g.prof, eleveId: g.eleve, docs: db.docs.filter(d => d.group === g.id).length, date: g.date }));
  const docs = db.docs.slice().sort((a, b) => b.date - a.date).map(d => { const g = groupById(d.group); return Object.assign(docPub(d), { groupLabel: g ? `${fullName(g.prof)} / ${fullName(g.eleve)}` : '—' }); });
  res.json({ users: db.users.map(pubFull), groups, docs });
});

// ---- génération de documents : Interactive Worksheet -----------------------
const htmlEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nl2br = (s) => htmlEsc(s).replace(/\n/g, '<br>');
const wsFind = (gid) => db.worksheets.find(w => w.group === gid && w.type === 'interactive');
function wsBlank(g) {
  const P = realUser(g.prof), E = realUser(g.eleve);
  const ep = (E && E.profile) || {}, pp = (P && P.profile) || {};
  return {
    group: g.id, type: 'interactive',
    header: { intitule: ep.intitule || '', langue: ep.langue || pp.langue || '', societe: '', nomApprenant: P ? `${E.prenom} ${E.nom}` : '', nomFormateur: P ? `${P.prenom} ${P.nom}` : '', telApprenant: ep.tel || '', telFormateur: pp.tel || '', mailApprenant: E ? E.email : '', mailFormateur: P ? P.email : '', notes: { vocabulaire: '', structure: '', communication: '', autre: '' } },
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
  res.json({ worksheet: wsFind(g.id) || wsBlank(g) });
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
  return new TableCell({ width: o.width, columnSpan: o.span, borders: TBL_CELLBORDERS, verticalAlign: o.valign || V_CENTER, shading: o.fill ? { type: SH_CLEAR, color: 'auto', fill: o.fill } : undefined, margins: { top: 36, bottom: 36, left: 90, right: 90 }, children });
}
function dxPara(text, o) {
  o = o || {};
  const runs = String(text == null ? '' : text).split('\n').map((ln, i) => new TextRun({ text: ln, break: i > 0 ? 1 : undefined, bold: !!o.bold, italics: !!o.italics, color: o.color || INKC, size: o.size || 20 }));
  return new Paragraph({ alignment: o.align || AlignmentType.LEFT, spacing: { before: o.before || 0, after: o.after == null ? 80 : o.after }, children: runs });
}
const dxTable = (rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
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

app.post('/api/worksheet/generate', auth, async (req, res) => {
  const { group, format } = req.body || {};
  const fmt = (format === 'word' || format === 'docx') ? 'word' : 'pdf';
  const g = groupById(group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const w = wsFind(g.id) || wsBlank(g);
  let buf, ext, type;
  try {
    if (fmt === 'word') { buf = await buildWorksheetDocx(w, req.user); ext = 'docx'; type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildWorksheetPdf(w, req.user); ext = 'pdf'; type = 'application/pdf'; }
  } catch (e) { console.error('Génération worksheet:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  // historique de génération (réouvrable pour dupliquer) — on garde les 30 derniers par dossier
  db.docgens.push({ id: crypto.randomUUID(), group: g.id, format: fmt, date: Date.now(), byName: senderDisplay(req.user), apprenant: (w.header && w.header.nomApprenant) || 'apprenant', sessionCount: (w.sessions || []).length, snapshot: { header: w.header || {}, sessions: w.sessions || [] } });
  const gh = db.docgens.filter(x => x.group === g.id).sort((a, b) => a.date - b.date);
  while (gh.length > 30) { const old = gh.shift(); db.docgens = db.docgens.filter(x => x.id !== old.id); }
  save();
  // on renvoie directement le fichier en téléchargement (aucun dépôt dans le dossier)
  const name = `Interactive Worksheet - ${safeFile((w.header && w.header.nomApprenant) || 'apprenant')} - ${nameDate()}.${ext}`;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

app.get('/api/worksheet/history', auth, (req, res) => {
  const g = groupById(req.query.group);
  if (!canEditWs(g, req.user)) return res.status(403).json({ error: 'Accès refusé.' });
  const history = db.docgens.filter(x => x.group === g.id).sort((a, b) => b.date - a.date)
    .map(x => ({ id: x.id, format: x.format, date: x.date, byName: x.byName, apprenant: x.apprenant, sessionCount: x.sessionCount, snapshot: x.snapshot }));
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
  if (H.certification) rows.push(new TableRow({ children: [dxCell('Certification : ' + H.certification, { span: 2 })] }));
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
    if (H.certification) rows.push({ cells: [{ text: 'Certification : ' + H.certification, w: totalW, size: 10 }] });
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
  const name = safeFile(tpl.title) + ' - ' + safeFile((header && header.nomApprenant) || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

// ---- Attestation de fin de stage (formateur + admin) -----------------------
const ATT_NIVEAUX = ['Acquis', "En cours d'acquisition", 'Non acquis'];
function buildAttestationDocx(d, user) {
  const PC = (s) => ({ size: s, type: WidthType.PERCENTAGE });
  const lc = (t) => dxCell(t, { width: PC(34), fill: LBLBG, bold: true }), vc = (t) => dxCell(t || '', { width: PC(66) });
  const kids = [];
  kids.push(dxTable([new TableRow({ children: [dxCell('ATTESTATION DE FIN DE STAGE', { align: AlignmentType.CENTER, bold: true, color: ACCENTC, size: 30, fill: HEADBG })] })]));
  kids.push(dxSpacer());
  kids.push(dxPara("Je soussigné, " + (d.representant || 'Antonin HATTABE') + ", représentant de l'organisme de formation LANGUAGES & SUCCESS - L&S, numéro de déclaration d'activité 93 060 886 106, certificat QUALIOPI F1017, atteste que :", { after: 140 }));
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
  kids.push(dxPara('Objectifs de la formation', { bold: true, color: DARKC, size: 24, before: 80, after: 80 }));
  (d.objectifs || '').split('\n').filter(x => x.trim()).forEach(o => kids.push(dxPara('• ' + o.trim(), { after: 40 })));
  kids.push(dxPara('Nature de la formation :', { bold: true, before: 140 }));
  kids.push(dxPara("Action d'acquisition, d'entretien ou de perfectionnement de la langue.", { after: 140 }));
  kids.push(dxPara("Résultat de l'évaluation des acquis :", { bold: true, color: DARKC, before: 80, after: 80 }));
  const compRows = [new TableRow({ tableHeader: true, children: [dxCell('Compétence', { width: PC(40), fill: HEADBG, bold: true })].concat(ATT_NIVEAUX.map(n => dxCell(n, { width: PC(20), fill: HEADBG, bold: true, align: AlignmentType.CENTER, size: 16 }))) })];
  (d.competences || []).filter(c => c && c.label && c.label.trim()).forEach(c => {
    compRows.push(new TableRow({ children: [dxCell(c.label, { width: PC(40) })].concat(ATT_NIVEAUX.map(n => { const sel = c.niveau === n; return dxCell(sel ? '✗' : '', { width: PC(20), align: AlignmentType.CENTER, bold: true, fill: sel ? ACCENTC : undefined, color: sel ? 'FFFFFF' : INKC, size: 22 }); })) }));
  });
  if (compRows.length > 1) { kids.push(dxTable(compRows)); kids.push(dxSpacer()); }
  kids.push(dxPara("Niveau atteint à l'issue de la formation : " + (d.niveauAtteint || ''), { after: 50 }));
  kids.push(dxPara('Certification : ' + (d.certification || '') + '     Date : ' + (d.dateEval || '') + '     Résultat : ' + (d.resultat || ''), { after: 140 }));
  kids.push(dxPara('Commentaires du formateur :', { bold: true, after: 60 }));
  kids.push(dxPara(d.commentaires || '', { after: 160 }));
  kids.push(dxPara('Fait à ' + (d.lieuFait || 'Nice') + ', le ' + (d.dateFait || ''), { before: 80, after: 220 }));
  kids.push(dxPara((d.representant || 'Antonin HATTABE') + ", Président          Le Formateur          L'apprenant", { after: 60 }));
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
    doc.moveDown(0.5);
    p("Je soussigné, " + (d.representant || 'Antonin HATTABE') + ", représentant de l'organisme de formation LANGUAGES & SUCCESS - L&S, numéro de déclaration d'activité 93 060 886 106, certificat QUALIOPI F1017, atteste que :", { after: 0.5 });
    const lw = totalW * 0.34, vw = totalW * 0.66;
    const inf = [["L'apprenant", d.apprenant], ['De la société', d.societe], ['A suivi la formation', d.intitule], ['Période', 'Du ' + (d.dateDebut || '…') + ' au ' + (d.dateFin || '…')], ['Durée totale', d.dureeTotale], ['Dont', d.dureeDetail], ['À', d.lieu || 'Distanciel'], ['Avec', d.formateur]];
    pdfRows(doc, inf.map(r => ({ cells: [{ text: r[0], w: lw, fill: '#f7eee9', bold: true, size: 9 }, { text: r[1] || '', w: vw, size: 9 }] })), left);
    doc.moveDown(0.5);
    p('Objectifs de la formation', { bold: true, color: '#a8593c', size: 12, after: 0.3 });
    (d.objectifs || '').split('\n').filter(x => x.trim()).forEach(o => p('• ' + o.trim(), { after: 0.15 }));
    doc.moveDown(0.3); p('Nature de la formation :', { bold: true, after: 0.15 });
    p("Action d'acquisition, d'entretien ou de perfectionnement de la langue.", { after: 0.5 });
    p("Résultat de l'évaluation des acquis :", { bold: true, color: '#a8593c', size: 11, after: 0.3 });
    const comps = (d.competences || []).filter(c => c && c.label && c.label.trim());
    if (comps.length) {
      const cw = totalW * 0.4, ow = (totalW * 0.6) / 3;
      const crows = [{ cells: [{ text: 'Compétence', w: cw, fill: '#f3e7e0', bold: true, size: 9 }].concat(ATT_NIVEAUX.map(n => ({ text: n, w: ow, fill: '#f3e7e0', bold: true, align: 'center', size: 8 }))) }];
      comps.forEach(c => crows.push({ cells: [{ text: c.label, w: cw, size: 9 }].concat(ATT_NIVEAUX.map(n => { const sel = c.niveau === n; return { text: sel ? 'X' : '', w: ow, align: 'center', bold: true, fill: sel ? '#be6e54' : null, color: '#ffffff', size: 11 }; })) }));
      pdfRows(doc, crows, left); doc.moveDown(0.5);
    }
    p("Niveau atteint à l'issue de la formation : " + (d.niveauAtteint || ''), { after: 0.2 });
    p('Certification : ' + (d.certification || '') + '     Date : ' + (d.dateEval || '') + '     Résultat : ' + (d.resultat || ''), { after: 0.5 });
    p('Commentaires du formateur :', { bold: true, after: 0.2 }); p(d.commentaires || '', { after: 0.6 });
    p('Fait à ' + (d.lieuFait || 'Nice') + ', le ' + (d.dateFait || ''), { after: 0.8 });
    p((d.representant || 'Antonin HATTABE') + ", Président          Le Formateur          L'apprenant");
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
  const name = safeFile('Attestation de fin de stage') + ' - ' + safeFile(d.apprenant || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

// ---- Contrat de sous-traitance (admin uniquement) --------------------------
function contratBlocks(d) {
  const rep = d.representant || 'Antonin HATTABE';
  return [
    { h1: 'CONTRAT DE SOUS-TRAITANCE DE FORMATION' },
    { sub: d.ref || 'Réf. n° 2023/L&S0701' },
    { p: 'ENTRE LES SOUSSIGNÉS :', bold: true },
    { p: `LANGUAGES & SUCCESS - L&S (enregistré sous le N° 93 060 886 106 auprès du Préfet de la région PACA - Certificat QUALIOPI F1017) - 57, route de Grenoble - BP 1052 - 06201 NICE CÉDEX 3, représenté par ${rep}, Président, en application des dispositions de la partie VI du Code du travail. Ci-après dénommé « LANGUAGES & SUCCESS - L&S » ou le « Donneur d'ordre ».` },
    { p: 'ET', bold: true },
    { p: `${d.stnom || ''}`, bold: true },
    { p: `Né(e) le ${d.stNaissance || '…'}, de nationalité ${d.stNationalite || '…'}, demeurant ${d.stAdresse || '…'}. Inscrit(e) au répertoire INSEE en qualité d'autoentrepreneur sous le numéro ${d.stSiret || '…'}. Numéro de Déclaration d'Activité (NDA) : ${d.stNda || '…'}.` },
    { p: `Ci-après dénommé(e) « ${d.stnom || 'le Sous-traitant'} » ou « le Sous-traitant ».` },
    { p: 'IL A ÉTÉ CONVENU CE QUI SUIT :', bold: true },
    { art: 'ARTICLE 1 – OBJET ET NATURE DU CONTRAT DE FORMATION' },
    { p: "Le présent contrat est conclu dans le cadre d'une prestation de formation ponctuelle réalisée par le sous-traitant au bénéfice du donneur d'ordre." },
    { p: `La formation est dénommée : « ${d.intitule || '…'} » en ${d.langue || '…'}.` },
    { p: "Type d'action de formation (art. L6313-1 du code du travail) : action d'acquisition, d'entretien ou de perfectionnement de la langue." },
    { p: `Stagiaire(s) : ${d.stagiaire || '…'}` },
    { p: `Durée : ${d.duree || '…'}` },
    { p: `Lieu de la formation : ${d.lieu || 'en distanciel (Visioconférence et/ou téléphone)'}` },
    { p: `Dates de formation : du ${d.dateDebut || '…'} au ${d.dateFin || '…'}` },
    { art: 'ARTICLE 2 – DURÉE DU CONTRAT' },
    { p: "Le présent contrat est strictement limité à la prestation de formation visée à l'article 1. Il cesse de plein droit à son terme." },
    { art: 'ARTICLE 3 – OBLIGATIONS DU SOUS-TRAITANT' },
    { li: "Respecter les objectifs imposés par le Donneur d'ordre." },
    { li: "Ne pas déléguer sa mission à un autre formateur et, d'une manière générale, ne pas avoir lui-même recours à la sous-traitance." },
    { li: "Pendant la formation, effectuer un test mi-parcours, un test de fin de parcours et remplir l'Interactive Worksheet en la communiquant après chaque cours au stagiaire." },
    { li: "Informer immédiatement le Donneur d'ordre en cas de difficultés rencontrées avec le stagiaire et/ou l'entreprise." },
    { li: "Après la formation, remplir l'attestation de fin de formation et la faire signer au stagiaire." },
    { li: "Communiquer au Donneur d'ordre l'ensemble des documents dûment remplis et signés (feuilles de présence, questionnaires et tests mi-parcours et de fin de formation, attestation de fin de formation, et tout autre document obligatoire QUALIOPI), au plus tard 5 jours après la fin de la formation." },
    { li: "Appliquer un devoir de réserve et de confidentialité au regard du stagiaire et/ou de l'entreprise." },
    { li: "Souscrire une police d'assurance RCP et en fournir une copie au Donneur d'ordre." },
    { li: "Posséder un Numéro de Déclaration d'Activité (NDA) et en fournir une copie." },
    { art: "ARTICLE 4 – OBLIGATIONS DU DONNEUR D'ORDRE" },
    { li: "Confier au Sous-traitant la formation prévue à l'article 1." },
    { li: "Communiquer au Sous-traitant l'ensemble des informations et documents utiles (test de niveau, feuilles de présence, programme de formation)." },
    { li: "Assurer la gestion et la logistique de la formation." },
    { li: "Respecter la propriété intellectuelle du contenu et des supports de la formation." },
    { li: "Informer le sous-traitant de l'annulation et des changements éventuels de date, au plus tard 5 jours à l'avance." },
    { art: 'ARTICLE 5 – MODALITÉS FINANCIÈRES' },
    { p: `En contrepartie de ses prestations, le Sous-traitant percevra une rémunération de ${d.tauxHoraire || '…'} HT par heure de cours effectuée,` },
    { p: `Soit un total de ${d.montantTotal || '…'} HT pour l'intégralité de la prestation de sous-traitance.` },
    { p: "Le règlement sera effectué dans un délai de 5 jours maximum, à réception d'une facture accompagnée des feuilles de présence correspondant aux heures effectuées, dûment remplies et signées (par le Sous-traitant et le stagiaire)." },
    { p: "Le règlement de la facture finale est conditionné par l'envoi de l'ensemble des documents obligatoires QUALIOPI dûment remplis et signés. Le Sous-traitant remettra un relevé d'identité bancaire (RIB) afin de faciliter les règlements." },
    { art: 'ARTICLE 6 – OBLIGATION DE LOYAUTÉ ET DE NON CAPTATION DE CLIENTÈLE' },
    { p: "Les parties s'engagent à se comporter l'une envers l'autre comme des partenaires loyaux et de bonne foi. Le Sous-traitant reconnaît que les clients de l'Association LANGUAGES & SUCCESS - L&S restent son entière propriété, et s'engage à ne pas les démarcher, pendant la durée du contrat et après sa cessation, sans limitation de temps." },
    { art: 'ARTICLE 7 – CONFIDENTIALITÉ' },
    { p: "Le Formateur s'engage à considérer comme strictement confidentielles toutes les informations communiquées par le Donneur d'ordre (produits, services, outils et méthodes pédagogiques, contenus de cours), pendant toute la durée du contrat et sans limitation après son expiration." },
    { art: 'ARTICLE 8 – RÉSILIATION ANTICIPÉE' },
    { p: "Le présent contrat pourra être résilié par anticipation en cas d'inexécution de l'une des obligations, 8 jours après une mise en demeure restée sans effet, ainsi qu'en cas de liquidation ou redressement judiciaire de l'une ou l'autre des parties." },
    { art: 'ARTICLE 9 – LITIGES' },
    { p: "Le présent contrat est soumis au droit français. Tout litige qui n'aurait pu être réglé à l'amiable sera soumis à la compétence exclusive du Tribunal de Commerce de NICE (06)." },
    { p: `Fait à ${d.lieuFait || 'Nice'}, le ${d.dateFait || ''}`, before: true },
    { p: `Pour le Donneur d'ordre, LANGUAGES & SUCCESS - L&S — ${rep}, Président                    Pour le Sous-traitant, ${d.stnom || ''}` }
  ];
}
function buildContratDocx(d, user) {
  const kids = [];
  contratBlocks(d).forEach(b => {
    if (b.h1) kids.push(dxPara(b.h1, { bold: true, color: ACCENTC, size: 28, align: AlignmentType.CENTER, after: 40 }));
    else if (b.sub) kids.push(dxPara(b.sub, { color: SOFTC, italics: true, align: AlignmentType.CENTER, after: 140 }));
    else if (b.art) kids.push(dxPara(b.art, { bold: true, color: DARKC, size: 23, before: 200, after: 80 }));
    else if (b.li) kids.push(dxPara('• ' + b.li, { size: 18, after: 50 }));
    else kids.push(dxPara(b.p, { bold: !!b.bold, size: 19, before: b.before ? 160 : 0, after: 90 }));
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
    contratBlocks(d).forEach(b => {
      if (b.h1) p(b.h1, { bold: true, color: '#be6e54', size: 15, align: 'center', after: 0.25 });
      else if (b.sub) p(b.sub, { color: '#6f6253', italics: true, align: 'center', size: 9, after: 0.7 });
      else if (b.art) p(b.art, { bold: true, color: '#a8593c', size: 11, after: 0.3 });
      else if (b.li) p('•  ' + b.li, { size: 9, after: 0.2 });
      else p(b.p, { bold: !!b.bold, size: 9.2, after: 0.45 });
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
  const { fields, format } = req.body || {};
  const d = fields || {};
  d.ref = newContratRef(); // référence unique générée serveur (5 chiffres uniques)
  d.representant = 'Antonin HATTABE'; // représentant L&S fixe par défaut
  let buf, ext, ctype;
  try {
    if (format === 'word' || format === 'docx') { buf = await buildContratDocx(d, req.user); ext = 'docx'; ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
    else { buf = await buildContratPdf(d, req.user); ext = 'pdf'; ctype = 'application/pdf'; }
  } catch (e) { console.error('contrat:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  const name = safeFile('Contrat de sous-traitance') + ' - ' + safeFile(d.stnom || 'formateur') + ' - ' + nameDate() + '.' + ext;
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
  const name = safeFile(tpl.title) + ' - ' + safeFile((qs.header && qs.header.nomApprenant) || 'apprenant') + ' - ' + nameDate() + '.' + ext;
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
  const qs = { id: crypto.randomUUID(), group: g.id, type, header: header || {}, answers: {}, status: 'pending', docId: null, by: req.user.id, date: Date.now() };
  db.qs.push(qs);
  db.messages.push({ id: crypto.randomUUID(), group: g.id, channel: 'commun', from: req.user.id, fromAdmin: req.user.role === 'admin', kind: 'qs', qsId: qs.id, qsType: type, text: 'Demande de remplissage : ' + tpl.title, date: Date.now() });
  notify(g.eleve, `${senderDisplay(req.user)} vous demande de remplir : ${tpl.title}`);
  db.users.filter(u => u.role === 'admin' && u.id !== req.user.id).forEach(a => notify(a.id, `${senderDisplay(req.user)} a envoyé un questionnaire à remplir (${tpl.title}).`));
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
  qs.answers = (req.body || {}).answers || {}; qs.status = 'done'; qs.filledBy = req.user.id; qs.filledAt = Date.now();
  let doc;
  try { doc = await generateQsDoc(qs, (req.body || {}).format, req.user); } catch (e) { console.error('QS gen:', e); return res.status(500).json({ error: 'Erreur de génération du document.' }); }
  qs.docId = doc.id;
  notifyChannel(g, 'commun', req.user, `${senderDisplay(req.user)} a rempli et déposé : ${(QS_TEMPLATES[qs.type] || {}).title}`);
  save();
  res.json({ ok: true, doc: docPub(doc) });
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
  const name = safeFile(tpl.title) + ' - ' + safeFile((header && header.nomApprenant) || 'apprenant') + ' - ' + nameDate() + '.' + ext;
  res.setHeader('Content-Type', ctype);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.send(buf);
});

// comptes démo (email + mot de passe affichés sur la page de connexion)
app.get('/api/demo-accounts', (req, res) => res.json({ accounts: DEMO_ACCOUNTS.map(d => ({ email: d.email, password: DEMO_PASSWORD, role: d.role, name: `${d.prenom} ${d.nom}` })) }));

// ---- statique (site) -------------------------------------------------------
app.use(express.static(ROOT, { extensions: ['html'] }));
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(ROOT, 'index.html'));
  res.status(404).json({ error: 'Not found' });
});
// ---- comptes démo (affichés sur la page de connexion) ----------------------
const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS = [
  { email: 'admin@ls.fr', prenom: 'Alice', nom: 'Admin', role: 'admin', profile: {} },
  { email: 'prof@ls.fr', prenom: 'Paul', nom: 'Formateur', role: 'prof', profile: { langue: 'Anglais', siret: '881 226 641 00028', nda: '93 060 886 106', adresse: '57 route de Grenoble, 06200 Nice', tel: '06 12 34 56 78', dateNaissance: '12/04/1985', nationalite: 'Française' } },
  { email: 'eleve@ls.fr', prenom: 'Léa', nom: 'Apprenante', role: 'eleve', profile: { tel: '06 98 76 54 32', societe: 'ACME SAS', heuresTotal: '40 h', heuresDetail: '20 h en visioconférence + 20 h en présentiel', intitule: 'Anglais professionnel', langue: 'Anglais', dateDebut: '15/09/2026', dateFin: '20/12/2026', lieu: 'distanciel', lieuAdresse: '', certification: 'oui', certificationText: 'Certification LINGUASKILL (Cambridge)' } }
];
async function ensureDemo() {
  let changed = false;
  for (const d of DEMO_ACCOUNTS) {
    if (!db.users.some(u => u.email === d.email)) {
      db.users.push({ id: crypto.randomUUID(), prenom: d.prenom, nom: d.nom, email: d.email, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10), role: d.role, profile: d.profile });
      changed = true;
    }
  }
  const prof = db.users.find(u => u.email === 'prof@ls.fr'), eleve = db.users.find(u => u.email === 'eleve@ls.fr');
  if (prof && eleve && !db.groups.some(g => g.prof === prof.id && g.eleve === eleve.id)) { db.groups.push({ id: crypto.randomUUID(), prof: prof.id, eleve: eleve.id, date: Date.now() }); changed = true; }
  if (changed) save();
}

ensureDemo().then(() => app.listen(PORT, () => console.log(`L&S server → http://localhost:${PORT}`)));
