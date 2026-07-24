# Bot Discord — APEX

Le bot partage la même base de données que le dashboard (`data/apex.db`,
créée automatiquement, via le SQLite intégré à Node.js — aucune dépendance
à compiler, aucun Python ni outil de build nécessaire). Chaque tour validé
dans le dashboard est enregistré et devient consultable depuis Discord.

**Prérequis : Node.js 22.5 ou plus récent** pour la persistance des tours
et le bot (le dashboard seul continue de fonctionner dès Node 18, mais sans
historique partagé ni bot Discord si ta version est plus ancienne). Tu peux
vérifier ta version avec `node --version` dans un terminal.

Au démarrage, tu verras un message `ExperimentalWarning: SQLite is an
experimental feature` — c'est normal, Node l'affiche pour toute fonctionnalité
encore marquée expérimentale, ça ne veut pas dire que quelque chose est cassé.

## 1. Créer l'application Discord

1. Va sur https://discord.com/developers/applications → **New Application**.
2. Onglet **Bot** → **Reset Token** → copie le token.
3. Onglet **General Information** → copie l'**Application ID**.
4. Toujours onglet **Bot** : pas besoin d'activer d'intents privilégiés (le
   bot ne lit aucun message, uniquement des commandes slash et des boutons).

## 2. Configurer

```
cd bot
cp .env.example .env
```

Remplis `.env` avec le token, l'Application ID, et (recommandé pendant les
tests) l'ID de ton serveur Discord — active le mode développeur dans
Discord (Paramètres → Avancés) puis clic droit sur ton serveur → *Copier
l'identifiant du serveur*.

## 3. Installer les dépendances (une seule fois, depuis la racine du projet)

```
npm install
```

## 4. Inviter le bot sur ton serveur

Remplace `CLIENT_ID` par ton Application ID :

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=277025508352&scope=bot%20applications.commands
```

## 5. Enregistrer les commandes slash

```
npm run deploy-commands
```

À refaire seulement quand tu ajoutes/modifies une commande.

## 6. Démarrer le bot

```
npm run bot
```

Laisse le dashboard (`npm start` / `Lancer le dashboard.bat`) tourner en
parallèle : c'est lui qui alimente la base avec tes tours au fur et à
mesure que tu pilotes.

## Commandes disponibles

- `/chrono [circuit]` — meilleurs chronos, globaux ou pour un circuit
- `/record circuit:<nom>` — record actuel sur un circuit (+ secteurs)
- `/historique [pilote]` — 10 derniers tours d'un pilote
- `/stats [pilote]` — statistiques d'un pilote
- `/lier nom:<ton nom>` — lie ton compte Discord à ton nom de pilote (pour
  utiliser `/historique` et `/stats` sans préciser de nom à chaque fois)
- `/lobby creer` / `/lobby liste` — Open Lobby avec boutons Rejoindre/Quitter/Fermer
- `/ligue creer` / `rejoindre` / `classement` / `liste` — mini-ligues par serveur
- `/config-annonces salon:<#salon>` — (admin) salon des annonces automatiques
- `/annonce message:<texte>` — (admin) annonce manuelle

## Ce qui n'est pas encore fait

- Gestion fine des permissions (rôles personnalisés au-delà de la
  permission Discord "Gérer le serveur")
- Import d'un fantôme depuis Discord vers le Time Trial
- Statistiques avancées / saisons (prévu avec le Mode Carrière)
