// hmi.js — 天車操作介面（教學版）：現場人員用來看天車狀態、切手動、操作各軸、清除警報、復歸
//
// 兩個主要畫面：
//   ・主畫面：上位命令（MCS／OCS 派下來的指令）、天車回傳狀態、位置資訊
//   ・快速操作：走行／捲揚／側移／旋轉／夾爪 五個軸的伺服、原點、寸動，防墜、I/O 感測器、警報清除
// 異常排除照現場的順序：切手動 → 警報清除 →（依異常：伺服 ON、寸動、回原點…）→ 切自動。
// 有「排除步驟」提示，按錯順序會在訊息列提醒（例如沒切手動不能清警報、捲揚不在原點不能走行）。
// 畫面是依一般天車操作介面的功能做的通用教學版，不是任何廠商的實際軟體。

// ---------- 各異常的排除步驟（教學用） ----------
const STEP_TXT = {
  confirm: '確認現場安全（前方軌道沒有人員、工具、掉落物）', release: '解除緊急停止', manual: '切手動（Auto → Manual）', clear: '按「警報清除」清掉異常碼',
  'servo:walk': '走行「伺服 On」', 'servo:hoist': '捲揚「伺服 On」', 'jog:walk': '走行「前進」寸動，讓讀碼器重新讀到條碼',
  claw: '夾爪「開」，人員把 FOUP 放正', 'home:hoist': '捲揚「原點」：吊帶收回', 'home:shift': '側移「原點」：滑台收回', auto: '切自動（Manual → Auto），天車恢復運行',
};
const RECOVERY = {
  'E-101': ['manual', 'clear', 'servo:walk', 'auto'],
  'E-102': ['manual', 'clear', 'jog:walk', 'auto'],
  'E-103': ['confirm', 'manual', 'clear', 'auto'],
  'E-104': ['confirm', 'release', 'manual', 'clear', 'auto'],
  'E-201': ['manual', 'clear', 'claw', 'home:hoist', 'home:shift', 'auto'],
  'E-202': ['manual', 'clear', 'home:hoist', 'home:shift', 'auto'],
  'E-203': ['manual', 'clear', 'servo:hoist', 'home:hoist', 'home:shift', 'auto'],
};
const ESTOP_INFO = { code: 'E-104', title: '緊急停止（人員按下 E-STOP）',
  what: '有人在操作介面或現場按下了緊急停止，天車所有動作立刻停止。',
  impact: '跟天車故障停車一樣：停在軌道上，後面的車排隊。如果正在取放貨，吊帶和 FOUP 會停在半空中。',
  steps: ['確認按下急停的原因已經排除、現場安全', '解除緊急停止', '切手動 → 警報清除', '確認各軸狀態正常後切自動'] };
const AXIS_OF_CODE = { 'E-101': 'walk', 'E-102': 'walk', 'E-103': 'walk', 'E-104': 'walk', 'E-201': 'claw', 'E-202': 'hoist', 'E-203': 'hoist' };
const ON_HOME = (v) => v.hoist < 0.005 && Math.abs(v.shift) < 0.002;

// 異常發生時：有些異常會讓伺服跳脫（alarms.js 的 raiseAlarm 會呼叫）
function hmiOnAlarm(a) {
  if (a.type !== 'vehicle' && a.type !== 'transfer') return;
  const v = a.target; hmiInit(v);
  if (a.info.code === 'E-101') v.servo.walk = false;
  if (a.info.code === 'E-203') v.servo.hoist = false;
}
function hmiInit(v) {
  if (!v.servo) v.servo = { walk: true, hoist: true, shift: true, rot: true, claw: true };
  if (!v.man) v.man = {};
  if (v.odo === undefined) v.odo = 0;
}
const vAlarm = v => alarms.find(a => (a.type === 'vehicle' || a.type === 'transfer') && a.target === v);

// 每個步驟現在算不算完成
function stepDone(v, a, s) {
  switch (s) {
    case 'confirm': return !!a.confirmed;
    case 'release': return !v.estop;
    case 'manual': return !!v.manual;
    case 'clear': return !!a.codeCleared;
    case 'servo:walk': return v.servo.walk;
    case 'servo:hoist': return v.servo.hoist;
    case 'jog:walk': return !!a.jogged;
    case 'claw': return v.claw < 0.01;
    case 'home:hoist': return v.hoist < 0.005;
    case 'home:shift': return Math.abs(v.shift) < 0.002;
    case 'auto': return false;
  }
  return true;
}

