'use strict';

// Reçoit les tours poussés par le dashboard local (voir server/index.js,
// fonction pushLapToBot) et les enregistre dans la base du bot, pour que
// /chrono, /record, /historique et /stats aient des données même si le bot
// tourne à distance (Railway) sans accès au disque du PC qui fait tourner
// le dashboard.

const express = require('express');
const db = require('./db');

function startIngestServer({ port, secret }) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/laps', (req, res) => {
    if (!secret) return res.status(500).json({ error: 'INGEST_SECRET non configuré côté bot' });
    if (req.get('x-ingest-secret') !== secret) return res.status(401).json({ error: 'unauthorized' });

    const { driverName, trackId, trackName, sessionType, lapTimeMs, sector1Ms, sector2Ms, sector3Ms } = req.body || {};
    if (!driverName || !Number.isFinite(lapTimeMs) || lapTimeMs <= 0) {
      return res.status(400).json({ error: 'payload invalide' });
    }

    const saved = db.recordLap({
      driverName,
      trackId: trackId ?? null,
      trackName: trackName || null,
      sessionType: sessionType || null,
      lapTimeMs,
      sector1Ms: sector1Ms ?? null,
      sector2Ms: sector2Ms ?? null,
      sector3Ms: sector3Ms ?? null,
    });
    // C'est ici, et pas côté dashboard local, qu'il faut déposer l'annonce :
    // announcer.js (bot/announcer.js) la lit dans CETTE base (celle du bot
    // sur Railway), pas dans celle du dashboard local.
    if (saved?.isNewRecord) {
      db.queueAnnouncement('new_record', {
        driverName, trackName: trackName || null, lapTimeMs, previousBest: saved.previousBest, at: Date.now(),
      });
    }
    return res.json({ ok: true, saved });
  });

  app.listen(port, () => {
    console.log(`[bot] serveur de réception des tours en écoute sur le port ${port}`);
  });
}

module.exports = { startIngestServer };
