'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('../server/db');
const { trackName, trackIdByName, TRACKS } = require('../server/state');

const ACCENT = 0x9b6cff;

function formatLapTime(ms) {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// --- Définition des commandes -----------------------------------------

const commandBuilders = [
  new SlashCommandBuilder().setName('chrono')
    .setDescription('Meilleurs chronos, globaux ou pour un circuit précis')
    .addStringOption((opt) => opt.setName('circuit').setDescription('Nom du circuit (optionnel)').setAutocomplete(true)),

  new SlashCommandBuilder().setName('record')
    .setDescription('Record actuel sur un circuit')
    .addStringOption((opt) => opt.setName('circuit').setDescription('Nom du circuit').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder().setName('historique')
    .setDescription('Historique des derniers tours d\'un pilote')
    .addStringOption((opt) => opt.setName('pilote').setDescription('Nom du pilote (par défaut : toi, si tu es lié via /lier)')),

  new SlashCommandBuilder().setName('stats')
    .setDescription('Statistiques d\'un pilote')
    .addStringOption((opt) => opt.setName('pilote').setDescription('Nom du pilote (par défaut : toi, si tu es lié via /lier)')),

  new SlashCommandBuilder().setName('lier')
    .setDescription('Lie ton compte Discord à ton nom de pilote dans le dashboard')
    .addStringOption((opt) => opt.setName('nom').setDescription('Ton nom de pilote exact (celui affiché dans le dashboard)').setRequired(true)),

  new SlashCommandBuilder().setName('lobby')
    .setDescription('Gérer les Open Lobby')
    .addSubcommand((sub) => sub.setName('creer').setDescription('Créer un Open Lobby')
      .addStringOption((opt) => opt.setName('circuit').setDescription('Circuit').setRequired(true).setAutocomplete(true))
      .addStringOption((opt) => opt.setName('session').setDescription('Type de session (ex. Course, Qualif, Time Trial)'))
      .addIntegerOption((opt) => opt.setName('places').setDescription('Nombre de places (défaut 22)').setMinValue(2).setMaxValue(22)))
    .addSubcommand((sub) => sub.setName('liste').setDescription('Lister les Open Lobby ouverts sur ce serveur')),

  new SlashCommandBuilder().setName('ligue')
    .setDescription('Gérer les ligues')
    .addSubcommand((sub) => sub.setName('creer').setDescription('Créer une ligue')
      .addStringOption((opt) => opt.setName('nom').setDescription('Nom de la ligue').setRequired(true)))
    .addSubcommand((sub) => sub.setName('rejoindre').setDescription('Rejoindre une ligue existante')
      .addStringOption((opt) => opt.setName('nom').setDescription('Nom de la ligue').setRequired(true)))
    .addSubcommand((sub) => sub.setName('classement').setDescription('Voir le classement d\'une ligue')
      .addStringOption((opt) => opt.setName('nom').setDescription('Nom de la ligue').setRequired(true)))
    .addSubcommand((sub) => sub.setName('liste').setDescription('Lister les ligues de ce serveur')),

  new SlashCommandBuilder().setName('config-annonces')
    .setDescription('[Admin] Définir le salon des annonces automatiques (nouveaux records)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) => opt.setName('salon').setDescription('Salon où publier les annonces').setRequired(true)),

  new SlashCommandBuilder().setName('annonce')
    .setDescription('[Admin] Publier une annonce manuelle')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) => opt.setName('message').setDescription('Contenu de l\'annonce').setRequired(true)),
];

// --- Handlers ------------------------------------------------------------

function driverFromLink(discordId) {
  return db.linkedDriver ? db.linkedDriver(discordId) : null;
}

async function handleChrono(interaction) {
  const circuit = interaction.options.getString('circuit');
  const trackId = circuit ? trackIdByName(circuit) : null;
  if (circuit && trackId === null) return interaction.reply({ content: `Circuit inconnu : "${circuit}".`, ephemeral: true });
  const rows = db.bestLaps({ trackId, limit: 10 });
  if (!rows.length) return interaction.reply('Aucun chrono enregistré pour le moment.');
  const embed = new EmbedBuilder().setColor(ACCENT)
    .setTitle(circuit ? `🏁 Meilleurs chronos — ${circuit}` : '🏁 Meilleurs chronos (tous circuits)')
    .setDescription(rows.map((row, i) => `**${i + 1}.** ${row.driver_name} — \`${formatLapTime(row.lap_time_ms)}\`${circuit ? '' : ` · ${row.track_name || trackName(row.track_id)}`}`).join('\n'));
  return interaction.reply({ embeds: [embed] });
}

async function handleRecord(interaction) {
  const circuit = interaction.options.getString('circuit', true);
  const trackId = trackIdByName(circuit);
  if (trackId === null) return interaction.reply({ content: `Circuit inconnu : "${circuit}".`, ephemeral: true });
  const record = db.recordForTrack(trackId);
  if (!record) return interaction.reply(`Aucun record enregistré sur **${circuit}** pour l'instant.`);
  const embed = new EmbedBuilder().setColor(ACCENT).setTitle(`🏆 Record — ${circuit}`)
    .setDescription(`**${record.driver_name}** — \`${formatLapTime(record.lap_time_ms)}\``)
    .addFields(
      { name: 'S1', value: formatLapTime(record.sector1_ms).replace(/^0:/, ''), inline: true },
      { name: 'S2', value: formatLapTime(record.sector2_ms).replace(/^0:/, ''), inline: true },
      { name: 'S3', value: formatLapTime(record.sector3_ms).replace(/^0:/, ''), inline: true },
    );
  return interaction.reply({ embeds: [embed] });
}

async function handleHistorique(interaction) {
  const pilote = interaction.options.getString('pilote') || driverFromLink(interaction.user.id);
  if (!pilote) return interaction.reply({ content: 'Précise un pilote, ou lie ton compte avec `/lier nom:<ton nom>`.', ephemeral: true });
  const laps = db.driverHistory(pilote, 10);
  if (!laps.length) return interaction.reply(`Aucun tour enregistré pour **${pilote}**.`);
  const embed = new EmbedBuilder().setColor(ACCENT).setTitle(`📜 Historique — ${pilote}`)
    .setDescription(laps.map((lap) => `\`${formatLapTime(lap.lap_time_ms)}\` — ${lap.track_name || trackName(lap.track_id)} · <t:${Math.floor(lap.recorded_at / 1000)}:R>`).join('\n'));
  return interaction.reply({ embeds: [embed] });
}

async function handleStats(interaction) {
  const pilote = interaction.options.getString('pilote') || driverFromLink(interaction.user.id);
  if (!pilote) return interaction.reply({ content: 'Précise un pilote, ou lie ton compte avec `/lier nom:<ton nom>`.', ephemeral: true });
  const stats = db.driverStats(pilote);
  if (!stats || !stats.totalLaps) return interaction.reply(`Aucune donnée pour **${pilote}**.`);
  const embed = new EmbedBuilder().setColor(ACCENT).setTitle(`📊 Statistiques — ${pilote}`)
    .addFields(
      { name: 'Tours enregistrés', value: String(stats.totalLaps), inline: true },
      { name: 'Meilleur tour toutes pistes', value: formatLapTime(stats.bestOverall), inline: true },
      { name: 'Circuits pilotés', value: String(stats.tracksDriven), inline: true },
    );
  if (stats.perTrack?.length) {
    embed.addFields({ name: 'Meilleur par circuit', value: stats.perTrack.slice(0, 10).map((t) => `${t.track_name || trackName(t.track_id)} : \`${formatLapTime(t.best)}\``).join('\n') });
  }
  return interaction.reply({ embeds: [embed] });
}

async function handleLier(interaction) {
  const nom = interaction.options.getString('nom', true);
  db.linkDriver ? db.linkDriver(interaction.user.id, nom) : null;
  return interaction.reply({ content: `Ton compte Discord est maintenant lié au pilote **${nom}**.`, ephemeral: true });
}

function lobbyRow(lobbyId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lobby:join:${lobbyId}`).setLabel('Rejoindre').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`lobby:leave:${lobbyId}`).setLabel('Quitter').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`lobby:close:${lobbyId}`).setLabel('Fermer').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

function lobbyEmbed(lobby) {
  const players = lobby.players.map((p) => `<@${p.discord_id}>`).join('\n') || '_Personne pour l\'instant_';
  return new EmbedBuilder().setColor(lobby.status === 'closed' ? 0x555555 : ACCENT)
    .setTitle(`🏎️ Open Lobby — ${lobby.track_name || 'Circuit libre'}`)
    .setDescription(`Organisé par <@${lobby.host_discord_id}>${lobby.session_type ? `\nSession : **${lobby.session_type}**` : ''}\nPlaces : **${lobby.players.length}/${lobby.max_players}**${lobby.status === 'closed' ? '\n\n**Lobby fermé.**' : ''}`)
    .addFields({ name: 'Pilotes inscrits', value: players });
}

async function handleLobby(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'creer') {
    const circuit = interaction.options.getString('circuit', true);
    const session = interaction.options.getString('session') || null;
    const places = interaction.options.getInteger('places') || 22;
    const lobbyId = db.createLobby({ guildId: interaction.guildId, channelId: interaction.channelId, hostDiscordId: interaction.user.id, trackName: circuit, sessionType: session, maxPlayers: places });
    const lobby = db.getLobby(lobbyId);
    const message = await interaction.reply({ embeds: [lobbyEmbed(lobby)], components: [lobbyRow(lobbyId)], fetchReply: true });
    db.setLobbyMessage(lobbyId, message.id);
    return;
  }
  if (sub === 'liste') {
    const lobbies = db.listOpenLobbies(interaction.guildId);
    if (!lobbies.length) return interaction.reply('Aucun Open Lobby ouvert sur ce serveur pour le moment.');
    const embed = new EmbedBuilder().setColor(ACCENT).setTitle('🏎️ Open Lobby ouverts')
      .setDescription(lobbies.map((l) => `**#${l.id}** — ${l.track_name || 'Circuit libre'} (hôte <@${l.host_discord_id}>)`).join('\n'));
    return interaction.reply({ embeds: [embed] });
  }
}

