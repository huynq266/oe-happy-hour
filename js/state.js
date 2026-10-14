// ================= state =================
let role = null;            // 'host' (quản trò: runs a room of several teams, doesn't play) | 'client' | 'solo'
let phase = 'home';         // home | pick (player choosing a team) | lobby | count | play | over | final | board (quản trò)
let peer = null, hostConn = null, roomCode = '';
let conns = new Map();      // host, one team's: peerId -> {conn, slot, name}
let netSq = 0;              // host: sequence on every lobby/snapshot message, across all teams (the data channel is unordered)
let players = [];           // [{slot, name}]: the team. The host (quản trò) runs the room but isn't in it.
let mySlot = 0, myName = '', teamNo = 1; // mySlot -1: the host, who has no fan
let hostName = '';
let settings = cleanSettings(null); // per round fish / time / plate size, and the room's player limit (set by the host)
let nextRound = 1;          // round shown in lobby
let lastRound = 0;          // round just finished (0 = none yet)
let results = [];           // team score per finished round
let lastPer = null;         // {slot: count} for the round just played
let lastPts = null;         // {slot: points} for the round just played
let lastPen = null;         // end-of-round penalty, if any: {n, top, empty: [names]}
let G = null;               // authoritative sim (host / solo)
let pops = [];
// what the field shows: the sim's state (host / solo) or the interpolated snapshots (client). The host keeps one per team.
const freshR = () => ({ cred: {}, quota: {}, round: 1, fish: [], plateX: LW / 2, time: ROUND_TIME, score: 0, fouls: 0, cd: 3, wind: 0, fans: [] });
let R = freshR();
let gotSnap = false;

// ================= helpers =================
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const cfg = () => ROUNDS[R.round] || ROUNDS[1];
function setPlate(round) { const c = ROUNDS[round], k = roundSet(round).plate; PLATE.rx = c.rx * k; PLATE.ry = c.ry * k; }
function roundSet(round) { return settings.rounds[round] || DEFAULT_ROUND; }
// settings from storage or the network, made safe: anything missing or out of range falls back to the defaults
function cleanSettings(s) {
  const src = s && typeof s === 'object' ? s : {}, rs = Array.isArray(src.rounds) ? src.rounds : [];
  const out = { rounds: [null], maxPlayers: Math.round(Math.min(MAX_PLAYERS, Math.max(1, +src.maxPlayers || MAX_PLAYERS))) };
  for (let r = 1; r <= 3; r++) {
    const o = rs[r] && typeof rs[r] === 'object' ? rs[r] : {};
    out.rounds[r] = {
      fish: Math.round(Math.min(FISH_MAX, Math.max(FISH_MIN, +o.fish || DEFAULT_ROUND.fish)) / FISH_STEP) * FISH_STEP,
      time: TIME_OPTS.includes(+o.time) ? +o.time : DEFAULT_ROUND.time,
      plate: PLATE_OPTS.some(p => p[0] === +o.plate) ? +o.plate : DEFAULT_ROUND.plate };
  }
  return out;
}
function plateName(k) { const p = PLATE_OPTS.find(p => p[0] === k); return p ? p[1] : 'Vừa'; }
function inPlate(f, k, px = PLATE.x) { const a = (f.x - px) / PLATE.rx, b = (f.y - PLATE.y) / PLATE.ry; return a * a + b * b < k; }
function toRim(f, k) {
  const dx = f.x - PLATE.x, dy = f.y - PLATE.y;
  const d = Math.hypot(dx / PLATE.rx, dy / PLATE.ry) || 1;
  f.x = PLATE.x + dx / d * k; f.y = PLATE.y + dy / d * k;
  f.vx *= -0.3; f.vy *= -0.3;
}
const UNDER_K = 0.75, UNDER_FR = 16; // how far under the plate's edge a fish can slide, and how hard it sticks there
// a fish under the plate's edge can't get further in than UNDER_K (the plate's foot): it stops there, or glances
// off sideways. Nothing pulls it in or pushes it out.
// any part of the fish's body (head, middle or tail) inside the plate's outline: it is (partly) under the plate
function bodyUnder(f) {
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  for (const l of [-16, 0, 20]) {
    const a = (f.x + c * l - PLATE.x) / PLATE.rx, b = (f.y + s * l - PLATE.y) / PLATE.ry;
    if (a * a + b * b < 1) return true;
  }
  return false;
}
// a fish coming down on the plate's edge (its middle outside) tips off it: moved straight out until it's clear
function slideOffRim(f) {
  let dx = f.x - PLATE.x, dy = f.y - PLATE.y; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
  for (let i = 0; i < 60 && bodyUnder(f); i++) { f.x += dx * 2; f.y += dy * 2; }
}
// The plate stands UNDER_GAP off the ground. A fish flying lower than its top but higher than that gap runs into
// its side: it is put back outside and bounces off, losing most of its speed into the plate; it keeps rising.
const UNDER_GAP = 2;
function hitPlateSide(f) {
  slideOffRim(f);
  let nx = (f.x - PLATE.x) / (PLATE.rx * PLATE.rx), ny = (f.y - PLATE.y) / (PLATE.ry * PLATE.ry);
  const n = Math.hypot(nx, ny) || 1; nx /= n; ny /= n;
  const vn = f.vx * nx + f.vy * ny;
  if (vn < 0) { f.vx -= 1.3 * vn * nx; f.vy -= 1.3 * vn * ny; f.vx *= .7; f.vy *= .7; }
}
function stuckUnder(f) {
  let dx = f.x - PLATE.x, dy = f.y - PLATE.y;
  if (!dx && !dy) dy = 1;
  const d = Math.hypot(dx / PLATE.rx, dy / PLATE.ry);
  if (d >= UNDER_K) return;
  f.x = PLATE.x + dx / d * UNDER_K; f.y = PLATE.y + dy / d * UNDER_K;
  let nx = dx / (PLATE.rx * PLATE.rx), ny = dy / (PLATE.ry * PLATE.ry); const n = Math.hypot(nx, ny) || 1; nx /= n; ny /= n;
  const vn = f.vx * nx + f.vy * ny;
  if (vn < 0) { f.vx -= vn * nx; f.vy -= vn * ny; }
}
function hitsFish(f, x, y) {
  const dx = x - f.x, dy = y - f.y, c = Math.cos(f.rot), s = Math.sin(f.rot);
  const lx = c * dx + s * dy, ly = -s * dx + c * dy;
  return (lx / 19) ** 2 + (ly / 9) ** 2 < 1;
}
function fmtTime(t) { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
function nameOf(slot) { const p = players.find(p => p.slot === slot); return p ? p.name : '?'; }
function num(v, lo, hi) { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; }
const GUARD_MS = 1000; // round 1: a fish a teammate just fanned is theirs for this long
function canMove(slot, f, now) { return ROUNDS[G.round].cross || f.lastBy === slot || f.lastBy < 0 || now - f.lastT > GUARD_MS; }
function claim(slot, f, now) { f.lastBy = slot; f.lastT = now; }
