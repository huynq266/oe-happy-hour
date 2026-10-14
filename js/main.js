// ================= loops =================
// A tab that isn't focused gets its timers slowed to about once a second (or less). A worker's timers aren't, so the
// sim and the snapshots to teammates are driven from one; plain setInterval is the fallback.
function every(ms, fn) {
  const fallback = () => setInterval(fn, ms);
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = fn;
    w.onerror = e => { e.preventDefault(); w.terminate(); fallback(); };
  } catch (e) { fallback(); }
}
// Step the sim by all the real time that has passed, in small steps, so the countdown keeps real time even when
// the ticks come late.
const SIM_DT = 1 / 60, MAX_CATCHUP = 120;
let lastSim = performance.now();
const simming = () => (role === 'host' || role === 'solo') && G && (phase === 'count' || phase === 'play' || phase === 'over');
every(16, () => {
  const now = performance.now(); let left = Math.min(MAX_CATCHUP, (now - lastSim) / 1000); lastSim = now;
  if (!simming()) return;
  pumpLocalInput();
  while (left > 1e-6 && simming()) { const dt = Math.min(SIM_DT, left); step(dt); left -= dt; }
});
// Snapshots to the players: 30 a second, or 20 with more than 5 players so the host's upload (one copy per
// player, ~2.5KB each) stays modest; each player's screen interpolates between them either way.
let snapN = 0, lastSnapT = 0;
every(10, () => {
  if (!(role === 'host' && G && (phase === 'count' || phase === 'play' || phase === 'over'))) return;
  const now = performance.now(), gap = players.length > 5 ? 50 : 33;
  if (now - lastSnapT < gap - 3) return;
  lastSnapT = now;
  broadcast(snapshot(++snapN % Math.round(500 / gap) !== 0)); // a full one about every 0.5s
});
let lastFrame = performance.now();
let fpsN = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - lastFrame) / 1000); lastFrame = t; fpsN++;
  interpClient(dt);
  for (const p of pops) { if (p.k === 't') p.y -= 40 * dt; p.life -= dt; }
  pops = pops.filter(p => p.life > 0);
  me.swing *= Math.exp(-6 * dt);
  me.ang = easeAng(me.ang, me.tAng, 1 - Math.exp(-14 * dt));
  draw(dt);
  if (phase === 'count' || phase === 'play') updateHud();
  requestAnimationFrame(frame);
}

