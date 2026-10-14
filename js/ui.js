// ================= HUD =================
function updateHud() {
  const C = cfg();
  $('roundPill').textContent = `Vòng ${R.round}/3 · ${C.name}`;
  $('time').textContent = fmtTime(phase === 'count' ? roundSet(R.round).time : R.time);
  $('timePill').classList.toggle('hot', phase === 'play' && R.time <= 30);
  $('score').textContent = R.score; $('total').textContent = R.fish.reduce((a, f) => a + (f.pts || 0), 0); // points in the plate / on the field
  $('minePill').hidden = mySlot < 0; // the quản trò has no share
  $('mine').textContent = `${R.cred[mySlot] || 0}/${R.quota[mySlot] || 0}`;
  $('minePill').style.boxShadow = `inset 0 0 0 3px ${COLORS[mySlot % COLORS.length]}, 0 3px 0 rgba(0,0,0,.18)`;
  $('windPill').hidden = !C.wind; $('foulPill').hidden = !C.foul;
  if (C.wind) {
    const n = Math.min(3, Math.round(Math.abs(R.wind) / 30));
    $('wind').textContent = n === 0 ? 'lặng' : (R.wind < 0 ? '← ' : '') + '▮'.repeat(n) + '▯'.repeat(3 - n) + (R.wind > 0 ? ' →' : '');
  }
  if (C.foul) {
    const f = $('fouls'), prev = +f.textContent;
    if (R.fouls > prev) { const p = $('foulPill'); p.classList.add('flash'); setTimeout(() => p.classList.remove('flash'), 400); }
    f.textContent = R.fouls;
  }
}