async function handleLigue(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'creer') {
    const nom = interaction.options.getString('nom', true);
    if (db.findLeagueByName(nom, interaction.guildId)) return interaction.reply({ content: 'Une ligue avec ce nom existe déjà ici.', ephemeral: true });
    db.createLeague(nom, interaction.guildId, interaction.user.id);
    return interaction.reply(`Ligue **${nom}** créée. Les autres peuvent la rejoindre avec \`/ligue rejoindre nom:${nom}\`.`);
  }
  if (sub === 'rejoindre') {
    const nom = interaction.options.getString('nom', true);
    const league = db.findLeagueByName(nom, interaction.guildId);
    if (!league) return interaction.reply({ content: `Ligue "${nom}" introuvable sur ce serveur.`, ephemeral: true });
    db.joinLeague(league.id, interaction.user.id, interaction.user.username);
    return interaction.reply(`Tu as rejoint la ligue **${nom}**.`);
  }
  if (sub === 'classement') {
    const nom = interaction.options.getString('nom', true);
    const league = db.findLeagueByName(nom, interaction.guildId);
    if (!league) return interaction.reply({ content: `Ligue "${nom}" introuvable sur ce serveur.`, ephemeral: true });
    const standings = db.leagueStandings(league.id);
    if (!standings.length) return interaction.reply(`La ligue **${nom}** n'a pas encore de membres.`);
    const embed = new EmbedBuilder().setColor(ACCENT).setTitle(`🏆 Classement — ${nom}`)
      .setDescription(standings.map((m, i) => `**${i + 1}.** <@${m.discord_id}> — ${m.points} pts`).join('\n'));
    return interaction.reply({ embeds: [embed] });
  }
  if (sub === 'liste') {
    const leagues = db.listLeagues(interaction.guildId);
    if (!leagues.length) return interaction.reply('Aucune ligue créée sur ce serveur pour le moment.');
    return interaction.reply(`Ligues sur ce serveur : ${leagues.map((l) => `**${l.name}**`).join(', ')}`);
  }
}

