// ================= networking: host =================
// A player whose link has fallen behind (data still queued to them) skips game snapshots until it catches up,
// rather than piling up more and more lag; a full snapshot every ~0.5s puts them right again.
const SEND_BACKLOG = 64 * 1024;
function broadcast(m) {
  for (const c of conns.values()) if (c.conn.open) {
    if (m.k === 's' && c.conn.dataChannel && c.conn.dataChannel.bufferedAmount > SEND_BACKLOG) continue;
    try { c.conn.send(m); } catch (e) {}
  }
  if (m.k === 'l') toGM(); // the quản trò's board sees every lobby change
}
function lobbyMsg() { return { k: 'l', sq: ++netSq, ph: phase, players, host: hostName, gm: gmLinked(), set: settings, team: teamNo, next: nextRound, lr: lastRound, res: results.map(x => x || 0), last: lastPer, lastPts, pen: lastPen }; }
function makeCode() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }

function hostRoom() {
  homeErr('');
  if (!window.Peer) { homeErr('Không tải được phần kết nối mạng. Kiểm tra Internet rồi tải lại trang, hoặc bấm "Chơi thử một mình".'); return; }
  const name = getName(); if (!name) return;
  const gm = $('gmIn').value.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (gm && gm.length !== 4) { homeErr('Mã quản trò gồm 4 chữ cái. Bỏ trống nếu không có quản trò.'); $('gmIn').focus(); return; }
  try { localStorage.setItem('quatca-gmjoin', gm); } catch (e) {}
  // the đội trưởng holds the room (and its sim) and plays in it, as slot 0
  myName = name; hostName = name; role = 'host'; mySlot = 0; players = [{ slot: 0, name, ready: false }]; gmCode = gm; gmMiss = false;
  resetGame(); loadSettings();
  $('hostBtn').disabled = true; homeErr('Đang tạo phòng...');
  const code = makeCode();
  peer = new Peer(PREFIX + code, { debug: 0 });
  peer.on('open', () => { roomCode = code; homeErr(''); phase = 'lobby'; onPhase(); linkGM(); });
  peer.on('error', err => {
    if (err.type === 'unavailable-id' && phase === 'home') { resetNet(); hostRoom(); return; }
    if (err.type === 'peer-unavailable' && phase !== 'home') { gmMiss = true; if (phase === 'lobby') renderLobby(); return; } // no quản trò with that code (yet)
    if (phase === 'home') backHome('Không tạo được phòng (' + err.type + '). Thử lại sau vài giây.');
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
  peer.on('connection', conn => {
    conn.on('data', d => onHostData(conn, d));
    conn.on('close', () => dropConn(conn));
    conn.on('error', () => dropConn(conn));
  });
}
function onHostData(conn, d) {
  if (!d || typeof d !== 'object') return;
  if (d.k === 'hi') {
    if (conns.has(conn.peer)) return;
    if (phase !== 'lobby') { conn.send({ k: 'no', why: 'Đội đang chơi dở một vòng. Chờ hết vòng rồi vào lại.' }); return; }
    const used = new Set(players.map(p => p.slot));
    let slot = -1; for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s)) { slot = s; break; }
    if (slot < 0 || players.length >= settings.maxPlayers) { conn.send({ k: 'no', why: `Phòng đã đủ ${settings.maxPlayers} người.` }); return; }
    const name = String(d.name || 'Bạn').slice(0, 16);
    conns.set(conn.peer, { conn, slot, name });
    players.push({ slot, name, ready: false }); players.sort((a, b) => a.slot - b.slot);
    conn.send({ k: 'w', slot });
    broadcast(lobbyMsg()); renderLobby();
    return;
  }
  if (d.k === 'pi') { try { conn.send({ k: 'po', t: d.t }); } catch (e) {} return; }
  if (d.k === 'rd') { // a player says they're (not) ready for the next round
    const c = conns.get(conn.peer), p = c && players.find(p => p.slot === c.slot);
    if (p && phase === 'lobby') { p.ready = !!d.v; broadcast(lobbyMsg()); renderLobby(); }
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
function dropConn(conn) {
  const c = conns.get(conn.peer); if (!c) return;
  conns.delete(conn.peer);
  players = players.filter(p => p.slot !== c.slot);
  if (G) delete G.inputs[c.slot];
  broadcast(lobbyMsg());
  if (phase === 'lobby') renderLobby(); else renderChips();
}
// host: send a player out of the room (between rounds)
function kickPlayer(slot) {
  for (const c of conns.values()) if (c.slot === slot) {
    try { c.conn.send({ k: 'kick' }); } catch (e) {}
    const conn = c.conn; dropConn(conn);
    setTimeout(() => { try { conn.close(); } catch (e) {} }, 300); // let the message get there first
  }
}
function startRound() {
  if (phase !== 'lobby' || !players.length) return; // nobody to play
  if (role === 'host' && !players.every(p => p.ready)) return; // everyone has to be ready
  unready(); // they say ready again before the next round
  newRound(nextRound);
  broadcast(lobbyMsg());
  onPhase();
  broadcast(snapshot());
}

// ================= đội trưởng ↔ quản trò =================
// The room links to the quản trò's board (by the quản trò's code) and keeps sending it the room's state. While
// linked, the board sets up, starts and kicks; if the link drops the đội trưởng runs the room until it's back.
let gmCode = '', gmConn = null, gmTry = null, gmMiss = false;
const gmLinked = () => !!(gmConn && gmConn.open);
function gmRetry() { if (!gmTry && role === 'host' && gmCode && !gmLinked()) gmTry = setTimeout(linkGM, 4000); }
function linkGM() {
  clearTimeout(gmTry); gmTry = null;
  if (role !== 'host' || !gmCode || gmLinked()) return;
  if (!peer || peer.destroyed || !peer.open) { gmRetry(); return; }
  const c = peer.connect(GM_PREFIX + gmCode, { serialization: 'json', reliable: true });
  let opened = false;
  const giveUp = setTimeout(() => { if (!opened) { try { c.close(); } catch (e) {} gmRetry(); } }, 10000);
  c.on('open', () => {
    opened = true; clearTimeout(giveUp);
    if (role !== 'host' || gmLinked()) { try { c.close(); } catch (e) {} return; }
    gmConn = c; gmMiss = false;
    broadcast(lobbyMsg()); onPhase(); // also tells the board everything
  });
  c.on('data', d => { if (c === gmConn) onGMData(d); });
  const lost = () => {
    clearTimeout(giveUp);
    if (gmConn === c) { gmConn = null; broadcast(lobbyMsg()); if (phase === 'lobby' || phase === 'final') onPhase(); }
    gmRetry();
  };
  c.on('close', lost); c.on('error', lost);
}
// the room's state for the board: who's in and ready, the settings, results so far, and the live round
function toGM() {
  if (!gmLinked()) return;
  try {
    gmConn.send({ k: 'st', code: roomCode, team: teamNo, cap: myName, ph: phase, next: nextRound, players, set: settings,
      res: [0, 1, 2].map(i => results[i] != null ? results[i] : null),
      rd: G ? G.round : nextRound, t: G ? Math.round(G.timeLeft) : 0, sc: G ? G.score : 0 });
  } catch (e) {}
}
function onGMData(d) {
  if (!d || typeof d !== 'object' || d.k !== 'cmd') return;
  if (d.a === 'start') { startRound(); return; }
  if (d.a === 'kick') { if ((d.slot | 0) !== mySlot) kickPlayer(d.slot | 0); return; }
  if (phase !== 'lobby' && phase !== 'final') return; // setup only between rounds
  const r = d.r | 0;
  if (d.a === 'set' && r >= 1 && r <= 3 && ['fish', 'time', 'plate'].includes(d.key)) { settings.rounds[r][d.key] = +d.v; if (r === nextRound) unready(); }
  else if (d.a === 'setAll') { settings = cleanSettings(d.set); unready(); }
  else if (d.a === 'max') settings.maxPlayers = +d.v;
  else if (d.a === 'round') { nextRound = Math.min(3, Math.max(1, d.v | 0)); unready(); G = null; phase = 'lobby'; }
  else if (d.a === 'again') { resetGame(); unready(); G = null; phase = 'lobby'; }
  else return;
  settings = cleanSettings(settings);
  broadcast(lobbyMsg()); onPhase();
}

// ================= networking: client =================
function joinRoom() {
  homeErr('');
  if (!window.Peer) { homeErr('Không tải được phần kết nối mạng. Kiểm tra Internet rồi tải lại trang.'); return; }
  const name = getName(); if (!name) return;
  const code = $('codeIn').value.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) { homeErr('Mã phòng gồm 4 chữ cái, hỏi đội trưởng nhé.'); $('codeIn').focus(); return; }
  myName = name; role = 'client'; roomCode = code; resetGame();
  $('joinBtn').disabled = true; homeErr('Đang vào phòng ' + code + '...');
  peer = new Peer({ debug: 0 });
  const timer = setTimeout(() => { if (phase === 'home') backHome(`Không vào được phòng ${code}. Kiểm tra lại mã, hoặc đội trưởng chưa mở phòng.`); }, 12000);
  peer.on('open', () => {
    hostConn = peer.connect(PREFIX + code, { serialization: 'json' });
    hostConn.on('open', () => hostConn.send({ k: 'hi', name }));
    hostConn.on('data', d => onClientData(d, timer));
    hostConn.on('close', () => { if (role === 'client') backHome('Mất kết nối với phòng (máy đội trưởng).'); });
  });
  peer.on('error', err => {
    clearTimeout(timer);
    if (err.type === 'peer-unavailable') backHome(`Không tìm thấy phòng ${code}. Kiểm tra lại mã.`);
    else if (role === 'client' && phase === 'home') backHome('Lỗi kết nối (' + err.type + '). Thử lại nhé.');
  });
}
function onClientData(d, timer) {
  if (!d || typeof d !== 'object') return;
  if (d.k === 'w') { clearTimeout(timer); mySlot = d.slot | 0; homeErr(''); phase = 'lobby'; onPhase(); }
  else if (d.k === 'no') { clearTimeout(timer); backHome(String(d.why || 'Không vào được phòng.')); }
  else if (d.k === 'kick') backHome('Bạn đã được mời ra khỏi phòng.');
  else if (d.k === 'po') { const r = performance.now() - (+d.t || 0); if (r >= 0 && r < 5000) rtt = rtt ? rtt * .7 + r * .3 : r; }
  else if (d.k === 'l') {
    if (d.sq !== undefined) { if (d.sq <= lobbySq) return; lobbySq = d.sq; }
    if (Array.isArray(d.players)) players = d.players.map(p => ({ slot: p.slot | 0, name: String(p.name).slice(0, 16), ready: !!p.ready }));
    hostName = String(d.host || '').slice(0, 16);
    gmOn = !!d.gm;
    settings = cleanSettings(d.set);
    teamNo = d.team | 0 || 1;
    nextRound = Math.min(3, Math.max(1, d.next | 0 || 1));
    lastRound = Math.min(3, Math.max(0, d.lr | 0));
    results = Array.isArray(d.res) ? d.res.map(x => x | 0) : [];
    lastPer = d.last && typeof d.last === 'object' ? d.last : null;
    lastPts = d.lastPts && typeof d.lastPts === 'object' ? d.lastPts : null;
    lastPen = d.pen && typeof d.pen === 'object' ? { n: d.pen.n | 0, top: String(d.pen.top || '').slice(0, 16), empty: (Array.isArray(d.pen.empty) ? d.pen.empty : []).map(s => String(s).slice(0, 16)) } : null;
    if (d.ph === 'lobby' || d.ph === 'final') { if (phase !== 'home') { phase = d.ph; gotSnap = false; onPhase(); } }
    else if (phase === 'lobby') renderLobby(); else renderChips();
  }
  else if (d.k === 's' && phase !== 'home') applySnap(d);
}
