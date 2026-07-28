'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('./server/db');

const ACCENT = 0x9b6cff;
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // vérifie toutes les 30 min
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_KEY = 'weekly_recap_last_sent_at';
const RECAP_DAY = 1;  // 0 = dimanche ... 1 = lundi
const RECAP_HOUR = 9; // heure locale du serveur qui héberge le bot

function formatLapTime(ms) {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function buildRecapEmbed(recap, sinceMs) {
  const embed = new EmbedBuilder().setColor(ACCENT).setTitle('📊 Récap hebdo')
    .setDescription(`Depuis <t:${Math.floor(sinceMs / 1000)}:R>`);

  embed.addFields({ name: 'Tours enregistrés cette semaine', value: String(recap.totalLaps) });

  if (recap.mostActive) {
    embed.addFields({ name: '🏁 Pilote le plus actif', value: `**${recap.mostActive.driver_name}** — ${recap.mostActive.laps} tour${recap.mostActive.laps > 1 ? 's' : ''}` });
  }

  if (recap.bestProgress) {
    const p = recap.bestProgress;
    embed.addFields({
      name: '📈 Meilleure progression',
      value: `**${p.driverName}** sur ${p.trackName || 'un circuit'} : \`${formatLapTime(p.priorBest)}\` → \`${formatLapTime(p.newBest)}\` (**-${(p.gain / 1000).toFixed(3)}s**)`,
    });
  }

  if (!recap.mostActive && !recap.bestProgress) {
    embed.addFields({ name: 'Cette semaine', value: 'Aucun tour enregistré.' });
  }

  return embed;
}

function startWeeklyRecap(client) {
  setInterval(() => {
    let lastSentRaw;
    try { lastSentRaw = db.getBotState(STATE_KEY); } catch (err) { return; }
    const lastSent = lastSentRaw ? Number(lastSentRaw) : 0;
    if (Date.now() - lastSent < 6 * 24 * 60 * 60 * 1000) return; // déjà envoyé il y a moins de 6 jours

    const now = new Date();
    if (now.getDay() !== RECAP_DAY || now.getHours() < RECAP_HOUR) return;

    const channels = db.listAnnounceChannels();
    if (!channels.length) return;

    const sinceMs = Date.now() - WEEK_MS;
    let recap;
    try { recap = db.weeklyRecap(sinceMs); } catch (err) { return; }
    if (!recap) return;

    const embed = buildRecapEmbed(recap, sinceMs);
    channels.forEach(({ announce_channel_id }) => {
      client.channels.fetch(announce_channel_id).then((channel) => channel?.send({ embeds: [embed] })).catch(() => {});
    });

    db.setBotState(STATE_KEY, String(Date.now()));
  }, CHECK_INTERVAL_MS);
}

module.exports = { startWeeklyRecap };
