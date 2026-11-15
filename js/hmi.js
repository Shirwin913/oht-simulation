// hmi.js — 天車操作介面（教學版）：現場人員用來看天車狀態、切手動、操作各軸、清除警報、復歸
//
// 兩個主要畫面：
//   ・主畫面：上位命令（MCS／OCS 派下來的指令）、天車回傳狀態、位置資訊
//   ・快速操作：走行／捲揚／側移／旋轉／夾爪 五個軸的伺服、原點、寸動，防墜、I/O 感測器、警報清除
// 異常發生後天車會先「自動復歸」（自己重試），失敗才需要人工：
//   按「警報清除」＝清掉異常碼，同時天車切成手動 →（依異常：伺服 ON、寸動、回原點…）→ 切自動。
// 有「排除步驟」提示，按錯順序會在訊息列提醒（例如沒切手動不能清警報、捲揚不在原點不能走行）。
// 畫面是依一般天車操作介面的功能做的通用教學版，不是任何廠商的實際軟體。

// ---------- 各異常的排除步驟（教學用） ----------
const STEP_TXT = {
  confirm: '確認現場安全（前方軌道沒有人員、工具、掉落物）', release: '解除緊急停止', manual: '切手動（Auto → Manual）', clear: '按「警報清除」：清掉異常碼，天車同時切成手動',
  'servo:walk': '走行「伺服 On」', 'servo:hoist': '捲揚「伺服 On」', 'jog:walk': '走行「前進」寸動，讓讀碼器重新讀到條碼',
  claw: '夾爪切到「開極限」', hoavbl: '確認光閘區域淨空、機台端復歸，E84 的 HO_AVBL 恢復 ON', 'home:hoist': '捲揚「原點」：吊帶收回', 'home:shift': '側移「原點」：滑台收回', auto: '切自動（Manual → Auto），天車恢復運行',
  cargo: '看貨物狀況：要清貨就把 FOUP 放到推車或機台上；不清貨就保留在車上', homeall: '按「歸原點」，等原點成功（所有機構校正完）',
  online: '切上線：天車恢復自動、重新接任務',
  homefail: '歸原點失敗：天車無法復歸（要清貨、推車）', push: '推車：人員把天車推到維修區（天車下線、送修）', hand: '手動切換到需要的手（轉彎＝下手、直行＝上手）',
};
const RECOVERY = {
  // 現場流程：警報清除（天車切手動）→ 依異常處理（伺服、寸動、換手、清貨、夾爪開極限、捲揚／側移回原點）→ 歸原點 → 原點成功後切上線
  'E-101': ['clear', 'servo:walk', 'homeall', 'online'],
  'E-102': ['clear', 'jog:walk', 'homeall', 'online'],
  'E-103': ['confirm', 'clear', 'homeall', 'online'],
  'E-104': ['confirm', 'release', 'clear', 'homeall', 'online'],
  'E-105': ['clear', 'hand', 'homeall', 'online'],
  'E-201': ['clear', 'cargo', 'claw', 'home:hoist', 'home:shift', 'homeall', 'online'],
  'E-202': ['clear', 'cargo', 'claw', 'home:hoist', 'home:shift', 'homeall', 'online'],
  'E-203': ['clear', 'servo:hoist', 'cargo', 'claw', 'home:hoist', 'home:shift', 'homeall', 'online'],
  'E-204': ['hoavbl', 'clear', 'cargo', 'claw', 'home:hoist', 'home:shift', 'homeall', 'online'],
  'E-205': ['clear', 'cargo', 'claw', 'home:hoist', 'home:shift', 'homeall', 'online'],
};
// 歸原點失敗＝天車無法復歸：清貨 → 夾爪開極限 → 捲揚、側移回原點（人員手動）→ 推車到維修區
const NO_RECOVER = ['clear', 'homefail', 'cargo', 'claw', 'home:hoist', 'home:shift', 'push'];
const recList = a => a.homeFailed ? NO_RECOVER : (RECOVERY[a.info.code] || ['clear', 'homeall', 'online']);
// 一定要清貨的情況（不能「保留在車上」）：天車無法復歸要推車、夾爪狀態不明、貨離機台沒多少高度
function cargoMust(v, a) {
  if (!a || !v.carry) return null;
  if (a.homeFailed) return '天車無法復歸，要推車，貨不能留在車上';
  if (a.clawUnknown && v.claw > 0.01 && v.claw < 0.99) return '夾爪狀態不明（開極限、閉極限都沒亮），不能確定 FOUP 有沒有夾牢';
  const p = transferPort(v);
  if (p && (p.owner.type === 'machine' || p.owner.type === 'ntb') && v.hoist > 0.3) { const left = hoistDepth(p) - v.hoist; if (left < 0.15) return `貨離機台只剩約 ${Math.max(5, Math.round(left * 1000))} mm，直接放到機台上`; }
  return null;
}
const ESTOP_INFO = { code: 'E-104', title: '緊急停止（人員按下 E-STOP）',
  what: '有人在操作介面或現場按下了緊急停止，天車所有動作立刻停止。',
  impact: '跟天車故障停車一樣：停在軌道上，後面的車排隊。如果正在取放貨，吊帶和 FOUP 會停在半空中。',
  steps: ['確認按下急停的原因已經排除、現場安全', '解除緊急停止', '警報清除（天車同時切成手動）', '確認各軸狀態正常後切自動'] };
const AXIS_OF_CODE = { 'E-204': 'hoist', 'E-101': 'walk', 'E-102': 'walk', 'E-103': 'walk', 'E-104': 'walk', 'E-201': 'claw', 'E-202': 'hoist', 'E-203': 'hoist', 'E-205': 'claw' };
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
    case 'claw': return v.carry ? true : v.claw < 0.01;                 // 貨保留在車上時夾爪維持閉極限，這步跳過
    case 'cargo': return !v.carry || (!!a.keepCargo && !cargoMust(v, a));
    case 'homefail': return !!a.homeFailed;
    case 'push': return false;
    case 'homeall': return !!v.homed && v.homed > a.start && !v.homing;
    case 'hand': return !v.handSw && handsAre(v, v.handNeed || 'up');
    case 'online': return false;
    case 'home:hoist': return v.hoist < 0.005;
    case 'home:shift': return Math.abs(v.shift) < 0.002;
    case 'hoavbl': return hoAvbl(a.port || transferPort(v));
    case 'auto': return false;
  }
  return true;
}