async function handleConfigAnnonces(interaction) {
  const channel = interaction.options.getChannel('salon', true);
  db.setAnnounceChannel(interaction.guildId, channel.id);
  return interaction.reply({ content: `Les nouveaux records seront annoncés dans ${channel}.`, ephemeral: true });
}

async function handleAnnonce(interaction) {
  const message = interaction.options.getString('message', true);
  const channelId = db.getAnnounceChannel(interaction.guildId);
  const channel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : interaction.channel;
  const target = channel || interaction.channel;
  await target.send({ embeds: [new EmbedBuilder().setColor(ACCENT).setTitle('📣 Annonce').setDescription(message)] });
  return interaction.reply({ content: 'Annonce publiée.', ephemeral: true });
}

const handlers = {
  chrono: handleChrono, record: handleRecord, historique: handleHistorique, stats: handleStats,
  lier: handleLier, lobby: handleLobby, ligue: handleLigue,
  'config-annonces': handleConfigAnnonces, annonce: handleAnnonce,
};

async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = Object.values(TRACKS).filter((name) => name.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(choices.map((name) => ({ name, value: name })));
}

async function handleButton(interaction) {
  const [, action, lobbyIdRaw] = interaction.customId.split(':');
  const lobbyId = Number(lobbyIdRaw);
  const lobby = db.getLobby(lobbyId);
  if (!lobby) return interaction.reply({ content: 'Ce lobby n\'existe plus.', ephemeral: true });
  if (lobby.status === 'closed') return interaction.reply({ content: 'Ce lobby est fermé.', ephemeral: true });

  if (action === 'join') db.joinLobby(lobbyId, interaction.user.id, interaction.user.username);
  if (action === 'leave') db.leaveLobby(lobbyId, interaction.user.id);
  if (action === 'close') {
    if (interaction.user.id !== lobby.host_discord_id) return interaction.reply({ content: 'Seul l\'hôte peut fermer ce lobby.', ephemeral: true });
    db.closeLobby(lobbyId);
  }
  const updated = db.getLobby(lobbyId);
  await interaction.update({ embeds: [lobbyEmbed(updated)], components: [lobbyRow(lobbyId, updated.status === 'closed')] });
}

module.exports = { commandBuilders, handlers, handleAutocomplete, handleButton };
