// ================= effects =================
function addPop(e) {
  if (e.k === 'r') pops.push({ k: 'r', x: e.x, y: e.y, c: e.c | 0, p: Math.max(0, Math.min(1, +e.p || 0)), life: .45 });
  else pops.push({ k: 't', x: e.x, y: e.y, s: String(e.s).slice(0, 20), b: !!e.b, life: e.b ? 1.2 : .9 });
}

// ================= ground texture =================
const ground = document.createElement('canvas'), groundPx = document.createElement('canvas');
function buildGround() {
  ground.width = LW * 2; ground.height = LH * 2;
  const g = ground.getContext('2d'); g.scale(2, 2);
  const grad = g.createLinearGradient(0, 0, 0, LH);
  grad.addColorStop(0, '#c4beb1'); grad.addColorStop(1, '#ada699');
  g.fillStyle = grad; g.fillRect(0, 0, LW, LH);
  const r = rng(7);
  for (let i = 0; i < 26000; i++) {
    const v = 120 + r() * 90 | 0;
    g.fillStyle = `rgba(${v},${v - 4},${v - 12},${0.18 + r() * 0.25})`;
    g.fillRect(r() * LW, r() * LH, 0.6 + r() * 1.4, 0.6 + r() * 1.4);
  }
  g.strokeStyle = 'rgba(70,64,55,.35)'; g.lineWidth = 1.5;
  [250, 490].forEach(y => { g.beginPath(); g.moveTo(0, y); g.lineTo(LW, y + 6); g.stroke(); });
  g.strokeStyle = 'rgba(60,55,48,.28)'; g.lineWidth = 1;
  for (let c = 0; c < 10; c++) {
    let x = r() * LW, y = r() * LH; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (r() - .5) * 40; y += (r() - .3) * 22; g.lineTo(x, y); } g.stroke();
  }
  const v = g.createRadialGradient(LW / 2, LH / 2, LH * .35, LW / 2, LH / 2, LH * .75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(40,35,28,.28)');
  g.fillStyle = v; g.fillRect(0, 0, LW, LH);
}

// ================= view =================
let W, H, dpr, scale, ox, oy;
function resize() {
  W = innerWidth; H = innerHeight;
  // cap the canvas at ~2.3M pixels: fullscreen on a big / retina screen otherwise costs 4-8M pixels a frame
  dpr = Math.max(1, Math.min(devicePixelRatio || 1, 2, Math.sqrt(2.3e6 / (W * H))));
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  scale = Math.min(W / LW, H / LH); ox = (W - LW * scale) / 2; oy = (H - LH * scale) / 2;
  // ground pre-scaled to exactly its on-screen size, so each frame is a plain copy instead of a scaled draw
  groundPx.width = Math.max(1, Math.round(LW * scale * dpr)); groundPx.height = Math.max(1, Math.round(LH * scale * dpr));
  if (ground.width > 1) groundPx.getContext('2d').drawImage(ground, 0, 0, groundPx.width, groundPx.height);
}
function toWorld(e) { return { x: (e.clientX - ox) / scale, y: (e.clientY - oy) / scale }; }

