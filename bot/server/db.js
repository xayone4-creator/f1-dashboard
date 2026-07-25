'use strict';

// Base de données partagée entre le dashboard (server/index.js) et le bot
// Discord (bot/index.js). SQLite via le module natif "node:sqlite" fourni
// par Node.js lui-même (Node ≥ 22.5) : aucune dépendance à installer, donc
// aucune compilation native (pas besoin de Python ni de Visual Studio Build
// Tools côté joueur — c'était le cas avec better-sqlite3 et ça posait
// problème sur les Node récents sans binaire précompilé disponible).
//
// Ce module est volontairement isolé du reste du serveur : le dashboard
// continue de fonctionner exactement comme avant si ce module n'est pas
// disponible (Node trop ancien) — voir le try/catch ci-dessous — pour ne
// jamais casser l'usage existant en mode 100% local/mémoire.

const path = require('path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  // Node < 22.5 : le module n'existe pas encore. On dégrade en silence :
  // le dashboard tourne sans persistance, le bot Discord ne pourra pas
  // démarrer tant que Node n'est pas mis à jour (voir bot/README.md).
}

const DB_PATH = path.join(__dirname, '..', 'data', 'apex.db');

let db = null;

function ensureDb() {
  if (!DatabaseSync) return null;
  if (db) return db;
  const fs = require('fs');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE,
      name TEXT NOT NULL,
      platform TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS laps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_name TEXT NOT NULL,
      track_id INTEGER,
      track_name TEXT,
      session_type TEXT,
      lap_time_ms INTEGER NOT NULL,
      sector1_ms INTEGER,
      sector2_ms INTEGER,
      sector3_ms INTEGER,
      recorded_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_laps_track ON laps(track_id, lap_time_ms);
    CREATE INDEX IF NOT EXISTS idx_laps_driver ON laps(driver_name);
    CREATE TABLE IF NOT EXISTS leagues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      owner_discord_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS league_members (
      league_id INTEGER NOT NULL,
      discord_id TEXT NOT NULL,
      display_name TEXT,
      points INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (league_id, discord_id)
    );
    CREATE TABLE IF NOT EXISTS lobbies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      host_discord_id TEXT NOT NULL,
      track_name TEXT,
      session_type TEXT,
      max_players INTEGER NOT NULL DEFAULT 22,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lobby_players (
      lobby_id INTEGER NOT NULL,
      discord_id TEXT NOT NULL,
      display_name TEXT,
      PRIMARY KEY (lobby_id, discord_id)
    );
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      announce_channel_id TEXT
    );
    CREATE TABLE IF NOT EXISTS pending_announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      announced INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      track_id INTEGER,
      track_name TEXT,
      created_by TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_challenges_guild ON challenges(guild_id, status);
  `);
  // Nettoyage ponctuel : purge les tours à 0/négatifs enregistrés avant le
  // correctif du bug de coupure UDP (ils faussaient les classements en
  // apparaissant comme "meilleur temps").
  db.prepare('DELETE FROM laps WHERE lap_time_ms IS NULL OR lap_time_ms <= 0').run();
  return db;
}

// --- File d'annonces (le dashboard écrit, le bot Discord lit) --------------
// Les deux processus ne communiquent pas directement : le dashboard dépose
// un évènement ici, et le bot le consomme au prochain sondage (voir
// bot/announcer.js). Ça évite tout couplage réseau entre les deux services.

function queueAnnouncement(kind, payload) {
  const database = ensureDb(); if (!database) return;
  database.prepare('INSERT INTO pending_announcements (kind, payload, created_at) VALUES (?, ?, ?)')
    .run(kind, JSON.stringify(payload), Date.now());
}

function consumePendingAnnouncements() {
  const database = ensureDb(); if (!database) return [];
  const rows = database.prepare('SELECT * FROM pending_announcements WHERE announced = 0 ORDER BY id ASC').all();
  if (rows.length) {
    const ids = rows.map((row) => row.id);
    database.prepare(`UPDATE pending_announcements SET announced = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}

// --- Tours / chronos -------------------------------------------------------

