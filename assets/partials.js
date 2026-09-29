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

  // Les articles du blog vivent dans /blog/, toutes les autres pages à la racine. Le header et
  // le pied sont écrits avec des chemins relatifs (« index.html », « assets/… ») : depuis un
  // sous-dossier ils pointeraient sur /blog/index.html. On les préfixe donc à l'injection.
  // Sont laissés intacts : les URL absolues, les mailto:/tel: et les ancres.
  var RACINE = /\/blog\//.test(location.pathname) ? '../' : '';
  function versRacine(html) {
    if (!RACINE) return html;
    return html.replace(/\b(href|src)="(?!https?:|mailto:|tel:|#|\/|data:)/g, '$1="' + RACINE);
  }

  var navRoot = document.getElementById('ls-nav');
  var footRoot = document.getElementById('ls-footer');
  if (navRoot) navRoot.outerHTML = versRacine(navHTML);
  if (footRoot) footRoot.outerHTML = versRacine(footHTML);
  // un article est une page de blog : c'est l'onglet « Blog » qui doit être actif
  if (RACINE) { var lb = document.querySelector('#nav-links a[href$="blog.html"]'); if (lb) lb.classList.add('active'); }

  animerLogos();

  // ---- ANIMATION DU LOGO À CHAQUE PAGE (29/09/2026, demande de l'utilisateur) -----------------
  // Port fidèle de l'animation qu'il a fournie, version V3 (« animation L&S V3.zip » : Logo Animation.dc.html,
  // logo-animation.jsx, animations-v3.jsx) : même minutage (window.OM_SCENES : Rotation 3,92 s, Impact
  // 1,2 s, Pause 2,4 s ; aucun réglage de vitesse, temps réel = temps auteur), mêmes courbes, mêmes formules.
  // - Réglages = ceux ENREGISTRÉS dans l'éditeur (data-props du fichier), que l'aperçu applique réellement
  //   (vérifié en l'ouvrant) : 30 tours, flou de mouvement 120 %, 20 traînées de 130 % en longueur et en
  //   largeur, grossissement 130 %, halo 7. Les valeurs de secours écrites dans le code (22 tours, 115 %,
  //   4,5…) ne servent que si l'éditeur n'en fournit aucune : ce n'est jamais le cas.
  // - Nouveautés de la V3 par rapport à la première animation : flou de mouvement horizontal proportionnel
  //   à la vitesse (filtre SVG à identifiant unique), jusqu'à 8 reflets au lieu de 6,
  //   halo en passes empilées (S > 3 : plus dense, rayon qui grandit comme √(S/3)), logo plus lumineux à
  //   l'impact (en proportion du halo), nombre, longueur et épaisseur des traînées réglables.
  // - Joue à CHAQUE page : le site recharge la page à chaque lien, et un retour arrière servi depuis
  //   le cache du navigateur (pageshow « persisted ») la rejoue depuis zéro. Logo animé : celui de
  //   l'EN-TÊTE SEULEMENT (demande de l'utilisateur, 29/09/2026 : « uniquement dans le header, nulle part
  //   ailleurs »). Laissés fixes : le pied de page, la carte auteur des articles, l'écran de chargement de
  //   l'accueil (l'animation attend qu'il soit retiré), l'animation du héros (elle anime déjà le logo),
  //   favicon, images d'aperçu, e-mails, PDF.
  // - L'image du site n'est JAMAIS remplacée : elle reste à sa place (même boîte, même texte
  //   alternatif), seul son dessin est poussé hors de sa boîte (object-position) le temps qu'une
  //   COUCHE posée exactement sur elle joue l'animation avec la même image (ls-logo.png). À 5,12 s
  //   (début de la scène « Pause », immobile) la couche disparaît et l'image d'origine réapparaît
  //   telle quelle : au repos, c'est le logo fixe, au pixel près.
  // - Non repris, exprès : le fondu de fin (7,22 → 7,52 s) et la boucle, qui ne servent qu'à faire
  //   tourner l'aperçu en continu. La scène « Pause » immobile = le logo au repos.
  // - « Réduire les animations » (prefers-reduced-motion) : rien ne bouge.
  // - Géométrie : l'original dessine dans une boîte de 800 unités où le dessin mesure 784 (logo.webp : 1372 px
  //   de dessin sur 1400) ; ls-logo.png garde des marges (dessin = 658 px sur 760). Longueurs, flous (halo,
  //   flou de mouvement) et perspective sont ramenés à la taille RÉELLE du dessin à l'écran
  //   (k = dessin / 784), remesurée à chaque image : le logo de l'en-tête rétrécit quand on fait défiler.
  function animerLogos() {
    if (window.__lsLogoAnim) return;
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) { return; }

    var CUES = { Rotation: 0, Impact: 3.92, Pause: 5.12 };   // débuts des scènes = durées cumulées
    var FIN = CUES.Pause;
    // réglages de l'éditeur (data-props) : vitesseSpin 30, grossissement 130, intensiteHalo 7, flou 120,
    // lignesNombre 20, lignesLongueur 130, lignesLargeur 130 — convertis comme le fait LogoAnimation()
    var O = { tours: 30, grow: 130 / 100, S: 7, blur: 120 / 100, lines: 20, lineLen: 130 / 100, lineW: 130 / 100 };
    // Dans l'original, la boîte (800 unités) déborde un peu du dessin : logo.webp mesure 1400 px, son dessin
    // 1372 → dessin = 784 unités. C'est cette taille qu'on fait correspondre au dessin de ls-logo.png (658 px
    // sur 760), mesuré à l'écran : l'anneau extérieur tombe alors pile sur R = 0,49 × 800 = 392 unités.
    var BOX = 800, DESSIN_ORIGINE = 800 * 1372 / 1400, PX_PER_UNIT = 1.47, PERSPECTIVE = 1800, DESSIN = 658 / 760;
    var HALO_COLOR = '#ee9f87', LINE_COLOR = '#d98b76';
    var CHOIX = '.site-header .logo .emblem';   // l'en-tête seulement : pied de page et carte auteur restent fixes

    // courbes de animations-v3.jsx (Easing), recopiées telles quelles
    var MOTION = {
      enter: function (t) { t = t - 1; return t * t * t + 1; },                                          // easeOutCubic
      glide: function (t) { return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; }, // easeInOutCubic
      pop: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); } // easeOutBack
    };
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function animate(o) {   // animate({from, to, start, end, ease})(t) de animations-v3.jsx
      return function (t) {
        if (t <= o.start) return o.from;
        if (t >= o.end) return o.to;
        return o.from + (o.to - o.from) * o.ease((t - o.start) / (o.end - o.start));
      };
    }
    var HALO_LAYERS = [
      { blur: function (S) { return 4 + 3 * S; }, op: function (h) { return 0.9 * h; } },
      { blur: function (S) { return 10 * S; }, op: function (h) { return 0.8 * h; } },
      { blur: function (S) { return 26 * S; }, op: function (h, S) { return Math.min(1, 0.35 * h * S); } }
    ];
    // halo (Halo de logo-animation.jsx) : S > 3 → passes empilées (halo plus dense), le rayon grandit comme √(S/3)
    var HALO_G = O.S / 3, HALO_PASSES = Math.min(4, Math.max(1, Math.ceil(HALO_G))), HALO_SPREAD = Math.sqrt(HALO_G);
    var SPEED_LINES = [];   // makeSpeedLines(O.lines)
    for (var q = 0; q < O.lines; q++) {
      var r0 = Math.sin(q * 12.9898 + 1) * 43758.5453, rnd = r0 - Math.floor(r0);
      SPEED_LINES.push({ y: O.lines > 1 ? -0.86 + (1.72 * q) / (O.lines - 1) : 0, side: q % 2 ? 1 : -1, len: 0.16 + 0.24 * rnd, phase: rnd, w: 3 + 5 * ((rnd * 7) % 1) });
    }

    // Tout l'état visuel est une fonction pure du temps T (logoState de logo-animation.jsx, sans le
    // fondu de fin de boucle, jamais atteint puisque tout s'arrête à FIN).
    function logoState(T) {
      var R = CUES.Rotation, I = CUES.Impact, P = CUES.Pause, peak = I + 0.14, hold = I + 0.45;
      var spin = function (t) { return -O.tours * 360 * (1 - MOTION.enter(clamp((t - R) / (I - R), 0, 1))); };
      var angle = spin(T);
      var arc = Math.abs(angle - spin(T - 1 / 60));   // degrés parcourus en une image (à 60 images/s)
      var appear = animate({ from: 0, to: 1, start: R, end: R + 0.36, ease: MOTION.pop })(T);
      var grow = T < peak
        ? animate({ from: 1, to: O.grow, start: I, end: peak, ease: MOTION.enter })(T)
        : animate({ from: O.grow, to: 1, start: peak, end: P, ease: MOTION.enter })(T);
      var h = T < peak
        ? animate({ from: 0, to: 1, start: I, end: peak, ease: MOTION.enter })(T)
        : animate({ from: 1, to: 0, start: hold, end: P, ease: MOTION.glide })(T);
      var fadeIn = animate({ from: 0, to: 1, start: R, end: R + 0.2, ease: MOTION.enter })(T);
      return { angle: angle, arc: arc, scale: appear * grow, h: h, opacity: fadeIn };
    }
    // rotation autour de l'axe vertical (gauche → droite), face toujours lisible
    function face(deg) {
      var a = (((deg % 360) + 540) % 360) - 180;
      if (a > 90) a -= 180; else if (a < -90) a += 180;
      return { a: a, shade: 0.82 + 0.18 * Math.abs(Math.cos((a * Math.PI) / 180)) };
    }

    // halo = silhouette du logo remplie de HALO_COLOR (même procédé que useLogoImages), une fois par page
    var GLOW = null, INST = [], t0 = null, raf = 0, numero = 0;
    function preparerHalo(src) {
      var im = new Image();
      im.onload = function () {
        try {
          var n = 256, cv = document.createElement('canvas'); cv.width = cv.height = n;
          var g = cv.getContext('2d');
          g.drawImage(im, 0, 0, n, n);
          g.globalCompositeOperation = 'source-in'; g.fillStyle = HALO_COLOR; g.fillRect(0, 0, n, n);
          GLOW = cv.toDataURL('image/png');
          INST.forEach(function (I) { I.halos.forEach(function (e) { e.src = GLOW; }); });
        } catch (e) { GLOW = null; }
      };
      im.src = src;
    }

    function calque(tag, css) { var e = document.createElement(tag); e.style.cssText = css; if (tag === 'img') { e.alt = ''; e.decoding = 'sync'; } return e; }
    // ⚠️ neutralise les styles qu'un conteneur imposerait à ses img ou à ses span : c'est arrivé avec
    // « .art-auteur img » (disque blanc bordé) et « .art-auteur span » quand la carte auteur était animée
    var PLEIN = 'position:absolute;left:0;top:0;width:100%;height:100%;display:none;margin:0;padding:0;border:0;max-width:none;background:none;border-radius:0;box-shadow:none;object-fit:fill;';
    var SVG = 'http://www.w3.org/2000/svg';
    function monter(img) {
      var parent = img.parentNode, src = img.currentSrc || img.src;
      var I = { img: img, parent: parent, sauve: { pos: parent.style.position, op: img.style.objectPosition }, halos: [], lignes: [], fantomes: [] };
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      var couche = I.couche = calque('span', 'position:absolute;display:block;pointer-events:none;margin:0;padding:0;border:0;transform-origin:50% 50%;opacity:0;transform:scale(0)');
      couche.setAttribute('aria-hidden', 'true');
      couche.className = 'ls-logo-anim';
      // ordre de logo-animation.jsx : halo (passes × 3 calques), traînées, puis le filtre de flou de mouvement
      // et le bloc qu'il floute : reflets (du plus ancien au plus récent) et logo
      for (var i = 0; i < HALO_PASSES * 3; i++) { var h = calque('img', PLEIN); if (GLOW) h.src = GLOW; I.halos.push(h); couche.appendChild(h); }
      SPEED_LINES.forEach(function (l) {
        var d = calque('div', 'position:absolute;display:none;background:linear-gradient(' + (l.side < 0 ? '270deg' : '90deg') + ', ' + LINE_COLOR + ', rgba(217,139,118,0))');
        I.lignes.push(d); couche.appendChild(d);
      });
      // flou de mouvement : flou gaussien HORIZONTAL seulement (stdDeviation « x 0 »), même zone que l'original ;
      // un filtre par logo animé, à identifiant unique (ne pas en partager un si d'autres logos s'animent un jour)
      I.id = 'ls-logo-flou-' + (++numero);
      var svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      svg.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden';
      var filtre = document.createElementNS(SVG, 'filter');
      filtre.setAttribute('id', I.id); filtre.setAttribute('x', '-40%'); filtre.setAttribute('y', '-5%');
      filtre.setAttribute('width', '180%'); filtre.setAttribute('height', '110%'); filtre.setAttribute('color-interpolation-filters', 'sRGB');
      I.fe = document.createElementNS(SVG, 'feGaussianBlur'); I.fe.setAttribute('stdDeviation', '0 0');
      filtre.appendChild(I.fe); svg.appendChild(filtre); couche.appendChild(svg);
      I.flou = calque('span', PLEIN.replace('display:none;', 'display:block;')); couche.appendChild(I.flou);
      for (var j = 0; j < 8; j++) { var f = calque('img', PLEIN); f.src = src; I.fantomes.push(f); I.flou.appendChild(f); }
      I.principal = calque('img', PLEIN.replace('display:none;', 'display:block;')); I.principal.src = src; I.flou.appendChild(I.principal);
      parent.appendChild(couche);
      img.style.objectPosition = '-100000px -100000px';   // le dessin sort de sa boîte : l'image reste, invisible
      return I;
    }
    function demonter(I) {
      if (I.couche.parentNode) I.couche.parentNode.removeChild(I.couche);
      I.img.style.objectPosition = I.sauve.op;
      I.parent.style.position = I.sauve.pos;
      if (!I.img.getAttribute('style')) I.img.removeAttribute('style');
      if (!I.parent.getAttribute('style')) I.parent.removeAttribute('style');
    }

    function dessiner(I, T) {
      var img = I.img, r = img.getBoundingClientRect(), p = I.parent.getBoundingClientRect();
      var w = img.clientWidth, hh = img.clientHeight;
      // k = px à l'écran par unité de l'original ; la boîte de 800 unités est centrée sur le dessin
      var st = logoState(T), k = (w * DESSIN) / DESSIN_ORIGINE, cx = w / 2, cy = hh / 2, px = function (v) { return v + 'px'; };
      var c = I.couche.style;
      c.left = px(r.left + img.clientLeft - p.left - I.parent.clientLeft); c.top = px(r.top + img.clientTop - p.top - I.parent.clientTop);
      c.width = px(w); c.height = px(hh);
      c.transform = 'scale(' + st.scale + ')'; c.opacity = st.opacity;
      var avecHalo = !!GLOW && st.h > 0.001 && O.S > 0;
      I.halos.forEach(function (e, i) {
        changer(e, 'display', avecHalo ? 'block' : 'none');
        if (avecHalo) { var L = HALO_LAYERS[i % 3]; changer(e, 'filter', 'blur(' + (L.blur(3) * HALO_SPREAD * PX_PER_UNIT * k).toFixed(3) + 'px)'); e.style.opacity = Math.min(1, L.op(st.h, 3) * Math.min(1, HALO_G)); }
      });
      var kl = clamp(((st.arc * 60) / 360 - 0.6) / 2.2, 0, 1), R = BOX * 0.49, charge = img.complete && img.naturalWidth > 0;
      I.lignes.forEach(function (e, i) {
        if (kl <= 0.01 || O.lines < 1 || !charge) { changer(e, 'display', 'none'); return; }
        var l = SPEED_LINES[i], edge = Math.sqrt(Math.max(0, 1 - l.y * l.y)) * R;
        var drift = (T * 3.2 + l.phase) % 1, len = l.len * BOX * (0.5 + 0.5 * kl) * O.lineLen, lw = l.w * O.lineW;
        var x = BOX / 2 + l.side * (edge + 16 + drift * 70) - (l.side < 0 ? len : 0);
        var s = e.style; changer(e, 'display', 'block');
        s.left = px(cx + (x - BOX / 2) * k); s.top = px(cy + (l.y * R - lw / 2) * k);
        s.width = px(len * k); s.height = px(lw * k); s.borderRadius = px(lw * k); s.opacity = kl * (1 - drift) * 0.9;
      });
      var n = st.arc < 0.8 ? 0 : Math.min(8, Math.ceil(st.arc / 4)), persp = 'perspective(' + (PERSPECTIVE * k).toFixed(3) + 'px) rotateY(';
      I.fantomes.forEach(function (e, j) {
        if (j >= n) { changer(e, 'display', 'none'); return; }
        var kg = n - j, f = face(st.angle - (st.arc * kg) / n);
        changer(e, 'display', 'block'); e.style.transform = persp + f.a.toFixed(2) + 'deg)';
        e.style.opacity = 0.45 * (1 - kg / (n + 1)); e.style.filter = 'brightness(' + f.shade.toFixed(3) + ')';
      });
      var f0 = face(st.angle);
      I.principal.style.transform = persp + f0.a.toFixed(2) + 'deg)';
      I.principal.style.filter = 'brightness(' + (f0.shade * (1 + 0.2 * st.h * (O.S / 3))).toFixed(3) + ')';
      // flou horizontal proportionnel à la vitesse, en unités de l'original (seuil 0,3 compris), puis ramené à l'écran.
      // Il reste au plafond (60 × 1,2) pendant les 0,8 premières secondes : on ne réécrit le filtre que s'il change
      var flou = Math.min(60, st.arc * 0.7) * O.blur;
      if (flou > 0.3) { var sd = (flou * k).toFixed(3) + ' 0'; if (sd !== I.sd) { I.fe.setAttribute('stdDeviation', sd); I.sd = sd; } }
      changer(I.flou, 'filter', flou > 0.3 ? 'url(#' + I.id + ')' : 'none');
    }
    // n'écrit une propriété de style que si sa valeur change (le navigateur n'a alors rien à recalculer)
    function changer(e, prop, v) { var m = e.__ls || (e.__ls = {}); if (m[prop] !== v) { e.style[prop] = v; m[prop] = v; } }

    function arreter() { if (raf) cancelAnimationFrame(raf); raf = 0; t0 = null; INST.forEach(demonter); INST = []; }
    function image(ts) {
      raf = 0;
      try {
        if (t0 === null) t0 = ts;
        var T = (ts - t0) / 1000;
        if (T >= FIN) { arreter(); return; }   // scène « Pause » : logo immobile = logo fixe d'origine
        INST.forEach(function (I) { dessiner(I, T); });
        raf = requestAnimationFrame(image);
      } catch (e) { arreter(); }              // au moindre incident, le logo fixe revient
    }
    // l'écran de chargement de l'accueil (première visite de la session) : on attend qu'il soit retiré
    function apresEcranDeChargement(go) {
      var s = document.getElementById('splash');
      if (!s || !s.parentNode) { go(); return; }
      var fini = false, garde, obs = new MutationObserver(function () { if (!document.getElementById('splash')) suite(); });
      function suite() { if (fini) return; fini = true; obs.disconnect(); clearTimeout(garde); go(); }
      obs.observe(s.parentNode, { childList: true });
      garde = setTimeout(suite, 8000);   // il se retire au plus tard à 5,3 s
    }
    function lancer() {
      arreter();
      try {
        var imgs = Array.prototype.slice.call(document.querySelectorAll(CHOIX));
        if (!imgs.length) return;
        if (!GLOW) preparerHalo(imgs[0].currentSrc || imgs[0].src);
        INST = imgs.map(monter);
        INST.forEach(function (I) { dessiner(I, 0); });   // première image affichée = état de départ
        apresEcranDeChargement(function () { if (INST.length) raf = requestAnimationFrame(image); });
      } catch (e) { arreter(); }
    }
    window.__lsLogoAnim = {
      duree: FIN,
      rejouer: lancer,
      // essais : fige l'animation à l'instant T (en secondes), sans horloge
      figer: function (T) { if (raf) cancelAnimationFrame(raf); raf = 0; if (!INST.length) { var imgs = Array.prototype.slice.call(document.querySelectorAll(CHOIX)); INST = imgs.map(monter); } INST.forEach(function (I) { dessiner(I, T); }); },
      arreter: arreter
    };
    window.addEventListener('pagehide', arreter);
    window.addEventListener('pageshow', function (e) { if (e.persisted) lancer(); });
    lancer();
  }

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
    i18.src = RACINE + 'assets/i18n.js?v=' + Date.now(); // même stratégie anti-cache qu'account.js
    document.body.appendChild(i18);
  }

  // moteur de l'espace documents (compte + notifications) sur toutes les pages
  if (!window.__lsAccountLoaded) {
    window.__lsAccountLoaded = true;
    var acc = document.createElement('script');
    // cache-buster horodaté : account.js est injecté dynamiquement (le hard-refresh ne le
    // rafraîchit pas) → on force une URL unique pour toujours charger la dernière version,
    // y compris derrière le CDN Cloudflare.
    acc.src = RACINE + 'assets/account.js?v=' + Date.now();
    document.body.appendChild(acc);
  }
})();
