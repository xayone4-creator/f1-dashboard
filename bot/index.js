'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { handlers, handleAutocomplete, handleButton } = require('./commands');
const { startAnnouncer } = require('./announcer');
const { startIngestServer } = require('./server/ingest');
const db = require('./server/db');

if (!db.isAvailable()) {
  console.error('[bot] better-sqlite3 n\'est pas installé. Lance `npm install` à la racine du projet avant de démarrer le bot.');
  process.exit(1);
}
if (!process.env.DISCORD_TOKEN) {
  console.error('[bot] Variable DISCORD_TOKEN manquante. Copie bot/.env.example vers bot/.env et renseigne ton token.');
  process.exit(1);
}

// Serveur HTTP qui reçoit les tours poussés par le dashboard local (voir
// server/ingest.js). Nécessite INGEST_SECRET (même valeur des deux côtés)
// et un port exposé publiquement par Railway (variable PORT fournie
// automatiquement par Railway).
if (process.env.INGEST_SECRET) {
  startIngestServer({ port: parseInt(process.env.PORT || '3001', 10), secret: process.env.INGEST_SECRET });
} else {
  console.warn('[bot] INGEST_SECRET manquant : le bot ne recevra pas les tours poussés par le dashboard local.');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[bot] connecté en tant que ${readyClient.user.tag}`);
  startAnnouncer(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const handler = handlers[interaction.commandName];
      if (handler) await handler(interaction);
      return;
    }
    if (interaction.isAutocomplete()) { await handleAutocomplete(interaction); return; }
    if (interaction.isButton()) { await handleButton(interaction); return; }
  } catch (err) {
    console.error('[bot] erreur sur une interaction:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
