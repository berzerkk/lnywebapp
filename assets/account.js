/* ============================================================================
   L&S — Espace documents (client). Parle à l'API Node (server.js).
   Modèle « DOSSIER à 3 » (formateur + apprenant + admin) avec 2 canaux par
   dossier : "commun" (les 3) et "prive" (formateur + admin). Chaque canal =
   documents + messagerie. Notifications + vue admin centralisée.
   ============================================================================ */
(function () {
  'use strict';

  var TKEY = 'lsx_token';
  function token() { return localStorage.getItem(TKEY); }
  function setToken(t) { if (t) localStorage.setItem(TKEY, t); else localStorage.removeItem(TKEY); }

  function api(path, opts) {
    opts = opts || {}; opts.headers = opts.headers || {};
    var t = token(); if (t) opts.headers.Authorization = 'Bearer ' + t;
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; })
        .catch(function () { return { ok: r.ok, status: r.status, data: {} }; });
    // Coupure réseau (serveur en cours de redémarrage lors d'une mise à jour, wifi
    // perdu…) : on ne laisse JAMAIS la promesse échouer, sinon la suite du code ne
    // s'exécute pas du tout et l'interface reste figée sans rien dire à l'utilisateur.
    }).catch(function () {
      return { ok: false, status: 0, offline: true, data: { error: 'Connexion au serveur interrompue. Réessayez dans un instant.' } };
    });
  }
  function apiJSON(path, method, body) { return api(path, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

  var ROLES = { admin: 'Administrateur', eleve: 'Apprenant', prof: 'Formateur' };
  var EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.1 10.1 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"/></svg>';

  var ME = null, NOTIFS = [], selected = null, channel = 'commun', authTab = 'login', genState = null;
  var adminShow = { dossiers: true, comptes: true, fichiers: true }, adminQuery = '', ADMIN_OVERVIEW = null;
  // dossiers dont la liste de fichiers est repliée (en mémoire : l'état survit aux re-rendus
  // du panneau admin — filtrage, suppression — mais pas au rechargement de la page)
  var admFilesHidden = {};
  var CUR_GROUP = null, qsFillState = null, notifTimer = null, DEMO = null;
  // visite guidée à jouer dès que le tableau de bord sera peint (première connexion)
  var TUTO_PENDING = false;
  // Un dossier = UN apprenant, mais autant de FORMATEURS que voulu. GEN_PROF = le formateur au
  // nom duquel le document en cours est établi (choisi dans la modale « Générer un document »
  // quand le dossier en compte plusieurs ; sinon, soi-même).
  var GEN_PROF = null;
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function fmtSize(b) { if (b < 1024) return b + ' o'; if (b < 1048576) return (b / 1024).toFixed(0) + ' Ko'; return (b / 1048576).toFixed(1) + ' Mo'; }
  function fmtDate(t) { var d = new Date(t); return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  function fmtTime(t) { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  function fullName(u) { return u ? (u.prenom + ' ' + (u.nom || '')).trim() : '—'; }
  function initials(name) { var p = (name || '').trim().split(/\s+/); return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || ''); }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function err(id, msg) { var el = document.getElementById(id); if (el) el.textContent = msg; }
  function app() { return document.getElementById('docspace'); }

  // ---- widget header ------------------------------------------------------
  function renderHeader() {
    var mount = document.getElementById('ls-account');
    if (!mount) return;
    if (!ME) {
      // déconnecté : un seul bouton « Espace documents » (pilule encre, comme « Faire le test de niveau »)
      mount.innerHTML = '<a class="header-cta acct-espace" href="espace-documents.html">Espace documents</a>';
      syncMobileMenu();
      return;
    }
    var n = NOTIFS.filter(function (x) { return !x.read; }).length;
    mount.innerHTML =
      '<button class="acct-bell" id="acct-bell-btn" title="Notifications" aria-label="Notifications">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>' +
        (n > 0 ? '<span class="acct-badge">' + (n > 9 ? '9+' : n) + '</span>' : '') +
      '</button><a class="acct-link" href="espace-documents.html" title="Mon espace">' + esc(ME.prenom) + '</a>';
    var bell = mount.querySelector('#acct-bell-btn'); if (bell) bell.onclick = openNotifModal;
    syncMobileMenu();
  }
  // synchronise la section "Espace documents" du menu hamburger selon l'état connecté
  function syncMobileMenu() {
    var mm = document.querySelector('.mm-account'); if (!mm) return;
    if (!ME) {
      mm.innerHTML = '<span class="mm-title">Espace documents</span>' +
        '<a href="espace-documents.html" class="header-cta header-cta-accent">Se connecter</a>';
    } else {
      mm.innerHTML = '<span class="mm-title">Espace documents</span>' +
        '<a href="espace-documents.html" class="header-cta header-cta-accent">Mon espace · ' + esc(ME.prenom) + '</a>' +
        '<button type="button" class="header-cta mm-logout">Se déconnecter</button>';
      var lo = mm.querySelector('.mm-logout'); if (lo) lo.onclick = function () { closeMobileMenu(); logout(); };
    }
  }
  function closeMobileMenu() { var m = document.getElementById('mobile-menu'), b = document.getElementById('nav-backdrop'); if (m) m.classList.remove('open'); if (b) b.classList.remove('open'); document.body.classList.remove('menu-open'); }
  function logout() { setToken(null); ME = null; NOTIFS = []; selected = null; if (notifTimer) { clearInterval(notifTimer); notifTimer = null; } renderHeader(); if (app()) renderAuth(); }

  // ---- modale notifications ----------------------------------------------
  function ensureNotifModal() {
    if (document.getElementById('notif-modal')) return;
    var m = document.createElement('div'); m.id = 'notif-modal'; m.className = 'notif-modal';
    m.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card"><div class="nm-head"><h3>Notifications</h3><div class="nm-head-actions"><button class="nm-clear link-btn" type="button">Tout supprimer</button><button class="nm-close" aria-label="Fermer">&times;</button></div></div><div class="nm-body" id="nm-body"></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (!e.target.closest('.nm-card')) closeNotifModal(); });
    m.querySelector('.nm-close').onclick = closeNotifModal;
    m.querySelector('.nm-clear').onclick = function () {
      if (!NOTIFS.length) return;
      apiJSON('/api/notifications/clear', 'POST', {}).then(function () { NOTIFS = []; renderNotifList(); renderHeader(); });
    };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNotifModal(); });
  }
  function renderNotifList() {
    var body = document.getElementById('nm-body'); if (!body) return;
    var clear = document.querySelector('#notif-modal .nm-clear'); if (clear) clear.style.display = NOTIFS.length ? '' : 'none';
    body.innerHTML = NOTIFS.length ? '<ul class="notif-list">' + NOTIFS.map(function (n) {
      return '<li class="' + (n.read ? '' : 'unread') + '"><span>' + esc(n.text) + '</span><time>' + fmtDate(n.date) + '</time><button class="notif-del" data-id="' + n.id + '" aria-label="Supprimer cette notification" title="Supprimer">&times;</button></li>';
    }).join('') + '</ul>' : '<p class="ds-empty">Aucune notification.</p>';
    body.querySelectorAll('.notif-del').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id');
        apiJSON('/api/notifications/delete', 'POST', { id: id }).then(function () { NOTIFS = NOTIFS.filter(function (n) { return n.id !== id; }); renderNotifList(); renderHeader(); });
      };
    });
  }
  function openNotifModal() {
    ensureNotifModal();
    renderNotifList();
    document.getElementById('notif-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    apiJSON('/api/notifications/read', 'POST', {}).then(function () { NOTIFS.forEach(function (n) { n.read = true; }); renderHeader(); });
  }
  function closeNotifModal() { var m = document.getElementById('notif-modal'); if (m) { m.classList.remove('open'); document.body.style.overflow = ''; } if (app() && ME) renderDashboard(); }

  // ---- boot ---------------------------------------------------------------
  function boot() {
    // lien d'activation reçu par e-mail : la personne choisit elle-même son mot de passe
    var act = /[#&]activation=([a-f0-9]{16,})/i.exec(location.hash || '');
    if (act && app()) { ME = null; renderHeader(); renderActivate(act[1]); return; }
    if (!token()) { ME = null; renderHeader(); if (app()) renderAuth(); return; }
    api('/api/me').then(function (r) {
      if (!r.ok) { setToken(null); ME = null; renderHeader(); if (app()) renderAuth(); return; }
      ME = r.data.user;
      TUTO_PENDING = !!ME.tutoAVoir;
      return api('/api/notifications').then(function (n) { NOTIFS = (n.ok && n.data.notifs) || []; renderHeader(); if (app()) renderDashboard(); startNotifPoll(); });
    });
  }
  // ---- rafraîchissement live des notifications ----------------------------
  function startNotifPoll() {
    if (notifTimer) clearInterval(notifTimer);
    notifTimer = setInterval(function () {
      if (!token() || !ME) { clearInterval(notifTimer); notifTimer = null; return; }
      api('/api/notifications').then(function (n) {
        if (!n.ok) return;
        NOTIFS = n.data.notifs || []; renderHeader();
        var nm = document.getElementById('notif-modal');
        if (nm && nm.classList.contains('open')) renderNotifList();
      });
    }, 20000);
  }

  // ---- connexion (l'inscription publique est fermée : comptes créés par l'admin)
  function renderAuth() {
    var el = app(); if (!el) return;
    el.innerHTML = '<div class="auth-wrap"><div class="auth-tabs">' +
      '<button class="auth-tab on" type="button">Se connecter</button></div>' +
      loginForm() + '</div>';
    wireEyes(el);
    var lf = document.getElementById('login-form');
    if (lf) lf.onsubmit = function (e) {
      e.preventDefault();
      apiJSON('/api/login', 'POST', { email: val('li-email'), password: val('li-pwd') }).then(function (r) {
        if (!r.ok) { err('login-err', r.data.error || 'Connexion impossible.'); return; }
        setToken(r.data.token); ME = r.data.user; selected = null; afterAuth();
      });
    };
    // comptes démo (page de connexion)
    if (DEMO === null) { api('/api/demo-accounts').then(function (r) { DEMO = (r.ok && r.data.accounts) || []; if (app() && !ME) renderAuth(); }); }
    el.querySelectorAll('.demo-login').forEach(function (b) {
      b.onclick = function () {
        apiJSON('/api/login', 'POST', { email: b.getAttribute('data-email'), password: b.getAttribute('data-pwd') }).then(function (r) {
          if (!r.ok) { err('login-err', (r.data && r.data.error) || 'Connexion impossible.'); return; }
          setToken(r.data.token); ME = r.data.user; selected = null; afterAuth();
        });
      };
    });
  }
  // ---- première connexion : la personne définit son mot de passe -----------
  function renderActivate(tok) {
    var el = app(); if (!el) return;
    el.innerHTML = '<div class="auth-wrap"><div class="auth-tabs"><button class="auth-tab on" type="button">Première connexion</button></div>' +
      '<p class="ds-empty" id="act-load">Vérification de votre lien…</p></div>';
    api('/api/activate/' + encodeURIComponent(tok)).then(function (r) {
      var wrap = el.querySelector('.auth-wrap'); if (!wrap) return;
      if (!r.ok) {
        wrap.innerHTML = '<div class="auth-tabs"><button class="auth-tab on" type="button">Lien expiré</button></div>' +
          '<p class="auth-err" style="display:block;text-align:center">' + esc((r.data && r.data.error) || 'Ce lien est invalide ou a expiré.') + '</p>' +
          '<p class="chan-note" style="text-align:center">Écrivez à <a href="mailto:admin@languagesandsuccess.com">admin@languagesandsuccess.com</a> pour recevoir un nouveau lien.</p>' +
          '<p style="text-align:center;margin-top:6px"><button class="btn btn-ghost act-back" type="button">Retour à la connexion</button></p>';
        wrap.querySelector('.act-back').onclick = function () { location.replace(location.pathname + location.search); };
        return;
      }
      setToken(null);   // le lien vaut pour SON destinataire : on ferme la session en cours (poste partagé)
      renderHeader();
      wrap.innerHTML = '<div class="auth-tabs"><button class="auth-tab on" type="button">Bienvenue ' + esc(r.data.prenom) + '</button></div>' +
        '<form class="form auth-form" id="act-form" style="max-width:none">' +
        '<p class="chan-note" style="margin:0 0 4px">Votre compte <b>' + esc(r.data.email) + '</b> est prêt. Choisissez le mot de passe qui vous servira à vous connecter (6 caractères minimum).</p>' +
        pwdField('ac-pwd', 'Votre mot de passe') + pwdField('ac-pwd2', 'Confirmer le mot de passe') +
        '<p class="auth-err" id="act-err"></p><button class="btn btn-primary" type="submit" style="justify-self:center">Valider et accéder à mon espace →</button></form>';
      wireEyes(wrap);
      wrap.querySelector('#act-form').onsubmit = function (e) {
        e.preventDefault();
        var p1 = val('ac-pwd'), p2 = val('ac-pwd2');
        if (p1.length < 6) { err('act-err', 'Le mot de passe doit faire au moins 6 caractères.'); return; }
        if (p1 !== p2) { err('act-err', 'Les deux mots de passe ne correspondent pas.'); return; }
        var btn = wrap.querySelector('#act-form button[type=submit]'); btn.disabled = true;
        apiJSON('/api/activate', 'POST', { token: tok, password: p1 }).then(function (r2) {
          btn.disabled = false;
          if (!r2.ok) { err('act-err', (r2.data && r2.data.error) || 'Activation impossible.'); return; }
          history.replaceState(null, '', location.pathname + location.search); // le jeton disparaît de l'URL
          setToken(r2.data.token); ME = r2.data.user; selected = null; afterAuth();
        });
      };
    });
  }
  function collectProfile(role) {
    if (role === 'eleve') return { tel: val('su-tel'), societe: val('su-societe'), refProposition: val('su-ref'), heuresTotal: val('su-heures'), heuresDetail: val('su-heures-detail'), intitule: val('su-intitule'), langue: val('su-langue'), dateDebut: val('su-date-debut'), dateFin: val('su-date-fin'), lieu: val('su-lieu'), lieuAdresse: val('su-lieu-adresse'), certification: val('su-certif'), certificationText: val('su-certif-text') };
    if (role === 'prof') return { langue: val('su-p-langue'), siret: val('su-siret'), nda: val('su-nda'), adresse: val('su-adresse'), tel: val('su-p-tel'), dateNaissance: val('su-naissance'), nationalite: val('su-nationalite') };
    return {};
  }
  // connexion, connexion rapide démo ET activation par lien e-mail passent tous par ici
  function afterAuth() { TUTO_PENDING = !!(ME && ME.tutoAVoir); api('/api/notifications').then(function (n) { NOTIFS = (n.ok && n.data.notifs) || []; renderHeader(); renderDashboard(); startNotifPoll(); window.scrollTo({ top: 0, behavior: 'smooth' }); }); }
  function demoBoxHTML() {
    if (!DEMO || !DEMO.length) return '';
    return '<div class="demo-box"><div class="demo-box-h">⚡ Connexion rapide — comptes de démonstration</div>' +
      DEMO.map(function (d) { return '<div class="demo-acc"><div class="demo-acc-info"><b>' + esc(ROLES[d.role] || d.role) + '</b><small>' + esc(d.email) + ' · mot de passe : ' + esc(d.password) + '</small></div><button type="button" class="btn-mini demo-login" data-email="' + esc(d.email) + '" data-pwd="' + esc(d.password) + '">Se connecter →</button></div>'; }).join('') +
      '</div>';
  }
  function loginForm() {
    return '<form class="form auth-form" id="login-form" style="max-width:none">' + field('li-email', 'E-mail', 'email') + pwdField('li-pwd', 'Mot de passe') +
      '<p class="auth-err" id="login-err"></p><button class="btn btn-primary" type="submit" style="justify-self:center">Se connecter →</button></form>' + demoBoxHTML();
  }
  // corps du formulaire de création de compte (utilisé par la modale admin « Créer un compte »)
  function accountFieldsHTML() {
    return '<div class="form auth-form" id="signup-form" style="max-width:none"><div class="row2">' + field('su-prenom', 'Prénom', 'text') + field('su-nom', 'Nom', 'text') + '</div>' + field('su-email', 'E-mail', 'email') +
      '<p class="chan-note" style="margin:2px 0 14px">Un e-mail est envoyé à cette adresse avec un lien personnel pour que la personne <b>choisisse elle-même son mot de passe</b>. Vous n\'avez pas de mot de passe à définir ni à transmettre.</p>' +
      '<div class="field"><label for="su-role">Type de compte</label><select id="su-role" name="role"><option value="eleve">Apprenant</option><option value="prof">Formateur</option></select></div>' +
      '<div id="su-eleve-fields" class="su-profile"><h4 class="su-fiche-h">Fiche apprenant</h4>' +
        '<div class="row2">' + ofield('su-tel', 'Téléphone', 'tel') + ofield('su-societe', 'Société', 'text') + '</div>' +
        '<div class="row2">' + ofield('su-ref', 'Réf. proposition', 'text') + '<span></span></div>' +
        '<div class="row2">' + ofield('su-langue', 'Langue', 'text') + ofield('su-intitule', 'Intitulé de la formation', 'text') + '</div>' +
        '<div class="row2">' + ofield('su-date-debut', 'Date de début', 'text') + ofield('su-date-fin', 'Date de fin', 'text') + '</div>' +
        '<div class="row2">' + ofield('su-heures', "Nombre d'heures total", 'text') + '<span></span></div>' +
        oarea('su-heures-detail', 'Détail des heures de formation') +
        '<div class="field"><label for="su-lieu">Lieu de la formation</label><select id="su-lieu"><option value="distanciel">Distanciel</option><option value="presentiel">Présentiel</option><option value="mixte">Les deux (présentiel et distanciel)</option></select></div>' +
        '<div id="su-lieu-wrap" style="display:none">' + ofield('su-lieu-adresse', 'Adresse (présentiel)', 'text') + '</div>' +
        '<div class="field"><label for="su-certif">Certification</label><select id="su-certif"><option value="non">Sans certification</option><option value="oui">Avec certification</option></select></div>' +
        '<div id="su-certif-wrap" style="display:none">' + oarea('su-certif-text', 'Détail de la certification') + '</div>' +
      '</div>' +
      '<div id="su-prof-fields" class="su-profile" style="display:none"><h4 class="su-fiche-h">Fiche formateur</h4>' +
        '<div class="row2">' + ofield('su-p-langue', 'Langue', 'text') + ofield('su-p-tel', 'Téléphone', 'tel') + '</div>' +
        '<div class="row2">' + ofield('su-siret', 'Numéro de SIRET', 'text') + ofield('su-nda', 'Numéro NDA', 'text') + '</div>' +
        ofield('su-adresse', 'Adresse physique', 'text') +
        '<div class="row2">' + ofield('su-naissance', 'Date de naissance', 'text') + ofield('su-nationalite', 'Nationalité', 'text') + '</div>' +
      '</div>' +
      '<p class="auth-err" id="signup-err"></p></div>';
  }
  function ofield(id, label, type) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + (type || 'text') + '" /></div>'; }
  function oarea(id, label) { return '<div class="field"><label for="' + id + '">' + label + '</label><textarea id="' + id + '" rows="2"></textarea></div>'; }
  function field(id, label, type) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + type + '" required /></div>'; }
  function pwdField(id, label) { return '<div class="field"><label for="' + id + '">' + label + '</label><div class="pwd-wrap"><input id="' + id + '" type="password" required /><button type="button" class="pwd-eye" data-target="' + id + '" aria-label="Afficher le mot de passe">' + EYE + '</button></div></div>'; }
  function wireEyes(el) {
    el.querySelectorAll('.pwd-eye').forEach(function (b) {
      b.onclick = function () { var inp = document.getElementById(b.getAttribute('data-target')); if (!inp) return; var show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; b.innerHTML = show ? EYE_OFF : EYE; };
    });
  }

  // ---- briques communes ---------------------------------------------------
  function topHTML() {
    // ⚠️ les deux boutons sont groupés dans .ds-top-acts : .ds-top est en justify-content:space-between,
    // un second bouton posé directement dedans flotterait au milieu du bandeau sur ordinateur et
    // ferait déborder l'en-tête à 375 px (précédent .adm-grp-acts).
    return '<div class="ds-top"><div class="ds-id"><span class="ds-hi">Bonjour ' + esc(ME.prenom) + ' ' + esc(ME.nom) + '</span>' +
      '<span class="role-chip role-' + ME.role + '">' + ROLES[ME.role] + '</span></div><div class="ds-top-acts">' +
      (ME.role === 'admin' ? '' : '<button type="button" class="btn btn-ghost tuto-replay">Revoir la visite guidée</button>') +
      '<button class="btn btn-ghost ds-logout">Se déconnecter</button></div></div>';
  }
  function notifCardHTML(unread) {
    // ds-card-notifs : ancre stable de la visite guidée (une ancre positionnelle du type
    // « .ds-side > .ds-card:first-child » se déplacerait en silence si une carte était ajoutée).
    return '<div class="ds-card ds-card-notifs"><div class="ds-card-h"><h3>Notifications' + (unread ? ' <span class="mini-badge">' + unread + '</span>' : '') + '</h3>' +
      (NOTIFS.length ? '<button class="link-btn ds-seeall">Voir tout</button>' : '') + '</div>' +
      '<p class="ds-empty" style="margin:0">' + (NOTIFS.length ? (unread ? unread + (unread > 1 ? ' notifications non lues' : ' notification non lue') : 'Tout est lu.') : 'Aucune notification pour le moment.') + '</p></div>';
  }
  // ---- membres d'un dossier (autant de formateurs et d'apprenants que voulu) ----
  function gProfs(g) { return (g && g.profs) || []; }
  function nameList(list) { return list.map(fullName).join(', '); }
  // énumération à la française : « A », « A et B », « A, B et C »
  function frList(noms) { return noms.length < 2 ? (noms[0] || '') : noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1]; }
  function groupTitle(g) {
    var P = gProfs(g), e = g && g.eleve;
    // chacun voit d'abord « les autres » : l'apprenant voit ses formateurs, le formateur son apprenant
    if (ME.role === 'eleve') return nameList(P) || 'Dossier';
    var t = e ? fullName(e) : 'Dossier';
    return ME.role === 'admin' ? (t + ' · ' + (nameList(P) || '—')) : t;
  }
  function membersChips(g) {
    // la bulle mise en couleur est celle du COMPTE CONNECTÉ (avant, c'était toujours
    // celle de l'administration, quel que soit l'utilisateur). Elle porte la classe de rôle
    // pour prendre EXACTEMENT la couleur de la bulle du bandeau « Bonjour … » (cf. site.css :
    // .role-chip et .mchip-me partagent la même palette --chip-*).
    var moi = ' mchip-me role-' + ME.role;
    function chips(list, role) {
      return list.map(function (u) {
        return '<span class="mchip' + (u.id === ME.id ? moi : '') + '">' + esc(fullName(u)) + ' · ' + role + '</span>';
      }).join('');
    }
    return '<div class="grp-members">' + chips(g && g.eleve ? [g.eleve] : [], 'Apprenant') + chips(gProfs(g), 'Formateur') +
      '<span class="mchip' + (ME.role === 'admin' ? moi : '') + '">Administration L&amp;S</span></div>';
  }
  function qsMsgHTML(m) {
    var q = m.qs || {}, mine = (ME.role === 'admin') ? m.fromAdmin : (!m.fromAdmin && m.from === ME.id);
    var actions;
    // pièce déposée en PDF, et la même en Word régénérée à la demande (la version ne bouge pas)
    if (q.status === 'done' && q.docId) actions = '<div class="req-acts"><a class="btn-mini" href="/api/documents/' + q.docId + '/download?token=' + encodeURIComponent(token()) + '">Télécharger le questionnaire rempli</a>' +
      '<a class="btn-mini ghost" href="/api/qs/' + q.id + '/word?token=' + encodeURIComponent(token()) + '">Version Word</a></div>';
    else if (ME.role === 'eleve') actions = '<button class="btn-mini qs-fill-btn" data-qs="' + q.id + '">Remplir le questionnaire →</button>';
    else actions = '<span class="qs-wait">En attente de la réponse de l\'apprenant…</span><div class="req-acts"><button class="btn-mini ghost qs-edit-btn" data-qs="' + q.id + '" data-type="' + esc(q.type || '') + '">Modifier</button><button class="btn-mini ghost qs-cancel-btn" data-qs="' + q.id + '">Annuler</button></div>';
    return '<div class="msg ' + (mine ? 'me' : 'them') + '">' + (mine ? '' : '<span class="msg-from">' + esc(m.fromName) + '</span>') +
      '<div class="qs-card-msg"><span class="qs-ic">📋</span><div class="qs-card-body"><b>' + esc(q.title || 'Questionnaire') + '</b>' +
      '<div class="qs-status' + (q.status === 'done' ? ' done' : '') + '">' + (q.status === 'done' ? 'Rempli ✓' : 'À remplir') + '</div>' + actions + '</div></div><time>' + fmtTime(m.date) + '</time></div>';
  }
  function presenceMsgHTML(m) {
    var p = m.presence || {}, mine = (ME.role === 'admin') ? m.fromAdmin : (!m.fromAdmin && m.from === ME.id);
    var actions;
    if (p.status === 'done' && p.docId) actions = '<div class="req-acts"><a class="btn-mini" href="/api/documents/' + p.docId + '/download?token=' + encodeURIComponent(token()) + '">Télécharger la feuille signée</a>' +
      '<a class="btn-mini ghost" href="/api/presence/' + p.id + '/word?token=' + encodeURIComponent(token()) + '">Version Word</a></div>';
    else if (ME.role === 'eleve') actions = '<button class="btn-mini pr-sign-btn" data-pr="' + p.id + '">Signer →</button>';
    else actions = '<span class="qs-wait">En attente de la signature de l\'apprenant…</span><div class="req-acts"><button class="btn-mini ghost pr-edit-btn" data-pr="' + p.id + '">Modifier</button><button class="btn-mini ghost pr-cancel-btn" data-pr="' + p.id + '">Annuler</button></div>';
    return '<div class="msg ' + (mine ? 'me' : 'them') + '">' + (mine ? '' : '<span class="msg-from">' + esc(m.fromName) + '</span>') +
      '<div class="qs-card-msg"><span class="qs-ic">🖊️</span><div class="qs-card-body"><b>' + esc(p.title || 'Feuille de présence') + '</b>' +
      '<div class="qs-status' + (p.status === 'done' ? ' done' : '') + '">' + (p.status === 'done' ? 'Signée ✓' : 'À signer') + '</div>' + actions + '</div></div><time>' + fmtTime(m.date) + '</time></div>';
  }
  // l'envoyeur (formateur/admin) annule une demande en attente (QS ou présence)
  function cancelRequest(kind, id) {
    confirmDialog({
      title: kind === 'presence' ? 'Annuler la demande de signature ?' : 'Annuler le questionnaire ?',
      message: "La demande sera retirée du dossier et l'apprenant ne pourra plus y répondre. Vous pourrez en renvoyer une nouvelle.",
      confirm: 'Annuler la demande', cancel: 'Revenir',
      onConfirm: function () {
        var url = (kind === 'presence' ? '/api/presence/' : '/api/qs/') + encodeURIComponent(id) + '/cancel';
        apiJSON(url, 'POST', {}).then(function (r) { if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; } renderDashboard(); });
      }
    });
  }
  // Modifier une demande en attente.
  // ⚠️ Pour la feuille de présence, on NE SUPPRIME PLUS rien : on relit la feuille envoyée et
  // on rouvre la modale PRÉREMPLIE (type, en-tête saisi, séances, signature du formateur).
  // L'envoi met alors la demande à jour sur place — l'apprenant n'est ni « annulé » ni
  // re-sollicité par un second e-mail, et fermer la modale ne détruit plus le travail.
  function editRequest(kind, id, type) {
    if (kind === 'presence') {
      api('/api/presence/' + encodeURIComponent(id)).then(function (r) {
        if (!r.ok) { alertDialog((r.data && r.data.error) || 'Feuille introuvable.'); return; }
        var p = r.data.presence || {};
        if (p.status === 'done') { alertDialog('Cette feuille est déjà signée : elle ne peut plus être modifiée.'); return; }
        openPresenceModal({ id: p.id, type: p.type, fields: p.fields || {}, formateurSig: p.formateurSig || null });
      });
      return;
    }
    // questionnaire : comportement inchangé (annulation puis nouveau formulaire)
    apiJSON('/api/qs/' + encodeURIComponent(id) + '/cancel', 'POST', {}).then(function (r) {
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; }
      renderDashboard();
      openQsHeaderModal(type);
    });
  }
  function chatHTML(messages) {
    return '<div class="chat"><div class="chat-msgs" id="chat-msgs">' +
      ((messages && messages.length) ? messages.map(function (m) {
        if (m.kind === 'qs') return qsMsgHTML(m);
        if (m.kind === 'presence') return presenceMsgHTML(m);
        var mine = (ME.role === 'admin') ? m.fromAdmin : (!m.fromAdmin && m.from === ME.id);
        return '<div class="msg ' + (mine ? 'me' : 'them') + '">' + (mine ? '' : '<span class="msg-from">' + esc(m.fromName) + '</span>') + '<span class="bubble">' + esc(m.text) + '</span><time>' + fmtTime(m.date) + '</time></div>';
      }).join('') : '<p class="ds-empty" style="text-align:center;padding:24px 0">Aucun message. Démarrez la conversation.</p>') +
      '</div><form class="chat-form" id="chat-form"><input id="chat-input" placeholder="Écrire un message…" autocomplete="off" required /><button class="btn-mini" type="submit">Envoyer</button></form></div>';
  }
  function docsBlock(docs) {
    return '<label class="upload-zone"><input type="file" id="doc-input" multiple hidden /><span class="uz-ic">⬆</span>' +
      '<span><b>Envoyer un document</b><br><small>Cliquez ou déposez un fichier (max 25 Mo) — il ira dans le canal sélectionné</small></span></label>' +
      ((docs && docs.length) ? '<ul class="docs">' + docs.map(function (d) {
        var mine = (ME.role === 'admin') ? d.fromAdmin : (!d.fromAdmin && d.from === ME.id);
        return '<li><span class="doc-ic">📄</span><span class="doc-meta"><b>' + esc(d.name) + '</b><small>' + fmtSize(d.size) + ' · ' + (mine ? 'envoyé par vous' : 'de ' + esc(d.fromName)) + ' · ' + fmtDate(d.date) + '</small></span>' +
          '<a class="btn-mini" href="/api/documents/' + d.id + '/download?token=' + encodeURIComponent(token()) + '">Télécharger</a>' +
          // l'expéditeur (formateur) et l'administration peuvent retirer un document envoyé
          ((mine && ME.role !== 'eleve') || ME.role === 'admin'
            ? '<button class="adm-del doc-del" type="button" data-id="' + d.id + '" data-name="' + esc(d.name) + '" title="Supprimer ce document">🗑</button>' : '') +
          '</li>';
      }).join('') + '</ul>' : '<p class="ds-empty" style="margin:14px 0">Aucun document dans ce canal.</p>');
  }
  function groupView(g, messages, docs) {
    if (!g) return '<div class="ds-card space-empty"><div class="se-ic">📁</div><h3>Vos dossiers</h3><p class="ds-empty">Sélectionnez un dossier à gauche pour voir les documents et discuter.</p></div>';
    var canPrive = (ME.role === 'prof' || ME.role === 'admin');
    // l'administration modifie la composition SANS quitter le dossier (le même bouton existe
    // aussi sur chaque dossier de la vue globale, en bas de page)
    var acts = (ME.role === 'admin' ? '<button class="btn-mini ghost grp-edit-btn" type="button" title="Ajouter ou retirer des formateurs de ce dossier">👥 Formateurs</button>' : '') +
      (ME.role !== 'eleve' ? '<button class="btn-mini gen-btn">📄 Générer un document</button>' : '');
    return '<div class="ds-card"><div class="ds-card-h"><h3>Dossier — ' + esc(groupTitle(g)) + '</h3>' +
      (acts ? '<div class="ds-card-acts">' + acts + '</div>' : '') + '</div>' + membersChips(g) +
      '<div class="chan-tabs"><button class="chan-tab' + (channel === 'commun' ? ' on' : '') + '" data-ch="commun">💬 Discussion commune</button>' +
      (canPrive ? '<button class="chan-tab' + (channel === 'prive' ? ' on' : '') + '" data-ch="prive">🔒 Privé · formateur + admin</button>' : '') + '</div>' +
      (channel === 'prive' ? '<p class="chan-note">Canal privé : l\'apprenant n\'a pas accès à ce canal.</p>' : '') +
      docsBlock(docs) + '<h4 class="ds-sub">Messagerie</h4>' + chatHTML(messages) + '</div>';
  }
  // Les dossiers sont constitués par l'administration UNIQUEMENT (30/07/2026) : ni l'apprenant
  // ni le formateur n'ajoute qui que ce soit, il n'y a donc plus de bouton loupe ici.
  function dossiersCardHTML(groups) {
    return '<div class="ds-card ds-card-dossiers"><h3>Mes dossiers</h3>' +
      (groups.length ? '<ul class="contact-list">' + groups.map(function (g) {
        // Le nombre de formateurs est désormais variable : chaque mot est dans son propre nœud
        // texte pour rester une clé de traduction stable malgré le nombre qui change.
        var np = gProfs(g).length;
        var sub = '<span>Apprenant</span> · ' + np + ' <span>' + (np > 1 ? 'formateurs' : 'formateur') + '</span> · <span>Admin</span>';
        var nb = NOTIFS.filter(function (n) { return !n.read && n.group === g.id; }).length;
        return '<li class="contact' + (selected === g.id ? ' on' : '') + (nb ? ' has-new' : '') + '" data-id="' + g.id + '"><span class="avatar">' + esc(initials(groupTitle(g))) + '</span><span class="c-name">' + esc(groupTitle(g)) + '<small>' + sub + '</small></span>' + (nb ? '<span class="contact-badge">' + (nb > 9 ? '9+' : nb) + '</span>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="ds-empty">Aucun dossier pour l\'instant.</p>') + '</div>';
  }

  // ---- routeur + rendu ----------------------------------------------------
  function renderDashboard() { var el = app(); if (!el) return; if (ME.role === 'admin') renderAdminDash(el); else renderUserDash(el); }

  function loadGroupContent(selG, cb) {
    if (channel === 'prive' && ME.role === 'eleve') channel = 'commun';
    var loadM = selG ? api('/api/messages?group=' + encodeURIComponent(selected) + '&channel=' + channel).then(function (r) { return r.data.messages || []; }) : Promise.resolve(null);
    var loadD = selG ? api('/api/documents?group=' + encodeURIComponent(selected) + '&channel=' + channel).then(function (r) { return r.data.docs || []; }) : Promise.resolve(null);
    Promise.all([loadM, loadD]).then(function (a) { cb(a[0], a[1]); });
  }
  function renderUserDash(el) {
    // plus besoin de /api/users : un formateur ne cherche plus d'apprenant à ajouter
    Promise.all([api('/api/groups'), api('/api/notifications')]).then(function (res) {
      var groups = res[0].data.groups || [];
      NOTIFS = res[1].data.notifs || [];
      var selG = selected ? groups.filter(function (g) { return g.id === selected; })[0] : null;
      if (selected && !selG) selected = null;
      loadGroupContent(selG, function (m, d) { paintBoard(el, groups, selG, m, d, null); });
    });
  }
  function renderAdminDash(el) {
    Promise.all([api('/api/groups'), api('/api/notifications'), api('/api/admin/overview')]).then(function (res) {
      var groups = res[0].data.groups || [];
      NOTIFS = res[1].data.notifs || [];
      var overview = res[2].ok ? res[2].data : null;
      ADMIN_OVERVIEW = overview;
      var selG = selected ? groups.filter(function (g) { return g.id === selected; })[0] : null;
      if (selected && !selG) selected = null;
      loadGroupContent(selG, function (m, d) { paintBoard(el, groups, selG, m, d, overview); });
    });
  }
  function paintBoard(el, groups, selG, messages, docs, overview) {
    var changed = !CUR_GROUP || !selG || CUR_GROUP.id !== selG.id;
    CUR_GROUP = selG;
    if (changed) GEN_PROF = null;
    resetGenTargets();
    var unread = NOTIFS.filter(function (n) { return !n.read; }).length;
    el.innerHTML = topHTML() + '<div class="ds-grid"><aside class="ds-side">' + notifCardHTML(unread) + dossiersCardHTML(groups) +
      '</aside><main class="ds-main">' + groupView(selG, messages, docs) + '</main></div>' + (overview ? adminPanel(overview) : '');
    el.querySelector('.ds-logout').onclick = function () { logout(); };
    // le bouton est détruit et recréé à chaque rendu, et n'existe pas pour un admin
    var tb = el.querySelector('.tuto-replay'); if (tb) tb.onclick = function () { ouvrirTuto(); };
    var sa = el.querySelector('.ds-seeall'); if (sa) sa.onclick = openNotifModal;
    el.querySelectorAll('.contact').forEach(function (li) {
      li.onclick = function () {
        selected = li.getAttribute('data-id'); channel = 'commun';
        // ouvrir le dossier « consomme » ses notifications (badge + cloche)
        if (NOTIFS.some(function (n) { return n.group === selected; })) {
          apiJSON('/api/notifications/clear-group', 'POST', { group: selected }).then(function () { renderDashboard(); });
        } else renderDashboard();
      };
    });
    el.querySelectorAll('.doc-del').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id'), nom = b.getAttribute('data-name');
        confirmDialog({
          title: 'Supprimer ce document ?',
          message: '« ' + nom + ' » sera définitivement retiré du dossier, pour tous les membres. Cette action est irréversible.',
          confirm: 'Supprimer', cancel: 'Annuler',
          onConfirm: function () {
            api('/api/documents/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) {
              if (!r.ok) { alertDialog((r.data && r.data.error) || 'Suppression impossible.'); return; }
              renderDashboard();
            });
          }
        });
      };
    });
    el.querySelectorAll('.chan-tab').forEach(function (t) { t.onclick = function () { channel = t.getAttribute('data-ch'); renderDashboard(); }; });
    var gb = el.querySelector('.gen-btn'); if (gb) gb.onclick = openTemplatePicker;
    var geb = el.querySelector('.grp-edit-btn'); if (geb && selG) geb.onclick = function () { openEditGroup(selG); };
    if (selG) { wireChat(); wireUpload(); }
    if (overview) wireAdmin();
    renderHeader();
    // Première connexion : c'est ICI qu'on lance la visite, et nulle part ailleurs — c'est le seul
    // instant où le tableau de bord existe vraiment (renderUserDash enchaîne 4 requêtes avant de peindre).
    if (TUTO_PENDING && ME && ME.role !== 'admin' && !document.querySelector('.notif-modal.open')) {
      TUTO_PENDING = false;
      ouvrirTuto();
    }
    // une étape de la visite attendait cette peinture pour mesurer son ancre
    if (TUTO_ATTENTE) { var f = TUTO_ATTENTE; TUTO_ATTENTE = null; f(); }
  }

  // ---- générateur de documents (Interactive Worksheet) -------------------
  function gi(id, label, v) { return '<label class="gf">' + label + '<input id="' + id + '" value="' + esc(v || '') + '" /></label>'; }
  function ga(id, label, v, rows) { return '<label class="gf gf-full">' + label + '<textarea id="' + id + '" rows="' + (rows || 2) + '">' + esc(v || '') + '</textarea></label>'; }
  function showGenModal() { ensureGenModal(); renderGen(); document.getElementById('gen-modal').classList.add('open'); document.body.style.overflow = 'hidden'; }
  function openGenModal(preset) {
    if (!selected) return;
    if (preset) { genState = { header: preset.header || {}, sessions: Array.isArray(preset.sessions) ? preset.sessions.slice() : [] }; showGenModal(); return; }
    api('/api/worksheet?group=' + encodeURIComponent(selected)).then(function (r) {
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Accès refusé.'); return; }
      var w = r.data.worksheet || {};
      genState = { header: w.header || {}, sessions: Array.isArray(w.sessions) ? w.sessions.slice() : [] };
      showGenModal();
    });
  }
  function ensureGenModal() {
    if (document.getElementById('gen-modal')) return;
    var m = document.createElement('div'); m.id = 'gen-modal'; m.className = 'notif-modal';
    m.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card gen-card gen-full">' +
      '<div class="nm-head"><h3>Générer — Interactive Worksheet</h3><button class="nm-close" id="gen-close" aria-label="Fermer">&times;</button></div>' +
      '<div class="nm-body" id="gen-body"></div>' +
      '<div class="gen-foot">' +
        '<label class="gen-chan">Format <select id="gen-format"><option value="pdf">PDF</option><option value="word">Word (.docx)</option></select></label>' +
        '<button class="btn btn-primary gen-generate" style="padding:11px 22px">Générer le document →</button></div></div>';
    document.body.appendChild(m);
    m.querySelector('#gen-close').onclick = closeGenModal;
    m.querySelector('.nm-backdrop').onclick = closeGenModal;
    m.querySelector('.gen-generate').onclick = function () {
      syncGen();
      var btn = m.querySelector('.gen-generate'); btn.disabled = true; btn.textContent = 'Génération…';
      saveGen(function () {
        var fmt = document.getElementById('gen-format').value;
        fetch('/api/worksheet/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify({ group: selected, format: fmt }) })
          .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || 'Erreur'); }); return r.blob(); })
          .then(function (blob) {
            var ext = fmt === 'word' ? 'docx' : 'pdf';
            var nm = '1 - Interactive Worksheet - ' + ((genState.header && genState.header.nomApprenant) || 'apprenant') + ' - ' + new Date().toLocaleDateString('fr-FR') + '.' + ext;
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = nm; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
            btn.disabled = false; btn.textContent = 'Document généré ✓ — re-générer';
            setTimeout(function () { btn.textContent = 'Générer le document →'; }, 3000);
          })
          .catch(function (e) { btn.disabled = false; btn.textContent = 'Générer le document →'; alertDialog(e.message || 'Génération impossible.'); });
      });
    };
  }
  function closeGenModal() { var m = document.getElementById('gen-modal'); if (m) { m.classList.remove('open'); document.body.style.overflow = ''; } }
  function renderGen() {
    var h = genState.header || {}, n = h.notes || {};
    var editing = genState.editIdx != null, es = editing ? (genState.sessions[genState.editIdx] || {}) : {};
    var list = genState.sessions.length ? genState.sessions.map(function (s, i) {
      return '<div class="gen-sess' + (editing && genState.editIdx === i ? ' editing' : '') + '"><b>Séance ' + (i + 1) + '</b> · ' + esc(s.dateDuree || '(date ?)') +
        '<button class="gen-edit" data-i="' + i + '" title="Modifier">✎</button><button class="gen-del" data-i="' + i + '" title="Supprimer">&times;</button>' +
        '<div class="gen-sess-sum">' + esc((s.objectifs || '').slice(0, 90)) + '</div></div>';
    }).join('') : '<p class="ds-empty">Aucune séance ajoutée.</p>';
    document.getElementById('gen-body').innerHTML =
      '<h4 class="gen-h">Formation</h4><div class="gf-grid">' +
      gi('g-intitule', 'Intitulé de la formation', h.intitule) + '<span></span>' +
      gi('g-langue', 'Langue', h.langue) + gi('g-societe', 'Société', h.societe) +
      gi('g-nomA', 'Nom de l\'apprenant', h.nomApprenant) + gi('g-nomF', 'Nom du formateur', h.nomFormateur) +
      gi('g-telA', 'Tél apprenant', h.telApprenant) + gi('g-telF', 'Tél formateur', h.telFormateur) +
      gi('g-mailA', 'Mail apprenant', h.mailApprenant) + gi('g-mailF', 'Mail formateur', h.mailFormateur) + '</div>' +
      '<h4 class="gen-h">Objectifs et organisation — notes du formateur</h4><div class="gf-grid">' +
      ga('g-nVoc', 'Vocabulaire', n.vocabulaire) + ga('g-nStr', 'Structure', n.structure) +
      ga('g-nCom', 'Communication', n.communication) + ga('g-nAut', 'Autre', n.autre) + '</div>' +
      '<h4 class="gen-h">Séances (' + genState.sessions.length + ')</h4><div id="gen-sessions">' + list + '</div>' +
      '<details class="gen-add"' + (editing ? ' open' : '') + '><summary>' + (editing ? '✎ Modifier la séance ' + (genState.editIdx + 1) : '+ Ajouter une séance (après un cours)') + '</summary><div class="gf-grid">' +
      gi('s-date', 'Date et durée du cours', es.dateDuree || '') + gi('s-form', 'Formateur', es.formateur != null ? es.formateur : h.nomFormateur) +
      ga('s-obj', 'Objectifs de la séance', es.objectifs || '') + ga('s-mots', 'Liste des mots', es.mots || '') +
      ga('s-gram', 'Structure et grammaire', es.grammaire || '') + ga('s-pron', 'Pronunciation', es.pronunciation || '') +
      ga('s-err', 'Erreurs à éviter', es.erreurs || '') + ga('s-next', 'Pour la prochaine fois', es.prochaine || '') + '</div>' +
      '<button class="btn-mini gen-add-btn" type="button">' + (editing ? 'Mettre à jour la séance' : 'Ajouter cette séance') + '</button>' +
      (editing ? ' <button class="link-btn gen-cancel" type="button">Annuler</button>' : '') + '</details>';
    document.querySelector('.gen-add-btn').onclick = function () {
      syncGen();
      var s = { dateDuree: val('s-date'), formateur: val('s-form'), objectifs: val('s-obj'), mots: val('s-mots'), grammaire: val('s-gram'), pronunciation: val('s-pron'), erreurs: val('s-err'), prochaine: val('s-next') };
      if (genState.editIdx != null) { genState.sessions[genState.editIdx] = s; genState.editIdx = null; }
      else genState.sessions.push(s);
      renderGen();
    };
    var cancelBtn = document.querySelector('.gen-cancel'); if (cancelBtn) cancelBtn.onclick = function () { syncGen(); genState.editIdx = null; renderGen(); };
    document.querySelectorAll('.gen-edit').forEach(function (b) { b.onclick = function () { syncGen(); genState.editIdx = parseInt(b.getAttribute('data-i'), 10); renderGen(); var d = document.querySelector('.gen-add'); if (d) d.scrollIntoView({ block: 'nearest' }); }; });
    document.querySelectorAll('.gen-del').forEach(function (b) { b.onclick = function () { syncGen(); var i = parseInt(b.getAttribute('data-i'), 10); genState.sessions.splice(i, 1); if (genState.editIdx != null) { if (genState.editIdx === i) genState.editIdx = null; else if (genState.editIdx > i) genState.editIdx--; } renderGen(); }; });
  }
  function syncGen() {
    genState.header = {
      intitule: val('g-intitule'), langue: val('g-langue'), societe: val('g-societe'),
      nomApprenant: val('g-nomA'), nomFormateur: val('g-nomF'),
      telApprenant: val('g-telA'), telFormateur: val('g-telF'),
      mailApprenant: val('g-mailA'), mailFormateur: val('g-mailF'),
      notes: { vocabulaire: val('g-nVoc'), structure: val('g-nStr'), communication: val('g-nCom'), autre: val('g-nAut') }
    };
  }
  function saveGen(cb) { apiJSON('/api/worksheet', 'POST', { group: selected, header: genState.header, sessions: genState.sessions }).then(function (r) { if (!r.ok) { alertDialog((r.data && r.data.error) || 'Enregistrement impossible.'); return; } if (cb) cb(); }); }

  // ---- choix du modèle de document --------------------------------------
  function openTemplatePicker() {
    if (!selected) return;
    ensureTplModal();
    renderTplPane('new');
    document.getElementById('tpl-modal').classList.add('open'); document.body.style.overflow = 'hidden';
  }
  // Quand le dossier compte plusieurs apprenants (ou plusieurs formateurs), on demande UNE FOIS
  // pour qui le document est établi : tous les générateurs se préremplissent ensuite depuis ce choix.
  // Avec une seule personne de chaque côté, rien ne s'affiche — l'écran est identique à avant.
  function genTargetsHTML() {
    var P = gProfs(CUR_GROUP), out = '';
    function sel(id, label, list, cur, vide) {
      return '<label class="gf">' + label + '<select id="' + id + '">' +
        (vide ? '<option value=""' + (cur ? '' : ' selected') + '>' + esc(vide) + '</option>' : '') +
        list.map(function (u) {
          return '<option value="' + esc(u.id) + '"' + (u.id === cur ? ' selected' : '') + '>' + esc(fullName(u)) + '</option>';
        }).join('') + '</select></label>';
    }
    if (P.length > 1) out += sel('gt-prof', 'Formateur concerné', P, (curProf() || {}).id, '');
    if (!out) return '';
    return '<div class="gen-targets"><div class="gf-grid">' + out + '</div>' +
      '<p class="chan-note" style="margin:8px 0 14px">Ce dossier compte plusieurs formateurs : le document sera établi au nom de celui choisi ici.</p></div>';
  }
  function wireGenTargets(root) {
    var p = root.querySelector('#gt-prof');
    if (p) p.onchange = function () { GEN_PROF = p.value || null; };
  }
  function ensureTplModal() {
    if (document.getElementById('tpl-modal')) return;
    var m = document.createElement('div'); m.id = 'tpl-modal'; m.className = 'notif-modal';
    m.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card"><div class="nm-head"><h3>Générer un document</h3><button class="nm-close" id="tpl-close" aria-label="Fermer">&times;</button></div>' +
      '<div class="tpl-tabs"><button class="tpl-tab on" data-pane="new">Générer un nouveau document</button><button class="tpl-tab" data-pane="hist">Historique des documents</button></div>' +
      '<div class="nm-body" id="tpl-body"></div></div>';
    document.body.appendChild(m);
    m.querySelector('#tpl-close').onclick = closeTplModal;
    m.querySelector('.nm-backdrop').onclick = closeTplModal;
    m.querySelectorAll('.tpl-tab').forEach(function (t) { t.onclick = function () { renderTplPane(t.getAttribute('data-pane')); }; });
  }
  function renderTplPane(pane) {
    var m = document.getElementById('tpl-modal'); if (!m) return;
    m.querySelectorAll('.tpl-tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-pane') === pane); });
    var body = document.getElementById('tpl-body');
    if (pane === 'new') {
      body.innerHTML = genTargetsHTML() + '<p class="ds-empty" style="margin:0 0 12px">Choisissez le document à générer :</p><ul class="tpl-list">' +
        '<li class="tpl-item" data-tpl="interactive"><span class="tpl-ic">📄</span><span class="c-name">1 - Interactive Worksheet<small>Résumé de cours à télécharger / partager à l\'apprenant</small></span><span class="tpl-go">→</span></li>' +
        '<li class="tpl-item" data-tpl="qs_mid"><span class="tpl-ic">📋</span><span class="c-name">2 - QS mi-parcours<small>Questionnaire de satisfaction (rempli par l\'apprenant)</small></span><span class="tpl-go">→</span></li>' +
        '<li class="tpl-item" data-tpl="qs_end"><span class="tpl-ic">📋</span><span class="c-name">3 - QS fin de formation<small>Questionnaire de fin de formation (rempli par l\'apprenant)</small></span><span class="tpl-go">→</span></li>' +
        '<li class="tpl-item" data-tpl="attestation"><span class="tpl-ic">📜</span><span class="c-name">4 - Attestation de fin de formation<small>Début prérempli depuis les fiches ; à compléter et faire signer</small></span><span class="tpl-go">→</span></li>' +
        '<li class="tpl-item" data-tpl="test_mid"><span class="tpl-ic">📝</span><span class="c-name">5 - Test mi-parcours<small>Résultat &amp; appréciation (rempli par le formateur)</small></span><span class="tpl-go">→</span></li>' +
        '<li class="tpl-item" data-tpl="test_end"><span class="tpl-ic">📝</span><span class="c-name">6 - Test fin de formation<small>Résultat &amp; appréciation (rempli par le formateur)</small></span><span class="tpl-go">→</span></li>' +
        (ME.role === 'admin' ? '<li class="tpl-item" data-tpl="contrat"><span class="tpl-ic">📑</span><span class="c-name">7 - Contrat de sous-traitance<small>Réservé à l\'administration · intro &amp; article 1 préremplis</small></span><span class="tpl-go">→</span></li>' : '') +
        '<li class="tpl-item" data-tpl="qs_formateur"><span class="tpl-ic">🗒️</span><span class="c-name">' + (ME.role === 'admin' ? '8' : '7') + ' - QS Formateur<small>Bilan rempli par le formateur (à transmettre à l\'administration)</small></span><span class="tpl-go">→</span></li>' +
        '<li class="tpl-item" data-tpl="leveltest"><span class="tpl-ic">📊</span><span class="c-name">' + (ME.role === 'admin' ? '9' : '8') + ' - Level Test<small>Évaluation orale / questionnaire d\'objectifs (rempli par le formateur)</small></span><span class="tpl-go">→</span></li>' +
        '<li class="tpl-item" data-tpl="presence"><span class="tpl-ic">🗓️</span><span class="c-name">' + (ME.role === 'admin' ? '10' : '9') + ' - Feuille de présence<small>E-learning, présentiel/distanciel ou test (au choix)</small></span><span class="tpl-go">→</span></li>' + '</ul>';
      wireGenTargets(body);
      body.querySelectorAll('.tpl-item').forEach(function (li) { li.onclick = function () { var t = li.getAttribute('data-tpl'); closeTplModal(); if (t === 'interactive') openGenModal(); else if (t === 'qs_mid' || t === 'qs_end') openQsHeaderModal(t); else if (t === 'test_mid' || t === 'test_end') openTestDocModal(t); else if (t === 'attestation') openAttestationModal(); else if (t === 'contrat') openContratModal(); else if (t === 'leveltest') openLevelTestModal(); else if (t === 'presence') openPresenceModal(); else openFormModal(t); }; });
    } else {
      body.innerHTML = '<p class="ds-empty">Chargement…</p>';
      var HIST_IC = { interactive: '📄', test: '📝', attestation: '📜', contrat: '📑', form: '🗒️', leveltest: '📊', presence: '🗓️', qs: '📋' };
      api('/api/worksheet/history?group=' + encodeURIComponent(selected)).then(function (r) {
        var hist = (r.ok && r.data.history) || [];
        body.innerHTML = hist.length ? '<ul class="tpl-list">' + hist.map(function (x, i) {
          var meta = fmtDate(x.date) + ' · ' + (x.format === 'word' ? 'Word' : 'PDF') + (x.kind === 'interactive' && x.sessionCount != null ? ' · ' + x.sessionCount + ' séance(s)' : '') + ' · ' + esc(x.byName);
          var action = x.kind === 'interactive' ? 'Dupliquer →' : 'Ouvrir →';
          return '<li class="tpl-item hist-item" data-i="' + i + '"><span class="tpl-ic">' + (HIST_IC[x.kind] || '🕘') + '</span><span class="c-name">' + esc(x.title) + ' · ' + esc(x.apprenant) + '<small>' + meta + '</small></span><span class="tpl-go">' + action + '</span></li>';
        }).join('') + '</ul>' : '<p class="ds-empty">Aucun document généré pour ce dossier.</p>';
        // rouvrir un document depuis l'historique le régénère : le choix du formateur vaut aussi ici
        var box = document.createElement('div'); box.innerHTML = genTargetsHTML();
        if (box.firstChild) body.insertBefore(box.firstChild, body.firstChild);
        wireGenTargets(body);
        body.querySelectorAll('.hist-item').forEach(function (li) {
          li.onclick = function () { var x = hist[parseInt(li.getAttribute('data-i'), 10)]; closeTplModal(); reopenFromHistory(x); };
        });
      });
    }
  }
  function closeTplModal() { var m = document.getElementById('tpl-modal'); if (m) { m.classList.remove('open'); document.body.style.overflow = ''; } }
  // ré-ouvre le bon générateur depuis l'historique (worksheet = duplique depuis snapshot, autres = nouveau formulaire prérempli)
  function reopenFromHistory(x) {
    var t = x.tpl || x.kind;
    if (x.kind === 'interactive') openGenModal(x.snapshot);
    else if (t === 'qs_mid' || t === 'qs_end') openQsHeaderModal(t);
    else if (t === 'test_mid' || t === 'test_end') openTestDocModal(t);
    else if (t === 'attestation') openAttestationModal();
    else if (t === 'contrat') openContratModal();
    else if (t === 'leveltest') openLevelTestModal();
    else if (t === 'presence') openPresenceModal();
    else openFormModal(t);
  }

  function wireChat() {
    var box = document.getElementById('chat-msgs'); if (box) box.scrollTop = box.scrollHeight;
    document.querySelectorAll('.qs-fill-btn').forEach(function (b) { b.onclick = function () { openQsFillModal(b.getAttribute('data-qs')); }; });
    document.querySelectorAll('.pr-sign-btn').forEach(function (b) { b.onclick = function () { openPresenceSignModal(b.getAttribute('data-pr')); }; });
    document.querySelectorAll('.qs-cancel-btn').forEach(function (b) { b.onclick = function () { cancelRequest('qs', b.getAttribute('data-qs')); }; });
    document.querySelectorAll('.qs-edit-btn').forEach(function (b) { b.onclick = function () { editRequest('qs', b.getAttribute('data-qs'), b.getAttribute('data-type')); }; });
    document.querySelectorAll('.pr-cancel-btn').forEach(function (b) { b.onclick = function () { cancelRequest('presence', b.getAttribute('data-pr')); }; });
    document.querySelectorAll('.pr-edit-btn').forEach(function (b) { b.onclick = function () { editRequest('presence', b.getAttribute('data-pr')); }; });
    var f = document.getElementById('chat-form'); if (!f) return;
    f.onsubmit = function (e) {
      e.preventDefault();
      var inp = document.getElementById('chat-input'); var txt = inp.value.trim(); if (!txt) return; inp.value = ''; inp.disabled = true;
      apiJSON('/api/messages', 'POST', { group: selected, channel: channel, text: txt }).then(function (r) {
        // échec (serveur indisponible, message refusé…) : on REND le texte à l'utilisateur
        // et on réactive le champ, au lieu de perdre son message en silence
        if (!r.ok) {
          inp.disabled = false; inp.value = txt; inp.focus();
          alertDialog((r.data && r.data.error) || 'Message non envoyé. Votre texte a été conservé, réessayez.');
          return;
        }
        renderDashboard();
      });
    };
  }
  function wireUpload() {
    var input = document.getElementById('doc-input'); if (!input) return;
    input.onchange = function () {
      var files = Array.prototype.slice.call(input.files || []); if (!files.length) return; var done = 0;
      // on vide la sélection tout de suite : sans ça, re-choisir LE MÊME fichier après
      // un échec ne déclenche aucun événement et l'utilisateur croit l'espace bloqué
      input.value = '';
      files.forEach(function (file) {
        var fd = new FormData(); fd.append('group', selected); fd.append('channel', channel); fd.append('file', file);
        fetch('/api/documents', { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: fd })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }).catch(function () { return { ok: r.ok, data: {} }; }); })
          .then(function (r) { if (!r.ok) alertDialog((r.data && r.data.error) || ('« ' + file.name + ' » n\'a pas été envoyé. Réessayez.')); })
          // coupure réseau (serveur en cours de mise à jour, wifi perdu) : on le dit
          // clairement et on précise que le fichier peut simplement être renvoyé
          .catch(function () { alertDialog('« ' + file.name + ' » n\'a pas été envoyé : connexion au serveur interrompue. Vous pouvez le renvoyer.'); })
          .then(function () { if (++done === files.length) renderDashboard(); });
      });
    };
  }
  function admDocLi(d) {
    return '<li><span class="doc-ic">📄</span><span class="doc-meta"><b>' + esc(d.name) + '</b><small>' + fmtSize(d.size) + ' · ' + (d.channel === 'prive' ? '🔒 privé' : 'commun') + ' · ' + fmtDate(d.date) + '</small></span>' +
      '<a class="btn-mini" href="/api/documents/' + d.id + '/download?token=' + encodeURIComponent(token()) + '">Télécharger</a></li>';
  }
  function admFileLi(d) {
    return '<li><span class="doc-ic">📄</span><span class="doc-meta"><b>' + esc(d.name) + '</b><small>' + esc(d.groupLabel || '') + ' · ' + fmtSize(d.size) + ' · ' + (d.channel === 'prive' ? '🔒 privé' : 'commun') + ' · ' + fmtDate(d.date) + '</small></span>' +
      '<a class="btn-mini" href="/api/documents/' + d.id + '/download?token=' + encodeURIComponent(token()) + '">Télécharger</a></li>';
  }
  function adminPanel(a) {
    var users = a.users || [], groups = a.groups || [], docs = a.docs || [];
    var q = norm(adminQuery);
    function chip(key, label, count) { return '<button class="adm-chip' + (adminShow[key] ? ' on' : '') + '" type="button" data-k="' + key + '">' + label + ' (' + count + ')</button>'; }
    var bar = '<div class="ds-card-h"><h3>Administration — vue globale</h3></div>' +
      '<div class="adm-bar"><div class="adm-toggle">' + chip('dossiers', 'Dossiers', groups.length) + chip('comptes', 'Comptes', users.length) + chip('fichiers', 'Fichiers', docs.length) +
      '</div><input id="adm-search" class="adm-search" placeholder="Filtrer par nom, e-mail, fichier…" value="' + esc(adminQuery) + '" />' +
      '<button class="btn-mini adm-new" type="button">+ Créer un compte</button>' +
      '<button class="btn-mini adm-newgrp" type="button">+ Créer un dossier</button>' +
      '<button class="btn-mini adm-logins" type="button">🕐 Historique de connexions</button>' +
      // replier d'un coup les fichiers de tous les dossiers : c'est ce qui rend la vue lisible
      // quand il y a beaucoup de dossiers bien remplis
      (groups.some(function (g) { return docs.some(function (d) { return d.group === g.id; }); })
        ? '<button class="btn-mini ghost adm-foldall" type="button">📄 Replier tous les fichiers</button>' : '') + '</div>';
    var sections = '';
    if (adminShow.dossiers) {
      var gs = groups.filter(function (g) { return !q || norm(g.label || '').indexOf(q) >= 0; });
      sections += '<div class="adm-sec"><h4 class="adm-sec-h">Dossiers</h4>' + (gs.length ? gs.map(function (g) {
        var gd = docs.filter(function (d) { return d.group === g.id; });
        var np = (g.profs || []).length;
        // les fichiers d'un dossier se replient : avec beaucoup de dossiers bien remplis, la
        // liste complète est illisible. Le pli est enveloppé dans une grille dont la rangée
        // passe de 1fr à 0fr — c'est ce qui rend la fermeture animée sans hauteur à calculer.
        var replie = admFilesHidden[g.id];
        return '<div class="adm-grp' + (replie ? ' files-off' : '') + '" data-grp="' + g.id + '"><div class="adm-grp-h"><span class="avatar">📁</span><span class="c-name">' + esc(g.label || '') + '<small>' + np + ' <span>' + (np > 1 ? 'formateurs' : 'formateur') + '</span> · ' + gd.length + ' <span>document(s)</span></small></span>' +
          // les boutons sont groupés : à 375 px le groupe passe à la ligne d'un bloc au lieu de
          // déborder de la boîte du dossier
          '<div class="adm-grp-acts">' +
          (gd.length ? '<button class="adm-fold" type="button" data-id="' + g.id + '" title="' + (replie ? 'Afficher les fichiers de ce dossier' : 'Masquer les fichiers de ce dossier') + '" aria-expanded="' + (replie ? 'false' : 'true') + '"><span class="adm-fold-n">' + gd.length + '</span><span class="adm-fold-ch">▾</span></button>' : '') +
          '<button class="adm-grp-edit" type="button" data-id="' + g.id + '" title="Modifier la composition du dossier">✏️</button>' +
          '<button class="adm-del" type="button" data-del="group" data-id="' + g.id + '" data-label="' + esc(g.label || '') + '" title="Supprimer ce dossier">🗑</button></div></div>' +
          (gd.length ? '<div class="adm-files"><div><ul class="docs">' + gd.map(admDocLi).join('') + '</ul></div></div>' : '') + '</div>';
      }).join('') : '<p class="ds-empty">Aucun dossier.</p>') + '</div>';
    }
    if (adminShow.comptes) {
      var us = users.filter(function (u) { return !q || norm(u.prenom + ' ' + u.nom).indexOf(q) >= 0 || norm(u.email).indexOf(q) >= 0; });
      sections += '<div class="adm-sec"><h4 class="adm-sec-h">Comptes</h4>' + (us.length ? '<ul class="admin-users">' + us.map(function (u) {
        // les dossiers de cette personne, décrits par les AUTRES membres qu'elle y côtoie
        var ds = groups.filter(function (g) {
          return (g.profs || []).some(function (x) { return x.id === u.id; }) || (g.eleve && g.eleve.id === u.id);
        }).map(function (g) {
          var membres = (g.profs || []).concat(g.eleve ? [g.eleve] : []);
          var autres = membres.filter(function (x) { return x.id !== u.id; }).map(function (x) { return x.name; });
          return autres.join(', ') || '(seul)';
        });
        var canDel = u.id !== ME.id, canEdit = u.role === 'eleve' || u.role === 'prof';
        return '<li><span class="avatar">' + esc(initials(fullName(u))) + '</span><span class="c-name">' + esc(fullName(u)) + '<small>' + esc(u.email || '') + '</small>' +
          '<small class="adm-contacts">' + (ds.length ? 'Dossiers : ' + ds.map(esc).join(', ') : 'Aucun dossier') + '</small></span>' +
          (u.pending ? '<span class="pend-chip" title="Le compte a été créé, la personne n\'a pas encore choisi son mot de passe">⏳ En attente</span>' : '') +
          '<span class="role-chip role-' + u.role + '">' + ROLES[u.role] + '</span>' +
          (canEdit ? '<button class="adm-reinv" type="button" data-id="' + u.id + '" data-label="' + esc(u.email || '') + '" title="Renvoyer le lien de première connexion">✉️</button>' : '') +
          '<button class="adm-hist" type="button" data-id="' + u.id + '" data-name="' + esc(fullName(u)) + '" title="Historique de connexions">🕐</button>' +
          (canEdit ? '<button class="adm-edit" type="button" data-id="' + u.id + '" title="Modifier la fiche">✏️</button>' : '') +
          (canDel ? '<button class="adm-del" type="button" data-del="user" data-id="' + u.id + '" data-label="' + esc(fullName(u)) + '" title="Supprimer ce compte">🗑</button>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="ds-empty">Aucun compte trouvé.</p>') + '</div>';
    }
    if (adminShow.fichiers) {
      var fl = docs.filter(function (d) { return !q || norm(d.name + ' ' + (d.groupLabel || '')).indexOf(q) >= 0; });
      sections += '<div class="adm-sec"><h4 class="adm-sec-h">Fichiers</h4>' + (fl.length ? '<ul class="docs">' + fl.map(admFileLi).join('') + '</ul>' : '<p class="ds-empty">Aucun fichier.</p>') + '</div>';
    }
    if (!adminShow.dossiers && !adminShow.comptes && !adminShow.fichiers) sections = '<p class="ds-empty">Sélectionnez au moins une catégorie à afficher.</p>';
    return '<div class="ds-card admin-card">' + bar + '<div class="adm-body">' + sections + '</div></div>';
  }
  function wireAdmin() {
    document.querySelectorAll('.adm-chip').forEach(function (t) { t.onclick = function () { var k = t.getAttribute('data-k'); adminShow[k] = !adminShow[k]; rerenderAdmin(false); }; });
    var s = document.getElementById('adm-search'); if (s) s.oninput = function () { adminQuery = s.value; rerenderAdmin(true); };
    var nb = document.querySelector('.adm-new'); if (nb) nb.onclick = openCreateAccount;
    var ng = document.querySelector('.adm-newgrp'); if (ng) ng.onclick = openCreateGroup;
    var lb = document.querySelector('.adm-logins'); if (lb) lb.onclick = function () { openLoginsModal(null, null); };
    // ⚠️ le pli ne passe PAS par rerenderAdmin : on bascule la classe sur place, sinon le panneau
    // est reconstruit et la transition CSS n'a pas lieu (le pli serait instantané).
    function plier(box, replie) {
      var id = box.getAttribute('data-grp'), btn = box.querySelector('.adm-fold');
      box.classList.toggle('files-off', replie);
      if (replie) admFilesHidden[id] = 1; else delete admFilesHidden[id];
      if (btn) {
        btn.setAttribute('aria-expanded', replie ? 'false' : 'true');
        btn.title = replie ? 'Afficher les fichiers de ce dossier' : 'Masquer les fichiers de ce dossier';
      }
    }
    document.querySelectorAll('.adm-fold').forEach(function (b) {
      b.onclick = function () {
        var box = b.closest('.adm-grp'); if (!box) return;
        plier(box, !box.classList.contains('files-off'));
        majFoldAll();
      };
    });
    var fa = document.querySelector('.adm-foldall');
    function majFoldAll() {
      if (!fa) return;
      var boites = [].slice.call(document.querySelectorAll('.adm-grp .adm-fold')).map(function (b) { return b.closest('.adm-grp'); });
      var ouverts = boites.filter(function (x) { return !x.classList.contains('files-off'); }).length;
      fa.textContent = ouverts ? '📄 Replier tous les fichiers' : '📄 Déplier tous les fichiers';
    }
    if (fa) {
      majFoldAll();
      fa.onclick = function () {
        var boites = [].slice.call(document.querySelectorAll('.adm-grp .adm-fold')).map(function (b) { return b.closest('.adm-grp'); });
        var replier = boites.some(function (x) { return !x.classList.contains('files-off'); });
        boites.forEach(function (x) { plier(x, replier); });
        majFoldAll();
      };
    }
    document.querySelectorAll('.adm-hist').forEach(function (b) {
      b.onclick = function () { openLoginsModal(b.getAttribute('data-id'), b.getAttribute('data-name')); };
    });
    document.querySelectorAll('.adm-grp-edit').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id');
        var g = ((ADMIN_OVERVIEW && ADMIN_OVERVIEW.groups) || []).filter(function (x) { return x.id === id; })[0];
        if (g) openEditGroup(g);
      };
    });
    document.querySelectorAll('.adm-reinv').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id'), mail = b.getAttribute('data-label');
        confirmDialog({
          title: 'Renvoyer le lien de première connexion ?',
          message: 'Un nouveau lien sera envoyé à ' + mail + ' pour choisir un mot de passe. L\'ancien lien cessera de fonctionner. Si la personne s\'est déjà connectée, son mot de passe actuel restera valable tant qu\'elle n\'utilise pas ce nouveau lien.',
          confirm: 'Envoyer', cancel: 'Annuler',
          onConfirm: function () {
            apiJSON('/api/admin/users/' + encodeURIComponent(id) + '/reinvite', 'POST', {}).then(function (r) {
              if (!r.ok) { alertDialog((r.data && r.data.error) || 'Envoi impossible.'); return; }
              alertDialog('Lien envoyé à ' + mail + '.');
              api('/api/admin/overview').then(function (o) { if (o.ok) { ADMIN_OVERVIEW = o.data; rerenderAdmin(false); } });
            });
          }
        });
      };
    });
    document.querySelectorAll('.adm-edit').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id');
        var u = (ADMIN_OVERVIEW.users || []).filter(function (x) { return x.id === id; })[0];
        if (u) openFicheEdit(u);
      };
    });
    document.querySelectorAll('.adm-del').forEach(function (b) {
      b.onclick = function () {
        var kind = b.getAttribute('data-del'), id = b.getAttribute('data-id'), label = b.getAttribute('data-label');
        var isGroup = kind === 'group';
        confirmDialog({
          title: isGroup ? 'Supprimer ce dossier ?' : 'Supprimer ce compte ?',
          message: isGroup
            ? 'Le dossier « ' + label +' » sera supprimé, ainsi que tous ses documents et messages. Cette action est irréversible.'
            : 'Le compte « ' + label + ' » sera supprimé, ainsi que ses dossiers, documents et messages associés. Cette action est irréversible.',
          confirm: 'Supprimer définitivement', cancel: 'Annuler',
          onConfirm: function () {
            api(isGroup ? '/api/groups/' + encodeURIComponent(id) : '/api/users/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) {
              if (!r.ok) { alertDialog((r.data && r.data.error) || 'Suppression impossible.'); return; }
              api('/api/admin/overview').then(function (o) { if (o.ok) { ADMIN_OVERVIEW = o.data; rerenderAdmin(false); } });
            });
          }
        });
      };
    });
  }
  function rerenderAdmin(keepFocus) {
    var card = document.querySelector('.admin-card'); if (!card || !ADMIN_OVERVIEW) return;
    var tmp = document.createElement('div'); tmp.innerHTML = adminPanel(ADMIN_OVERVIEW);
    card.replaceWith(tmp.firstChild);
    wireAdmin();
    if (keepFocus) { var s = document.getElementById('adm-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  }
  // ---- admin : créer un compte (apprenant ou formateur) --------------------
  function openCreateAccount() {
    var footer = '<p class="fe-err auth-err" id="ca-err" style="margin:0 12px 0 0"></p><button class="btn btn-primary ca-save" type="button" style="padding:11px 22px">Créer le compte</button>';
    var m = buildFsModal('ca-modal', 'Créer un compte', accountFieldsHTML(), footer);
    wireEyes(m);
    var roleSel = m.querySelector('#su-role');
    var applyRole = function () {
      var r = roleSel.value;
      m.querySelector('#su-eleve-fields').style.display = r === 'eleve' ? '' : 'none';
      m.querySelector('#su-prof-fields').style.display = r === 'prof' ? '' : 'none';
    };
    roleSel.onchange = applyRole; applyRole();
    var certSel = m.querySelector('#su-certif');
    if (certSel) { var ct = function () { m.querySelector('#su-certif-wrap').style.display = certSel.value === 'oui' ? '' : 'none'; }; certSel.onchange = ct; ct(); }
    var lieuSel = m.querySelector('#su-lieu');
    if (lieuSel) { var lt = function () { m.querySelector('#su-lieu-wrap').style.display = (lieuSel.value === 'presentiel' || lieuSel.value === 'mixte') ? '' : 'none'; }; lieuSel.onchange = lt; lt(); }
    m.querySelector('.ca-save').onclick = function () {
      if (!val('su-prenom') || !val('su-nom') || !val('su-email')) { err('ca-err', 'Prénom, nom et e-mail sont obligatoires.'); return; }
      var role = val('su-role');
      var btn = m.querySelector('.ca-save'); btn.disabled = true; btn.textContent = 'Création…';
      apiJSON('/api/admin/users', 'POST', { prenom: val('su-prenom'), nom: val('su-nom'), email: val('su-email'), role: role, profile: collectProfile(role) }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Créer le compte';
        if (!r.ok) { err('ca-err', (r.data && r.data.error) || 'Création impossible.'); return; }
        closeFsModal('ca-modal');
        alertDialog('Compte créé. Un e-mail vient d\'être envoyé à ' + val('su-email') + ' avec un lien personnel pour choisir le mot de passe.');
        api('/api/admin/overview').then(function (o) { if (o.ok) { ADMIN_OVERVIEW = o.data; rerenderAdmin(false); } });
      });
    };
  }
  // ---- admin : constituer un dossier (formateur + apprenant) ---------------
  function openCreateGroup() {
    var users = (ADMIN_OVERVIEW && ADMIN_OVERVIEW.users) || [];
    var profs = users.filter(function (u) { return u.role === 'prof'; });
    var eleves = users.filter(function (u) { return u.role === 'eleve'; });
    if (!profs.length || !eleves.length) {
      alertDialog('Il faut au moins un formateur et un apprenant pour constituer un dossier.');
      return;
    }
    var body = groupComposerBody(profs, eleves, [], null,
      'Un dossier suit UN apprenant, avec autant de formateurs que nécessaire (au moins un). Toutes les personnes retenues seront notifiées et partageront la discussion commune ; l\'administration est membre automatiquement.');
    var footer = '<p class="fe-err auth-err" id="cg-err" style="margin:0 12px 0 0"></p><button class="btn btn-primary cg-save" type="button" style="padding:11px 22px">Créer le dossier</button>';
    var m = buildFsModal('cg-modal', 'Créer un dossier', body, footer);
    m.querySelector('.cg-save').onclick = function () {
      var ids = { profIds: pickedIds('cg-profs'), eleveId: val('cg-eleve') };
      if (!ids.eleveId) { err('cg-err', 'Choisissez l\'apprenant du dossier.'); return; }
      if (!ids.profIds.length) { err('cg-err', 'Choisissez au moins un formateur.'); return; }
      var btn = m.querySelector('.cg-save'); btn.disabled = true; btn.textContent = 'Création…';
      apiJSON('/api/groups', 'POST', ids).then(function (r) {
        btn.disabled = false; btn.textContent = 'Créer le dossier';
        if (!r.ok) { err('cg-err', (r.data && r.data.error) || 'Création impossible.'); return; }
        closeFsModal('cg-modal');
        api('/api/admin/overview').then(function (o) { if (o.ok) { ADMIN_OVERVIEW = o.data; renderDashboard(); } });
      });
    };
  }
  // Liste à cocher : chaque personne est une case (autant de membres que voulu de chaque côté).
  function pickListHTML(id, list, sel) {
    if (!list.length) return '<p class="ds-empty" style="margin:0">Aucun compte disponible.</p>';
    return '<div class="pick-list" id="' + id + '">' + list.map(function (u) {
      return '<label class="pick-row"><input type="checkbox" value="' + esc(u.id) + '"' + (sel.indexOf(u.id) >= 0 ? ' checked' : '') + ' />' +
        '<span class="pick-name">' + esc(fullName(u)) + '<small>' + esc(u.email || '') + '</small></span></label>';
    }).join('') + '</div>';
  }
  function pickedIds(id) {
    var box = document.getElementById(id); if (!box) return [];
    return [].slice.call(box.querySelectorAll('input:checked')).map(function (c) { return c.value; });
  }
  // un dossier = UN apprenant (liste déroulante) + AUTANT DE FORMATEURS que voulu (cases à cocher)
  function groupComposerBody(profs, eleves, selP, selE, note) {
    var eleveBloc = selE
      ? '<p class="ds-empty" style="margin:0">' + esc(selE.nom) + '</p>'
      : '<label class="gf">Apprenant<select id="cg-eleve">' + eleves.map(function (u) {
          return '<option value="' + esc(u.id) + '">' + esc(fullName(u)) + ' — ' + esc(u.email || '') + '</option>';
        }).join('') + '</select></label>';
    return '<h4 class="gen-h">Apprenant</h4><div class="gf-grid">' + eleveBloc + '</div>' +
      '<h4 class="gen-h" style="margin-top:18px">Formateurs</h4>' + pickListHTML('cg-profs', profs, selP) +
      '<p class="chan-note" style="margin-top:12px">' + note + '</p>';
  }
  // Modifier la composition d'un dossier existant, À TOUT MOMENT (pas seulement à la création) :
  // on coche / décoche les formateurs. Rien n'est appliqué sans confirmation nommant les personnes
  // concernées — retirer un formateur lui coupe l'accès, en ajouter un lui ouvre TOUT l'historique
  // du canal privé déjà échangé. Deux entrées : le bouton « 👥 Formateurs » dans le dossier ouvert
  // et le ✏️ de chaque dossier de la vue globale.
  function openEditGroup(g) {
    var users = (ADMIN_OVERVIEW && ADMIN_OVERVIEW.users) || [];
    var profs = users.filter(function (u) { return u.role === 'prof'; });
    var eleves = users.filter(function (u) { return u.role === 'eleve'; });
    var selP = gProfs(g).map(function (x) { return x.id; });
    // la vue globale renvoie { id, name }, /api/groups renvoie une fiche { prenom, nom }
    var nomEleve = g.eleve ? (g.eleve.name || fullName(g.eleve)) : '—';
    var body = groupComposerBody(profs, eleves, selP, { nom: nomEleve },
      'L\'apprenant d\'un dossier ne change pas : ce dossier est le sien. Les formateurs, eux, se cochent et se décochent à tout moment — un formateur retiré perd l\'accès au dossier, mais les documents et messages déjà déposés y restent.');
    var footer = '<p class="fe-err auth-err" id="cg-err" style="margin:0 12px 0 0"></p><button class="btn btn-primary cg-save" type="button" style="padding:11px 22px">Enregistrer</button>';
    var m = buildFsModal('cg-modal', 'Composition du dossier', body, footer);
    function noms(ids) {
      return frList(ids.map(function (id) {
        var u = profs.filter(function (x) { return x.id === id; })[0];
        return u ? fullName(u) : 'ce formateur';
      }));
    }
    function enregistrer(ids) {
      var btn = m.querySelector('.cg-save'); btn.disabled = true; btn.textContent = 'Enregistrement…';
      apiJSON('/api/groups/' + encodeURIComponent(g.id), 'PATCH', { profIds: ids }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Enregistrer';
        if (!r.ok) { err('cg-err', (r.data && r.data.error) || 'Modification impossible.'); return; }
        closeFsModal('cg-modal');
        api('/api/admin/overview').then(function (o) { if (o.ok) { ADMIN_OVERVIEW = o.data; renderDashboard(); } });
      });
    }
    m.querySelector('.cg-save').onclick = function () {
      var apres = pickedIds('cg-profs');
      if (!apres.length) { err('cg-err', 'Un dossier doit garder au moins un formateur.'); return; }
      var retires = selP.filter(function (id) { return apres.indexOf(id) < 0; });
      var ajoutes = apres.filter(function (id) { return selP.indexOf(id) < 0; });
      if (!retires.length && !ajoutes.length) { closeFsModal('cg-modal'); return; }
      var txt = [];
      if (retires.length) txt.push(noms(retires) + (retires.length > 1 ? ' ne verront plus ce dossier' : ' ne verra plus ce dossier') +
        ' : accès aux documents, aux deux canaux et à la messagerie coupé. Ce qui a déjà été déposé reste dans le dossier.');
      if (ajoutes.length) txt.push(noms(ajoutes) + (ajoutes.length > 1 ? ' auront accès' : ' aura accès') +
        ' au dossier, y compris à tout l\'historique du canal privé déjà échangé.');
      confirmDialog({
        title: retires.length && !ajoutes.length ? 'Retirer du dossier ?' : 'Modifier les formateurs du dossier ?',
        message: txt.join(' '),
        confirm: 'Appliquer', cancel: 'Revenir',
        onConfirm: function () { enregistrer(apres); }
      });
    };
  }
  // ---- admin : historique de connexions (global ou par compte) -------------
  function openLoginsModal(userId, userName) {
    var title = userId ? 'Connexions — ' + userName : 'Historique de connexions';
    var m = buildFsModal('lg-modal', title, '<div id="lg-holder"><p class="ds-empty">Chargement…</p></div>', '');
    api('/api/admin/logins' + (userId ? '?user=' + encodeURIComponent(userId) : '')).then(function (r) {
      var holder = m.querySelector('#lg-holder'); if (!holder) return;
      var list = (r.ok && r.data.logins) || [];
      holder.innerHTML = list.length ? '<ul class="notif-list">' + list.map(function (l) {
        return '<li><span><b>' + esc(l.name) + '</b> · ' + esc(l.email) + ' · IP ' + esc(l.ip || '?') + '</span><time>' + fmtDate(l.date) + '</time></li>';
      }).join('') + '</ul>' : '<p class="ds-empty">Aucune connexion enregistrée.</p>';
    });
  }
  // ---- admin : modifier la fiche d'un apprenant / formateur ----------------
  function openFicheEdit(u) {
    var p = u.profile || {};
    function gsel(id, label, value, options) { return '<label class="gf">' + label + '<select id="' + id + '">' + options.map(function (o) { return '<option value="' + o[0] + '"' + (value === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>'; }
    var common = '<h4 class="gen-h">Compte</h4><div class="gf-grid">' + gi('fe-prenom', 'Prénom', u.prenom) + gi('fe-nom', 'Nom', u.nom) + gi('fe-email', 'E-mail', u.email) + '<span></span></div>';
    var fiche = '';
    if (u.role === 'eleve') {
      fiche = '<h4 class="gen-h">Fiche apprenant</h4><div class="gf-grid">' +
        gi('fe-tel', 'Téléphone', p.tel) + gi('fe-societe', 'Société', p.societe) +
        gi('fe-ref', 'Réf. proposition', p.refProposition) + '<span></span>' +
        gi('fe-langue', 'Langue', p.langue) + gi('fe-intitule', "Intitulé de la formation", p.intitule) +
        gi('fe-date-debut', 'Date de début', p.dateDebut) + gi('fe-date-fin', 'Date de fin', p.dateFin) +
        gi('fe-heures', "Nombre d'heures total", p.heuresTotal) + '<span></span>' +
        ga('fe-heures-detail', 'Détail des heures', p.heuresDetail) +
        gsel('fe-lieu', 'Lieu de la formation', (function () { var l = (p.lieu || '').toLowerCase(); return (l === 'mixte' || l === 'les deux') ? 'mixte' : (l === 'presentiel' || l === 'présentiel') ? 'presentiel' : 'distanciel'; })(), [['distanciel', 'Distanciel'], ['presentiel', 'Présentiel'], ['mixte', 'Les deux (présentiel et distanciel)']]) +
        gsel('fe-certif', 'Certification', (p.certification === 'oui' ? 'oui' : 'non'), [['non', 'Sans certification'], ['oui', 'Avec certification']]) +
        gi('fe-lieu-adresse', 'Adresse (présentiel)', p.lieuAdresse) + '<span></span>' +
        ga('fe-certif-text', 'Détail de la certification', p.certificationText) + '</div>';
    } else if (u.role === 'prof') {
      fiche = '<h4 class="gen-h">Fiche formateur</h4><div class="gf-grid">' +
        gi('fe-langue', 'Langue', p.langue) + gi('fe-tel', 'Téléphone', p.tel) +
        gi('fe-siret', 'Numéro de SIRET', p.siret) + gi('fe-nda', 'Numéro NDA', p.nda) +
        gi('fe-adresse', 'Adresse physique', p.adresse) + '<span></span>' +
        gi('fe-naissance', 'Date de naissance', p.dateNaissance) + gi('fe-nationalite', 'Nationalité', p.nationalite) + '</div>';
    }
    var footer = '<p class="fe-err auth-err" id="fe-err" style="margin:0 12px 0 0"></p><button class="btn btn-primary fe-save" type="button" style="padding:11px 22px">Enregistrer</button>';
    var m = buildFsModal('fe-modal', 'Modifier la fiche — ' + fullName(u), common + fiche, footer);
    if (u.role === 'eleve') {
      var cs = document.getElementById('fe-certif'), ctw = document.getElementById('fe-certif-text').closest('.gf'); var tog = function () { ctw.style.display = cs.value === 'oui' ? '' : 'none'; }; cs.onchange = tog; tog();
      var ls = document.getElementById('fe-lieu'), law = document.getElementById('fe-lieu-adresse').closest('.gf'); var ltog = function () { law.style.display = (ls.value === 'presentiel' || ls.value === 'mixte') ? '' : 'none'; }; ls.onchange = ltog; ltog();
    }
    m.querySelector('.fe-save').onclick = function () {
      var profile = {};
      if (u.role === 'eleve') profile = { tel: val('fe-tel'), societe: val('fe-societe'), refProposition: val('fe-ref'), heuresTotal: val('fe-heures'), heuresDetail: val('fe-heures-detail'), intitule: val('fe-intitule'), langue: val('fe-langue'), dateDebut: val('fe-date-debut'), dateFin: val('fe-date-fin'), lieu: val('fe-lieu'), lieuAdresse: val('fe-lieu-adresse'), certification: val('fe-certif'), certificationText: val('fe-certif-text') };
      else if (u.role === 'prof') profile = { langue: val('fe-langue'), siret: val('fe-siret'), nda: val('fe-nda'), adresse: val('fe-adresse'), tel: val('fe-tel'), dateNaissance: val('fe-naissance'), nationalite: val('fe-nationalite') };
      var btn = m.querySelector('.fe-save'); btn.disabled = true; btn.textContent = 'Enregistrement…';
      apiJSON('/api/users/' + encodeURIComponent(u.id), 'PATCH', { prenom: val('fe-prenom'), nom: val('fe-nom'), email: val('fe-email'), profile: profile }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Enregistrer';
        if (!r.ok) { err('fe-err', (r.data && r.data.error) || 'Erreur'); return; }
        closeFsModal('fe-modal');
        api('/api/admin/overview').then(function (o) { if (o.ok) { ADMIN_OVERVIEW = o.data; rerenderAdmin(false); } });
      });
    };
  }

  // ---- modale plein écran générique ---------------------------------------
  function buildFsModal(id, title, bodyHTML, footerHTML) {
    var ex = document.getElementById(id); if (ex) ex.remove();
    var m = document.createElement('div'); m.id = id; m.className = 'notif-modal';
    m.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card gen-card gen-full"><div class="nm-head"><h3>' + esc(title) + '</h3><button class="nm-close" type="button">&times;</button></div><div class="nm-body">' + bodyHTML + '</div><div class="gen-foot">' + footerHTML + '</div></div>';
    document.body.appendChild(m);
    m.querySelector('.nm-close').onclick = function () { closeFsModal(id); };
    m.querySelector('.nm-backdrop').onclick = function () { closeFsModal(id); };
    m.classList.add('open'); document.body.style.overflow = 'hidden';
    return m;
  }
  function closeFsModal(id) { var m = document.getElementById(id); if (m) { m.classList.remove('open'); document.body.style.overflow = ''; setTimeout(function () { if (m.parentNode) m.remove(); }, 300); } }
  // ---- petite boîte de confirmation (2 boutons) ---------------------------
  function confirmDialog(opts) {
    var d = document.createElement('div'); d.className = 'notif-modal confirm-modal open';
    d.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card confirm-card"><h3>' + esc(opts.title || 'Confirmer') + '</h3>' +
      '<p>' + esc(opts.message || '') + '</p><div class="confirm-actions">' +
      '<button class="btn btn-ghost cf-cancel" type="button">' + esc(opts.cancel || 'Annuler') + '</button>' +
      '<button class="btn btn-primary cf-ok" type="button">' + esc(opts.confirm || 'Confirmer') + '</button></div></div>';
    document.body.appendChild(d);
    function close() { if (d.parentNode) d.remove(); }
    d.querySelector('.cf-cancel').onclick = function () { close(); if (opts.onCancel) opts.onCancel(); };
    d.querySelector('.cf-ok').onclick = function () { close(); if (opts.onConfirm) opts.onConfirm(); };
    d.querySelector('.nm-backdrop').onclick = function () { close(); if (opts.onCancel) opts.onCancel(); };
  }
  // pop-up d'information stylée « maison » (remplace l'alert() natif du navigateur) — un seul bouton OK
  function alertDialog(message, title) {
    var d = document.createElement('div'); d.className = 'notif-modal confirm-modal open';
    d.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card confirm-card"><h3>' + esc(title || 'Information') + '</h3>' +
      '<p>' + esc(message == null ? '' : message) + '</p><div class="confirm-actions">' +
      '<button class="btn btn-primary cf-ok" type="button" style="min-width:120px">OK</button></div></div>';
    document.body.appendChild(d);
    function close() { if (d.parentNode) d.remove(); }
    d.querySelector('.cf-ok').onclick = close;
    d.querySelector('.nm-backdrop').onclick = close;
    var ok = d.querySelector('.cf-ok'); if (ok) ok.focus();
  }

  // ---- personnes concernées par le document en cours ----------------------
  // Par défaut : l'unique apprenant du dossier, et — pour le formateur connecté — lui-même.
  function curEleve() { return (CUR_GROUP && CUR_GROUP.eleve) || null; }
  function curProf() {
    var P = gProfs(CUR_GROUP); if (!P.length) return null;
    return P.filter(function (u) { return u.id === GEN_PROF; })[0] ||
      P.filter(function (u) { return u.id === ME.id; })[0] || P[0];
  }
  // remet le choix à zéro quand on change de dossier (sinon on générerait pour un formateur d'un autre dossier)
  function resetGenTargets() { var p = curProf(); GEN_PROF = p ? p.id : null; }
  // fiche client (pré-remplissage automatique des documents)
  function clientFiche() { var e = curEleve(); return (e && e.profile) || {}; }
  function profFiche() { var p = curProf(); return (p && p.profile) || {}; }
  // téléchargement direct d'un document généré (binaire) + états du bouton
  function downloadDoc(m, btnSel, url, body, baseName) {
    var btn = m.querySelector(btnSel), orig = 'Générer le document →'; btn.disabled = true; btn.textContent = 'Génération…';
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || 'Erreur'); }); return r.blob(); })
      .then(function (blob) {
        var ext = body.format === 'word' ? 'docx' : 'pdf';
        var dt = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');
        var nm = baseName.replace(/[\\/]/g, '-') + ' - ' + dt + '.' + ext;
        var u = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = u; a.download = nm; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
        btn.disabled = false; btn.textContent = 'Document généré ✓ — re-générer'; setTimeout(function () { btn.textContent = orig; }, 3000);
      })
      .catch(function (e) { btn.disabled = false; btn.textContent = orig; alertDialog(e.message || 'Génération impossible.'); });
  }
  function certifLine(p) { p = p || {}; var c = (p.certification || '').toLowerCase(); if (c === 'oui') return 'Avec certification' + (p.certificationText ? ' — ' + p.certificationText : ''); if (c === 'non') return 'Sans certification'; return ''; }
  function lieuLabel(p) { p = p || {}; var l = (p.lieu || '').toLowerCase(); var adr = p.lieuAdresse ? ' — ' + p.lieuAdresse : ''; if (l === 'mixte' || l === 'les deux') return 'Présentiel et distanciel' + adr; if (l === 'presentiel' || l === 'présentiel') return 'Présentiel' + adr; if (l === 'distanciel') return 'Distanciel'; return ''; }
  function headerPrefill() {
    var fc = clientFiche();
    return { nomApprenant: fullName(curEleve()), formateur: fullName(curProf()), date: fc.dateDebut || new Date().toLocaleDateString('fr-FR'), societe: fc.societe || '', langue: fc.langue || '', intitule: fc.intitule || '', certification: certifLine(fc) };
  }
  // ---- QS : le formateur remplit l'en-tête et envoie à l'apprenant ---------
  function openQsHeaderModal(type) {
    if (!selected || !CUR_GROUP) return;
    var titles = { qs_mid: 'Questionnaire de satisfaction — en cours de formation', qs_end: 'Questionnaire de fin de formation' };
    // pas de ligne « Certification » sur les questionnaires mi-parcours et fin de formation
    var fields = [['nomApprenant', "Nom de l'apprenant"], ['societe', 'Société'], ['langue', 'Langue'], ['intitule', 'Intitulé de la formation'], ['formateur', 'Formateur'], ['date', 'Date']];
    var h = headerPrefill();
    var body = '<p class="ds-empty" style="margin:0 0 14px">Renseignez l\'en-tête, puis envoyez le questionnaire à l\'apprenant : il reçoit une notification et le remplit depuis le chat.</p><div class="gf-grid">' +
      fields.map(function (f) { return gi('qsh-' + f[0], f[1], h[f[0]]); }).join('') + '</div>';
    var m = buildFsModal('qsh-modal', titles[type] || 'Questionnaire', body, '<button class="btn btn-primary qsh-send" type="button" style="padding:11px 22px">Envoyer à l\'apprenant →</button>');
    m.querySelector('.qsh-send').onclick = function () {
      var header = {}; fields.forEach(function (f) { header[f[0]] = val('qsh-' + f[0]); });
      var btn = m.querySelector('.qsh-send'); btn.disabled = true; btn.textContent = 'Envoi…';
      apiJSON('/api/qs/send', 'POST', { group: selected, type: type, header: header }).then(function (r) {
        if (!r.ok) { btn.disabled = false; btn.textContent = 'Envoyer à l\'apprenant →'; alertDialog((r.data && r.data.error) || 'Erreur'); return; }
        closeFsModal('qsh-modal'); channel = 'commun'; renderDashboard();
      });
    };
  }

  // ---- petite modale : dimensions d'un tableau (remplace prompt navigateur) ----
  function tableSizeDialog(cb) {
    var d = document.createElement('div'); d.className = 'notif-modal confirm-modal open';
    d.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card confirm-card"><h3>Insérer un tableau</h3>' +
      '<div class="tbl-dim"><label>Lignes<input type="number" min="1" max="20" value="2" id="tbl-rows" /></label>' +
      '<label>Colonnes<input type="number" min="1" max="10" value="2" id="tbl-cols" /></label></div>' +
      '<div class="confirm-actions"><button class="btn btn-ghost cf-cancel" type="button">Annuler</button>' +
      '<button class="btn btn-primary cf-ok" type="button">Insérer →</button></div></div>';
    document.body.appendChild(d);
    function close() { if (d.parentNode) d.remove(); }
    d.querySelector('.cf-cancel').onclick = close;
    d.querySelector('.nm-backdrop').onclick = close;
    d.querySelector('.cf-ok').onclick = function () {
      var r = parseInt(document.getElementById('tbl-rows').value, 10), c = parseInt(document.getElementById('tbl-cols').value, 10);
      close();
      if (r > 0 && c > 0) cb(Math.min(r, 20), Math.min(c, 10));
    };
    setTimeout(function () { var inp = document.getElementById('tbl-rows'); if (inp) { inp.focus(); inp.select(); } }, 30);
  }
  // ---- petite modale : question à choix multiples ----
  function mcqDialog(cb) {
    var d = document.createElement('div'); d.className = 'notif-modal confirm-modal open';
    d.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card confirm-card"><h3>Question à choix multiples</h3>' +
      '<div class="mcq-form"><label>Question<input type="text" id="mcq-q" placeholder="Votre question…" /></label>' +
      '<label>Réponses (une par ligne)<textarea id="mcq-opts" rows="4" placeholder="Réponse A\nRéponse B\nRéponse C"></textarea></label>' +
      '<p class="mcq-hint">Après insertion, cliquez sur la bonne réponse pour la cocher.</p></div>' +
      '<div class="confirm-actions"><button class="btn btn-ghost cf-cancel" type="button">Annuler</button>' +
      '<button class="btn btn-primary cf-ok" type="button">Insérer →</button></div></div>';
    document.body.appendChild(d);
    function close() { if (d.parentNode) d.remove(); }
    d.querySelector('.cf-cancel').onclick = close;
    d.querySelector('.nm-backdrop').onclick = close;
    d.querySelector('.cf-ok').onclick = function () {
      var q = document.getElementById('mcq-q').value.trim();
      var opts = document.getElementById('mcq-opts').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      close();
      if (q && opts.length) cb(q, opts);
    };
    setTimeout(function () { var i = document.getElementById('mcq-q'); if (i) i.focus(); }, 30);
  }
  // ---- éditeur de texte enrichi (gras/italique/souligné/couleur/listes/tableaux) ----
  function richEditorHTML(id) {
    return '<div class="rt-wrap"><div class="rt-toolbar" data-for="' + id + '">' +
      '<button type="button" class="rt-b" data-cmd="bold" title="Gras"><b>B</b></button>' +
      '<button type="button" class="rt-b" data-cmd="italic" title="Italique"><i>I</i></button>' +
      '<button type="button" class="rt-b" data-cmd="underline" title="Souligné"><u>U</u></button>' +
      '<label class="rt-color" title="Couleur du texte"><span>A</span><input type="color" class="rt-col" value="#000000" /></label>' +
      '<button type="button" class="rt-b" data-cmd="insertUnorderedList" title="Liste à puces">• Liste</button>' +
      '<button type="button" class="rt-b" data-cmd="insertOrderedList" title="Liste numérotée">1. Liste</button>' +
      '<button type="button" class="rt-b rt-tbl" title="Insérer un tableau">▦ Tableau</button>' +
      '<button type="button" class="rt-b rt-qcm-btn" title="Question à choix multiples">◉ QCM</button>' +
      '</div><div class="rt-editor" id="' + id + '" contenteditable="true"></div></div>';
  }
  function wireRichEditor(m, id) {
    var ed = document.getElementById(id);
    var tb = m.querySelector('.rt-toolbar[data-for="' + id + '"]');
    if (!ed || !tb) return;
    tb.querySelectorAll('.rt-b[data-cmd]').forEach(function (b) {
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.onclick = function () { ed.focus(); try { document.execCommand(b.getAttribute('data-cmd'), false, null); } catch (e) { } };
    });
    var col = tb.querySelector('.rt-col');
    if (col) { col.addEventListener('mousedown', function () { ed.focus(); }); col.onchange = function () { ed.focus(); try { document.execCommand('foreColor', false, col.value); } catch (e) { } }; }
    function savedRange() { var s = window.getSelection(); return (s.rangeCount && ed.contains(s.anchorNode)) ? s.getRangeAt(0).cloneRange() : null; }
    function insertAt(saved, html) { ed.focus(); if (saved) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); } try { document.execCommand('insertHTML', false, html); } catch (e) { } }
    var tbtn = tb.querySelector('.rt-tbl');
    if (tbtn) {
      tbtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      tbtn.onclick = function () {
        var saved = savedRange();
        tableSizeDialog(function (r, c) {
          var html = '<table class="rt-table"><tbody>';
          for (var i = 0; i < r; i++) { html += '<tr>'; for (var j = 0; j < c; j++) html += '<td>&nbsp;</td>'; html += '</tr>'; }
          html += '</tbody></table><p><br></p>';
          insertAt(saved, html);
        });
      };
    }
    var qbtn = tb.querySelector('.rt-qcm-btn');
    if (qbtn) {
      qbtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      qbtn.onclick = function () {
        var saved = savedRange();
        mcqDialog(function (q, opts) {
          var html = '<div class="rt-qcm" contenteditable="false"><div class="rt-qcm-q">' + esc(q) + '</div>' +
            opts.map(function (o, i) { return '<div class="rt-qcm-opt" data-i="' + i + '">' + esc(o) + '</div>'; }).join('') +
            '</div><p><br></p>';
          insertAt(saved, html);
        });
      };
    }
    // clic sur une réponse → la coche comme bonne réponse (radio)
    ed.addEventListener('click', function (e) {
      var opt = e.target.closest && e.target.closest('.rt-qcm-opt'); if (!opt || !ed.contains(opt)) return;
      var box = opt.closest('.rt-qcm'); if (!box) return;
      var was = opt.classList.contains('sel');
      box.querySelectorAll('.rt-qcm-opt').forEach(function (o) { o.classList.remove('sel'); });
      if (!was) opt.classList.add('sel');
    });
  }
  function rtHex(c) { if (!c) return undefined; c = String(c).trim(); var m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (m) return '#' + [m[1], m[2], m[3]].map(function (n) { return ('0' + (+n).toString(16)).slice(-2); }).join(''); return c; }
  function rtRuns(node, fmt) {
    var out = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var ch = node.childNodes[i];
      if (ch.nodeType === 3) { if (ch.textContent) out.push(Object.assign({ text: ch.textContent }, fmt)); }
      else if (ch.nodeType === 1) {
        var t = ch.tagName.toLowerCase();
        if (t === 'br') { out.push(Object.assign({ text: '\n' }, fmt)); continue; }
        var f = {}; for (var k in fmt) f[k] = fmt[k];
        if (t === 'b' || t === 'strong') f.bold = true;
        if (t === 'i' || t === 'em') f.italic = true;
        if (t === 'u' || t === 'ins') f.underline = true;
        var col = ch.style && ch.style.color; if (col) f.color = rtHex(col);
        if (t === 'font' && ch.getAttribute('color')) f.color = ch.getAttribute('color');
        out = out.concat(rtRuns(ch, f));
      }
    }
    return out;
  }
  function tableBlock(node) {
    var rows = []; node.querySelectorAll('tr').forEach(function (tr) { var cells = []; tr.querySelectorAll('td,th').forEach(function (td) { cells.push(rtRuns(td, {})); }); if (cells.length) rows.push(cells); });
    return rows.length ? { type: 'table', rows: rows } : null;
  }
  function serializeRich(el) {
    var blocks = []; if (!el) return blocks;
    function flush(runs) { if (runs.length) blocks.push({ type: 'p', runs: runs }); }
    function walk(container) {
      var inline = [];
      for (var i = 0; i < container.childNodes.length; i++) {
        var node = container.childNodes[i];
        if (node.nodeType === 3) { if (node.textContent) inline.push({ text: node.textContent }); continue; }
        if (node.nodeType !== 1) continue;
        if (node.classList && node.classList.contains('rt-qcm')) {
          flush(inline); inline = [];
          var qEl = node.querySelector('.rt-qcm-q'); var question = qEl ? qEl.textContent.trim() : '';
          var optEls = node.querySelectorAll('.rt-qcm-opt'); var options = [], answer = -1;
          for (var oi = 0; oi < optEls.length; oi++) { options.push(optEls[oi].textContent.trim()); if (optEls[oi].classList.contains('sel')) answer = oi; }
          if (question || options.length) blocks.push({ type: 'qcm', question: question, options: options, answer: answer });
          continue;
        }
        var t = node.tagName.toLowerCase();
        if (t === 'ul' || t === 'ol') { flush(inline); inline = []; var items = []; node.querySelectorAll('li').forEach(function (li) { items.push(rtRuns(li, {})); }); if (items.length) blocks.push({ type: t, items: items }); }
        else if (t === 'table') { flush(inline); inline = []; var tb = tableBlock(node); if (tb) blocks.push(tb); }
        else if (t === 'br') { inline.push({ text: '\n' }); }
        else if ((t === 'p' || t === 'div' || t === 'section') && node.querySelector('table,ul,ol,.rt-qcm')) { flush(inline); inline = []; walk(node); }
        else if (t === 'p' || t === 'div') { flush(inline); inline = []; var r = rtRuns(node, {}); if (r.length) blocks.push({ type: 'p', runs: r }); }
        else { inline = inline.concat(rtRuns(node, {})); }
      }
      flush(inline);
    }
    walk(el);
    return blocks;
  }

  // ---- Tests (mi-parcours / fin) : le formateur remplit et télécharge ------
  function openTestDocModal(type) {
    if (!selected || !CUR_GROUP) return;
    var titles = { test_mid: 'Test de mi-parcours de formation', test_end: 'Test de fin de formation' };
    // pas de ligne « Certification » sur les tests mi-parcours et fin de formation
    var fields = [['nomApprenant', "Nom de l'apprenant"], ['societe', 'Société'], ['langue', 'Langue'], ['intitule', 'Intitulé de la formation'], ['formateur', 'Formateur'], ['date', 'Date']];
    var h = headerPrefill();
    var body = '<p class="ds-empty" style="margin:0 0 14px">Renseignez l\'en-tête, le résultat et votre appréciation, puis générez le document à télécharger.</p><div class="gf-grid">' +
      fields.map(function (f) { return gi('td-' + f[0], f[1], h[f[0]]); }).join('') + '</div>' +
      '<h4 class="gen-h">Résultat &amp; appréciation</h4><div class="gf-grid">' +
      gi('td-resultat', 'Résultat', '') + ga('td-appreciation', 'Appréciation formateur', '', 4) + '</div>' +
      '<h4 class="gen-h">Zone libre <small style="font-weight:400;color:var(--ink-soft)">(mise en forme avancée — sans titre sur le document)</small></h4>' +
      richEditorHTML('td-rt');
    var footer = '<label class="gen-chan">Format <select id="td-format"><option value="pdf">PDF</option><option value="word">Word (.docx)</option></select></label>' +
      '<button class="btn btn-primary td-gen" type="button" style="padding:11px 22px">Générer le document →</button>';
    var m = buildFsModal('td-modal', titles[type] || 'Test', body, footer);
    wireRichEditor(m, 'td-rt');
    m.querySelector('.td-gen').onclick = function () {
      var header = {}; fields.forEach(function (f) { header[f[0]] = val('td-' + f[0]); });
      var extra = { resultat: val('td-resultat'), appreciation: val('td-appreciation'), libre: serializeRich(document.getElementById('td-rt')) };
      var fmt = document.getElementById('td-format').value;
      var btn = m.querySelector('.td-gen'); btn.disabled = true; btn.textContent = 'Génération…';
      fetch('/api/testdoc/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify({ group: selected, type: type, header: header, extra: extra, format: fmt }) })
        .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || 'Erreur'); }); return r.blob(); })
        .then(function (blob) {
          var ext = fmt === 'word' ? 'docx' : 'pdf';
          var nm = (type === 'test_mid' ? '5' : '6') + ' - ' + (titles[type] || 'Test') + ' - ' + (header.nomApprenant || 'apprenant') + ' - ' + new Date().toLocaleDateString('fr-FR') + '.' + ext;
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a'); a.href = url; a.download = nm; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          btn.disabled = false; btn.textContent = 'Document généré ✓ — re-générer';
          setTimeout(function () { btn.textContent = 'Générer le document →'; }, 3000);
        })
        .catch(function (e) { btn.disabled = false; btn.textContent = 'Générer le document →'; alertDialog(e.message || 'Génération impossible.'); });
    };
  }

  // ---- Attestation de fin de stage (formateur + admin) ---------------------
  function openAttestationModal() {
    if (!selected || !CUR_GROUP) return;
    var fc = clientFiche();
    var pre = { representant: 'Antonin HATTABE', apprenant: fullName(curEleve()), societe: fc.societe || '', intitule: fc.intitule || '', formateur: fullName(curProf()), dateDebut: fc.dateDebut || '', dateFin: fc.dateFin || '', dureeTotale: fc.heuresTotal || '', dureeDetail: fc.heuresDetail || '', lieu: lieuLabel(fc) || 'Distanciel', certification: fc.certificationText || '', lieuFait: 'Nice', dateFait: new Date().toLocaleDateString('fr-FR') };
    var head = '<p class="ds-empty" style="margin:0 0 14px">Le début est prérempli depuis les fiches. Complétez les objectifs, l\'évaluation et les commentaires.</p>' +
      '<h4 class="gen-h">En-tête</h4><div class="gf-grid">' +
      gi('att-apprenant', "Nom de l'apprenant", pre.apprenant) + gi('att-societe', 'Société', pre.societe) +
      gi('att-intitule', 'Intitulé de la formation', pre.intitule) + gi('att-formateur', 'Formateur', pre.formateur) +
      gi('att-debut', 'Date de début', pre.dateDebut) + gi('att-fin', 'Date de fin', pre.dateFin) +
      gi('att-duree', 'Durée totale', pre.dureeTotale) + gi('att-lieu', 'Lieu', pre.lieu) +
      gi('att-detail', 'Dont (visio / e-learning / certification…)', pre.dureeDetail) + gi('att-rep', 'Représentant L&S', pre.representant) + '</div>';
    var obj = '<h4 class="gen-h">Objectifs de la formation</h4><div class="gf-grid">' + ga('att-objectifs', 'Un objectif par ligne', '', 4) + '</div>';
    var comps = '<h4 class="gen-h">Résultat de l\'évaluation des acquis</h4><div class="att-comps">';
    for (var i = 0; i < 6; i++) { comps += '<div class="att-comp-row"><input id="att-comp-l-' + i + '" placeholder="Compétence ' + (i + 1) + '" /><select id="att-comp-n-' + i + '"><option value="">—</option><option>Acquis</option><option>En cours d\'acquisition</option><option>Non acquis</option></select></div>'; }
    comps += '</div>';
    var fin = '<h4 class="gen-h">Niveau &amp; commentaires</h4><div class="gf-grid">' + gi('att-niveau', 'Niveau atteint', '') + gi('att-certif', 'Certification', pre.certification) + gi('att-dateeval', "Date de l'évaluation", '') + gi('att-resultat', 'Résultat', '') + '</div>' +
      '<div class="gf-grid">' + ga('att-comments', 'Commentaires du formateur', '', 3) + '</div>' +
      '<div class="gf-grid">' + gi('att-lieufait', 'Fait à', pre.lieuFait) + gi('att-datefait', 'Le', pre.dateFait) + '</div>';
    var footer = '<label class="gen-chan">Format <select id="att-format"><option value="pdf">PDF</option><option value="word">Word (.docx)</option></select></label><button class="btn btn-primary att-gen" type="button" style="padding:11px 22px">Générer le document →</button>';
    var m = buildFsModal('att-modal', 'Attestation de fin de stage', head + obj + comps + fin, footer);
    m.querySelector('.att-gen').onclick = function () {
      var competences = [];
      for (var i = 0; i < 6; i++) { var lbl = val('att-comp-l-' + i); if (lbl && lbl.trim()) competences.push({ label: lbl, niveau: val('att-comp-n-' + i) }); }
      var fields = { representant: val('att-rep'), apprenant: val('att-apprenant'), societe: val('att-societe'), intitule: val('att-intitule'), formateur: val('att-formateur'), dateDebut: val('att-debut'), dateFin: val('att-fin'), dureeTotale: val('att-duree'), dureeDetail: val('att-detail'), lieu: val('att-lieu'), objectifs: val('att-objectifs'), competences: competences, niveauAtteint: val('att-niveau'), certification: val('att-certif'), dateEval: val('att-dateeval'), resultat: val('att-resultat'), commentaires: val('att-comments'), lieuFait: val('att-lieufait'), dateFait: val('att-datefait') };
      downloadDoc(m, '.att-gen', '/api/attestation/generate', { group: selected, fields: fields, format: document.getElementById('att-format').value }, '4 - Attestation de fin de formation - ' + (fields.apprenant || 'apprenant'));
    };
  }

  // ---- Contrat de sous-traitance (admin uniquement) ------------------------
  function openContratModal() {
    if (!selected || !CUR_GROUP || ME.role !== 'admin') return;
    var fc = clientFiche(), pf = profFiche();
    var progPre = (fc.heuresTotal || '') + (fc.heuresDetail ? (fc.heuresTotal ? ' : ' : '') + fc.heuresDetail : '') + (fc.certificationText ? ' et la ' + fc.certificationText : '');
    var missionPre = "l'animation des seules …h00 de formation synchrones, selon la ou les modalités précisées ci-dessus (présentiel et/ou distanciel). Les autres composantes du programme global demeurent mises en œuvre par le Donneur d'ordre dans les conditions de l'article 2.";
    var pre = { stnom: fullName(curProf()), stNaissance: pf.dateNaissance || '', stNationalite: pf.nationalite || '', stAdresse: pf.adresse || '', stSiret: pf.siret || '', stNda: pf.nda || '', intitule: fc.intitule || '', langue: fc.langue || pf.langue || '', stagiaire: fullName(curEleve()), programme: progPre, mission: missionPre, lieu: lieuLabel(fc) || 'en distanciel (Visioconférence)', dateDebut: fc.dateDebut || '', dateFin: fc.dateFin || '', lieuFait: 'Nice', dateFait: new Date().toLocaleDateString('fr-FR') };
    var intro = '<p class="ds-empty" style="margin:0 0 14px">L\'introduction et l\'article 1 sont préremplis depuis les fiches. Précisez le programme global et la mission (article 1 — seules les heures synchrones sont sous-traitées), puis les modalités financières (article 6).</p>' +
      '<h4 class="gen-h">Sous-traitant (formateur)</h4><div class="gf-grid">' +
      gi('ct-stnom', 'Nom du sous-traitant', pre.stnom) + gi('ct-naissance', 'Né(e) le', pre.stNaissance) +
      gi('ct-nationalite', 'Nationalité', pre.stNationalite) + gi('ct-adresse', 'Adresse', pre.stAdresse) +
      gi('ct-siret', 'SIRET', pre.stSiret) + gi('ct-nda', 'NDA', pre.stNda) + '</div>';
    var art1 = '<h4 class="gen-h">Article 1 — objet</h4><div class="gf-grid">' +
      gi('ct-intitule', 'Formation', pre.intitule) + gi('ct-langue', 'Langue', pre.langue) +
      gi('ct-stagiaire', 'Stagiaire', pre.stagiaire) + gi('ct-lieu', 'Lieu de la formation', pre.lieu) +
      gi('ct-debut', 'Date de début', pre.dateDebut) + gi('ct-fin', 'Date de fin', pre.dateFin) + '</div>' +
      '<div class="gf-grid">' + ga('ct-programme', 'Programme global de l\'action (pour information — ex : 60H00 dont 40h00 synchrones en distanciel, 20H00 Elearning et la certification TOEIC)', pre.programme) +
      ga('ct-mission', 'Mission confiée au Sous-traitant (remplacez …h00 par le volume synchrone)', pre.mission) + '</div>';
    var art6 = '<h4 class="gen-h">Article 6 — modalités financières</h4><div class="gf-grid">' +
      gi('ct-taux', 'Taux horaire HT par heure synchrone (ex : 25,00 €)', '') + gi('ct-montant', 'Montant total HT (ex : 1 000,00 €)', '') + '</div>' +
      '<div class="gf-grid">' + gi('ct-heuressync', 'Volume d\'heures synchrones (ex : 40h00)', '') + '<span></span></div>' +
      '<div class="gf-grid">' + gi('ct-lieufait', 'Fait à', pre.lieuFait) + gi('ct-datefait', 'Le', pre.dateFait) + '</div>';
    var footer = '<label class="gen-chan">Format <select id="ct-format"><option value="pdf">PDF</option><option value="word">Word (.docx)</option></select></label><button class="btn btn-primary ct-gen" type="button" style="padding:11px 22px">Générer le document →</button>';
    var m = buildFsModal('ct-modal', 'Contrat de sous-traitance', intro + art1 + art6, footer);
    m.querySelector('.ct-gen').onclick = function () {
      var fields = { stnom: val('ct-stnom'), stNaissance: val('ct-naissance'), stNationalite: val('ct-nationalite'), stAdresse: val('ct-adresse'), stSiret: val('ct-siret'), stNda: val('ct-nda'), intitule: val('ct-intitule'), langue: val('ct-langue'), stagiaire: val('ct-stagiaire'), programme: val('ct-programme'), mission: val('ct-mission'), lieu: val('ct-lieu'), dateDebut: val('ct-debut'), dateFin: val('ct-fin'), tauxHoraire: val('ct-taux'), montantTotal: val('ct-montant'), heuresSync: val('ct-heuressync'), lieuFait: val('ct-lieufait'), dateFait: val('ct-datefait') };
      downloadDoc(m, '.ct-gen', '/api/contrat/generate', { group: selected, prof: GEN_PROF, fields: fields, format: document.getElementById('ct-format').value }, '7 - Contrat de sous-traitance - ' + (fields.stnom || 'formateur'));
    };
  }

  // ---- Level Test : évaluation orale / questionnaire d'objectifs -----------
  function openLevelTestModal() {
    if (!selected || !CUR_GROUP) return;
    api('/api/leveltest').then(function (r) {
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; }
      var tpl = r.data.tpl || {};
      var fc = clientFiche();
      var pre = { dateEval: new Date().toLocaleDateString('fr-FR'), societe: fc.societe || '', langue: fc.langue || '', nom: ((curEleve()||{}).nom || ''), prenom: ((curEleve()||{}).prenom || ''), tel: fc.tel || '', mail: ((curEleve()||{}).email || '') };
      function fld(id, label, v, multi) { return multi ? '<label class="gf">' + label + '<textarea id="' + id + '" rows="2">' + esc(v || '') + '</textarea></label>' : gi(id, label, v); }
      var head = '<p class="ds-empty" style="margin:0 0 14px">En-tête prérempli depuis la fiche. Complétez l\'évaluation et les besoins, puis générez le document.</p><h4 class="gen-h">En-tête</h4><div class="gf-grid">';
      (tpl.headerRows || []).forEach(function (row) { row.forEach(function (pair) { if (pair) head += fld('lt-' + pair[0], pair[1], pre[pair[0]] || '', pair[0] === 'fonction' || pair[0] === 'planning'); }); });
      head += '</div><div id="lt-extra-wrap"></div><button type="button" class="btn-mini lt-add-field" style="margin-top:4px">+ Ajouter un champ</button>';
      var tfPre = { handicap: 'PAS DE BESOIN SPÉCIFIQUE', objectifs: 'Besoin(s) : \n\nObjectif(s) : ' };
      var tf = '<h4 class="gen-h">Objectifs &amp; profil</h4><div class="gf-grid">' + (tpl.textFields || []).map(function (f) { return ga('lt-' + f.id, f.label, tfPre[f.id] || ''); }).join('') + '</div>';
      var bes = '<h4 class="gen-h">Besoins</h4>' + (tpl.besoins || []).map(function (b) {
        return '<h5 class="lt-cat">' + esc(b.cat) + '</h5><div class="gf-grid">' + b.items.map(function (it) { return fld('lt-' + it.id, it.label || b.cat, '', it.id === 'interets'); }).join('') + '</div>';
      }).join('');
      var ev = [tpl.evalEcrite, tpl.evalOrale].map(function (e) {
        return '<h4 class="gen-h">' + esc(e.titre) + '</h4><div class="gf-grid">' + e.fields.map(function (f) { return gi('lt-' + f[0], f[1], f[2] || ''); }).join('') + '</div>';
      }).join('');
      var footer = '<label class="gen-chan">Format <select id="lt-format"><option value="pdf">PDF</option><option value="word">Word (.docx)</option></select></label><button class="btn btn-primary lt-gen" type="button" style="padding:11px 22px">Générer le document →</button>';
      var m = buildFsModal('lt-modal', tpl.title || 'Level Test', head + tf + bes + ev, footer);
      var addField = function (label, value) {
        var wrap = m.querySelector('#lt-extra-wrap');
        var row = document.createElement('div'); row.className = 'lt-xf';
        row.innerHTML = '<input class="lt-xf-label" placeholder="Nom du champ" /><input class="lt-xf-value" placeholder="Valeur" /><button type="button" class="lt-xf-rm" title="Supprimer ce champ">✕</button>';
        if (label) row.querySelector('.lt-xf-label').value = label;
        if (value) row.querySelector('.lt-xf-value').value = value;
        row.querySelector('.lt-xf-rm').onclick = function () { row.remove(); };
        wrap.appendChild(row); row.querySelector('.lt-xf-label').focus();
      };
      m.querySelector('.lt-add-field').onclick = function () { addField(); };
      m.querySelector('.lt-gen').onclick = function () {
        var fields = {};
        (tpl.headerRows || []).forEach(function (row) { row.forEach(function (pair) { if (pair) fields[pair[0]] = val('lt-' + pair[0]); }); });
        (tpl.textFields || []).forEach(function (f) { fields[f.id] = val('lt-' + f.id); });
        (tpl.besoins || []).forEach(function (b) { b.items.forEach(function (it) { fields[it.id] = val('lt-' + it.id); }); });
        [tpl.evalEcrite, tpl.evalOrale].forEach(function (e) { e.fields.forEach(function (f) { fields[f[0]] = val('lt-' + f[0]); }); });
        var extra = [];
        m.querySelectorAll('.lt-xf').forEach(function (row) { var l = row.querySelector('.lt-xf-label').value.trim(), v = row.querySelector('.lt-xf-value').value.trim(); if (l || v) extra.push({ label: l, value: v }); });
        fields.extraHeader = extra;
        downloadDoc(m, '.lt-gen', '/api/leveltest/generate', { group: selected, fields: fields, format: document.getElementById('lt-format').value }, (ME.role === 'admin' ? '9' : '8') + ' - Level Test - ' + (fields.prenom || fields.nom || 'apprenant'));
      };
    });
  }

  // ---- Feuilles de présence (3 types : e-learning / présentiel-distanciel / test) ----
  // init (facultatif) = feuille DÉJÀ envoyée que l'on rouvre pour modification :
  // { id, type, fields, formateurSig }. Sans init, c'est une nouvelle feuille.
  function openPresenceModal(init) {
    if (!selected || !CUR_GROUP) return;
    api('/api/presence').then(function (r) {
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; }
      var T = r.data.templates || {};
      var fc = clientFiche();
      var moisNow = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); moisNow = moisNow.charAt(0).toUpperCase() + moisNow.slice(1);
      var lieuTxt = (function () { var l = (fc.lieu || '').toLowerCase(); if (l === 'presentiel' || l === 'présentiel') return 'Présentiel'; if (l === 'distanciel') return 'Distanciel'; return ''; })();
      var pre = {
        mois: moisNow, formateur: fullName(curProf()), apprenant: fullName(curEleve()), compte: fc.societe || '',
        // « Ref proposition » et « Formation » viennent de la fiche apprenant
        ref: fc.refProposition || '', formation: fc.intitule || '',
        langue: fc.langue || '', debut: fc.dateDebut || '', fin: fc.dateFin || '', lieu: lieuTxt, ville: '',
        dureePrevue: fc.heuresTotal ? (fc.heuresTotal + (/h/i.test(fc.heuresTotal) ? '' : 'H00')) : '', dateRapport: new Date().toLocaleDateString('fr-FR'),
        heuresPrevues: fc.heuresTotal || ''
      };
      // en modification, ce qui a été RÉELLEMENT saisi et envoyé prime sur la fiche
      var editing = !!(init && init.id);
      if (editing && init.fields) Object.keys(init.fields).forEach(function (k) { if (k !== 'sessions') pre[k] = init.fields[k]; });
      var curType = (editing && init.type) || 'presentiel';
      var sessions = (editing && init.fields && init.fields.sessions) ? init.fields.sessions.map(function (s) { return Object.assign({}, s); }) : [];
      var PR_TIMES = ['0:30', '1:00', '1:30', '2:00', '2:30', '3:00', '3:30', '4:00', '4:30', '5:00', '5:30', '6:00', '6:30', '7:00', '7:30', '8:00', '8:30', '9:00', '9:30', '10:00'];
      function nextSlot() { var used = sessions.map(function (s) { return s.slot; }); for (var i = 0; i < PR_TIMES.length; i++) { if (used.indexOf(PR_TIMES[i]) < 0) return PR_TIMES[i]; } return PR_TIMES[0]; }
      var dyn = '<label class="gen-chan" style="margin-bottom:14px">Type de feuille <select id="pr-type"><option value="elearning">E-learning</option><option value="presentiel">Présentiel / Distanciel</option><option value="test">Test</option></select></label><div id="pr-dyn"></div>' +
        '<div id="pr-sigwrap"><h4 class="gen-h">Votre signature (formateur)</h4><p class="ds-empty" style="margin:0 0 8px">Signez ci-dessous à la souris (ou au doigt), ou téléversez une image de votre signature. L\'apprenant la recevra dans le dossier pour signer à son tour.</p>' + sigPadHTML() + '</div>' +
        '<p class="ds-empty" id="pr-signote" style="display:none;margin:0">Ce document est signé par l\'administration : la signature d\'Antonin HATTABE y est apposée automatiquement. Vous n\'avez pas à signer.</p>';
      var sendLabel = editing ? 'Enregistrer les modifications →' : 'Envoyer à l\'apprenant pour signature →';
      var footer = '<button class="btn btn-primary pr-gen" type="button" style="padding:11px 22px">' + sendLabel + '</button>';
      var m = buildFsModal('pr-modal', editing ? 'Feuille de présence — modification' : 'Feuille de présence', dyn, footer);
      document.getElementById('pr-type').value = curType;
      // en modification, la signature déjà apposée est rechargée dans le pad
      var sigPad = mountSignaturePad(m.querySelector('.sigpad'), editing ? init.formateurSig : null);
      function lieuSelect(id, v) { return '<label class="gf">Lieu<select id="' + id + '"><option value="">—</option><option value="Présentiel"' + (v === 'Présentiel' ? ' selected' : '') + '>Présentiel</option><option value="Distanciel"' + (v === 'Distanciel' ? ' selected' : '') + '>Distanciel</option></select></label>'; }
      function headerHTML(tpl) {
        return '<h4 class="gen-h">En-tête</h4><div class="gf-grid">' + tpl.headerRows.map(function (row) {
          return row.map(function (pair) {
            if (!pair) return '';
            if (pair[0] === 'lieu') return lieuSelect('pr-' + pair[0], pre.lieu);
            // feuille administrative : la ligne « Administratif » porte le nom du président,
            // pas celui du formateur (sauf si l'envoyeur a saisi autre chose lors d'une modification)
            var v = pre[pair[0]] || '';
            if (pair[0] === 'formateur' && tpl.signAdmin && (!editing || !v)) v = 'Antonin HATTABE';
            return gi('pr-' + pair[0], pair[1], v);
          }).join('');
        }).join('') + '</div>';
      }
      function sessionRowHTML(s) {
        s = s || {};
        var opts = PR_TIMES.map(function (t) { return '<option value="' + t + '"' + (s.slot === t ? ' selected' : '') + '>' + t + '</option>'; }).join('');
        return '<div class="pr-sess"><select class="pr-s-slot" title="Créneau (coche la case et place la séance sur cette ligne)">' + opts + '</select><input class="pr-s-date" placeholder="Date" value="' + esc(s.date || '') + '" /><input class="pr-s-jour" placeholder="Jour" value="' + esc(s.jour || '') + '" /><input class="pr-s-hd" placeholder="H début" value="' + esc(s.hDebut || '') + '" /><input class="pr-s-hf" placeholder="H fin" value="' + esc(s.hFin || '') + '" /><input class="pr-s-dur" placeholder="Durée" value="' + esc(s.duree || '') + '" /><button type="button" class="pr-s-rm" title="Supprimer cette séance">✕</button></div>';
      }
      function collectSessions() { sessions = []; m.querySelectorAll('.pr-sess').forEach(function (row) { sessions.push({ slot: row.querySelector('.pr-s-slot').value, date: row.querySelector('.pr-s-date').value, jour: row.querySelector('.pr-s-jour').value, hDebut: row.querySelector('.pr-s-hd').value, hFin: row.querySelector('.pr-s-hf').value, duree: row.querySelector('.pr-s-dur').value }); }); }
      function redrawSessions() { var wrap = document.getElementById('pr-sess-wrap'); wrap.innerHTML = sessions.map(function (s) { return sessionRowHTML(s); }).join(''); wireSessRows(); }
      function wireSessRows() { m.querySelectorAll('.pr-sess .pr-s-rm').forEach(function (b) { b.onclick = function () { var row = b.closest('.pr-sess'); var idx = Array.prototype.slice.call(m.querySelectorAll('.pr-sess')).indexOf(row); collectSessions(); sessions.splice(idx, 1); if (!sessions.length) sessions.push({ slot: nextSlot() }); redrawSessions(); }; }); }
      function render() {
        var tpl = T[curType], html = headerHTML(tpl);
        if (tpl.kind === 'summary') {
          html += '<h4 class="gen-h">Heures &amp; rapport</h4><div class="gf-grid">' + gi('pr-heuresPrevues', "Nombre d'heures prévues", pre.heuresPrevues) + gi('pr-heuresRealisees', "Nombre d'heures connexion réalisées", '') + gi('pr-dateRapport', 'Date du rapport', pre.dateRapport) + '</div>';
        } else {
          html += '<h4 class="gen-h">Séances</h4><div class="pr-sess-head"><span>Créneau</span><span>Date</span><span>Jour</span><span>H début</span><span>H fin</span><span>Durée</span><span></span></div><div id="pr-sess-wrap"></div><button type="button" class="btn-mini pr-add-sess" style="margin-top:8px">+ Ajouter une séance</button><p class="ds-empty" style="margin:10px 0 0">Le <b>créneau</b> coche automatiquement la case correspondante et place la séance sur la bonne ligne de la grille.</p>';
        }
        document.getElementById('pr-dyn').innerHTML = html;
        // feuille administrative : le formateur ne signe pas, la signature d'Antonin est apposée d'office
        var sw = document.getElementById('pr-sigwrap'), sn = document.getElementById('pr-signote');
        if (sw) sw.style.display = tpl.signAdmin ? 'none' : '';
        if (sn) sn.style.display = tpl.signAdmin ? '' : 'none';
        if (tpl.kind === 'grid') { if (!sessions.length) sessions.push({ slot: nextSlot() }); redrawSessions(); m.querySelector('.pr-add-sess').onclick = function () { collectSessions(); sessions.push({ slot: nextSlot() }); redrawSessions(); }; }
      }
      // changer de type ne doit plus effacer la saisie : on mémorise l'en-tête et les séances
      document.getElementById('pr-type').onchange = function () {
        var old = T[curType];
        if (old) old.headerRows.forEach(function (row) { row.forEach(function (pair) { if (pair) { var e = document.getElementById('pr-' + pair[0]); if (e) pre[pair[0]] = e.value; } }); });
        if (old && old.kind === 'grid') collectSessions();
        curType = this.value; render();
      };
      render();
      m.querySelector('.pr-gen').onclick = function () {
        var tpl = T[curType], fields = {};
        // sur une feuille administrative, la signature d'Antonin est apposée d'office : rien à signer
        if (!tpl.signAdmin && sigPad.isEmpty()) { alertDialog('Veuillez signer (ou téléverser votre signature) avant d\'envoyer à l\'apprenant.'); return; }
        tpl.headerRows.forEach(function (row) { row.forEach(function (pair) { if (pair) fields[pair[0]] = val('pr-' + pair[0]); }); });
        if (tpl.kind === 'summary') { fields.heuresPrevues = val('pr-heuresPrevues'); fields.heuresRealisees = val('pr-heuresRealisees'); fields.dateRapport = val('pr-dateRapport'); }
        else {
          collectSessions();
          fields.sessions = sessions.filter(function (s) { return s.date || s.jour || s.hDebut || s.hFin || s.duree; });
          // deux séances sur le même créneau : l'une écraserait l'autre dans la grille
          var vus = {}, dbl = null;
          fields.sessions.forEach(function (s) { if (s.slot) { if (vus[s.slot]) dbl = s.slot; vus[s.slot] = 1; } });
          if (dbl) { alertDialog('Deux séances utilisent le créneau ' + dbl + '. Chaque séance doit avoir un créneau différent, sinon l\'une disparaîtrait du document.'); return; }
        }
        var btn = m.querySelector('.pr-gen'); btn.disabled = true; btn.textContent = editing ? 'Enregistrement…' : 'Envoi…';
        var url = editing ? '/api/presence/' + encodeURIComponent(init.id) + '/update' : '/api/presence/send';
        var body = editing ? { type: curType, fields: fields, formateurSig: sigPad.dataURL() }
          : { group: selected, type: curType, fields: fields, formateurSig: sigPad.dataURL() };
        apiJSON(url, 'POST', body).then(function (rr) {
          if (!rr.ok) { btn.disabled = false; btn.textContent = sendLabel; alertDialog((rr.data && rr.data.error) || 'Erreur'); return; }
          closeFsModal('pr-modal'); channel = 'commun'; renderDashboard();
        });
      };
    });
  }
  // ---- pad de signature réutilisable (dessin souris/tactile + téléversement d'image) ----
  function sigPadHTML() {
    return '<div class="sigpad"><canvas class="sigpad-canvas" width="500" height="160"></canvas><div class="sigpad-tools"><button type="button" class="btn-mini sigpad-clear">Effacer</button><label class="btn-mini sigpad-up">Téléverser une image<input type="file" accept="image/*" class="sigpad-file" hidden /></label></div></div>';
  }
  // initial (facultatif) : data URL d'une signature déjà apposée, rechargée dans le pad
  // (modification d'une feuille envoyée : le formateur ne re-signe pas)
  function mountSignaturePad(container, initial) {
    var canvas = container.querySelector('.sigpad-canvas'), ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#1d2b4a';
    var drawing = false, dirty = false, last = null;
    if (initial && /^data:image\//.test(initial)) {
      var im = new Image();
      im.onload = function () { var s = Math.min(canvas.width / im.width, canvas.height / im.height); var w = im.width * s, h = im.height * s; ctx.drawImage(im, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h); };
      im.src = initial;
      dirty = true;   // une signature existe déjà : l'envoi n'est pas bloqué
    }
    function pos(e) { var r = canvas.getBoundingClientRect(); var t = (e.touches && e.touches[0]) || e; return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) }; }
    function down(e) { drawing = true; last = pos(e); e.preventDefault(); }
    function move(e) { if (!drawing) return; var p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; dirty = true; e.preventDefault(); }
    function up() { drawing = false; }
    canvas.addEventListener('mousedown', down); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: false }); canvas.addEventListener('touchmove', move, { passive: false }); canvas.addEventListener('touchend', up);
    var clearBtn = container.querySelector('.sigpad-clear'); if (clearBtn) clearBtn.onclick = function () { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; };
    var file = container.querySelector('.sigpad-file'); if (file) file.onchange = function () { var f = file.files && file.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { var img = new Image(); img.onload = function () { ctx.clearRect(0, 0, canvas.width, canvas.height); var s = Math.min(canvas.width / img.width, canvas.height / img.height); var w = img.width * s, h = img.height * s; ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h); dirty = true; }; img.src = rd.result; }; rd.readAsDataURL(f); };
    return { isEmpty: function () { return !dirty; }, dataURL: function () { return dirty ? canvas.toDataURL('image/png') : ''; } };
  }
  // Récapitulatif EN LECTURE SEULE du contenu de la feuille : l'apprenant (comme l'envoyeur)
  // doit pouvoir vérifier ce qu'il atteste avant de signer — la signature est irréversible.
  function presenceRecapHTML(p) {
    var f = p.fields || {}, T = PRESENCE_TPL_CACHE || {}, tpl = T[p.type];
    var rows = '';
    if (tpl && tpl.headerRows) {
      rows = tpl.headerRows.map(function (row) {
        return row.map(function (pair) { return pair ? '<div class="pr-rc"><span>' + esc(pair[1]) + '</span><b>' + esc(f[pair[0]] || '—') + '</b></div>' : ''; }).join('');
      }).join('');
    }
    var extra = '';
    if (tpl && tpl.kind === 'summary') {
      extra = '<div class="pr-recap-grid">' +
        '<div class="pr-rc"><span>Nombre d\'heures prévues</span><b>' + esc(f.heuresPrevues || '—') + '</b></div>' +
        '<div class="pr-rc"><span>Heures de connexion réalisées</span><b>' + esc(f.heuresRealisees || '—') + '</b></div>' +
        '<div class="pr-rc"><span>Date du rapport</span><b>' + esc(f.dateRapport || '—') + '</b></div></div>';
    } else if (f.sessions && f.sessions.length) {
      extra = '<table class="pr-recap-tbl"><thead><tr><th>Créneau</th><th>Date</th><th>Jour</th><th>H début</th><th>H fin</th><th>Durée</th></tr></thead><tbody>' +
        f.sessions.map(function (s) {
          return '<tr><td>' + esc(s.slot || '') + '</td><td>' + esc(s.date || '') + '</td><td>' + esc(s.jour || '') + '</td><td>' + esc(s.hDebut || '') + '</td><td>' + esc(s.hFin || '') + '</td><td>' + esc(s.duree || '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    return '<h4 class="gen-h">' + esc(p.title || 'Feuille de présence') + '</h4>' +
      '<div class="pr-recap"><div class="pr-recap-grid">' + rows + '</div>' + extra + '</div>';
  }
  var PRESENCE_TPL_CACHE = null;
  // ---- l'apprenant signe la feuille de présence reçue ----------------------
  function openPresenceSignModal(presenceId) {
    // on charge aussi les modèles : ils décrivent les lignes d'en-tête du récapitulatif
    Promise.all([
      api('/api/presence/' + encodeURIComponent(presenceId)),
      PRESENCE_TPL_CACHE ? Promise.resolve({ ok: true, data: { templates: PRESENCE_TPL_CACHE } }) : api('/api/presence')
    ]).then(function (res) {
      var r = res[0];
      if (res[1] && res[1].ok) PRESENCE_TPL_CACHE = res[1].data.templates || {};
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; }
      var p = r.data.presence || {};
      if (p.status === 'done') { alertDialog('Cette feuille est déjà signée.'); renderDashboard(); return; }
      var body = presenceRecapHTML(p) +
        '<h4 class="gen-h">Votre signature</h4><p class="ds-empty" style="margin:0 0 8px">Vérifiez le contenu ci-dessus, puis signez à la souris (ou au doigt), ou téléversez une image de votre signature.</p>' + sigPadHTML();
      var m = buildFsModal('prsign-modal', 'Signer la feuille de présence', body, '<button class="btn btn-primary prs-send" type="button" style="padding:11px 22px">Envoyer ma signature →</button>');
      var pad = mountSignaturePad(m.querySelector('.sigpad'));
      m.querySelector('.prs-send').onclick = function () {
        if (pad.isEmpty()) { alertDialog('Veuillez signer (ou téléverser votre signature).'); return; }
        confirmDialog({
          title: 'Envoyer votre signature ?',
          message: 'Une fois votre signature envoyée, la feuille de présence sera finalisée et vous ne pourrez plus la modifier.',
          confirm: "Confirmer l'envoi",
          cancel: 'Revenir',
          onConfirm: function () {
            var btn = m.querySelector('.prs-send'); btn.disabled = true; btn.textContent = 'Envoi…';
            apiJSON('/api/presence/' + encodeURIComponent(presenceId) + '/sign', 'POST', { sig: pad.dataURL() }).then(function (rr) {
              if (!rr.ok) { btn.disabled = false; btn.textContent = 'Envoyer ma signature →'; alertDialog((rr.data && rr.data.error) || 'Erreur'); return; }
              closeFsModal('prsign-modal'); renderDashboard();
            });
          }
        });
      };
    });
  }

  // ---- Formulaire auto-rempli par le formateur (téléchargé direct) ---------
  function openFormModal(type) {
    if (!selected || !CUR_GROUP) return;
    api('/api/form/' + encodeURIComponent(type)).then(function (r) {
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; }
      var tpl = r.data.tpl || {};
      var hf = tpl.headerFields || [];
      var fc = clientFiche();
      var pre = { formateur: fullName(curProf()), nomApprenant: fullName(curEleve()), date: fc.dateDebut || new Date().toLocaleDateString('fr-FR'), langue: fc.langue || '', intitule: fc.intitule || '' };
      var headerHTML = '<p class="ds-empty" style="margin:0 0 14px">Renseignez l\'en-tête et cochez vos réponses, puis générez le document à télécharger (à transmettre ensuite à l\'administration via le canal privé).</p>' +
        '<div class="gf-grid">' + hf.map(function (f) { return gi('fm-h-' + f.id, f.label, pre[f.id] || ''); }).join('') + '</div>';
      var footer = '<label class="gen-chan">Format <select id="fm-format"><option value="pdf">PDF</option><option value="word">Word (.docx)</option></select></label>' +
        '<button class="btn btn-primary fm-gen" type="button" style="padding:11px 22px">Générer le document →</button>';
      var m = buildFsModal('fm-modal', tpl.title || 'Document', headerHTML + qsItemsHTML(tpl.items || [], {}), footer);
      wireQsConditional(m);
      m.querySelector('.fm-gen').onclick = function () {
        var header = {}; hf.forEach(function (f) { header[f.id] = val('fm-h-' + f.id); });
        var answers = {};
        (tpl.items || []).forEach(function (it) {
          if (it.type === 'radio' || it.type === 'scale') { var sel = m.querySelector('input[name="' + it.id + '"]:checked'); if (sel) answers[it.id] = sel.value; }
          if (it.type === 'text') { var t = m.querySelector('textarea[data-t="' + it.id + '"]'); if (t) answers[it.id] = t.value; }
          if (it.comment) { var c = m.querySelector('textarea[data-c="' + it.id + '"]'); if (c && c.value) answers[it.id + '_c'] = c.value; }
        });
        var fmt = document.getElementById('fm-format').value;
        var btn = m.querySelector('.fm-gen'); btn.disabled = true; btn.textContent = 'Génération…';
        fetch('/api/form/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify({ group: selected, type: type, header: header, answers: answers, format: fmt }) })
          .then(function (rr) { if (!rr.ok) return rr.json().then(function (j) { throw new Error(j.error || 'Erreur'); }); return rr.blob(); })
          .then(function (blob) {
            var ext = fmt === 'word' ? 'docx' : 'pdf';
            var nm = (ME.role === 'admin' ? '8' : '7') + ' - ' + (tpl.title || 'Document') + ' - ' + (header.nomApprenant || 'apprenant') + ' - ' + new Date().toLocaleDateString('fr-FR').replace(/\//g, '-') + '.' + ext;
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = nm; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
            btn.disabled = false; btn.textContent = 'Document généré ✓ — re-générer';
            setTimeout(function () { btn.textContent = 'Générer le document →'; }, 3000);
          })
          .catch(function (e) { btn.disabled = false; btn.textContent = 'Générer le document →'; alertDialog(e.message || 'Génération impossible.'); });
      };
    });
  }

  // ---- QS : l'apprenant remplit et génère le document ----------------------
  function qsItemsHTML(items, answers) {
    return items.map(function (it) {
      if (it.type === 'intro') return '<p class="qs-intro">' + esc(it.text) + '</p>';
      if (it.type === 'section') return '<h4 class="gen-h">' + esc(it.label) + '</h4>';
      var head = '<div class="qs-q"><div class="qs-label">' + esc(it.label) + '</div>';
      if (it.type === 'text') return head + '<textarea class="qs-text" data-t="' + it.id + '" rows="3">' + esc(answers[it.id] || '') + '</textarea></div>';
      var opts; if (it.type === 'scale') { opts = []; for (var n = 1; n <= 10; n++) opts.push(String(n)); } else opts = it.options || [];
      var optsHTML = '<div class="qs-opts' + (it.type === 'scale' ? ' qs-scale' : '') + '">' + opts.map(function (o) {
        return '<label class="qs-opt"><input type="radio" name="' + it.id + '" value="' + esc(o) + '"' + (answers[it.id] === o ? ' checked' : '') + '/> ' + esc(o) + '</label>';
      }).join('') + '</div>';
      var comment = '';
      if (it.comment) {
        var cif = it.commentIf || '';
        var show = cif ? (answers[it.id] === cif) : true;
        comment = '<textarea class="qs-comment" data-c="' + it.id + '"' + (cif ? ' data-cif="' + esc(cif) + '"' : '') + ' placeholder="' + esc(it.comment) + '" rows="2"' + (show ? '' : ' style="display:none"') + '>' + esc(answers[it.id + '_c'] || '') + '</textarea>';
      }
      return head + optsHTML + comment + '</div>';
    }).join('');
  }
  // affiche/masque le commentaire conditionnel (data-cif) selon l'option cochée
  function wireQsConditional(m) {
    m.querySelectorAll('textarea.qs-comment[data-cif]').forEach(function (ta) {
      var id = ta.getAttribute('data-c'), cif = ta.getAttribute('data-cif');
      m.querySelectorAll('input[name="' + id + '"]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var sel = m.querySelector('input[name="' + id + '"]:checked');
          var on = !!sel && sel.value === cif;
          ta.style.display = on ? '' : 'none';
          if (!on) ta.value = '';
        });
      });
    });
  }
  function syncQsAnswers() {
    var a = {};
    qsFillState.items.forEach(function (it) {
      if (it.type === 'radio' || it.type === 'scale') { var sel = document.querySelector('input[name="' + it.id + '"]:checked'); if (sel) a[it.id] = sel.value; }
      if (it.type === 'text') { var t = document.querySelector('textarea[data-t="' + it.id + '"]'); if (t) a[it.id] = t.value; }
      if (it.comment) { var c = document.querySelector('textarea[data-c="' + it.id + '"]'); if (c && c.value) a[it.id + '_c'] = c.value; }
    });
    qsFillState.answers = a;
  }
  function openQsFillModal(qsId) {
    api('/api/qs/' + encodeURIComponent(qsId)).then(function (r) {
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; }
      var q = r.data.qs;
      if (q.status === 'done') { alertDialog('Ce questionnaire a déjà été envoyé.'); return; }
      qsFillState = { id: qsId, items: q.items || [], answers: Object.assign({}, q.answers || {}) };
      var recap = '<div class="qs-recap">' + (q.headerFields || []).map(function (f) { return '<span><b>' + esc(f.label) + ' :</b> ' + esc(q.header[f.id] || '—') + '</span>'; }).join('') + '</div>';
      var footer = '<button class="btn btn-primary qs-submit" type="button" style="padding:11px 22px">Envoyer votre réponse →</button>';
      var m = buildFsModal('qsf-modal', q.title || 'Questionnaire', recap + qsItemsHTML(qsFillState.items, qsFillState.answers), footer);
      wireQsConditional(m);
      m.querySelector('.qs-submit').onclick = function () {
        syncQsAnswers();
        confirmDialog({
          title: 'Envoyer le questionnaire ?',
          message: 'Une fois envoyé, vous ne pourrez plus revenir sur vos réponses ni les modifier.',
          confirm: "Confirmer l'envoi",
          cancel: 'Continuer à répondre',
          onConfirm: function () {
            var btn = m.querySelector('.qs-submit'); btn.disabled = true; btn.textContent = 'Envoi…';
            apiJSON('/api/qs/' + encodeURIComponent(qsId) + '/submit', 'POST', { answers: qsFillState.answers, format: 'pdf' }).then(function (rr) {
              btn.disabled = false; btn.textContent = 'Envoyer votre réponse →';
              if (!rr.ok) { alertDialog((rr.data && rr.data.error) || 'Erreur'); return; }
              closeFsModal('qsf-modal'); renderDashboard();
            });
          }
        });
      };
    });
  }

  // ==========================================================================
  //  VISITE GUIDÉE de l'espace documents — formateurs et apprenants uniquement.
  //
  //  Deux règles ont dicté la construction :
  //  1. La visite MONTRE, mais ne consomme rien. Les étapes qui parlent de l'intérieur d'un
  //     dossier en ouvrent un (`ouvrirDossier`) pour que leur ancre existe — en écrivant
  //     `selected` et en appelant renderDashboard(), JAMAIS en cliquant sur le dossier : le
  //     gestionnaire de clic envoie clear-group et effacerait vraiment les notifications non
  //     lues. Le seul appel réseau propre à la visite reste POST /api/tuto/vu, une fois.
  //  2. AUCUNE étape n'est jamais supprimée. Sur un compte tout neuf — le cas normal d'une
  //     première connexion — le tableau de bord est presque vide et la moitié des ancres n'existe
  //     pas. Ancre absente ou non montrable : le projecteur s'éteint, la carte se centre, le texte
  //     et le numéro d'étape ne changent pas. Une étape qui saute, c'est une explication perdue.
  // ==========================================================================
  var TUTO_BIENVENUE = {
    ancre: '.ds-top',
    titre: 'Bienvenue dans votre espace documents',
    paras: ['Cet espace réunit vos dossiers de formation, les documents et les échanges qui vont avec. La visite prend deux minutes, et le bouton Revoir la visite guidée, en haut de cette page, la relance quand vous voulez.']
  };
  var TUTO_NOTIFS = {
    ancre: '.ds-card-notifs',
    titre: 'Ne rien manquer',
    paras: ['Chaque message et chaque document reçu crée une notification, reprise par la cloche en haut de page, qui se met à jour sans recharger. Un dossier dans lequel quelque chose vous attend porte une pastille colorée dans la case Mes dossiers, et l\'ouvrir efface ses notifications.']
  };
  var TUTO_REVOIR = {
    ancre: '.tuto-replay',
    titre: 'Revoir cette visite quand vous voulez',
    paras: ['Ce bouton relance la visite guidée en entier, à tout moment, sans rien changer à vos dossiers. Bonne formation.']
  };
  var TUTO_PROF = [
    TUTO_BIENVENUE,
    { ancre: '.ds-card-dossiers', titre: 'Tout est rangé par dossier', paras: [
      'Un dossier suit un apprenant et réunit ses formateurs et l\'administration. C\'est l\'administration qui crée les dossiers et décide qui y figure. Ceux qui vous sont confiés sont listés dans la case Mes dossiers, et un clic sur l\'un d\'eux ouvre ses documents et sa messagerie.',
      'Si la liste est encore vide, aucun dossier ne vous a été confié pour l\'instant. Vous recevrez une notification dès qu\'un dossier vous sera attribué.'
    ] },
    { ancre: '.chan-tabs', titre: 'Deux canaux, deux publics', ouvrirDossier: true, paras: [
      'Tout ce qui suit se trouve à l\'intérieur d\'un dossier : dans la case Mes dossiers, cliquez sur un dossier pour l\'ouvrir.',
      'Chaque dossier a deux canaux. La discussion commune est partagée avec l\'apprenant. Le canal privé est réservé aux formateurs du dossier et à l\'administration : l\'apprenant n\'y a accès ni en lecture, ni en téléchargement, et c\'est par là que vous transmettez vos documents à l\'administration.',
      'Un formateur ajouté plus tard au dossier accède à tout l\'historique déjà échangé dans le canal privé.'
    ] },
    { ancre: '.upload-zone', titre: 'Déposer un document, écrire un message', ouvrirDossier: true, paras: [
      'Tout ce qui suit se trouve à l\'intérieur d\'un dossier : dans la case Mes dossiers, cliquez sur un dossier pour l\'ouvrir.',
      'La zone de dépôt accepte un fichier de 25 Mo au maximum, la liste des documents s\'affiche en dessous, et la messagerie du dossier se trouve encore plus bas.',
      'Le canal ouvert au moment de l\'envoi décide qui verra le fichier ou le message : vérifiez l\'onglet avant d\'envoyer. Vous pouvez retirer un document que vous avez envoyé vous-même, mais pas celui d\'une autre personne, ni une pièce déjà signée.'
    ] },
    { ancre: '.gen-btn', titre: 'Générer un document', ouvrirDossier: true, paras: [
      'Tout ce qui suit se trouve à l\'intérieur d\'un dossier : dans la case Mes dossiers, cliquez sur un dossier pour l\'ouvrir.',
      'Le bouton Générer un document, en haut du dossier, ouvre la liste des modèles : Interactive Worksheet, questionnaires de satisfaction, tests de mi-parcours et de fin, attestation de fin de formation, fiche satisfaction formateur, Level Test et feuilles de présence. Son onglet Historique des documents liste tout ce qui a déjà été produit dans le dossier.',
      'L\'intitulé, la langue, les dates, la société et les coordonnées sont repris de la fiche de l\'apprenant à l\'ouverture du formulaire. Si un champ arrive vide, c\'est que la fiche est incomplète : demandez à l\'administration de la compléter plutôt que de ressaisir la même information sur chaque document.',
      'L\'Interactive Worksheet garde un brouillon par dossier, que tous ses formateurs retrouvent et complètent ; les autres modèles repartent d\'un formulaire vierge. La plupart produisent un fichier téléchargé directement sur votre ordinateur, sans passer par le dossier, et toujours rédigé en français, même lorsque le site est affiché dans une autre langue.'
    ] },
    { ancre: 'centre', titre: 'Questionnaires et feuilles de présence', paras: [
      'Les questionnaires de satisfaction et les feuilles de présence ne se téléchargent pas : ils partent chez l\'apprenant. Une carte apparaît dans la discussion commune, avec une notification et un e-mail. Une fois le questionnaire rempli ou la feuille signée, le document final est déposé tout seul dans la discussion commune.',
      'Sur une feuille présentiel ou distanciel, vous signez avant d\'envoyer : tant que votre signature manque, l\'envoi est refusé. Sur le suivi d\'assiduité et sur la feuille Test, c\'est l\'administration qui signe, vous n\'avez rien à signer. Tant que l\'apprenant n\'a pas répondu, la carte affichée dans la discussion permet de modifier ou d\'annuler la demande.'
    ] },
    TUTO_NOTIFS,
    TUTO_REVOIR
  ];
  var TUTO_ELEVE = [
    TUTO_BIENVENUE,
    { ancre: '.ds-card-dossiers', titre: 'Votre dossier', paras: [
      'Votre formation est suivie dans un dossier créé par l\'administration, qui réunit vos formateurs et l\'administration Languages and Success. Il apparaît dans la case Mes dossiers, sous le nom de vos formateurs, et un clic dessus ouvre ses documents et sa messagerie.',
      'Si la liste est encore vide, votre dossier n\'a pas encore été créé. Vous recevrez une notification dès qu\'il sera prêt.'
    ] },
    { ancre: '.upload-zone', titre: 'Vos documents et la messagerie', ouvrirDossier: true, paras: [
      'Tout ce qui suit se trouve à l\'intérieur d\'un dossier : dans la case Mes dossiers, cliquez sur un dossier pour l\'ouvrir.',
      'Les documents de votre formation s\'affichent sous la zone de dépôt, avec un bouton pour les télécharger. Pour envoyer un fichier à vos formateurs, cliquez sur la zone de dépôt et choisissez un fichier de 25 Mo au maximum.',
      'Un document que vous avez envoyé ne peut plus être retiré que par l\'administration : vérifiez le fichier avant de l\'envoyer. La messagerie du dossier, sous la liste des documents, sert à échanger avec vos formateurs et l\'administration.'
    ] },
    // ⚠️ ancré sur le CONTENEUR de la discussion, jamais sur un bouton « Remplir »/« Signer » :
    // ceux-là n'existent que s'il y a une demande en attente, et ils vivent dans un cadre à
    // défilement (max-height:300px) forcé au bas — un halo s'y dessinerait sur du vide.
    { ancre: '#chat-msgs', titre: 'Questionnaires et feuilles à signer', ouvrirDossier: true, paras: [
      'Lorsqu\'un formateur vous envoie un questionnaire de satisfaction ou une feuille de présence, une carte apparaît dans la discussion du dossier, avec un bouton pour la remplir ou la signer. Vous en êtes averti par une notification et par un e-mail.',
      'Avant de signer une feuille de présence, relisez le récapitulatif affiché au-dessus de la signature : les séances, ou les heures de connexion selon la feuille. Vous signez à la souris ou au doigt, ou vous téléversez une image de votre signature.',
      'L\'envoi est définitif : une fois confirmé, vous ne pouvez plus revenir sur vos réponses ni sur votre signature. Le document final est aussitôt déposé dans le dossier.'
    ] },
    TUTO_NOTIFS,
    TUTO_REVOIR
  ];

  var TUTO_ETAPES = [], TUTO_I = 0, TUTO_RAF = null, TUTO_RETOUR = null, TUTO_OBS = null, TUTO_ANIM = null;
  // rappel exécuté dès que le tableau de bord est repeint : renderDashboard() est asynchrone
  // (4 requêtes avant la peinture), on ne peut pas mesurer une ancre juste après l'avoir appelé
  var TUTO_ATTENTE = null;

  // Les étapes marquées `ouvrirDossier` parlent de ce qui vit À L'INTÉRIEUR d'un dossier : sans
  // dossier ouvert, leurs ancres n'existent pas. On en ouvre donc un pour le montrer.
  // ⚠️ On écrit `selected` et on appelle renderDashboard() — on ne CLIQUE PAS sur le dossier :
  // le gestionnaire de clic envoie POST /api/notifications/clear-group, ce qui effacerait pour
  // de bon les notifications non lues de la personne au milieu de sa visite.
  function tutoOuvrirDossier() {
    if (selected) return false;
    var li = document.querySelector('.contact');
    if (!li) return false;                       // aucun dossier : l'étape restera centrée
    selected = li.getAttribute('data-id');
    channel = 'commun';
    return true;
  }

  function tutoEl() { return document.getElementById('tuto'); }
  // Le calque est créé UNE fois et vit sur document.body, jamais dans #docspace qui est
  // intégralement reconstruit (el.innerHTML = …) par une vingtaine d'appelants.
  // ⚠️ enfant direct de body : un position:fixed se recale sur tout ancêtre portant transform.
  function ensureTuto() {
    var m = tutoEl(); if (m) return m;
    m = document.createElement('div');
    m.id = 'tuto'; m.className = 'tuto';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'tuto-title');
    m.innerHTML = '<div class="tuto-catch"></div><div class="tuto-spot off" aria-hidden="true"></div>' +
      '<div class="tuto-card centre" tabindex="-1">' +
        '<button type="button" class="nm-close tuto-close" aria-label="Fermer">&times;</button>' +
        '<p class="tuto-eyebrow">Visite guidée</p>' +
        '<div class="tuto-txt" aria-live="polite"><h3 id="tuto-title"></h3></div>' +
        '<div class="tuto-dots" aria-hidden="true"></div>' +
        '<div class="tuto-foot">' +
          '<button type="button" class="btn btn-ghost tuto-skip">Passer la visite</button>' +
          '<button type="button" class="btn btn-ghost tuto-prev">← Revenir</button>' +
          '<button type="button" class="btn btn-primary tuto-next">Continuer →</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    m.querySelector('.tuto-close').onclick = fermerTuto;
    m.querySelector('.tuto-skip').onclick = fermerTuto;
    m.querySelector('.tuto-prev').onclick = function () { allerTuto(TUTO_I - 1); };
    m.querySelector('.tuto-next').onclick = function () { if (TUTO_I >= TUTO_ETAPES.length - 1) fermerTuto(); else allerTuto(TUTO_I + 1); };
    // ⚠️ un clic sur le fond ne ferme PAS (contrairement aux autres modales du site) : une
    // fermeture accidentelle consommerait la première connexion, qui ne revient jamais.
    return m;
  }

  // La cible est-elle réellement MONTRABLE ? Retourne son rectangle, ou null (→ carte centrée).
  function tutoCible(sel) {
    if (!sel || sel === 'centre') return null;
    var t = document.querySelector(sel);
    if (!t || !t.offsetParent) return null;                       // absente ou display:none
    var r = t.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
    if (r.width < 8 || r.height < 8) return null;
    if (r.height > vh * 0.6 || (r.width * r.height) > vw * vh * 0.6) return null;  // trop grande : le trou ne désignerait rien
    if (r.bottom < 8 || r.top > vh - 8) return null;              // hors écran
    if (Math.max(r.top, vh - r.bottom) < 200) return null;        // pas la place de poser la carte sans recouvrir la cible
    // rognage par un ancêtre à défilement (le cadre de la discussion, par exemple).
    // ⚠️ on s'arrête AVANT body, qui porte overflow-x:hidden et rendrait tout le monde inéligible.
    var p = t.parentElement;
    while (p && p !== document.body) {
      var st = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(st.overflowX + ' ' + st.overflowY)) {
        var pr = p.getBoundingClientRect();
        if (r.bottom > pr.bottom + 1 || r.top < pr.top - 1 || r.right > pr.right + 1 || r.left < pr.left - 1) return null;
      }
      p = p.parentElement;
    }
    return { r: r, el: t };
  }

  // Dessin du projecteur. Le sélecteur est RE-RÉSOLU à chaque appel, aucune référence de nœud
  // n'est conservée — c'est ce qui absorbe sans une ligne de synchronisation la reconstruction
  // complète du tableau de bord, l'allongement des textes par la traduction, et le remplacement
  // de l'en-tête. Retourne la cible retenue, ou null.
  function tutoDessiner() {
    var m = tutoEl(); if (!m) return null;
    var spot = m.querySelector('.tuto-spot'), e = TUTO_ETAPES[TUTO_I], c = e ? tutoCible(e.ancre) : null;
    // sans projecteur, c'est .tuto-catch qui assombrit l'écran (même teinte) — sinon on verrait
    // le tableau de bord en pleine lumière derrière une carte flottante
    m.classList.toggle('sans-spot', !c);
    if (!c) spot.classList.add('off');
    else {
      spot.classList.remove('off');
      spot.style.top = (c.r.top - 8) + 'px'; spot.style.left = (c.r.left - 8) + 'px';
      spot.style.width = (c.r.width + 16) + 'px'; spot.style.height = (c.r.height + 16) + 'px';
      spot.style.borderRadius = (getComputedStyle(c.el).borderRadius || '12px');
    }
    return c;
  }
  // ⚠️ Le dessin doit être fait une première fois de façon SYNCHRONE (cf. tutoPlacer) et pas
  // seulement par cette boucle : requestAnimationFrame ne s'exécute pas dans un onglet en
  // arrière-plan, le projecteur y resterait éteint pour toute la visite.
  function tutoSuivre() {
    var m = tutoEl(); if (!m || !m.classList.contains('open')) { TUTO_RAF = null; return; }
    tutoDessiner();
    TUTO_RAF = requestAnimationFrame(tutoSuivre);
  }

  // Placement de la carte : au changement d'étape et au redimensionnement SEULEMENT — jamais dans
  // la boucle, sinon la carte scintillerait à chaque image.
  function tutoPlacer() {
    var m = tutoEl(); if (!m) return;
    var card = m.querySelector('.tuto-card'), spot = m.querySelector('.tuto-spot');
    var e = TUTO_ETAPES[TUTO_I];
    // on déverrouille le temps de recentrer la cible, puis on reverrouille
    document.documentElement.classList.remove('tuto-lock');
    var t = (e && e.ancre !== 'centre') ? document.querySelector(e.ancre) : null;
    // ⚠️ block:'center' et non 'start' : l'en-tête du site est fixe et recouvrirait la cible.
    // ⚠️ behavior:'auto' : html{scroll-behavior:smooth} ferait sinon mesurer un état intermédiaire.
    if (t) { try { t.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }); } catch (x) { t.scrollIntoView(); } }
    document.documentElement.classList.add('tuto-lock');

    var c = tutoDessiner();          // dessin synchrone : ne dépend pas de la boucle d'animation
    card.style.maxHeight = '';
    if (!c) { card.className = 'tuto-card centre'; }
    else {
      var haut = c.r.top, bas = window.innerHeight - c.r.bottom;
      card.className = 'tuto-card ' + (bas >= haut ? 'bas' : 'haut');
      card.style.maxHeight = (Math.max(haut, bas) - 24) + 'px';
    }
    // la transition n'existe QUE le temps du changement d'étape : laissée en permanence, le halo
    // traînerait derrière sa cible pendant tout le suivi image par image.
    spot.classList.add('anim');
    if (TUTO_ANIM) clearTimeout(TUTO_ANIM);
    TUTO_ANIM = setTimeout(function () { var s = tutoEl(); if (s) s.querySelector('.tuto-spot').classList.remove('anim'); }, 400);
  }

  function allerTuto(i) {
    var m = ensureTuto(), e;
    TUTO_I = Math.max(0, Math.min(i, TUTO_ETAPES.length - 1));
    e = TUTO_ETAPES[TUTO_I];
    var txt = m.querySelector('.tuto-txt');
    // on REMPLACE les nœuds texte (textContent) : c'est ce qui déclenche l'observateur du moteur
    // de traduction, qui ne surveille que les nœuds ajoutés.
    txt.innerHTML = '<h3 id="tuto-title"></h3>';
    txt.querySelector('h3').textContent = e.titre;
    e.paras.forEach(function (p) { var el = document.createElement('p'); el.textContent = p; txt.appendChild(el); });
    txt.scrollTop = 0;

    var dots = m.querySelector('.tuto-dots'); dots.innerHTML = '';
    TUTO_ETAPES.forEach(function (x, k) { var d = document.createElement('i'); d.className = 'tuto-dot' + (k === TUTO_I ? ' on' : ''); dots.appendChild(d); });

    var dernier = TUTO_I >= TUTO_ETAPES.length - 1;
    m.querySelector('.tuto-prev').hidden = TUTO_I === 0;
    m.querySelector('.tuto-skip').hidden = dernier;
    m.querySelector('.tuto-next').textContent = dernier ? 'Terminer' : 'Continuer →';
    // le texte est déjà à l'écran ; s'il faut ouvrir un dossier, on attend la peinture pour
    // mesurer l'ancre, sinon on placerait la carte d'après un tableau de bord qui va changer
    if (e.ouvrirDossier && tutoOuvrirDossier()) {
      TUTO_ATTENTE = tutoPlacer;
      renderDashboard();
      return;
    }
    tutoPlacer();
  }

  function tutoBoutons() {
    var m = tutoEl(); if (!m) return [];
    return ['.tuto-close', '.tuto-skip', '.tuto-prev', '.tuto-next'].map(function (s) { return m.querySelector(s); })
      .filter(function (b) { return b && !b.hidden; });
  }
  // ⚠️ écouteur en CAPTURE : trois écouteurs Échap coexistent en phase bouillonnante sur document,
  // dont closeNotifModal qui relance un renderDashboard() complet SANS vérifier qu'une modale est
  // ouverte. Un simple stopPropagation() ne suffirait pas.
  function tutoClavier(ev) {
    if (!tutoEl() || !tutoEl().classList.contains('open')) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); fermerTuto(); return; }
    if (ev.key !== 'Tab') return;
    // piège de focus : sans lui, deux tabulations amènent sur « Se déconnecter », invisible sous
    // l'ombre — et Entrée déconnecte la personne au milieu de sa visite.
    var b = tutoBoutons(); if (!b.length) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    var i = b.indexOf(document.activeElement);
    i = ev.shiftKey ? (i <= 0 ? b.length - 1 : i - 1) : (i < 0 || i >= b.length - 1 ? 0 : i + 1);
    b[i].focus();
  }
  function tutoResize() { if (tutoEl() && tutoEl().classList.contains('open')) requestAnimationFrame(tutoPlacer); }

  function ouvrirTuto() {
    if (!ME || ME.role === 'admin') return;
    TUTO_ATTENTE = null;
    TUTO_ETAPES = (ME.role === 'prof') ? TUTO_PROF : TUTO_ELEVE;
    // un dialogue du site est ouvert (z-index 1300) : le calque (1400) le masquerait
    if (document.querySelector('.notif-modal.open')) return;
    var m = ensureTuto();
    if (m.classList.contains('open')) return;
    closeMobileMenu();
    TUTO_RETOUR = document.activeElement;
    // une navigation douce encore en cours (afterAuth) continuerait à faire défiler la page
    // sous le calque : on l'arrête net avant de verrouiller.
    try { window.scrollTo({ top: window.scrollY, behavior: 'auto' }); } catch (x) {}
    m.classList.add('open');
    document.documentElement.classList.add('tuto-lock');
    document.addEventListener('keydown', tutoClavier, true);
    window.addEventListener('resize', tutoResize);
    window.addEventListener('orientationchange', tutoResize);
    // Un confirmDialog ou un alertDialog (z-index 1300) resterait INVISIBLE sous le calque (1400)
    // et son Échap serait avalé par la capture : dès qu'il en apparaît un, la visite s'efface.
    TUTO_OBS = new MutationObserver(function (muts) {
      for (var a = 0; a < muts.length; a++) {
        for (var b = 0; b < muts[a].addedNodes.length; b++) {
          var n = muts[a].addedNodes[b];
          if (n.nodeType === 1 && n.classList && n.classList.contains('confirm-modal')) { fermerTuto(); return; }
        }
      }
    });
    TUTO_OBS.observe(document.body, { childList: true });
    allerTuto(0);
    m.querySelector('.tuto-card').focus();
    if (!TUTO_RAF) TUTO_RAF = requestAnimationFrame(tutoSuivre);
  }

  function fermerTuto() {
    var m = tutoEl(); if (!m || !m.classList.contains('open')) return;
    m.classList.remove('open');
    document.documentElement.classList.remove('tuto-lock');
    document.removeEventListener('keydown', tutoClavier, true);
    window.removeEventListener('resize', tutoResize);
    window.removeEventListener('orientationchange', tutoResize);
    if (TUTO_OBS) { TUTO_OBS.disconnect(); TUTO_OBS = null; }
    TUTO_ATTENTE = null;   // une peinture en vol ne doit pas replacer une carte refermée
    if (TUTO_RAF) { cancelAnimationFrame(TUTO_RAF); TUTO_RAF = null; }
    if (TUTO_ANIM) { clearTimeout(TUTO_ANIM); TUTO_ANIM = null; }
    // On retient « vue » à la PREMIÈRE sortie, quelle qu'elle soit (Terminer, Passer, croix,
    // Échap) : quelqu'un qui ferme au premier écran a décidé, on ne le relance pas à chaque visite.
    // Le drapeau local sert d'anti-double-envoi ; l'appel ne bloque rien et son échec est sans effet
    // (la visite se rejouera simplement à la connexion suivante).
    // ⚠️ on envoie l'identité : le jeton est relu dans localStorage au moment de l'appel, or il
    // est PARTAGÉ entre les onglets. Un second onglet qui se connecte sous un autre compte ferait
    // sinon enregistrer « visite vue » chez cette autre personne.
    if (ME && ME.tutoAVoir) { var moi = ME.id; ME.tutoAVoir = false; apiJSON('/api/tuto/vu', 'POST', { user: moi }); }
    var r = TUTO_RETOUR; TUTO_RETOUR = null;
    if (r && r !== document.body && document.contains(r) && r.focus) r.focus();
    // ⚠️ le repli doit viser un élément RÉELLEMENT focusable : appeler focus() sur <body> ne
    // déplace rien, et le focus resterait sur la carte, désormais invisible — quelqu'un au
    // clavier se retrouverait à taper dans le vide.
    if (m.contains(document.activeElement)) {
      var rb = document.querySelector('.tuto-replay');
      if (rb) rb.focus(); else if (document.activeElement.blur) document.activeElement.blur();
    }
  }

  boot();
})();