// ---------- 手動操作：各軸慢慢動到目標 ----------
// 清貨：人員把 FOUP 從夾爪拿下來，放到推車（之後人工送回 STB）或放到機台／目的地 Port 上
const cartFoups = [];
function hmiCargo(v, a, where) {
  if (!a) return hmiMsg('目前沒有異常，不需要清貨');
  if (!v.manual) return hmiMsg('要先按「警報清除」（天車切手動）');
  const f = v.carry; if (!f) return hmiMsg('夾爪上沒有貨');
  if (where === 'keep') { const why = cargoMust(v, a); if (why) return hmiMsg(`這個情況一定要清貨：${why}`); a.keepCargo = true; return hmiMsg('貨物保留在車上（夾爪維持閉極限），之後會重新執行這次取放'); }
  const job = v.job, port = transferPort(v);
  if (where === 'port' && !port) return hmiMsg('天車不在 Port 上方，貨只能放到推車');
  if (where === 'port' && port.foup) return hmiMsg('這個 Port 上已經有貨，不能放');
  v.carry = null; f.carrier = null; f.job = null; v.manTouched = true;
  if (job) { if (job.to.reserved && job.to !== port) job.to.reserved = false; const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1); }
  if (where === 'port') {
    placeFoupAt(f, port); port.foup = f; port.reserved = false; f.port = port;
    if (v.op === 'pick') f.state = 'ready';                                // 放回原本要取貨的 Port：等重新派車
    else if (port.owner.type === 'stb') { f.state = 'buffered'; f.timer = STB_DWELL * (0.3 + rndD() * 0.7); }
    else { f.state = 'processing'; f.timer = procTime * (0.7 + rndD() * 0.6); completed++; }
    log(`🧑‍🔧 ${v.id} 清貨：人員把 ${f.id} 放到 ${port.name}`);
  } else {
    setFoupMatrix(f, new THREE.Matrix4().makeScale(0, 0, 0)); f.state = 'cart'; f.port = null;
    cartFoups.push({ f, back: simTime + 300 });
    log(`🛒 ${v.id} 清貨：人員把 ${f.id} 放到推車（人工處理，約 5 分鐘後送回 STB）`);
  }
  v.job = null; v.op = null; v.state = 'idle'; v.route = []; v.target = null;
  if (port) port.e84 = null;
  hmiMsg('清貨完成。接著夾爪開極限 → 捲揚、側移回原點 → 歸原點');
}
function cartTick() {
  for (let i = cartFoups.length - 1; i >= 0; i--) {
    const c = cartFoups[i]; if (simTime < c.back) continue;
    const p = ports.find(q => q.owner.type === 'stb' && !q.foup && !q.reserved && usable(q)); if (!p) continue;
    cartFoups.splice(i, 1);
    placeFoupAt(c.f, p); p.foup = c.f; c.f.port = p; c.f.state = 'buffered'; c.f.timer = STB_DWELL * 0.3;
    log(`🛒 人員把推車上的 ${c.f.id} 送回 ${p.name}`);
  }
}
// ---------- 按住寸動：每一幀檢查互鎖，條件不成立就停 ----------
const HOLD_SPD = { walk: 0.3, hoist: 0.45, shift: 0.3 };
const HOLD_NAME = { walk: ['後退', '前進'], hoist: ['上升', '下降'], shift: ['右移', '左移'], rot: ['右旋', '左旋'] };
function holdBlock(v, ax, dir) {                                         // 回傳擋下來的原因；可以動就回傳 null
  if (ax === 'walk') {
    if (dir < 0) return '教學版只開放「前進」寸動（軌道是單向的）';
    if (!ON_HOME(v)) return '捲揚／側移不在原點，禁止走行（會撞到東西）';
    if (v.guard > 0.01 && v.carry) return '有貨時防墜要先「伸出」才能走行';
  }
  if (ax === 'hoist') {
    if (Math.abs(v.shift) > 0.002 && Math.abs(v.shift) < STB_OFFSET - 0.01) return '側移在半途，捲揚不能動';
    if (v.guard < 0.99 && dir > 0) return '防墜還伸著，捲揚下降會撞到。請先「收合」防墜';
    if (dir < 0 && v.hoist <= 0) return '捲揚已經在上極限（原點）';
    if (dir > 0 && v.hoist >= H - 1.2) return '捲揚已經到下極限';
  }
  if (ax === 'shift') {
    if (v.hoist > 0.05) return '捲揚不在原點，側移不能動';
    if (Math.abs(v.shift) >= STB_OFFSET - 1e-4 && Math.sign(v.shift) === dir) return '側移已經到極限';
  }
  if (ax === 'rot') return '這個機型取放貨不旋轉 FOUP，旋轉軸固定在原點';
  return null;
}
// 寸動時前面是休息中的空車：跟自動行駛一樣「推」它往前讓路
function pushParked(v, lead) { if (!lead || !(lead.parked || lead.pushT > 0) || lead.fault || lead.manual) return false; lead.pushT = 3; lead.pushedBy = v.id; return true; }
function hmiHoldStart(v, ax, dir) {
  hmiInit(v); if (!needManual(v, ax)) return;
  const why = holdBlock(v, ax, dir); if (why) return hmiMsg(why);
  if (ax === 'walk') v.man.jog = 0; else delete v.man[ax];
  v.man.hold = { ax, dir }; v.manTouched = true;
  hmiMsg(`${AXIS_NAME[ax]}${HOLD_NAME[ax][dir > 0 ? 1 : 0]}中（按住移動，放開停止）`);
}
function holdStep(v, h, dt) {
  const why = holdBlock(v, h.ax, h.dir); if (why) { hmiMsg(why); return false; }
  const step = HOLD_SPD[h.ax] * dt;
  if (h.ax === 'walk') {
    const { gap, lead } = leaderInfo(v, pathAhead(v, LOOK)), mv = Math.min(step, Math.max(0, gap - MIN_GAP - 0.05));
    if (mv <= 0) { if (pushParked(v, lead)) return true; hmiMsg('前方有車，寸動停止'); return false; }
    advance(v, mv); v.odo += mv;
    const a = vAlarm(v); if (a && a.codeCleared) { a.jogDist = (a.jogDist || 0) + mv; if (a.jogDist >= 0.3) a.jogged = true; }
  } else if (h.ax === 'hoist') { v.hoist = Math.max(0, Math.min(H - 1.2, v.hoist + h.dir * step)); v.hv = 0; }
  else if (h.ax === 'shift') v.shift = Math.max(-STB_OFFSET, Math.min(STB_OFFSET, v.shift + h.dir * step));
  return true;
}
// ---------- 前手／後手（山形上下手）顯示 ----------
function handLamp(v) { handInit(v); return v.hf === v.hr ? '山形' + handName(v.hf) : `前手${v.hf === 'down' ? '下' : '上'}・後手${v.hr === 'down' ? '下' : '上'}`; }
function handRows(v) {
  handInit(v); const [fc, rc] = bogieInCurve(v), sw = v.handSw;
  const row = (k, nm, cur, inCurve) => `<tr><th>${nm}</th><td colspan="4" class="mut">${sw && (sw.which === 'both' || sw.which === k) ? `換手中 → ${handName(sw.to)}` : handName(cur)} · <span class="${inCurve ? 'curveOn' : ''}">${nm === '前手' ? '前車' : '後車'}${inCurve ? '入彎' : '直線'}</span>${v.handNeed && k === 'f' ? `（下一個分岔要${handName(v.handNeed)}）` : ''}</td>
    <td class="ops"><button data-a="hand:${k}:up">上手</button><button data-a="hand:${k}:down">下手</button></td><td></td></tr>`;
  return row('f', '前手', v.hf, fc) + row('r', '後手', v.hr, rc);
}
function hmiTick(dt) {
  if (cartFoups.length) cartTick();
  for (const v of vehicles) {
    detailSample(v, dt);
    if (v.manual && v.handSw) handTick(v, dt);
    if (!v.manual || v.estop || !v.man) continue;
    if (v.detailMove) { detailTick(v, dt); continue; }
    if (v.homing) { stepHoming(v, dt); continue; }
    const m = v.man, mv = (cur, tgt, spd) => cur + Math.sign(tgt - cur) * Math.min(Math.abs(tgt - cur), spd * dt);
    if (m.hoist !== undefined) { v.hoist = mv(v.hoist, m.hoist, 0.45); v.hv = 0; if (v.hoist === m.hoist) delete m.hoist; }
    if (m.shift !== undefined) { v.shift = mv(v.shift, m.shift, 0.3); if (v.shift === m.shift) delete m.shift; }
    if (m.guard !== undefined) { v.guard = mv(v.guard, m.guard, 1 / GUARD_TIME); if (v.guard === m.guard) delete m.guard; }
    if (m.claw !== undefined) { v.claw = mv(v.claw, m.claw, 1 / CLAW_TIME); if (v.claw === m.claw) delete m.claw; }
    if (m.hold && !holdStep(v, m.hold, dt)) m.hold = null;
    if (m.jog > 0) {                                                     // 走行寸動：慢慢往前，前車太近就停
      const { gap, lead } = leaderInfo(v, pathAhead(v, LOOK));
      const step = Math.min(m.jog, 0.3 * dt, Math.max(0, gap - MIN_GAP - 0.05));
      if (step <= 0 && pushParked(v, lead)) { /* 前面是休息中的空車：叫它往前讓 */ }
      else if (step <= 0) { m.jog = 0; hmiMsg('前方有車，寸動停止'); }
      else { advance(v, step); v.odo += step; m.jog -= step; const a = vAlarm(v); if (a && a.codeCleared) { a.jogDist = (a.jogDist || 0) + step; if (a.jogDist >= 0.3) a.jogged = true; } }
    }
  }
}

