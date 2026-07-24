# F1 25 — Dashboard de télémétrie live

Dashboard local (Node.js + navigateur) qui reçoit la télémétrie UDP envoyée par **F1 25**
et affiche :

- 🗺️ carte du circuit en direct (positions des voitures, tracé auto-généré)
- 📈 graphique vitesse / accélérateur / frein après un tour
- ⏱️ delta en direct (comme à l'écran des pilotes)
- 📊 comparaison de deux tours (vitesse superposée + delta gagné/perdu par distance)
- 🎥 overlay transparent pour OBS/Twitch (`/overlay.html`)
- 🏁 live timing (position, dernier tour, delta au leader)
- 🤖 bot Discord optionnel (chronos, records, historique, lobbies, ligues — voir `bot/README.md`)

Ce projet tourne **sur ta machine** (PC, ou un Raspberry Pi/mini-PC sur ton réseau local) :
c'est ce process qui écoute les paquets UDP envoyés par le jeu, donc il doit être lancé sur
un appareil qui reçoit ces paquets (le PC qui fait tourner F1 25, ou un autre appareil sur le
même réseau si tu joues sur PS5/Xbox).

## 0. Démarrage rapide (sans terminal)

Double-clique simplement sur **`Lancer le dashboard.bat`** :
- il installe les dépendances tout seul la première fois,
- il démarre le serveur,
- il ouvre le dashboard dans ton navigateur automatiquement.

Pour ne plus avoir à rouvrir ce dossier, double-clique une fois sur **`Creer un raccourci bureau.bat`** :
ça ajoute une icône **"APEX Dashboard"** sur ton bureau qui fait tout ça en un clic.

Pour fermer le dashboard, ferme simplement la fenêtre noire (le terminal) qui s'est ouverte.

## 1. Installation

Il faut [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
cd f1-dashboard
npm install
npm start
```

Tu verras :

```
[UDP] à l'écoute des paquets F1 25 sur le port 20777
[HTTP] dashboard disponible sur http://localhost:3000
[HTTP] overlay OBS disponible sur http://localhost:3000/overlay.html
```

Ouvre `http://localhost:3000` dans ton navigateur (tu peux le laisser ouvert sur un
deuxième écran pendant que tu joues).

## 2. Configurer la télémétrie dans F1 25

Dans le jeu : **Options → Réglages → Réglages de télémétrie UDP** :

| Réglage           | Valeur                                                        |
|-------------------|----------------------------------------------------------------|
| UDP Telemetry     | On                                                              |
| UDP Broadcast     | Off (recommandé)                                                |
| UDP IP Address    | l'adresse IP locale du PC qui fait tourner ce dashboard (ex: `192.168.1.34`) — mets `127.0.0.1` si le jeu et le dashboard tournent sur le même PC |
| UDP Port          | `20777` (par défaut, modifiable via la variable d'env `F1_UDP_PORT`) |
| UDP Send Rate     | 20 Hz (stable) ou 60 Hz (plus fluide, réseau qui doit suivre)   |
| **UDP Format**    | **2025** ⚠️ important — c'est ce format que ce parseur comprend |

Si tu joues sur **PS5/Xbox**, mets simplement l'IP du PC/laptop qui fait tourner ce
dashboard (les deux appareils doivent être sur le même réseau Wi-Fi/Ethernet).

Windows : trouve ton IP locale avec `ipconfig` (cherche "Adresse IPv4"). Autorise aussi
le jeu dans le pare-feu Windows si les paquets n'arrivent pas.

## 3. Utiliser le dashboard

- **Carte du circuit** : se dessine automatiquement dès que tu roules un tour (le tracé
  violet est ta trajectoire). Aucune donnée de circuit statique n'est nécessaire.
- **Live timing / delta** : se met à jour dès que le paquet "Lap Data" arrive.
- **Graphique après un tour** : dès qu'un tour est terminé, il apparaît dans le menu
  déroulant "Tour" → clique "Afficher".
- **Comparer deux tours** : coche les tours que tu veux dans le panneau du bas (autant
  que tu veux, pas limité à deux) puis clique "Comparer". Trois graphiques apparaissent :
  vitesse, frein, et delta (chaque tour comparé au plus rapide du lot coché).

## 5. Télémétrie en direct (façon ingénieur de piste)

Le panneau "Télémétrie en direct" trace vitesse / accélérateur / frein en continu pendant
que tu roules — le graphique se construit point par point, sans attendre la fin du tour.
Il se réinitialise automatiquement à chaque nouveau tour.

## 6. Tracés de circuits pré-enregistrés

Le jeu n'envoie pas de tracé statique du circuit : le dashboard reconstruit la carte à
partir de ta position en direct. Pour ne pas attendre un tour complet à chaque session,
il enregistre automatiquement ta trajectoire sur disque (dossier `track-cache/`, un
fichier JSON par circuit) dès que tu boucles un tour valide — et ne garde que la version
la plus complète rencontrée.

Monaco, Spa et le Hungaroring sont marqués comme circuits favoris (badge sous la carte) :
dès que tu auras roulé une fois dessus, leur tracé sera chargé instantanément au début de
chaque session suivante, avant même que tu aies fini un tour. Tu peux ajouter d'autres
circuits favoris en éditant la liste `PRIORITY_TRACKS` dans `server/tracks.js` — mais
même sans ça, **tout circuit que tu joues** voit son tracé mis en cache automatiquement.

## 7. Overlay OBS/Twitch

Dans OBS : **Ajouter une source → Navigateur (Browser Source)**
- URL : `http://localhost:3000/overlay.html`
- Largeur/Hauteur : 360 x 220 (ajustable)
- Coche "Fond transparent" n'est pas nécessaire : la page est déjà transparente.

## Notes techniques

- Le parseur (`server/f1Parser.js`) implémente le format **UDP 2025** officiel de F1 25
  (paquets Motion, Session, Lap Data, Car Telemetry, Participants). Référence : spécification
  publiée par EA sur les forums officiels du jeu.
- Le dashboard ne stocke rien sur disque : l'historique des tours vit en mémoire pendant que
  le serveur tourne (redémarrer le serveur efface l'historique de tours).
- Si tu changes le port UDP dans le jeu, lance le serveur avec :
  `F1_UDP_PORT=12345 npm start`
- Pour changer le port HTTP du dashboard : `PORT=8080 npm start`
