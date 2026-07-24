'use strict';

const TRACKS = {
  0: 'Melbourne', 2: 'Shanghai', 3: 'Sakhir (Bahreïn)', 4: 'Catalunya',
  5: 'Monaco', 6: 'Montréal', 7: 'Silverstone', 9: 'Hungaroring',
  10: 'Spa', 11: 'Monza', 12: 'Singapour', 13: 'Suzuka', 14: 'Abu Dhabi',
  15: 'Austin', 16: 'Brésil', 17: 'Autriche', 19: 'Mexique',
  20: 'Bakou', 26: 'Zandvoort', 27: 'Imola', 29: 'Jeddah', 30: 'Miami',
  31: 'Las Vegas', 32: 'Losail', 39: 'Silverstone (inversé)',
  40: 'Autriche (inversé)', 41: 'Zandvoort (inversé)',
};

const TEAMS = {
  0: 'Mercedes', 1: 'Ferrari', 2: 'Red Bull Racing', 3: 'Williams',
  4: 'Aston Martin', 5: 'Alpine', 6: 'RB', 7: 'Haas', 8: 'McLaren', 9: 'Sauber',
};

const TEAM_COLORS = {
  0: '#27F4D2', 1: '#E8002D', 2: '#3671C6', 3: '#64C4FF', 4: '#229971',
  5: '#FF87BC', 6: '#6692FF', 7: '#B6BABD', 8: '#FF8000', 9: '#52E252',
};

// Nombre d'échantillons max conservés par tour (~ 1 échantillon / frame émis par le jeu)
const MAX_SAMPLES_PER_LAP = 4000;

function createState() {
  return {
    session: null,
    participants: [],
    playerCarIndex: 0,
    cars: {}, // index -> { pos, telemetry, lap }
    // Historique des tours complets, uniquement pour la voiture du joueur (index playerCarIndex)
    // { [lapNumber]: { lapTimeMs, samples: [{distance, speed, throttle, brake}] } }
    lapHistory: {},
    currentLapSamples: [],
    currentLapTrail: [], // {x,z} du tour en cours, pour alimenter le cache de tracé de circuit
    currentLapNumber: null,
    lastUpdate: 0,
  };
}

function teamName(id) { return TEAMS[id] || `Équipe ${id}`; }
function teamColor(id) { return TEAM_COLORS[id] || '#8892a0'; }
function trackName(id) { return TRACKS[id] !== undefined ? TRACKS[id] : `Circuit #${id}`; }
function trackIdByName(name) {
  const target = String(name || '').trim().toLowerCase();
  const found = Object.entries(TRACKS).find(([, value]) => value.toLowerCase() === target);
  return found ? Number(found[0]) : null;
}

module.exports = {
  createState, teamName, teamColor, trackName, trackIdByName, TRACKS, MAX_SAMPLES_PER_LAP,
};