function drawPlate() {
  const { x, y, rx, ry } = PLATE, rim = cfg().rim > 0;
  ctx.fillStyle = 'rgba(40,30,25,.3)'; ctx.beginPath(); ctx.ellipse(x + 4, y + (rim ? 9 : 6), rx, ry, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#7a0b10'; ctx.beginPath(); ctx.ellipse(x, y + (rim ? 6 : 3), rx, ry, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(x - 20, y - 14, 4, x, y, rx);
  g.addColorStop(0, '#ec3a3f'); g.addColorStop(1, '#c8161d');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
  if (rim) {
    ctx.strokeStyle = '#e8565a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(x, y, rx - 3, ry - 3, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#b3131a'; ctx.beginPath(); ctx.ellipse(x, y + 2, rx * .78, ry * .76, 0, 0, TAU); ctx.fill();
  } else {
    ctx.strokeStyle = 'rgba(120,10,14,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y + 2, rx * .72, ry * .7, 0, 0, TAU); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(x, y, rx * .9, ry * .86, 0, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
}

function fishPath() {
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.quadraticCurveTo(-6, -12, 12, -2);
  ctx.lineTo(25, -10); ctx.lineTo(22, 0); ctx.lineTo(25, 10); ctx.lineTo(12, 2);
  ctx.quadraticCurveTo(-6, 12, -20, 0);
  ctx.closePath();
}
function drawShadow(f) {
  ctx.save();
  if (f.h > 0.5) { ctx.translate(f.x + f.h * .15, f.y + 4); ctx.globalAlpha = Math.max(.08, .28 - f.h / 300); }
  else { ctx.translate(f.x + 1.5, f.y + 2.5); ctx.globalAlpha = .22; }
  const sy = Math.abs(f.fs !== undefined ? f.fs : Math.cos(f.flip)); // a tilted fish casts a narrower shadow
  ctx.rotate(f.rot); ctx.scale(.9, .8 * Math.max(.15, sy)); ctx.fillStyle = '#2a251e'; fishPath(); ctx.fill(); ctx.restore();
}
function drawFish(f) {
  ctx.save();
  ctx.translate(f.x, f.y - f.h * 0.75);
  ctx.rotate(f.rot);
  let sy = f.fs !== undefined ? f.fs : Math.cos(f.flip);
  const lift = .9 * (1 + f.h / 400);
  if (Math.abs(sy) < .12) sy = .12 * (sy < 0 ? -1 : 1); // edge-on: still a sliver of paper
  // Turning over about its long axis: the fish is squashed across its width by how far it has turned, and lit
  // less the more it is tilted away from the light above.
  ctx.scale(lift, lift * sy);
  fishPath();
  const lit = 0.8 + 0.2 * Math.abs(sy), back = sy < 0;
  ctx.fillStyle = shade(back ? [236, 230, 216] : [251, 248, 241], lit); ctx.fill();
  ctx.strokeStyle = '#6f695e'; ctx.lineWidth = 1.4 / Math.max(.35, Math.abs(sy)) ** .5; ctx.stroke();
  if (!back) {
    ctx.fillStyle = '#2b2823'; ctx.beginPath(); ctx.arc(-13, -2.5, 1.8, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8a8478'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(-8, 0, 6, -0.9, 0.9); ctx.stroke();
  } else if (f.pts) {
    // The points are written on the back, along the body: drawn on the paper itself, so they turn with the fish
    // and get squashed as it tilts. Seen from the back side the writing reads the right way round, so the mirror
    // of the flip is undone here.
    ctx.scale(1, -1);
    ctx.font = '800 10px "Baloo 2", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8e0e13'; ctx.globalAlpha = Math.min(1, Math.abs(sy) / 0.35); ctx.fillText(f.pts, -2, 1);
  }
  ctx.restore();
}
function shade(rgb, k) { return `rgb(${rgb.map(v => Math.round(v * k)).join(',')})`; }

function drawFan(x, y, ang, color, label, swing, alpha = .9, lift = 0) {
  const sw = Math.sin(performance.now() / 70) * 0.12 * swing; // a gentle waggle while moving
  if (lift > 0) { // raised: shadow on the ground + dashed ring where the slam will reach (solid at full height)
    const r = slamR(lift);
    ctx.save(); ctx.globalAlpha = alpha * (.2 + .1 * lift); ctx.fillStyle = '#2a251e';
    ctx.beginPath(); ctx.ellipse(x, y, 26 - 8 * lift, 20 - 6 * lift, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = alpha * (.4 + .4 * lift); ctx.strokeStyle = color; ctx.lineWidth = 2 + lift;
    if (lift < 1) ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.ellipse(x, y, r, r * .8, 0, 0, TAU); ctx.stroke(); ctx.restore();
  }
  // The end of the handle (where the hand holds it) stays on the ground; only the head rises and comes closer,
  // so the handle tilts up from the grip to the raised head.
  const a0 = ang + Math.PI / 2 + sw, k = 1 + .25 * lift;
  const gx = x - Math.sin(a0) * 62, gy = y + Math.cos(a0) * 62;   // grip: handle end when flat on the ground
  const hx = x, hy = y - lift * FAN_LIFT;                           // head centre
  const ux = gx - hx, uy = gy - hy, D = Math.hypot(ux, uy) || 1;
  // handle: a cane stick wrapped in pale rattan, with a little loop at the end
  const bx = hx + ux / D * 25 * k, by = hy + uy / D * 25 * k;
  ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round';
  ctx.strokeStyle = '#a8916a'; ctx.lineWidth = 6.5; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(gx, gy); ctx.stroke();
  ctx.strokeStyle = '#efe4cc'; ctx.lineWidth = 4.5; ctx.stroke();
  ctx.strokeStyle = 'rgba(150,126,88,.55)'; ctx.lineWidth = 4.5; ctx.lineCap = 'butt'; ctx.setLineDash([1, 2.2]); ctx.stroke(); // the wrapping
  ctx.setLineDash([]); ctx.strokeStyle = color; ctx.lineWidth = 4.5;           // a band in the player's colour
  ctx.beginPath(); ctx.moveTo(gx - ux / D * 9, gy - uy / D * 9); ctx.lineTo(gx - ux / D * 4, gy - uy / D * 4); ctx.stroke();
  ctx.strokeStyle = '#9c8a6c'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(gx + ux / D * 3, gy + uy / D * 3, 2.6, 0, TAU); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.translate(hx, hy); ctx.scale(k, k);
  if (label) {
    ctx.font = '600 12px "Be Vietnam Pro", sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(251,248,241,.9)'; ctx.strokeText(label, 0, -44);
    ctx.fillStyle = color; ctx.fillText(label, 0, -44);
  }
  ctx.rotate(Math.atan2(-ux, uy)); // head faces along the handle (equals a0 when flat); its base (+y) towards the grip
  ctx.globalAlpha = alpha;
  const sp = fanSprite();
  ctx.drawImage(sp, -FAN_SP.w / 2, -FAN_SP.h / 2, FAN_SP.w, FAN_SP.h);
  fanPath(); ctx.lineWidth = 1.7; ctx.strokeStyle = color; ctx.stroke(); // rim bound with the player's colour
  ctx.restore();
}

// The woven palm fan (quạt nan): a rounded leaf-shaped head, wider and fuller on one side, woven in a basket
// twill; a spine runs up from the handle through most of the head, and around the base the strips fan out
// in a sunburst. Drawn once into a sprite, local coords: head around (0,0), handle end at +y.
const FAN_SP = { w: 76, h: 72, res: 4 };
function fanPath(c = ctx) {
  c.beginPath(); c.moveTo(1, 27);
  c.bezierCurveTo(14, 24, 32, 13, 33, -5);
  c.bezierCurveTo(34, -22, 21, -32, 0, -32);
  c.bezierCurveTo(-21, -32, -35, -21, -34, -3);
  c.bezierCurveTo(-33, 14, -12, 24, 1, 27);
  c.closePath();
}
let fanSpr = null;
function fanSprite() {
  if (fanSpr) return fanSpr;
  const { w, h, res } = FAN_SP, c = document.createElement('canvas');
  c.width = w * res; c.height = h * res;
  const g = c.getContext('2d'); g.scale(res, res); g.translate(w / 2, h / 2);
  fanPath(g); g.fillStyle = '#ebdcbc'; g.fill();
  g.save(); fanPath(g); g.clip();
  // basket twill: strips crossing at 45°, each cell shows the strip that's on top, lit on one edge
  const cell = 3.2, hash = (i, j) => { const v = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return v - Math.floor(v); };
  g.save(); g.rotate(Math.PI / 4);
  for (let i = -16; i <= 16; i++) for (let j = -16; j <= 16; j++) {
    const x = i * cell, y = j * cell, across = ((i + (j >> 1)) & 1) === 0, t = hash(i, j) * 14 - 7;
    g.fillStyle = `rgb(${236 + t | 0},${222 + t | 0},${190 + t | 0})`; g.fillRect(x, y, cell, cell);
    g.fillStyle = 'rgba(120,96,60,.28)';
    if (across) g.fillRect(x, y + cell - .55, cell, .55); else g.fillRect(x + cell - .55, y, .55, cell);
    g.fillStyle = 'rgba(255,252,240,.5)';
    if (across) g.fillRect(x, y, cell, .45); else g.fillRect(x, y, .45, cell);
  }
  g.restore();
  // sunburst around the base: strips spreading out from where the handle goes in
  const ox = 1, oy = 24, R = 24;
  g.save(); g.beginPath(); g.moveTo(ox, oy); g.arc(ox, oy, R, Math.PI * 1.06, Math.PI * 1.94); g.closePath(); g.clip();
  g.fillStyle = '#efe3c6'; g.fill();
  for (let a = Math.PI * 1.06; a <= Math.PI * 1.94; a += 0.045) {
    g.strokeStyle = 'rgba(128,102,64,.38)'; g.lineWidth = .45;
    g.beginPath(); g.moveTo(ox + Math.cos(a) * 3, oy + Math.sin(a) * 3); g.lineTo(ox + Math.cos(a) * R, oy + Math.sin(a) * R); g.stroke();
  }
  for (const r of [9, 15, 21]) { // where the spread strips are woven across
    g.strokeStyle = 'rgba(128,102,64,.25)'; g.lineWidth = .5; g.setLineDash([1.2, 1.2]);
    g.beginPath(); g.arc(ox, oy, r, Math.PI * 1.06, Math.PI * 1.94); g.stroke();
  }
  g.setLineDash([]); g.restore();
  g.strokeStyle = 'rgba(128,102,64,.35)'; g.lineWidth = .6; g.beginPath(); g.arc(ox, oy, R, Math.PI * 1.06, Math.PI * 1.94); g.stroke();
  // the spine: a flat cane strip from the base up through most of the head, a little off centre
  g.lineCap = 'round'; g.strokeStyle = '#cdb88e'; g.lineWidth = 3.4;
  g.beginPath(); g.moveTo(ox, oy - 2); g.quadraticCurveTo(-2, 0, -7, -26); g.stroke();
  g.strokeStyle = '#f3e9d2'; g.lineWidth = 2; g.stroke();
  g.strokeStyle = 'rgba(128,102,64,.45)'; g.lineWidth = 3.4; g.lineCap = 'butt'; g.setLineDash([.5, 3.2]); g.stroke(); g.setLineDash([]);
  // knot of strips where the handle enters
  const kn = g.createRadialGradient(ox, oy, 0, ox, oy, 5); kn.addColorStop(0, '#d8c49c'); kn.addColorStop(1, 'rgba(216,196,156,0)');
  g.fillStyle = kn; g.beginPath(); g.arc(ox, oy, 5, 0, TAU); g.fill();
  // light: sun on the upper left, shade towards the lower right
  const lg = g.createLinearGradient(-30, -30, 30, 28); lg.addColorStop(0, 'rgba(255,253,245,.35)'); lg.addColorStop(.55, 'rgba(255,253,245,0)'); lg.addColorStop(1, 'rgba(90,70,40,.18)');
  g.fillStyle = lg; g.fillRect(-w / 2, -h / 2, w, h);
  g.restore();
  // bound edge: a rolled rim of strips
  fanPath(g); g.lineWidth = 2.6; g.strokeStyle = '#c9b48a'; g.stroke();
  fanPath(g); g.lineWidth = 1.2; g.strokeStyle = '#efe4cc'; g.setLineDash([1.6, 1]); g.stroke();
  return fanSpr = c;
}

const fanAnim = {};
// turn angle a towards b by fraction k, the short way round
function easeAng(a, b, k) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * k; }
function draw(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#8f897d'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(groundPx, Math.round(ox * dpr), Math.round(oy * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(ox, oy); ctx.scale(scale, scale);
  PLATE.x = R.plateX;
  const list = R.fish;
  for (const f of list) drawShadow(f);
  // Depth: the plate stands a little off the ground (its top about plateTop high). A fish under it, or behind it
  // (further up the screen) and lower than its top, is hidden by it: drawn first. A fish in front of it, even
  // touching its edge, or higher than its top, covers it: drawn after.
  const plateTop = cfg().rim > 0 ? 8 : 3;
  const caught = [], behind = [], front = [];
  for (const f of list) (f.caught ? (f.h > 1 ? front : caught) : f.h < plateTop && (bodyUnder(f) || f.y < PLATE.y) ? behind : front).push(f);
  const byHeight = (a, b) => a.h - b.h;
  behind.sort(byHeight).forEach(drawFish);
  drawPlate();
  caught.forEach(drawFish);
  front.sort(byHeight).forEach(drawFish);
  ctx.textAlign = 'center'; ctx.lineCap = 'round';
  for (const p of pops) {
    if (p.k === 'r') {
      const t = 1 - p.life / .45;
      const rr = 10 + Math.min(slamR(p.p), (.45 - p.life) * GUST.speed); // the gust's front, then it fades out
      ctx.globalAlpha = 1 - t; ctx.strokeStyle = COLORS[p.c % COLORS.length]; ctx.lineWidth = 4 + 3 * p.p;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rr, rr * .8, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.font = `800 ${p.b ? 20 : 24}px "Baloo 2", sans-serif`;
      ctx.lineWidth = 5; ctx.strokeStyle = p.b ? '#2b2823' : '#8e0e13'; ctx.fillStyle = p.b ? '#ffe2e2' : '#fbf8f1';
      ctx.strokeText(p.s, p.x, p.y); ctx.fillText(p.s, p.x, p.y); ctx.globalAlpha = 1;
    }
  }
  const banner = (big, small) => {
    ctx.font = '800 72px "Baloo 2", sans-serif'; ctx.lineWidth = 10; ctx.strokeStyle = '#2b2823'; ctx.fillStyle = '#fbf8f1';
    ctx.strokeText(big, LW / 2, LH / 2 + 20); ctx.fillText(big, LW / 2, LH / 2 + 20);
    ctx.font = '600 18px "Be Vietnam Pro", sans-serif'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(251,248,241,.9)'; ctx.fillStyle = '#2b2823';
    ctx.strokeText(small, LW / 2, LH / 2 + 56); ctx.fillText(small, LW / 2, LH / 2 + 56);
  };
  if (phase === 'count') banner(String(Math.max(1, Math.ceil(R.cd))), `Vòng ${R.round} · ${cfg().name}`);
  if (phase === 'over') banner('Hết giờ!', `Vòng ${R.round}: ${R.score} điểm trong đĩa`);
  if (phase === 'count' || phase === 'play') {
    const k = role === 'client' ? 1 : 1 - Math.exp(-18 * dt); // client fans are already interpolated
    for (const [slot, x, y, ang, live, ch] of R.fans) {
      if (slot === mySlot) continue;
      const s = fanAnim[slot] || (fanAnim[slot] = { x, y, a: ang });
      s.x += (x - s.x) * k; s.y += (y - s.y) * k; s.a = easeAng(s.a, ang, 1 - Math.exp(-12 * dt)); // angle comes in steps: ease it
      drawFan(s.x, s.y, s.a, COLORS[slot % COLORS.length], nameOf(slot), 0, live ? .9 : .4, ch || 0);
    }
    if (me.vis && mySlot >= 0) drawFan(me.x, me.y, me.ang, COLORS[mySlot % COLORS.length], '', me.swing, .9, chargeLv());
  }
}
