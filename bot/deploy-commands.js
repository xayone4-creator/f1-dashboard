'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { REST, Routes } = require('discord.js');
const { commandBuilders } = require('./commands');

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('[deploy] DISCORD_TOKEN et DISCORD_CLIENT_ID sont requis (voir bot/.env.example).');
  process.exit(1);
}

const body = commandBuilders.map((builder) => builder.toJSON());
const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    if (DISCORD_GUILD_ID) {
      // Enregistrement sur un seul serveur : disponible immédiatement, idéal en développement.
      await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body });
      console.log(`[deploy] ${body.length} commandes enregistrées sur le serveur ${DISCORD_GUILD_ID}.`);
    } else {
      // Enregistrement global : disponible sur tous les serveurs, peut prendre jusqu'à 1h à se propager.
      await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body });
      console.log(`[deploy] ${body.length} commandes enregistrées globalement (propagation possible jusqu'à 1h).`);
    }
  } catch (err) {
    console.error('[deploy] échec de l\'enregistrement des commandes:', err);
    process.exit(1);
  }
})();