// ---------- 手動操作：各軸慢慢動到目標 ----------
function hmiTick(dt) {
  for (const v of vehicles) {
    if (!v.manual || v.estop || !v.man) continue;
    const m = v.man, mv = (cur, tgt, spd) => cur + Math.sign(tgt - cur) * Math.min(Math.abs(tgt - cur), spd * dt);
    if (m.hoist !== undefined) { v.hoist = mv(v.hoist, m.hoist, 0.45); v.hv = 0; if (v.hoist === m.hoist) delete m.hoist; }
    if (m.shift !== undefined) { v.shift = mv(v.shift, m.shift, 0.3); if (v.shift === m.shift) delete m.shift; }
    if (m.guard !== undefined) { v.guard = mv(v.guard, m.guard, 1 / GUARD_TIME); if (v.guard === m.guard) delete m.guard; }
    if (m.claw !== undefined) { v.claw = mv(v.claw, m.claw, 1 / CLAW_TIME); if (v.claw === m.claw) delete m.claw; }
    if (m.jog > 0) {                                                     // 走行寸動：慢慢往前，前車太近就停
      const { gap } = leaderInfo(v, pathAhead(v, LOOK));
      const step = Math.min(m.jog, 0.3 * dt, Math.max(0, gap - MIN_GAP - 0.05));
      if (step <= 0) { m.jog = 0; hmiMsg('前方有車，寸動停止'); }
      else { advance(v, step); v.odo += step; m.jog -= step; const a = vAlarm(v); if (a && a.codeCleared) { a.jogDist = (a.jogDist || 0) + step; if (a.jogDist >= 0.3) a.jogged = true; } }
    }
  }
}