// ================= buttons =================
for (let i = 1; i <= 10; i++) { const o = document.createElement('option'); o.value = i; o.textContent = 'Đội ' + i; $('teamSel').appendChild(o); }
buildSettings();
// the host's / solo player's own settings from last time (a player gets the host's from the lobby messages)
function loadSettings() { try { settings = cleanSettings(JSON.parse(localStorage.getItem('quatca-settings'))); } catch (e) { settings = cleanSettings(null); } }
try { const n = localStorage.getItem('quatca-name'); if (n) $('name').value = n; const t = +localStorage.getItem('quatca-team'); if (t) teamNo = t; } catch (e) {}
$('teamSel').addEventListener('change', () => { teamNo = +$('teamSel').value; try { localStorage.setItem('quatca-team', teamNo); } catch (e) {} broadcast(lobbyMsg()); renderLobby(); });
$('roundSel').addEventListener('change', () => { if (role === 'client') return; nextRound = Math.min(3, Math.max(1, +$('roundSel').value | 0)); unready(); broadcast(lobbyMsg()); renderLobby(); });
$('readyBtn').addEventListener('click', () => {
  const p = players.find(p => p.slot === mySlot);
  if (role !== 'client' || !p || !hostConn || !hostConn.open) return;
  p.ready = !p.ready; renderLobby(); // shown right away; the host's lobby message confirms it
  hostConn.send({ k: 'rd', v: p.ready });
});
$('pickBtn').addEventListener('click', () => { if (role === 'client') return; G = null; phase = 'lobby'; broadcast(lobbyMsg()); onPhase(); });
$('hostBtn').addEventListener('click', hostRoom);
$('joinBtn').addEventListener('click', joinRoom);
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('soloBtn').addEventListener('click', () => {
  const name = getName(); if (!name) return;
  myName = name; hostName = ''; role = 'solo'; mySlot = 0; players = [{ slot: 0, name }]; resetGame(); loadSettings();
  phase = 'lobby'; onPhase();
});
$('startBtn').addEventListener('click', startRound);
$('againBtn').addEventListener('click', () => {
  if (role === 'client') return;
  resetGame(); G = null; phase = 'lobby'; broadcast(lobbyMsg()); onPhase();
});
$('copyBtn').addEventListener('click', () => {
  const t = $('resultText').value;
  const ok = () => $('copyBtn').textContent = 'Đã sao chép';
  const fallback = () => { $('resultText').select(); $('copyBtn').textContent = 'Đã chọn, nhấn Ctrl+C'; };
  try { navigator.clipboard.writeText(t).then(ok, fallback); } catch (e) { fallback(); }
});
addEventListener('resize', resize);
function toggleFs() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  } catch (e) {}
}
$('fsBtn').addEventListener('click', toggleFs);
addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !(e.target instanceof HTMLInputElement)) toggleFs(); });
// network stats line: press N, or open the page with #net in the URL (phones)
let netOn = /net/.test(location.hash);
addEventListener('keydown', e => { if ((e.key === 'n' || e.key === 'N') && !(e.target instanceof HTMLInputElement)) netOn = !netOn; });
addEventListener('hashchange', () => { netOn = /net/.test(location.hash); });
async function readConnType() {
  try {
    const st = await hostConn.peerConnection.getStats(); let pair = null;
    st.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId); });
    if (!pair) st.forEach(r => { if (r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded'))) pair = r; });
    const l = pair && st.get(pair.localCandidateId), r = pair && st.get(pair.remoteCandidateId);
    connType = !l ? '' : (l.candidateType === 'relay' || (r && r.candidateType === 'relay')) ? 'đi vòng qua máy chủ relay' : 'kết nối thẳng';
  } catch (e) { connType = ''; }
}
setInterval(() => {
  const el = $('netStats'), show = netOn && (phase === 'count' || phase === 'play' || phase === 'over' || phase === 'lobby');
  el.hidden = !show;
  if (show) {
    if (role === 'client' && hostConn && hostConn.open) { hostConn.send({ k: 'pi', t: performance.now() }); readConnType(); }
    const res = `${cv.width}×${cv.height}`;
    el.textContent = role === 'client'
      ? `${fpsN} hình/s · ${res} · ping ${Math.round(rtt)}ms · ${snapRx} gói/s · trễ hình ${Math.round(renderDelay)}ms · thiếu gói ${frames ? Math.round(100 * starve / frames) : 0}%${connType ? ' · ' + connType : ''}`
      : `${fpsN} hình/s · ${res} · ${conns.size} thành viên`;
  }
  fpsN = 0; snapRx = 0; frames = 0; starve = 0;
}, 1000);
document.addEventListener('fullscreenchange', () => { $('fsBtn').textContent = document.fullscreenElement ? 'Thoát toàn màn hình' : 'Toàn màn hình'; });
addEventListener('beforeunload', () => { try { if (peer) peer.destroy(); } catch (e) {} });

function preview() { // field shown behind the cards
  const saved = players; players = [{ slot: 0, name: '' }];
  newRound(1); R.fish = G.fish; R.round = 1; R.plateX = LW / 2; G = null; players = saved; phase = 'home';
}
preview(); buildGround(); resize(); requestAnimationFrame(frame);
window.__qc = { get G() { return G; }, get phase() { return phase; }, get results() { return results; },
  doSlap: (s, x, y, lv) => doSlap(s, x, y, lv), setPlayers: p => { players = p; } };
