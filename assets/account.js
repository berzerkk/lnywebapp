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

  var ME = null, NOTIFS = [], selected = null, channel = 'commun', authTab = 'login', genState = null, ADD_CANDIDATES = [];
  var adminShow = { dossiers: true, comptes: true, fichiers: true }, adminQuery = '', ADMIN_OVERVIEW = null;
  var CUR_GROUP = null, qsFillState = null, notifTimer = null, DEMO = null;
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function fmtSize(b) { if (b < 1024) return b + ' o'; if (b < 1048576) return (b / 1024).toFixed(0) + ' Ko'; return (b / 1048576).toFixed(1) + ' Mo'; }
  function fmtDate(t) { var d = new Date(t); return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  function fmtTime(t) { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  function fullName(u) { return u ? (u.prenom + ' ' + (u.nom || '')).trim() : '—'; }
  function initials(name) { var p = (name || '').trim().split(/\s+/); return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || ''); }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function err(id, msg) { var el = document.getElementById(id); if (el) el.textContent = msg; }
  // seul le formateur constitue un dossier depuis son espace (l'apprenant ne le fait plus :
  // c'est l'administration ou le formateur qui l'ajoute)
  function roleAllowed(me, o) { return me.role === 'prof' && o.role === 'eleve'; }
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
    if (!token()) { ME = null; renderHeader(); if (app()) renderAuth(); return; }
    api('/api/me').then(function (r) {
      if (!r.ok) { setToken(null); ME = null; renderHeader(); if (app()) renderAuth(); return; }
      ME = r.data.user;
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
  function collectProfile(role) {
    if (role === 'eleve') return { tel: val('su-tel'), societe: val('su-societe'), heuresTotal: val('su-heures'), heuresDetail: val('su-heures-detail'), intitule: val('su-intitule'), langue: val('su-langue'), dateDebut: val('su-date-debut'), dateFin: val('su-date-fin'), lieu: val('su-lieu'), lieuAdresse: val('su-lieu-adresse'), certification: val('su-certif'), certificationText: val('su-certif-text') };
    if (role === 'prof') return { langue: val('su-p-langue'), siret: val('su-siret'), nda: val('su-nda'), adresse: val('su-adresse'), tel: val('su-p-tel'), dateNaissance: val('su-naissance'), nationalite: val('su-nationalite') };
    return {};
  }
  function afterAuth() { api('/api/notifications').then(function (n) { NOTIFS = (n.ok && n.data.notifs) || []; renderHeader(); renderDashboard(); startNotifPoll(); window.scrollTo({ top: 0, behavior: 'smooth' }); }); }
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
      '<div class="row2">' + pwdField('su-pwd', 'Mot de passe') + pwdField('su-pwd2', 'Confirmer le mot de passe') + '</div>' +
      '<div class="field"><label for="su-role">Type de compte</label><select id="su-role" name="role"><option value="eleve">Apprenant</option><option value="prof">Formateur</option></select></div>' +
      '<div id="su-eleve-fields" class="su-profile"><h4 class="su-fiche-h">Fiche apprenant</h4>' +
        '<div class="row2">' + ofield('su-tel', 'Téléphone', 'tel') + ofield('su-societe', 'Société', 'text') + '</div>' +
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
    return '<div class="ds-top"><div class="ds-id"><span class="ds-hi">Bonjour ' + esc(ME.prenom) + ' ' + esc(ME.nom) + '</span>' +
      '<span class="role-chip role-' + ME.role + '">' + ROLES[ME.role] + '</span></div><button class="btn btn-ghost ds-logout">Se déconnecter</button></div>';
  }
  function notifCardHTML(unread) {
    return '<div class="ds-card"><div class="ds-card-h"><h3>Notifications' + (unread ? ' <span class="mini-badge">' + unread + '</span>' : '') + '</h3>' +
      (NOTIFS.length ? '<button class="link-btn ds-seeall">Voir tout</button>' : '') + '</div>' +
      '<p class="ds-empty" style="margin:0">' + (NOTIFS.length ? (unread ? unread + (unread > 1 ? ' notifications non lues' : ' notification non lue') : 'Tout est lu.') : 'Aucune notification pour le moment.') + '</p></div>';
  }
  function groupTitle(g) {
    if (ME.role === 'admin') return fullName(g.eleve) + ' · ' + fullName(g.prof);
    if (ME.role === 'prof') return fullName(g.eleve);
    return fullName(g.prof);
  }
  function membersChips(g) {
    // la bulle mise en couleur est celle du COMPTE CONNECTÉ (avant, c'était toujours
    // celle de l'administration, quel que soit l'utilisateur)
    var r = ME.role;
    return '<div class="grp-members">' +
      '<span class="mchip' + (r === 'eleve' ? ' mchip-me' : '') + '">' + esc(fullName(g.eleve)) + ' · Apprenant</span>' +
      '<span class="mchip' + (r === 'prof' ? ' mchip-me' : '') + '">' + esc(fullName(g.prof)) + ' · Formateur</span>' +
      '<span class="mchip' + (r === 'admin' ? ' mchip-me' : '') + '">Administration L&amp;S</span></div>';
  }
  function qsMsgHTML(m) {
    var q = m.qs || {}, mine = (ME.role === 'admin') ? m.fromAdmin : (!m.fromAdmin && m.from === ME.id);
    var actions;
    if (q.status === 'done' && q.docId) actions = '<a class="btn-mini" href="/api/documents/' + q.docId + '/download?token=' + encodeURIComponent(token()) + '">Télécharger le questionnaire rempli</a>';
    else if (ME.role === 'eleve') actions = '<button class="btn-mini qs-fill-btn" data-qs="' + q.id + '">Remplir le questionnaire →</button>';
    else actions = '<span class="qs-wait">En attente de la réponse de l\'apprenant…</span><div class="req-acts"><button class="btn-mini ghost qs-edit-btn" data-qs="' + q.id + '" data-type="' + esc(q.type || '') + '">Modifier</button><button class="btn-mini ghost qs-cancel-btn" data-qs="' + q.id + '">Annuler</button></div>';
    return '<div class="msg ' + (mine ? 'me' : 'them') + '">' + (mine ? '' : '<span class="msg-from">' + esc(m.fromName) + '</span>') +
      '<div class="qs-card-msg"><span class="qs-ic">📋</span><div class="qs-card-body"><b>' + esc(q.title || 'Questionnaire') + '</b>' +
      '<div class="qs-status' + (q.status === 'done' ? ' done' : '') + '">' + (q.status === 'done' ? 'Rempli ✓' : 'À remplir') + '</div>' + actions + '</div></div><time>' + fmtTime(m.date) + '</time></div>';
  }
  function presenceMsgHTML(m) {
    var p = m.presence || {}, mine = (ME.role === 'admin') ? m.fromAdmin : (!m.fromAdmin && m.from === ME.id);
    var actions;
    if (p.status === 'done' && p.docId) actions = '<a class="btn-mini" href="/api/documents/' + p.docId + '/download?token=' + encodeURIComponent(token()) + '">Télécharger la feuille signée</a>';
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
  // l'envoyeur modifie une demande en attente = on l'annule puis on rouvre le générateur (préremplI depuis le dossier)
  function editRequest(kind, id, type) {
    var url = (kind === 'presence' ? '/api/presence/' : '/api/qs/') + encodeURIComponent(id) + '/cancel';
    apiJSON(url, 'POST', {}).then(function (r) {
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; }
      renderDashboard();
      if (kind === 'presence') openPresenceModal(); else openQsHeaderModal(type);
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
    return '<div class="ds-card"><div class="ds-card-h"><h3>Dossier — ' + esc(groupTitle(g)) + '</h3>' +
      (ME.role !== 'eleve' ? '<button class="btn-mini gen-btn">📄 Générer un document</button>' : '') + '</div>' + membersChips(g) +
      '<div class="chan-tabs"><button class="chan-tab' + (channel === 'commun' ? ' on' : '') + '" data-ch="commun">💬 Discussion commune</button>' +
      (canPrive ? '<button class="chan-tab' + (channel === 'prive' ? ' on' : '') + '" data-ch="prive">🔒 Privé · formateur + admin</button>' : '') + '</div>' +
      (channel === 'prive' ? '<p class="chan-note">Canal privé : l\'apprenant n\'a pas accès à ce canal.</p>' : '') +
      docsBlock(docs) + '<h4 class="ds-sub">Messagerie</h4>' + chatHTML(messages) + '</div>';
  }
  function dossiersCardHTML(groups, canAdd) {
    // l'apprenant ne constitue pas de dossier : pas de bouton d'ajout chez lui
    if (ME.role === 'eleve') canAdd = null;
    var addLabel = 'Ajouter un apprenant';
    return '<div class="ds-card"><h3>Mes dossiers</h3>' +
      (groups.length ? '<ul class="contact-list">' + groups.map(function (g) {
        var sub = ME.role === 'admin' ? 'Formateur + Apprenant + Admin' : (ME.role === 'prof' ? 'Apprenant + Admin' : 'Formateur + Admin');
        var nb = NOTIFS.filter(function (n) { return !n.read && n.group === g.id; }).length;
        return '<li class="contact' + (selected === g.id ? ' on' : '') + (nb ? ' has-new' : '') + '" data-id="' + g.id + '"><span class="avatar">' + esc(initials(groupTitle(g))) + '</span><span class="c-name">' + esc(groupTitle(g)) + '<small>' + sub + '</small></span>' + (nb ? '<span class="contact-badge">' + (nb > 9 ? '9+' : nb) + '</span>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="ds-empty">Aucun dossier pour l\'instant.</p>') +
      (canAdd != null ? '<button class="btn-mini add-search-btn" style="margin-top:14px">🔍 ' + addLabel + '</button>' : '') + '</div>';
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
    Promise.all([api('/api/groups'), api('/api/users'), api('/api/notifications')]).then(function (res) {
      var groups = res[0].data.groups || [], allUsers = res[1].data.users || [];
      NOTIFS = res[2].data.notifs || [];
      var grouped = {}; groups.forEach(function (g) { grouped[ME.role === 'prof' ? g.eleve.id : g.prof.id] = 1; });
      var canAdd = allUsers.filter(function (o) { return roleAllowed(ME, o) && !grouped[o.id]; });
      ADD_CANDIDATES = canAdd;
      var selG = selected ? groups.filter(function (g) { return g.id === selected; })[0] : null;
      if (selected && !selG) selected = null;
      loadGroupContent(selG, function (m, d) { paintBoard(el, groups, canAdd, selG, m, d, null); });
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
      loadGroupContent(selG, function (m, d) { paintBoard(el, groups, null, selG, m, d, overview); });
    });
  }
  function paintBoard(el, groups, canAdd, selG, messages, docs, overview) {
    CUR_GROUP = selG;
    var unread = NOTIFS.filter(function (n) { return !n.read; }).length;
    el.innerHTML = topHTML() + '<div class="ds-grid"><aside class="ds-side">' + notifCardHTML(unread) + dossiersCardHTML(groups, canAdd) +
      '</aside><main class="ds-main">' + groupView(selG, messages, docs) + '</main></div>' + (overview ? adminPanel(overview) : '');
    el.querySelector('.ds-logout').onclick = function () { logout(); };
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
    var asb = el.querySelector('.add-search-btn'); if (asb) asb.onclick = openAddModal;
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
    if (selG) { wireChat(); wireUpload(); }
    if (overview) wireAdmin();
    renderHeader();
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
      body.innerHTML = '<p class="ds-empty" style="margin:0 0 12px">Choisissez le document à générer :</p><ul class="tpl-list">' +
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
        body.querySelectorAll('.hist-item').forEach(function (li) { li.onclick = function () { var x = hist[parseInt(li.getAttribute('data-i'), 10)]; closeTplModal(); reopenFromHistory(x); }; });
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

  // ---- recherche + ajout de contact (loupe) -----------------------------
  function openAddModal() {
    ensureAddModal();
    var m = document.getElementById('add-modal');
    m.querySelector('.nm-head h3').textContent = 'Ajouter ' + (ME.role === 'prof' ? 'un apprenant' : 'un formateur');
    document.getElementById('add-search').value = '';
    renderAddResults('');
    m.classList.add('open'); document.body.style.overflow = 'hidden';
    setTimeout(function () { var s = document.getElementById('add-search'); if (s) s.focus(); }, 60);
  }
  function ensureAddModal() {
    if (document.getElementById('add-modal')) return;
    var m = document.createElement('div'); m.id = 'add-modal'; m.className = 'notif-modal';
    m.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card"><div class="nm-head"><h3>Ajouter</h3><button class="nm-close" id="add-close" aria-label="Fermer">&times;</button></div>' +
      '<div class="add-searchbar"><input id="add-search" class="add-search-input" placeholder="Rechercher par prénom, nom ou e-mail…" autocomplete="off" /></div>' +
      '<div class="nm-body" id="add-results"></div></div>';
    document.body.appendChild(m);
    m.querySelector('#add-close').onclick = closeAddModal;
    m.querySelector('.nm-backdrop').onclick = closeAddModal;
    m.querySelector('#add-search').addEventListener('input', function (e) { renderAddResults(e.target.value); });
  }
  function closeAddModal() { var m = document.getElementById('add-modal'); if (m) { m.classList.remove('open'); document.body.style.overflow = ''; } }
  function renderAddResults(q) {
    var nq = norm(q);
    var list = ADD_CANDIDATES.filter(function (u) {
      if (!nq) return true;
      return norm(u.prenom + ' ' + u.nom).indexOf(nq) >= 0 || norm(u.nom + ' ' + u.prenom).indexOf(nq) >= 0 || norm(u.email).indexOf(nq) >= 0;
    });
    var box = document.getElementById('add-results');
    box.innerHTML = list.length ? '<ul class="add-list">' + list.map(function (o) {
      return '<li><span class="c-name">' + esc(fullName(o)) + '<small>' + ROLES[o.role] + (o.email ? ' · ' + esc(o.email) : '') + '</small></span><button class="btn-mini add-pick" data-id="' + o.id + '">Ajouter</button></li>';
    }).join('') + '</ul>' : '<p class="ds-empty" style="padding:6px 4px">' + (ADD_CANDIDATES.length ? 'Aucun résultat.' : 'Aucun ' + (ME.role === 'prof' ? 'apprenant' : 'formateur') + ' disponible.') + '</p>';
    box.querySelectorAll('.add-pick').forEach(function (b) {
      b.onclick = function () { b.disabled = true; apiJSON('/api/groups', 'POST', { targetId: b.getAttribute('data-id') }).then(function (r) { if (r.ok) { selected = r.data.group; channel = 'commun'; closeAddModal(); renderDashboard(); } else { alertDialog((r.data && r.data.error) || 'Erreur'); b.disabled = false; } }); };
    });
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
      '<button class="btn-mini adm-logins" type="button">🕐 Historique de connexions</button></div>';
    var sections = '';
    if (adminShow.dossiers) {
      var gs = groups.filter(function (g) { return !q || norm(g.prof + ' ' + g.eleve).indexOf(q) >= 0; });
      sections += '<div class="adm-sec"><h4 class="adm-sec-h">Dossiers</h4>' + (gs.length ? gs.map(function (g) {
        var gd = docs.filter(function (d) { return d.group === g.id; });
        return '<div class="adm-grp"><div class="adm-grp-h"><span class="avatar">📁</span><span class="c-name">' + esc(g.eleve) + ' (Apprenant) + ' + esc(g.prof) + ' (Formateur)<small>' + gd.length + ' document(s)</small></span>' +
          '<button class="adm-del" type="button" data-del="group" data-id="' + g.id + '" data-label="' + esc(g.eleve + ' / ' + g.prof) + '" title="Supprimer ce dossier">🗑</button></div>' +
          (gd.length ? '<ul class="docs">' + gd.map(admDocLi).join('') + '</ul>' : '') + '</div>';
      }).join('') : '<p class="ds-empty">Aucun dossier.</p>') + '</div>';
    }
    if (adminShow.comptes) {
      var us = users.filter(function (u) { return !q || norm(u.prenom + ' ' + u.nom).indexOf(q) >= 0 || norm(u.email).indexOf(q) >= 0; });
      sections += '<div class="adm-sec"><h4 class="adm-sec-h">Comptes</h4>' + (us.length ? '<ul class="admin-users">' + us.map(function (u) {
        var ds = groups.filter(function (g) { return g.profId === u.id || g.eleveId === u.id; }).map(function (g) { return u.id === g.profId ? g.eleve : g.prof; });
        var canDel = u.id !== ME.id, canEdit = u.role === 'eleve' || u.role === 'prof';
        return '<li><span class="avatar">' + esc(initials(fullName(u))) + '</span><span class="c-name">' + esc(fullName(u)) + '<small>' + esc(u.email || '') + '</small>' +
          '<small class="adm-contacts">' + (ds.length ? 'Dossiers : ' + ds.map(esc).join(', ') : 'Aucun dossier') + '</small></span><span class="role-chip role-' + u.role + '">' + ROLES[u.role] + '</span>' +
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
    document.querySelectorAll('.adm-hist').forEach(function (b) {
      b.onclick = function () { openLoginsModal(b.getAttribute('data-id'), b.getAttribute('data-name')); };
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
      var p1 = val('su-pwd'), p2 = val('su-pwd2');
      if (p1.length < 6) { err('ca-err', 'Le mot de passe doit faire au moins 6 caractères.'); return; }
      if (p1 !== p2) { err('ca-err', 'Les mots de passe ne correspondent pas.'); return; }
      var role = val('su-role');
      var btn = m.querySelector('.ca-save'); btn.disabled = true; btn.textContent = 'Création…';
      apiJSON('/api/admin/users', 'POST', { prenom: val('su-prenom'), nom: val('su-nom'), email: val('su-email'), password: p1, role: role, profile: collectProfile(role) }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Créer le compte';
        if (!r.ok) { err('ca-err', (r.data && r.data.error) || 'Création impossible.'); return; }
        closeFsModal('ca-modal');
        alertDialog('Compte créé — un e-mail de bienvenue a été envoyé.');
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
    function opts(list) { return list.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(fullName(u)) + ' — ' + esc(u.email || '') + '</option>'; }).join(''); }
    var body = '<h4 class="gen-h">Dossier</h4><div class="gf-grid">' +
      '<label class="gf">Formateur<select id="cg-prof">' + opts(profs) + '</select></label>' +
      '<label class="gf">Apprenant<select id="cg-eleve">' + opts(eleves) + '</select></label></div>' +
      '<p class="chan-note" style="margin-top:10px">Les deux personnes seront notifiées de l\'ouverture du dossier. L\'administration en est membre automatiquement.</p>';
    var footer = '<p class="fe-err auth-err" id="cg-err" style="margin:0 12px 0 0"></p><button class="btn btn-primary cg-save" type="button" style="padding:11px 22px">Créer le dossier</button>';
    var m = buildFsModal('cg-modal', 'Créer un dossier', body, footer);
    m.querySelector('.cg-save').onclick = function () {
      var btn = m.querySelector('.cg-save'); btn.disabled = true; btn.textContent = 'Création…';
      apiJSON('/api/groups', 'POST', { profId: val('cg-prof'), eleveId: val('cg-eleve') }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Créer le dossier';
        if (!r.ok) { err('cg-err', (r.data && r.data.error) || 'Création impossible.'); return; }
        closeFsModal('cg-modal');
        api('/api/admin/overview').then(function (o) { if (o.ok) { ADMIN_OVERVIEW = o.data; renderDashboard(); } });
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
      if (u.role === 'eleve') profile = { tel: val('fe-tel'), societe: val('fe-societe'), heuresTotal: val('fe-heures'), heuresDetail: val('fe-heures-detail'), intitule: val('fe-intitule'), langue: val('fe-langue'), dateDebut: val('fe-date-debut'), dateFin: val('fe-date-fin'), lieu: val('fe-lieu'), lieuAdresse: val('fe-lieu-adresse'), certification: val('fe-certif'), certificationText: val('fe-certif-text') };
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

  // fiche client (pré-remplissage automatique des documents)
  function clientFiche() { return (CUR_GROUP && CUR_GROUP.eleve && CUR_GROUP.eleve.profile) || {}; }
  function profFiche() { return (CUR_GROUP && CUR_GROUP.prof && CUR_GROUP.prof.profile) || {}; }
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
    return { nomApprenant: fullName(CUR_GROUP.eleve), formateur: fullName(CUR_GROUP.prof), date: fc.dateDebut || new Date().toLocaleDateString('fr-FR'), societe: fc.societe || '', langue: fc.langue || '', intitule: fc.intitule || '', certification: certifLine(fc) };
  }
  // ---- QS : le formateur remplit l'en-tête et envoie à l'apprenant ---------
  function openQsHeaderModal(type) {
    if (!selected || !CUR_GROUP) return;
    var titles = { qs_mid: 'Questionnaire de satisfaction — en cours de formation', qs_end: 'Questionnaire de fin de formation' };
    var fields = [['nomApprenant', "Nom de l'apprenant"], ['societe', 'Société'], ['langue', 'Langue'], ['intitule', 'Intitulé de la formation'], ['formateur', 'Formateur'], ['date', 'Date'], ['certification', 'Certification']];
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
    var fields = [['nomApprenant', "Nom de l'apprenant"], ['societe', 'Société'], ['langue', 'Langue'], ['intitule', 'Intitulé de la formation'], ['formateur', 'Formateur'], ['date', 'Date'], ['certification', 'Certification']];
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
    var pre = { representant: 'Antonin HATTABE', apprenant: fullName(CUR_GROUP.eleve), societe: fc.societe || '', intitule: fc.intitule || '', formateur: fullName(CUR_GROUP.prof), dateDebut: fc.dateDebut || '', dateFin: fc.dateFin || '', dureeTotale: fc.heuresTotal || '', dureeDetail: fc.heuresDetail || '', lieu: lieuLabel(fc) || 'Distanciel', certification: fc.certificationText || '', lieuFait: 'Nice', dateFait: new Date().toLocaleDateString('fr-FR') };
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
    var pre = { stnom: fullName(CUR_GROUP.prof), stNaissance: pf.dateNaissance || '', stNationalite: pf.nationalite || '', stAdresse: pf.adresse || '', stSiret: pf.siret || '', stNda: pf.nda || '', intitule: fc.intitule || '', langue: fc.langue || pf.langue || '', stagiaire: fullName(CUR_GROUP.eleve), programme: progPre, mission: missionPre, lieu: lieuLabel(fc) || 'en distanciel (Visioconférence)', dateDebut: fc.dateDebut || '', dateFin: fc.dateFin || '', lieuFait: 'Nice', dateFait: new Date().toLocaleDateString('fr-FR') };
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
      downloadDoc(m, '.ct-gen', '/api/contrat/generate', { group: selected, fields: fields, format: document.getElementById('ct-format').value }, '7 - Contrat de sous-traitance - ' + (fields.stnom || 'formateur'));
    };
  }

  // ---- Level Test : évaluation orale / questionnaire d'objectifs -----------
  function openLevelTestModal() {
    if (!selected || !CUR_GROUP) return;
    api('/api/leveltest').then(function (r) {
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; }
      var tpl = r.data.tpl || {};
      var fc = clientFiche();
      var pre = { dateEval: new Date().toLocaleDateString('fr-FR'), societe: fc.societe || '', langue: fc.langue || '', nom: (CUR_GROUP.eleve.nom || ''), prenom: (CUR_GROUP.eleve.prenom || ''), tel: fc.tel || '', mail: (CUR_GROUP.eleve.email || '') };
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
  function openPresenceModal() {
    if (!selected || !CUR_GROUP) return;
    api('/api/presence').then(function (r) {
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; }
      var T = r.data.templates || {};
      var fc = clientFiche();
      var moisNow = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); moisNow = moisNow.charAt(0).toUpperCase() + moisNow.slice(1);
      var lieuTxt = (function () { var l = (fc.lieu || '').toLowerCase(); if (l === 'presentiel' || l === 'présentiel') return 'Présentiel'; if (l === 'distanciel') return 'Distanciel'; return ''; })();
      var pre = {
        mois: moisNow, formateur: fullName(CUR_GROUP.prof), apprenant: fullName(CUR_GROUP.eleve), compte: fc.societe || '', ref: '',
        langue: fc.langue || '', debut: fc.dateDebut || '', fin: fc.dateFin || '', lieu: lieuTxt, ville: '',
        dureePrevue: fc.heuresTotal ? (fc.heuresTotal + (/h/i.test(fc.heuresTotal) ? '' : 'H00')) : '', dateRapport: new Date().toLocaleDateString('fr-FR'),
        heuresPrevues: fc.heuresTotal || '', formation: { elearning: 'Elearning', presentiel: '', test: '' }
      };
      var curType = 'presentiel', sessions = [];
      var PR_TIMES = ['0:30', '1:00', '1:30', '2:00', '2:30', '3:00', '3:30', '4:00', '4:30', '5:00', '5:30', '6:00', '6:30', '7:00', '7:30', '8:00', '8:30', '9:00', '9:30', '10:00'];
      function nextSlot() { var used = sessions.map(function (s) { return s.slot; }); for (var i = 0; i < PR_TIMES.length; i++) { if (used.indexOf(PR_TIMES[i]) < 0) return PR_TIMES[i]; } return PR_TIMES[0]; }
      var dyn = '<label class="gen-chan" style="margin-bottom:14px">Type de feuille <select id="pr-type"><option value="elearning">E-learning</option><option value="presentiel">Présentiel / Distanciel</option><option value="test">Test</option></select></label><div id="pr-dyn"></div>' +
        '<h4 class="gen-h">Votre signature (formateur)</h4><p class="ds-empty" style="margin:0 0 8px">Signez ci-dessous à la souris (ou au doigt), ou téléversez une image de votre signature. L\'apprenant la recevra dans le dossier pour signer à son tour.</p>' + sigPadHTML();
      var footer = '<button class="btn btn-primary pr-gen" type="button" style="padding:11px 22px">Envoyer à l\'apprenant pour signature →</button>';
      var m = buildFsModal('pr-modal', 'Feuille de présence', dyn, footer);
      document.getElementById('pr-type').value = curType;
      var sigPad = mountSignaturePad(m.querySelector('.sigpad'));
      function lieuSelect(id, v) { return '<label class="gf">Lieu<select id="' + id + '"><option value="">—</option><option value="Présentiel"' + (v === 'Présentiel' ? ' selected' : '') + '>Présentiel</option><option value="Distanciel"' + (v === 'Distanciel' ? ' selected' : '') + '>Distanciel</option></select></label>'; }
      function headerHTML(tpl) {
        return '<h4 class="gen-h">En-tête</h4><div class="gf-grid">' + tpl.headerRows.map(function (row) {
          return row.map(function (pair) { if (!pair) return ''; if (pair[0] === 'lieu') return lieuSelect('pr-' + pair[0], pre.lieu); var dv = pair[0] === 'formation' ? (pre.formation[curType] || '') : (pre[pair[0]] || ''); return gi('pr-' + pair[0], pair[1], dv); }).join('');
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
        if (tpl.kind === 'grid') { if (!sessions.length) sessions.push({ slot: nextSlot() }); redrawSessions(); m.querySelector('.pr-add-sess').onclick = function () { collectSessions(); sessions.push({ slot: nextSlot() }); redrawSessions(); }; }
      }
      document.getElementById('pr-type').onchange = function () { curType = this.value; sessions = []; render(); };
      render();
      m.querySelector('.pr-gen').onclick = function () {
        if (sigPad.isEmpty()) { alertDialog('Veuillez signer (ou téléverser votre signature) avant d\'envoyer à l\'apprenant.'); return; }
        var tpl = T[curType], fields = {};
        tpl.headerRows.forEach(function (row) { row.forEach(function (pair) { if (pair) fields[pair[0]] = val('pr-' + pair[0]); }); });
        if (tpl.kind === 'summary') { fields.heuresPrevues = val('pr-heuresPrevues'); fields.heuresRealisees = val('pr-heuresRealisees'); fields.dateRapport = val('pr-dateRapport'); }
        else { collectSessions(); fields.sessions = sessions.filter(function (s) { return s.date || s.jour || s.hDebut || s.hFin || s.duree; }); }
        var btn = m.querySelector('.pr-gen'); btn.disabled = true; btn.textContent = 'Envoi…';
        apiJSON('/api/presence/send', 'POST', { group: selected, type: curType, fields: fields, formateurSig: sigPad.dataURL() }).then(function (rr) {
          if (!rr.ok) { btn.disabled = false; btn.textContent = 'Envoyer à l\'apprenant pour signature →'; alertDialog((rr.data && rr.data.error) || 'Erreur'); return; }
          closeFsModal('pr-modal'); channel = 'commun'; renderDashboard();
        });
      };
    });
  }
  // ---- pad de signature réutilisable (dessin souris/tactile + téléversement d'image) ----
  function sigPadHTML() {
    return '<div class="sigpad"><canvas class="sigpad-canvas" width="500" height="160"></canvas><div class="sigpad-tools"><button type="button" class="btn-mini sigpad-clear">Effacer</button><label class="btn-mini sigpad-up">Téléverser une image<input type="file" accept="image/*" class="sigpad-file" hidden /></label></div></div>';
  }
  function mountSignaturePad(container) {
    var canvas = container.querySelector('.sigpad-canvas'), ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#1d2b4a';
    var drawing = false, dirty = false, last = null;
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
  // ---- l'apprenant signe la feuille de présence reçue ----------------------
  function openPresenceSignModal(presenceId) {
    api('/api/presence/' + encodeURIComponent(presenceId)).then(function (r) {
      if (!r.ok) { alertDialog((r.data && r.data.error) || 'Erreur'); return; }
      var p = r.data.presence || {};
      if (p.status === 'done') { alertDialog('Cette feuille est déjà signée.'); renderDashboard(); return; }
      var body = '<p class="ds-empty" style="margin:0 0 12px">Signez la feuille de présence « ' + esc(p.title || '') + ' » ci-dessous à la souris (ou au doigt), ou téléversez une image de votre signature.</p>' + sigPadHTML();
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
      var pre = { formateur: fullName(CUR_GROUP.prof), nomApprenant: fullName(CUR_GROUP.eleve), date: fc.dateDebut || new Date().toLocaleDateString('fr-FR'), langue: fc.langue || '', intitule: fc.intitule || '' };
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

  boot();
})();