// ---------- 按鈕動作 ----------
let hmiV = null, hmiTab = 'main', hmiMsgText = '', hmiMsgT = 0;
function hmiMsg(t) { hmiMsgText = t; hmiMsgT = simTime; renderHmi(); }
function needManual(v, axis) {
  if (v.estop) { hmiMsg('緊急停止中，所有動作禁止。請先「解除急停」'); return false; }
  if (!v.manual) { hmiMsg('要先切「手動」才能操作各軸'); return false; }
  const a = vAlarm(v);
  if (a && !a.codeCleared) { hmiMsg('異常碼還沒清除，請先按「警報清除」'); return false; }
  if (axis && !v.servo[axis]) { hmiMsg('這一軸的伺服是 OFF，請先按「伺服 On」'); return false; }
  return true;
}
function hmiAct(act) {
  const v = hmiV; if (!v) return; hmiInit(v);
  const a = vAlarm(v), [kind, axis] = act.split(':');
  switch (kind) {
    case 'manual':
      if (v.manual) return hmiMsg('已經是手動模式');
      if (v.v > 0.05 && !v.fault) return hmiMsg('天車行駛中不能切手動，請等它停下來（或先按急停）');
      v.manual = true; v.v = 0; log(`🛠 ${v.id} 切手動（現場操作）`); return hmiMsg('已切手動：天車停止自動運行，可以操作各軸');
    case 'auto': return hmiAuto(v, a);
    case 'clear':
      if (!a) return hmiMsg('目前沒有異常碼');
      if (v.estop) return hmiMsg('緊急停止還沒解除，警報清不掉');
      if (!v.manual) return hmiMsg('要先切「手動」才能清除警報');
      if (RECOVERY[a.info.code][0] === 'confirm' && !a.confirmed) return hmiMsg('請先確認現場安全（勾選排除步驟第 1 項）');
      a.codeCleared = true; log(`🛠 ${v.id} 警報清除（${a.info.code}）`); return hmiMsg('異常碼已清除。依照排除步驟繼續');
    case 'confirm': if (a) { a.confirmed = true; hmiMsg('已確認現場安全'); } return;
    case 'estop':
      if (v.estop) {                                                   // 解除急停
        v.estop = false; log(`🛠 ${v.id} 解除緊急停止`); return hmiMsg('已解除急停。接著切手動 → 警報清除');
      }
      v.estop = true; v.v = 0;
      if (!a) { const na = raiseAlarm('vehicle', ESTOP_INFO, v, `天車 ${v.id}（${v.seg.name}）`); v.fault = na; }
      return hmiMsg('⛔ 緊急停止！天車所有動作停止');
    case 'servo': {
      const on = act.endsWith(':on'); const ax = act.split(':')[1];
      if (on && a && !a.codeCleared) return hmiMsg('異常碼還在，伺服無法 On。請先「警報清除」');
      if (!on && !v.manual) return hmiMsg('自動運行中不能關伺服，請先切手動');
      v.servo[ax] = on; return hmiMsg(`${AXIS_NAME[ax]}伺服 ${on ? 'On' : 'Off'}`);
    }
    case 'home': {
      if (!needManual(v, axis)) return;
      v.manTouched = true;
      if (axis === 'all') { if (!v.servo.hoist || !v.servo.shift) return hmiMsg('捲揚或側移伺服 Off，無法歸原點'); v.man.hoist = 0; v.man.shift = 0; v.man.guard = 0; return hmiMsg('歸原點：捲揚收回、側移收回、防墜伸出'); }
      if (axis === 'hoist') v.man.hoist = 0;
      if (axis === 'shift') { if (v.hoist > 0.05) return hmiMsg('捲揚不在原點，側移不能動（吊帶還放著）'); v.man.shift = 0; }
      if (axis === 'claw') v.man.claw = 0;
      return hmiMsg(`${AXIS_NAME[axis]}回原點中…`);
    }
    case 'jog': {
      const ax = axis, dir = +act.split(':')[2];
      if (!needManual(v, ax)) return;
      v.manTouched = true;
      if (ax === 'walk') {
        if (!ON_HOME(v)) return hmiMsg('捲揚／側移不在原點，禁止走行（會撞到東西）');
        if (v.guard > 0.01 && v.carry) return hmiMsg('有貨時防墜要先「伸出」才能走行');
        if (dir < 0) return hmiMsg('教學版只開放「前進」寸動（軌道是單向的）');
        v.man.jog = (v.man.jog || 0) + 0.5; return hmiMsg('走行寸動前進 0.5 m');
      }
      if (ax === 'hoist') {
        if (Math.abs(v.shift) > 0.002 && Math.abs(v.shift) < STB_OFFSET - 0.01) return hmiMsg('側移在半途，捲揚不能動');
        if (v.guard < 0.99 && dir > 0) return hmiMsg('防墜還伸著，捲揚下降會撞到。請先「收合」防墜');
        v.man.hoist = Math.max(0, Math.min(H - 1.2, (v.man.hoist ?? v.hoist) + dir * 0.2)); return;
      }
      if (ax === 'shift') {
        if (v.hoist > 0.05) return hmiMsg('捲揚不在原點，側移不能動');
        v.man.shift = Math.max(-STB_OFFSET, Math.min(STB_OFFSET, (v.man.shift ?? v.shift) + dir * 0.2)); return;
      }
      if (ax === 'rot') return hmiMsg('這個機型取放貨不旋轉 FOUP，旋轉軸固定在原點');
      return;
    }
    case 'claw': {
      if (!needManual(v, 'claw')) return;
      const open = axis === 'open';
      if (open && v.carry && v.state !== 'release') return hmiMsg('⚠ 夾爪上有 FOUP 而且不在放貨位置，禁止開爪（FOUP 會掉下去）');
      v.manTouched = true; v.man.claw = open ? 0 : 1; return hmiMsg(`夾爪${open ? '開' : '閉'}`);
    }
    case 'guard': {
      if (!needManual(v)) return;
      if (axis === 'out' && v.hoist > 0.05) return hmiMsg('吊帶還放著，防墜不能伸出（會夾到吊帶）');
      v.manTouched = true; v.man.guard = axis === 'out' ? 0 : 1; return hmiMsg(`防墜${axis === 'out' ? '伸出' : '收合'}`);
    }
    case 'stop': if (v.man) { v.man = {}; hmiMsg('停止：所有手動動作停止'); } return;
    case 'find': setFollow(v); return hmiMsg(`尋車：鏡頭跟隨 ${v.id}`);
    case 'online': setOffline(v, false); return renderHmi();
    case 'offline': setOffline(v, true); return renderHmi();
  }
}
const AXIS_NAME = { walk: '走行', hoist: '捲揚', shift: '側移', rot: '旋轉', claw: '夾爪', all: '各軸' };

