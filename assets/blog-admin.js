/* ============================================================================
   Blog — pilotage par l'administration.
   Ce script ne fait qu'ajouter des COMMANDES sur une page déjà rendue par le serveur :
   la grille des articles, brouillons compris, est injectée côté serveur selon le rôle
   (cf. blogIndexHtml dans server.js). Un non-admin ne reçoit donc jamais un brouillon,
   même si ce script était modifié dans son navigateur.
   ============================================================================ */
(function () {
  'use strict';
  var TKEY = 'lsx_token';
  function token() { try { return localStorage.getItem(TKEY) || ''; } catch (e) { return ''; } }
  if (!token()) return;                       // visiteur non connecté : rien à faire

  var API = '/api/blog/articles';
  function api(url, methode, corps) {
    return fetch(url, {
      method: methode || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + token() }, corps ? { 'Content-Type': 'application/json' } : {}),
      body: corps ? JSON.stringify(corps) : undefined
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }, function () { return { ok: r.ok, data: {} }; }); });
  }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };

  // ---- petites boîtes de dialogue (mêmes styles que l'espace documents) -----
  function dialogue(opts) {
    var d = document.createElement('div');
    d.className = 'notif-modal confirm-modal open';
    d.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card confirm-card"><h3>' + esc(opts.titre) + '</h3>' +
      '<p>' + esc(opts.message || '') + '</p>' + (opts.champ || '') +
      '<div class="confirm-actions"><button class="btn btn-ghost d-non" type="button">' + esc(opts.annuler || 'Annuler') + '</button>' +
      '<button class="btn btn-primary d-oui" type="button">' + esc(opts.confirmer || 'Confirmer') + '</button></div></div>';
    document.body.appendChild(d);
    function fermer() { if (d.parentNode) d.remove(); }
    d.querySelector('.d-non').onclick = fermer;
    d.querySelector('.nm-backdrop').onclick = fermer;
    d.querySelector('.d-oui').onclick = function () { var v = d.querySelector('#d-val'); fermer(); opts.onOui(v ? v.value : null); };
    var f = d.querySelector('#d-val'); if (f) setTimeout(function () { f.focus(); }, 60);
    return d;
  }
  function info(msg) { dialogue({ titre: 'Information', message: msg, confirmer: 'OK', annuler: 'Fermer', onOui: function () {} }); }

  // ---- rendu des commandes --------------------------------------------------
  function barre(nb) {
    var b = document.createElement('div');
    b.className = 'blog-adm';
    b.innerHTML = '<h4>Administration du blog</h4>' +
      '<span class="sep"></span>' +
      '<span style="font-size:13px;color:var(--ink-soft)">' + nb + ' article' + (nb > 1 ? 's' : '') + ' au total, brouillons compris</span>' +
      '<button class="btn-mini adm-nouvel" type="button">+ Nouvel article</button>';
    return b;
  }

  // `apres` = ce qu'on fait une fois l'action passée. Sur la grille on recharge la page ;
  // sur la page d'un article il faut suivre l'article, dont l'adresse et la visibilité viennent
  // de changer (un article repassé en brouillon n'est plus servi sans jeton).
  function actions(art, apres) {
    apres = apres || recharger;
    var w = document.createElement('div');
    w.className = 'post-acts';
    var boutons = [];
    if (art.statut !== 'publie' || !art.enLigne) boutons.push('<button class="go a-publier" type="button">Publier</button>');
    if (art.statut !== 'programme') boutons.push('<button class="a-programmer" type="button">Programmer</button>');
    if (art.enLigne || art.statut === 'programme') boutons.push('<button class="a-brouillon" type="button">Repasser en brouillon</button>');
    boutons.push('<button class="a-modifier" type="button">Modifier</button>');
    boutons.push('<button class="a-dupliquer" type="button">Dupliquer</button>');
    boutons.push('<button class="danger a-supprimer" type="button">Supprimer</button>');
    w.innerHTML = boutons.join('');

    w.querySelector('.a-publier') && (w.querySelector('.a-publier').onclick = function () {
      dialogue({
        titre: 'Publier cet article ?', confirmer: 'Publier', annuler: 'Annuler',
        message: '« ' + art.titre +' » sera visible de tous, immédiatement, et une publication partira sur les réseaux configurés.',
        onOui: function () { api(API + '/' + art.id + '/publier', 'POST', {}).then(apres); }
      });
    });
    w.querySelector('.a-programmer') && (w.querySelector('.a-programmer').onclick = function () {
      var d = new Date(Date.now() + 864e5); d.setSeconds(0, 0);
      var val = d.toISOString().slice(0, 16);
      dialogue({
        titre: 'Programmer la publication', confirmer: 'Programmer', annuler: 'Annuler',
        message: 'L’article partira tout seul à la date choisie — le serveur s’en charge, même si votre ordinateur est éteint.',
        // le champ datetime-local est interprété dans le fuseau du navigateur, donc à l'heure de
        // Paris depuis Nice ; le serveur, lui, compare des millisecondes absolues et affiche
        // toujours la date à l'heure de Paris (cf. artDateLisible dans server.js)
        champ: '<label class="gf" style="margin-top:14px;display:block">Date et heure <small style="font-weight:400;color:var(--ink-soft)">— heure de Paris</small><input id="d-val" type="datetime-local" value="' + val + '" /></label>',
        onOui: function (v) {
          if (!v) return;
          api(API + '/' + art.id + '/publier', 'POST', { datePublication: new Date(v).toISOString() }).then(apres);
        }
      });
    });
    w.querySelector('.a-brouillon') && (w.querySelector('.a-brouillon').onclick = function () {
      dialogue({
        titre: 'Repasser en brouillon ?', confirmer: 'Repasser en brouillon', annuler: 'Annuler',
        message: '« ' + art.titre + ' » sortira du blog. Rien n’est perdu : vous seul continuerez à le voir.',
        onOui: function () { api(API + '/' + art.id + '/depublier', 'POST', {}).then(apres); }
      });
    });
    w.querySelector('.a-dupliquer').onclick = function () {
      dialogue({
        titre: 'Dupliquer cet article ?', confirmer: 'Dupliquer', annuler: 'Annuler',
        message: 'Une copie sera créée en brouillon, sous le titre « Copie — ' + art.titre + ' ». L’original n’est pas touché.',
        // on suit toujours la COPIE : c'est elle qu'on veut retravailler, et elle est en brouillon
        // (donc son adresse a besoin du jeton pour être ouverte).
        onOui: function () {
          api(API + '/' + art.id + '/dupliquer', 'POST', {}).then(function (r) {
            if (!r.ok || !r.data.article) { info((r.data && r.data.error) || 'Duplication impossible.'); return; }
            location.href = '/blog/' + r.data.article.slug + '?token=' + encodeURIComponent(token());
          });
        }
      });
    };
    w.querySelector('.a-supprimer').onclick = function () {
      dialogue({
        titre: 'Supprimer définitivement ?', confirmer: 'Supprimer', annuler: 'Annuler',
        message: '« ' + art.titre + ' » sera effacé. Cette action est irréversible.',
        // après une suppression il n'y a plus de page où revenir : on repart du blog
        onOui: function () { api(API + '/' + art.id, 'DELETE').then(function () { if (SUR_PAGE) location.href = '/blog.html'; else recharger(); }); }
      });
    };
    w.querySelector('.a-modifier').onclick = function () { ouvrirEditeur(art.id, apres); };
    return w;
  }

  // ---- éditeur --------------------------------------------------------------
  function champ(id, libelle, valeur, aide) {
    return '<label class="gf gf-full">' + esc(libelle) + (aide ? ' <small style="font-weight:400;color:var(--ink-soft)">' + esc(aide) + '</small>' : '') +
      '<input id="' + id + '" value="' + esc(valeur || '') + '" /></label>';
  }
  function zone(id, libelle, valeur, lignes, aide) {
    return '<label class="gf gf-full">' + esc(libelle) + (aide ? ' <small style="font-weight:400;color:var(--ink-soft)">' + esc(aide) + '</small>' : '') +
      '<textarea id="' + id + '" rows="' + (lignes || 4) + '">' + esc(valeur || '') + '</textarea></label>';
  }

  function ouvrirEditeur(id, apres) {
    apres = apres || recharger;
    var charger = id ? api(API + '/' + id) : Promise.resolve({ ok: true, data: { article: {} } });
    charger.then(function (r) {
      var a = (r.data && r.data.article) || {};
      var m = document.createElement('div');
      m.className = 'notif-modal open';
      m.innerHTML = '<div class="nm-backdrop"></div><div class="nm-card gen-card gen-full">' +
        '<div class="nm-head"><h3>' + (id ? 'Modifier l’article' : 'Nouvel article') + '</h3><button class="nm-close" type="button" aria-label="Fermer">&times;</button></div>' +
        '<div class="nm-body">' +
          '<h4 class="gen-h">L’essentiel</h4><div class="gf-grid">' +
          champ('e-titre', 'Titre', a.titre) +
          champ('e-cat', 'Catégorie', a.categorie || 'Conseils') +
          zone('e-chapo', 'Chapô', a.chapo, 2, '— une phrase, affichée sous le titre et sur la carte') +
          '</div>' +
          '<h4 class="gen-h">Référencement</h4><div class="gf-grid">' +
          champ('e-motcle', 'Mot-clé principal', a.motCle, '— l’expression que quelqu’un taperait') +
          champ('e-slug', 'Adresse (slug)', a.slug) +
          champ('e-titreseo', 'Titre pour Google', a.titreSeo, '— 60 caractères au plus') +
          zone('e-metadesc', 'Meta description', a.metaDescription, 2, '— entre 150 et 160 caractères') +
          champ('e-image', 'Image de couverture', a.image, '— chemin, ex. /blog/img/mon-article.png') +
          '</div>' +
          '<h4 class="gen-h">Corps de l’article</h4>' +
          zone('e-corps', 'HTML', a.corps, 16, '— &lt;h2&gt; pour les sections, &lt;h3&gt; pour les sous-parties, &lt;p&gt; et &lt;ul&gt;') +
          '<h4 class="gen-h">FAQ</h4>' +
          zone('e-faq', 'Une question par bloc', (a.faq || []).map(function (q) { return q.q + '\n' + q.r; }).join('\n\n'), 8, '— question sur une ligne, réponse en dessous, un blanc entre chaque') +
          '<h4 class="gen-h">Sources</h4>' +
          zone('e-src', 'Une par ligne', (a.sources || []).map(function (x) { return (x.titre || '') + ' | ' + x.url; }).join('\n'), 4, '— « Titre | https://… »') +
        '</div>' +
        '<div class="gen-foot"><p class="fe-err auth-err" id="e-err" style="margin:0 12px 0 0"></p>' +
        '<button class="btn btn-primary e-save" type="button" style="padding:11px 22px">Enregistrer</button></div></div>';
      document.body.appendChild(m);
      document.body.style.overflow = 'hidden';
      function fermer() { m.remove(); document.body.style.overflow = ''; }
      m.querySelector('.nm-close').onclick = fermer;
      m.querySelector('.nm-backdrop').onclick = fermer;

      m.querySelector('.e-save').onclick = function () {
        var v = function (i) { var e = document.getElementById(i); return e ? e.value.trim() : ''; };
        if (!v('e-titre')) { document.getElementById('e-err').textContent = 'Le titre est obligatoire.'; return; }
        // FAQ : blocs séparés par une ligne vide, question puis réponse
        var faq = v('e-faq').split(/\n\s*\n/).map(function (b) {
          var l = b.split('\n').filter(function (x) { return x.trim(); });
          return l.length >= 2 ? { q: l[0].trim(), r: l.slice(1).join(' ').trim() } : null;
        }).filter(Boolean);
        var sources = v('e-src').split('\n').map(function (l) {
          var i = l.lastIndexOf('|');
          if (i < 0) return l.trim() ? { titre: l.trim(), url: l.trim() } : null;
          return { titre: l.slice(0, i).trim(), url: l.slice(i + 1).trim() };
        }).filter(function (x) { return x && x.url; });

        var corps = {
          titre: v('e-titre'), categorie: v('e-cat'), chapo: v('e-chapo'),
          motCle: v('e-motcle'), slug: v('e-slug'), titreSeo: v('e-titreseo'),
          metaDescription: v('e-metadesc'), image: v('e-image'),
          corps: v('e-corps'), faq: faq, sources: sources
        };
        var b = m.querySelector('.e-save'); b.disabled = true; b.textContent = 'Enregistrement…';
        api(id ? API + '/' + id : API, id ? 'PATCH' : 'POST', corps).then(function (rr) {
          b.disabled = false; b.textContent = 'Enregistrer';
          if (!rr.ok) { document.getElementById('e-err').textContent = (rr.data && rr.data.error) || 'Enregistrement impossible.'; return; }
          // ⚠️ l'adresse a pu changer (le slug est modifiable) : on suit la réponse du serveur,
          // sans quoi un rechargement sur la page d'un article tomberait sur une 404
          fermer(); apres(rr);
        });
      };
    });
  }

  function recharger() { location.reload(); }

  // ---- carte d'article (même rendu que le serveur) --------------------------
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  // ⚠️ toujours l'HEURE DE PARIS, comme le serveur (cf. artDateLisible) : sinon un article
  // programmé la nuit s'afficherait à la veille pour qui consulte depuis un autre fuseau.
  function dateLisible(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(d).forEach(function (x) { if (x.type !== 'literal') p[x.type] = x.value; });
    } catch (e) { return JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + d.getFullYear(); }
    var j = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay();
    return JOURS[j] + ' ' + (+p.day) + ' ' + MOIS[+p.month - 1] + ' ' + p.year;
  }
  function carte(a) {
    var art = document.createElement('article');
    art.className = 'post' + (a.enLigne ? '' : ' post-hors');
    art.setAttribute('data-art', a.id);
    var vignette = a.image
      ? '<img class="thumb" src="' + esc(a.image) + '" alt="' + esc(a.categorie + ' — ' + a.titre) + '" loading="lazy" width="1200" height="630" />'
      : '<div class="thumb cat"><span>' + esc(a.categorie) + '</span></div>';
    var etat = a.enLigne ? '' :
      '<span class="art-etat ' + (a.statut === 'programme' ? 'prog' : 'brou') + '">' +
      (a.statut === 'programme' ? 'Programmé · ' + esc(dateLisible(a.datePublication)) : 'Brouillon') + '</span>';
    art.innerHTML = '<a class="post-lien" href="/blog/' + esc(a.slug) + (a.enLigne ? '' : '?token=' + encodeURIComponent(token())) + '">' +
      vignette +
      '<div class="pad">' + etat + '<span class="tag">' + esc(a.categorie) + '</span><h3>' + esc(a.titre) + '</h3>' +
      '<p>' + esc(a.chapo) + '</p><div class="date">' + esc(dateLisible(a.datePublication) || 'Non publié') + '</div></div></a>';
    art.appendChild(actions(a));
    return art;
  }

  // ---- page d'un article ----------------------------------------------------
  // Mêmes commandes que sur la grille, sans avoir à revenir en arrière. Après une action,
  // on suit l'article : son adresse (le slug est modifiable) et sa visibilité changent.
  function suivre(art) {
    return function (r) {
      var a = (r && r.data && r.data.article) || art;
      location.href = '/blog/' + a.slug + (a.enLigne ? '' : '?token=' + encodeURIComponent(token()));
    };
  }
  function barreArticle(art) {
    var etat = art.enLigne ? 'En ligne'
      : art.statut === 'programme' ? 'Programmé pour le ' + dateLisible(art.datePublication)
      : 'Brouillon';
    var b = document.createElement('div');
    b.className = 'blog-adm blog-adm-art';
    b.innerHTML = '<h4>Administration du blog</h4><span class="etat">' + esc(etat) + '</span><span class="sep"></span>';
    b.appendChild(actions(art, suivre(art)));
    return b;
  }

  // ---- mise en place --------------------------------------------------------
  // ⚠️ Le serveur ne rend que les articles PUBLIÉS sur une navigation ordinaire : une page
  // demandée par un lien n'envoie ni jeton ni cookie, il ne peut donc pas savoir qui regarde.
  // C'est donc ici, avec le jeton du navigateur, qu'on reconstruit la grille complète pour
  // l'administration. La sécurité tient côté serveur : l'API ne renvoie un brouillon qu'à un
  // compte admin, quoi qu'on fasse de ce script.
  var ANCRE = document.getElementById('ls-art-adm');   // présente sur la page d'UN article
  var SUR_PAGE = !!ANCRE;

  api(API).then(function (r) {
    if (!r.ok || !r.data.admin) return;         // seul l'admin voit les commandes
    var arts = r.data.articles || [];

    if (SUR_PAGE) {
      var id = ANCRE.getAttribute('data-art');
      var art = null;
      for (var k = 0; k < arts.length; k++) if (arts[k].id === id) art = arts[k];
      if (art) ANCRE.appendChild(barreArticle(art));
      return;
    }

    var grille = document.querySelector('.blog-grid');
    if (!grille) return;
    var b = barre(arts.length);
    grille.parentNode.insertBefore(b, grille);
    b.querySelector('.adm-nouvel').onclick = function () { ouvrirEditeur(null); };

    grille.innerHTML = '';
    if (!arts.length) {
      grille.innerHTML = '<p class="ds-empty" style="grid-column:1/-1;text-align:center">Aucun article pour l’instant — créez le premier avec « + Nouvel article ».</p>';
      return;
    }
    arts.forEach(function (a) { grille.appendChild(carte(a)); });
  });
})();
