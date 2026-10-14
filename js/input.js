// ================= input =================
// mode: idle (fan follows the pointer, does nothing) | charge (held down: fan head rising; release = slam)
const me = { x: -999, y: -999, vx: 0, vy: 0, ang: -Math.PI / 2, tAng: -Math.PI / 2, vis: false, down: false, type: 'mouse', lastMove: 0, t: 0, downT: 0, downX: 0, downY: 0, swing: 0, mode: 'idle', chT: 0 };
function chargeLv() { return me.mode === 'charge' ? Math.min(1, (performance.now() - me.chT) / CHARGE_MS) : 0; }
cv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (mySlot < 0) return; // the host has no fan
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  const p = toWorld(e);
  Object.assign(me, p, { down: true, vis: true, type: e.pointerType, t: e.timeStamp, downT: e.timeStamp, downX: p.x, downY: p.y, vx: 0, vy: 0 });
  me.chT = performance.now(); me.mode = 'charge';
});
cv.addEventListener('pointermove', e => {
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of (evs.length ? evs : [e])) {
    const p = toWorld(ev);
    const dt = Math.max(0.004, Math.min(0.05, (ev.timeStamp - me.t) / 1000));
    const dx = p.x - me.x, dy = p.y - me.y, d = Math.hypot(dx, dy);
    if (me.vis && d > 0.5 && d < 300) {
      me.vx = me.vx * .5 + (dx / dt) * .5; me.vy = me.vy * .5 + (dy / dt) * .5;
      // the handle points along the smoothed movement, and only once it is a real move: a pixel's twitch or a
      // single coalesced step would make it jump. The drawn angle eases towards this each frame (main.js).
      if (Math.hypot(me.vx, me.vy) > 80) me.tAng = Math.atan2(me.vy, me.vx);
      me.swing = Math.min(1, me.swing + d / 60); me.lastMove = performance.now();
    }
    Object.assign(me, p, { t: ev.timeStamp, vis: true, type: e.pointerType });
  }
});
cv.addEventListener('pointerup', e => {
  if (!me.down) return;
  if (me.mode === 'charge') trySlap(me.x, me.y, chargeLv()); // slam where the fan is now; a quick tap is a small slam
  me.mode = 'idle'; me.down = false;
  if (e.pointerType !== 'mouse') me.vis = false;
});
cv.addEventListener('pointercancel', () => { me.mode = 'idle'; me.down = false; me.vis = false; });
cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') me.vis = false; });

function trySlap(x, y, lv) {
  if (phase !== 'play' || mySlot < 0) return;
  me.swing = 1;
  if (role === 'client') { if (hostConn && hostConn.open) hostConn.send({ k: 'sl', x: Math.round(x), y: Math.round(y), p: Math.round(lv * 100) / 100 }); addPop({ k: 'r', x, y, c: mySlot, p: lv }); }
  else doSlap(mySlot, x, y, lv);
}

function pumpLocalInput() {
  if (performance.now() - me.lastMove > 70) { me.vx = 0; me.vy = 0; }
  if (G && role !== 'client' && mySlot >= 0) {
    const i = inp(mySlot);
    i.x = me.vis ? me.x : -999; i.y = me.y; i.vx = me.vx; i.vy = me.vy; i.ch = chargeLv(); i.t = performance.now();
  }
}
let lastSent = '', lastSendT = 0, inSq = 0;
setInterval(() => {
  if (role !== 'client') return;
  if (performance.now() - me.lastMove > 70) { me.vx = 0; me.vy = 0; }
  if (!hostConn || !hostConn.open || (phase !== 'play' && phase !== 'count')) return;
  const m = { k: 'in', x: Math.round(me.vis ? me.x : -999), y: Math.round(me.y), vx: Math.round(me.vx), vy: Math.round(me.vy), ch: Math.round(chargeLv() * 20) / 20 };
  const s = JSON.stringify(m);
  const now = performance.now();
  if (s !== lastSent || now - lastSendT > 100) { m.sq = ++inSq; hostConn.send(m); lastSent = s; lastSendT = now; }
}, 20);
