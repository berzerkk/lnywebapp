/* ============================================================================
   Languages & Success, Header + Footer partagés (injectés dans #ls-nav et #ls-footer)
   Charger ce script de façon classique (non-module) AVANT ls-engine.js.
   ============================================================================ */
(function () {
  'use strict';
  var path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (path === '') path = 'index.html';

  var NAV = [
    { href: 'formations.html',     label: 'Formations' },
    { href: 'financement.html',    label: 'Financement' },
    { href: 'entreprises.html',    label: 'Entreprises' },
    { href: 'a-propos.html',       label: 'À propos' },
    { href: 'blog.html',           label: 'Blog' }
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

  var navHTML =
    '<nav class="site-header" id="site-header">' +
      logo() +
      '<div class="nav-links" id="nav-links">' + navLinksHTML + '</div>' +
      '<div class="header-actions">' +
        '<a href="test-de-niveau.html" class="header-cta header-cta-accent">Faire le test</a>' +
        '<a href="contact.html" class="header-cta">Nous contacter</a>' +
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
        '<a href="espace-documents.html#creer" class="header-cta">Créer un compte</a>' +
      '</div>' +
      '<nav class="mm-links">' + navLinksHTML + '</nav>' +
      '<div class="mm-cta">' +
        '<a href="test-de-niveau.html" class="header-cta header-cta-accent">Faire le test</a>' +
        '<a href="contact.html" class="header-cta">Nous contacter</a>' +
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
            '<p style="margin-top:16px;line-height:1.7">57, route de Grenoble, BP1052<br/>06201 Nice Cédex 3, France<br/>' +
              '<a href="tel:+33778873201">+33 7 78 87 32 01</a><br/>' +
              '<a href="mailto:lny.cambridge@gmail.com">lny.cambridge@gmail.com</a></p>' +
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
            '<li><a href="mailto:lny.cambridge@gmail.com">Contact</a></li></ul></div>' +
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
        '</div>' +
        '<div class="legal">' +
          '<div class="row"><span>Association Loi 1901</span><span>·</span><span>SIRET 881 226 641 00028</span><span>·</span><span>RNA W061014363</span><span>·</span><span>APE 8559A</span><span>·</span><span>TVA FR31881226641</span></div>' +
          '<div class="row"><span>Déclaration d\'activité enregistrée sous le n° 93 060 886 106 auprès du Préfet de la région PACA. Cet enregistrement ne vaut pas agrément de l\'État.</span></div>' +
          '<div class="row"><a href="cgv.html">Conditions générales</a><a href="confidentialite.html">Politique de confidentialité</a><a href="reglement-interieur.html">Règlement intérieur</a><a href="mentions-legales.html">Mentions légales</a></div>' +
          '<div class="row" style="color:#6f6253">* Chiffres arrêtés au 31/12/2025.</div>' +
          '<div class="row" style="color:#6f6253">© ' + new Date().getFullYear() + ' Languages &amp; Success. Tous droits réservés.</div>' +
        '</div>' +
      '</div>' +
    '</footer>';

  var navRoot = document.getElementById('ls-nav');
  var footRoot = document.getElementById('ls-footer');
  if (navRoot) navRoot.outerHTML = navHTML;
  if (footRoot) footRoot.outerHTML = footHTML;

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
  window.addEventListener('resize', function () { if (window.innerWidth > 880) setMenu(false); });

  // moteur de l'espace documents (compte + notifications) sur toutes les pages
  if (!window.__lsAccountLoaded) {
    window.__lsAccountLoaded = true;
    var acc = document.createElement('script');
    acc.src = 'assets/account.js';
    document.body.appendChild(acc);
  }
})();
