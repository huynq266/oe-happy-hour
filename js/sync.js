// ================= networking: snapshots (host sends, client interpolates) =================
// every player's fan, always: [slot, x, y, ang, pushing, live]. Idle / lifted fans stay at their last spot.
function fansSnap() {
  const now = performance.now(), out = [];
  for (const p of players) {
    const i = inp(p.slot), live = i.x > -100 && now - i.t < 2000;
    if (live) { i.lx = i.x; i.ly = i.y; if (Math.hypot(i.vx, i.vy) > 40) i.ang = Math.atan2(i.vy, i.vx); }
    const x = i.lx !== undefined ? i.lx : 80 + p.slot * (LW - 160) / (MAX_PLAYERS - 1), y = i.ly !== undefined ? i.ly : LH - 50;
    out.push([p.slot, Math.round(x), Math.round(y), Math.round((i.ang !== undefined ? i.ang : -Math.PI / 2) * 100) / 100, live ? 1 : 0, live ? Math.round((i.ch || 0) * 100) / 100 : 0]);
  }
  return out;
}

// delta: only fish that changed in the last 3 sends, as [idx, x, y, h, rot, flip, caught] groups.
// Repeating each change 3 times means a lost or late packet costs nothing.
function snapshot(delta) {
  const f = [], sent = G.sent || (G.sent = []), chg = G.chg || (G.chg = []), n = G.ssq = (G.ssq || 0) + 1;
  G.fish.forEach((o, i) => {
    const q = [Math.round(o.x * 10), Math.round(o.y * 10), Math.round(o.h * 10),
      Math.round((((o.rot % TAU) + TAU) % TAU) * 100), Math.round(Math.cos(o.flip) * 100), o.caught ? 1 : 0];
    const p = sent[i];
    if (!p || q.some((v, k) => v !== p[k])) { sent[i] = q; chg[i] = n; }
    if (!delta || n - chg[i] < 3) f.push(i, ...q);
  });
  return { k: 's', sq: ++netSq, ts: Math.round(lastSim), full: delta ? 0 : 1, n: G.fish.length, ph: phase, rd: G.round, t: Math.round(G.timeLeft * 10) / 10, cd: Math.round(G.countdown * 10) / 10,
    sc: G.score, fo: G.fouls, px: Math.round(G.plateX * 10), wx: Math.round(G.wind), pc: G.cred, q: G.quota, f, fans: R.fans, ev: G.net.splice(0),
    pt: delta ? undefined : G.fish.map(o => o.pts) }; // each fish's points (fixed for the round): with the full ones
}

