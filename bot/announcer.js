'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('../server/db');

const ACCENT = 0x9b6cff;
const POLL_INTERVAL_MS = 8000;

function formatLapTime(ms) {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// Le dashboard (server/index.js) dépose un évènement dans la table
// pending_announcements dès qu'un nouveau record de circuit est battu. Ce
// module tourne dans le process du bot et le publie dans tous les salons
// Discord configurés via /config-annonces — c'est le seul point de contact
// entre les deux processus, en passant par la base partagée.
function startAnnouncer(client) {
  setInterval(() => {
    let pending;
    try { pending = db.consumePendingAnnouncements(); } catch (err) { return; }
    if (!pending.length) return;
    const channels = db.listAnnounceChannels();
    if (!channels.length) return;
    pending.forEach((event) => {
      if (event.kind !== 'new_record') return;
      const { driverName, trackName, lapTimeMs, previousBest } = event.payload;
      const embed = new EmbedBuilder().setColor(ACCENT).setTitle('🏆 Nouveau record !')
        .setDescription(`**${driverName}** vient de signer un nouveau record sur **${trackName || 'circuit inconnu'}**`)
        .addFields(
          { name: 'Nouveau temps', value: `\`${formatLapTime(lapTimeMs)}\``, inline: true },
          { name: 'Ancien record', value: previousBest ? `\`${formatLapTime(previousBest)}\`` : '—', inline: true },
        );
      channels.forEach(({ announce_channel_id }) => {
        client.channels.fetch(announce_channel_id).then((channel) => channel?.send({ embeds: [embed] })).catch(() => {});
      });
    });
  }, POLL_INTERVAL_MS);
}

module.exports = { startAnnouncer };
