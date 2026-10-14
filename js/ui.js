// ================= HUD =================
function updateHud() {
  const C = cfg();
  $('roundPill').textContent = (role === 'host' ? `Đội ${teamNo} · ` : '') + `Vòng ${R.round}/3`; // the host: the team being watched
  $('time').textContent = fmtTime(phase === 'count' ? roundSet(R.round).time : R.time);
  $('timePill').classList.toggle('hot', phase === 'play' && R.time <= 30);
  $('score').textContent = R.score; $('total').textContent = R.fish.reduce((a, f) => a + (f.pts || 0), 0); // points in the plate / on the field
  $('minePill').hidden = mySlot < 0; // the host has no share
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
  ['home', 'pick', 'lobby', 'endScreen', 'board'].forEach(x => $(x).hidden = x !== id); $('hud').hidden = !(phase === 'count' || phase === 'play' || phase === 'over');
  $('watchBar').hidden = true;
  document.body.classList.toggle('gm', role === 'host');
}
function onPhase() {
  if (role === 'host') { hostDirty(); return; } // a team's phase changed: the host's board shows it (room.js)
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
function renderChips() { if (role === 'host') hostDirty(); else drawChips(); }
function drawChips() {
  const el = $('chips'); el.textContent = '';
  for (const p of players) {
    const c = document.createElement('div'); c.className = 'chip';
    const d = document.createElement('span'); d.className = 'dot'; d.style.background = COLORS[p.slot % COLORS.length];
    c.append(d, document.createTextNode(p.name + (p.slot === mySlot ? ' (bạn)' : '')));
    el.appendChild(c);
  }
}
function renderLobby() {
  if (role === 'host') { hostDirty(); return; }
  const host = role !== 'client', solo = role === 'solo', C = ROUNDS[nextRound];
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
      li.textContent = `Trừ ${lastPen.n} điểm: ${lastPen.empty.join(', ')} không có cá nào trong đĩa (${lastPen.empty.length} người × ${lastPen.per} điểm, bằng số cá của ${lastPen.top}, người cao điểm nhất).`;
      ul.appendChild(li);
    }
  }
  // next round
  $('nextTag').textContent = `Vòng ${nextRound}/3`;
  $('nextTitle').textContent = C.title; // the player's heading for the round about to be played
  const S = roundSet(nextRound);
  const np = Math.max(1, players.length), share = Math.floor(S.fish / np), extra = S.fish % np;
  const shareTxt = extra ? `${share}–${share + 1}` : `${share}`;
  const rl = $('nextRules'); rl.textContent = '';
  const shareRule = players.length ? `tối đa ${shareTxt} con (${S.fish} ÷ ${np} người)` : `tối đa ${S.fish} ÷ số người chơi`;
  [`${S.fish} con cá, ${fmtTime(S.time)}, đĩa cỡ ${plateName(S.plate).toLowerCase()}. Mỗi người chỉ được quạt vào đĩa ${shareRule}. Đủ phần rồi mà vẫn quạt thêm cá vào thì cá bị bật ra.`,
    `Mỗi con cá có từ 1 đến 10 điểm, mỗi mức điểm có ${S.fish / 10} con. Cá vào đĩa thì đội được cộng điểm của con đó, bay ra thì bị trừ lại.`,
    ...(players.length > 1 ? ['Hết vòng, mỗi người phải có ít nhất 1 con cá trong đĩa. Cứ mỗi người không có con nào, đội bị trừ số điểm bằng số cá của người cao điểm nhất đội.'] : []),
    ...C.rules].forEach(t => { const li = document.createElement('li'); li.textContent = t; rl.appendChild(li); });
  // settings for the round about to be played (solo; the host sets them on the board)
  $('setBox').hidden = !host;
  if (host) fillSettings();
  // players
  $('teamRow').hidden = !host;
  const rs = $('roundSel'); rs.textContent = '';
  for (let r = 1; r <= 3; r++) {
    const o = document.createElement('option'); o.value = r;
    o.textContent = `Vòng ${r}` + (results[r - 1] != null ? ` (đã chơi: ${results[r - 1]} điểm)` : '');
    rs.appendChild(o);
  }
  rs.value = nextRound;
  $('pCount').textContent = players.length;
  $('pMax').textContent = solo ? 1 : settings.maxPlayers;
  const ul = $('pList'); ul.textContent = '';
  if (!solo && hostName) { // the host, apart from the team
    const li = document.createElement('li'); li.className = 'gm';
    const em = document.createElement('em'); em.textContent = 'không chơi';
    li.append(document.createTextNode(hostName + (role === 'host' ? ' (bạn)' : '')), em);
    ul.appendChild(li);
  }
  const ready = players.filter(p => p.ready).length, allReady = players.length > 0 && ready === players.length;
  for (const p of players) {
    const li = dotLi(p.slot, p.name + (p.slot === mySlot ? ' (bạn)' : ''), solo ? '' : p.ready ? 'sẵn sàng ✓' : 'chưa sẵn sàng');
    if (p.ready) li.querySelector('em').className = 'ok';
    ul.appendChild(li);
  }
  $('startBtn').hidden = !host;
  $('startBtn').disabled = !(solo || allReady);
  $('startBtn').textContent = `Bắt đầu vòng ${nextRound}` + (solo || !players.length ? '' : ` (${ready}/${players.length} sẵn sàng)`);
  // a player's own ready toggle
  const meP = players.find(p => p.slot === mySlot);
  $('readyBtn').hidden = role !== 'client' || !meP;
  $('readyBtn').classList.toggle('on', !!(meP && meP.ready));
  $('readyBtn').textContent = meP && meP.ready ? 'Đã sẵn sàng ✓ (bấm để huỷ)' : `Sẵn sàng chơi vòng ${nextRound}`;
  $('swBtn').hidden = role !== 'client' || !meP;
  $('lobbyNote').textContent = solo ? `Chơi thử một mình: bạn được quạt cả ${S.fish} con.`
    : meP && meP.ready ? `Đội ${teamNo}. Chờ host bắt đầu vòng ${nextRound}...`
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
}
function settingsChanged() {
  settings = cleanSettings(settings); // keeps a typed fish count in range
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} // next time's starting values
  renderLobby();
}
function fillSettings() {
  const S = roundSet(nextRound);
  $('setLabel').textContent = `Cài đặt vòng ${nextRound}`;
  for (const [id, v] of [['setFish', S.fish], ['setTime', S.time], ['setPlate', S.plate]])
    if (document.activeElement !== $(id)) $(id).value = v;
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
    const a = document.createElement('td'); a.textContent = `Vòng ${r}`;
    const b = document.createElement('td'); b.textContent = (results[r - 1] || 0) + ' điểm';
    tr.append(a, b); tb.appendChild(tr);
  }
  const tr = document.createElement('tr'); tr.className = 'total';
  const a = document.createElement('td'); a.textContent = 'Tổng 3 vòng';
  const b = document.createElement('td'); b.textContent = total;
  tr.append(a, b); tb.appendChild(tr);
  $('resultText').value = `${label} (${names}): V1 ${results[0] || 0} + V2 ${results[1] || 0} + V3 ${results[2] || 0} = ${total} điểm`;
  $('copyBtn').textContent = 'Sao chép kết quả';
  $('againBtn').hidden = role === 'client';
  $('pickBtn').hidden = role === 'client';
  $('endNote').textContent = role === 'client'
    ? 'Host giữ kết quả của đội. Đội có tổng số cá 3 vòng cao nhất thắng.'
    : 'Sao chép dòng kết quả để lưu lại. Đội có tổng số cá 3 vòng cao nhất thắng.';
}
// a player choosing their team: the room's teams as big buttons
function renderPick() {
  $('pickCode').textContent = roomCode || '----';
  $('pickWho').textContent = (pickHost ? `Phòng của ${pickHost}. ` : '') + 'Chọn đúng đội của bạn. Chọn nhầm thì vào màn chờ bấm "Đổi đội".';
  const box = $('pickList'); box.textContent = '';
  for (const t of teamList) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'team';
    const full = t.n >= teamMax, why = t.out ? 'đã dừng chơi' : t.ph !== 'lobby' ? 'đang chơi' : full ? 'đủ người' : `${t.n}/${teamMax} người`;
    b.disabled = pickWait || t.out || t.ph !== 'lobby' || full;
    const n = document.createElement('span'); n.textContent = `Đội ${t.no}`;
    const em = document.createElement('em'); em.textContent = why;
    b.append(n, em);
    b.addEventListener('click', () => pickTeam(t.i));
    box.appendChild(b);
  }
  if (!teamList.length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = 'Phòng chưa có đội nào.'; box.appendChild(p); }
}
function pickErr(msg) { const e = $('pickErr'); e.textContent = msg; e.hidden = !msg; }
function homeErr(msg) { const e = $('homeErr'); e.textContent = msg; e.hidden = !msg; }
function resetNet() {
  try { if (peer) peer.destroy(); } catch (e) {}
  try { if (slotPeer) slotPeer.destroy(); } catch (e) {}
  for (const t of room.teams) t.conns.clear();
  slotPeer = null; pend.clear(); where.clear(); resetRoom();
  peer = null; hostConn = null; conns = new Map(); gotSnap = false; snaps = []; base = null; clkOff = null;
  lastSq = 0; lobbySq = 0; jit = 0; renderDelay = 80; snapGap = 33; rtt = 0; connType = '';
}
function backHome(msg) {
  resetNet(); role = null; phase = 'home'; G = null; R = freshR(); players = []; pops = [];
  preview();
  show('home'); homeErr(msg || '');
  $('hostBtn').disabled = false; $('joinBtn').disabled = false; $('watchBar').hidden = true;
}
function getName() {
  const n = $('name').value.trim().slice(0, 16);
  if (!n) { homeErr('Nhập tên của bạn trước đã.'); $('name').focus(); return null; }
  try { localStorage.setItem('quatca-name', n); } catch (e) {}
  return n;
}
function resetGame() { results = []; lastPer = null; lastPts = null; lastPen = null; nextRound = 1; lastRound = 0; }
