/* ============================================================================
   i18n Languages & Success — sélecteur de langue du site (header)
   - Français = langue source (le HTML reste en FR).
   - Dictionnaires par langue : « texte français normalisé » -> traduction.
   - Le moteur remplace les nœuds texte + attributs (placeholder/title/aria-label/alt)
     dont le texte correspond EXACTEMENT à une clé (apostrophes/espaces normalisés).
   - Tout élément sous [data-i18n-skip] n'est JAMAIS touché (questions du test de
     niveau : la langue TESTÉE ne doit pas changer avec la langue du SITE).
   - Un MutationObserver traduit aussi le DOM injecté après coup (menus, modals,
     espace documents) tant que la langue courante n'est pas le français.
   - Persistance : localStorage 'ls-lang'. API : window.__lsI18N.set('en'|...).
   Pour traduire une nouvelle zone : ajouter simplement ses textes aux dictionnaires.
   ============================================================================ */
(function () {
  'use strict';
  var CODES = { fr: 'FR', en: 'EN', es: 'ES', it: 'IT', ru: 'RU', zh: '中文' };
  var HTML_LANG = { fr: 'fr', en: 'en', es: 'es', it: 'it', ru: 'ru', zh: 'zh-Hans' };
  function norm(s) { return String(s).replace(/’/g, "'").replace(/\s+/g, ' ').trim(); }

  /* -------- dictionnaires (clés = texte FR normalisé) ---------------------- */
  var D = {
    en: {
      'Formations': 'Courses', 'Financement': 'Funding', 'Entreprises': 'Companies', 'À propos': 'About us', 'Blog': 'Blog',
      'Faire le test': 'Take the test', 'Nous contacter': 'Contact us', 'Se connecter': 'Sign in', 'Créer un compte': 'Create an account',
      'Espace documents': 'Document portal', 'Mon espace': 'My account', 'Se déconnecter': 'Sign out',
      'Ouvrir le menu': 'Open menu', 'Fermer le menu': 'Close menu', 'Langue': 'Language', 'Choisir la langue du site': 'Choose the site language',
      'Organisme de formation en langues, certifié Qualiopi. Des parcours sur mesure pour les particuliers, les salariés et les entreprises.': 'Language training organisation, Qualiopi certified. Tailor-made programmes for individuals, employees and companies.',
      'Ressources': 'Resources', 'Suivez-nous': 'Follow us', 'Nos langues': 'Our languages', 'Formats & certifications': 'Formats & certifications',
      'Entreprises & RH': 'Companies & HR', 'Test de niveau': 'Level test', 'Contact': 'Contact',
      "La certification qualité a été délivrée au titre de la catégorie d'action suivante : ACTIONS DE FORMATION.": 'The Qualiopi quality certification was issued for the following category of activity: TRAINING ACTIVITIES.',
      "⬇ Télécharger l'attestation Qualiopi (PDF)": '⬇ Download the Qualiopi certificate (PDF)',
      '⬇ Télécharger la charte de déontologie CPF (PDF)': '⬇ Download the CPF code of conduct charter (PDF)',
      "Déclaration d'activité enregistrée sous le n° 93 060 886 106 auprès du Préfet de la région PACA. Cet enregistrement ne vaut pas agrément de l'État.": 'Training provider registered under no. 93 060 886 106 with the Prefect of the PACA region. This registration does not constitute State approval.',
      'Conditions générales': 'Terms and conditions', 'Politique de confidentialité': 'Privacy policy', 'Règlement intérieur': 'Internal regulations', 'Mentions légales': 'Legal notice',
      'Tous droits réservés.': 'All rights reserved.'
    },
    es: {
      'Formations': 'Cursos', 'Financement': 'Financiación', 'Entreprises': 'Empresas', 'À propos': 'Quiénes somos', 'Blog': 'Blog',
      'Faire le test': 'Hacer el test', 'Nous contacter': 'Contáctenos', 'Se connecter': 'Iniciar sesión', 'Créer un compte': 'Crear una cuenta',
      'Espace documents': 'Portal de documentos', 'Mon espace': 'Mi espacio', 'Se déconnecter': 'Cerrar sesión',
      'Ouvrir le menu': 'Abrir el menú', 'Fermer le menu': 'Cerrar el menú', 'Langue': 'Idioma', 'Choisir la langue du site': 'Elegir el idioma del sitio',
      'Organisme de formation en langues, certifié Qualiopi. Des parcours sur mesure pour les particuliers, les salariés et les entreprises.': 'Organismo de formación en idiomas, certificado Qualiopi. Programas a medida para particulares, empleados y empresas.',
      'Ressources': 'Recursos', 'Suivez-nous': 'Síguenos', 'Nos langues': 'Nuestros idiomas', 'Formats & certifications': 'Formatos y certificaciones',
      'Entreprises & RH': 'Empresas y RR. HH.', 'Test de niveau': 'Test de nivel', 'Contact': 'Contacto',
      "La certification qualité a été délivrée au titre de la catégorie d'action suivante : ACTIONS DE FORMATION.": 'La certificación de calidad Qualiopi se expidió para la siguiente categoría de acción: ACCIONES DE FORMACIÓN.',
      "⬇ Télécharger l'attestation Qualiopi (PDF)": '⬇ Descargar el certificado Qualiopi (PDF)',
      '⬇ Télécharger la charte de déontologie CPF (PDF)': '⬇ Descargar la carta de deontología CPF (PDF)',
      "Déclaration d'activité enregistrée sous le n° 93 060 886 106 auprès du Préfet de la région PACA. Cet enregistrement ne vaut pas agrément de l'État.": 'Declaración de actividad registrada con el n.º 93 060 886 106 ante el Prefecto de la región PACA. Este registro no equivale a una acreditación del Estado.',
      'Conditions générales': 'Condiciones generales', 'Politique de confidentialité': 'Política de privacidad', 'Règlement intérieur': 'Reglamento interno', 'Mentions légales': 'Aviso legal',
      'Tous droits réservés.': 'Todos los derechos reservados.'
    },
    it: {
      'Formations': 'Corsi', 'Financement': 'Finanziamenti', 'Entreprises': 'Aziende', 'À propos': 'Chi siamo', 'Blog': 'Blog',
      'Faire le test': 'Fai il test', 'Nous contacter': 'Contattaci', 'Se connecter': 'Accedi', 'Créer un compte': 'Crea un account',
      'Espace documents': 'Area documenti', 'Mon espace': 'La mia area', 'Se déconnecter': 'Esci',
      'Ouvrir le menu': 'Apri il menu', 'Fermer le menu': 'Chiudi il menu', 'Langue': 'Lingua', 'Choisir la langue du site': 'Scegli la lingua del sito',
      'Organisme de formation en langues, certifié Qualiopi. Des parcours sur mesure pour les particuliers, les salariés et les entreprises.': 'Ente di formazione linguistica certificato Qualiopi. Percorsi su misura per privati, dipendenti e aziende.',
      'Ressources': 'Risorse', 'Suivez-nous': 'Seguici', 'Nos langues': 'Le nostre lingue', 'Formats & certifications': 'Formati e certificazioni',
      'Entreprises & RH': 'Aziende e HR', 'Test de niveau': 'Test di livello', 'Contact': 'Contatti',
      "La certification qualité a été délivrée au titre de la catégorie d'action suivante : ACTIONS DE FORMATION.": 'La certificazione di qualità Qualiopi è stata rilasciata per la seguente categoria di azione: AZIONI DI FORMAZIONE.',
      "⬇ Télécharger l'attestation Qualiopi (PDF)": "⬇ Scarica l'attestazione Qualiopi (PDF)",
      '⬇ Télécharger la charte de déontologie CPF (PDF)': '⬇ Scarica la carta deontologica CPF (PDF)',
      "Déclaration d'activité enregistrée sous le n° 93 060 886 106 auprès du Préfet de la région PACA. Cet enregistrement ne vaut pas agrément de l'État.": 'Dichiarazione di attività registrata con il n. 93 060 886 106 presso il Prefetto della regione PACA. Tale registrazione non costituisce approvazione statale.',
      'Conditions générales': 'Condizioni generali', 'Politique de confidentialité': 'Informativa sulla privacy', 'Règlement intérieur': 'Regolamento interno', 'Mentions légales': 'Note legali',
      'Tous droits réservés.': 'Tutti i diritti riservati.'
    },
    ru: {
      'Formations': 'Курсы', 'Financement': 'Финансирование', 'Entreprises': 'Компаниям', 'À propos': 'О нас', 'Blog': 'Блог',
      'Faire le test': 'Пройти тест', 'Nous contacter': 'Связаться с нами', 'Se connecter': 'Войти', 'Créer un compte': 'Создать аккаунт',
      'Espace documents': 'Раздел документов', 'Mon espace': 'Мой кабинет', 'Se déconnecter': 'Выйти',
      'Ouvrir le menu': 'Открыть меню', 'Fermer le menu': 'Закрыть меню', 'Langue': 'Язык', 'Choisir la langue du site': 'Выбрать язык сайта',
      'Organisme de formation en langues, certifié Qualiopi. Des parcours sur mesure pour les particuliers, les salariés et les entreprises.': 'Организация языкового обучения с сертификатом Qualiopi. Индивидуальные программы для частных лиц, сотрудников и компаний.',
      'Ressources': 'Ресурсы', 'Suivez-nous': 'Мы в соцсетях', 'Nos langues': 'Наши языки', 'Formats & certifications': 'Форматы и сертификаты',
      'Entreprises & RH': 'Компании и HR', 'Test de niveau': 'Тест уровня', 'Contact': 'Контакты',
      "La certification qualité a été délivrée au titre de la catégorie d'action suivante : ACTIONS DE FORMATION.": 'Сертификат качества Qualiopi выдан по следующей категории деятельности: ОБРАЗОВАТЕЛЬНЫЕ УСЛУГИ.',
      "⬇ Télécharger l'attestation Qualiopi (PDF)": '⬇ Скачать сертификат Qualiopi (PDF)',
      '⬇ Télécharger la charte de déontologie CPF (PDF)': '⬇ Скачать хартию деонтологии CPF (PDF)',
      "Déclaration d'activité enregistrée sous le n° 93 060 886 106 auprès du Préfet de la région PACA. Cet enregistrement ne vaut pas agrément de l'État.": 'Деятельность зарегистрирована под № 93 060 886 106 у префекта региона PACA. Данная регистрация не является государственной аккредитацией.',
      'Conditions générales': 'Общие условия', 'Politique de confidentialité': 'Политика конфиденциальности', 'Règlement intérieur': 'Внутренний регламент', 'Mentions légales': 'Правовая информация',
      'Tous droits réservés.': 'Все права защищены.'
    },
    zh: {
      'Formations': '课程', 'Financement': '资助', 'Entreprises': '企业', 'À propos': '关于我们', 'Blog': '博客',
      'Faire le test': '开始测试', 'Nous contacter': '联系我们', 'Se connecter': '登录', 'Créer un compte': '创建账户',
      'Espace documents': '文档空间', 'Mon espace': '我的空间', 'Se déconnecter': '退出登录',
      'Ouvrir le menu': '打开菜单', 'Fermer le menu': '关闭菜单', 'Langue': '语言', 'Choisir la langue du site': '选择网站语言',
      'Organisme de formation en langues, certifié Qualiopi. Des parcours sur mesure pour les particuliers, les salariés et les entreprises.': '经 Qualiopi 认证的语言培训机构，为个人、员工和企业提供量身定制的课程。',
      'Ressources': '资源', 'Suivez-nous': '关注我们', 'Nos langues': '我们的语言', 'Formats & certifications': '形式与认证',
      'Entreprises & RH': '企业与人力资源', 'Test de niveau': '水平测试', 'Contact': '联系方式',
      "La certification qualité a été délivrée au titre de la catégorie d'action suivante : ACTIONS DE FORMATION.": 'Qualiopi 质量认证颁发类别：培训活动。',
      "⬇ Télécharger l'attestation Qualiopi (PDF)": '⬇ 下载 Qualiopi 认证证书 (PDF)',
      '⬇ Télécharger la charte de déontologie CPF (PDF)': '⬇ 下载 CPF 职业道德章程 (PDF)',
      "Déclaration d'activité enregistrée sous le n° 93 060 886 106 auprès du Préfet de la région PACA. Cet enregistrement ne vaut pas agrément de l'État.": '培训机构已在 PACA 大区省长处登记，编号 93 060 886 106。该登记不构成国家认可。',
      'Conditions générales': '一般条款', 'Politique de confidentialité': '隐私政策', 'Règlement intérieur': '内部规章', 'Mentions légales': '法律声明',
      'Tous droits réservés.': '版权所有。'
    }
  };

  /* -------- moteur --------------------------------------------------------- */
  var cur = 'fr';
  var SKIPTAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function inSkip(el) { return !!(el && el.closest && el.closest('[data-i18n-skip]')); }

  function trText(node) {
    var src = node.__lsSrc != null ? node.__lsSrc : node.nodeValue;
    if (cur === 'fr') { if (node.__lsSrc != null) node.nodeValue = node.__lsSrc; return; }
    var t = D[cur] && D[cur][norm(src)];
    if (t != null) { if (node.__lsSrc == null) node.__lsSrc = node.nodeValue; node.nodeValue = t; }
    else if (node.__lsSrc != null) { node.nodeValue = node.__lsSrc; }
  }
  function trAttrs(el) {
    if (!el.hasAttribute || inSkip(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      el.__lsA = el.__lsA || {};
      var src = (a in el.__lsA) ? el.__lsA[a] : el.getAttribute(a);
      if (cur === 'fr') { if (a in el.__lsA) el.setAttribute(a, el.__lsA[a]); continue; }
      var t = D[cur] && D[cur][norm(src)];
      if (t != null) { if (!(a in el.__lsA)) el.__lsA[a] = src; el.setAttribute(a, t); }
      else if (a in el.__lsA) { el.setAttribute(a, el.__lsA[a]); }
    }
  }
  function applyTo(root) {
    if (!root) return;
    if (root.nodeType === 3) { var p = root.parentElement; if (p && !SKIPTAG[p.tagName] && !inSkip(p) && norm(root.nodeValue)) trText(root); return; }
    if (root.nodeType !== 1 || SKIPTAG[root.tagName] || inSkip(root)) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n, list = [];
    while ((n = w.nextNode())) list.push(n);
    for (var i = 0; i < list.length; i++) {
      var t = list[i], pe = t.parentElement;
      if (!pe || SKIPTAG[pe.tagName] || inSkip(pe) || !norm(t.nodeValue)) continue;
      trText(t);
    }
    trAttrs(root);
    var withAttr = root.querySelectorAll('[placeholder],[title],[aria-label],[alt]');
    for (var j = 0; j < withAttr.length; j++) trAttrs(withAttr[j]);
  }
  function refreshUI() {
    document.querySelectorAll('.lang-cur').forEach(function (el) { el.textContent = CODES[cur] || cur.toUpperCase(); });
    document.querySelectorAll('[data-lang]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-lang') === cur); });
  }
  function set(lang) {
    if (!CODES[lang]) return;
    cur = lang;
    try { localStorage.setItem('ls-lang', lang); } catch (e) {}
    document.documentElement.setAttribute('lang', HTML_LANG[lang]);
    applyTo(document.body);
    refreshUI();
  }
  /* le DOM injecté après coup (menus, modals, espace documents) est traduit aussi */
  new MutationObserver(function (muts) {
    if (cur === 'fr') return;
    for (var m = 0; m < muts.length; m++) {
      for (var i = 0; i < muts[m].addedNodes.length; i++) applyTo(muts[m].addedNodes[i]);
    }
  }).observe(document.body, { childList: true, subtree: true });

  window.__lsI18N = { set: set, get: function () { return cur; } };
  var saved = 'fr';
  try { saved = localStorage.getItem('ls-lang') || 'fr'; } catch (e) {}
  if (saved !== 'fr' && CODES[saved]) set(saved); else refreshUI();
})();
