/* ============================================================================
   Languages & Success, Header + Footer partagés (injectés dans #ls-nav et #ls-footer)
   Charger ce script de façon classique (non-module) AVANT ls-engine.js.
   ============================================================================ */
(function () {
  'use strict';
  var path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (path === '') path = 'index.html';

  // Date de dernière mise à jour du site = date de build du serveur (reconstruit à CHAQUE
  // déploiement, donc à chaque push). Elle est encodée dans le ?v= de ce script
  // (ASSET_VER = Date.now() en base36 côté serveur) → on la redécode ici. Aucune saisie manuelle.
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dateNum(d) { return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function buildDate() {
    try {
      var sc = document.getElementsByTagName('script');
      for (var i = 0; i < sc.length; i++) {
        var m = sc[i].src && sc[i].src.match(/partials\.js\?v=([a-z0-9]+)/i);
        if (m) { var ts = parseInt(m[1], 36); if (ts > 1e12 && ts < 4e12) return new Date(ts); }
      }
    } catch (e) {}
    return new Date();
  }

  var NAV = [
    { href: 'formations.html',     label: 'Formations' },
    { href: 'financement.html',    label: 'Financement' },
    { href: 'entreprises.html',    label: 'Entreprises' },
    { href: 'a-propos.html',       label: 'À propos' },
    { href: 'blog.html',           label: 'Blog' },
    { href: 'contact.html',        label: 'Contact' }
  ];

  function logo() {
    return '<a href="index.html" class="logo">' +
      '<img class="emblem" src="assets/ls-logo.png" alt="Languages & Success" />' +
      '<span class="wm"><span class="l">Languages</span><i class="amp">&amp;</i><span class="l">Success</span></span></a>';
  }

  var navLinksHTML = NAV.map(function (n) {
    var active = (n.href === path) ? ' class="active"' : '';
    return '<a href="' + n.href + '"' + active + '>' + n.label + '</a>';
  }).join('');

  // sélecteur de langue du site (les libellés restent dans leur propre langue)
  var LANGS = [['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['it', 'Italiano'], ['ru', 'Русский'], ['zh', '中文']];
  var langOptsHTML = LANGS.map(function (l) {
    return '<button type="button" role="option" data-lang="' + l[0] + '">' + l[1] + '</button>';
  }).join('');
  var langSelHTML =
    '<div class="lang-sel" id="lang-sel">' +
      '<button class="lang-btn" id="lang-btn" type="button" aria-haspopup="listbox" aria-label="Choisir la langue du site">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"/></svg>' +
        '<span class="lang-cur">FR</span>' +
        '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
      '</button>' +
      // data-i18n-skip : les noms de langues sont des auto-libellés (chacun dans sa langue), jamais traduits
      '<div class="lang-menu" id="lang-menu" role="listbox" data-i18n-skip>' + langOptsHTML + '</div>' +
    '</div>';

  var navHTML =
    '<nav class="site-header" id="site-header">' +
      logo() +
      '<div class="nav-links" id="nav-links">' + navLinksHTML + '</div>' +
      '<div class="header-actions">' +
        '<a href="test-de-niveau.html" class="header-cta header-cta-accent">Faire le test</a>' +
        langSelHTML +
        '<div id="ls-account" class="ls-account"></div>' +
      '</div>' +
      '<button class="nav-burger" id="nav-burger" aria-label="Ouvrir le menu"><span></span><span></span><span></span></button>' +
    '</nav>' +
    '<div class="nav-backdrop" id="nav-backdrop"></div>' +
    '<aside class="mobile-menu" id="mobile-menu" aria-hidden="true">' +
      '<button class="mm-close" id="mm-close" aria-label="Fermer le menu">&times;</button>' +
      '<div class="mm-account">' +
        '<span class="mm-title">Espace documents</span>' +
        '<a href="espace-documents.html" class="header-cta header-cta-accent">Se connecter</a>' +
      '</div>' +
      '<nav class="mm-links">' + navLinksHTML + '</nav>' +
      '<div class="mm-lang"><span class="mm-title">Langue</span><div class="mm-lang-grid" data-i18n-skip>' + langOptsHTML + '</div></div>' +
      '<div class="mm-cta">' +
        '<a href="test-de-niveau.html" class="header-cta header-cta-accent">Faire le test</a>' +
      '</div>' +
    '</aside>';

  var footHTML =
    '<footer>' +
      '<div class="wrap">' +
        '<div class="foot-top">' +
          '<div>' +
            '<div class="logo">' + '<img class="emblem" src="assets/ls-logo.png" alt="" />' +
              '<span class="wm"><span class="l">Languages</span><i class="amp">&amp;</i><span class="l">Success</span></span></div>' +
            '<p class="foot-desc">Organisme de formation en langues, certifié Qualiopi. Des parcours sur mesure pour les particuliers, les salariés et les entreprises.</p>' +
            '<p style="margin-top:16px;line-height:1.7">57, avenue Valéry Giscard d\'Estaing, BP1052<br/>06201 Nice Cédex 3, France<br/>' +
              '<a href="tel:+33778873201">+33 7 78 87 32 01</a><br/>' +
              '<a href="mailto:contact@languagesandsuccess.com">contact@languagesandsuccess.com</a></p>' +
          '</div>' +
          '<div><h5>Formations</h5><ul>' +
            '<li><a href="formations.html">Nos langues</a></li>' +
            '<li><a href="formations.html">Formats &amp; certifications</a></li>' +
            '<li><a href="entreprises.html">Entreprises &amp; RH</a></li>' +
            '<li><a href="test-de-niveau.html">Test de niveau</a></li></ul></div>' +
          '<div><h5>Ressources</h5><ul>' +
            '<li><a href="financement.html">Financement</a></li>' +
            '<li><a href="a-propos.html">À propos</a></li>' +
            '<li><a href="blog.html">Blog</a></li>' +
            '<li><a href="espace-documents.html">Espace documents</a></li>' +
            '<li><a href="contact.html">Contact</a></li></ul></div>' +
          '<div><h5>Suivez-nous</h5><ul>' +
            '<li><a href="https://www.linkedin.com/company/languages-n-success-lns/" target="_blank" rel="noopener">LinkedIn</a></li>' +
            '<li><a href="mailto:contact@languagesandsuccess.com">Contact</a></li></ul>' +
            // boutons réseaux sociaux — href="#" en attendant les vrais liens (à remplacer le moment venu)
            '<div class="socials">' +
              '<a class="soc" href="https://www.facebook.com/languagesnsuccess/" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6.03 4.39 11.03 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8v8.44C19.61 23.1 24 18.1 24 12.07z"/></svg></a>' +
              '<a class="soc" href="#" aria-label="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.43.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.43.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.43-.36-1.06-.41-2.23C2.18 15.58 2.16 15.2 2.16 12s.02-3.58.08-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.43-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.31-1.46.72-2.13 1.38C1.35 2.68.94 3.35.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.72 1.46 1.38 2.13.67.67 1.34 1.08 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.79-.31 1.46-.72 2.13-1.38.67-.67 1.08-1.34 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91-.31-.79-.72-1.46-1.38-2.13-.67-.67-1.34-1.08-2.13-1.38-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84zm0 10.16A4 4 0 1 1 16 12a4 4 0 0 1-4 4zm6.4-11.85a1.44 1.44 0 1 0 1.44 1.44 1.44 1.44 0 0 0-1.44-1.44z"/></svg></a>' +
              '<a class="soc" href="#" aria-label="TikTok"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.08-.14 1.62.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg></a>' +
            '</div></div>' +
        '</div>' +
        '<div class="certs">' +
          '<div class="qualiopi-block">' +
            '<img src="assets/qualiopi-logo.png" alt="Certifié Qualiopi, processus certifié, République Française" />' +
            '<p>La certification qualité a été délivrée au titre de la catégorie d\'action suivante : ACTIONS DE FORMATION.</p>' +
          '</div>' +
          '<div class="cpf-block"><img src="assets/cpf-logo.jpg" alt="Mon Compte Formation, éligible CPF" /></div>' +
          '<div class="cpf-block is-badge"><img src="assets/charte-cpf.png" alt="Entreprise de formation respectant la charte de déontologie CPF" /></div>' +
          '<div class="cpf-block"><img src="assets/datadock.png" alt="Référencé Datadock" /></div>' +
          '<a class="dl-cert" href="assets/Attestation-Qualiopi.pdf" target="_blank" rel="noopener">⬇ Télécharger l\'attestation Qualiopi (PDF)</a>' +
          '<a class="dl-cert" href="assets/Charte-deontologie-CPF.pdf" target="_blank" rel="noopener">⬇ Télécharger la charte de déontologie (PDF)</a>' +
        '</div>' +
        '<div class="legal">' +
          '<div class="row"><span>Association Loi 1901</span><span>·</span><span>SIRET 881 226 641 00028</span><span>·</span><span>RNA W061014363</span><span>·</span><span>APE 8559A</span><span>·</span><span>TVA FR31881226641</span></div>' +
          '<div class="row"><span>Déclaration d\'activité enregistrée sous le n° 93 060 886 106 auprès du Préfet de la région PACA. Cet enregistrement ne vaut pas agrément de l\'État.</span></div>' +
          '<div class="row"><a href="cgv.html">Conditions générales</a><a href="confidentialite.html">Politique de confidentialité</a><a href="reglement-interieur.html">Règlement intérieur</a><a href="mentions-legales.html">Mentions légales</a></div>' +
          '<div class="row" style="color:#6f6253"><span>Site créé le <span data-i18n-skip>01/06/2026</span></span><span>·</span><span>Dernière mise à jour le <span data-i18n-skip>' + dateNum(buildDate()) + '</span></span></div>' +
          '<div class="row" style="color:#6f6253"><span>© ' + new Date().getFullYear() + ' Languages &amp; Success.</span> <span>Tous droits réservés.</span></div>' +
        '</div>' +
      '</div>' +
    '</footer>';

  var navRoot = document.getElementById('ls-nav');
  var footRoot = document.getElementById('ls-footer');
  if (navRoot) navRoot.outerHTML = navHTML;
  if (footRoot) footRoot.outerHTML = footHTML;

  // réseaux sociaux : placeholders sans lien (href="#") → on neutralise le clic en attendant les vrais liens
  document.querySelectorAll('.soc[href="#"]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); }); });

  // menu mobile (drawer + backdrop flou + croix + clic dehors pour fermer)
  var burger = document.getElementById('nav-burger');
  var menu = document.getElementById('mobile-menu');
  var backdrop = document.getElementById('nav-backdrop');
  var mmClose = document.getElementById('mm-close');
  function setMenu(open) {
    if (!menu) return;
    menu.classList.toggle('open', open);
    if (backdrop) backdrop.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    menu.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  if (burger) burger.addEventListener('click', function () { setMenu(!menu.classList.contains('open')); });
  if (mmClose) mmClose.addEventListener('click', function () { setMenu(false); });
  if (backdrop) backdrop.addEventListener('click', function () { setMenu(false); });
  if (menu) menu.addEventListener('click', function (e) { if (e.target.tagName === 'A') setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  // si on repasse en desktop (fenêtre agrandie), on ferme le menu mobile (sinon le flou reste)
  window.addEventListener('resize', function () { if (window.innerWidth > 1080) setMenu(false); });

  // sélecteur de langue : ouverture/fermeture du menu + choix (l'i18n applique)
  var langSel = document.getElementById('lang-sel');
  var langBtn = document.getElementById('lang-btn');
  if (langBtn) langBtn.addEventListener('click', function (e) { e.stopPropagation(); langSel.classList.toggle('open'); });
  document.addEventListener('click', function (e) {
    if (langSel && !e.target.closest('#lang-sel')) langSel.classList.remove('open');
    var opt = e.target.closest('[data-lang]');
    if (!opt) return;
    var L = opt.getAttribute('data-lang');
    if (window.__lsI18N) window.__lsI18N.set(L);
    else { try { localStorage.setItem('ls-lang', L); } catch (err) {} } // moteur pas encore chargé : appliqué à son boot
    if (langSel) langSel.classList.remove('open');
    // en mobile le choix se fait dans le drawer : on le referme, comme pour un lien de nav
    if (opt.closest('#mobile-menu')) setMenu(false);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && langSel) langSel.classList.remove('open'); });

  // moteur i18n (traduction du site selon la langue choisie) sur toutes les pages
  if (!window.__lsI18nLoaded) {
    window.__lsI18nLoaded = true;
    var i18 = document.createElement('script');
    i18.src = 'assets/i18n.js?v=' + Date.now(); // même stratégie anti-cache qu'account.js
    document.body.appendChild(i18);
  }

  // moteur de l'espace documents (compte + notifications) sur toutes les pages
  if (!window.__lsAccountLoaded) {
    window.__lsAccountLoaded = true;
    var acc = document.createElement('script');
    // cache-buster horodaté : account.js est injecté dynamiquement (le hard-refresh ne le
    // rafraîchit pas) → on force une URL unique pour toujours charger la dernière version,
    // y compris derrière le CDN Cloudflare.
    acc.src = 'assets/account.js?v=' + Date.now();
    document.body.appendChild(acc);
  }
})();
