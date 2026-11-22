# LEMO Mini

Prototype fonctionnel : une entreprise crée une collecte de retours clients sur WhatsApp, partage un lien ou un QR code, ses clients répondent par écrit ou en vocal, Claude analyse chaque retour, les résultats arrivent dans un mini-CRM et le dirigeant peut demander un bilan sur WhatsApp.

## Comment ça marche

```
Client WhatsApp ──> Meta ──> Kapso ──(webhook signé)──> LEMO Mini (Node.js) ──> Supabase (Postgres)
                                 ^                            │
                                 └──── réponses (API Kapso) ──┤──> Claude (analyse, relance, synthèse)
                                                              └──> Mini-CRM web (admin)
```

- **Kapso** : numéro WhatsApp, webhooks, et **transcription automatique des vocaux** (le texte arrive directement dans le webhook, pas de service de transcription à ajouter).
- **Claude** (`claude-opus-5-5`) : comprend les demandes du dirigeant, décide d'une éventuelle relance, analyse chaque retour en JSON validé par schéma, produit les synthèses.
- **Supabase** : base Postgres. Sans `DATABASE_URL`, une base locale embarquée est utilisée (mode démo).
- **Une seule application Node.js** : webhook + CRM + tâches de fond. Pas de file de messages externe, pas de microservices.

### Parcours

1. Le dirigeant écrit au numéro LEMO : « Je veux savoir ce que mes clients ont pensé de leur séjour ». LEMO crée la collecte (code `LEMO-XXXX`) et renvoie le lien `https://wa.me/NUMERO?text=...(LEMO-XXXX)` + l'adresse du QR code.
2. Un client ouvre le lien : le message prérempli contient le code, LEMO identifie la collecte, se présente au nom de l'entreprise, explique l'usage des données et demande le consentement (boutons Oui / Non).
3. Question ouverte, réponse texte ou vocale, une relance si la réponse est vague, remerciement.
4. Analyse : résumé, émotion dominante, tonalité, sujets, points positifs, irritants, suggestions, urgence. Le numéro en clair est effacé.
5. Le dirigeant écrit « Fais-moi le bilan » : participants, points positifs, 3 problèmes, découverte (si étayée), 3 actions. Rien n'est produit sous le seuil de confidentialité (5 répondants par défaut).

### Points techniques couverts

| Exigence | Mise en œuvre |
|---|---|
| Signature des webhooks | HMAC-SHA256 du corps brut, en-tête `X-Webhook-Signature` (`src/kapso.js`) |
| Messages reçus plusieurs fois | Clé `X-Idempotency-Key` + identifiant WhatsApp unique en base |
| Webhook non perdu | Événement enregistré avant la réponse 200, retraité au redémarrage |
| Plusieurs clients en même temps | Une conversation par numéro, traitement en série par numéro et en parallèle entre numéros |
| Messages de l'entreprise ≠ réponses clients | Seuls les messages `inbound` sont traités ; rôles distincts en base |
| Secrets | Variables d'environnement uniquement (`.env.example`) |
| Consentement, STOP | Consentement explicite avant toute question ; STOP supprime les réponses en cours et coupe tout envoi |
| Conservation limitée | Numéro effacé en fin d'échange ; purge automatique après N jours (réglable, 90 par défaut) |
| Fenêtre WhatsApp 24 h, aucune diffusion | LEMO ne fait que répondre à un message reçu ; aucun envoi spontané, aucun template |
| Confidentialité des synthèses | Seuil configurable (5 par défaut), synthèse faite à partir des analyses, sans verbatim |
| Multi-entreprises | Un accès admin par entreprise, chaque requête filtrée par entreprise |
| Phase de test | `ALLOWED_TEST_NUMBERS` : LEMO ignore tout numéro hors liste |

## 1. Essayer tout de suite (mode démo, aucun compte)

Prérequis : Node.js 22 ou plus.

```bash
npm install
```

```bash
npm run demo
```

Ouvrir http://localhost:3000, se connecter avec `demo@lemo.local` / `demo-lemo`, puis aller dans **Simulateur**. Le simulateur envoie de faux messages par le même webhook signé que Kapso. Changer le numéro simulé permet de jouer plusieurs clients ; le raccourci « Jouer le dirigeant » permet de tester la création de collecte et le bilan.

Sans clé Claude, l'analyse est simulée (mots-clés) et signalée comme telle. Ajouter `ANTHROPIC_API_KEY` dans `.env` pour l'analyse réelle, tout en restant en simulateur WhatsApp.

Tests automatiques du parcours complet :

```bash
npm test
```

## 2. Brancher le vrai WhatsApp (test avec votre téléphone)

Ce dont vous avez besoin :

| Compte | Pour quoi | Où récupérer la clé |
|---|---|---|
| Kapso (projet « LEMO », déjà créé) | WhatsApp, webhooks, transcription | app.kapso.ai > API Keys |
| Anthropic | Claude | console.anthropic.com > API Keys |
| Supabase | Base de données | supabase.com > projet > Connect > Session pooler |
| Hébergeur (Railway ou Render) | Adresse HTTPS publique pour recevoir les webhooks | — |