// 切自動：檢查排除步驟都做完、各軸在原點，才讓天車恢復
function hmiAuto(v, a) {
  if (!v.manual && !a) return hmiMsg('已經是自動模式');
  if (v.estop) return hmiMsg('緊急停止還沒解除');
  if (a) {
    const miss = RECOVERY[a.info.code].filter(s => s !== 'auto' && !stepDone(v, a, s));
    if (miss.length) return hmiMsg(`還不能切自動，還沒完成：${STEP_TXT[miss[0]]}`);
  }
  if (!v.servo.walk || !v.servo.hoist || !v.servo.shift) return hmiMsg('有軸的伺服是 Off，請先全部 On');
  const transferring = TRANSFERRING.includes(v.state);
  if (v.manTouched || !transferring) {
    if (!ON_HOME(v)) return hmiMsg('捲揚／側移不在原點，請先按「歸原點」');
    if (!transferring && v.guard > 0.01) return hmiMsg('防墜還是收合的，請先「伸出」（或按歸原點）');
  }
  if (a) { a.manualFixed = true; clearAlarm(a); }
  if (transferring && v.manTouched) {                                   // 各軸被動過：取放貨從頭再做一次
    if (v.carry && v.op === 'pick') v.state = 'guardClose';            // 已經夾到貨：直接收尾、去放貨
    else { v.state = 'guardOpen'; v.claw = v.carry ? 1 : 0; }
  }
  v.manual = false; v.manTouched = false; v.man = {};
  log(`🛠 ${v.id} 切自動，恢復運行${transferring ? '（重新執行取放貨）' : ''}`);
  hmiMsg('已切自動，天車恢復運行 ✔');
}