function recordLap({ driverName, trackId, trackName, sessionType, lapTimeMs, sector1Ms, sector2Ms, sector3Ms }) {
  const database = ensureDb(); if (!database) return null;
  if (!Number.isFinite(lapTimeMs) || lapTimeMs <= 0) return null; // garde-fou : accroc de télémétrie (voir server/index.js)
  const isFirstOnTrack = trackId != null && !database.prepare('SELECT 1 FROM laps WHERE track_id = ? LIMIT 1').get(trackId);
  const previousBest = trackId != null
    ? database.prepare('SELECT MIN(lap_time_ms) AS best FROM laps WHERE track_id = ?').get(trackId)?.best
    : null;
  const info = database.prepare(`
    INSERT INTO laps (driver_name, track_id, track_name, session_type, lap_time_ms, sector1_ms, sector2_ms, sector3_ms, recorded_at)
    VALUES (@driverName, @trackId, @trackName, @sessionType, @lapTimeMs, @sector1Ms, @sector2Ms, @sector3Ms, @recordedAt)
  `).run({
    driverName, trackId: trackId ?? null, trackName: trackName || null, sessionType: sessionType || null,
    lapTimeMs, sector1Ms: sector1Ms ?? null, sector2Ms: sector2Ms ?? null, sector3Ms: sector3Ms ?? null,
    recordedAt: Date.now(),
  });
  const isNewRecord = !isFirstOnTrack && previousBest != null && lapTimeMs < previousBest;
  return { id: info.lastInsertRowid, isNewRecord, previousBest: previousBest ?? null };
}

function bestLaps({ trackId = null, limit = 10 } = {}) {
  const database = ensureDb(); if (!database) return [];
  const query = trackId != null
    ? `SELECT driver_name, track_id, track_name, MIN(lap_time_ms) AS lap_time_ms
         FROM laps WHERE track_id = ? GROUP BY driver_name ORDER BY lap_time_ms ASC LIMIT ?`
    : `SELECT driver_name, track_id, track_name, MIN(lap_time_ms) AS lap_time_ms
         FROM laps GROUP BY driver_name, track_id ORDER BY lap_time_ms ASC LIMIT ?`;
  return trackId != null ? database.prepare(query).all(trackId, limit) : database.prepare(query).all(limit);
}

function recordForTrack(trackId) {
  const database = ensureDb(); if (!database) return null;
  return database.prepare(`
    SELECT driver_name, lap_time_ms, sector1_ms, sector2_ms, sector3_ms, recorded_at
    FROM laps WHERE track_id = ? ORDER BY lap_time_ms ASC LIMIT 1
  `).get(trackId) || null;
}

function driverHistory(driverName, limit = 20) {
  const database = ensureDb(); if (!database) return [];
  return database.prepare(`
    SELECT * FROM laps WHERE driver_name = ? ORDER BY recorded_at DESC LIMIT ?
  `).all(driverName, limit);
}

function driverStats(driverName) {
  const database = ensureDb(); if (!database) return null;
  const totals = database.prepare(`
    SELECT COUNT(*) AS totalLaps, MIN(lap_time_ms) AS bestOverall, COUNT(DISTINCT track_id) AS tracksDriven
    FROM laps WHERE driver_name = ?
  `).get(driverName);
  const perTrack = database.prepare(`
    SELECT track_id, track_name, MIN(lap_time_ms) AS best FROM laps WHERE driver_name = ? GROUP BY track_id
  `).all(driverName);
  return { ...totals, perTrack };
}

// --- Carte pilote (façon "carte de visite") --------------------------------
// Condensé des stats d'un pilote pour un affichage type carte : meilleur
// tour, circuit favori (le plus roulé), nombre de records détenus (tours où
// il est actuellement en tête du classement d'un circuit), et dernier tour
// enregistré.

