'use strict';

/**
 * Parseur binaire pour le format UDP "2025" du jeu F1 25 (EA/Codemasters).
 * Référence: spécification officielle EA Forums "EA SPORTS F1 25 UDP SPECIFICATION".
 * Toutes les valeurs sont en little-endian, structures "packed" (pas de padding).
 */

const HEADER_SIZE = 29;
const MAX_CARS = 22;

function parseHeader(buf) {
  return {
    packetFormat: buf.readUInt16LE(0),
    gameYear: buf.readUInt8(2),
    gameMajorVersion: buf.readUInt8(3),
    gameMinorVersion: buf.readUInt8(4),
    packetVersion: buf.readUInt8(5),
    packetId: buf.readUInt8(6),
    sessionUID: buf.readBigUInt64LE(7),
    sessionTime: buf.readFloatLE(15),
    frameIdentifier: buf.readUInt32LE(19),
    overallFrameIdentifier: buf.readUInt32LE(23),
    playerCarIndex: buf.readUInt8(27),
    secondaryPlayerCarIndex: buf.readUInt8(28),
  };
}

// ---------- Packet ID 0: Motion ----------
const MOTION_CAR_SIZE = 60;
function parseMotion(buf, header) {
  const cars = [];
  for (let i = 0; i < MAX_CARS; i++) {
    const o = HEADER_SIZE + i * MOTION_CAR_SIZE;
    if (o + MOTION_CAR_SIZE > buf.length) break;
    cars.push({
      x: buf.readFloatLE(o + 0),
      y: buf.readFloatLE(o + 4),
      z: buf.readFloatLE(o + 8),
      vx: buf.readFloatLE(o + 12),
      vy: buf.readFloatLE(o + 16),
      vz: buf.readFloatLE(o + 20),
      yaw: buf.readFloatLE(o + 44),
    });
  }
  return { header, cars };
}

// ---------- Packet ID 1: Session ----------
function parseSession(buf, header) {
  let o = HEADER_SIZE;
  const weather = buf.readUInt8(o); o += 1;
  const trackTemperature = buf.readInt8(o); o += 1;
  const airTemperature = buf.readInt8(o); o += 1;
  const totalLaps = buf.readUInt8(o); o += 1;
  const trackLength = buf.readUInt16LE(o); o += 2;
  const sessionType = buf.readUInt8(o); o += 1;
  const trackId = buf.readInt8(o); o += 1;
  const formula = buf.readUInt8(o); o += 1;
  const sessionTimeLeft = buf.readUInt16LE(o); o += 2;
  const sessionDuration = buf.readUInt16LE(o); o += 2;
  const pitSpeedLimit = buf.readUInt8(o); o += 1;
  return {
    header, weather, trackTemperature, airTemperature, totalLaps,
    trackLength, sessionType, trackId, formula, sessionTimeLeft,
    sessionDuration, pitSpeedLimit,
  };
}

