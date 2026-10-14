// ================= networking: host (quản trò) =================
// A player whose link has fallen behind (data still queued to them) skips game snapshots until it catches up,
// rather than piling up more and more lag; a full snapshot every ~0.5s puts them right again.
const SEND_BACKLOG = 64 * 1024;
function broadcast(m) { // to the team in context (room.js inTeam)
  for (const c of conns.values()) if (c.conn.open) {
    if (m.k === 's' && c.conn.dataChannel && c.conn.dataChannel.bufferedAmount > SEND_BACKLOG) continue;
    try { c.conn.send(m); } catch (e) {}
  }
}
function lobbyMsg() { return { k: 'l', sq: ++netSq, ph: phase, players, host: hostName, set: settings, team: teamNo, next: nextRound, lr: lastRound, res: results.map(x => x || 0), last: lastPer, lastPts, pen: lastPen }; }
function makeCode() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }

// The quản trò's tab holds two ids: the room's (PREFIX + code), which players connect to, and one of MAX_ROOMS
// slot ids, which only says "a room is open". No free slot: no new room.
let slotPeer = null;
const pend = new Map();   // peerId -> conn: connected, still choosing a team
const where = new Map();  // peerId -> the team the player is in
function hostRoom() {
  homeErr('');
  if (!window.Peer) { homeErr('Không tải được phần kết nối mạng. Kiểm tra Internet rồi tải lại trang, hoặc bấm "Chơi thử một mình".'); return; }
  const name = getName(); if (!name) return;
  myName = name; hostName = name; role = 'host'; mySlot = -1; players = []; resetGame(); loadSettings(); // the host only runs the room
  $('hostBtn').disabled = true; homeErr('Đang mở phòng...');
  const saved = loadRoom(), order = [];
  if (saved && saved.slot >= 1 && saved.slot <= MAX_ROOMS) order.push(saved.slot); // a reloaded tab gets its own slot back
  for (let n = 1; n <= MAX_ROOMS; n++) if (!order.includes(n)) order.push(n);
  takeSlot(order, saved);
}
// all slots taken: try again a few times, since a closed tab's id takes a few seconds to be let go
function takeSlot(order, saved, i = 0, tries = 0) {
  if (role !== 'host' || phase !== 'home') return;
  if (i >= order.length) {
    if (tries < 3) { setTimeout(() => takeSlot(order, saved, 0, tries + 1), 2500); return; }
    backHome(`Đã đủ ${MAX_ROOMS} phòng chơi. Nhập mã phòng quản trò gửi để vào chơi.`); countRooms(); return;
  }
  const n = order[i], p = new Peer(SLOT_PREFIX + n, { debug: 0 });
  let mine = false;
  p.on('open', () => {
    if (role !== 'host' || phase !== 'home') { try { p.destroy(); } catch (e) {} return; }
    mine = true; slotPeer = p; roomSlot = n; openRoom(saved ? saved.code : makeCode(), saved);
  });
  p.on('error', err => {
    if (mine) return;
    try { p.destroy(); } catch (e) {}
    if (err.type === 'unavailable-id') takeSlot(order, saved, i + 1, tries);
    else if (role === 'host' && phase === 'home') backHome('Không mở được phòng (' + err.type + '). Thử lại sau vài giây.');
  });
  p.on('disconnected', () => { if (mine) try { p.reconnect(); } catch (e) {} });
  p.on('connection', c => c.on('open', () => setTimeout(() => { try { c.close(); } catch (e) {} }, 500))); // a home screen counting rooms
}
function openRoom(code, saved, tries = 0) {
  if (role !== 'host' || phase !== 'home') return;
  peer = new Peer(PREFIX + code, { debug: 0 });
  peer.on('open', () => { roomCode = code; homeErr(''); setupRoom(saved && saved.code === code ? saved : null); });
  peer.on('error', err => {
    if (err.type === 'unavailable-id' && phase === 'home') {
      // the same code as before a reload: its old link takes a moment to go. Try a few times, then take a new one.
      try { peer.destroy(); } catch (e) {} peer = null;
      if (tries < 3) setTimeout(() => openRoom(code, saved, tries + 1), 2000); else openRoom(makeCode(), null);
      return;
    }
    if (phase === 'home') backHome('Không mở được phòng (' + err.type + '). Thử lại sau vài giây.');
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
  peer.on('connection', conn => {
    conn.on('data', d => onHostData(conn, d));
    conn.on('close', () => dropConn(conn));
    conn.on('error', () => dropConn(conn));
  });
}
// home: how many rooms are open (each one's slot id answers). All of them: no "Mở phòng" button.
function countRooms() {
  if (!window.Peer || linkCode) return;
  let p; try { p = new Peer({ debug: 0 }); } catch (e) { return; }
  const taken = new Set(); let left = MAX_ROOMS, done = false;
  const finish = () => {
    if (done) return; done = true; try { p.destroy(); } catch (e) {}
    const full = taken.size >= MAX_ROOMS;
    $('hostBtn').hidden = full; $('hostNote').hidden = !full;
  };
  setTimeout(finish, 6000);
  p.on('open', () => {
    for (let n = 1; n <= MAX_ROOMS; n++) {
      const c = p.connect(SLOT_PREFIX + n, { serialization: 'json' });
      c.on('open', () => { taken.add(n); if (--left === 0) finish(); });
    }
  });
  p.on('error', err => { if (err.type === 'peer-unavailable') { if (--left === 0) finish(); } else finish(); });
}

// the teams, for players still choosing one
let lastTm = '';
function teamsMsg() {
  return { k: 'tm', code: roomCode, host: hostName, max: settings.maxPlayers,
    teams: room.teams.map((t, i) => ({ i, no: t.no, n: t.players.length, out: t.out, ph: t.phase })) };
}
function sendTeams(conn) { try { conn.send(teamsMsg()); } catch (e) {} }
function pushTeams() {
  const s = JSON.stringify(teamsMsg()); if (s === lastTm) return; lastTm = s;
  for (const c of pend.values()) sendTeams(c);
}
function onHostData(conn, d) {
  if (!d || typeof d !== 'object') return;
  if (d.k === 'pi') { try { conn.send({ k: 'po', t: d.t }); } catch (e) {} return; }
  if (d.k === 'q') { if (!where.has(conn.peer)) { pend.set(conn.peer, conn); sendTeams(conn); } return; }
  if (d.k === 'hi') { joinTeam(conn, d); return; }
  const t = where.get(conn.peer); if (!t) return;
  if (d.k === 'sw') { if (t.phase === 'lobby' || t.phase === 'final') toPick(conn, ''); return; } // picked the wrong team
  inTeam(t, () => onTeamData(conn, d));
}
function joinTeam(conn, d) {
  if (where.has(conn.peer)) return;
  const t = room.teams[d.team | 0], name = String(d.name || 'Bạn').slice(0, 16);
  const no = why => { try { conn.send({ k: 'no', why, pick: 1 }); } catch (e) {} pend.set(conn.peer, conn); sendTeams(conn); };
  if (!t) return no('Không còn đội này. Chọn lại nhé.');
  if (t.out) return no(`Đội ${t.no} đã dừng chơi.`);
  if (t.phase !== 'lobby') return no(`Đội ${t.no} đang chơi dở một vòng. Chờ hết vòng rồi chọn lại.`);
  inTeam(t, () => {
    const used = new Set(players.map(p => p.slot));
    let slot = -1; for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s)) { slot = s; break; }
    if (slot < 0 || players.length >= settings.maxPlayers) return no(`Đội ${t.no} đã đủ ${settings.maxPlayers} người.`);
    pend.delete(conn.peer); where.set(conn.peer, t);
    conns.set(conn.peer, { conn, slot, name });
    players.push({ slot, name, ready: false }); players.sort((a, b) => a.slot - b.slot);
    conn.send({ k: 'w', slot, l: lobbyMsg() }); // with the team's lobby, so the player never shows an old one
    broadcast(lobbyMsg());
  });
  hostDirty();
}
function onTeamData(conn, d) { // in the player's team's context
  if (d.k === 'rd') { // a player says they're (not) ready for the next round
    const c = conns.get(conn.peer), p = c && players.find(p => p.slot === c.slot);
    if (p && phase === 'lobby') { p.ready = !!d.v; broadcast(lobbyMsg()); hostDirty(); }
    return;
  }
  const c = conns.get(conn.peer); if (!c || !G) return;
  if (d.k === 'in') {
    if (d.sq !== undefined) { if (d.sq <= (c.inSq || 0)) return; c.inSq = d.sq; } // late packet: newer input already applied
    const i = inp(c.slot);
    i.x = num(d.x, -999, LW + 50); i.y = num(d.y, -50, LH + 50); i.vx = num(d.vx, -5000, 5000); i.vy = num(d.vy, -5000, 5000); i.ch = num(d.ch, 0, 1); i.t = performance.now();
  } else if (d.k === 'sl') {
    doSlap(c.slot, num(d.x, 0, LW), num(d.y, 0, LH), num(d.p, 0, 1));
  }
}
function leaveTeam(t, id) {
  inTeam(t, () => {
    const c = conns.get(id); if (!c) return;
    conns.delete(id);
    players = players.filter(p => p.slot !== c.slot);
    if (G) delete G.inputs[c.slot];
    broadcast(lobbyMsg());
  });
  hostDirty();
}
function dropConn(conn) {
  pend.delete(conn.peer);
  const t = where.get(conn.peer); if (!t) return;
  where.delete(conn.peer); leaveTeam(t, conn.peer);
}
// back to choosing a team, still connected
function toPick(conn, why) {
  const t = where.get(conn.peer); if (!t) return;
  where.delete(conn.peer); leaveTeam(t, conn.peer);
  pend.set(conn.peer, conn);
  try { conn.send({ k: 'pk', why }); } catch (e) {}
  sendTeams(conn);
}
// host: send a player out of the room (between rounds), in their team's context
function kickPlayer(slot) {
  for (const c of [...conns.values()]) if (c.slot === slot) {
    try { c.conn.send({ k: 'kick' }); } catch (e) {}
    const conn = c.conn; dropConn(conn);
    setTimeout(() => { try { conn.close(); } catch (e) {} }, 300); // let the message get there first
  }
}
function startRound() { // solo
  if (role !== 'solo') return;
  unready();
  newRound(nextRound);
  onPhase();
}

