# Sujets du blog — Languages & Success

**Rien ne s'écrit et rien ne se publie sans votre accord.** Ce fichier enregistre vos décisions ;
c'est lui qui fait foi.

## Les deux portes de validation

**Porte 1 — les sujets.** Une fois par semaine, la recherche automatique propose des sujets et
les inscrit ici en `proposé`. Elle **n'écrit aucun article**. Vous tranchez : `validé` (avec une
date) ou `refusé`. Un sujet refusé reste dans le fichier — c'est la mémoire, il ne vous sera
plus jamais reproposé.

**Porte 2 — les textes.** La rédaction automatique n'écrit **que** les sujets `validé`. Elle
produit un brouillon, jamais une publication. Vous le relisez et vous dites si c'est bon. La
mise en ligne n'a lieu qu'après votre accord.

## Comment décider

Soit en me le disant en conversation (« je valide le sujet sur le TOEIC pour le 5 août »,
« je refuse celui sur les entreprises »), soit à la main :

```
node blog/outils/blog.js proposes                    ← ce qui attend votre décision
node blog/outils/blog.js valider <identifiant> 2026-08-05
node blog/outils/blog.js refuser <identifiant> pas notre sujet
node blog/outils/blog.js planning                    ← où en est tout
```

Vous pouvez aussi éditer directement ce fichier : changez la ligne `- **Statut** :` et ajoutez
la date devant le titre.

## Les statuts

| Statut | Ce que ça veut dire |
|---|---|
| `proposé` | trouvé par la recherche, **attend votre décision** |
| `validé` | vous l'avez accepté — sera rédigé (avec une date), ou gardé en réserve (sans date) |
| `refusé` | vous n'en voulez pas — **ne sera plus jamais reproposé** |
| `à relire` | l'article est écrit, en brouillon, **attend votre relecture** |
| `publié` | en ligne sur le blog |

## Format d'un sujet

La date devant le titre le planifie. Tous les champs sauf le titre sont facultatifs.

```
### 2026-08-05 — Titre de l'article
- **Catégorie** : Certifications
- **Statut** : validé
- **Angle** : ce qu'on veut dire, et à qui on s'adresse
- **Sources** :
  - https://exemple.fr/page-officielle
- **Notes** : ce qui doit absolument figurer, un chiffre, un exemple, un écueil à éviter
```

**Catégories utilisées sur le site** : Financement · Certifications · Méthode · Entreprises ·
FLE · CECRL. Vous pouvez en créer d'autres, elles s'afficheront telles quelles.

---

# En ligne

### 2026-07-31 — CPF : financer sa formation en langue, mode d'emploi
- **Fichier** : cpf-financer-sa-formation-en-langue-mode-d-emploi.html
- **Catégorie** : Financement
- **Statut** : à relire
- **Angle** : guide pas à pas pour un salarié qui n'a jamais mobilisé son CPF, du premier
  clic sur Mon Compte Formation jusqu'au démarrage des cours.
- **Sources** :
  - https://www.moncompteformation.gouv.fr/espace-public/de-nouvelles-regles-pour-mobiliser-votre-cpf
  - https://www.moncompteformation.gouv.fr/espace-public/tout-savoir-sur-les-formations-en-langues-vivantes
- **Notes** : ⚠️ Publié avant la mise en place de la validation. À relire, et à retirer si le
  contenu ne vous convient pas.

---

# En attente de votre décision

### TOEIC, Linguaskill, Cambridge : laquelle choisir ?
- **Catégorie** : Certifications
- **Statut** : proposé
- **Angle** : aider à aligner la certification sur l'objectif réel (embauche, mobilité
  interne, école) plutôt que sur la notoriété du nom.
- **Sources** :
  - https://www.francecompetences.fr/recherche/rs/
- **Notes** : tableau comparatif format / durée / validité / à qui ça s'adresse. Préciser
  que le passage de la certification n'est pas compris dans le tarif de la formation.

