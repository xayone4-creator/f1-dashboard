'use strict';

const dgram = require('dgram');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { parsePacket } = require('./f1Parser');
const { createState, teamName, teamColor, trackName, MAX_SAMPLES_PER_LAP } = require('./state');
const tracks = require('./tracks');
const db = require('./db');

const UDP_PORT = parseInt(process.env.F1_UDP_PORT || '20777', 10);
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const BROADCAST_HZ = 20; // fréquence d'envoi au navigateur (le jeu peut envoyer jusqu'à 60Hz)

const state = createState();
let lastSentSampleIndex = 0; // pointeur : combien d'échantillons du tour en cours ont déjà été envoyés

// ---------------------------------------------------------------------------
// UDP : réception de la télémétrie envoyée par F1 25
// ---------------------------------------------------------------------------
const udpSocket = dgram.createSocket('udp4');

udpSocket.on('error', (err) => {
  console.error('[UDP] erreur socket:', err.message);
});

udpSocket.on('message', (msg) => {
  let packet;
  try {
    packet = parsePacket(msg);
  } catch (e) {
    return; // paquet malformé / tronqué, on ignore
  }
  if (!packet) return;
  state.lastUpdate = Date.now();

  const header = packet.data.header;
  if (header && typeof header.playerCarIndex === 'number') {
    state.playerCarIndex = header.playerCarIndex;
  }

  switch (packet.type) {
    case 'session': {
      const d = packet.data;
      const trackChanged = !state.session || state.session.trackId !== d.trackId;
      state.session = {
        trackId: d.trackId,
        trackName: trackName(d.trackId),
        trackLength: d.trackLength,
        totalLaps: d.totalLaps,
        sessionType: d.sessionType,
        sessionTimeLeft: d.sessionTimeLeft,
        airTemperature: d.airTemperature,
        trackTemperature: d.trackTemperature,
        weather: d.weather,
      };
      if (trackChanged) {
        const outline = tracks.getOutline(d.trackId);
        broadcast({
          type: 'trackOutline',
          trackId: d.trackId,
          points: outline ? outline.points : null,
        });
      }
      break;
    }
    case 'participants': {
      state.participants = packet.data.cars.map((c) => ({
        name: c.name || '',
        teamId: c.teamId,
        team: teamName(c.teamId),
        color: teamColor(c.teamId),
        raceNumber: c.raceNumber,
      }));
      break;
    }
    case 'motion': {
      packet.data.cars.forEach((c, idx) => {
        if (!state.cars[idx]) state.cars[idx] = {};
        state.cars[idx].pos = { x: c.x, z: c.z, yaw: c.yaw };
        if (idx === state.playerCarIndex) {
          const trail = state.currentLapTrail;
          const last = trail[trail.length - 1];
          if (!last || Math.abs(last.x - c.x) > 0.5 || Math.abs(last.z - c.z) > 0.5) {
            trail.push({ x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10 });
          }
        }
      });
      break;
    }
    case 'carTelemetry': {
      packet.data.cars.forEach((c, idx) => {
        if (!state.cars[idx]) state.cars[idx] = {};
        state.cars[idx].telemetry = c;
      });
      // Buffer d'échantillons du tour en cours, pour le joueur uniquement
      const playerIdx = state.playerCarIndex;
      const playerTelemetry = packet.data.cars[playerIdx];
      const playerLap = state.cars[playerIdx] && state.cars[playerIdx].lap;
      if (playerTelemetry && playerLap) {
        pushSample(playerLap.lapDistance, playerTelemetry, playerLap.currentLapTimeInMS);
      }
      break;
    }
    case 'carStatus': {
      packet.data.cars.forEach((c, idx) => {
        if (!state.cars[idx]) state.cars[idx] = {};
        state.cars[idx].status = c;
      });
      break;
    }
    case 'carDamage': {
      packet.data.cars.forEach((c, idx) => {
        if (!state.cars[idx]) state.cars[idx] = {};
        state.cars[idx].damage = c;
      });
      break;
    }
    case 'lapData': {
      packet.data.cars.forEach((c, idx) => {
        if (!state.cars[idx]) state.cars[idx] = {};
        const previousLap = state.cars[idx].lap || null;
        const prevLapNum = previousLap ? previousLap.currentLapNum : null;
        state.cars[idx].lap = c;

        if (idx === state.playerCarIndex) {
          if (state.currentLapNumber === null) state.currentLapNumber = c.currentLapNum;
          if (prevLapNum !== null && c.currentLapNum !== prevLapNum) {
            archiveLap(prevLapNum, c.lastLapTimeInMS, previousLap);
            state.currentLapNumber = c.currentLapNum;
          }
        }
      });
      break;
    }
    default:
      break;
  }
});