function driverCard(driverName) {
  const database = ensureDb(); if (!database) return null;
  const totals = database.prepare(`
    SELECT COUNT(*) AS totalLaps, MIN(lap_time_ms) AS bestOverall, COUNT(DISTINCT track_id) AS tracksDriven
    FROM laps WHERE driver_name = ?
  `).get(driverName);
  if (!totals || !totals.totalLaps) return null;
  const favorite = database.prepare(`
    SELECT track_id, track_name, COUNT(*) AS laps FROM laps WHERE driver_name = ? GROUP BY track_id ORDER BY laps DESC LIMIT 1
  `).get(driverName);
  const recordsHeld = database.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT track_id, MIN(lap_time_ms) AS best FROM laps GROUP BY track_id
    ) bests
    JOIN laps l ON l.track_id = bests.track_id AND l.lap_time_ms = bests.best AND l.driver_name = ?
  `).get(driverName);
  const lastLap = database.prepare(`
    SELECT lap_time_ms, track_id, track_name, recorded_at FROM laps WHERE driver_name = ? ORDER BY recorded_at DESC LIMIT 1
  `).get(driverName);
  return { ...totals, favorite: favorite || null, recordsHeld: recordsHeld?.n || 0, lastLap: lastLap || null };
}

// --- Défi de la semaine ----------------------------------------------------
// Un seul défi actif par serveur : lancer un nouveau défi ferme
// automatiquement le précédent. Le classement n'est jamais stocké : il est
// recalculé à la volée depuis les tours déjà enregistrés dans `laps` (mêmes
// tours que ceux utilisés par /chrono et /record), filtrés sur la fenêtre de
// temps et le circuit du défi — donc toujours à jour tout seul.

function createChallenge({ guildId, trackId, trackName, createdBy, durationDays }) {
  const database = ensureDb(); if (!database) return null;
  const now = Date.now();
  const endsAt = now + Math.max(1, durationDays || 7) * 24 * 60 * 60 * 1000;
  database.prepare("UPDATE challenges SET status = 'closed' WHERE guild_id = ? AND status = 'open'").run(guildId);
  const info = database.prepare(`
    INSERT INTO challenges (guild_id, track_id, track_name, created_by, starts_at, ends_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(guildId, trackId ?? null, trackName || null, createdBy, now, endsAt, now);
  return info.lastInsertRowid;
}

function getActiveChallenge(guildId) {
  const database = ensureDb(); if (!database) return null;
  const row = database.prepare(`
    SELECT * FROM challenges WHERE guild_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1
  `).get(guildId);
  if (!row) return null;
  if (row.ends_at < Date.now()) {
    database.prepare("UPDATE challenges SET status = 'closed' WHERE id = ?").run(row.id);
    return null;
  }
  return row;
}

function challengeLeaderboard(challengeId, limit = 10) {
  const database = ensureDb(); if (!database) return [];
  const challenge = database.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
  if (!challenge) return [];
  return database.prepare(`
    SELECT driver_name, MIN(lap_time_ms) AS lap_time_ms
    FROM laps
    WHERE track_id = ? AND recorded_at BETWEEN ? AND ?
    GROUP BY driver_name
    ORDER BY lap_time_ms ASC
    LIMIT ?
  `).all(challenge.track_id, challenge.starts_at, challenge.ends_at, limit);
}

function closeChallenge(challengeId) {
  const database = ensureDb(); if (!database) return;
  database.prepare("UPDATE challenges SET status = 'closed' WHERE id = ?").run(challengeId);
}

// --- Ligues ------------------------------------------------------------

function createLeague(name, guildId, ownerDiscordId) {
  const database = ensureDb(); if (!database) return null;
  const info = database.prepare('INSERT INTO leagues (name, guild_id, owner_discord_id, created_at) VALUES (?, ?, ?, ?)')
    .run(name, guildId, ownerDiscordId, Date.now());
  database.prepare('INSERT OR IGNORE INTO league_members (league_id, discord_id, points) VALUES (?, ?, 0)')
    .run(info.lastInsertRowid, ownerDiscordId);
  return info.lastInsertRowid;
}

function joinLeague(leagueId, discordId, displayName) {
  const database = ensureDb(); if (!database) return false;
  database.prepare('INSERT OR IGNORE INTO league_members (league_id, discord_id, display_name, points) VALUES (?, ?, ?, 0)')
    .run(leagueId, discordId, displayName || null);
  return true;
}

function leagueStandings(leagueId) {
  const database = ensureDb(); if (!database) return [];
  return database.prepare('SELECT * FROM league_members WHERE league_id = ? ORDER BY points DESC').all(leagueId);
}

