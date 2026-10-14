// ================= simulation (host / solo) =================
function newRound(round) {
  const r = rng(2026 + round * 17), rp = rng(99 + round * 31), fish = [], S = roundSet(round); let guard = 0;
  while (fish.length < S.fish && guard++ < 50000) {
    const x = 30 + r() * (LW - 60), y = 290 + r() * (LH - 320);
    if (fish.some(f => Math.hypot(f.x - x, f.y - y) < 30)) continue;
    fish.push({ x, y, vx: 0, vy: 0, h: 0, vh: 0, rot: r() * TAU, vr: 0, flip: 0, vflip: 0, lp: 0, ld: 0, caught: false, wasHigh: false, lastBy: -1, lastT: -1e9, cBy: -1, pts: 0 });
  }
  // points written on each fish's back: as many fish worth 1 as worth 2 ... as worth 10 (fish count is a multiple of 10), shuffled
  const pts = fish.map((f, i) => 1 + i % 10);
  for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(rp() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  fish.forEach((f, i) => { f.pts = pts[i]; });
  // quota / cred: fish each player may / did put in the plate; credPts: the points those fish are worth
  const slots = players.map(p => p.slot), quota = {}, cred = {}, credPts = {};
  slots.forEach((s, i) => { quota[s] = Math.floor(fish.length / slots.length) + (i < fish.length % slots.length ? 1 : 0); cred[s] = 0; credPts[s] = 0; });
  G = { round, quota, cred, credPts, fish, timeLeft: S.time, score: 0, fouls: 0, gt: 0, countdown: 3, overT: 0, plateX: LW / 2, wind: 0, inputs: {}, net: [], gusts: [] };
  R.round = round; setPlate(round); PLATE.x = LW / 2; pops = [];
  phase = 'count';
}
function inp(slot) { return G.inputs[slot] || (G.inputs[slot] = { x: -999, y: -999, vx: 0, vy: 0, a: false, t: 0, lastFoul: -1e9, lastSlap: -1e9 }); }
function effect(e) { G.net.push(e); addPop(e); }

function foul(slot, f, now) {
  inp(slot).lastFoul = now; G.fouls++;
  G.timeLeft = Math.max(0, G.timeLeft - 1);
  effect({ k: 't', x: Math.round(f.x), y: Math.round(f.y - 22), s: 'Chạm cá! -1s', b: 1 });
}

// The gust from a slam. The fan hits the ground and the air it drives down spreads out along the ground from the
// spot, a front moving at GUST.speed, so near fish get it first and far ones a moment later. The moving air fills
// a dome: widest at the ground (the slam's reach), lower toward its edge, as high as GUST.hMin + GUST.hMax * fan
// height above the spot. A fish gets the gust when the front reaches it, as strong as how deep inside the dome it
// is: full on the ground right next to the spot, fading out toward the dome's edge both sideways and upward, none
// above it. A fish on the ground is thrown up; one already in the air inside the dome gets carried a bit higher.
const GUST = { speed: 750, hMin: 45, hMax: 100 };
function doSlap(slot, x, y, lv = 0) {
  if (phase !== 'play') return;
  const i = inp(slot), now = performance.now();
  if (now - i.lastSlap < 300) return;
  i.lastSlap = now;
  effect({ k: 'r', x: Math.round(x), y: Math.round(y), c: slot, p: Math.round(lv * 100) / 100 });
  // push speed / lift by fan height. With paper drag (PAPER) a fish on the ground next to a full-height slam lands
  // ~700px away, a half-height one ~500px, a quick tap ~120px.
  const R = slamR(lv);
  G.gusts.push({ slot, x, y, age: 0, R, Rc: PLATE_HIT_R * (1 + 0.8 * lv) * ROUNDS[G.round].plateHit, // fish already in the plate: round 1 only from close by, rounds 2-3 from further away
    top: GUST.hMin + GUST.hMax * lv, V: 380 + 3000 * Math.pow(lv, 1.3), H: 1.1 + 0.8 * lv, hit: new Uint8Array(G.fish.length) });
  if (ROUNDS[G.round].foul && now - i.lastFoul > 1000) { // the fan itself came down on a fish
    const touched = G.fish.find(f => f.h < 3 && hitsFish(f, x, y));
    if (touched) foul(slot, touched, now);
  }
}
function blowGust(g, dt) {
  g.age += dt;
  const front = g.age * GUST.speed, now = performance.now();
  G.fish.forEach((f, idx) => {
    if (g.hit[idx]) return;
    const dx = f.x - g.x, dy = f.y - g.y, d = Math.hypot(dx, dy);
    if (d > front) return; // not there yet
    g.hit[idx] = 1;
    const r = Math.hypot(d / (f.caught ? g.Rc : g.R), f.h / g.top); // 0 at the spot, 1 at the dome's edge
    if (r >= 1 || !canMove(g.slot, f, now)) return;
    claim(g.slot, f, now);
    const w = 1 - r;
    const nx = d > 0.5 ? dx / d : 0, ny = d > 0.5 ? dy / d : -1;
    // Roll: the wind gets under the edge that faces it and lifts that side, so the fish turns over about its long
    // axis away from the wind. Wind across the body rolls it hard, wind along it (head or tail first) barely does.
    // Which way it turns on screen depends on which face is up. A fish lying edge-on catches the air on its face.
    const across = -nx * Math.sin(f.rot) + ny * Math.cos(f.rot), up = Math.cos(f.flip) >= 0 ? 1 : -1;
    const roll = across * up * (1 + 0.6 * (1 - Math.abs(Math.cos(f.flip)))) + (Math.random() - .5) * 0.5;
    if (f.h < 6) {
      f.vh = Math.max(f.vh, (170 + 150 * w) * g.H); f.vflip += (4 + 10 * w) * roll;
      f.ld = Math.random() * TAU; f.lp = Math.random() * TAU; // which way and when it will rock while falling
    } else { f.vh = Math.max(f.vh, (60 + 150 * w) * g.H * w); f.vflip += 5 * w * roll; } // updraft
    f.vx += nx * g.V * w; f.vy += ny * g.V * w; f.vr += (Math.random() - .5) * 6 * w;
  });
  return front < Math.max(g.R, g.Rc); // still spreading
}


function catchFish(f) {
  const s = f.lastBy;
  if (s >= 0 && G.quota[s] !== undefined && G.cred[s] >= G.quota[s]) { // this player's share is full: fish bounces out
    const dx = f.x - PLATE.x, dy = f.y - PLATE.y, d = Math.hypot(dx / PLATE.rx, dy / PLATE.ry) || 1;
    f.x = PLATE.x + dx / d * 1.1; f.y = PLATE.y + dy / d * 1.1;
    const n = Math.hypot(dx, dy) || 1; f.vx = dx / n * 160; f.vy = dy / n * 160; f.wasHigh = false;
    slideOffRim(f); // lands clear of the plate, not half under it
    effect({ k: 't', x: Math.round(f.x), y: Math.round(f.y - 20), s: `${nameOf(s)} đủ ${G.quota[s]} con!`, b: 1 });
    return;
  }
  f.caught = true; f.cBy = s; if (s >= 0 && G.cred[s] !== undefined) { G.cred[s]++; G.credPts[s] += f.pts; }
  G.score += f.pts; f.vx *= .3; f.vy *= .3; effect({ k: 't', x: Math.round(f.x), y: Math.round(f.y - 20), s: '+' + f.pts });
}
function loseFish(f) {
  if (f.cBy >= 0 && G.cred[f.cBy] !== undefined) { G.cred[f.cBy]--; G.credPts[f.cBy] -= f.pts; }
  f.caught = false; f.cBy = -1; G.score -= f.pts; effect({ k: 't', x: Math.round(f.x), y: Math.round(f.y - 20), s: '-' + f.pts, b: 1 });
}
// End of a round with 2+ players: each must have at least one fish in the plate. If anyone has none, the team
// loses as many points as the top scorer (most points; more fish on a tie) has fish in the plate.
function roundPenalty() {
  if (players.length < 2) return null;
  const empty = players.filter(p => !(G.cred[p.slot] > 0));
  if (!empty.length) return null;
  const top = players.slice().sort((a, b) => (G.credPts[b.slot] || 0) - (G.credPts[a.slot] || 0) || (G.cred[b.slot] || 0) - (G.cred[a.slot] || 0))[0];
  return { n: G.cred[top.slot] || 0, top: top.name, empty: empty.map(p => p.name) };
}

// A paper fish is light and flat, so the air matters more than gravity: drag grows with the square of its speed,
// so a hard slam throws it fast but it loses that speed within a fraction of a second. It goes up easily (the gust
// carries it) and comes down slowly, slowest while lying flat to the air, rocking back and forth like a falling leaf
// and drifting with the wind. It doesn't bounce when it lands: it slides a little and tips over onto whichever
// face it is leaning towards (paperSettle).
const PAPER = { g: 620, up: 0.0035, fallFlat: 0.11, fallEdge: 0.02, lin: 1.0, quad: 0.0025, leaf: 1100, leafW: 7 };
function paperFlight(f, dt) {
  const flat = Math.abs(Math.cos(f.flip)); // 1 = facing the air flat, 0 = edge-on
  const kv = f.vh > 0 ? PAPER.up : PAPER.fallEdge + (PAPER.fallFlat - PAPER.fallEdge) * flat;
  f.vh -= (PAPER.g + kv * f.vh * Math.abs(f.vh)) * dt;
  f.h += f.vh * dt;
  // sideways: drag against the air, which moves with the wind in round 3
  const ax = f.vx - G.wind, sp = Math.hypot(ax, f.vy), damp = Math.exp(-(PAPER.lin + PAPER.quad * sp) * dt);
  f.vx = G.wind + ax * damp; f.vy *= damp;
  if (f.vh < 0) { // falling: glides back and forth, harder while flat
    f.lp += PAPER.leafW * dt;
    const a = Math.sin(f.lp) * PAPER.leaf * (0.3 + 0.7 * flat) * dt;
    f.vx += Math.cos(f.ld) * a; f.vy += Math.sin(f.ld) * a;
    f.vflip += Math.cos(f.lp) * 6 * dt; // rocks as it glides
    f.vflip -= Math.sin(2 * f.flip) * 9 * dt; // and the air turns its face down towards the ground (flat is stable)
  }
  f.flip += f.vflip * dt; f.vflip *= Math.exp(-(1.2 + 0.04 * Math.abs(f.vflip)) * dt); // the air brakes a fast roll
  if (f.h <= 0) {
    f.h = 0; f.vh = 0; f.vx *= .5; f.vy *= .5;
    f.vflip *= .4; // the landing takes most of the spin
  }
}
// On the ground: a fish not lying flat falls onto the face it is leaning towards (balanced on its edge is
// unstable); if it lands still rolling fast it may go over once more. Then it lies still.
function paperSettle(f, dt) {
  const off = f.flip - Math.round(f.flip / Math.PI) * Math.PI; // -π/2..π/2 from lying flat
  if (Math.abs(off) < 0.05 && Math.abs(f.vflip) < 1) { f.flip -= off; f.vflip = 0; return; }
  f.vflip -= Math.sin(2 * off) * 160 * dt;
  f.vflip *= Math.exp(-(f.under ? 20 : 7) * dt); // under the plate there's no room to turn over
  f.flip += f.vflip * dt;
}

function step(dt) {
  if (!G) return;
  const C = ROUNDS[G.round];
  if (phase === 'count') { G.countdown -= dt; if (G.countdown <= 0) { G.countdown = 0; phase = 'play'; onPhase(); } }
  if (phase === 'play') {
    G.timeLeft -= dt; G.gt += dt;
    if (G.timeLeft <= 0) { G.timeLeft = 0; phase = 'over'; G.overT = 1.8; onPhase(); }
  }
  if (phase === 'over') { G.overT -= dt; if (G.overT <= 0) { finishRound(); return; } }
  let pdx = 0;
  if (phase === 'play' && C.move) {
    const nx = LW / 2 + Math.sin(G.gt * TAU / 12) * 320;
    pdx = nx - G.plateX; G.plateX = nx;
  }
  PLATE.x = G.plateX;
  G.wind = C.wind && phase === 'play' ? Math.sin(G.gt * 0.55) * 70 + Math.sin(G.gt * 1.9 + 1) * 35 : 0;
  G.gusts = G.gusts.filter(g => blowGust(g, dt));
  for (const f of G.fish) {
    if (f.caught && f.h < 1) f.x += pdx;
    if (f.under && f.vh > 0) f.vh = 0; // under the plate: a slam can't lift it, the plate is right above it
    if (f.h > 0 || f.vh > 0) paperFlight(f, dt);
    else { const fr = f.under ? UNDER_FR : f.caught ? 10 : 6.5; f.vx *= Math.exp(-fr * dt); f.vy *= Math.exp(-fr * dt); paperSettle(f, dt); }
    f.vr *= Math.exp(-4 * dt);
    f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt;
    if (f.x < 14) { f.x = 14; f.vx = Math.abs(f.vx) * .4; } if (f.x > LW - 14) { f.x = LW - 14; f.vx = -Math.abs(f.vx) * .4; }
    if (f.y < 14) { f.y = 14; f.vy = Math.abs(f.vy) * .4; } if (f.y > LH - 14) { f.y = LH - 14; f.vy = -Math.abs(f.vy) * .4; }
    // The plate stands off the ground. A fish gets onto it only by dropping in from at least `lift` high. One
    // flying lower bounces off its side; one sliding along the ground slips under its edge and gets stuck there
    // (not counted). Even with only its head or tail under the
    // plate it can't fly up: a slam only pushes it along the ground, out from under (or further in), and once
    // it's clear another slam can lift it.
    const lift = C.rim || 3, inside = inPlate(f, 1);
    if (f.caught) {
      if (f.h < lift && !inside) {
        if (!C.rim) { if (phase === 'play') loseFish(f); } // easy: knocked off the flat plate, lost
        else if (f.wasHigh && phase === 'play') loseFish(f); else toRim(f, 0.96);
      }
    } else if (f.under) {
      if (!bodyUnder(f)) f.under = false;
      else { f.h = 0; f.vh = 0; stuckUnder(f); }
    } else if (f.h < lift && bodyUnder(f)) {
      if (inside && f.wasHigh && phase === 'play') catchFish(f);
      if (!f.caught && bodyUnder(f)) { // (a fish bounced off a full share is already clear)
        if (f.wasHigh && !inside) slideOffRim(f); // came down on the edge: tips off outward
        else if (f.h > UNDER_GAP) hitPlateSide(f); // flying low into the plate: bounces off its side
        else { f.under = true; f.h = 0; f.vh = 0; stuckUnder(f); } // sliding along the ground: slips under the edge
      }
    }
    f.wasHigh = f.h >= lift;
  }
  R.round = G.round; R.fish = G.fish; R.plateX = G.plateX; R.time = G.timeLeft; R.score = G.score;
  R.fouls = G.fouls; R.cd = G.countdown; R.wind = G.wind; R.cred = G.cred; R.quota = G.quota; R.fans = fansSnap();
}

function finishRound() {
  lastPen = roundPenalty();
  results[G.round - 1] = G.score - (lastPen ? lastPen.n : 0);
  lastPer = { ...G.cred }; lastPts = { ...G.credPts }; lastRound = G.round;
  const left = [1, 2, 3].filter(r => results[r - 1] === undefined);
  if (left.length) { nextRound = left.find(r => r > G.round) || left[0]; phase = 'lobby'; } // next unplayed round
  else phase = 'final';
  broadcast(lobbyMsg());
  onPhase();
}
