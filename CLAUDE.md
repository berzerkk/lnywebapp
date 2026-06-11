# Languages & Success (L&S) — contexte projet

Site marketing + **espace documents** pour un organisme de formation en langues (Nice, certifié Qualiopi). FR. Itérations rapides, style éditorial chaud (rose-gold).

## Stack
- Front : **HTML/CSS/JS statique, sans framework**. CSS partagé `assets/site.css`. Nav/footer injectés par `assets/partials.js`.
- Back : **Node + Express** (`server.js`) qui sert le site **et** une API REST. Base = fichier **`data/db.json`** + fichiers dans **`data/uploads/`**. Auth bcrypt + JWT (token en `localStorage` côté client).
- Anim héros : `morph.js` (canvas 2D, nuage de particules + logo). `medallion.js`/`sphere.js`/`worldmap.js`/`painting.js` = en réserve, non chargés.

## Lancer / arrêter
- Démarrer : `node server.js` (port **8000**) → http://localhost:8000. (Sert site + API.)
- Le port peut être passé en argument : `node server.js 8011`.
- Données sensibles bloquées par le serveur (`/data`, `node_modules`, `server.js`).
- ⚠️ Toujours **un seul** serveur Node sur un port donné (sinon il écrase `db.json`). Tuer le port avant de relancer.

