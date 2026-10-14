// ================= host's room: several teams, each on its own field =================
// The host's tab runs every team's game. The sim, snapshot and lobby code (sim.js, sync.js, network.js) work on
// one team's globals (G, players, conns, phase, results...), so the tab keeps a copy of those per team and swaps
// the team's copy in around anything it does for that team (inTeam). Rounds are played by all teams together.
const room = { teams: [], first: 1, next: 1, live: 0, watch: null, open: false }; // live: round being played; open: board shown during it
let curTeam = null, roomSlot = 0;

function newTeam(no) {
  return { no, G: null, players: [], conns: new Map(), phase: 'lobby', results: [], lastPer: null, lastPts: null, lastPen: null,
    lastRound: 0, nextRound: room.next, R: freshR(), pops: [], out: false, el: null };
}
function saveCtx(t) {
  t.G = G; t.players = players; t.conns = conns; t.phase = phase; t.results = results; t.lastPer = lastPer; t.lastPts = lastPts;
  t.lastPen = lastPen; t.lastRound = lastRound; t.nextRound = nextRound; t.no = teamNo; t.R = R; t.pops = pops;
}
function loadCtx(t) {
  G = t.G; players = t.players; conns = t.conns; phase = t.phase; results = t.results; lastPer = t.lastPer; lastPts = t.lastPts;
  lastPen = t.lastPen; lastRound = t.lastRound; nextRound = t.nextRound; teamNo = t.no; R = t.R; pops = t.pops;
  setPlate(G ? G.round : R.round); PLATE.x = G ? G.plateX : R.plateX;
}
function inTeam(t, fn) {
  if (curTeam === t) return fn();
  const outer = {}, prev = curTeam; saveCtx(outer);
  loadCtx(t); curTeam = t;
  try { return fn(); } finally { saveCtx(t); loadCtx(outer); curTeam = prev; }
}
const isLive = t => t.phase === 'count' || t.phase === 'play' || t.phase === 'over';
const inGame = t => !t.out && t.players.length > 0; // plays the next round
const teamReady = t => t.players.length > 0 && t.players.every(p => p.ready);
function watched() { const w = room.watch; return w && room.teams.includes(w) && isLive(w) ? w : null; }
function watch(t) { room.watch = t; for (const k in fanAnim) delete fanAnim[k]; hostDirty(); }
const eachTeam = fn => room.teams.forEach(t => inTeam(t, fn));

// ---- a room that was open in this browser a little while ago comes back after a reload: same code, same scores
const ROOM_KEY = 'quatca-room', ROOM_TTL = 6 * 3600e3;
function saveRoom() {
  try {
    localStorage.setItem(ROOM_KEY, JSON.stringify({ at: Date.now(), code: roomCode, slot: roomSlot, first: room.first, next: room.next,
      teams: room.teams.map(t => ({ res: [0, 1, 2].map(i => t.results[i] != null ? t.results[i] : null), out: t.out, lr: t.lastRound })) }));
  } catch (e) {}
}
function loadRoom() {
  try {
    const s = JSON.parse(localStorage.getItem(ROOM_KEY));
    if (s && Date.now() - s.at < ROOM_TTL && /^[A-Z]{4}$/.test(s.code) && Array.isArray(s.teams)) return s;
  } catch (e) {}
  return null;
}
function setupRoom(saved) {
  room.first = Math.min(TEAM_NO_MAX, Math.max(1, saved ? saved.first | 0 || 1 : 1));
  room.next = Math.min(3, Math.max(1, saved ? saved.next | 0 || 1 : 1));
  const st = saved ? saved.teams.slice(0, Math.min(MAX_TEAMS, TEAM_NO_MAX - room.first + 1)) : Array.from({ length: DEFAULT_TEAMS }, () => ({}));
  room.teams = (st.length ? st : [{}]).map((s, i) => {
    const t = newTeam(room.first + i);
    if (Array.isArray(s.res)) t.results = s.res.map(x => x == null ? undefined : +x || 0);
    t.out = !!s.out; t.lastRound = Math.min(3, Math.max(0, s.lr | 0));
    return t;
  });
  room.live = 0; room.watch = null; room.open = false;
  phase = 'board'; saveRoom(); hostDirty();
}
function resetRoom() {
  for (const t of room.teams) if (t.el) t.el.remove();
  room.teams = []; room.live = 0; room.watch = null; room.open = false; curTeam = null; lastTm = '';
}