// ---------- 歸原點：所有機構依序做一次原點校正 ----------
//   每一軸先回到原點附近，再「慢速找原點感測器」：稍微離開、再慢慢回來，碰到原點感測器就把位置歸零。
//   順序：捲揚（先把吊帶收回，其他機構才能安全動）→ 側移 → 旋轉 → 夾爪 → 防墜 → 走行位置歸零（重讀條碼）
function homingPlan(v) {
  const q = [];
  const ax = (k, lbl, ...pts) => pts.forEach(([to, spd]) => q.push({ k, lbl, to, spd }));
  ax('hoist', '捲揚回原點', [0, 0.45]); ax('hoist', '捲揚找原點感測器', [0.06, 0.1], [0, 0.04]);
  ax('shift', '側移回原點', [0, 0.3]); ax('shift', '側移找原點感測器', [0.05, 0.08], [0, 0.03]);
  ax('rot', '旋轉找原點感測器', [0.08, 0.1], [0, 0.04]);
  if (v.carry) q.push({ k: 'note', lbl: '夾爪有貨：不開爪，只確認夾爪閉合訊號' });
  else ax('claw', '夾爪開閉校正', [1, 1 / CLAW_TIME], [0, 1 / CLAW_TIME]);
  ax('guard', '防墜收合／伸出校正', [1, 1 / GUARD_TIME], [0, 1 / GUARD_TIME]);
  q.push({ k: 'enc', lbl: '走行位置歸零（重讀條碼）', t: 1.2 });
  return q;
}
function startHoming(v) {
  if (v.estop) return hmiMsg('緊急停止中，不能歸原點');
  { const [fc, rc] = bogieInCurve(v); if (fc || rc) return hmiMsg(`${fc ? '前車' : '後車'}在彎道內，不能歸原點（先用走行寸動把車移出彎道）`); }
  if (!v.manual) return hmiMsg('要先切「手動」才能歸原點');
  const a = vAlarm(v); if (a && !a.codeCleared) return hmiMsg('異常碼還沒清除，請先按「警報清除」');
  const off = ['walk', 'hoist', 'shift', 'rot', 'claw'].filter(k => !v.servo[k]);
  if (off.length) return hmiMsg(`${off.map(k => AXIS_NAME[k]).join('、')}伺服 Off，無法歸原點，請先伺服 On`);
  v.man = {}; v.manTouched = true;
  const plan = a && a.noRecover ? [{ k: 'fail', lbl: '走行找原點／重讀條碼', t: 2 }] : homingPlan(v);
  v.homing = { q: plan, n: plan.length, i: 0, t: 0 };
  log(`🛠 ${v.id} 歸原點：所有機構依序做原點校正`);
  hmiMsg('歸原點開始：捲揚 → 側移 → 旋轉 → 夾爪 → 防墜 → 走行位置歸零');
}
function stepHoming(v, dt) {
  const h = v.homing, it = h.q[0];
  if (!it) { v.homing = null; v.homed = simTime; log(`✔ ${v.id} 歸原點完成`); if (hmiV === v) hmiMsg('✔ 原點成功：所有機構都在原點。接著可以切上線'); return; }
  h.label = it.lbl;
  const mv = (cur, tgt, spd) => cur + Math.sign(tgt - cur) * Math.min(Math.abs(tgt - cur), spd * dt);
  let done = false;
  if (it.k === 'fail') {                                                  // 驅動器沒回應：原點失敗，天車無法復歸
    h.t += dt; if (h.t < it.t) return;
    v.homing = null; const a = vAlarm(v); if (a) a.homeFailed = true;
    log(`✖ ${v.id} 歸原點失敗：走行驅動器沒有回應，天車無法復歸`);
    if (hmiV === v) hmiMsg('✖ 原點失敗：走行驅動器沒有回應，天車無法復歸。依步驟清貨後推車到維修區'); return;
  }
  if (it.k === 'note' || it.k === 'enc') {
    h.t += dt;
    if (h.t >= (it.t || 0.6)) { if (it.k === 'enc') v.encZero = v.odo || 0; done = true; h.t = 0; }
  } else {
    const key = it.k === 'rot' ? 'rot' : it.k;
    const cur = v[key] || 0, nv = mv(cur, it.to, it.spd);
    v[key] = nv; if (key === 'hoist') v.hv = 0;
    done = nv === it.to;
  }
  if (done) { h.q.shift(); h.i++; }
}