## Espace documents (`espace-documents.html` + `assets/account.js` + API)
- Comptes + rôles : `admin` / `eleve` / `prof`. **Libellés** : Administrateur / **Apprenant** / **Formateur**.
- **Modèle DOSSIER à 3** : un formateur ajoute un apprenant (`POST /api/groups`) → dossier `{prof, eleve, admin}`. **L'admin est membre de TOUS les dossiers** (entité virtuelle `'admins'`, affichée « Administration L&S » — le nom de l'admin réel n'est jamais montré aux non-admins).
- **2 canaux par dossier** : `commun` (formateur + apprenant + admin) et `prive` (formateur + admin seulement ; l'apprenant n'y a **aucun** accès lecture/écriture/download). Chaque canal = **documents** (upload réel ≤25 Mo) **+ messagerie (chat)**.
- À l'envoi d'un doc/message, on choisit le **canal** (commun ou privé) via les onglets du dossier.
- **Admin centralisé** : tous les comptes admin voient la même chose (`/api/admin/overview` = tous les dossiers + comptes + documents). Admin peut tout voir/télécharger. **Suppression admin** : un dossier (`DELETE /api/groups/:id`, cascade = fichiers disque + docs + messages + qs + worksheets via `deleteGroupCascade`) ou un compte (`DELETE /api/users/:id`, supprime aussi ses dossiers en cascade + ses notifs). Boutons 🗑 + `confirmDialog` dans la vue globale.
- **Fiches profil** (remplies à l'inscription, stockées dans `user.profile`, exposées via `pubFull` dans `groupView`/`/api/me`) : **fiche apprenant** = tél, **société**, nb d'heures total + détail, intitulé de la formation, langue, **date de début + date de fin** (`dateDebut`/`dateFin`), **lieu** (distanciel/présentiel + adresse si présentiel : `lieu`/`lieuAdresse`), certification (oui/non) + texte si oui ; **fiche formateur** = langue, SIRET, NDA, adresse physique, tél, date de naissance, nationalité. Formulaire d'inscription à champs conditionnels selon le rôle (`collectProfile`).
- **Auto-remplissage des documents** depuis la fiche apprenant (`headerPrefill`/`clientFiche`/`certifLine`) : intitulé, langue, date de formation et **ligne « Certification »** pré-remplies sur les docs générés (QS, tests, worksheet via `wsBlank`). L'**Interactive Worksheet** pré-remplit aussi tél apprenant + **tél formateur** + langue depuis les fiches (`wsBlank` lit `E.profile`/`P.profile`).
- **Édition des fiches par l'admin** (même après création) : bouton ✏️ sur chaque apprenant/formateur de la vue globale → modale `openFicheEdit` (infos de base + fiche selon le rôle) → `PATCH /api/users/:id` (admin only, `cleanProfile`, e-mail unique vérifié). `/api/admin/overview` renvoie les users via `pubFull` (profils inclus).
- **Comptes démo** (seed au démarrage `ensureDemo`, jamais en double) affichés sur la page de connexion avec bouton « Se connecter » rapide (`GET /api/demo-accounts`) : `admin@ls.fr` / `prof@ls.fr` / `eleve@ls.fr`, mot de passe **demo1234** (+ dossier démo prof↔eleve). La fiche de `eleve@ls.fr` est remplie (certification incluse).
- **Notifications** : message/doc reçu = notif (filtrée par canal). Cloche header (badge) → modale (fond flou) qui passe tout en lu.
- Header : déconnecté = « Se connecter » + « Créer un compte » (#creer ouvre l'inscription) ; connecté = cloche + prénom. **Menu hamburger mobile** (`partials.js` : `#mobile-menu` + `#nav-backdrop`) = drawer flou, croix, clic-dehors/Échap pour fermer, contient tous les boutons (espace docs en haut, nav, test/contact) ; sa section « Espace documents » est synchronisée à l'état connecté par `syncMobileMenu` (Se connecter/Créer un compte ↔ Mon espace/Se déconnecter, helper `logout`). En réduit, boutons espace-doc groupés à droite avec le burger.
- Non-admins ne voient/ajoutent pas les admins. Mots de passe : champ + confirmation, œil afficher/masquer.

### API principales
`POST /api/signup|login`, `GET /api/me`, `GET /api/users`,
`GET|POST /api/groups`,
`GET|POST /api/messages?group=&channel=` (commun|prive),
`GET|POST /api/documents?group=&channel=` (+ `/:id/download?token=`),
`GET /api/notifications` + `POST /api/notifications/read|delete{id}|clear`, `GET /api/admin/overview`.
Données : `db.json` = `{users, groups, docs, messages, notifs, secret}`.
- **Notifications** : cloche **pollée toutes les 20 s** (`startNotifPoll`, le formateur voit en live quand l'apprenant répond, sans recharger). Modale = suppression **individuelle** (croix par ligne, `POST /api/notifications/delete`) + **« Tout supprimer »** (`POST /api/notifications/clear`).
- **Noms de fichiers générés** : assainis côté serveur via `safeFile()` + `nameDate()` (date `jj-mm-aaaa` sans « / », sinon le navigateur tronquait le nom à « 2026 »).
- **Vue admin globale** : 3 filtres **multi-sélection** (`adminShow` = Dossiers / Comptes / Fichiers, tous actifs par défaut) + barre de recherche `norm()` ; sections empilées (dossiers+leurs docs, comptes, **liste à plat de tous les fichiers** avec `groupLabel`). Dans la **case dossier**, l'**apprenant est affiché avant le formateur** (`membersChips`, `groupTitle`, libellé admin). Notifications : **singulier/pluriel** corrects (« 1 notification non lue » / « 2 notifications non lues »).
- **Pied de page de TOUS les docs générés** (`metaLines` injecté dans `pdfHeaderFooter`/`docxHeaderFooter`) : « Créé le 07/06/2026 par FPE », « Rédigé le {date de génération} par {compte générateur} », « Ce fichier n'a pas encore été modifié — Version 1.0 » (à gauche) + bloc légal `LEGAL_LINES` (à droite).

## Test de niveau (`test-de-niveau.html` + `test-data.js`)
- 12 langues × 10 questions graduées A1→C2 dans `test-data.js` (`{t, o, a, e}` ; `e` = explication FR).
- Landing : section test → choix de langue → 1re question dans la langue → redirige vers `?lang=`.
- Résultat : niveau CECRL + **compétences du niveau** + **correction détaillée** (réponse, bonne réponse, explication).

## Conventions / préférences utilisateur
- Réponses en **français**. L'utilisateur teste sur **localhost:8000** (Ctrl+Shift+R).
- Accent orange-rosé : `--accent:#be6e54`. Jamais le mot « promesse ». « apprenant » (pas « stagiaire »).
- Boutons orange-rosé scintillent ; liens « politique de confidentialité » inline (pas rejetés à droite) ; boutons d'envoi centrés.
- Après une modif, **vérifier** (eval/screenshot via preview MCP `site` sur 8011, ou tests `node -e` contre l'API), puis **réinitialiser `data/` et relancer le serveur 8000 propre**.
- Animations sauvegardées dans `versions/animation-v3` et `v5`.

## Espace documents — génération de documents (Phase 2, FAITE)
- Bouton **« Générer un document »** (formateur/admin, dans un dossier) → modale.
- Modèle **Interactive Worksheet** : en-tête (intitulé, langue, société, noms/tels/mails apprenant+formateur — **préremplis** depuis le dossier) + **notes** (vocabulaire/structure/communication/autre) + **séances répétables** (date/durée, objectifs, liste de mots, structure & grammaire, pronunciation, erreurs à éviter, pour la prochaine fois).
- Brouillon persistant par dossier : `db.worksheets` (1 par dossier, type `interactive`). API `GET|POST /api/worksheet?group=`, `POST /api/worksheet/generate {group, channel}`.
- Flux UI : bouton « Générer » → **modale de choix du modèle** → **modale plein écran** (formulaire) → **un seul bouton « Générer le document »** + choix du **format (PDF ou Word .docx)**.
- Génération serveur : **PDF** via `pdfkit` (`buildWorksheetPdf`), **Word** via `docx` (`buildWorksheetDocx`). Le fichier est **téléchargé directement** sur l'ordi (réponse binaire `attachment`) — **PAS** déposé dans le dossier, pas de choix de canal. Brouillon (header+séances) persistant par dossier (`db.worksheets`).
- Chaque doc généré porte sur **chaque page** : **logo** en en-tête (haut-gauche, `assets/ls-logo.png`) + **pied de page** = numérotation `x / y` + bloc légal à droite (`LEGAL_LINES` dans server.js : Assoc. Loi 1901, siège, RNA, SIRET, QUALIOPI F1017, N° déclaration).
- 1ʳᵉ modale = 2 onglets : **Nouveau document** / **Historique** (`db.docgens`, réouvrable pour dupliquer, `GET /api/worksheet/history`). La génération **ne ferme pas** la modale (on vérifie le fichier puis on ferme).
- **Ajout de contact** : bouton 🔍 → **modale de recherche** (prénom/nom/email, **insensible aux accents** via `norm()`), exclut les personnes **déjà** dans un dossier avec soi.
- **Questionnaires (QS) en 2 temps** (`db.qs`, `QS_TEMPLATES` mi-parcours `qs_mid` + fin `qs_end`) : le formateur choisit le modèle → remplit l'en-tête (apprenant/société/langue/intitulé/formateur/date) → **« Envoyer à l'apprenant »** (`POST /api/qs/send`) → message spécial `kind:'qs'` dans le **chat commun** + notif. L'apprenant clique « Remplir » → modale plein écran (questions radio/échelle 1-10/texte) → bouton **« Envoyer votre réponse »** → **popup de confirmation** (`confirmDialog`, 2 boutons : « Confirmer l'envoi » / « Continuer à répondre » ; une fois envoyé il ne peut plus modifier) → `POST /api/qs/:id/submit` (**format PDF forcé**, l'apprenant ne choisit pas) génère le doc (mêmes header/footer) et le **dépose dans le canal commun** (statut « Rempli ✓ » + lien dans le chat). Items typés : `intro|section|radio|scale|text` (+ `comment`). `GET /api/qs/:id` renvoie items+réponses.
- **Tests mi-parcours / fin** (`TEST_TEMPLATES` `test_mid` « Test de mi-parcours de formation » + `test_end` « Test de fin de formation ») : générés **par le formateur/admin** (pas de flux apprenant). Modale plein écran = en-tête (apprenant/société/langue/intitulé/formateur/date, préremplis depuis le dossier) + **Résultat** + **Appréciation formateur** + **zone libre enrichie** + format PDF/Word → `POST /api/testdoc/generate {group,type,header,extra,format}` renvoie le **binaire téléchargé directement** (mêmes header/footer logo+légal, PDF=`buildTestPdf`/Word=`buildTestDocx`). Pas de dépôt dans le dossier, la modale reste ouverte (« Document généré ✓ »).
- **Zone libre enrichie (WYSIWYG)** sous l'appréciation des tests : éditeur `contenteditable` (`richEditorHTML`/`wireRichEditor`) avec gras/italique/souligné/**couleur** (noir par défaut)/listes à puces·numérotées/**tableaux** (modale `tableSizeDialog`, pas de `prompt`)/**QCM** (modale `mcqDialog` : question + réponses, clic = bonne réponse cochée, widget `.rt-qcm` contenteditable=false). Sérialisée côté client en blocs (`serializeRich` walk récursif → `[{type:'p',runs:[{text,bold,italic,underline,color}]}|{type:'ul'|'ol',items}|{type:'table',rows}|{type:'qcm',question,options,answer}]`), rendue **sans titre** sur le doc par `richToDocx`/`richToPdf` (server, QCM = question gras + options `(X)`/`( )`), après l'appréciation.
- **Tous les modèles sont rendus en TABLEAUX/cases** (fidèles aux Word source). Helpers partagés : `dxCell`/`dxTable`/`dxRowMin` (Word) et `pdfCell`/`pdfRows` (PDF, dessin manuel + sauts de page). **Interactive Worksheet** (`buildWorksheetPdf`/`buildWorksheetDocx`) = bandeau titre + tableau en-tête (apprenant/formateur label·valeur sur 2 colonnes + notes vocab/structure/comm/autre) + un tableau par **séance**. **Tests mi/fin** (`buildTestPdf`/`buildTestDocx`) = un tableau (titre + en-tête 2 colonnes + lignes **Résultat** et **Appréciation formateur** encadrées). `ws*`/`testdoc/generate` appellent ces builders.
- **Rendu en TABLEAUX (comme les Word d'origine)** : `buildQsPdf`/`buildQsDocx` regroupent (`qsBlocks`/`sameOpts`) les questions radio consécutives à options identiques en **matrices** (critères en lignes × options en colonnes, case **cochée** = fond accent + ✗/X). Les questions `scale` → tableau **1‑10** (case sélectionnée surlignée), `text` → **encadré** de réponse, `intro`/`section` → paragraphes. PDF = dessin manuel de cellules (rect + bordures, saut de page avec ré-affichage de l'en-tête) ; Word = vrais `Table`/`TableRow`/`TableCell` (shading `ShadingType.CLEAR`, en-tête répété `tableHeader:true`). Concerne qs_mid/qs_end/qs_formateur. (Les tests `test_*` restent en lignes label:valeur via `buildSimpleDoc*`.)
- **Fiche satisfaction formateur** (`FORM_TEMPLATES.qs_formateur` « Fiche satisfaction formateur — bilan de formation ») : questionnaire **rempli PAR le formateur lui-même** (pas l'apprenant), téléchargé directement (à transmettre ensuite à l'admin via le **canal privé**). En-tête propre (Formateur/Langue/Nom apprenant/Intitulé/Date, sans Société) + matrice radio 4 niveaux `SC4F` (Oui tout à fait / Partiellement / Pas vraiment / Non, pas du tout) + question ouverte. `GET /api/form/:type` sert le modèle ; `POST /api/form/generate {group,type,header,answers,format}` (canEditWs) renvoie le **binaire** (réutilise `buildQsPdf`/`buildQsDocx`, désormais génériques via `tpl.headerFields || QS_HEADER_FIELDS`). Modale plein écran (en-tête éditable préremplie + items via `qsItemsHTML`), download direct, modale reste ouverte.
- **Attestation de fin de stage** (`buildAttestationPdf`/`buildAttestationDocx`, `POST /api/attestation/generate`, **formateur + admin**, download direct) : en-tête prérempli depuis les fiches (apprenant/société/intitulé/**dates début→fin**/durée/formateur) + objectifs (1/ligne) + **matrice d'évaluation des acquis** (6 compétences × Acquis / En cours d'acquisition / Non acquis, case ✗) + niveau/certification/résultat + commentaires + signatures. Modale `openAttestationModal`.
- **Contrat de sous-traitance** (`buildContratPdf`/`buildContratDocx` via `contratBlocks(d)`, `POST /api/contrat/generate`, **admin UNIQUEMENT**, download direct) : texte légal complet (9 articles) ; **introduction + article 1 préremplis** depuis les fiches (sous-traitant = formateur : naissance/nationalité/adresse/SIRET/NDA ; objet = intitulé/langue/stagiaire/durée/dates/lieu) ; **article 5** = l'admin saisit le taux horaire + montant total perçu. Modale `openContratModal` (entrée picker visible admin seul). Représentant L&S = « Antonin HATTABE » fixe (pas de champ). **Référence générée serveur** `newContratRef()` = `Réf. n° {année}/L&S` + **5 chiffres aléatoires uniques** (jamais réutilisés, stockés dans `db.contratRefs`).
- À faire : autres modèles récurrents (feuille de présence…) — l'utilisateur fournira les formats.

## Espace documents — suite
- Autres modèles de documents à ajouter au générateur (l'utilisateur fournira les formats).
- (Phase 3 « Agenda + rappels » : **abandonnée pour l'instant** à la demande de l'utilisateur.)

## Pistes non faites
Déploiement en ligne (Render/Railway) ; brancher les formulaires contact/test au backend ; suppression doc/contact ; relecture native des questions du test.
