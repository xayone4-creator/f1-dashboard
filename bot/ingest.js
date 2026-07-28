'use strict';

// Point d'entrée HTTP minimal pour recevoir les tours chronométrés depuis le
// dashboard (qui tourne sur le PC du joueur), quand le bot lui-même est
// hébergé ailleurs (Railway, etc.) et ne partage donc plus le même fichier
// SQLite local. Volontairement sans dépendance externe (juste `http`, déjà
// fourni par Node) pour ne pas alourdir bot/package.json.
//
// Sécurité minimale : un secret partagé (INGEST_SECRET) à renseigner à
// l'identique côté bot (bot/.env) et côté dashboard (.env à la racine). Sans
// ce secret configuré des deux côtés, le point d'entrée refuse toute requête.

const http = require('http');
const db = require('./server/db');

function startIngestServer() {
  const secret = process.env.INGEST_SECRET;
  const port = process.env.PORT || process.env.INGEST_PORT || 8080;

  if (!secret) {
    console.warn('[ingest] INGEST_SECRET non défini dans bot/.env : le point d\'entrée /ingest/lap refusera toutes les requêtes.');
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/ingest/lap') {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    if (!secret || req.headers['x-ingest-secret'] !== secret) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) { tooLarge = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooLarge) return;
      let payload;
      try { payload = JSON.parse(body); } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'invalid_json' }));
        return;
      }
      const { driverName, trackId, trackName, sessionType, lapTimeMs, sector1Ms, sector2Ms, sector3Ms } = payload || {};
      if (!driverName || !Number.isFinite(lapTimeMs) || lapTimeMs <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'invalid_payload' }));
        return;
      }
      const result = db.recordLap({ driverName, trackId, trackName, sessionType, lapTimeMs, sector1Ms, sector2Ms, sector3Ms });
      // Même mécanisme que le dashboard en local : un nouveau record dépose
      // une annonce dans pending_announcements, que bot/announcer.js publie
      // ensuite dans les salons configurés via /config-annonces.
      if (result?.isNewRecord) {
        db.queueAnnouncement('new_record', { driverName, trackName, lapTimeMs, previousBest: result.previousBest, at: Date.now() });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true, isNewRecord: Boolean(result?.isNewRecord) }));
    });
  });

  server.listen(port, () => console.log(`[ingest] à l'écoute sur le port ${port} (POST /ingest/lap)`));
  return server;
}

module.exports = { startIngestServer };
