# Restaurer le site après un sinistre

Procédure à suivre si le serveur est perdu (panne disque, machine détruite, données effacées).
Temps estimé : **20 à 30 minutes**.

---

## Ce qui est sauvegardé, et ce qui ne l'est pas

**Dans les archives Backblaze B2** (`ls-data-AAAA-MM-JJ-HH-MM-SS-xxxx.tar.gz`, 4 par jour) :

| Contenu | Détail |
|---|---|
| `data/db.json` | comptes (mots de passe hachés), dossiers, messages, notifications, questionnaires, historique des documents générés, historique des connexions, clé de session du site |
| `data/uploads/` | tous les fichiers déposés : documents, feuilles de présence signées, attestations |
| `data/smtp.json` | configuration e-mail *(en production elle vient des variables d'environnement, ce fichier n'existe donc que localement)* |

**PAS dans les archives** (à recréer ou récupérer ailleurs) :

- le **code du site** → il est sur GitHub, branche `V3` ;
- le **secret GitHub `ENV_FILE`** → token Cloudflare, identifiants SMTP OVH, clés Backblaze. Il n'est lisible nulle part une fois enregistré : **en garder une copie hors du serveur** (gestionnaire de mots de passe).

---

## Étape 1 — Récupérer la dernière archive

1. Se connecter sur [secure.backblaze.com](https://secure.backblaze.com) → **B2 Cloud Storage** → **Browse Files** → bucket des sauvegardes.
2. Trier par date, prendre la **plus récente** (ou une plus ancienne si l'incident est une corruption qu'on veut remonter avant).
3. La télécharger.

## Étape 2 — Vérifier l'archive AVANT de reconstruire

```bash
tar -tzf ls-data-XXXX.tar.gz | head -20
```

On doit voir `data/db.json`, `data/smtp.json`, puis `data/uploads/…`. Si `tar` affiche une erreur, prendre l'archive précédente.

## Étape 3 — Remonter le serveur

Sur la nouvelle machine (Docker + Docker Compose installés) :

```bash
git clone https://github.com/berzerkk/lnywebapp.git && cd lnywebapp && git checkout V3
```

Recréer le fichier `.env` à la racine, avec le contenu du secret `ENV_FILE` :

```
CLOUDFLARE_TUNNEL_TOKEN=...
SMTP_HOST=ssl0.ovh.net
SMTP_PORT=465
SMTP_USER=admin@languagesandsuccess.com
SMTP_PASS=...
B2_KEY_ID=...
B2_APP_KEY=...
```

Démarrer une première fois pour que le volume de données soit créé :

```bash
docker compose up -d --build
```

## Étape 4 — Réinjecter les données

Arrêter l'application, vider le volume, y extraire l'archive, redémarrer :

```bash
docker compose stop mon-site
docker run --rm -v lnywebapp_ls-data:/data -v "$PWD":/backup alpine sh -c "rm -rf /data/* && tar -xzf /backup/ls-data-XXXX.tar.gz -C /tmp && cp -a /tmp/data/. /data/"
docker compose start mon-site
```

> Le nom exact du volume s'obtient avec `docker volume ls` (il ressemble à `<dossier>_ls-data`).

## Étape 5 — Vérifier

```bash
docker logs site-bmax --tail 20
```

Attendu au démarrage : `✉ e-mails activés…`, `🗄 sauvegarde offsite activée…`, `L&S server → …`.

Puis, sur le site :

1. la page d'accueil répond ;
2. connexion sur l'espace documents avec un compte réel ;
3. un dossier contient bien ses messages **et** ses documents téléchargeables ;
4. déclencher une sauvegarde manuelle pour confirmer que la chaîne complète refonctionne.

---

## Bon à savoir

- **Perte maximale** : les sauvegardes tournent à 8 h, 12 h, 16 h et 20 h (heure de Paris) — au pire 6 heures de travail perdues.
- **Profondeur** : toutes les archives des 3 derniers jours, puis une par jour sur 30 jours.
- **Les mots de passe des utilisateurs sont conservés** (hachés) : personne n'a besoin de recréer son compte.
- **Une sauvegarde en échec envoie un e-mail d'alerte** à l'administration. Si cet e-mail arrive, ne pas l'ignorer : c'est le seul signal avant un sinistre.
- **Contrôle recommandé une fois par trimestre** : télécharger une archive et vérifier qu'elle s'extrait (étape 2). Une sauvegarde jamais testée n'est pas une sauvegarde.