### 5 habitudes pour progresser entre deux cours
- **Catégorie** : Méthode
- **Statut** : proposé
- **Angle** : article pratique, sans jargon : ce qu'un apprenant peut faire 15 minutes par
  jour pour que les acquis du cours ne s'évaporent pas.
- **Notes** : rester concret, pas de liste d'applications. S'appuyer sur ce que font nos
  formateurs en séance.

### Former ses équipes à l'anglais : par où commencer ?
- **Catégorie** : Entreprises
- **Statut** : proposé
- **Angle** : le parcours côté RH, de l'audit des besoins à la prise en charge OPCO.

### Français langue étrangère : intégrer un collaborateur
- **Catégorie** : FLE
- **Statut** : proposé
- **Angle** : accompagner un salarié non francophone vers l'autonomie professionnelle.

### A1, B2, C1 : comprendre les niveaux européens
- **Catégorie** : CECRL
- **Statut** : proposé
- **Angle** : ce que chaque niveau permet concrètement de faire, et ce qui sépare deux
  niveaux voisins.

### CPF plafonné : comment financer le reste de votre formation en langue
- **Catégorie** : Financement
- **Statut** : proposé
- **Angle** : le CPF ne couvre plus tout. Passer en revue, pour un salarié, les canaux qui
  prennent le relais sur la part non financée : abondement employeur, OPCO, plan de
  développement des compétences, financement personnel échelonné.
- **Sources** :
  - https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053568407
  - https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053742996
  - https://www.moncompteformation.gouv.fr/espace-public/de-nouvelles-regles-pour-mobiliser-votre-cpf
  - https://of.moncompteformation.gouv.fr/espace-public/loi-de-finances-2026-les-evolutions-concernant-le-cpf
- **Notes** : suite directe de l'article CPF déjà en brouillon — le compléter, pas le
  répéter : lien interne obligatoire vers lui. Deux faits vérifiés à reprendre : plafond de
  **1 500 €** pour les certifications du Répertoire spécifique (décret n° 2026-127 du
  24/02/2026, applicable depuis le 20/02/2026) — or les certifications en langues (TOEIC,
  Linguaskill…) sont enregistrées au RS, donc le plafond s'applique bien à nos parcours ; et
  **participation obligatoire portée à 150 €** au 1er avril 2026 (décret n° 2026-234 du
  30/03/2026), non remboursable par l'organisme. Ne jamais laisser entendre qu'un
  financement complémentaire est acquis : il dépend de l'employeur et de l'OPCO.

### Période de reconversion : le dispositif qui remplace Pro-A et Transco
- **Catégorie** : Entreprises
- **Statut** : proposé
- **Angle** : côté RH et côté salarié, ce que permet le nouveau dispositif entré en vigueur
  le 1er février 2026, et à quelles conditions une formation en langue peut y entrer.
- **Sources** :
  - https://entreprendre.service-public.gouv.fr/actualites/A18798?lang=fr
  - https://travail-emploi.gouv.fr/la-periode-de-reconversion
  - https://www.opcoep.fr/actualites/la-periode-de-reconversion-un-nouveau-dispositif-d-accompagnement-des-mobilites-internes-et-externes
- **Notes** : décrets n° 2026-39 et n° 2026-40 du 28/01/2026 ; remplace Pro-A et Transitions
  collectives ; ouvert à tous les salariés (plus seulement les CDI) ; financement OPCO,
  CPF mobilisable avec l'accord du salarié. ⚠️ Point d'honnêteté à ne pas escamoter : le
  dispositif vise une qualification RNCP, un CQP ou un bloc de compétences — une formation
  en langue n'y entre pas seule, elle s'y insère comme **composante** d'un parcours de
  reconversion. Vérifier ce point à la source avant d'écrire, et si le doute subsiste, dire
  simplement « à examiner avec votre OPCO » plutôt qu'affirmer.

### Titre de séjour : le niveau de français exigé depuis janvier 2026
- **Catégorie** : FLE
- **Statut** : proposé
- **Angle** : ce qui a changé au 1er janvier 2026 pour un ressortissant étranger — prouver
  son niveau par une certification, et non plus seulement suivre des cours — et comment s'y
  préparer sereinement.
