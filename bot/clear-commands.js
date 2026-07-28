'use strict';

// Vide TOUTES les commandes slash déjà enregistrées (globales + celles du
// serveur DISCORD_GUILD_ID si défini), pour repartir propre avant de relancer
// deploy-commands.js. Utile si les commandes sont dupliquées suite à des
// déploiements mélangeant enregistrement global et enregistrement par serveur.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { REST, Routes } = require('discord.js');

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('[clear] DISCORD_TOKEN et DISCORD_CLIENT_ID sont requis (voir bot/.env.example).');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: [] });
    console.log('[clear] Commandes globales vidées.');

    if (DISCORD_GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: [] });
      console.log(`[clear] Commandes du serveur ${DISCORD_GUILD_ID} vidées.`);
    } else {
      console.log('[clear] DISCORD_GUILD_ID non défini : si tu as aussi des commandes enregistrées sur un serveur précis, renseigne-le temporairement dans bot/.env et relance ce script pour les vider aussi.');
    }

    console.log('[clear] Terminé. Relance maintenant `node bot/deploy-commands.js` pour ré-enregistrer proprement (une seule fois, avec ou sans DISCORD_GUILD_ID selon ce que tu veux).');
  } catch (err) {
    console.error('[clear] échec du nettoyage:', err);
    process.exit(1);
  }
})();