// ---------- 按鈕動作 ----------
let hmiV = null, hmiTab = 'main', hmiMsgText = '', hmiMsgT = 0;
function hmiMsg(t) { hmiMsgText = t; hmiMsgT = simTime; renderHmi(); }
function needManual(v, axis) {
  if (v.detailMove) { hmiMsg('詳細操作執行中，請先停止該軸'); return false; }
  if (v.estop) { hmiMsg('緊急停止中，所有動作禁止。請先「解除急停」'); return false; }
  if (!v.manual) { hmiMsg('要先切「手動」才能操作各軸'); return false; }
  const a = vAlarm(v);
  if (a && !a.codeCleared) { hmiMsg('異常碼還沒清除，請先按「警報清除」'); return false; }
  if (axis && !v.servo[axis]) { hmiMsg('這一軸的伺服是 OFF，請先按「伺服 On」'); return false; }
  return true;
}
function hmiAct(act) {
  const v = hmiV; if (!v) return; hmiInit(v);
  if (act.startsWith('detail:')) return detailAct(v, act);
  if (v.detailMove) {
    if (['stop', 'estop'].includes(act) || act.includes(':off')) detailStop(v, '已停止');
    else if (!['find', 'offline'].includes(act)) return hmiMsg('詳細操作執行中，請先停止該軸');
  }
  const a = vAlarm(v), [kind, axis] = act.split(':');
  switch (kind) {
    case 'manual':
      if (v.manual) return hmiMsg('已經是手動模式');
      if (v.v > 0.05 && !v.fault) return hmiMsg('天車行駛中不能切手動，請等它停下來（或先按急停）');
      v.manual = true; v.v = 0; log(`🛠 ${v.id} 切手動（現場操作）`); return hmiMsg('已切手動：天車停止自動運行，可以操作各軸');
    case 'auto': return hmiAuto(v, a);
    case 'clear':
      if (!a) return hmiMsg('目前沒有異常碼');
      if (a.autoRec) return hmiMsg('天車正在自動復歸，請等它結果（自動復歸失敗才需要人工）');
      if (v.estop) return hmiMsg('緊急停止還沒解除，警報清不掉');
      if (recList(a)[0] === 'confirm' && !a.confirmed) return hmiMsg('請先確認現場安全（排除步驟第 1 項按「確認」）');
      a.codeCleared = true; v.manual = true; v.v = 0;
      log(`🛠 ${v.id} 警報清除（${a.info.code}），天車切手動`); return hmiMsg('異常碼已清除，天車已切成手動。依照排除步驟繼續');
    case 'confirm': if (a) { a.confirmed = true; hmiMsg('已確認現場安全'); } return;
    case 'estop':
      if (v.estop) {                                                   // 解除急停
        v.estop = false; log(`🛠 ${v.id} 解除緊急停止`); return hmiMsg('已解除急停。接著按「警報清除」（天車切手動）');
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
      if (axis === 'all') return startHoming(v);                       // 歸原點：所有機構依序校正
      if (!needManual(v, axis)) return;
      v.manTouched = true;
      if (axis === 'all') return startHoming(v);
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
      if (!open && a && a.clawUnknown && v.carry) return hmiMsg('夾爪狀態不明，不能確定 FOUP 有沒有夾牢。請先清貨（把 FOUP 放到推車或機台上）');
      if (open && v.carry && v.state !== 'release') return hmiMsg('⚠ 夾爪上有 FOUP 而且不在放貨位置，禁止開爪（FOUP 會掉下去）');
      v.manTouched = true; v.man.claw = open ? 0 : 1; return hmiMsg(`夾爪${open ? '開' : '閉'}`);
    }
    case 'guard': {
      if (!needManual(v)) return;
      if (axis === 'out' && v.hoist > 0.05) return hmiMsg('吊帶還放著，防墜不能伸出（會夾到吊帶）');
      v.manTouched = true; v.man.guard = axis === 'out' ? 0 : 1; return hmiMsg(`防墜${axis === 'out' ? '伸出' : '收合'}`);
    }
    case 'stop': if (v.man || v.homing) { v.man = {}; if (v.homing) { v.homing = null; log(`🛠 ${v.id} 歸原點中斷`); } hmiMsg('停止：所有手動動作停止'); } return;
    case 'find': setFollow(v); return hmiMsg(`尋車：鏡頭跟隨 ${v.id}`);
    case 'online': {                                                       // 切上線：手動或有異常時，先檢查條件切回自動，再上線
      if (v.manual || a) { hmiAuto(v, a); if (v.manual || vAlarm(v)) return; }
      setOffline(v, false); hmiMsg('已切上線：天車恢復自動、重新接任務 ✔'); return;
    }
    case 'cargo': return hmiCargo(v, a, axis);
    case 'push': {
      if (!a || !a.homeFailed) return hmiMsg('只有「歸原點失敗、天車無法復歸」時才需要推車');
      const miss = NO_RECOVER.filter(s => s !== 'push' && !stepDone(v, a, s));
      if (miss.length) return hmiMsg(`還不能推車，還沒完成：${STEP_TXT[miss[0]]}`);
      if (v.job) { const j = v.job, i = jobs.indexOf(j); if (j.to.reserved) j.to.reserved = false; if (j.from.e84 === v) j.from.e84 = null; if (j.to.e84 === v) j.to.e84 = null;
        if (j.foup.port) j.foup.state = 'ready'; j.foup.job = null; if (i >= 0) jobs.splice(i, 1); log(`✕ ${v.id} 無法復歸，取消 ${j.foup.id} 的搬運（重新派車）`); }
      v.job = null; v.op = null; v.state = 'idle'; v.route = []; v.target = null; v.guard = 0; v.claw = 0;
      v.manual = false; v.man = {}; v.manTouched = false; v.offline = true; v.pushed = true;
      a.manualFixed = true; clearAlarm(a); requestMaint(v, 'repair');
      log(`🧑‍🔧 ${v.id} 無法復歸：人員把天車推往維修區（天車已下線）`);
      return hmiMsg('推車中：人員慢慢把天車推到維修區，後面的車跟在後面。修好回到軌道後仍是下線，確認後再切上線');
    }
    case 'hand': {                                                    // hand:need（前後手一起）、hand:f:up、hand:r:down…
      if (!needManual(v, 'walk')) return;
      handInit(v); if (v.handSw) return hmiMsg('換手中，等它完成');
      const which = axis === 'need' ? 'both' : axis, to = axis === 'need' ? (v.handNeed || 'up') : act.split(':')[2];
      const [fc, rc] = bogieInCurve(v);
      if ((which !== 'r' && fc) || (which !== 'f' && rc)) return hmiMsg(`${(which !== 'r' && fc) ? '前車' : '後車'}在彎道內，不能換手`);
      const nm = which === 'f' ? '前手' : which === 'r' ? '後手' : '前、後手';
      if (which === 'both' ? handsAre(v, to) : v[which === 'f' ? 'hf' : 'hr'] === to) return hmiMsg(`${nm}已經是${handName(to)}`);
      v.handSw = { to, t: HAND_TIME, which }; v.manTouched = true; return hmiMsg(`${nm}換手中 → ${handName(to)}`);
    }
    case 'offline': setOffline(v, true); return renderHmi();
  }
}
const AXIS_NAME = { walk: '走行', hoist: '捲揚', shift: '側移', rot: '旋轉', claw: '夾爪', all: '各軸' };