Toutes les clés se saisissent **dans l'interface de l'hébergeur (onglet Variables)**, jamais dans une conversation ni dans le code.

### Étape A. Sandbox Kapso (pas besoin de Meta pour tester)

1. Kapso > WhatsApp > Sandbox > **Add Test Number** : saisir votre numéro WhatsApp.
2. Envoyer le code d'activation à 6 caractères depuis votre téléphone (valable 15 minutes).
3. Vérifier que la transcription automatique des vocaux est activée dans les réglages du projet Kapso.

Limite : le sandbox n'accepte que les numéros enregistrés comme testeurs. Parfait pour vos tests, pas pour de vrais clients.

### Étape B. Base Supabase

Créer un projet (région Paris `eu-west-3`), puis copier l'URI « Session pooler » dans la variable `DATABASE_URL` de l'hébergeur. Les tables sont créées automatiquement au premier démarrage (`supabase/migrations/001_init.sql`).

### Étape C. Hébergement

Déployer ce dépôt GitHub sur Railway ou Render (service web Node, commande `npm start`). Variables à renseigner :

```
PUBLIC_URL=https://<votre-app>
APP_SECRET=<généré : openssl rand -hex 32>
DATABASE_URL=<Supabase>
KAPSO_API_KEY=<Kapso>
KAPSO_PHONE_NUMBER_ID=597907523413541
WHATSAPP_DISPLAY_NUMBER=56920403095
KAPSO_WEBHOOK_SECRET=<une longue chaîne aléatoire que vous choisissez>
ANTHROPIC_API_KEY=<Anthropic>
ALLOWED_TEST_NUMBERS=<votre numéro, ex 33612345678>
```

Évitez une offre gratuite qui met le service en veille : Kapso réessaie un webhook pendant environ 50 secondes seulement.

### Étape D. Webhook Kapso

Kapso > WhatsApp > Configurations > Sandbox WhatsApp > Manage Webhooks > ajouter :
- URL : `https://<votre-app>/webhooks/kapso`
- Événement : `whatsapp.message.received`
- Secret : la même valeur que `KAPSO_WEBHOOK_SECRET`

### Étape E. Votre entreprise et votre accès

Dans le terminal de l'hébergeur (le mot de passe passe par une variable, jamais en clair dans la commande) :

```bash
ADMIN_PASSWORD="<mot de passe>" npm run create-company -- "Mon entreprise" moi@exemple.fr 33612345678
```

Le dernier argument est votre numéro WhatsApp de dirigeant.

### Étape F. Test de bout en bout

1. Depuis votre WhatsApp, écrire au numéro sandbox : « Je veux savoir ce que mes clients ont pensé de leur séjour ».
2. Ouvrir le lien reçu (vous jouez le client), accepter, répondre par écrit ou en vocal.
3. Ouvrir `https://<votre-app>`, se connecter : le retour apparaît, analysé.
4. Écrire « Fais-moi le bilan » (le seuil de 5 répondants s'applique ; il est réglable dans Réglages pour un test).

Vérification rapide : `https://<votre-app>/health` indique la base, le mode IA et le mode WhatsApp actifs.

## 3. Passer à un vrai numéro (plus tard)

Connecter un numéro dédié via Kapso (Kapso > WhatsApp > Connect, connexion Meta guidée), puis remplacer `KAPSO_PHONE_NUMBER_ID` et `WHATSAPP_DISPLAY_NUMBER`, recréer le webhook sur ce numéro et vider `ALLOWED_TEST_NUMBERS` **uniquement** après validation. Avant d'ouvrir à de vrais clients : mentions d'information RGPD validées par un juriste (responsable de traitement, durée, droits), registre de traitement, et accord de sous-traitance avec Kapso, Anthropic et Supabase.

## Structure

```
src/server.js        webhook, CRM, simulateur
src/conversation.js  parcours client et dirigeant, consentement, STOP
src/llm.js           Claude (sorties JSON validées) + simulateur d'analyse
src/report.js        statistiques, synthèse, seuil de confidentialité
src/kapso.js         signature, envoi de messages, lecture des webhooks
src/jobs.js          clôtures automatiques, reprises, purge RGPD
supabase/migrations  schéma SQL
test/e2e.test.js     parcours complet automatisé
```

## Limites connues du MVP

- Une seule instance serveur (l'ordre des messages par client est garanti en mémoire). Pour plusieurs instances, ajouter un verrou en base.
- Les clients identifiés uniquement par un identifiant WhatsApp sans numéro (BSUID) ne sont pas encore gérés.
- Pas d'alerte WhatsApp spontanée au dirigeant (hors fenêtre 24 h il faudrait un template approuvé) : les alertes sont dans le CRM et dans le bilan.
