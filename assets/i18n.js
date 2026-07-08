/* ============================================================================
   i18n Languages & Success — moteur de traduction du site
   - Français = langue source (le HTML reste en FR).
   - Dictionnaires par langue dans assets/i18n-{en,es,it,ru,zh}.js, chargés À LA
     DEMANDE (un visiteur FR ne charge rien). Chaque fichier appelle
     window.__lsI18N.register('xx', {...}).
   - Clés = « texte français normalisé » (apostrophes ’→', espaces réduits, trim).
   - Le moteur traduit les nœuds texte + attributs (placeholder/title/aria-label/alt).
   - Tout élément sous [data-i18n-skip] n'est JAMAIS touché (questions du test de
     niveau + teaser : la langue TESTÉE ne change pas avec la langue du SITE).
   - MutationObserver : le DOM injecté après coup (menus, modals, quiz, espace
     documents) est traduit aussi tant que la langue courante n'est pas le FR.
   - Persistance : localStorage 'ls-lang'. API : window.__lsI18N.set('en'|...).
   ============================================================================ */
(function () {
  'use strict';
  var CODES = { fr: 'FR', en: 'EN', es: 'ES', it: 'IT', ru: 'RU', zh: '中文' };
  var HTML_LANG = { fr: 'fr', en: 'en', es: 'es', it: 'it', ru: 'ru', zh: 'zh-Hans' };
  function norm(s) { return String(s).replace(/’/g, "'").replace(/\s+/g, ' ').trim(); }

  var D = {};            // dictionnaires chargés
  var cur = 'fr';
  var pending = null;    // langue demandée dont le dictionnaire charge encore
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
  function doApply(lang) {
    cur = lang;
    try { localStorage.setItem('ls-lang', lang); } catch (e) {}
    document.documentElement.setAttribute('lang', HTML_LANG[lang]);
    applyTo(document.body);
    refreshUI();
  }
  function set(lang) {
    if (!CODES[lang]) return;
    if (lang !== 'fr' && !D[lang]) {
      pending = lang;
      try { localStorage.setItem('ls-lang', lang); } catch (e) {}
      if (!document.getElementById('ls-dict-' + lang)) {
        var s = document.createElement('script');
        s.id = 'ls-dict-' + lang;
        s.src = 'assets/i18n-' + lang + '.js?v=' + Date.now(); // même anti-cache qu'account.js
        document.body.appendChild(s);
      }
      return; // register() appliquera à l'arrivée du dictionnaire
    }
    pending = null;
    doApply(lang);
  }
  function register(lang, dict) {
    D[lang] = dict || {};
    if (pending === lang) { pending = null; doApply(lang); }
  }
  /* le DOM injecté après coup (menus, modals, quiz, espace documents) est traduit aussi */
  new MutationObserver(function (muts) {
    if (cur === 'fr') return;
    for (var m = 0; m < muts.length; m++) {
      for (var i = 0; i < muts[m].addedNodes.length; i++) applyTo(muts[m].addedNodes[i]);
    }
  }).observe(document.body, { childList: true, subtree: true });

  window.__lsI18N = { set: set, register: register, get: function () { return cur; } };
  var saved = 'fr';
  try { saved = localStorage.getItem('ls-lang') || 'fr'; } catch (e) {}
  if (saved !== 'fr' && CODES[saved]) set(saved); else refreshUI();
})();
