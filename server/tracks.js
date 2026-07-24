'use strict';

// Cache disque des tracés de circuits. Le jeu ne fournit pas de tracé
// statique : la première fois que tu boucles un tour propre sur un circuit,
// on enregistre ta trajectoire (x,z) comme référence, et elle est réutilisée
// dès le début de la session suivante (plus besoin d'attendre un tour pour
// voir la forme du circuit). On garde toujours la trajectoire la plus
// complète rencontrée.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'track-cache');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Circuits favoris : on les affiche comme "suivis" dans l'UI dès maintenant,
// leur tracé se remplit tout seul dès que tu y roules. Ajoute d'autres ID de
// circuit ici au fur et à mesure (voir la liste TRACKS dans state.js).
const PRIORITY_TRACKS = {
  5: 'Monaco',
  10: 'Spa',
  9: 'Hungaroring',
};

const cache = {}; // trackId -> { points: [{x,z}], savedAt, pointCount }

function filePath(trackId) {
  return path.join(DATA_DIR, `${trackId}.json`);
}

function loadAll() {
  const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [];
  files.forEach((f) => {
    if (!f.endsWith('.json')) return;
    const trackId = parseInt(f.replace('.json', ''), 10);
    try {
      cache[trackId] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
    } catch (e) {
      // fichier corrompu, on l'ignore
    }
  });
}

function getOutline(trackId) {
  return cache[trackId] || null;
}

function isPriority(trackId) {
  return Object.prototype.hasOwnProperty.call(PRIORITY_TRACKS, trackId);
}

function listStatus() {
  return Object.entries(PRIORITY_TRACKS).map(([id, name]) => ({
    trackId: Number(id),
    name,
    cached: Boolean(cache[id]),
  }));
}

// Ne garde que la trajectoire la plus complète (un tour interrompu par un
// tête-à-queue donne moins de points qu'un tour propre entier).
function saveOutlineIfBetter(trackId, points) {
  if (trackId === undefined || trackId === null) return false;
  if (!points || points.length < 20) return false;
  const existing = cache[trackId];
  if (existing && existing.pointCount >= points.length) return false;
  const entry = { points, savedAt: Date.now(), pointCount: points.length };
  cache[trackId] = entry;
  try {
    fs.writeFileSync(filePath(trackId), JSON.stringify(entry));
  } catch (e) {
    console.error('[tracks] échec de sauvegarde du circuit', trackId, e.message);
  }
  return true;
}

loadAll();

module.exports = { getOutline, saveOutlineIfBetter, isPriority, listStatus, PRIORITY_TRACKS };