// ================= UI flow =================
function show(id) {
  ['home', 'lobby', 'endScreen', 'gmPanel'].forEach(x => $(x).hidden = x !== id); $('hud').hidden = !(phase === 'count' || phase === 'play' || phase === 'over');
  document.body.classList.toggle('gm', role === 'gm');
}
function onPhase() {
  if (phase === 'count' || phase === 'play' || phase === 'over') { show(null); renderChips(); updateHud(); }
  else if (phase === 'lobby') { show('lobby'); renderLobby(); }
  else if (phase === 'final') { show('endScreen'); renderFinal(); }
}
function dotLi(slot, text, right) {
  const li = document.createElement('li');
  const d = document.createElement('span'); d.className = 'dot'; d.style.background = COLORS[slot % COLORS.length];
  const em = document.createElement('em'); em.textContent = right || '';
  li.append(d, document.createTextNode(text), em);
  return li;
}
function renderChips() {
  const el = $('chips'); el.textContent = '';
  for (const p of players) {
    const c = document.createElement('div'); c.className = 'chip';
    const d = document.createElement('span'); d.className = 'dot'; d.style.background = COLORS[p.slot % COLORS.length];
    c.append(d, document.createTextNode(p.name + (p.slot === mySlot ? ' (bạn)' : '')));
    el.appendChild(c);
  }
}
function renderLobby() {
  // ctl: this screen sets up and starts the rounds. A room given a quản trò's code is run from the quản trò's board
  // only (even while it's still linking); otherwise the đội trưởng (or the solo player) runs it.
  const solo = role === 'solo', cap = role === 'host', gmRun = cap ? !!gmCode : gmOn, ctl = solo || (cap && !gmRun), C = ROUNDS[nextRound];
  $('codeBox').hidden = solo;
  $('lobbyCode').textContent = roomCode || '----';
  // last round
  const done = lastRound > 0 && results[lastRound - 1] != null;
  $('lastBox').hidden = !done;
  if (done) {
    $('lastLabel').textContent = `Vòng ${lastRound} vừa rồi`;
    $('lastNum').textContent = `${results[lastRound - 1]} điểm`;
    const ul = $('lastList'); ul.textContent = '';
    if (lastPer && !solo) for (const p of players) if (lastPer[p.slot] !== undefined) ul.appendChild(dotLi(p.slot, p.name, `${lastPer[p.slot]} cá · ${(lastPts && lastPts[p.slot]) || 0} điểm`));
    if (lastPen) { // someone had no fish in the plate
      const li = document.createElement('li'); li.className = 'pen';
      li.textContent = `Trừ ${lastPen.n} điểm: ${lastPen.empty.join(', ')} không có cá nào trong đĩa (bằng số cá của ${lastPen.top}, người cao điểm nhất).`;
      ul.appendChild(li);
    }
  }
  // next round
  $('nextTag').textContent = `Vòng ${nextRound}/3`;
  $('nextTitle').textContent = `Mức ${C.name}`;
  const S = roundSet(nextRound);
  const np = Math.max(1, players.length), share = Math.floor(S.fish / np), extra = S.fish % np;
  const shareTxt = extra ? `${share}–${share + 1}` : `${share}`;
  const rl = $('nextRules'); rl.textContent = '';
  const shareRule = players.length ? `tối đa ${shareTxt} con (${S.fish} ÷ ${np} người)` : `tối đa ${S.fish} ÷ số người chơi`;
  [`${S.fish} con cá, ${fmtTime(S.time)}, đĩa cỡ ${plateName(S.plate).toLowerCase()}. Mỗi người chỉ được quạt vào đĩa ${shareRule}. Đủ phần rồi mà vẫn quạt thêm cá vào thì cá bị bật ra.`,
    `Mỗi con cá có từ 1 đến 10 điểm, ghi ở mặt sau con cá: mỗi mức điểm có ${S.fish / 10} con. Cá vào đĩa thì đội được cộng điểm của con đó, bay ra thì bị trừ lại.`,
    ...(players.length > 1 ? ['Hết vòng, mỗi người phải có ít nhất 1 con cá trong đĩa. Nếu có người không có con nào, đội bị trừ số điểm bằng số cá của người cao điểm nhất đội.'] : []),
    ...C.rules].forEach(t => { const li = document.createElement('li'); li.textContent = t; rl.appendChild(li); });
  // settings for the round about to be played, and the room's player limit (whoever runs the room here)
  $('setBox').hidden = !ctl;
  $('roomBox').hidden = !(cap && ctl);
  $('gmBox').hidden = !cap;
  if (cap) fillGM();
  if (ctl) fillSettings();
  // team + players
  $('teamRow').hidden = !(ctl || cap);
  $('roundField').hidden = !ctl;
  $('teamField').hidden = !(cap && !results.some(r => r != null));
  const rs = $('roundSel'); rs.textContent = '';
  for (let r = 1; r <= 3; r++) {
    const o = document.createElement('option'); o.value = r;
    o.textContent = `Vòng ${r} · ${ROUNDS[r].name}` + (results[r - 1] != null ? ` (đã chơi: ${results[r - 1]} điểm)` : '');
    rs.appendChild(o);
  }
  rs.value = nextRound;
  $('teamSel').value = teamNo;
  $('pCount').textContent = players.length;
  $('pMax').textContent = solo ? 1 : settings.maxPlayers;
  const ul = $('pList'); ul.textContent = '';
  if (gmRun) { // the quản trò, apart from the team
    const li = document.createElement('li'); li.className = 'gm';
    const em = document.createElement('em'); em.textContent = 'cài đặt và bắt đầu vòng, không chơi';
    li.append(document.createTextNode('Quản trò'), em);
    ul.appendChild(li);
  }
  const ready = players.filter(p => p.ready).length, allReady = players.length > 0 && ready === players.length;
  for (const p of players) {
    const li = dotLi(p.slot, p.name + (p.slot === mySlot ? ' (bạn)' : '') + (!solo && p.slot === 0 ? ' · đội trưởng' : ''), solo ? '' : p.ready ? 'sẵn sàng ✓' : 'chưa sẵn sàng');
    if (p.ready) li.querySelector('em').className = 'ok';
    if (cap && ctl && phase === 'lobby' && p.slot !== mySlot) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'kick'; b.textContent = 'Mời ra';
      b.addEventListener('click', () => kickPlayer(p.slot));
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
  $('startBtn').hidden = !ctl;
  $('startBtn').disabled = !(solo || allReady);
  $('startBtn').textContent = `Bắt đầu vòng ${nextRound}` + (solo || !players.length ? '' : ` (${ready}/${players.length} sẵn sàng)`);
  // a player's own ready toggle
  const meP = players.find(p => p.slot === mySlot);
  $('readyBtn').hidden = solo || !meP;
  $('readyBtn').classList.toggle('on', !!(meP && meP.ready));
  $('readyBtn').textContent = meP && meP.ready ? 'Đã sẵn sàng ✓ (bấm để huỷ)' : `Sẵn sàng chơi vòng ${nextRound}`;
  const keepOpen = 'Giữ tab này luôn mở trong lúc chơi, vì máy đội trưởng là máy tính điểm cho cả đội.';
  $('lobbyNote').textContent = solo ? `Chơi thử một mình: bạn được quạt cả ${S.fish} con.`
    : cap && ctl ? (allReady ? '' : 'Chờ mọi người (cả bạn) bấm "Sẵn sàng" rồi mới bắt đầu được. ') +
      `Đội ${teamNo}. Gửi mã phòng cho đồng đội. Bạn là đội trưởng: vừa chơi vừa giữ phòng. Phòng chưa nối với quản trò nên bạn tự cài đặt và bắt đầu từng vòng. ${keepOpen}`
    : cap && !gmLinked() ? `Đội ${teamNo}. Phòng đang chờ nối với quản trò: quản trò sẽ cài đặt và bắt đầu từng vòng. Nếu quản trò không vào được, bấm "Bỏ quản trò, tự điều khiển phòng". ${keepOpen}`
    : cap ? `Đội ${teamNo}. Gửi mã phòng cho đồng đội. Quản trò cài đặt và bắt đầu từng vòng, bạn chỉ cần bấm "Sẵn sàng" như mọi người. ${keepOpen}`
    : meP && meP.ready ? `Đội ${teamNo}. Chờ ${gmOn ? 'quản trò' : 'đội trưởng'} bắt đầu vòng ${nextRound}...`
    : `Đội ${teamNo}. Xem luật vòng ${nextRound} rồi bấm "Sẵn sàng".`;
}
// The host sets up only the round about to be played: its fish / time / plate size. Built once, then only
// refreshed, so typing in the fish box isn't interrupted.
function buildSettings() {
  $('setFish').min = FISH_MIN; $('setFish').max = FISH_MAX; $('setFish').step = FISH_STEP;
  for (const s of TIME_OPTS) { const o = document.createElement('option'); o.value = s; o.textContent = fmtTime(s); $('setTime').appendChild(o); }
  for (const [k, label] of PLATE_OPTS) { const o = document.createElement('option'); o.value = k; o.textContent = label; $('setPlate').appendChild(o); }
  for (const [id, key] of [['setFish', 'fish'], ['setTime', 'time'], ['setPlate', 'plate']])
    $(id).addEventListener('change', () => { settings.rounds[nextRound][key] = +$(id).value; unready(); settingsChanged(); $(id).value = roundSet(nextRound)[key]; }); // shows the count rounded to a multiple of 10
  for (let n = 1; n <= MAX_PLAYERS; n++) { const o = document.createElement('option'); o.value = n; o.textContent = n + ' người'; $('maxSel').appendChild(o); }
  $('maxSel').addEventListener('change', () => { settings.maxPlayers = +$('maxSel').value; settingsChanged(); });
}
function settingsChanged() {
  settings = cleanSettings(settings); // keeps a typed fish count in range
  try { localStorage.setItem('quatca-settings', JSON.stringify(settings)); } catch (e) {} // next time's starting values
  broadcast(lobbyMsg()); renderLobby();
}
function fillSettings() {
  const S = roundSet(nextRound);
  $('setLabel').textContent = `Cài đặt vòng ${nextRound} · ${ROUNDS[nextRound].name}`;
  for (const [id, v] of [['setFish', S.fish], ['setTime', S.time], ['setPlate', S.plate]])
    if (document.activeElement !== $(id)) $(id).value = v;
  $('maxSel').value = settings.maxPlayers;
}
// đội trưởng: the room's link to a quản trò's board
function fillGM(msg) {
  const on = gmLinked();
  $('gmState').textContent = msg || (!gmCode ? 'Phòng chưa nối với quản trò. Nếu có quản trò, nhập mã của quản trò để quản trò cài đặt và bắt đầu vòng cho đội.'
    : on ? `Đã nối với quản trò (mã ${gmCode}).`
    : gmMiss ? `Không tìm thấy quản trò mã ${gmCode}. Kiểm tra lại mã. Vẫn đang thử nối lại...`
    : `Đang nối với quản trò mã ${gmCode}...`);
  $('gmLinkRow').hidden = on;
  $('gmDropBtn').hidden = on || !gmCode;
  if (document.activeElement !== $('gmLobbyIn')) $('gmLobbyIn').value = gmCode;
}
// the next round's setup changed: everyone has to look again and say they're ready
function unready() { players.forEach(p => { p.ready = false; }); }
function renderFinal() {
  const names = players.map(p => p.name).join(', ');
  const label = role === 'solo' ? myName + ' (chơi thử)' : `Đội ${teamNo}`;
  const total = results.reduce((a, b) => a + (b || 0), 0);
  $('endWho').textContent = `${label} · ${names}`;
  const tb = $('endTbl'); tb.textContent = '';
  for (let r = 1; r <= 3; r++) {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = `Vòng ${r} · ${ROUNDS[r].name}`;
    const b = document.createElement('td'); b.textContent = (results[r - 1] || 0) + ' điểm';
    tr.append(a, b); tb.appendChild(tr);
  }
  const tr = document.createElement('tr'); tr.className = 'total';
  const a = document.createElement('td'); a.textContent = 'Tổng 3 vòng';
  const b = document.createElement('td'); b.textContent = total;
  tr.append(a, b); tb.appendChild(tr);
  $('resultText').value = `${label} (${names}): V1 ${results[0] || 0} + V2 ${results[1] || 0} + V3 ${results[2] || 0} = ${total} điểm`;
  $('copyBtn').textContent = 'Sao chép kết quả';
  const gmRun = role === 'host' ? !!gmCode : gmOn, ctl = role === 'solo' || (role === 'host' && !gmRun);
  $('againBtn').hidden = !ctl;
  $('pickBtn').hidden = !ctl;
  $('endNote').textContent = gmRun ? 'Kết quả của đội đã hiện trên bảng quản trò. Đội có tổng điểm 3 vòng cao nhất thắng.'
    : role === 'client' ? 'Đội trưởng giữ kết quả của đội. Đội có tổng điểm 3 vòng cao nhất thắng.'
    : 'Sao chép dòng kết quả để lưu lại. Đội có tổng điểm 3 vòng cao nhất thắng.';
}
function homeErr(msg) { const e = $('homeErr'); e.textContent = msg; e.hidden = !msg; }
function resetNet() {
  try { if (peer) peer.destroy(); } catch (e) {}
  peer = null; hostConn = null; conns.clear(); gotSnap = false; gmConn = null; clearTimeout(gmTry); gmTry = null; gmOn = false; snaps = []; base = null; clkOff = null;
  lastSq = 0; lobbySq = 0; jit = 0; renderDelay = 80; snapGap = 33; rtt = 0; connType = '';
}
function backHome(msg) {
  resetNet(); role = null; phase = 'home'; G = null; R.fans = [];
  preview();
  show('home'); homeErr(msg || '');
  $('hostBtn').disabled = false; $('joinBtn').disabled = false; $('gmBtn').disabled = false;
  gmRooms.clear(); $('gmRooms').textContent = '';
}
function getName() {
  const n = $('name').value.trim().slice(0, 16);
  if (!n) { homeErr('Nhập tên của bạn trước đã.'); $('name').focus(); return null; }
  try { localStorage.setItem('quatca-name', n); } catch (e) {}
  return n;
}
function resetGame() { results = []; lastPer = null; lastPts = null; lastPen = null; nextRound = 1; lastRound = 0; }
