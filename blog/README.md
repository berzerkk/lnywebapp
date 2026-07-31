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

## Deux tâches, deux portes de validation

**Rien ne s'écrit et rien ne se publie sans l'accord de l'utilisateur.**

| Tâche | Quand | Ce qu'elle fait | Ce qu'elle ne fait PAS |
|---|---|---|---|
| `blog-ls-1-recherche-sujets` | jeudi | cherche des sujets, les inscrit en `proposé`, poste la liste sur Slack | n'écrit aucun article, ne valide rien |
| `blog-ls-2-redaction` | lundi | rédige en brouillon **les seuls sujets `validé`**, poste les liens de relecture | ne publie rien, n'invente aucun sujet |

**Porte 1 — les sujets.** La recherche propose ; l'utilisateur valide (avec une date) ou refuse.
Un sujet `refusé` reste dans `sujets.md` : c'est la mémoire, il ne sera **plus jamais reproposé**.

**Porte 2 — les textes.** La rédaction ne touche qu'aux sujets `validé`. Elle produit un
brouillon (non listé, exclu de l'indexation) et attend la relecture. Si la liste des sujets
validés est vide, **elle ne fait rien** — elle ne comble jamais un trou toute seule.

Pour mettre un article en ligne, une fois relu :

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

## SEO — écrire pour être lu ET pour être trouvé

- **Un mot-clé principal par article**, choisi comme une expression que quelqu'un taperait
  vraiment (« financer sa formation en langue avec le CPF », pas « CPF »). Il doit figurer
  dans le `<h1>`, dans le **premier paragraphe**, et dans **au moins un `<h2>`**. Deux ou trois
  expressions secondaires suffisent — pas de bourrage : un texte qui se lit mal est pénalisé.
- **Hiérarchie stricte** : un seul `<h1>` (le titre), les sections en `<h2>`, les sous-parties
  en `<h3>`. Jamais de saut de niveau, jamais deux `<h1>`.
- **`<title>` ≤ 60 caractères** (au-delà Google tronque) avec le mot-clé en tête. Il peut
  différer du `<h1>` : le `<h1>` séduit, le `<title>` cible.
- **Meta description de 150 à 160 caractères**, contenant le mot-clé, écrite comme une promesse
  de lecture — c'est elle qui décide du clic.
- **`<link rel="canonical">`** sur l'URL définitive de l'article.
- **2 à 3 liens internes** vers d'autres pages du site (formations, financement, contact…) :
  c'est ce qui fait circuler l'autorité entre les pages.
- **Open Graph + Twitter card** renseignés : sans eux, un partage LinkedIn ou Facebook affiche
  une vignette vide.
- **Données structurées** obligatoires dans le gabarit : `Article`, `BreadcrumbList` et
  `FAQPage`. ⚠️ Le JSON-LD de la FAQ doit reprendre **exactement** les questions et réponses
  visibles, même texte et même ordre — sinon Google rejette le balisage.
- **Slug court et parlant**, contenant le mot-clé, sans mot vide inutile.

## FAQ de fin d'article

Chaque article se termine par une section **Questions fréquentes** : **5 questions**, ou 4 si on
n'en trouve pas 5 qui soient réellement posées. Ce sont de vraies questions de lecteur (« Mon
employeur est-il informé si j'utilise mon CPF ? »), pas des relances commerciales. Réponse de
2 à 4 phrases, autonome. Les questions sont des `<h3>` dans un `<div class="faq">`, et se
retrouvent à l'identique dans le `FAQPage` du JSON-LD.

## Images

- **Une couverture par article**, générée automatiquement :
  `node blog/outils/couverture.js <slug> "<Catégorie>"` → `blog/img/<slug>.svg`
  Visuel SVG aux couleurs du site, composition déterministe (même article = même image, deux
  articles = deux images). Elle sert à la fois de vignette sur `blog.html`, d'illustration en
  tête d'article, et d'`og:image` au partage.
- **Illustrations en cours d'article** bienvenues quand elles aident :
  `<img class="art-illu" src="img/…" alt="…" />`
- **Toujours un `alt` descriptif**, jamais « image » ni le nom du fichier : il sert aux lecteurs
  d'écran et au référencement des images.

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