function pushSample(distance, telemetry, lapTimeMs) {
  if (distance === undefined || distance < 0) return;
  const samples = state.currentLapSamples;
  const last = samples[samples.length - 1];
  if (last && Math.abs(last.distance - distance) < 0.5) return; // évite le sur-échantillonnage
  samples.push({
    distance: Math.round(distance * 10) / 10,
    speed: telemetry.speed,
    throttle: Math.round(telemetry.throttle * 100),
    brake: Math.round(telemetry.brake * 100),
    gear: telemetry.gear,
    lapTimeMs,
  });
  if (samples.length > MAX_SAMPLES_PER_LAP) samples.shift();
}

function notifyNewRecord({ driverName, trackName: track, lapTimeMs, previousBest }) {
  db.queueAnnouncement('new_record', { driverName, trackName: track, lapTimeMs, previousBest, at: Date.now() });
  broadcast({
    type: 'newRecord',
    driverName,
    trackName: track || null,
    lapTimeMs,
    previousBest: previousBest ?? null,
    gainMs: previousBest != null ? previousBest - lapTimeMs : null,
  });
}

function archiveLap(lapNumber, lapTimeMs, previousLap) {
  const trail = state.currentLapTrail;
  state.currentLapTrail = [];
  lastSentSampleIndex = 0;
  if (!lapNumber || !lapTimeMs || lapTimeMs <= 0 || state.currentLapSamples.length < 5 || previousLap?.currentLapInvalid) {
    state.currentLapSamples = [];
    return;
  }
  const sector1 = previousLap?.sector1TimeInMS || 0;
  const sector2 = previousLap?.sector2TimeInMS || 0;
  const sector3 = sector1 && sector2 && lapTimeMs > sector1 + sector2 ? lapTimeMs - sector1 - sector2 : 0;
  state.lapHistory[lapNumber] = {
    lapNumber,
    lapTimeMs,
    sector1TimeInMS: sector1 || null,
    sector2TimeInMS: sector2 || null,
    sector3TimeInMS: sector3 || null,
    samples: state.currentLapSamples,
  };
  state.currentLapSamples = [];
  broadcastLapList();

  // Persistance partagée avec le bot Discord : chaque tour valide est
  // enregistré en base pour alimenter /chrono, /record, /historique, etc.
  // Se dégrade en silence si better-sqlite3 n'est pas installé (voir server/db.js).
  const driverName = (state.participants && state.participants[state.playerCarIndex]?.name) || 'Pilote';
  const saved = db.recordLap({
    driverName,
    trackId: state.session?.trackId ?? null,
    trackName: state.session?.trackName || null,
    sessionType: state.session?.sessionType ?? null,
    lapTimeMs, sector1Ms: sector1 || null, sector2Ms: sector2 || null, sector3Ms: sector3 || null,
  });
  if (saved?.isNewRecord) notifyNewRecord({ driverName, trackName: state.session?.trackName, lapTimeMs, previousBest: saved.previousBest });

  const trackId = state.session && state.session.trackId;
  if (trackId !== undefined && tracks.saveOutlineIfBetter(trackId, trail)) {
    broadcast({ type: 'trackOutline', trackId, points: trail });
  }
}

