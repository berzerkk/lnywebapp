# Sujets du blog — Languages & Success

**Ce fichier pilote tout le blog.** Vous pouvez le modifier librement : ajouter un sujet,
changer une date, réordonner, supprimer. C'est lui qui fait foi.

## Comment ça marche

- **Chaque dimanche**, la veille automatique cherche des sujets d'actualité liés à nos
  thèmes et les ajoute ici, avec une date proposée. Vous recevez le planning sur Slack.
- **Chaque lundi, mercredi et vendredi**, la publication automatique lit ce fichier, prend
  le sujet dont la date est celle du jour, et en rédige l'article. L'article part en
  **brouillon** : il n'apparaît pas sur le blog tant que vous ne l'avez pas validé.
- Pour mettre un brouillon en ligne : `node blog/outils/blog.js publier <identifiant>`,
  ou demandez-le simplement dans une conversation.

## Comment écrire un sujet

Un sujet = un titre en `###`. La date en tête le planifie ; **sans date, il reste en réserve**
et sera pioché plus tard. Tous les champs sauf le titre sont facultatifs.

```
### 2026-08-03 — Titre de l'article
- **Catégorie** : Financement
- **Statut** : planifié
- **Angle** : ce qu'on veut dire, et à qui on s'adresse
- **Sources** :
  - https://exemple.fr/page-officielle
- **Notes** : tout ce qui doit absolument figurer, un chiffre, un exemple, un écueil à éviter
```

**Statuts** : `planifié` (à écrire) → `brouillon` (écrit, en attente de votre feu vert) →
`publié` (en ligne). `en réserve` pour un sujet sans date.

**Catégories utilisées sur le site** : Financement · Certifications · Méthode · Entreprises ·
FLE · CECRL. Vous pouvez en créer d'autres, elles s'afficheront telles quelles.

---

# Planning

### 2026-08-03 — CPF : financer sa formation en langue, mode d'emploi
- **Fichier** : cpf-financer-sa-formation-en-langue-mode-d-emploi.html
- **Catégorie** : Financement
- **Statut** : publié
- **Angle** : guide pas à pas pour un salarié qui n'a jamais mobilisé son CPF, du premier
  clic sur Mon Compte Formation jusqu'au démarrage des cours.
- **Sources** :
  - https://www.moncompteformation.gouv.fr/
  - https://travail-emploi.gouv.fr/formation-professionnelle/droit-a-la-formation/cpf
- **Notes** : rappeler le délai d'inscription minimal imposé par la plateforme, et que
  L&S accompagne le montage du dossier. Ne jamais promettre une prise en charge totale.

### 2026-08-05 — TOEIC, Linguaskill, Cambridge : laquelle choisir ?
- **Catégorie** : Certifications
- **Statut** : planifié
- **Angle** : aider à aligner la certification sur l'objectif réel (embauche, mobilité
  interne, école) plutôt que sur la notoriété du nom.
- **Sources** :
  - https://www.francecompetences.fr/recherche/rs/
- **Notes** : tableau comparatif format / durée / validité / à qui ça s'adresse. Préciser
  que le passage de la certification n'est pas compris dans le tarif de la formation.

### 2026-08-07 — 5 habitudes pour progresser entre deux cours
- **Catégorie** : Méthode
- **Statut** : planifié
- **Angle** : article pratique, sans jargon : ce qu'un apprenant peut faire 15 minutes par
  jour pour que les acquis du cours ne s'évaporent pas.
- **Notes** : rester concret, pas de liste d'applications. S'appuyer sur ce que font nos
  formateurs en séance.

# En réserve

### Former ses équipes à l'anglais : par où commencer ?
- **Catégorie** : Entreprises
- **Statut** : en réserve
- **Angle** : le parcours côté RH, de l'audit des besoins à la prise en charge OPCO.

### Français langue étrangère : intégrer un collaborateur
- **Catégorie** : FLE
- **Statut** : en réserve
- **Angle** : accompagner un salarié non francophone vers l'autonomie professionnelle.

### A1, B2, C1 : comprendre les niveaux européens
- **Catégorie** : CECRL
- **Statut** : en réserve
- **Angle** : ce que chaque niveau permet concrètement de faire, et ce qui sépare deux
  niveaux voisins.