// ---------- Packet ID 2: Lap Data ----------
const LAP_DATA_SIZE = 57;
function msFromParts(msPart, minPart) {
  return minPart * 60000 + msPart;
}
function parseLapData(buf, header) {
  const cars = [];
  for (let i = 0; i < MAX_CARS; i++) {
    const o = HEADER_SIZE + i * LAP_DATA_SIZE;
    if (o + LAP_DATA_SIZE > buf.length) break;
    const lastLapTimeInMS = buf.readUInt32LE(o + 0);
    const currentLapTimeInMS = buf.readUInt32LE(o + 4);
    const sector1MS = buf.readUInt16LE(o + 8);
    const sector1Min = buf.readUInt8(o + 10);
    const sector2MS = buf.readUInt16LE(o + 11);
    const sector2Min = buf.readUInt8(o + 13);
    const deltaFrontMS = buf.readUInt16LE(o + 14);
    const deltaFrontMin = buf.readUInt8(o + 16);
    const deltaLeaderMS = buf.readUInt16LE(o + 17);
    const deltaLeaderMin = buf.readUInt8(o + 19);
    const lapDistance = buf.readFloatLE(o + 20);
    const totalDistance = buf.readFloatLE(o + 24);
    const safetyCarDelta = buf.readFloatLE(o + 28);
    const carPosition = buf.readUInt8(o + 32);
    const currentLapNum = buf.readUInt8(o + 33);
    const pitStatus = buf.readUInt8(o + 34);
    const numPitStops = buf.readUInt8(o + 35);
    const sector = buf.readUInt8(o + 36);
    const currentLapInvalid = buf.readUInt8(o + 37);
    const penalties = buf.readUInt8(o + 38);
    const totalWarnings = buf.readUInt8(o + 39);
    const cornerCuttingWarnings = buf.readUInt8(o + 40);
    const numUnservedDriveThroughPens = buf.readUInt8(o + 41);
    const numUnservedStopGoPens = buf.readUInt8(o + 42);
    const gridPosition = buf.readUInt8(o + 43);
    const driverStatus = buf.readUInt8(o + 44);
    const resultStatus = buf.readUInt8(o + 45);
    const pitLaneTimerActive = buf.readUInt8(o + 46);
    const pitLaneTimeInLaneInMS = buf.readUInt16LE(o + 47);
    const pitStopTimerInMS = buf.readUInt16LE(o + 49);
    const pitStopShouldServePen = buf.readUInt8(o + 51);
    const speedTrapFastestSpeed = buf.readFloatLE(o + 52);
    const speedTrapFastestLap = buf.readUInt8(o + 56);

    cars.push({
      lastLapTimeInMS,
      currentLapTimeInMS,
      sector1TimeInMS: msFromParts(sector1MS, sector1Min),
      sector2TimeInMS: msFromParts(sector2MS, sector2Min),
      deltaToCarInFrontMS: msFromParts(deltaFrontMS, deltaFrontMin),
      deltaToRaceLeaderMS: msFromParts(deltaLeaderMS, deltaLeaderMin),
      lapDistance,
      totalDistance,
      safetyCarDelta,
      carPosition,
      currentLapNum,
      pitStatus,
      numPitStops,
      sector,
      currentLapInvalid,
      penalties,
      totalWarnings,
      cornerCuttingWarnings,
      numUnservedDriveThroughPens,
      numUnservedStopGoPens,
      gridPosition,
      driverStatus,
      resultStatus,
      pitLaneTimerActive,
      pitLaneTimeInLaneInMS,
      pitStopTimerInMS,
      pitStopShouldServePen,
      speedTrapFastestSpeed,
      speedTrapFastestLap,
    });
  }
  return { header, cars };
}

// ---------- Packet ID 6: Car Telemetry ----------
const TELEMETRY_CAR_SIZE = 60;
function parseCarTelemetry(buf, header) {
  const cars = [];
  for (let i = 0; i < MAX_CARS; i++) {
    const o = HEADER_SIZE + i * TELEMETRY_CAR_SIZE;
    if (o + TELEMETRY_CAR_SIZE > buf.length) break;
    cars.push({
      speed: buf.readUInt16LE(o + 0),
      throttle: buf.readFloatLE(o + 2),
      steer: buf.readFloatLE(o + 6),
      brake: buf.readFloatLE(o + 10),
      clutch: buf.readUInt8(o + 14),
      gear: buf.readInt8(o + 15),
      engineRPM: buf.readUInt16LE(o + 16),
      drs: buf.readUInt8(o + 18),
      revLightsPercent: buf.readUInt8(o + 19),
      revLightsBitValue: buf.readUInt16LE(o + 20),
      // Temperature data is useful to the dashboard even when a lap is not
      // being archived.  These offsets are part of the packed 2025 telemetry
      // structure (the last two bytes are reserved by the game).
      brakesTemperature: [
        buf.readUInt16LE(o + 22), buf.readUInt16LE(o + 24),
        buf.readUInt16LE(o + 26), buf.readUInt16LE(o + 28),
      ],
      tyresSurfaceTemperature: [
        buf.readUInt8(o + 30), buf.readUInt8(o + 31),
        buf.readUInt8(o + 32), buf.readUInt8(o + 33),
      ],
      tyresInnerTemperature: [
        buf.readUInt8(o + 34), buf.readUInt8(o + 35),
        buf.readUInt8(o + 36), buf.readUInt8(o + 37),
      ],
      engineTemperature: buf.readUInt16LE(o + 38),
      tyresPressure: [
        buf.readFloatLE(o + 40), buf.readFloatLE(o + 44),
        buf.readFloatLE(o + 48), buf.readFloatLE(o + 52),
      ],
    });
  }
  return { header, cars };
}

