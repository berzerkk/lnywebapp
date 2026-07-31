// Notification d'une étape du blog : Slack si un webhook est configuré, e-mail sinon.
//
// La configuration vit dans `data/` — donc HORS dépôt Git, comme le mot de passe SMTP.
//   data/slack.json  →  { "webhook": "https://hooks.slack.com/services/…", "canal": "#blog" }
// Sans ce fichier, on retombe sur le SMTP déjà configuré (data/smtp.json) et le message part
// par e-mail. Le jour où l'URL Slack arrive, il n'y a rien d'autre à changer.
//
// Usage :  node blog/outils/notifier.js "titre" "corps du message"
//   ou en module :  require('./notifier').notifier(titre, corps)
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const DATA = path.join(RACINE, 'data');

// lecture tolérante au BOM (les fichiers créés sous Windows en portent un)
function lireJSON(fichier) {
  try {
    let t = fs.readFileSync(fichier, 'utf8');
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    return JSON.parse(t);
  } catch (e) { return null; }
}

async function versSlack(cfg, titre, corps) {
  const payload = {
    text: titre,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: titre.slice(0, 150), emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: corps.slice(0, 2900) } }
    ]
  };
  if (cfg.canal) payload.channel = cfg.canal;
  const r = await fetch(cfg.webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const txt = await r.text();
  if (!r.ok || txt.trim() !== 'ok') throw new Error('Slack a répondu ' + r.status + ' : ' + txt.slice(0, 200));
  return 'Slack';
}

async function versEmail(titre, corps) {
  const smtp = lireJSON(path.join(DATA, 'smtp.json'));
  if (!smtp || !smtp.host) throw new Error('ni webhook Slack ni configuration SMTP : notification impossible');
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (e) { throw new Error('module nodemailer absent'); }
  const t = nodemailer.createTransport({
    host: smtp.host, port: smtp.port || 465, secure: smtp.secure !== false,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
  });
  const dest = smtp.blogTo || smtp.user;
  await t.sendMail({
    from: smtp.from || smtp.user,
    to: dest,
    subject: '[Blog L&S] ' + titre,
    text: corps.replace(/\*/g, ''),
    html: '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#2a241d">'
      + '<h2 style="font-family:Georgia,serif;font-weight:500">' + echapper(titre) + '</h2>'
      + '<div>' + echapper(corps).replace(/\n/g, '<br>').replace(/\*(.+?)\*/g, '<b>$1</b>') + '</div></div>'
  });
  return 'e-mail (' + dest + ')';
}

const echapper = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Ne jette jamais : une notification ratée ne doit pas faire échouer une publication.
async function notifier(titre, corps) {
  const cfg = lireJSON(path.join(DATA, 'slack.json'));
  try {
    const par = (cfg && cfg.webhook) ? await versSlack(cfg, titre, corps) : await versEmail(titre, corps);
    console.log('✔ notification envoyée par ' + par);
    return true;
  } catch (e) {
    console.error('✖ notification NON envoyée : ' + e.message);
    console.error('  (le message suit, à relayer à la main si besoin)');
    console.error('  ' + titre + '\n  ' + corps.replace(/\n/g, '\n  '));
    return false;
  }
}

module.exports = { notifier };

if (require.main === module) {
  const [titre, corps] = process.argv.slice(2);
  if (!titre) { console.error('usage : node blog/outils/notifier.js "titre" "corps"'); process.exit(1); }
  notifier(titre, corps || '').then(ok => process.exit(ok ? 0 : 1));
}