// ---- what the host does
function setTeams(n, first) {
  if (room.live) return;
  first = Math.min(TEAM_NO_MAX, Math.max(1, first | 0));
  n = Math.min(MAX_TEAMS, TEAM_NO_MAX - first + 1, Math.max(1, n | 0)); // no team past Đội 10
  while (room.teams.length > n) {
    const t = room.teams.pop();
    for (const c of [...t.conns.values()]) toPick(c.conn, `Host đã bỏ bớt Đội ${t.no}. Chọn lại đội nhé.`);
    if (t.el) t.el.remove();
  }
  while (room.teams.length < n) room.teams.push(newTeam(0));
  room.first = first;
  room.teams.forEach((t, i) => { if (t.no !== first + i) { t.no = first + i; inTeam(t, () => broadcast(lobbyMsg())); } });
  saveRoom(); hostDirty();
}
function setRound(r) {
  if (room.live) return;
  room.next = Math.min(3, Math.max(1, r | 0));
  eachTeam(() => { nextRound = room.next; G = null; if (phase === 'final') phase = 'lobby'; unready(); broadcast(lobbyMsg()); });
  saveRoom(); hostDirty();
}
// the round's fish / time / plate, or the player limit: everyone looks again and says they're ready
function setSetting(key, v) {
  if (room.live) return;
  if (key === 'max') settings.maxPlayers = v; else settings.rounds[room.next][key] = v;
  settings = cleanSettings(settings);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  eachTeam(() => { if (key !== 'max') unready(); broadcast(lobbyMsg()); });
  hostDirty();
}
function startAll() {
  const go = room.teams.filter(t => inGame(t) && t.phase === 'lobby');
  if (room.live || !go.length) return;
  for (const t of go) inTeam(t, () => { nextRound = room.next; unready(); newRound(nextRound); broadcast(lobbyMsg()); broadcast(snapshot()); });
  room.live = room.next; room.open = false;
  watch(go.includes(room.watch) ? room.watch : go[0]);
}
// Once the host has started the game, players stay in their team until the host starts over (againAll).
function gameOn() { return !!room.live || room.teams.some(t => t.lastRound > 0); }
// every team's round is over: on to the next round (the host sends teams out before starting it)
function roundOver() {
  const r = room.live; room.live = 0; room.open = false;
  room.next = Math.min(3, r + 1);
  eachTeam(() => { if (phase === 'lobby') { nextRound = room.next; broadcast(lobbyMsg()); } });
  saveRoom();
}
function kickTeam(t) {
  if (isLive(t)) return;
  t.out = true;
  for (const c of [...t.conns.values()]) {
    const conn = c.conn;
    try { conn.send({ k: 'kick', why: `Đội ${t.no} dừng ở đây. Cảm ơn cả đội đã chơi!` }); } catch (e) {}
    dropConn(conn);
    setTimeout(() => { try { conn.close(); } catch (e) {} }, 300); // let the message get there first
  }
  saveRoom(); hostDirty();
}
function againAll() {
  if (room.live) return;
  room.next = 1;
  room.teams.forEach(t => { t.out = false; });
  eachTeam(() => { resetGame(); G = null; phase = 'lobby'; unready(); broadcast(lobbyMsg()); });
  saveRoom(); hostDirty();
}