// ---------- Packet ID 7: Car Status ----------
// The status packet carries fuel, ERS and tyre-compound information.  Keep it
// separate from car telemetry: the game sends both at different cadences.
const CAR_STATUS_SIZE = 55;
function parseCarStatus(buf, header) {
  const cars = [];
  for (let i = 0; i < MAX_CARS; i++) {
    const o = HEADER_SIZE + i * CAR_STATUS_SIZE;
    if (o + CAR_STATUS_SIZE > buf.length) break;
    cars.push({
      fuelMix: buf.readUInt8(o + 2),
      frontBrakeBias: buf.readUInt8(o + 3),
      fuelInTank: buf.readFloatLE(o + 5),
      fuelCapacity: buf.readFloatLE(o + 9),
      fuelRemainingLaps: buf.readFloatLE(o + 13),
      maxRPM: buf.readUInt16LE(o + 17),
      drsAllowed: buf.readUInt8(o + 22),
      actualTyreCompound: buf.readUInt8(o + 25),
      visualTyreCompound: buf.readUInt8(o + 26),
      tyresAgeLaps: buf.readUInt8(o + 27),
      vehicleFiaFlags: buf.readInt8(o + 28),
      ersStoreEnergy: buf.readFloatLE(o + 37),
      ersDeployMode: buf.readUInt8(o + 41),
      ersHarvestedThisLapMGUK: buf.readFloatLE(o + 42),
      ersHarvestedThisLapMGUH: buf.readFloatLE(o + 46),
      ersDeployedThisLap: buf.readFloatLE(o + 50),
    });
  }
  return { header, cars };
}

// ---------- Packet ID 10: Car Damage ----------
// Only tyre wear is required in the live snapshot, but preserving the four
// values individually lets the client render the car layout accurately.
const CAR_DAMAGE_SIZE = 46;
function parseCarDamage(buf, header) {
  const cars = [];
  for (let i = 0; i < MAX_CARS; i++) {
    const o = HEADER_SIZE + i * CAR_DAMAGE_SIZE;
    if (o + CAR_DAMAGE_SIZE > buf.length) break;
    cars.push({
      tyresWear: [
        buf.readFloatLE(o), buf.readFloatLE(o + 4),
        buf.readFloatLE(o + 8), buf.readFloatLE(o + 12),
      ],
      tyresDamage: [buf.readUInt8(o + 16), buf.readUInt8(o + 17), buf.readUInt8(o + 18), buf.readUInt8(o + 19)],
      brakesDamage: [buf.readUInt8(o + 20), buf.readUInt8(o + 21), buf.readUInt8(o + 22), buf.readUInt8(o + 23)],
    });
  }
  return { header, cars };
}

// ---------- Packet ID 4: Participants ----------
const PARTICIPANT_SIZE = 57;
function readName(buf, offset, len) {
  let end = offset;
  while (end < offset + len && buf[end] !== 0) end++;
  return buf.toString('utf8', offset, end);
}
function parseParticipants(buf, header) {
  let o = HEADER_SIZE;
  const numActiveCars = buf.readUInt8(o); o += 1;
  const cars = [];
  for (let i = 0; i < MAX_CARS; i++) {
    const base = o + i * PARTICIPANT_SIZE;
    if (base + PARTICIPANT_SIZE > buf.length) break;
    cars.push({
      aiControlled: buf.readUInt8(base + 0),
      driverId: buf.readUInt8(base + 1),
      teamId: buf.readUInt8(base + 3),
      raceNumber: buf.readUInt8(base + 5),
      name: readName(buf, base + 7, 32),
    });
  }
  return { header, numActiveCars, cars };
}

const PACKET_ID = {
  MOTION: 0,
  SESSION: 1,
  LAP_DATA: 2,
  EVENT: 3,
  PARTICIPANTS: 4,
  CAR_SETUPS: 5,
  CAR_TELEMETRY: 6,
  CAR_STATUS: 7,
  FINAL_CLASSIFICATION: 8,
  LOBBY_INFO: 9,
  CAR_DAMAGE: 10,
  SESSION_HISTORY: 11,
  TYRE_SETS: 12,
  MOTION_EX: 13,
  TIME_TRIAL: 14,
  LAP_POSITIONS: 15,
};

function parsePacket(buf) {
  if (buf.length < HEADER_SIZE) return null;
  const header = parseHeader(buf);
  switch (header.packetId) {
    case PACKET_ID.MOTION:
      return { type: 'motion', data: parseMotion(buf, header) };
    case PACKET_ID.SESSION:
      return { type: 'session', data: parseSession(buf, header) };
    case PACKET_ID.LAP_DATA:
      return { type: 'lapData', data: parseLapData(buf, header) };
    case PACKET_ID.CAR_TELEMETRY:
      return { type: 'carTelemetry', data: parseCarTelemetry(buf, header) };
    case PACKET_ID.CAR_STATUS:
      return { type: 'carStatus', data: parseCarStatus(buf, header) };
    case PACKET_ID.CAR_DAMAGE:
      return { type: 'carDamage', data: parseCarDamage(buf, header) };
    case PACKET_ID.PARTICIPANTS:
      return { type: 'participants', data: parseParticipants(buf, header) };
    default:
      return { type: 'other', data: { header } };
  }
}

module.exports = { parsePacket, PACKET_ID, HEADER_SIZE };
