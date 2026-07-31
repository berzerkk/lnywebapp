# Blog Languages & Success — comment ça tourne

Deux automatisations, un fichier de pilotage, et un feu vert humain avant toute mise en ligne.

```
blog/
  sujets.md            ← LE fichier de pilotage. Éditable à la main, il fait foi.
  <slug>.html          ← articles EN LIGNE (listés sur blog.html)
  brouillons/<slug>.html ← articles écrits, en attente de validation (non listés)
  outils/blog.js       ← lecture des sujets, génération de l'index, mise en ligne
  outils/notifier.js   ← Slack (ou e-mail à défaut)
  outils/gabarit.html  ← modèle d'article, jamais publié tel quel
```

## Les deux tâches planifiées

| Quand | Quoi |
|---|---|
| **Dimanche** | Veille : recherche de sujets sur le web, ajout dans `sujets.md` avec des dates proposées, notification du nouveau planning. |
| **Lundi, mercredi, vendredi** | Publication : lecture de `sujets.md`, rédaction de l'article du jour **en brouillon**, notification avec le lien de prévisualisation et les posts réseaux sociaux prêts à copier. |

Un article ne part **jamais** en ligne tout seul. Pour valider :

```bash
node blog/outils/blog.js publier <identifiant>
```

…ou demandez-le simplement en conversation (« publie l'article sur le CPF »).

## Les commandes

```bash
node blog/outils/blog.js planning              # le planning à venir, en clair
node blog/outils/blog.js sujets --jour         # le sujet prévu aujourd'hui (JSON)
node blog/outils/blog.js index                 # régénère la grille de blog.html
node blog/outils/blog.js publier <slug>        # brouillon → en ligne (+ index)
node blog/outils/blog.js statut <slug> <statut>
node blog/outils/notifier.js "titre" "corps"   # Slack, ou e-mail si pas de webhook
```

## Notifications

`data/slack.json` (hors dépôt Git, comme le mot de passe SMTP) :

```json
{ "webhook": "https://hooks.slack.com/services/XXX/YYY/ZZZ" }
```

Sans ce fichier, les notifications partent **par e-mail** via le SMTP déjà configuré
(`data/smtp.json`). Rien d'autre à changer le jour où le webhook arrive.

---

# Règles de rédaction

Ces règles s'appliquent à **tout** article généré. Elles priment sur l'envie de bien faire.

## Exactitude — c'est un site d'organisme de formation certifié

- **Toute donnée chiffrée, tout délai, tout dispositif de financement doit être vérifié à la
  source** (`moncompteformation.gouv.fr`, `travail-emploi.gouv.fr`, `service-public.fr`,
  `francecompetences.fr`) le jour de la rédaction, jamais écrit de mémoire. Les règles du CPF
  changent : un plafond exact l'an dernier peut être faux aujourd'hui.
- **Citer les sources en fin d'article**, en liens cliquables vers les pages officielles.
- **Ne jamais promettre** une prise en charge intégrale, un résultat à une certification, un
  délai d'obtention, ni un niveau atteint. L&S est tenue d'une obligation de moyens.
- En cas de doute sur un fait, **ne pas l'écrire**. Un article plus court est préférable à un
  article inexact.

## Forme

- **Français, vouvoiement**, ton de l'équipe pédagogique : direct, concret, sans jargon.
- **700 à 1 100 mots**. Un chapô qui tient en une phrase, puis 4 à 6 sections `<h2>`.
- Pas de superlatifs commerciaux, pas de « révolutionnaire », pas d'emoji dans le corps.
- Le mot **« promesse » est proscrit** sur tout le site.
- On dit **« apprenant »**, jamais « stagiaire ».
- HTML : reprendre `outils/gabarit.html`, remplir les `{{marqueurs}}`, corps en `<p>`, `<h2>`,
  `<ul>`. La fiche `<script id="ls-meta">` est obligatoire — sans elle l'article n'apparaît pas.
- Se terminer par une section **Sources** puis le lien retour vers le blog.

## Ce qu'on ne traduit pas

Les articles restent **en français**, comme les pages légales. Aucune clé i18n à ajouter.

---

# Posts réseaux sociaux

À chaque article, préparer **deux textes prêts à copier**, envoyés dans la notification.
Ils ne sont **pas publiés automatiquement** : c'est l'humain qui poste.

- **LinkedIn** — 3 à 5 lignes, ton professionnel, un angle utile (pas un résumé), une question
  ouverte en fin, le lien de l'article, 3 mots-dièse maximum.
- **Facebook** — 2 à 3 lignes, plus chaleureux, tourné vers le particulier, le lien.

Ne jamais y écrire un chiffre qui ne figure pas dans l'article.