// ---- the board
let hostTimer = 0;
function hostDirty() { if (role === 'host' && !hostTimer) hostTimer = setTimeout(renderHost, 0); }
setInterval(() => { if (role === 'host' && room.live) hostDirty(); }, 500); // time left / scores while a round is on
function renderHost() {
  hostTimer = 0;
  if (role !== 'host' || phase === 'home') return;
  if (curTeam) { hostDirty(); return; }
  if (room.live && !room.teams.some(isLive)) roundOver();
  pushTeams();
  let w = watched();
  if (room.live && !w) { w = room.teams.find(isLive) || null; if (w) watch(w); }
  ['home', 'lobby', 'endScreen', 'pick'].forEach(x => $(x).hidden = true);
  $('board').hidden = !!room.live && !room.open;
  $('hud').hidden = !(w && $('board').hidden);
  document.body.classList.add('gm');
  if (w) inTeam(w, () => { drawChips(); updateHud(); });
  renderWatchBar(w);
  fillBoard();
}
function renderWatchBar(w) {
  const bar = $('watchBar'); bar.hidden = !room.live; bar.textContent = '';
  if (!room.live) return;
  for (const t of room.teams) if (isLive(t)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'wtab' + (t === w && !room.open ? ' on' : '');
    b.textContent = `Đội ${t.no} · ${t.G.score}`;
    b.addEventListener('click', () => { room.open = false; watch(t); });
    bar.appendChild(b);
  }
  const b = document.createElement('button'); b.type = 'button'; b.className = 'wtab dark';
  b.textContent = room.open ? 'Xem sân' : 'Bảng host';
  b.addEventListener('click', () => { room.open = !room.open; hostDirty(); });
  bar.appendChild(b);
}
function opt(sel, v, t) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
function buildBoard() {
  for (let n = 1; n <= MAX_TEAMS; n++) opt($('bdTeams'), n, n + ' đội');
  for (let n = 1; n <= TEAM_NO_MAX; n++) opt($('bdFirst'), n, 'Đội ' + n);
  for (let n = 1; n <= MAX_PLAYERS; n++) opt($('bdMax'), n, n + ' người');
  for (let r = 1; r <= 3; r++) opt($('bdRound'), r, '');
  for (const [k, label] of PLATE_OPTS) opt($('bdPlate'), k, label);
  Object.assign($('bdFish'), { min: FISH_MIN, max: FISH_MAX, step: FISH_STEP });
  $('bdTeams').addEventListener('change', () => setTeams(+$('bdTeams').value, room.first));
  $('bdFirst').addEventListener('change', () => setTeams(room.teams.length, +$('bdFirst').value));
  $('bdMax').addEventListener('change', () => setSetting('max', +$('bdMax').value));
  $('bdRound').addEventListener('change', () => setRound(+$('bdRound').value));
  for (const key of ['fish', 'plate']) {
    const el = $('bd' + key[0].toUpperCase() + key.slice(1));
    el.addEventListener('change', () => { setSetting(key, +el.value); el.value = roundSet(room.next)[key]; }); // fish count rounded to a multiple of 10
  }
  bindTime('bdTime', s => { setSetting('time', s); showTime('bdTime', roundSet(room.next).time, undefined, true); }); // kept within TIME_MIN..TIME_MAX
  // starting while some players haven't said they're ready takes a second click
  let armed = null;
  $('bdStart').addEventListener('click', () => {
    const go = room.teams.filter(t => inGame(t) && t.phase === 'lobby');
    if (!go.every(teamReady) && !armed) { armed = setTimeout(() => { armed = null; hostDirty(); }, 3000); hostDirty(); return; }
    clearTimeout(armed); armed = null; startAll();
  });
  $('bdStart').armed = () => !!armed;
  twoClicks($('bdAgain'), 'Bấm lần nữa để xoá điểm mọi đội', againAll);
  twoClicks($('bdClose'), 'Bấm lần nữa để đóng phòng', () => { try { localStorage.removeItem(ROOM_KEY); } catch (e) {} backHome(); });
  $('bdCopy').addEventListener('click', () => {
    const ok = () => $('bdCopy').textContent = 'Đã sao chép';
    const fallback = () => { $('bdLink').select(); $('bdCopy').textContent = 'Đã chọn, nhấn Ctrl+C'; };
    try { navigator.clipboard.writeText($('bdLink').value).then(ok, fallback); } catch (e) { fallback(); }
    setTimeout(() => { $('bdCopy').textContent = 'Sao chép link'; }, 2000);
  });
}
// a button that does something hard to undo: the first click only asks
function twoClicks(b, ask, fn) {
  const label = b.textContent; let armed = null;
  b.addEventListener('click', () => {
    if (!armed) { b.textContent = ask; armed = setTimeout(() => { armed = null; b.textContent = label; }, 3000); return; }
    clearTimeout(armed); armed = null; b.textContent = label; fn();
  });
}
function roomLink() { return location.origin + location.pathname + '?phong=' + roomCode; }
function fillBoard() {
  const live = !!room.live, S = roundSet(room.next);
  $('bdCode').textContent = roomCode || '----';
  $('bdLink').value = roomLink();
  for (const [id, v] of [['bdTeams', room.teams.length], ['bdFirst', room.first], ['bdMax', settings.maxPlayers], ['bdRound', room.next],
    ['bdFish', S.fish], ['bdPlate', S.plate]]) {
    const el = $(id); el.disabled = live; if (document.activeElement !== el) el.value = v;
  }
  showTime('bdTime', S.time, live);
  [...$('bdTeams').options].forEach(o => { o.disabled = room.first + +o.value - 1 > TEAM_NO_MAX; });
  const last = room.teams.length - 1;
  $('bdTeamsHint').textContent = room.teams.length ? `Phòng này: Đội ${room.first}${last ? '–' + (room.first + last) : ''}` : '';
  [...$('bdRound').options].forEach((o, i) => { o.textContent = `Vòng ${i + 1}`; });
  $('bdSetLbl').textContent = `Cài đặt vòng ${room.next}`;
  // start
  const go = room.teams.filter(t => inGame(t) && t.phase === 'lobby'), waiting = go.filter(t => !teamReady(t));
  $('bdStart').hidden = live;
  $('bdStart').disabled = !go.length;
  $('bdStart').textContent = $('bdStart').armed() ? 'Còn người chưa sẵn sàng. Bấm lần nữa để bắt đầu luôn'
    : `Bắt đầu vòng ${room.next} · ${go.length} đội`;
  $('bdNote').textContent = live ? `Đang chơi vòng ${room.live}. Bấm tên đội ở dưới màn hình để xem sân của đội đó.`
    : !go.length ? 'Chờ người chơi vào phòng và chọn đội.'
    : waiting.length ? 'Chưa sẵn sàng: ' + waiting.map(t => `Đội ${t.no} (${t.players.filter(p => p.ready).length}/${t.players.length})`).join(', ') + '.'
    : 'Mọi đội đã sẵn sàng.';
  // scores, best first for the round being played (or the last one played)
  const fr = room.live || Math.max(0, ...room.teams.map(t => t.lastRound));
  const now = t => isLive(t) && t.G ? t.G.score : fr ? t.results[fr - 1] : null;
  const total = t => t.results.reduce((a, b) => a + (b || 0), 0);
  $('bdFocus').textContent = fr ? `Xếp theo vòng ${fr}` : '';
  const tb = $('bdScores'); tb.textContent = '';
  room.teams.slice().sort((a, b) => (a.out - b.out) || ((now(b) ?? -1e9) - (now(a) ?? -1e9)) || total(b) - total(a) || a.no - b.no).forEach((t, i) => {
    const tr = document.createElement('tr'); if (t.out) tr.className = 'off';
    for (const v of [i + 1, `Đội ${t.no}`, t.players.length, teamState(t), ...[0, 1, 2].map(r => isLive(t) && t.G.round === r + 1 ? t.G.score + '…' : t.results[r] == null ? '–' : t.results[r]), total(t)]) {
      const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  // one card per team
  const box = $('bdTeamBox');
  for (const t of room.teams) { if (!t.el) buildTeamCard(t); fillTeamCard(t); box.appendChild(t.el); }
}
function teamState(t) {
  if (t.out) return 'Đã dừng';
  if (isLive(t)) return t.phase === 'count' ? 'Sắp bắt đầu' : t.phase === 'over' ? 'Hết giờ' : `Còn ${fmtTime(t.G.timeLeft)}`;
  if (!t.players.length) return 'Chưa có ai';
  if (t.phase === 'final') return 'Xong 3 vòng';
  return `${t.players.filter(p => p.ready).length}/${t.players.length} sẵn sàng`;
}
function buildTeamCard(t) {
  const el = t.el = document.createElement('div'); el.className = 'room';
  el.innerHTML = `<div class="rhead"><h3 class="rteam"></h3><span class="rstate"></span></div>
    <ul class="players rplayers"></ul>
    <div class="row rbtns"><button class="ghost rwatch" type="button">Xem sân</button><button class="link rout" type="button"></button></div>`;
  const q = s => el.querySelector(s);
  q('.rwatch').addEventListener('click', () => { room.open = false; watch(t); });
  let armed = null;
  q('.rout').addEventListener('click', () => {
    if (t.out) { t.out = false; saveRoom(); hostDirty(); return; }
    if (!t.players.length) { kickTeam(t); return; }
    if (!armed) { q('.rout').textContent = `Bấm lần nữa để kick cả Đội ${t.no}`; armed = setTimeout(() => { armed = null; hostDirty(); }, 3000); return; }
    clearTimeout(armed); armed = null; kickTeam(t);
  });
  q('.rout').armed = () => !!armed;
}
function fillTeamCard(t) {
  const el = t.el, q = s => el.querySelector(s), between = !room.live && !isLive(t);
  el.classList.toggle('off', t.out);
  q('.rteam').textContent = `Đội ${t.no}`;
  q('.rstate').textContent = teamState(t);
  const ul = q('.rplayers'); ul.textContent = '';
  for (const p of t.players) {
    const lobby = t.phase === 'lobby', li = dotLi(p.slot, p.name, lobby ? (p.ready ? 'sẵn sàng ✓' : 'chưa sẵn sàng') : '');
    if (lobby && p.ready) li.querySelector('em').className = 'ok';
    if (between) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'kick'; b.textContent = 'Kick';
      b.addEventListener('click', () => inTeam(t, () => kickPlayer(p.slot)));
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
  if (!t.players.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = t.out ? 'Đội đã dừng chơi' : 'Chưa có ai chọn đội này'; ul.appendChild(li); }
  q('.rwatch').hidden = !isLive(t);
  q('.rout').hidden = !between;
  if (!q('.rout').armed()) q('.rout').textContent = t.out ? 'Cho đội chơi tiếp' : 'Kick cả đội (bị loại)';
}