// ---------- 畫面 ----------
function openHmi(v, tab) {
  hmiV = v || hmiV || vehicles[0]; hmiInit(hmiV); if (tab) hmiTab = tab;
  document.getElementById('hmi').style.display = 'flex'; hmiMsgText = ''; renderHmi();
}
function closeHmi() { document.getElementById('hmi').style.display = 'none'; hmiV = null; }
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
function hmiData(v) {
  const p = v.group.position, a = vAlarm(v), j = v.job;
  return {
    a, code: a && !a.codeCleared ? a.info.code : '0',
    status: v.estop ? '緊急停止' : a ? '異常停止' : v.manual ? '手動模式' : v.state === 'idle' ? (v.parked ? '自動待機' : '自動巡航') : TRANSFERRING.includes(v.state) ? '自動取放中' : '自動運行',
    cmd: j ? `T${String(j.id).padStart(6, '0')}` : '—', step: stateText(v), mode: v.manual ? 'Manual 模式' : 'Auto 模式',
    from: j ? j.from.name : '—', to: j ? j.to.name : '—', moveTo: v.target ? `${10000 + v.target.seg.to.id}` : '—', lot: j ? j.foup.id : '—',
    run: v.v > 0.02 ? 'moving' : 'stop', addr: 10000 + v.seg.to.id, sect: 1000 + v.seg.id, dist: Math.round(v.d * 1000),
    claw: v.claw > 0.99 ? (v.carry ? 'hold' : 'close') : v.claw < 0.01 ? 'open' : 'moving', carry: v.carry ? v.carry.id : 'none',
    barcode: f1(v.seg.id * 1000 + v.d * 100), enc: f1(((v.odo || 0) * 100) % 100000), x: f1(p.x * 1000), y: f1(p.z * 1000),
  };
}
const fld = (label, val, cls = '') => `<div class="hf"><span>${label}</span><b class="${cls}">${val}</b></div>`;
function axisRow(v, ax, name, pos, spd, code, btns) {
  const busy = v.man && ((ax === 'walk' && v.man.jog > 0) || v.man[ax] !== undefined);
  return `<div class="ax"><div class="axn">${name}</div>
    <button class="sv ${v.servo[ax] ? 'on' : ''}" data-a="servo:${ax}:${v.servo[ax] ? 'off' : 'on'}">伺服 ${v.servo[ax] ? 'On' : 'Off'}</button>
    <div class="axv"><span>目前位置</span><b>${pos}</b></div><div class="axv"><span>目前速度</span><b>${spd}</b></div>
    <div class="axv"><span>異常碼</span><b class="code ${code !== '0' ? 'bad' : ''}">${code}</b></div>
    <div class="axb">${btns}<button data-a="stop">停止</button><span class="done ${busy ? '' : 'ok'}">${busy ? '動作中' : '命令完成'}</span></div></div>`;
}
function vehicleSvg(d, v) {
  const warn = d.a ? `<g transform="translate(18,92)"><path d="M28 0 L56 50 L0 50 Z" fill="#ef4444"/><text x="28" y="42" fill="#fff" font-size="34" font-weight="700" text-anchor="middle">!</text></g>` : '';
  const wifi = commOk(v) ? `<g transform="translate(125,186)" fill="none" stroke="#22c55e" stroke-width="6" stroke-linecap="round"><path d="M0 0 Q30 -26 60 0"/><path d="M12 12 Q30 -2 48 12"/><circle cx="30" cy="22" r="4" fill="#22c55e"/></g>`
    : `<g transform="translate(125,180)"><text x="30" y="22" fill="#ef4444" font-size="26" text-anchor="middle">📶✕</text></g>`;
  const gear = TRANSFERRING.includes(v.state) || (v.man && Object.keys(v.man).length) ? `<g transform="translate(232,128)"><circle r="18" fill="none" stroke="#3b82f6" stroke-width="9" stroke-dasharray="7 5"/><circle r="6" fill="#3b82f6"/></g>` : '';
  const man = v.manual ? `<text x="155" y="30" font-size="15" fill="#b45309" text-anchor="middle" font-weight="700">MANUAL</text>` : '';
  return `<svg viewBox="0 0 310 240" class="vsvg"><rect x="70" y="40" width="170" height="16" rx="5" fill="#cbd5e1" stroke="#94a3b8"/>
    <rect x="125" y="22" width="60" height="20" fill="#e2e8f0" stroke="#94a3b8"/>
    <path d="M80 56 h150 v120 q0 18 -18 18 h-114 q-18 0 -18 -18 z" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/>
    <path d="M80 56 h150 v10 h-150 z" fill="#facc15"/><rect x="100" y="80" width="110" height="${16 + Math.min(70, v.hoist * 25)}" fill="#e5e7eb" stroke="#cbd5e1"/>
    <rect x="${130 + v.shift * 30}" y="${96 + Math.min(70, v.hoist * 25)}" width="50" height="8" fill="#334155"/>
    ${v.carry ? `<rect x="${133 + v.shift * 30}" y="${104 + Math.min(70, v.hoist * 25)}" width="44" height="34" rx="4" fill="#64748b"/>` : ''}
    ${man}${warn}${wifi}${gear}</svg>`;
}
function renderHmi() {
  const el = document.getElementById('hmi'); if (!el || el.style.display === 'none' || !hmiV) return;
  if (hmiHold || (document.activeElement && document.activeElement.id === 'hmiSel')) return;
  const v = hmiV; if (!vehicles.includes(v)) return closeHmi();
  const d = hmiData(v), a = d.a, t = Math.floor(simTime);
  const time = `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const sel = `<select id="hmiSel">${vehicles.map(u => `<option ${u === v ? 'selected' : ''}>${u.id}</option>`).join('')}</select>`;
  let body = '';
  if (hmiTab === 'main') {
    body = `<div class="hmain"><div class="hbox"><h5>天車上位命令狀態</h5>${fld('上位命令 ID', d.cmd)}${fld('狀態', d.status, 'w')}${fld('步驟', d.step, 'w')}${fld('模式', d.mode, v.manual ? 'w red' : 'w red')}
      ${fld('從', v.seg.from.id + 10000)}${fld('取貨站', d.from)}${fld('移動到', d.moveTo)}${fld('放貨站', d.to)}${fld('目標貨物 ID', d.lot)}
      <h5>天車回傳狀態</h5>${fld('走行狀態', d.run, 'w')}${fld('Address', d.addr)}${fld('Section', d.sect)}${fld('Distance', d.dist)}${fld('夾爪狀態', d.claw, 'w')}${fld('實際貨物 ID', d.carry)}</div>
      <div class="hpic">${vehicleSvg(d, v)}</div>
      <div class="hcol"><button class="estop ${v.estop ? 'on' : ''}" data-a="estop"><span>${v.estop ? '解除急停' : 'EMERGENCY STOP'}</span></button>
      <div class="hbox"><h5>天車實際運行資訊</h5>${fld('軟體版本', '教學版 1.0')}${fld('Barcode', d.barcode)}${fld('Encoder', d.enc)}${fld('X 座標', d.x)}${fld('Y 座標', d.y)}${fld('Section ID', d.sect)}${fld('Address ID', d.addr)}${fld('連線 AP', v.ap ? v.ap.id : '—')}</div></div></div>`;
  } else if (hmiTab === 'quick') {
    const ac = AXIS_OF_CODE[a && a.info.code], code = ax => ac === ax ? d.code : '0';
    const io = [['IN-08 在席檢知', !!v.carry], ['IN-07 過物檢知', false], ['IN-06 吊帶張力 1', !(a && a.info.code === 'E-203')], ['IN-05 吊帶張力 2', true], ['IN-04 吊帶張力 3', true],
      ['IN-02 夾爪閉', v.claw > 0.99], ['IN-03 夾爪開', v.claw < 0.01], ['IN-01 偏擺檢知', false], ['前防墜收合', v.guard > 0.99], ['前防墜伸出', v.guard < 0.01], ['後防墜收合', v.guard > 0.99], ['後防墜伸出', v.guard < 0.01]];
    body = `<div class="hquick"><div class="axes">
      ${axisRow(v, 'walk', '走行', d.enc, f1(v.v * 1000), code('walk'), `<button data-a="home:walk" disabled title="走行沒有原點，用位置歸零">原點</button><button data-a="jog:walk:1">前進</button><button data-a="jog:walk:-1">後退</button>`)}
      ${axisRow(v, 'hoist', '捲揚', f1(-v.hoist * 1000), f1(v.man && v.man.hoist !== undefined ? 450 : 0), code('hoist'), `<button data-a="home:hoist">原點</button><button data-a="jog:hoist:1">下降</button><button data-a="jog:hoist:-1">上升</button>`)}
      ${axisRow(v, 'shift', '側移', f1(v.shift * 1000), f1(v.man && v.man.shift !== undefined ? 300 : 0), code('shift'), `<button data-a="home:shift">原點</button><button data-a="jog:shift:1">左移</button><button data-a="jog:shift:-1">右移</button>`)}
      ${axisRow(v, 'rot', '旋轉', '0.0', '0', '0', `<button data-a="jog:rot:0">原點</button><button data-a="jog:rot:1">左旋</button><button data-a="jog:rot:-1">右旋</button>`)}
      ${axisRow(v, 'claw', '夾爪', f1(-v.claw * 3000), '0', code('claw'), `<button data-a="claw:open">開</button><button data-a="claw:close">閉</button>`)}</div>
      <div class="hside"><div class="hbtn2"><button data-a="find">尋車</button><button data-a="home:all">歸原點</button></div>
      <div class="hbox"><h5>防墜</h5><div class="hbtn2"><button data-a="guard:out">伸出</button><button data-a="guard:in">收合</button></div></div>
      <div class="io">${io.map(([n, on]) => `<div class="${on ? 'on' : ''}"><span>${n}</span><b>正常</b></div>`).join('')}</div></div>
      <div class="hcol"><button class="estop ${v.estop ? 'on' : ''}" data-a="estop"><span>${v.estop ? '解除急停' : 'EMERGENCY STOP'}</span></button>${recoveryBox(v, a)}</div></div>`;
  } else body = `<div class="hempty">教學版沒有開放這個畫面。現場異常排除請用「快速操作」。</div>`;
  const tabs = [['main', '主畫面'], ['quick', '快速操作'], ['run', '走行相關'], ['xfer', '取放相關'], ['io', 'I/O 狀態監控'], ['param', '參數設定'], ['log', '系統紀錄']];
  el.innerHTML = `<div class="hwin" style="${hmiPos ? `left:${hmiPos[0]};top:${hmiPos[1]};transform:none` : ''}"><div class="hhead">
      <div class="lamps"><button class="lamp" data-a="home:all">原點</button><button class="lamp ${v.manual ? 'man' : ''}" data-a="${v.manual ? 'auto' : 'manual'}">${v.manual ? '切自動' : '切手動'}</button><button class="lamp ${commOk(v) ? '' : 'off'}">連線</button></div>
      <div class="big ${a ? 'alarm' : ''}">${d.status}</div>
      <div class="hid"><div>車號 <b class="no">${v.id}</b> ${sel}</div><div class="hbtn2"><button data-a="offline" ${v.offline ? 'disabled' : ''}>下線</button><button data-a="online" ${v.offline ? '' : 'disabled'}>上線</button></div>
      <div class="mut">IP 10.0.1.${10 + vehicles.indexOf(v)}（示意） · 模擬時間 ${time}</div></div>
      <button class="hclose" id="hmiClose">✕</button></div>
    <div class="hbody">${body}</div>
    <div class="hmsg"><span>🔔</span><div>${hmiMsgText || (a ? `${a.info.code} ${a.info.title}` : '')}</div><button data-a="clear" class="aclr">警報清除</button></div>
    <div class="htabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${hmiTab === k ? 'cur' : ''}">${n}</button>`).join('')}</div></div>`;
}
// 事件綁在外框上（畫面每 0.25 秒重畫，按鈕會換新）；滑鼠按著或下拉選單打開時先不重畫，免得按不到
let hmiHold = false, hmiPos = null;
{
  const el = document.getElementById('hmi');
  el.addEventListener('pointerdown', () => { hmiHold = true; });
  window.addEventListener('pointerup', () => { if (hmiHold) setTimeout(() => { hmiHold = false; }, 50); });
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-a],[data-tab],#hmiClose'); if (!b || b.disabled) return;
    if (b.id === 'hmiClose') return closeHmi();
    if (b.dataset.tab) { hmiTab = b.dataset.tab; hmiHold = false; return renderHmi(); }
    hmiHold = false; hmiAct(b.dataset.a);
  });
  // 拖曳標題列可以移動視窗（讓出畫面看天車）
  let drag = null;
  el.addEventListener('pointerdown', e => { if (e.target.closest('.hhead') && !e.target.closest('button,select')) { const w = el.querySelector('.hwin').getBoundingClientRect(); drag = [e.clientX - w.left, e.clientY - w.top]; } });
  window.addEventListener('pointermove', e => { if (!drag) return; const w = el.querySelector('.hwin'); w.style.left = (e.clientX - drag[0]) + 'px'; w.style.top = (e.clientY - drag[1]) + 'px'; w.style.transform = 'none'; hmiPos = [w.style.left, w.style.top]; });
  window.addEventListener('pointerup', () => { drag = null; });
  el.addEventListener('change', e => { if (e.target.id === 'hmiSel') { hmiV = vehicles.find(u => u.id === e.target.value); hmiInit(hmiV); hmiMsgText = ''; e.target.blur(); renderHmi(); } });
}
function recoveryBox(v, a) {
  if (!a) return `<div class="hbox rec"><h5>異常排除步驟</h5><p class="mut">這台車目前沒有異常。<br>想練習的話：按 EMERGENCY STOP，或在面板觸發「天車故障停車」「取放貨異常」，再回來這裡排除。</p></div>`;
  const steps = RECOVERY[a.info.code] || ['manual', 'clear', 'auto'];
  let next = true;
  return `<div class="hbox rec"><h5>異常排除步驟：${a.info.code}</h5><div class="mut">${a.info.title}</div><ol>${steps.map(s => {
    const ok = stepDone(v, a, s), cur = !ok && next; if (cur) next = false;
    const extra = s === 'confirm' && !ok ? ` <button data-a="confirm">確認</button>` : '';
    return `<li class="${ok ? 'ok' : cur ? 'cur' : ''}">${ok ? '✔' : cur ? '➜' : '・'} ${STEP_TXT[s]}${extra}</li>`;
  }).join('')}</ol></div>`;
}