// 切自動：檢查排除步驟都做完、各軸在原點，才讓天車恢復
function hmiAuto(v, a) {
  if (!v.manual && !a) return hmiMsg('已經是自動模式');
  if (v.estop) return hmiMsg('緊急停止還沒解除');
  if (v.homing) return hmiMsg('歸原點還在進行，等它完成');
  { const [fc, rc] = bogieInCurve(v); if (fc || rc) return hmiMsg(`${fc ? '前車' : '後車'}在彎道內，不能切上線／切自動（先用走行寸動把車移出彎道）`); }
  if (a) {
    if (a.homeFailed) return hmiMsg('原點失敗、天車無法復歸，不能切上線。請清貨後「推車」送維修區');
    const miss = recList(a).filter(s => s !== 'auto' && s !== 'online' && !stepDone(v, a, s));
    if (miss.length) return hmiMsg(`還不能切自動，還沒完成：${STEP_TXT[miss[0]]}`);
  }
  if (!v.servo.walk || !v.servo.hoist || !v.servo.shift) return hmiMsg('有軸的伺服是 Off，請先全部 On');
  const transferring = TRANSFERRING.includes(v.state);
  const tp = transferPort(v);
  if (transferring && tp && tp.owner.type === 'machine' && !hoAvbl(tp)) return hmiMsg('機台的 HO_AVBL 還是 OFF（機台異常或光閘被擋），不能取放貨');
  if (v.manTouched || !transferring) {
    if (!ON_HOME(v)) return hmiMsg('捲揚／側移不在原點，請先按「歸原點」');
    if (!transferring && v.guard > 0.01) return hmiMsg('防墜還是收合的，請先「伸出」（或按歸原點）');
  }
  if (a) { a.manualFixed = true; clearAlarm(a); }
  if (transferring && v.manTouched) {                                   // 各軸被動過：取放貨從頭再做一次
    if (v.carry && v.op === 'pick') v.state = 'guardClose';            // 已經夾到貨：直接收尾、去放貨
    else {
      v.claw = v.carry ? 1 : 0;
      if (tp && tp.owner.type === 'machine') { v.state = 'e84'; v.timer = 0; v.e84Wait = 0; tp.e84 = v; }   // 機台 Load Port：重新做一次 E84 交握
      else v.state = 'guardOpen';
    }
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
function closeHmi() { if (hmiV && hmiV.detailMove) detailStop(hmiV, '視窗已關閉，動作停止'); document.getElementById('hmi').style.display = 'none'; hmiV = null; }
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
function hmiData(v) {
  const p = v.group.position, a = vAlarm(v), j = v.job;
  return {
    a, code: a && !a.codeCleared ? a.info.code : '0',
    status: v.estop ? '緊急停止' : a && a.autoRec ? '自動復歸中' : a && !a.codeCleared ? '異常停止' : a ? '手動復歸中' : v.homing ? '歸原點中' : v.manual ? '手動模式' : v.state === 'idle' ? (v.parked ? '自動待機' : '自動巡航') : TRANSFERRING.includes(v.state) ? '自動取放中' : '自動運行',
    cmd: j ? `T${String(j.id).padStart(6, '0')}` : '—', step: stateText(v), mode: v.manual ? 'Manual 模式' : 'Auto 模式',
    from: j ? j.from.name : '—', to: j ? j.to.name : '—', moveTo: v.target ? `${10000 + v.target.seg.to.id}` : '—', lot: j ? j.foup.id : '—',
    run: v.v > 0.02 ? 'moving' : 'stop', addr: 10000 + v.seg.to.id, sect: 1000 + v.seg.id, dist: Math.round(v.d * 1000),
    claw: v.claw > 0.99 ? (v.carry ? '閉極限（有貨）' : '閉極限') : v.claw < 0.01 ? '開極限' : a && a.clawUnknown && !(v.man && v.man.claw !== undefined) && !v.homing ? '狀態不明' : '動作中', carry: v.carry ? v.carry.id : 'none',
    barcode: f1(v.seg.id * 1000 + v.d * 100), enc: f1((((v.odo || 0) - (v.encZero || 0)) * 100) % 100000), x: f1(p.x * 1000), y: f1(p.z * 1000),
  };
}
const fld = (label, val, cls = '') => `<div class="hf"><span>${label}</span><b class="${cls}">${val}</b></div>`;
// 寸動按鈕：按住才動、放開就停（data-hold）；導覽示範用 click()（data-a）時改成動一小段
const holdBtns = (v, ax, list) => list.map(([d, n]) => `<button class="hold ${v.man && v.man.hold && v.man.hold.ax === ax && v.man.hold.dir === d ? 'holding' : ''}" data-hold="${ax}:${d}" data-a="jog:${ax}:${d}" title="按住移動，放開停止">${n}</button>`).join('');
function axisRow(v, ax, name, pos, spd, code, btns) {
  const hk = v.homing && v.homing.q[0] && v.homing.q[0].k;
  const busy = (v.man && ((ax === 'walk' && v.man.jog > 0) || v.man[ax] !== undefined || (v.man.hold && v.man.hold.ax === ax))) || hk === ax || (ax === 'walk' && hk === 'enc');
  return `<tr><th>${name}</th>
    <td><button class="svl ${v.servo[ax] ? 'on' : 'off'}" data-a="servo:${ax}:${v.servo[ax] ? 'off' : 'on'}" title="伺服：正常是綠色 On；只有這一軸伺服異常（跳脫）才會自己變紅色 Off，清完警報再按 On">${v.servo[ax] ? 'On' : 'Off'}</button></td>
    <td class="num">${pos}</td><td class="num">${spd}</td><td><b class="code ${code !== '0' ? 'bad' : ''}">${code}</b></td>
    <td class="ops">${btns}</td><td><span class="done ${busy ? '' : 'ok'}">${busy ? '動作中' : '完成'}</span></td></tr>`;
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
  if (hmiHold || (document.activeElement && document.activeElement.closest('#hmi input, #hmi select'))) return;
  const v = hmiV; if (!vehicles.includes(v)) return closeHmi();
  const d = hmiData(v), a = d.a, t = Math.floor(simTime);
  const time = `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const sel = `<select id="hmiSel">${vehicles.map(u => `<option ${u === v ? 'selected' : ''}>${u.id}</option>`).join('')}</select>`;
  let body = '';
  if (hmiTab === 'main') {
    body = `<div class="hmain"><div class="hbox"><h5>天車上位命令狀態</h5>${fld('上位命令 ID', d.cmd)}${fld('狀態', d.status, 'w')}${fld('步驟', d.step, 'w')}${fld('模式', d.mode, v.manual ? 'w red' : 'w red')}
      ${fld('從', v.seg.from.id + 10000)}${fld('取貨站', d.from)}${fld('移動到', d.moveTo)}${fld('放貨站', d.to)}${fld('目標貨物 ID', d.lot)}
      <h5>天車回傳狀態</h5>${fld('走行狀態', d.run, 'w')}${fld('Address', d.addr)}${fld('Section', d.sect)}${fld('Distance', d.dist)}${fld('夾爪狀態', d.claw, 'w')}${fld('山形上下手', v.handSw ? '換手中' : `前${handName(v.hf)}／後${handName(v.hr)}`, 'w')}${fld('前車／後車', (([fc, rc]) => `${fc ? '入彎' : '直線'}／${rc ? '入彎' : '直線'}`)(bogieInCurve(v)), 'w')}${fld('實際貨物 ID', d.carry)}${e84Panel(v)}</div>
      <div class="hpic">${vehicleSvg(d, v)}</div>
      <div class="hcol"><button class="estop ${v.estop ? 'on' : ''}" data-a="estop"><span>${v.estop ? '解除急停' : 'EMERGENCY STOP'}</span></button>
      <div class="hbox"><h5>天車實際運行資訊</h5>${fld('軟體版本', '教學版 1.0')}${fld('Barcode', d.barcode)}${fld('Encoder', d.enc)}${fld('X 座標', d.x)}${fld('Y 座標', d.y)}${fld('Section ID', d.sect)}${fld('Address ID', d.addr)}${fld(COMM_MODE === 'mesh' ? 'Mesh 連線' : '連線 AP', v.ap ? (COMM_MODE === 'mesh' ? `${v.ap.id}（${v.meshHops} 跳、${Math.round(v.meshLat || 0)} ms）` : v.ap.id) : '—')}</div></div></div>`;
  } else if (hmiTab === 'detail') {
    body = renderDetail(v, d);
  } else if (hmiTab === 'quick') {
    const ac = AXIS_OF_CODE[a && a.info.code], code = ax => ac === ax ? d.code : '0';
    const io = [['IN-08 在席檢知', !!v.carry], ['IN-07 過物檢知', false], ['IN-06 吊帶張力 1', !(a && a.info.code === 'E-203')], ['IN-05 吊帶張力 2', true], ['IN-04 吊帶張力 3', true],
      ['IN-02 夾爪閉極限', v.claw > 0.99], ['IN-03 夾爪開極限', v.claw < 0.01], ['前車入彎', bogieInCurve(v)[0]], ['後車入彎', bogieInCurve(v)[1]], ['前手上手', v.hf === 'up' && !(v.handSw && v.handSw.which !== 'r')], ['前手下手', v.hf === 'down' && !(v.handSw && v.handSw.which !== 'r')], ['後手上手', v.hr === 'up' && !(v.handSw && v.handSw.which !== 'f')], ['後手下手', v.hr === 'down' && !(v.handSw && v.handSw.which !== 'f')], ['IN-01 偏擺檢知', false], ['前防墜收合', v.guard > 0.99], ['前防墜伸出', v.guard < 0.01], ['後防墜收合', v.guard > 0.99], ['後防墜伸出', v.guard < 0.01]];
    body = `<div class="hquick"><div>
      <table class="axt"><tr><th>軸</th><th>伺服</th><th>目前位置</th><th>速度</th><th>異常碼</th><th>操作</th><th></th></tr>
      ${axisRow(v, 'walk', '走行', d.enc, f1(v.v * 1000), code('walk'), holdBtns(v, 'walk', [[1, '前進'], [-1, '後退']]))}
      ${axisRow(v, 'hoist', '捲揚', f1(-v.hoist * 1000), f1(v.man && v.man.hoist !== undefined ? 450 : 0), code('hoist'), `<button data-a="home:hoist">原點</button>` + holdBtns(v, 'hoist', [[1, '下降'], [-1, '上升']]))}
      ${axisRow(v, 'shift', '側移', f1(v.shift * 1000), f1(v.man && v.man.shift !== undefined ? 300 : 0), code('shift'), `<button data-a="home:shift">原點</button>` + holdBtns(v, 'shift', [[1, '左移'], [-1, '右移']]))}
      ${axisRow(v, 'rot', '旋轉', f1((v.rot || 0) * 1000), '0', '0', `<button data-a="jog:rot:0">原點</button>` + holdBtns(v, 'rot', [[1, '左旋'], [-1, '右旋']]))}
      ${axisRow(v, 'claw', '夾爪', v.claw > 0.99 ? '閉極限' : v.claw < 0.01 ? '開極限' : f1(-v.claw * 3000), '0', code('claw'), `<button data-a="claw:open">開極限</button><button data-a="claw:close">閉極限</button>`)}
      ${handRows(v)}
      <tr><th>防墜</th><td colspan="4" class="mut">${v.guard < 0.01 ? '伸出（托住）' : v.guard > 0.99 ? '收合' : '動作中'}</td><td class="ops"><button data-a="guard:out">伸出</button><button data-a="guard:in">收合</button></td><td></td></tr>
      <tr><td colspan="7" class="stopRow"><button data-a="stop">■ 停止所有手動動作</button></td></tr></table>
      <details class="iod"><summary>I/O 感測器</summary><div class="io">${io.map(([n, on]) => `<div class="${on ? 'on' : ''}"><span>${n}</span></div>`).join('')}</div></details></div>
      <div class="hcol">${recoveryBox(v, a)}<button class="estop small ${v.estop ? 'on' : ''}" data-a="estop"><span>${v.estop ? '解除急停' : 'E-STOP'}</span></button></div></div>`;
  } else body = `<div class="hempty">教學版沒有開放這個畫面。現場異常排除請用「快速操作」。</div>`;
  const tabs = [['main', '主畫面'], ['quick', '快速操作（異常排除）'], ['detail', '詳細操作']];
  el.innerHTML = `<div class="hwin" style="${hmiPos ? `left:${hmiPos[0]};top:${hmiPos[1]};transform:none` : ''}"><div class="hhead">
      <div class="hid">車號 <b class="no">${v.id}</b>${sel}</div>
      <div class="big ${a ? 'alarm' : ''}">${d.status}</div>
      <div class="lamps">
        <div class="lamp ${v.homing ? 'blinkL' : ON_HOME(v) ? '' : 'dim'}" title="指示燈：全軸在原點時亮綠燈；歸原點中閃爍">原點</div>
        <div class="lamp ${v.handSw ? 'blinkL man' : v.manual ? 'man' : ''}" title="指示燈：山形上手／下手（黃＝手動模式）">${v.handSw ? '換手中' : handLamp(v)}</div>
        <div class="lamp ${commOk(v) ? '' : 'off'}" title="指示燈：跟控制系統連線正常時亮綠燈">連線</div></div>
      <button class="hclose" id="hmiClose" title="關閉">✕</button></div>
    <div class="htool">
      <span class="tg">模式</span><button data-a="manual" ${v.manual ? 'disabled' : ''}>天車切手動</button><button data-a="auto" ${!v.manual && !a ? 'disabled' : ''}>天車切自動</button>
      <span class="sep"></span><span class="tg">線上</span><button data-a="offline" ${v.offline ? 'disabled' : ''}>下線</button><button data-a="online" ${v.offline || v.manual || a ? '' : 'disabled'}>上線</button>
      <span class="sep"></span><button data-a="find">尋車</button><button data-a="home:all">歸原點</button>
      <span class="hinfo">IP 10.0.1.${10 + vehicles.indexOf(v)}（示意）· ${time}</span></div>
    <div class="htabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${hmiTab === k ? 'cur' : ''}">${n}</button>`).join('')}</div>
    <div class="hbody">${body}</div>
    <div class="hmsg"><span>🔔</span><div>${v.homing ? `⟳ 歸原點中（${v.homing.i + 1}／${v.homing.n}）：${v.homing.label || ''}` : hmiMsgText || (a ? `${a.info.code} ${a.info.title}` : '')}</div><button data-a="clear" class="aclr">警報清除</button></div>
    </div>`;
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
    if (b.dataset.hold && e.detail > 0) return;                         // 真的滑鼠點：已經由按住／放開處理
    hmiHold = false; hmiAct(b.dataset.a);
  });
  // 按住寸動按鈕才動，放開（或滑鼠離開視窗）就停
  el.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-hold]'); if (!b || b.disabled || !hmiV || e.button > 0) return;
    e.preventDefault(); const [ax, dir] = b.dataset.hold.split(':'); hmiHoldStart(hmiV, ax, +dir); hmiHold = false;
  });
  const stopHold = () => { const v = hmiV; if (v && v.man && v.man.hold) { v.man.hold = null; renderHmi(); } };
  window.addEventListener('pointerup', stopHold); window.addEventListener('pointercancel', stopHold); window.addEventListener('blur', stopHold);
  // 拖曳標題列可以移動視窗（讓出畫面看天車）
  let drag = null;
  el.addEventListener('pointerdown', e => { if (e.target.closest('.hhead') && !e.target.closest('button,select')) { const w = el.querySelector('.hwin').getBoundingClientRect(); drag = [e.clientX - w.left, e.clientY - w.top]; } });
  window.addEventListener('pointermove', e => { if (!drag) return; const w = el.querySelector('.hwin'); w.style.left = (e.clientX - drag[0]) + 'px'; w.style.top = (e.clientY - drag[1]) + 'px'; w.style.transform = 'none'; hmiPos = [w.style.left, w.style.top]; });
  window.addEventListener('pointerup', () => { drag = null; });
  el.addEventListener('change', e => { if (e.target.id === 'hmiSel') { if (hmiV && hmiV.detailMove) detailStop(hmiV, '切換車輛，動作停止'); hmiV = vehicles.find(u => u.id === e.target.value); hmiInit(hmiV); hmiMsgText = ''; e.target.blur(); renderHmi(); } });
}
// E84 訊號燈：天車送出的、機台送來的（教學用，照目前的取放步驟推算）
function e84Signals(v) {
  const p = transferPort(v), atMachine = p && (p.owner.type === 'machine' || p.owner.type === 'ntb') && (v.state === 'e84' || TRANSFERRING.includes(v.state));
  const S = { VALID: 0, CS_0: 0, TR_REQ: 0, BUSY: 0, COMPT: 0, L_REQ: 0, U_REQ: 0, READY: 0, HO_AVBL: p && (p.owner.type === 'machine' || p.owner.type === 'ntb') ? +hoAvbl(p) : 0, ES: 1 };
  if (!atMachine) return { S, p: atMachine ? p : null };
  const st = v.state, req = v.op === 'pick' ? 'U_REQ' : 'L_REQ', k = v.state === 'e84' ? Math.floor(v.timer / E84_TIME * 4) : 9;
  if (st === 'e84end') { S.VALID = S.CS_0 = S.COMPT = 1; S.READY = v.timer < E84_END_TIME / 2 ? 1 : 0; return { S, p }; }
  if (k >= 0) S.VALID = S.CS_0 = 1;
  if (k >= 1 && S.HO_AVBL) S[req] = 1;
  if (k >= 2 && S.HO_AVBL) S.TR_REQ = 1;
  if (k >= 3 && S.HO_AVBL) S.READY = 1;
  if (st !== 'e84') { S.BUSY = v.fault ? 0 : 1; if ((st === 'raise' || st === 'shiftIn' || st === 'guardClose')) S[req] = 0; }
  return { S, p };
}
function e84Panel(v) {
  const { S, p } = e84Signals(v), lamp = (n, on, bad) => `<span class="e84l ${on ? 'on' : ''} ${bad ? 'bad' : ''}">${n}</span>`;
  if (!p) return `<h5>E84 訊號</h5><div class="mut">不在機台 Load Port 取放貨（STB 儲格不用交握）</div>`;
  return `<h5>E84 訊號（${p.name}）</h5><div class="e84g"><b>天車→機台</b>${['VALID', 'CS_0', 'TR_REQ', 'BUSY', 'COMPT'].map(n => lamp(n, S[n])).join('')}</div>
    <div class="e84g"><b>機台→天車</b>${['L_REQ', 'U_REQ', 'READY', 'HO_AVBL', 'ES'].map(n => lamp(n, S[n], (n === 'HO_AVBL' && !S[n]))).join('')}</div>`;
}
function recoveryBox(v, a) {
  if (!a) return `<div class="hbox rec"><h5>異常排除步驟</h5><p class="mut">這台車目前沒有異常。<br>想練習的話：按 EMERGENCY STOP，或在面板觸發「天車故障停車」「取放貨異常」，再回來這裡排除。</p></div>`;
  if (a.autoRec) return `<div class="hbox rec"><h5>${a.info.code} 自動復歸中…</h5><div class="mut">${a.info.title}</div><p>天車正在自己重試（約 ${Math.ceil(a.autoRec.t)} 秒）。<br>成功的話會自己繼續跑；失敗才需要人工復歸。</p></div>`;
  const steps = recList(a), must = cargoMust(v, a);
  let next = true;
  return `<div class="hbox rec"><h5>人工復歸步驟：${a.info.code}</h5><div class="mut">${a.info.title}${a.autoRecFailed ? '（自動復歸失敗）' : ''}</div><ol>${steps.map(s => {
    const ok = stepDone(v, a, s), cur = !ok && next; if (cur) next = false;
    const extra = s === 'confirm' && !ok ? ` <button data-a="confirm">確認</button>`
      : s === 'cargo' && !ok ? `<div class="cg"><button data-a="cargo:cart">放到推車</button><button data-a="cargo:port">放到 Port 上</button>${must ? '' : '<button data-a="cargo:keep">保留在車上</button>'}</div>${must ? `<div class="must">⚠ 一定要清貨：${must}</div>` : ''}`
      : s === 'push' && cur ? ` <button data-a="push">開始推車</button>`
      : s === 'hand' && !ok ? ` <button data-a="hand:need">切${handName(v.handNeed || 'up')}</button>` : '';
    return `<li class="${ok ? 'ok' : cur ? 'cur' : ''}">${ok ? '✔' : cur ? '➜' : '・'} ${STEP_TXT[s]}${extra}</li>`;
  }).join('')}</ol></div>`;
}