function findLeagueByName(name, guildId) {
  const database = ensureDb(); if (!database) return null;
  return database.prepare('SELECT * FROM leagues WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(guildId, name);
}

function listLeagues(guildId) {
  const database = ensureDb(); if (!database) return [];
  return database.prepare('SELECT * FROM leagues WHERE guild_id = ?').all(guildId);
}

// --- Lobbies -------------------------------------------------------------

function createLobby({ guildId, channelId, hostDiscordId, trackName, sessionType, maxPlayers }) {
  const database = ensureDb(); if (!database) return null;
  const info = database.prepare(`
    INSERT INTO lobbies (guild_id, channel_id, host_discord_id, track_name, session_type, max_players, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, channelId, hostDiscordId, trackName || null, sessionType || null, maxPlayers || 22, Date.now());
  const lobbyId = info.lastInsertRowid;
  joinLobby(lobbyId, hostDiscordId, null);
  return lobbyId;
}

function setLobbyMessage(lobbyId, messageId) {
  const database = ensureDb(); if (!database) return;
  database.prepare('UPDATE lobbies SET message_id = ? WHERE id = ?').run(messageId, lobbyId);
}

function joinLobby(lobbyId, discordId, displayName) {
  const database = ensureDb(); if (!database) return false;
  database.prepare('INSERT OR IGNORE INTO lobby_players (lobby_id, discord_id, display_name) VALUES (?, ?, ?)')
    .run(lobbyId, discordId, displayName || null);
  return true;
}

function leaveLobby(lobbyId, discordId) {
  const database = ensureDb(); if (!database) return;
  database.prepare('DELETE FROM lobby_players WHERE lobby_id = ? AND discord_id = ?').run(lobbyId, discordId);
}

function getLobby(lobbyId) {
  const database = ensureDb(); if (!database) return null;
  const lobby = database.prepare('SELECT * FROM lobbies WHERE id = ?').get(lobbyId);
  if (!lobby) return null;
  const players = database.prepare('SELECT * FROM lobby_players WHERE lobby_id = ?').all(lobbyId);
  return { ...lobby, players };
}

function closeLobby(lobbyId) {
  const database = ensureDb(); if (!database) return;
  database.prepare("UPDATE lobbies SET status = 'closed' WHERE id = ?").run(lobbyId);
}

// --- Configuration par serveur Discord ------------------------------------

function setAnnounceChannel(guildId, channelId) {
  const database = ensureDb(); if (!database) return;
  database.prepare('INSERT INTO guild_config (guild_id, announce_channel_id) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET announce_channel_id = excluded.announce_channel_id')
    .run(guildId, channelId);
}

function getAnnounceChannel(guildId) {
  const database = ensureDb(); if (!database) return null;
  return database.prepare('SELECT announce_channel_id FROM guild_config WHERE guild_id = ?').get(guildId)?.announce_channel_id || null;
}

function listAnnounceChannels() {
  const database = ensureDb(); if (!database) return [];
  return database.prepare('SELECT guild_id, announce_channel_id FROM guild_config WHERE announce_channel_id IS NOT NULL').all();
}

function isAvailable() { return Boolean(DatabaseSync); }

// --- Liaison pilote Discord ↔ nom pilote -----------------------------------

function linkDriver(discordId, name) {
  const database = ensureDb(); if (!database) return;
  database.prepare(`
    INSERT INTO drivers (discord_id, name, created_at) VALUES (?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET name = excluded.name
  `).run(discordId, name, Date.now());
}

function linkedDriver(discordId) {
  const database = ensureDb(); if (!database) return null;
  return database.prepare('SELECT name FROM drivers WHERE discord_id = ?').get(discordId)?.name || null;
}

function listOpenLobbies(guildId) {
  const database = ensureDb(); if (!database) return [];
  return database.prepare("SELECT * FROM lobbies WHERE guild_id = ? AND status = 'open' ORDER BY created_at DESC").all(guildId);
}

module.exports = {
  isAvailable, recordLap, bestLaps, recordForTrack, driverHistory, driverStats, driverCard,
  createLeague, joinLeague, leagueStandings, findLeagueByName, listLeagues,
  createLobby, setLobbyMessage, joinLobby, leaveLobby, getLobby, closeLobby,
  setAnnounceChannel, getAnnounceChannel, listAnnounceChannels, queueAnnouncement, consumePendingAnnouncements,
  linkDriver, linkedDriver, listOpenLobbies,
  createChallenge, getActiveChallenge, challengeLeaderboard, closeChallenge,
};
