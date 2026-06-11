/* ============================================================================
   L&S — moteur partagé
   - Header qui passe en blur au scroll  (#site-header .scrolled)
   - Indicateur "Scroll to explore"       (#scroll-indicator .visible)
   - Panneau Tweaks (police + couleur), persistance localStorage, protocole hôte
   Chaque page définit window.LS_CONFIG avant de charger ce script.
   ============================================================================ */
(function () {
  'use strict';
  var CFG = window.LS_CONFIG || {};
  var KEY = 'ls-tweaks-' + (CFG.key || 'default');

  /* ---------- 1. Header blur au scroll -------------------------------- */
  (function () {
    var header = document.getElementById('site-header');
    if (!header) return;
    var onScroll = function () {
      header.classList.toggle('scrolled', window.scrollY > 24);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  })();

  /* ---------- 2. Scroll to explore ------------------------------------ */
  (function () {
    var ind = document.getElementById('scroll-indicator');
    if (!ind) return;
    var REAPPEAR = 6000, timer = null;
    var scheduleShow = function (delay) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        if (window.scrollY <= 60) ind.classList.add('visible');
        timer = null;
      }, delay);
    };
    var onScroll = function () {
      if (window.scrollY > 60) {
        if (timer) { clearTimeout(timer); timer = null; }
        ind.classList.remove('visible');
      } else if (!ind.classList.contains('visible') && !timer) {
        scheduleShow(REAPPEAR);
      }
    };
    scheduleShow(900);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  })();

  /* ---------- 3. Reveal au scroll (data-reveal) ----------------------- */
  (function () {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  })();

  /* ---------- 4. Tweaks : état + application -------------------------- */
  var fonts = CFG.fonts || [];
  var accents = CFG.accents || [];
  var slogans = CFG.slogans || [];
  var state = { font: 0, accent: 0, slogan: 0 };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (typeof saved.font === 'number') state.font = saved.font;
    if (typeof saved.accent === 'number') state.accent = saved.accent;
    if (typeof saved.slogan === 'number') state.slogan = saved.slogan;
  } catch (e) {}
  if (state.font >= fonts.length) state.font = 0;
  if (state.accent >= accents.length) state.accent = 0;
  if (state.slogan >= slogans.length) state.slogan = 0;

  function apply() {
    var root = document.documentElement;
    if (fonts[state.font]) {
      root.style.setProperty('--ff-head', fonts[state.font].head);
      root.style.setProperty('--ff-body', fonts[state.font].body);
    }
    if (accents[state.accent]) {
      root.style.setProperty('--accent', accents[state.accent].value);
      if (accents[state.accent].ink) root.style.setProperty('--accent-ink', accents[state.accent].ink);
    }
    if (slogans.length) {
      var tgt = document.getElementById('ls-slogan');
      if (tgt && slogans[state.slogan]) tgt.innerHTML = slogans[state.slogan].html;
    }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  apply();

  /* ---------- 5. Panneau Tweaks (vanilla) ----------------------------- */
  var STYLE = '\
  .twk{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:268px;\
    background:rgba(252,251,249,.82);color:#23201b;\
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);\
    border:.5px solid rgba(255,255,255,.65);border-radius:14px;\
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 14px 44px rgba(0,0,0,.20);\
    font:12px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden;display:none}\
  .twk.open{display:block}\
  .twk-hd{display:flex;align-items:center;justify-content:space-between;padding:11px 9px 11px 15px;cursor:move;user-select:none}\
  .twk-hd b{font-size:12.5px;font-weight:650;letter-spacing:.01em}\
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(35,32,27,.5);width:24px;height:24px;border-radius:7px;cursor:pointer;font-size:15px;line-height:1}\
  .twk-x:hover{background:rgba(0,0,0,.06);color:#23201b}\
  .twk-body{padding:0 15px 16px;display:flex;flex-direction:column;gap:13px}\
  .twk-sect{font-size:10px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:rgba(35,32,27,.42);margin-bottom:-4px}\
  .twk-opt{display:flex;flex-direction:column;gap:6px}\
  .twk-pill{appearance:none;text-align:left;border:.5px solid rgba(0,0,0,.1);background:rgba(255,255,255,.55);\
    color:inherit;border-radius:9px;padding:8px 11px;cursor:pointer;font:inherit;display:flex;align-items:center;gap:10px;transition:border-color .15s,background .15s}\
  .twk-pill:hover{background:rgba(255,255,255,.85)}\
  .twk-pill.sel{border-color:var(--twk-sel,#23201b);background:#fff;box-shadow:0 0 0 1px var(--twk-sel,#23201b) inset}\
  .twk-pill .nm{font-weight:550}\
  .twk-pill .pv{margin-left:auto;font-size:15px;opacity:.85}\
  .twk-sw{display:flex;flex-wrap:wrap;gap:8px}\
  .twk-chip{width:30px;height:30px;border-radius:50%;cursor:pointer;border:2px solid transparent;box-shadow:0 0 0 1px rgba(0,0,0,.12);transition:transform .12s}\
  .twk-chip:hover{transform:scale(1.08)}\
  .twk-chip.sel{border-color:#fff;box-shadow:0 0 0 2px #23201b}\
  .twk-note{font-size:10.5px;color:rgba(35,32,27,.45);line-height:1.4}';

  function buildPanel() {
    if (!fonts.length && !accents.length && !slogans.length) return;
    var st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);

    var panel = document.createElement('div'); panel.className = 'twk';
    var hd = document.createElement('div'); hd.className = 'twk-hd';
    hd.innerHTML = '<b>Tweaks</b>';
    var x = document.createElement('button'); x.className = 'twk-x'; x.innerHTML = '&times;'; x.title = 'Fermer';
    hd.appendChild(x); panel.appendChild(hd);

    var body = document.createElement('div'); body.className = 'twk-body';

    if (slogans.length) {
      var ss = document.createElement('div'); ss.className = 'twk-sect'; ss.textContent = 'Slogan'; body.appendChild(ss);
      var so = document.createElement('div'); so.className = 'twk-opt';
      slogans.forEach(function (s, i) {
        var b = document.createElement('button'); b.className = 'twk-pill' + (i === state.slogan ? ' sel' : '');
        b.innerHTML = '<span class="nm">' + s.label + '</span>';
        b.onclick = function () {
          state.slogan = i; apply(); persist(); notify();
          so.querySelectorAll('.twk-pill').forEach(function (el) { el.classList.remove('sel'); });
          b.classList.add('sel');
        };
        so.appendChild(b);
      });
      body.appendChild(so);
    }

    if (fonts.length) {
      var fs = document.createElement('div'); fs.className = 'twk-sect'; fs.textContent = 'Police'; body.appendChild(fs);
      var fo = document.createElement('div'); fo.className = 'twk-opt';
      fonts.forEach(function (f, i) {
        var b = document.createElement('button'); b.className = 'twk-pill' + (i === state.font ? ' sel' : '');
        b.innerHTML = '<span class="nm" style="font-family:' + f.head + '">' + f.label + '</span><span class="pv" style="font-family:' + f.head + '">Aa</span>';
        b.onclick = function () {
          state.font = i; apply(); persist(); notify();
          fo.querySelectorAll('.twk-pill').forEach(function (el) { el.classList.remove('sel'); });
          b.classList.add('sel');
        };
        fo.appendChild(b);
      });
      body.appendChild(fo);
    }

    if (accents.length) {
      var as = document.createElement('div'); as.className = 'twk-sect'; as.textContent = 'Couleur d\'accent'; body.appendChild(as);
      var sw = document.createElement('div'); sw.className = 'twk-sw';
      accents.forEach(function (a, i) {
        var c = document.createElement('div'); c.className = 'twk-chip' + (i === state.accent ? ' sel' : '');
        c.style.background = a.value; c.title = a.label;
        c.onclick = function () {
          state.accent = i; apply(); persist(); notify();
          sw.querySelectorAll('.twk-chip').forEach(function (el) { el.classList.remove('sel'); });
          c.classList.add('sel');
        };
        sw.appendChild(c);
      });
      body.appendChild(sw);
    }

    var note = document.createElement('div'); note.className = 'twk-note';
    note.textContent = 'Réglages enregistrés sur cet appareil.';
    body.appendChild(note);
    panel.appendChild(body);
    document.body.appendChild(panel);

    // drag
    (function () {
      var dragging = false, ox = 0, oy = 0;
      hd.addEventListener('mousedown', function (e) {
        if (e.target === x) return;
        dragging = true; var r = panel.getBoundingClientRect();
        ox = e.clientX - r.left; oy = e.clientY - r.top;
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
        panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
        e.preventDefault();
      });
      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        panel.style.left = Math.max(6, e.clientX - ox) + 'px';
        panel.style.top = Math.max(6, e.clientY - oy) + 'px';
      });
      window.addEventListener('mouseup', function () { dragging = false; });
    })();

    function open() { panel.classList.add('open'); }
    function close() { panel.classList.remove('open'); }
    x.onclick = function () { close(); window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); };

    window.addEventListener('message', function (e) {
      var t = e && e.data && e.data.type;
      if (t === '__activate_edit_mode') open();
      else if (t === '__deactivate_edit_mode') close();
    });
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');

    function notify() {
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { font: state.font, accent: state.accent, slogan: state.slogan } }, '*');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();
})();
