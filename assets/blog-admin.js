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
  // ⚠️ onglet en SIMULATION (bouton « 🎭 Simulation » de l'espace documents) : l'écran est peut-être
  // projeté devant des formateurs, sous l'identité d'une formatrice fictive. L'administration RÉELLE
  // du blog (brouillons, Publier, Supprimer) ne doit pas s'y afficher : on s'y comporte en visiteur.
  function enSimulation() { try { return !!sessionStorage.getItem('lsx_sim'); } catch (e) { return false; } }
  function token() { if (enSimulation()) return ''; try { return localStorage.getItem(TKEY) || ''; } catch (e) { return ''; } }
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

  // ---- image de couverture ---------------------------------------------------
  // Demande de l'utilisateur (01/10/2026) : « cliquer, charger une image, puis Enregistrer ou
  // Annuler ». L'image choisie s'affiche en APERÇU ; rien ne part au serveur avant « Enregistrer ».
  // Elle est recadrée et allégée ICI, dans le navigateur, comme les couvertures préparées à la main
  // depuis août : 1200 × 630 (le format des couvertures et des aperçus de partage), recadrage
  // centré, JPEG qualité 0,82. Une photo brute de plusieurs Mo devient ~200 ko, et l'aperçu montre
  // exactement ce qui sera enregistré. Le site recadrait déjà l'affichage au même rapport.
  var COUV_L = 1200, COUV_H = 630;
  function preparerCouverture(fichier) {
    return new Promise(function (ok, ko) {
      if (!fichier || !/^image\//.test(fichier.type || '')) return ko(new Error('Ce fichier n’est pas une image : choisissez une image JPEG, PNG ou WebP.'));
      var lien = URL.createObjectURL(fichier);
      var img = new Image();
      img.onerror = function () { URL.revokeObjectURL(lien); ko(new Error('Image illisible : choisissez une image JPEG, PNG ou WebP.')); };
      img.onload = function () {
        URL.revokeObjectURL(lien);
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return ko(new Error('Image illisible : choisissez une image JPEG, PNG ou WebP.'));
        // recadrage centré au rapport 1200 / 630
        var sx = 0, sy = 0, sw = w, sh = h;
        if (w / h > COUV_L / COUV_H) { sw = Math.round(h * COUV_L / COUV_H); sx = Math.round((w - sw) / 2); }
        else { sh = Math.round(w * COUV_H / COUV_L); sy = Math.round((h - sh) / 2); }
        // réduction par moitiés : un seul passage d'une grande photo à 1200 px crénelle les détails fins
        var src = img;
        while (sw / 2 >= COUV_L) {
          var t = document.createElement('canvas');
          t.width = Math.round(sw / 2); t.height = Math.round(sh / 2);
          var tc = t.getContext('2d');
          tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
          tc.drawImage(src, sx, sy, sw, sh, 0, 0, t.width, t.height);
          src = t; sx = 0; sy = 0; sw = t.width; sh = t.height;
        }
        var c = document.createElement('canvas');
        c.width = COUV_L; c.height = COUV_H;
        var x = c.getContext('2d');
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, COUV_L, COUV_H);   // la transparence d'un PNG devient du blanc
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
        x.drawImage(src, sx, sy, sw, sh, 0, 0, COUV_L, COUV_H);
        c.toBlob(function (b) {
          if (!b) return ko(new Error('L’image n’a pas pu être préparée. Essayez-en une autre.'));
          ok({ blob: b, url: URL.createObjectURL(b), largeur: w, hauteur: h });
        }, 'image/jpeg', 0.82);
      };
      img.src = lien;
    });
  }
  // une image plus petite que la couverture est agrandie, donc floue : on le dit avant l'envoi
  function avertissement(res) {
    return res.largeur < COUV_L || res.hauteur < COUV_H
      ? ' Attention : elle ne fait que ' + res.largeur + ' × ' + res.hauteur + ' px, elle paraîtra floue.' : '';
  }
  function envoyerCouverture(id, blob) {
    var fd = new FormData();
    fd.append('image', blob, 'couverture.jpg');
    return fetch(API + '/' + id + '/image', { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: fd })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }, function () { return { ok: r.ok, data: {} }; }); })
      .catch(function () { return { ok: false, data: { error: 'Envoi impossible : vérifiez la connexion, puis réessayez.' } }; });
  }

  // Sur la page d'un article (brouillon OU en ligne) : un clic sur l'image, ou sur « Changer
  // l'image », ouvre le choix du fichier ; l'aperçu remplace l'image, avec « Annuler » et
  // « Enregistrer » dessous. Sans image, un cadre « Ajouter une image de couverture » la remplace.
  function couverturePage(id, titre) {
    var main = document.querySelector('.art-main');
    if (!main) return null;
    var img = document.getElementById('ls-art-cover');
    var origine = img ? img.getAttribute('src') : '';   // l'image enregistrée ('' : aucune)
    var w = document.createElement('div');
    w.className = 'couv';
    if (img) img.parentNode.insertBefore(w, img);
    else {
      main.insertBefore(w, main.firstChild);
      img = document.createElement('img');
      img.className = 'art-cover'; img.id = 'ls-art-cover'; img.alt = titre || '';
      img.setAttribute('width', '1200'); img.setAttribute('height', '630');
    }
    img.title = 'Cliquer pour changer l’image';
    var vide = document.createElement('button');
    vide.type = 'button'; vide.className = 'couv-vide';
    vide.innerHTML = '<span>+ Ajouter une image de couverture</span><small>Cliquez ici pour choisir une image (JPEG, PNG ou WebP)</small>';
    var chg = document.createElement('button');
    chg.type = 'button'; chg.className = 'couv-chg'; chg.textContent = 'Changer l’image';
    var fichier = document.createElement('input');
    fichier.type = 'file'; fichier.accept = 'image/jpeg,image/png,image/webp'; fichier.hidden = true;
    var bar = document.createElement('div');
    bar.className = 'couv-bar'; bar.hidden = true;
    bar.innerHTML = '<span class="couv-etat" aria-live="polite"></span>' +
      '<span class="couv-btns"><button type="button" class="couv-btn couv-annuler">Annuler</button>' +
      '<button type="button" class="couv-btn go couv-enregistrer">Enregistrer</button></span>';
    [img, vide, chg, fichier, bar].forEach(function (el) { w.appendChild(el); });
    var etat = bar.querySelector('.couv-etat'), btns = bar.querySelector('.couv-btns');
    var bAnnuler = bar.querySelector('.couv-annuler'), bEnregistrer = bar.querySelector('.couv-enregistrer');
    var apercu = null, occupe = false;

    function afficher() {
      var src = apercu ? apercu.url : origine;
      if (!src) img.removeAttribute('src');
      else if (img.getAttribute('src') !== src) img.src = src;
      img.hidden = !src; chg.hidden = !src; vide.hidden = !!src;
      w.classList.toggle('apercu', !!apercu);
    }
    function liberer() { if (apercu) { URL.revokeObjectURL(apercu.url); apercu = null; } }
    function ouvrir() { if (occupe) return; fichier.value = ''; fichier.click(); }
    img.addEventListener('click', ouvrir);
    vide.onclick = ouvrir;
    chg.onclick = ouvrir;
    fichier.onchange = function () {
      var f = fichier.files && fichier.files[0];
      if (!f) return;
      bar.hidden = false; btns.hidden = true; etat.textContent = 'Préparation de l’image…';
      preparerCouverture(f).then(function (res) {
        liberer(); apercu = res; afficher();
        btns.hidden = false; bAnnuler.disabled = bEnregistrer.disabled = false;
        etat.textContent = 'Aperçu : cette image n’est pas encore enregistrée.' + avertissement(res);
      }, function (e) {
        // l'image d'avant (ou l'aperçu déjà choisi) reste en place
        etat.textContent = e.message; btns.hidden = !apercu;
        if (!apercu) setTimeout(function () { if (!apercu && !occupe) bar.hidden = true; }, 5000);
      });
    };
    bAnnuler.onclick = function () { liberer(); afficher(); bar.hidden = true; };
    bEnregistrer.onclick = function () {
      if (!apercu || occupe) return;
      occupe = true; bAnnuler.disabled = bEnregistrer.disabled = true; etat.textContent = 'Enregistrement…';
      envoyerCouverture(id, apercu.blob).then(function (r) {
        occupe = false;
        if (!r.ok || !r.data || !r.data.article) {
          bAnnuler.disabled = bEnregistrer.disabled = false;
          etat.textContent = (r.data && r.data.error) || 'Enregistrement impossible. Réessayez.';
          return;
        }
        // l'image servie par le site remplace l'aperçu ; celui-ci n'est libéré qu'une fois elle
        // chargée, sinon un éclair vide passerait entre les deux
        var ancien = apercu; apercu = null;
        origine = r.data.article.image;
        var fin = function () { URL.revokeObjectURL(ancien.url); };
        img.addEventListener('load', fin, { once: true });
        img.addEventListener('error', fin, { once: true });
        afficher();
        btns.hidden = true; etat.textContent = 'Image enregistrée ✓';
        setTimeout(function () { if (!apercu && !occupe) bar.hidden = true; }, 2500);
      });
    };
    afficher();
    return { ouvrir: ouvrir };
  }

  // Dans la fenêtre « Modifier l'article » / « Nouvel article » : même geste, mais l'image part
  // AVEC l'article, au clic sur « Enregistrer » de la fenêtre (un nouvel article n'a pas encore
  // d'identifiant où l'envoyer). Fermer la fenêtre l'abandonne.
  function couvertureModale(m, image) {
    var zone = m.querySelector('.e-img-zone'), fichier = m.querySelector('.e-img-fichier'), etat = m.querySelector('.e-img-etat');
    var origine = image || '', apercu = null;
    function afficher() {
      var src = apercu ? apercu.url : origine;
      zone.innerHTML = src ? '<img src="' + esc(src) + '" alt="" />' : '<span>+ Choisir une image</span>';
      zone.classList.toggle('apercu', !!apercu);
    }
    function liberer() { if (apercu) { URL.revokeObjectURL(apercu.url); apercu = null; } }
    zone.onclick = function () { fichier.value = ''; fichier.click(); };
    fichier.onchange = function () {
      var f = fichier.files && fichier.files[0];
      if (!f) return;
      etat.textContent = 'Préparation de l’image…';
      preparerCouverture(f).then(function (res) {
        liberer(); apercu = res; afficher();
        etat.innerHTML = esc('Nouvelle image : elle sera enregistrée avec l’article.' + avertissement(res)) +
          ' <button type="button" class="e-img-annuler">Annuler</button>';
        etat.querySelector('.e-img-annuler').onclick = function () { liberer(); afficher(); etat.textContent = ''; };
      }, function (e) { etat.textContent = e.message; });
    };
    afficher();
    return {
      choisie: function () { return apercu; },
      // l'image est partie : elle devient l'image enregistrée (un nouvel essai ne la renverra pas)
      envoyee: function (src) { var a = apercu; apercu = null; if (src) origine = src; afficher(); if (a) URL.revokeObjectURL(a.url); etat.textContent = ''; },
      liberer: liberer
    };
  }

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
        // la diffusion sur les réseaux se fait à la main : la modale ne promet plus rien de tel
        message: '« ' + art.titre + ' » sera visible de tous, immédiatement. Les posts LinkedIn restent à publier vous-même, depuis la boîte sous l’article.',
        onOui: function () { api(API + '/' + art.id + '/publier', 'POST', {}).then(apres); }
      });
    });
    w.querySelector('.a-programmer') && (w.querySelector('.a-programmer').onclick = function () {
      // ⚠️ valeur par défaut composée en heure LOCALE : `toISOString()` donne l'heure UTC, que
      // le champ datetime-local réinterprète ensuite comme locale — la proposition arrivait
      // décalée d'une à deux heures selon la saison (défaut trouvé le 11/09/2026).
      var d = new Date(Date.now() + 864e5); d.setSeconds(0, 0);
      var deuxCh = function (n) { return (n < 10 ? '0' : '') + n; };
      var val = d.getFullYear() + '-' + deuxCh(d.getMonth() + 1) + '-' + deuxCh(d.getDate())
        + 'T' + deuxCh(d.getHours()) + ':' + deuxCh(d.getMinutes());
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
          // l'image se CHOISIT : plus de chemin à taper (demande de l'utilisateur, 01/10/2026)
          '<div class="gf gf-full e-img">Image de couverture <small style="font-weight:400;color:var(--ink-soft)">— cliquez sur le cadre pour choisir une image</small>' +
            '<button type="button" class="e-img-zone" aria-label="Choisir l’image de couverture"></button>' +
            '<input type="file" class="e-img-fichier" accept="image/jpeg,image/png,image/webp" hidden />' +
            '<p class="e-img-etat" aria-live="polite"></p></div>' +
          '</div>' +
          '<h4 class="gen-h">Référencement</h4><div class="gf-grid">' +
          champ('e-motcle', 'Mot-clé principal', a.motCle, '— l’expression que quelqu’un taperait') +
          champ('e-slug', 'Adresse (slug)', a.slug) +
          champ('e-titreseo', 'Titre pour Google', a.titreSeo, '— 60 caractères au plus') +
          zone('e-metadesc', 'Meta description', a.metaDescription, 2, '— entre 150 et 160 caractères') +
          '</div>' +
          '<h4 class="gen-h">Corps de l’article</h4>' +
          zone('e-corps', 'HTML', a.corps, 16, '— &lt;h2&gt; pour les sections, &lt;h3&gt; pour les sous-parties, &lt;p&gt; et &lt;ul&gt;') +
          '<h4 class="gen-h">FAQ</h4>' +
          zone('e-faq', 'Une question par bloc', (a.faq || []).map(function (q) { return q.q + '\n' + q.r; }).join('\n\n'), 8, '— question sur une ligne, réponse en dessous, un blanc entre chaque') +
          '<h4 class="gen-h">Sources</h4>' +
          zone('e-src', 'Une par ligne', (a.sources || []).map(function (x) { return (x.titre || '') + ' | ' + x.url; }).join('\n'), 4, '— « Titre | https://… »') +
          // les trois posts LinkedIn, modifiables ici comme dans la boîte sous l'article, avec la
          // case « Post à publier » (demande de l'utilisateur, 14/09/2026)
          '<h4 class="gen-h">Posts LinkedIn</h4>' +
          '<div class="e-posts"><p class="li-astuce">Trois versions au choix, jamais affichées sur le site. Cochez celle que vous publierez. Sur LinkedIn, collez l’adresse de l’article en premier commentaire plutôt que dans le post.</p>' +
          postsHTML(postsDe(a)) + '<span class="li-etat"></span></div>' +
        '</div>' +
        '<div class="gen-foot"><p class="fe-err auth-err" id="e-err" style="margin:0 12px 0 0"></p>' +
        '<button class="btn btn-ghost e-annuler" type="button" style="padding:11px 22px">Annuler</button>' +
        '<button class="btn btn-primary e-save" type="button" style="padding:11px 22px">Enregistrer</button></div></div>';
      document.body.appendChild(m);
      document.body.style.overflow = 'hidden';
      var couv = couvertureModale(m, a.image);
      function fermer() { couv.liberer(); m.remove(); document.body.style.overflow = ''; }
      // fermer sans enregistrer ; un article déjà créé (image partie en échec) doit tout de même
      // apparaître dans la grille
      function abandonner() { fermer(); if (idArt && !id) apres({ ok: true, data: {} }); }
      m.querySelector('.nm-close').onclick = abandonner;
      m.querySelector('.nm-backdrop').onclick = abandonner;
      m.querySelector('.e-annuler').onclick = abandonner;
      var blocPosts = m.querySelector('.e-posts');
      var lirePosts = brancherPosts(blocPosts, postsDe(a), blocPosts.querySelector('.li-etat'));
      // ⚠️ un article CRÉÉ dont l'image n'a pas pu partir garde son identifiant : un nouvel essai
      // l'enregistre au lieu d'en créer un second
      var idArt = id;

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

        // ⚠️ plus de champ `image` : l'API le laisse tel quel quand il est absent ; c'est la route
        // d'envoi de l'image qui le change
        var corps = {
          titre: v('e-titre'), categorie: v('e-cat'), chapo: v('e-chapo'),
          motCle: v('e-motcle'), slug: v('e-slug'), titreSeo: v('e-titreseo'),
          metaDescription: v('e-metadesc'),
          corps: v('e-corps'), faq: faq, sources: sources,
          postsLi: lirePosts()
        };
        var b = m.querySelector('.e-save'), err = document.getElementById('e-err');
        b.disabled = true; b.textContent = 'Enregistrement…'; err.textContent = '';
        var echec = function (t) { b.disabled = false; b.textContent = 'Enregistrer'; err.textContent = t; };
        // ⚠️ l'adresse a pu changer (le slug est modifiable) : on suit la réponse du serveur,
        // sans quoi un rechargement sur la page d'un article tomberait sur une 404
        var fin = function (rr) { fermer(); apres(rr); };
        // article existant : l'image d'abord (si elle échoue, rien n'a encore bougé)
        var image = couv.choisie();
        (idArt && image ? envoyerCouverture(idArt, image.blob) : Promise.resolve(null)).then(function (ri) {
          if (ri && !ri.ok) return echec((ri.data && ri.data.error) || 'L’image n’a pas pu être envoyée. Réessayez.');
          if (ri) couv.envoyee(ri.data.article && ri.data.article.image);
          return api(idArt ? API + '/' + idArt : API, idArt ? 'PATCH' : 'POST', corps).then(function (rr) {
            if (!rr.ok) return echec((rr.data && rr.data.error) || 'Enregistrement impossible.');
            // nouvel article : il fallait son identifiant pour y joindre l'image
            var image2 = couv.choisie();
            if (!idArt && image2 && rr.data.article) {
              idArt = rr.data.article.id;
              return envoyerCouverture(idArt, image2.blob).then(function (ri2) {
                if (!ri2.ok) return echec('L’article est enregistré, mais pas son image : ' + ((ri2.data && ri2.data.error) || 'envoi impossible.') + ' Cliquez de nouveau sur « Enregistrer » pour réessayer.');
                couv.envoyee(); fin(ri2);
              });
            }
            fin(rr);
          });
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
  // ⚠️ `hourCycle:'h23'` et non `hour12:false` : ce dernier fait sortir minuit en « 24 » sur
  // plusieurs moteurs, et un article programmé à minuit s'afficherait « 24h00 ».
  function heureLisible(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).forEach(function (x) { if (x.type !== 'literal') p[x.type] = x.value; });
    } catch (e) { return ''; }
    return p.hour == null ? '' : (+p.hour) + 'h' + p.minute;
  }
  // « samedi 12 septembre 2026 à 9h30 » : réservé à ce qui est PROGRAMMÉ (même règle que le
  // serveur, cf. artQuandLisible). La date d'un article déjà en ligne reste au jour seul.
  function quandLisible(iso) {
    var j = dateLisible(iso), h = heureLisible(iso);
    return j && h ? j + ' à ' + h : j;
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
      (a.statut === 'programme' ? 'Programmé · ' + esc(quandLisible(a.datePublication)) : 'Brouillon') + '</span>';
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
      : art.statut === 'programme' ? 'Programmé pour le ' + quandLisible(art.datePublication)
      : 'Brouillon';
    var b = document.createElement('div');
    b.className = 'blog-adm blog-adm-art';
    b.innerHTML = '<h4>Administration du blog</h4><span class="etat">' + esc(etat) + '</span><span class="sep"></span>';
    b.appendChild(actions(art, suivre(art)));
    return b;
  }

  // ---- posts LinkedIn (bas de l'article, administration seule) --------------
  // ⚠️ Notes INTERNES : elles ne sont jamais rendues par le serveur. C'est l'API qui les fournit,
  // et elle ne les fournit qu'à un compte admin — un formateur, un apprenant ou un visiteur
  // déconnecté reçoit une ancre vide, même sur un article publié.
  // Trois versions, trois angles d'accroche : on choisit celle qui colle au moment de publier.
  var LI_ANGLES = ['La question', 'Le chiffre', 'Le terrain'];
  // ⚠️ Les trois versions s'éditent à DEUX endroits : la modale « Modifier » et la boîte sous
  // l'article. Les deux passent par ces trois fonctions — s'ils divergeaient, enregistrer depuis
  // l'un effacerait en silence ce que l'autre sait écrire (la case « Post à publier » notamment).
  function postsDe(art) {
    var posts = (art.postsLi && art.postsLi.length) ? art.postsLi.slice(0, 3)
      : (art.postLinkedin ? [{ angle: LI_ANGLES[0], texte: art.postLinkedin }] : []);
    posts = posts.map(function (p) { return { angle: p.angle, texte: p.texte, choisi: !!p.choisi }; });
    while (posts.length < 3) posts.push({ angle: LI_ANGLES[posts.length], texte: '', choisi: false });
    return posts;
  }
  function postsHTML(posts) {
    return posts.map(function (p, i) {
      return '<div class="li-v' + (p.choisi ? ' choisi' : '') + '" data-i="' + i + '">' +
        '<div class="li-vh"><span class="li-chip">Version ' + (i + 1) + ' · ' + esc(p.angle || LI_ANGLES[i]) + '</span>' +
        '<span class="li-cpt"></span>' +
        '<label class="li-choix"><input type="checkbox" class="li-pub"' + (p.choisi ? ' checked' : '') + ' /> Post à publier</label>' +
        '<button type="button" class="btn-mini ghost li-copier">Copier</button></div>' +
        '<textarea class="li-txt" rows="12" spellcheck="false"></textarea></div>';
    }).join('');
  }
  // compteurs, copie et cases exclusives ; renvoie une fonction qui lit l'état à enregistrer
  function brancherPosts(racine, posts, etat) {
    var dit = function (t) { if (!etat) return; etat.textContent = t; setTimeout(function () { etat.textContent = ''; }, 2500); };
    var zones = [].slice.call(racine.querySelectorAll('.li-v'));
    zones.forEach(function (v, i) {
      var ta = v.querySelector('.li-txt'), cpt = v.querySelector('.li-cpt'), cb = v.querySelector('.li-pub');
      ta.value = posts[i].texte || '';
      // LinkedIn replie le texte au-delà d'environ 210 caractères : l'accroche doit tenir avant.
      var compte = function () { cpt.textContent = ta.value.length + ' caractères'; };
      compte(); ta.addEventListener('input', compte);
      // une seule case cochée à la fois ; la décocher laisse les trois versions sans choix
      cb.onchange = function () {
        zones.forEach(function (w) {
          var autre = w.querySelector('.li-pub');
          if (w !== v && cb.checked) autre.checked = false;
          w.classList.toggle('choisi', autre.checked);
        });
      };
      v.querySelector('.li-copier').onclick = function () {
        ta.select(); ta.setSelectionRange(0, ta.value.length);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value).then(function () { dit('Version ' + (i + 1) + ' copiée ✓'); },
            function () { dit('Copie impossible — sélectionnez le texte'); });
        } else dit(document.execCommand && document.execCommand('copy') ? 'Version ' + (i + 1) + ' copiée ✓' : 'Copie impossible — sélectionnez le texte');
      };
    });
    return function lire() {
      return zones.map(function (v, i) {
        var p = { angle: posts[i].angle || LI_ANGLES[i], texte: v.querySelector('.li-txt').value };
        if (v.querySelector('.li-pub').checked) p.choisi = true;
        return p;
      });
    };
  }
  function boiteLinkedin(art) {
    var posts = postsDe(art);
    var b = document.createElement('div');
    b.className = 'li-box';
    b.innerHTML = '<div class="li-h"><h4>Posts LinkedIn</h4>' +
      '<span class="li-note">Trois versions au choix — notes internes, jamais affichées sur le site</span></div>' +
      '<p class="li-astuce">Sur LinkedIn, un lien dans le corps du post réduit sa portée : publiez le post seul, puis collez l’adresse de l’article en premier commentaire.</p>' +
      postsHTML(posts) +
      '<div class="li-acts"><button type="button" class="btn-mini li-save">Enregistrer les trois</button><span class="li-etat"></span></div>';
    var etat = b.querySelector('.li-etat');
    var lire = brancherPosts(b, posts, etat);
    b.querySelector('.li-save').onclick = function () {
      var bt = b.querySelector('.li-save'); bt.disabled = true; bt.textContent = 'Enregistrement…';
      api(API + '/' + art.id, 'PATCH', { postsLi: lire() }).then(function (r) {
        bt.disabled = false; bt.textContent = 'Enregistrer les trois';
        etat.textContent = r.ok ? 'Enregistré ✓' : ((r.data && r.data.error) || 'Enregistrement impossible.');
        setTimeout(function () { etat.textContent = ''; }, 2500);
      });
    };
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
      // la couverture se change d'un clic, brouillon ou article en ligne
      var couv = art ? couverturePage(id, art.titre) : null;
      // encadré image du brouillon (rendu par le serveur) : copie du prompt + même geste que l'image
      var boxImg = document.getElementById('ls-art-imgadm');
      if (boxImg) {
        // ⚠️ le « dit » de boiteLinkedin est local à cette fonction-là : le nôtre l'est aussi
        var dit = function (el, t) { el.textContent = t; setTimeout(function () { el.textContent = ''; }, 2500); };
        var copier = boxImg.querySelector('.art-imgadm-copier');
        var remplacer = boxImg.querySelector('.art-imgadm-remplacer');
        var etatImg = boxImg.querySelector('.art-imgadm-etat');
        if (copier) copier.onclick = function () {
          var txt = boxImg.querySelector('.art-imgadm-prompt').textContent;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(function () { dit(etatImg, 'Prompt copié ✓'); },
              function () { dit(etatImg, 'Copie impossible — sélectionnez le texte'); });
          } else dit(etatImg, 'Copie impossible — sélectionnez le texte');
        };
        // le bouton de l'encadré ouvre le même choix que l'image : aperçu, puis Enregistrer / Annuler
        // (preventDefault : le champ caché de l'étiquette ne s'ouvre plus)
        if (remplacer) {
          if (couv) remplacer.addEventListener('click', function (e) { e.preventDefault(); couv.ouvrir(); });
          else remplacer.hidden = true;
        }
      }
      // la fiche complète porte le post LinkedIn, absent de la liste
      var cible = document.getElementById('ls-art-linkedin');
      if (art && cible) api(API + '/' + id).then(function (rr) {
        if (rr.ok && rr.data.article) cible.appendChild(boiteLinkedin(rr.data.article));
      });
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