// ================= networking: client =================
let teamList = [], teamMax = MAX_PLAYERS, pickHost = '', pickWait = false;
function joinRoom() {
  homeErr('');
  if (!window.Peer) { homeErr('Không tải được phần kết nối mạng. Kiểm tra Internet rồi tải lại trang.'); return; }
  const name = getName(); if (!name) return;
  const code = $('codeIn').value.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) { homeErr('Mã phòng gồm 4 chữ cái, hỏi quản trò nhé.'); $('codeIn').focus(); return; }
  myName = name; role = 'client'; roomCode = code; resetGame();
  $('joinBtn').disabled = true; homeErr('Đang vào phòng ' + code + '...');
  peer = new Peer({ debug: 0 });
  const timer = setTimeout(() => { if (phase === 'home') backHome(`Không vào được phòng ${code}. Kiểm tra lại mã, hoặc quản trò chưa mở phòng.`); }, 12000);
  peer.on('open', () => {
    hostConn = peer.connect(PREFIX + code, { serialization: 'json' });
    hostConn.on('open', () => hostConn.send({ k: 'q' }));
    hostConn.on('data', d => onClientData(d, timer));
    hostConn.on('close', () => { if (role === 'client') backHome('Mất kết nối với quản trò.'); });
  });
  peer.on('error', err => {
    clearTimeout(timer);
    if (err.type === 'peer-unavailable') backHome(`Không tìm thấy phòng ${code}. Kiểm tra lại mã.`);
    else if (role === 'client' && phase === 'home') backHome('Lỗi kết nối (' + err.type + '). Thử lại nhé.');
  });
}
function pickTeam(i) {
  if (!hostConn || !hostConn.open || pickWait) return;
  pickWait = true; pickErr(''); renderPick();
  hostConn.send({ k: 'hi', name: myName, team: i });
}
function toPickScreen(why) {
  phase = 'pick'; G = null; gotSnap = false; players = []; pickWait = false;
  show('pick'); pickErr(why || ''); renderPick();
}
function onClientData(d, timer) {
  if (!d || typeof d !== 'object') return;
  if (d.k === 'tm') {
    clearTimeout(timer);
    pickHost = String(d.host || '').slice(0, 16);
    teamList = (Array.isArray(d.teams) ? d.teams : []).slice(0, MAX_TEAMS).filter(t => t && typeof t === 'object')
      .map(t => ({ i: t.i | 0, no: num(t.no, 1, 99) | 0, n: t.n | 0, out: !!t.out, ph: String(t.ph || '') }));
    teamMax = num(d.max, 1, MAX_PLAYERS) | 0 || MAX_PLAYERS;
    if (phase === 'home') { homeErr(''); toPickScreen(''); } else if (phase === 'pick') renderPick();
  }
  else if (d.k === 'w') { clearTimeout(timer); mySlot = d.slot | 0; pickWait = false; phase = 'lobby'; if (d.l) onClientData(d.l); onPhase(); }
  else if (d.k === 'no') {
    clearTimeout(timer);
    if (d.pick && phase === 'pick') { pickWait = false; pickErr(String(d.why || 'Không vào được đội này.')); renderPick(); }
    else backHome(String(d.why || 'Không vào được phòng.'));
  }
  else if (d.k === 'pk') toPickScreen(String(d.why || ''));
  else if (d.k === 'kick') backHome(String(d.why || 'Quản trò đã mời bạn ra khỏi phòng.').slice(0, 120));
  else if (d.k === 'po') { const r = performance.now() - (+d.t || 0); if (r >= 0 && r < 5000) rtt = rtt ? rtt * .7 + r * .3 : r; }
  else if (d.k === 'l') {
    if (phase === 'home' || phase === 'pick') return; // not in a team (yet / any more): an old team's message
    if (d.sq !== undefined) { if (d.sq <= lobbySq) return; lobbySq = d.sq; }
    if (Array.isArray(d.players)) players = d.players.map(p => ({ slot: p.slot | 0, name: String(p.name).slice(0, 16), ready: !!p.ready }));
    hostName = String(d.host || '').slice(0, 16);
    settings = cleanSettings(d.set);
    teamNo = d.team | 0 || 1;
    nextRound = Math.min(3, Math.max(1, d.next | 0 || 1));
    lastRound = Math.min(3, Math.max(0, d.lr | 0));
    results = Array.isArray(d.res) ? d.res.map(x => x | 0) : [];
    lastPer = d.last && typeof d.last === 'object' ? d.last : null;
    lastPts = d.lastPts && typeof d.lastPts === 'object' ? d.lastPts : null;
    lastPen = d.pen && typeof d.pen === 'object' ? { n: d.pen.n | 0, top: String(d.pen.top || '').slice(0, 16), empty: (Array.isArray(d.pen.empty) ? d.pen.empty : []).map(s => String(s).slice(0, 16)) } : null;
    if (d.ph === 'lobby' || d.ph === 'final') { phase = d.ph; gotSnap = false; onPhase(); }
    else if (phase === 'lobby') renderLobby(); else renderChips();
  }
  else if (d.k === 's' && phase !== 'home' && phase !== 'pick') applySnap(d);
}