- **Sources** :
  - https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000051900489
  - https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000051900519
  - https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053164463
  - https://www.immigration.interieur.gouv.fr/limmigration-en-france/sejour-des-etrangers/lexamen-civique-pour-demander-titre-de-sejour
  - https://formation-civique.interieur.gouv.fr/examen-civique/informations-g%C3%A9n%C3%A9rales-sur-lexamen-civique/
- **Notes** : décrets n° 2025-647 et n° 2025-648 du 15/07/2025 (loi n° 2024-42 du 26/01/2024),
  applicables aux demandes déposées à compter du 1er janvier 2026 ; s'y ajoute l'examen
  civique (QCM de 40 questions, 45 min, 32 bonnes réponses exigées). ⚠️ **Le niveau exact
  par titre doit être revérifié un par un à la source le jour de la rédaction** (carte de
  séjour pluriannuelle, carte de résident, naturalisation) : les sources secondaires se
  contredisent, et ce serait le pire article où se tromper d'un niveau. Lister les
  certifications acceptées et les cas de dispense. Ne rien écrire qui ressemble à un
  conseil juridique, et ne garantir aucun résultat à l'examen.

### Demandeur d'emploi : financer une formation en langue en 2026
- **Catégorie** : Financement
- **Statut** : proposé
- **Angle** : le parcours d'une personne inscrite à France Travail — CPF, AIF, POEC — et
  comment ces aides se combinent maintenant que le CPF est plafonné.
- **Sources** :
  - https://www.francetravail.fr/actualites/a-laffiche/2026/cpf-aif-poec-quel-financement.html
  - https://www.moncompteformation.gouv.fr/espace-public/de-nouvelles-regles-pour-mobiliser-votre-cpf
- **Notes** : public distinct de l'article CPF salarié, à ne pas confondre. L'AIF est
  **accordée au cas par cas par le conseiller**, jamais de droit : le dire clairement.
  ⚠️ La page France Travail citée mentionne encore Pro-A, remplacé depuis le 01/02/2026 —
  ne pas recopier ce point. Vérifier les montants CPF annuels à la source avant de les
  écrire.

### TVA des OPCO au 1er octobre : ce qui change pour financer vos formations
- **Catégorie** : Entreprises
- **Statut** : proposé
- **Angle** : à partir du 1er octobre 2026, la subrogation disparaît dans la plupart des cas
  et l'entreprise avance le coût avant remboursement. Expliquer le nouveau circuit
  facture/trésorerie, sans dramatiser.
- **Sources** :
  - https://www.opcoep.fr/actualites/reforme-de-la-tva-ce-qui-change-pour-vos-demandes-de-prise-en-charge-de-formation-hors-contrat-d
  - https://www.opco-atlas.fr/actualites/reforme-de-la-tva-ce-qui-change-pour-le-financement-de-vos-formations.html
  - https://www.akto.fr/facturation-electronique-tva/
  - https://www.centre-inffo.fr/site-centre-inffo/actualites-centre-inffo/le-quotidien-de-la-formation-actualite-formation-professionnelle-apprentissage/actualites-2026/le-choc-de-la-tva-sur-les-operateurs-de-competences
- **Notes** : sujet à échéance proche — dossiers engagés **à compter du 1er octobre 2026** ;
  les engagements antérieurs gardent l'ancien régime jusqu'à leur terme ; exceptions
  annoncées pour l'apprentissage et pour le plan de développement des compétences des
  entreprises de moins de 50 salariés. ⚠️ L&S est **exonérée de TVA** au titre de la
  formation professionnelle continue : dire ce que cela change concrètement pour le client,
  sans laisser croire à une facturation de TVA de notre part. Confirmer chaque règle sur le
  site de l'OPCO concerné avant publication — les modalités diffèrent d'un OPCO à l'autre.

---

# Refusés

*(vide pour l'instant — les sujets que vous refusez viennent ici et ne sont plus reproposés)*