udpSocket.bind(UDP_PORT, () => {
  console.log(`[UDP] à l'écoute des paquets F1 25 sur le port ${UDP_PORT}`);
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket
// ---------------------------------------------------------------------------
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = app.listen(HTTP_PORT, () => {
  console.log(`[HTTP] dashboard disponible sur http://localhost:${HTTP_PORT}`);
  console.log(`[HTTP] overlay OBS disponible sur http://localhost:${HTTP_PORT}/overlay.html`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

function buildLiveSnapshot() {
  const cars = Object.entries(state.cars).map(([idx, c]) => {
    const i = parseInt(idx, 10);
    const p = (state.participants && state.participants[i]) || {};
    return {
      index: i,
      name: p.name || `Voiture ${i + 1}`,
      team: p.team || null,
      color: p.color || '#8892a0',
      pos: c.pos || null,
      speed: c.telemetry ? c.telemetry.speed : null,
      throttle: c.telemetry ? c.telemetry.throttle : null,
      brake: c.telemetry ? c.telemetry.brake : null,
      gear: c.telemetry ? c.telemetry.gear : null,
      drs: c.telemetry ? c.telemetry.drs : null,
      telemetry: c.telemetry ? {
        speed: c.telemetry.speed,
        throttle: c.telemetry.throttle,
        brake: c.telemetry.brake,
        steer: c.telemetry.steer,
        gear: c.telemetry.gear,
        rpm: c.telemetry.engineRPM,
        drs: c.telemetry.drs,
        brakesTemperature: c.telemetry.brakesTemperature,
        tyreSurfaceTemperature: c.telemetry.tyresSurfaceTemperature,
      } : null,
      status: c.status ? {
        fuelInTank: c.status.fuelInTank,
        fuelRemainingLaps: c.status.fuelRemainingLaps,
        tyresAgeLaps: c.status.tyresAgeLaps,
        compound: tyreCompoundName(c.status.visualTyreCompound),
        ersPercent: Math.max(0, Math.min(100, (c.status.ersStoreEnergy / 4000000) * 100)),
        tyreWear: c.damage && c.damage.tyresWear
          ? c.damage.tyresWear.reduce((sum, wear) => sum + wear, 0) / c.damage.tyresWear.length
          : 0,
        tyreWearByCorner: c.damage ? c.damage.tyresWear : null,
        fiaFlag: c.status.vehicleFiaFlags,
      } : null,
      lap: c.lap
        ? {
            position: c.lap.carPosition,
            currentLapNum: c.lap.currentLapNum,
            currentLapTimeInMS: c.lap.currentLapTimeInMS,
            lastLapTimeInMS: c.lap.lastLapTimeInMS,
            deltaToCarInFrontMS: c.lap.deltaToCarInFrontMS,
            deltaToRaceLeaderMS: c.lap.deltaToRaceLeaderMS,
            sector: c.lap.sector,
            sector1TimeInMS: c.lap.sector1TimeInMS,
            sector2TimeInMS: c.lap.sector2TimeInMS,
            pitStatus: c.lap.pitStatus,
            resultStatus: c.lap.resultStatus,
            currentLapInvalid: c.lap.currentLapInvalid,
            penalties: c.lap.penalties,
          }
        : null,
    };
  });
  return {
    type: 'live',
    connected: Date.now() - state.lastUpdate < 3000,
    session: state.session ? { ...state.session, isPriority: tracks.isPriority(state.session.trackId) } : null,
    playerCarIndex: state.playerCarIndex,
    ghostCarIndex: findGhostIndex(),
    // Delta pilot vs référence personnelle. Unlike the race gap, this is
    // meaningful in Time Trial / Qualifying and can drive a ghost overlay.
    playerDeltaToBestMs: calculatePlayerDeltaToBest(),
    playerDeltaToGhostMs: calculatePlayerDeltaToGhost(),
    referenceSectors: bestLocalLapSectors(),
    cars,
  };
}

function findGhostIndex() {
  return state.participants.findIndex((participant) => {
    const name = String(participant.name || '').toLowerCase();
    return name.includes('personal best') || name.includes('ghost') || name.includes('meilleur personnel');
  });
}

function bestLocalLapSectors() {
  const validLaps = Object.values(state.lapHistory).filter((lap) => lap.sector1TimeInMS && lap.sector2TimeInMS && lap.sector3TimeInMS);
  if (!validLaps.length) return null;
  const reference = validLaps.reduce((best, lap) => lap.lapTimeMs < best.lapTimeMs ? lap : best);
  return { sector1: reference.sector1TimeInMS, sector2: reference.sector2TimeInMS, sector3: reference.sector3TimeInMS, lapNumber: reference.lapNumber };
}

function calculatePlayerDeltaToGhost() {
  const player = state.cars[state.playerCarIndex];
  const playerLap = player && player.lap;
  if (!playerLap || !Number.isFinite(playerLap.currentLapTimeInMS)) return null;

  // In Time Trial, F1 exposes the reference cars through Participants with
  // names such as “Personal Best” and “Default Ghost”. Their current lap time
  // lets us provide a live, game-sourced delta before a local lap is archived.
  const ghostIndex = findGhostIndex();
  if (ghostIndex < 0) return null;
  const ghostLap = state.cars[ghostIndex] && state.cars[ghostIndex].lap;
  if (!ghostLap || !Number.isFinite(ghostLap.currentLapTimeInMS)) return null;
  if (playerLap.currentLapNum !== ghostLap.currentLapNum) return null;
  return Math.round(playerLap.currentLapTimeInMS - ghostLap.currentLapTimeInMS);
}

function calculatePlayerDeltaToBest() {
  const player = state.cars[state.playerCarIndex];
  const current = player && player.lap;
  if (!current || !Number.isFinite(current.lapDistance) || !Number.isFinite(current.currentLapTimeInMS)) return null;

  const validLaps = Object.values(state.lapHistory).filter((lap) => lap.samples && lap.samples.length > 3 && lap.lapTimeMs > 0);
  if (!validLaps.length) return null;
  const reference = validLaps.reduce((best, lap) => lap.lapTimeMs < best.lapTimeMs ? lap : best);
  const samples = reference.samples;
  const distance = current.lapDistance;
  if (distance < samples[0].distance || distance > samples[samples.length - 1].distance) return null;

  let index = 0;
  while (index < samples.length - 1 && samples[index + 1].distance < distance) index += 1;
  const before = samples[index];
  const after = samples[index + 1] || before;
  const ratio = after.distance > before.distance ? (distance - before.distance) / (after.distance - before.distance) : 0;
  const referenceTime = before.lapTimeMs + (after.lapTimeMs - before.lapTimeMs) * ratio;
  return Math.round(current.currentLapTimeInMS - referenceTime);
}

function tyreCompoundName(compound) {
  // visualTyreCompound values used by the F1 UDP specification
  const compounds = { 16: 'SOFT', 17: 'MEDIUM', 18: 'HARD', 7: 'INTER', 8: 'WET' };
  return compounds[compound] || '—';
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

function broadcastLapList() {
  const laps = Object.values(state.lapHistory)
    .map((l) => ({
      lapNumber: l.lapNumber,
      lapTimeMs: l.lapTimeMs,
      samples: l.samples.length,
      sector1TimeInMS: l.sector1TimeInMS || null,
      sector2TimeInMS: l.sector2TimeInMS || null,
      sector3TimeInMS: l.sector3TimeInMS || null,
    }))
    .sort((a, b) => a.lapNumber - b.lapNumber);
  broadcast({ type: 'lapList', laps });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', udpPort: UDP_PORT }));
  ws.send(JSON.stringify({ type: 'trackStatus', tracks: tracks.listStatus() }));
  broadcastLapList();

  if (state.session && state.session.trackId !== undefined) {
    const outline = tracks.getOutline(state.session.trackId);
    ws.send(JSON.stringify({
      type: 'trackOutline',
      trackId: state.session.trackId,
      points: outline ? outline.points : null,
    }));
  }

  if (state.currentLapSamples.length) {
    ws.send(JSON.stringify({
      type: 'liveTelemetry',
      lapNumber: state.currentLapNumber,
      newPoints: state.currentLapSamples,
    }));
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'getLapList') {
      broadcastLapList();
    }

    if (msg.type === 'getLap' && msg.lapNumber !== undefined) {
      const lap = state.lapHistory[msg.lapNumber];
      ws.send(JSON.stringify({
        type: 'lapData',
        lapNumber: msg.lapNumber,
        lap: lap ? { lapTimeMs: lap.lapTimeMs, sector1TimeInMS: lap.sector1TimeInMS || null, sector2TimeInMS: lap.sector2TimeInMS || null, sector3TimeInMS: lap.sector3TimeInMS || null, samples: lap.samples } : null,
      }));
    }
  });
});

setInterval(() => {
  broadcast(buildLiveSnapshot());

  // Télémétrie en direct (vitesse/accélérateur/frein) : on n'envoie que les
  // points nouveaux depuis le dernier tick pour ne pas ré-envoyer tout le
  // tour à chaque fois.
  const samples = state.currentLapSamples;
  if (samples.length > lastSentSampleIndex) {
    const newPoints = samples.slice(lastSentSampleIndex);
    lastSentSampleIndex = samples.length;
    broadcast({
      type: 'liveTelemetry',
      lapNumber: state.currentLapNumber,
      newPoints,
    });
  }
}, Math.round(1000 / BROADCAST_HZ));
