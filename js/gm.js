// ================= quản trò's board =================
// The board holds no room and runs no sim: each đội trưởng's tab holds its own room and links here with the
// board's code, sending the room's state. The board sends back setup / kick / start for that room.
const gmRooms = new Map();          // room code -> {code, conn, on, st, el}
let gmTpl = cleanSettings(null);    // settings a newly linked room starts with: the last ones the quản trò set

function openBoard(code, tries = 0) {
  homeErr('');
  if (!window.Peer) { homeErr('Không tải được phần kết nối mạng. Kiểm tra Internet rồi tải lại trang.'); return; }
  if (!code) { // the same code as last time, so rooms linked to it come back by themselves after a reload
    try { code = localStorage.getItem('quatca-gm'); } catch (e) {}
    if (!/^[A-Z]{4}$/.test(code || '')) code = makeCode();
  }
  try { gmTpl = cleanSettings(JSON.parse(localStorage.getItem('quatca-settings'))); } catch (e) {}
  role = 'gm'; mySlot = -1; players = []; resetGame();
  $('gmBtn').disabled = true; homeErr('Đang mở bảng quản trò...');
  peer = new Peer(GM_PREFIX + code, { debug: 0 });
  peer.on('open', () => {
    roomCode = code; homeErr(''); phase = 'gm';
    try { localStorage.setItem('quatca-gm', code); } catch (e) {}
    show('gmPanel'); renderBoard();
  });
  peer.on('error', err => {
    if (err.type === 'unavailable-id' && phase === 'home') {
      // a reloaded tab's old link takes a moment to go: try the same code a few times, then take a new one
      resetNet();
      if (tries < 3) setTimeout(() => { if (role === 'gm' && phase === 'home') openBoard(code, tries + 1); }, 2000);
      else openBoard(makeCode());
      return;
    }
    if (phase === 'home') backHome('Không mở được bảng quản trò (' + err.type + '). Thử lại sau vài giây.');
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
  peer.on('connection', conn => {
    conn.on('data', d => onBoardData(conn, d));
    conn.on('close', () => roomGone(conn));
    conn.on('error', () => roomGone(conn));
  });
}
// a room's state, made safe: it comes from someone else's tab
function cleanStatus(d) {
  const res = Array.isArray(d.res) ? d.res : [];
  return {
    team: Math.min(99, Math.max(1, d.team | 0 || 1)),
    cap: String(d.cap || '').slice(0, 16),
    ph: ['lobby', 'count', 'play', 'over', 'final'].includes(d.ph) ? d.ph : 'lobby',
    next: num(d.next, 1, 3) | 0 || 1,
    res: [0, 1, 2].map(i => res[i] != null && Number.isFinite(+res[i]) ? Math.round(+res[i]) : null),
    players: (Array.isArray(d.players) ? d.players : []).slice(0, MAX_PLAYERS).filter(p => p && typeof p === 'object')
      .map(p => ({ slot: num(p.slot, 0, MAX_PLAYERS - 1) | 0, name: String(p.name || '').slice(0, 16), ready: !!p.ready })),
    set: cleanSettings(d.set),
    rd: num(d.rd, 1, 3) | 0 || 1, t: num(d.t, 0, 3600), sc: num(d.sc, -99999, 99999) | 0
  };
}
function onBoardData(conn, d) {
  if (!d || typeof d !== 'object' || d.k !== 'st') return;
  const code = String(d.code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) return;
  let r = gmRooms.get(code);
  const fresh = !r;
  if (!r) gmRooms.set(code, r = { code });
  if (r.conn !== conn) { const old = r.conn; r.conn = conn; if (old) try { old.close(); } catch (e) {} } // the room linked again
  r.on = true; r.st = cleanStatus(d);
  // a room new to the board, not played yet: it starts with the quản trò's settings
  if (fresh && r.st.ph === 'lobby' && r.st.res.every(x => x == null)) { cmd(r, { a: 'setAll', set: gmTpl }); r.st.set = cleanSettings(gmTpl); }
  renderBoard();
}
function roomGone(conn) {
  for (const r of gmRooms.values()) if (r.conn === conn) { r.on = false; renderBoard(); }
}
// the link the quản trò sends the đội trưởngs: it fills in the quản trò's code on their home screen
function gmLinkUrl(code) { return location.origin + location.pathname + '?qt=' + code; }
function cmd(r, m) { if (r.conn && r.conn.open) try { r.conn.send({ k: 'cmd', ...m }); } catch (e) {} }
function keepTpl(set) { gmTpl = cleanSettings(set); try { localStorage.setItem('quatca-settings', JSON.stringify(gmTpl)); } catch (e) {} }
const total = st => st.res.reduce((a, b) => a + (b || 0), 0);
const allReady = st => st.players.length > 0 && st.players.every(p => p.ready);
function stateText(r) {
  const st = r.st;
  if (!r.on) return 'Mất kết nối';
  if (st.ph === 'lobby') return `Chờ vòng ${st.next}`;
  if (st.ph === 'final') return 'Xong';
  return `Vòng ${st.rd}` + (st.ph === 'play' ? ` · ${fmtTime(st.t)}` : '');
}

function renderBoard() {
  if (role !== 'gm') return;
  $('gmCode').textContent = roomCode || '----';
  $('gmLink').value = gmLinkUrl(roomCode);
  const rooms = [...gmRooms.values()].filter(r => r.st);
  $('gmEmpty').hidden = rooms.length > 0;
  $('gmBoardBox').hidden = !rooms.length;
  $('gmStartAll').disabled = !rooms.some(r => r.on && r.st.ph === 'lobby' && allReady(r.st));
  // score table, best team first
  const tb = $('gmBoard'); tb.textContent = '';
  rooms.slice().sort((a, b) => total(b.st) - total(a.st) || a.st.team - b.st.team).forEach((r, i) => {
    const tr = document.createElement('tr'); if (!r.on) tr.className = 'off';
    for (const v of [i + 1, `Đội ${r.st.team}`, stateText(r), ...r.st.res.map(x => x == null ? '–' : x), total(r.st)]) {
      const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  // one card per room, in team order
  const box = $('gmRooms');
  rooms.sort((a, b) => a.st.team - b.st.team || a.code.localeCompare(b.code)).forEach(r => {
    if (!r.el) buildRoomCard(r);
    fillRoomCard(r, rooms.length);
    box.appendChild(r.el);
  });
}
// Built once per room, then only refreshed, so typing in the fish box isn't interrupted.
function buildRoomCard(r) {
  const el = r.el = document.createElement('div'); el.className = 'room';
  el.innerHTML = `
    <div class="rhead"><h3 class="rteam"></h3><span class="rcode"></span></div>
    <p class="note rstate"></p>
    <ul class="players rplayers"></ul>
    <div class="setbox rset">
      <div class="row">
        <div class="field"><span class="lbl">Chơi vòng</span><select data-k="round" aria-label="Chơi vòng"></select></div>
        <div class="field"><span class="lbl">Tối đa</span><select data-k="max" aria-label="Số người chơi tối đa"></select></div>
      </div>
      <span class="lbl rsetlbl"></span>
      <div class="row">
        <div class="field"><span class="lbl">Số cá</span><input data-k="fish" type="number" aria-label="Số cá"></div>
        <div class="field"><span class="lbl">Thời gian</span><select data-k="time" aria-label="Thời gian"></select></div>
        <div class="field"><span class="lbl">Cỡ đĩa</span><select data-k="plate" aria-label="Cỡ đĩa"></select></div>
      </div>
    </div>
    <button class="go rstart" type="button"></button>
    <button class="ghost ragain" type="button">Chơi lại từ đầu</button>
    <button class="link rall" type="button">Dùng cài đặt này cho mọi phòng</button>`;
  const q = s => el.querySelector(s), opt = (sel, v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
  for (let i = 1; i <= 3; i++) opt(q('[data-k="round"]'), i, '');
  for (let n = 1; n <= MAX_PLAYERS; n++) opt(q('[data-k="max"]'), n, n + ' người');
  for (const t of TIME_OPTS) opt(q('[data-k="time"]'), t, fmtTime(t));
  for (const [k, label] of PLATE_OPTS) opt(q('[data-k="plate"]'), k, label);
  Object.assign(q('[data-k="fish"]'), { min: FISH_MIN, max: FISH_MAX, step: FISH_STEP });
  for (const key of ['fish', 'time', 'plate']) q(`[data-k="${key}"]`).addEventListener('change', e => {
    const st = r.st; st.set.rounds[st.next][key] = +e.target.value; st.set = cleanSettings(st.set);
    e.target.value = st.set.rounds[st.next][key]; // shows the fish count rounded to a multiple of 10
    cmd(r, { a: 'set', r: st.next, key, v: st.set.rounds[st.next][key] }); keepTpl(st.set);
  });
  q('[data-k="max"]').addEventListener('change', e => { r.st.set.maxPlayers = +e.target.value; cmd(r, { a: 'max', v: +e.target.value }); keepTpl(r.st.set); });
  q('[data-k="round"]').addEventListener('change', e => cmd(r, { a: 'round', v: +e.target.value }));
  q('.rstart').addEventListener('click', () => cmd(r, { a: 'start' }));
  q('.rall').addEventListener('click', () => {
    keepTpl(r.st.set);
    for (const o of gmRooms.values()) if (o !== r && o.on && o.st && (o.st.ph === 'lobby' || o.st.ph === 'final')) cmd(o, { a: 'setAll', set: r.st.set });
    q('.rall').textContent = 'Đã áp dụng cho các phòng đang chờ';
    setTimeout(() => { q('.rall').textContent = 'Dùng cài đặt này cho mọi phòng'; }, 2000);
  });
  // wiping a team's scores takes two clicks
  let armed = null;
  q('.ragain').addEventListener('click', () => {
    const b = q('.ragain');
    if (!armed) { b.textContent = 'Bấm lần nữa để xoá điểm và chơi lại'; armed = setTimeout(() => { armed = null; b.textContent = 'Chơi lại từ đầu'; }, 3000); return; }
    clearTimeout(armed); armed = null; b.textContent = 'Chơi lại từ đầu';
    cmd(r, { a: 'again' });
  });
}
function fillRoomCard(r, nRooms) {
  const st = r.st, el = r.el, q = s => el.querySelector(s);
  const between = r.on && (st.ph === 'lobby' || st.ph === 'final'), lobby = r.on && st.ph === 'lobby';
  const ready = st.players.filter(p => p.ready).length;
  el.classList.toggle('off', !r.on);
  q('.rteam').textContent = `Đội ${st.team}`;
  q('.rcode').textContent = `Phòng ${r.code} · đội trưởng ${st.cap}`;
  q('.rstate').textContent = !r.on ? 'Mất kết nối với phòng (máy đội trưởng đóng tab hoặc rớt mạng). Phòng sẽ tự hiện lại khi nối lại được.'
    : st.ph === 'lobby' ? `Phòng chờ vòng ${st.next} · ${ready}/${st.players.length} sẵn sàng`
    : st.ph === 'final' ? `Đã xong 3 vòng · tổng ${total(st)} điểm`
    : st.ph === 'count' ? `Vòng ${st.rd} sắp bắt đầu...`
    : st.ph === 'over' ? `Vòng ${st.rd} hết giờ · ${st.sc} điểm`
    : `Đang chơi vòng ${st.rd} · còn ${fmtTime(st.t)} · ${st.sc} điểm trong đĩa`;
  const ul = q('.rplayers'); ul.textContent = '';
  for (const p of st.players) {
    const li = dotLi(p.slot, p.name + (p.slot === 0 ? ' · đội trưởng' : ''), lobby ? (p.ready ? 'sẵn sàng ✓' : 'chưa sẵn sàng') : '');
    if (lobby && p.ready) li.querySelector('em').className = 'ok';
    if (lobby && p.slot !== 0) { // the đội trưởng holds the room: they can't be sent out of it
      const b = document.createElement('button'); b.type = 'button'; b.className = 'kick'; b.textContent = 'Mời ra';
      b.addEventListener('click', () => cmd(r, { a: 'kick', slot: p.slot }));
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
  q('.rset').hidden = !between;
  if (between) {
    const S = st.set.rounds[st.next];
    q('.rsetlbl').textContent = `Cài đặt vòng ${st.next} · ${ROUNDS[st.next].name}`;
    [...q('[data-k="round"]').options].forEach((o, i) =>
      o.textContent = `Vòng ${i + 1} · ${ROUNDS[i + 1].name}` + (st.res[i] != null ? ` (${st.res[i]} điểm)` : ''));
    for (const [k, v] of [['round', st.next], ['max', st.set.maxPlayers], ['fish', S.fish], ['time', S.time], ['plate', S.plate]]) {
      const i = q(`[data-k="${k}"]`); if (document.activeElement !== i) i.value = v;
    }
  }
  q('.rstart').hidden = !lobby;
  q('.rstart').disabled = !allReady(st);
  q('.rstart').textContent = `Bắt đầu vòng ${st.next} (${ready}/${st.players.length} sẵn sàng)`;
  q('.ragain').hidden = !(between && st.res.some(x => x != null));
  q('.rall').hidden = !(between && nRooms > 1);
}
