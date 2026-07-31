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
- **Statut** : publié
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

---

# Refusés

*(vide pour l'instant — les sujets que vous refusez viennent ici et ne sont plus reproposés)*