// ================= client: apply snapshot =================
// The client renders renderDelay ms behind the host and interpolates between the two snapshots around that time.
let renderDelay = 80;       // client: ms behind the host; follows the measured jitter
let jit = 0;                // client: how late snapshots arrive vs the fastest one (decaying peak), ms
let snapGap = 33;           // client: time between the host's snapshots (30 or 20 a second), ms
let lastSq = 0, lobbySq = 0; // client: newest snapshot / lobby message seen; older ones arrive late and are dropped
let snapRx = 0, frames = 0, starve = 0, rtt = 0, connType = ''; // client: stats line
let snaps = [];             // client: [{t, px, fish: Float32Array(n*6), fans}], oldest first
let base = null;            // client: latest quantized fish state (6 per fish), patched by deltas
let clkOff = null;          // client: host clock - local clock, tracked at the fastest arrival
function applySnap(d) {
  if (d.sq !== undefined) {
    if (d.sq <= lastSq || d.sq < lobbySq) { if (d.sq > lobbySq) (d.ev || []).forEach(addPop); return; } // stale: keep only its one-off effects
    lastSq = d.sq;
  }
  const prev = phase;
  if (d.rd !== R.round) gotSnap = false;
  phase = d.ph; R.round = num(d.rd, 1, 3) | 0 || 1; setPlate(R.round);
  R.time = d.t; R.cd = d.cd; R.score = d.sc; R.fouls = d.fo; R.wind = d.wx || 0; R.cred = d.pc || {}; R.quota = d.q || {};
  (d.ev || []).forEach(addPop);
  const n = Math.max(0, Math.min(500, d.n | 0)), f = Array.isArray(d.f) ? d.f : [];
  if (!gotSnap || !base || base.length !== n * 6) {
    if (d.full) {
      base = new Array(n * 6).fill(0); snaps = []; R.fish = [];
      for (let i = 0; i < n; i++) R.fish.push({ x: 0, y: 0, h: 0, rot: 0, fs: 1, caught: false });
    } else { base = null; gotSnap = false; R.fish = []; } // wait for the next full snapshot
  }
  if (base && Array.isArray(d.pt)) R.fish.forEach((o, i) => { o.pts = Math.max(1, Math.min(10, d.pt[i] | 0)); });
  if (base) {
    for (let j = 0; j + 6 < f.length; j += 7) {
      const i = f[j] | 0; if (i < 0 || i >= n) continue;
      for (let k = 0; k < 6; k++) base[i * 6 + k] = +f[j + 1 + k] || 0;
    }
    const fish = new Float32Array(n * 6);
    for (let i = 0; i < n * 6; i += 6) {
      fish[i] = base[i] / 10; fish[i + 1] = base[i + 1] / 10; fish[i + 2] = base[i + 2] / 10;
      fish[i + 3] = base[i + 3] / 100; fish[i + 4] = base[i + 4] / 100; fish[i + 5] = base[i + 5];
    }
    const t = +d.ts || 0, off = t - performance.now();
    clkOff = clkOff === null || off > clkOff ? off : clkOff + (off - clkOff) * 0.02;
    jit = Math.max(clkOff - off, jit * 0.97); snapRx++;
    const prevT = snaps.length ? snaps[snaps.length - 1].t : 0, g = t - prevT;
    if (prevT && g > 10 && g < 200) snapGap += (g - snapGap) * 0.1; // the host's sending interval
    snaps.push({ t, px: d.px / 10, fish, fans: Array.isArray(d.fans) ? d.fans : [] });
    if (snaps.length > 30) snaps.shift();
    gotSnap = true;
  }
  if (prev !== phase) onPhase();
}
function interpClient(dt) {
  if (role !== 'client' || !gotSnap || !snaps.length) return;
  // stay at least one snapshot interval (plus a margin) behind, so there is a newer snapshot to glide toward
  const target = Math.min(300, Math.max(60, snapGap + 20, 45 + jit * 1.2));
  renderDelay += (target - renderDelay) * (target > renderDelay ? 0.15 : 0.01);
  const rt = performance.now() + clkOff - renderDelay;
  while (snaps.length > 2 && snaps[1].t <= rt) snaps.shift();
  const a = snaps[0], b = snaps[1] || a;
  frames++; if (rt > b.t) starve++;
  // next snapshot late: keep gliding for up to 50ms instead of freezing
  const u = b.t > a.t ? Math.max(0, Math.min(1 + 50 / (b.t - a.t), (rt - a.t) / (b.t - a.t))) : 1;
  const wrap = da => ((da + Math.PI) % TAU + TAU) % TAU - Math.PI;
  R.plateX = a.px + (b.px - a.px) * u;
  const A = a.fish, B = b.fish;
  for (let i = 0; i < R.fish.length; i++) {
    const o = R.fish[i], j = i * 6;
    const v = Math.hypot(B[j] - A[j], B[j + 1] - A[j + 1]) > 120 ? 1 : u; // teleport: don't slide
    o.x = A[j] + (B[j] - A[j]) * v; o.y = A[j + 1] + (B[j + 1] - A[j + 1]) * v; o.h = Math.max(0, A[j + 2] + (B[j + 2] - A[j + 2]) * v);
    o.rot = A[j + 3] + wrap(B[j + 3] - A[j + 3]) * v; o.fs = Math.max(-1, Math.min(1, A[j + 4] + (B[j + 4] - A[j + 4]) * v));
    o.caught = !!(v < .5 ? A : B)[j + 5];
  }
  R.fans = b.fans.map(fb => {
    const fa = a.fans.find(x => x[0] === fb[0]) || fb;
    return [fb[0], fa[1] + (fb[1] - fa[1]) * u, fa[2] + (fb[2] - fa[2]) * u, fa[3] + wrap(fb[3] - fa[3]) * u, fb[4], fb[5] || 0];
  });
  if (phase === 'play') R.time = Math.max(0, R.time - dt);
  if (phase === 'count') R.cd = Math.max(0, R.cd - dt);
}
