// simulation.js — 模擬邏輯：路線規劃、天車行走／跟車／匯流讓車、吊掛狀態機、機台加工、派車規則

// ================== 模擬邏輯 ==================
const STATE_TXT = {
  idle: '閒置巡航', toPick: '前往取貨', toDrop: '前往放貨',
  guardOpen: '防墜板收回', shiftOut: '側移伸出', lower: '捲揚下降', grip: '夾爪閉合', release: '夾爪鬆開',
  raise: '捲揚上升', shiftIn: '側移縮回', guardClose: '防墜板揮出',
  e84: 'E84 交握', e84end: 'E84 完成通知',
  toMaint: '前往維修區', maintLower: '捲揚機下降', repair: '地面維修中', maintRaise: '捲揚機上升',
};
const stateText = v => (v.pushed ? '人員推車中｜' : '') + (v.noComm ? '通訊中斷｜' : '') + (v.offline ? '下線｜' : '') + (v.state === 'e84' || v.state === 'e84end' ? e84Text(v) : v.state === 'idle' && v.parked ? '軌道上休息' : v.state === 'idle' && v.pushT > 0 ? `被 ${v.pushedBy || '後車'} 推著前進` :
  (v.op && !['idle', 'toPick', 'toDrop', 'toMaint'].includes(v.state) ? (v.op === 'pick' ? '取｜' : '放｜') : '') + STATE_TXT[v.state]);
function fmt(t) { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return [h, m, s].map(n => String(n).padStart(2, '0')).join(':'); }
function log(msg) { if (typeof eventAdd === 'function') { const words=msg.split(/[^A-Za-z0-9_-]+/); for (const v of vehicles) if(words.includes(v.id)) eventAdd(v, /通訊|Mesh|AP/.test(msg)?'通訊':/派車|任務|搬運|放貨/.test(msg)?'命令':/E84/.test(msg)?'PIO':'操作',msg); } logs.unshift([fmt(simTime), msg]); if (logs.length > 40) logs.pop(); }

// ---------- 路線規劃與行走 ----------
const LOOK = 14;          // 往前看多遠找前車
const MERGE_ZONE = Math.max(7, MAX_HOLD + 3.5);  // 離匯流點多近要先取得「匯流鎖」才能通過（停車距離＋煞車距離）

// 沒拿到鎖的車要停在離匯流點多遠：每個匯流點、每條進來的支線不一樣，開場時算好（network.js 的 n.hold）
const holdOf = nm => nm.node.hold.get(nm.inSeg.id) || 4;

// ---------- 閒置停車（休息）與推車 ----------
//   沒有指令的天車不一直繞圈，而是找個不擋路的地方停在軌道上休息；後面有車要過來，才往前開讓路（推車）
//   可以停的地方：主幹線／連接線，離分岔點夠遠（不會壓到旁邊分支的車）、離下一個匯流點夠遠（不會卡住匯流鎖）
const PUSH_GAP = 3.5, PUSH_TIME = 3;
let pushCount = 0;     // 後車離休息車多近就「推」它；推一次至少往前開幾秒
const MERGE_SET = new Set(mergeNodes);
// 沿預設路線往前，到下一個匯流點的距離，以及是從哪一段進那個匯流點
function nextMergeAhead(seg, d) {
  let dist = seg.len - d, s = seg;
  for (let k = 0; k < 8 && dist < 60; k++) { if (MERGE_SET.has(s.to)) return [dist, s]; s = s.to.def; if (!s) break; dist += s.len; }
  return [Infinity, null];
}
segs.forEach(sg => {
  sg.park = [];
  if (sg.kind !== 'main' && sg.kind !== 'link') return;
  // 起點：剛過分岔點 → 要離開「轉進另一條分支的車」檢查的範圍（n.clr）；剛過匯流點 → 整台車要先離開匯流點（匯流鎖才放得掉）
  let a0 = VLEN / 2 + 0.3;
  for (const o of sg.from.out) if (o !== sg) a0 = Math.max(a0, (sg.from.clr.get(o.id + '>' + sg.id) || 0) + 0.3);
  if (MERGE_SET.has(sg.from)) a0 = Math.max(a0, VLEN + 0.6);
  let a = null, b = null;
  const flush = () => { if (a !== null && b - a >= 0) sg.park.push([a, b]); a = null; };
  for (let d = 0; d <= sg.len - 0.1; d += 0.1) {                     // 不停在段落最尾端（會被算到下一段去）
    // 終點：要停在下一個匯流點的等待線後面（network.js 的 n.hold），不然會跟匯流進來的車重疊
    const [dm, inSeg] = nextMergeAhead(sg, d);
    const ok = d >= a0 && !sg.curveAt(d) && (dm === Infinity || dm >= (inSeg.to.hold.get(inSeg.id) || 4) + 0.3);
    if (ok) { if (a === null) a = d; b = d; } else flush();
  }
  flush();
});
// 在 seg 上 [dMin, dMax] 範圍內找第一個可以停的位置
function parkSpot(seg, dMin, dMax) {
  for (const [a, b] of seg.park) { const d = Math.max(a, dMin); if (d <= b && d <= dMax) return d; }
  return null;
}

// ---------- 山形上下手（導引輪換手）----------
//   天車在分岔點要轉進支線（轉彎）時切「下手」，直行時切「上手」；前、後走行輪在彎道裡時不能換手。
//   要在分岔點前 HAND_LOOK 公尺內換好，來不及就停在分岔點前等。換手偶爾會失敗（E-105，開「隨機自動發生」時才會隨機出現）。
const PUSH_V = 0.35;
const HAND_LOOK = 10, HAND_TIME = 0.6, BOGIE_X = 0.42, HAND_FAIL_P = 0.0003;
let pendingHandFail = false, handSwitches = 0;
const handName = h => h === 'down' ? '下手' : '上手';
function nextDiverge(v, pa) {
  for (const e of pa) if (e.off > 0 && e.seg.from.out.length > 1) return { node: e.seg.from, off: e.off, need: e.seg === e.seg.from.def ? 'up' : 'down' };
  return null;
}
// 前、後走行輪是不是在彎道裡
function bogieInCurve(v, pa) {
  const [fs, fd] = locAlong(v, BOGIE_X, pa || pathAhead(v, BOGIE_X + 0.2)), [rs, rd] = locAlong(v, -BOGIE_X);
  return [fs.curveAt(fd), rs.curveAt(rd)];
}
// 前手、後手各自有上手／下手：v.hf（前）、v.hr（後）；v.hand＝兩手一致時的狀態，不一致是 'mixed'
function handInit(v) { if (!v.hf) { v.hf = v.hr = v.hand && v.hand !== 'mixed' ? v.hand : 'up'; v.hand = v.hf; } }
function handTick(v, dt) {
  handInit(v); const s = v.handSw; if (!s) return;
  s.t -= dt; if (s.t > 0) return;
  if (s.which !== 'r') v.hf = s.to; if (s.which !== 'f') v.hr = s.to;
  v.hand = v.hf === v.hr ? v.hf : 'mixed'; v.handSw = null;
}
const handsAre = (v, h) => (handInit(v), v.hf === h && v.hr === h);
function handCheck(v, pa, dt) {
  handTick(v, dt);
  const nd = nextDiverge(v, pa);
  if (!nd || nd.off > HAND_LOOK) { v.handNeed = null; return Infinity; }
  v.handNeed = nd.need;
  if (handsAre(v, nd.need) && !v.handSw) return Infinity;
  if (!v.handSw) {
    const [fc, rc] = bogieInCurve(v, pa);
    v.handWait = v.v < 0.05 ? (v.handWait || 0) + dt : 0;
    if (!(fc || rc) || v.handWait > 2) {                              // 走行輪不在彎道裡才換（停太久就直接換，避免卡死）
      v.handWait = 0;
      if (pendingHandFail || (autoAlarm && rndA() < HAND_FAIL_P)) { const auto = !pendingHandFail; pendingHandFail = false; raiseHandFail(v, nd.need, auto ? { auto: true } : {}); return 0; }
      v.handSw = { to: nd.need, t: HAND_TIME, which: 'both' }; handSwitches++;
    }
  }
  return nd.off - 0.8;
}

// ---------- 優先級與路權 ----------
//   Lot 有優先級：0 一般、1 急件（Hot Lot）、2 特急（Super Hot）
//   路權：特急載貨 > 特急去取貨 > 急件載貨 > 急件去取貨 > 一般載貨 > 一般去取貨 > 空車（閒置、休息、保養）
const PRI_NAME = ['一般', '急件', '特急'];
const RANK_SEC = 20;      // 路權差一級，等於多等了 20 秒（低路權的車等久了還是輪得到，不會永遠插不進去）
const rankOf = v => v.job ? v.job.pri * 2 + (v.carry ? 2 : 1) : 0;
// 規劃從天車目前位置到 (seg, d) 的路線；太近煞不住的話就繞一圈
function planRoute(v, seg, d) {
  const brake = v.v * v.v / (2 * 2.5 * A) + 0.05;
  if (v.seg === seg && d - v.d >= brake) return { dist: d - v.d, route: [] };
  if (seg.blocked || DIST[v.seg.to.id][seg.from.id] === Infinity) return { dist: Infinity, route: null };   // 軌道封鎖，到不了
  const route = [...segPath(v.seg.to, seg.from), seg];
  return { dist: (v.seg.len - v.d) + DIST[v.seg.to.id][seg.from.id] + d, route };
}
function setTarget(v, port) {
  v.parked = false; v.pushT = 0;
  const p = planRoute(v, port.seg, port.d);
  v.route = p.route || []; v.target = { seg: port.seg, d: port.d };
  return p.route !== null;
}
function distToTarget(v) {
  if (!v.target) return Infinity;
  if (!v.route.length) return v.seg === v.target.seg ? Math.max(0, v.target.d - v.d) : Infinity;
  let d = v.seg.len - v.d; for (let i = 0; i < v.route.length - 1; i++) d += v.route[i].len;
  return d + v.target.d;
}
// 沿路線前進，跨過節點時換到下一段（有路線照路線，沒有就走預設：主幹線）
function advance(v, move) {
  v.d += move; v.dist += move;
  while (v.d > v.seg.len) { const over = v.d - v.seg.len; const next = v.manual ? manualNext(v.seg, v) : v.route.length ? v.route.shift() : nextDefault(v.seg); if (!next || (v.manual && next.blocked)) { v.d = v.seg.len; break; } v.prevSeg = v.seg; v.seg = next; v.d = over; }
}
// 前車：沿自己前方路線找最近的天車；匯流點：另一條支線上離匯流點更近的車先走
function leaderInfo(v, pa) {
  let cd = Infinity, lv = 0, lead = null;
  for (const u of vehicles) if (u !== v) for (const e of pa) {
    let dd = -1;
    if (u.seg === e.seg) dd = e.off + u.d;
    // 剛在分岔點轉進別條路的前車：車尾還壓在分岔點上，車身完全離開之前仍要當成前車
    else if (u.prevSeg === e.seg && u.d < VLEN) dd = e.off + e.seg.len + u.d;
    if (dd > 1e-6 && dd < cd) { cd = dd; lv = u.v; lead = u; }
  }
  // 分岔點：另一條分支剛分出去的那一段，兩條軌道還靠得很近，那裡的車也要當前車
  //   （分支後面可能緊接著別的節點，所以要沿著分支跨好幾段往前找）
  for (const e of pa) {
    const node = e.seg.from; if (node.out.length < 2 || e.off > LOOK) continue;
    for (const sib of node.out) if (sib !== e.seg) {
      // 另一條分支前 clear 公尺內的車會跟自己車身重疊（開場時用車身矩形算好，network.js 的 n.clr）
      const clear = node.clr.get(e.seg.id + '>' + sib.id) || 0;
      let s = sib, off = 0;
      while (s && off < clear) {
        for (const u of vehicles) if (u !== v && u.seg === s && off + u.d < clear) {
          const dd = e.off + off + u.d; if (dd > 1e-6 && dd < cd) { cd = dd; lv = u.v; lead = null; }
        }
        off += s.len; s = s.to.def;
      }
    }
  }
  // 匯流鎖：拿到鎖的車先走；從另一條支線過來的車停在等待線（離匯流點 holdOf 公尺）等
  const nm = v.nextMerge;
  if (nm) {
    const L = nm.node.lock;
    // 跟在持鎖車後面（同一條支線）的車可以一起過——除非另一條支線有車在等（拉鍊式輪流），
    // 這時還沒過等待線的車也要停下來排隊
    const sameBranch = L && L.nextMerge && L.nextMerge.node === nm.node && L.nextMerge.inSeg === nm.inSeg;
    const otherWaiting = nm.node.waitIn && [...nm.node.waitIn].some(sg => sg !== nm.inSeg);
    // 同一支線上持鎖的車排在自己後面時，自己一定要先走，不然它永遠到不了匯流點（死結）
    const mayFollow = sameBranch && (!otherWaiting || nm.dn < holdOf(nm) - 0.3 || nm.dn < L.nextMerge.dn);
    if (L && L !== v && !mayFollow) {
      const wall = nm.dn - holdOf(nm) + MIN_GAP + VLEN;             // 換算成「虛擬前車」：剛好停在等待線處
      if (wall < cd) { cd = wall; lv = 0; lead = null; } v.yielding = true;
    }
  }
  return { gap: cd - VLEN, leadV: lv, lead };
}
// 彎道限速：前方有彎道就提早減速
function curveLimit(v, vTop, pa) {
  const vc = Math.min(vTop, 1.6);
  if (v.seg.curveAt(v.d)) return vc;
  for (let s = 0.5; s <= 8; s += 0.5) { const [sg, d] = locAlong(v, s, pa); if (sg.curveAt(d)) return Math.min(vTop, Math.sqrt(vc * vc + 2 * A * (s - 0.3))); }
  return vTop;
}

function updateVehicle(v, dt) {
  if (v.fault || v.manual || v.estop) { v.v = 0; v.yielding = false; v.waitT = 0; return; }   // 異常中、手動模式：停在原地等人處理（alarms.js、hmi.js）
  if (pendingTransferFault && !pendingTransferFault.nearPort && (pendingTransferFault.clawUnknown ? v.state === 'release' && v.carry : v.state === 'grip' || v.state === 'release')) { raiseTransferFault(v); return; }
  if (pendingTransferFault && pendingTransferFault.nearPort && v.state === 'lower' && v.carry) {   // 教學：在機台放貨、捲揚快到底時停住
    const p = v.job && v.job.to; if (p && p.owner.type === 'machine' && hoistDepth(p) - v.hoist < 0.06) { raiseTransferFault(v); return; } }
  const st = v.state;
  if (st === 'idle' || st === 'toPick' || st === 'toDrop' || st === 'toMaint') {
    if (st === 'idle') {
      if (v.pushT > 0) v.pushT -= dt;
      if (v.target && v.target.seg !== v.seg && !v.route.length) v.target = null;   // 保險：錯過休息位置就重新找
      if (v.parked) {
        if (v.pushT > 0) v.parked = false;                              // 後面有車來了：往前開讓路
        else { v.v = 0; v.waitT = 0; v.yielding = false; return; }      // 休息中
      }
    } else v.parked = false;
    const pa = pathAhead(v, LOOK);
    v.yielding = false;
    let { gap, leadV, lead } = leaderInfo(v, pa);
    v.gapAhead = gap;                                                    // 給狀態燈用：前方有東西停車＝紫燈閃
    // 推車：前面擋路的是休息（或正要停下來休息）的空車，而且自己要開過它的位置 → 叫它往前開
    if (lead && lead.state === 'idle' && !lead.fault && (lead.parked || lead.target) && gap < PUSH_GAP && distToTarget(v) > gap + 0.5) {
      if (lead.parked) { pushCount++; lead.pushedBy = v.id; }        // 次數太多，不寫進紀錄，只統計
      lead.pushT = PUSH_TIME; lead.target = null; lead.route = [];
    }
    // 空車找地方停：在煞得住、又不會撞到前車的範圍裡，找第一個可以停的位置
    if (st === 'idle' && !v.target && !(v.pushT > 0)) {
      const brake = v.v * v.v / (2 * A) + 0.3;
      const pd = parkSpot(v.seg, v.d + brake, gap < Infinity ? v.d + gap - MIN_GAP - 0.1 : Infinity);
      if (pd !== null) { v.target = { seg: v.seg, d: pd }; v.route = []; }
    }
    const hg = handCheck(v, pa, dt);                                   // 山形上下手：分岔點前還沒換好手就停在分岔點前
    if (v.fault) return;
    if (hg < gap) { gap = hg; leadV = 0; }
    const vTop = v.pushed ? PUSH_V : st === 'idle' ? VMAX * 0.7 : VMAX;          // 推車：人員慢慢推
    let lim = curveLimit(v, vTop, pa);
    if (gap < Infinity) { const free = gap - MIN_GAP; lim = Math.min(lim, free > 0 ? Math.sqrt(leadV * leadV + 2 * A * free) : 0); }
    const dT = distToTarget(v);
    if (dT < Infinity) lim = Math.min(lim, Math.max(0.25, Math.sqrt(2 * A * dT)));
    if (v.v < lim) v.v = Math.min(lim, v.v + A * dt); else v.v = Math.max(lim, v.v - 2.5 * A * dt);
    let move = v.v * dt;
    if (gap < Infinity) move = Math.min(move, Math.max(0, gap - 0.25));
    if (move > dT) move = dT;
    if (move < v.v * dt) v.v = move / dt;
    advance(v, move); v.odo = (v.odo || 0) + move;
    v.waitT = v.yielding && v.v < 0.05 ? (v.waitT || 0) + dt : 0;     // 在匯流點前等了多久
    if (v.target && !v.route.length && v.seg === v.target.seg && v.target.d - v.d < 0.003) {
      v.d = v.target.d; v.v = 0; v.target = null;
      if (st === 'idle') { v.parked = true; return; }                 // 到了休息位置：停車
      if (st === 'toMaint') { v.state = 'maintLower'; log(`🔧 ${v.id} 到達捲揚機，連同軌道一起降到地面`); return; }
      if (st === 'toPick') { v.op = 'pick'; waitSum += simTime - v.job.created; waitN++; v.job.pickedAt = simTime;
        waitByPri[v.job.pri][0] += simTime - v.job.created; waitByPri[v.job.pri][1]++; if (benchWaits) benchWaits.push(simTime - v.job.created); }
      else v.op = 'drop';
      const port = v.op === 'pick' ? v.job.from : v.job.to;
      if ((port.owner.type === 'machine' || port.owner.type === 'ntb')) { v.state = 'e84'; v.timer = 0; v.e84Wait = 0; port.e84 = v; }   // 機台 Load Port：先做 E84 交握
      else v.state = 'guardOpen';                                       // STB 是被動的儲格，不用交握
    }
  } else {
    stepTransfer(v, dt);
  }
}

// 捲揚：梯形速度曲線（加速 → 高速 → 減速），最後一小段用低速慢慢靠上去
function hoistMove(v, target, dt) {
  const d = target - v.hoist, dist = Math.abs(d);
  let lim = dist <= CREEP_ZONE ? HS_CREEP : Math.min(HS, HS_CREEP + Math.sqrt(2 * HA * (dist - CREEP_ZONE)));
  v.hv = Math.min(lim, v.hv + HA * dt);
  const step = Math.min(dist, v.hv * dt);
  v.hoist += Math.sign(d) * step;
  if (dist - step < 1e-4) { v.hoist = target; v.hv = 0; return true; }
  return false;
}
// 側移：滑台移到目標位置
function shiftMove(v, target, dt) {
  const d = target - v.shift, step = Math.min(Math.abs(d), SHIFT_SPEED * dt);
  v.shift += Math.sign(d) * step;
  return Math.abs(target - v.shift) < 1e-4 && (v.shift = target, true);
}

// ---------- E84 交握（天車 ↔ 機台 Load Port 的訊號確認，SEMI E84）----------
const E84_TIME = 1.6, E84_END_TIME = 0.8, E84_TIMEOUT = 15;
const E84_STEPS = { drop: ['HO_AVBL ON → CS_0＋VALID', '等 L_REQ（機台：可以放）', 'TR_REQ', '等 READY'], pick: ['HO_AVBL ON → CS_0＋VALID', '等 U_REQ（機台：可以取）', 'TR_REQ', '等 READY'] };
function e84Text(v) {
  if (v.state === 'e84end') return (v.op === 'pick' ? '取｜' : '放｜') + 'E84：BUSY 關 → COMPT（完成）';
  const port = v.op === 'pick' ? v.job.from : v.job.to;
  if (!hoAvbl(port)) return `${v.op === 'pick' ? '取' : '放'}｜E84：HO_AVBL OFF（${port.owner.down ? '機台異常' : '光閘被擋'}），等待中 ${Math.ceil(E84_TIMEOUT - v.e84Wait)}s 後逾時`;
  const st = E84_STEPS[v.op], i = Math.min(st.length - 1, Math.floor(v.timer / E84_TIME * st.length));
  return `${v.op === 'pick' ? '取' : '放'}｜E84：${st[i]}`;
}
// 交握逾時：放貨改送最近的空 STB；取貨取消（交給之後重新派車）
function e84Abort(v, port) {
  port.e84 = null;
  log(`⏱ ${v.id} E84 交握逾時（${port.name} 沒回應），放棄這次${v.op === 'pick' ? '取貨' : '放貨'}`);
  const job = v.job;
  if (v.op === 'pick') {
    job.to.reserved = false; job.foup.job = null; jobs.splice(jobs.indexOf(job), 1);
    v.job = null; v.op = null; v.state = 'idle'; v.route = []; v.target = null;
  } else {
    const free = ports.filter(q => q.owner.type === 'stb' && !q.foup && !q.reserved && usable(q));
    const nd = nearest(port, free);
    v.op = null; v.state = 'toDrop';
    if (nd) { job.to.reserved = false; nd.reserved = true; job.to = nd; log(`↪ 改派 ${job.foup.id} → ${nd.name}`); }
    setTarget(v, job.to);
  }
}

// 取放貨流程：防墜板收回 → (側移伸出) → 捲揚下降 → 夾爪 → 捲揚上升 → (側移縮回) → 防墜板揮出
function stepTransfer(v, dt) {
  if (MAINT_STATES.includes(v.state)) return stepMaintVehicle(v, dt);   // 維修區（maintenance.js）
  const port = v.op === 'pick' ? v.job.from : v.job.to;
  switch (v.state) {
    case 'e84': {
      // 天車 → 機台：CS_0、VALID；機台 → 天車：L_REQ（可以放）或 U_REQ（可以取）；天車：TR_REQ；機台：READY
      if (!hoAvbl(port)) {                                            // 機台的 HO_AVBL 是 OFF（機台異常、光閘被擋）：等到逾時就放棄
        v.e84Wait += dt;
        if (v.e84Wait > E84_TIMEOUT) e84Abort(v, port);
        break;
      }
      v.timer += dt;
      if (v.timer >= E84_TIME) { v.state = 'guardOpen'; v.timer = 0; e84Count++; }
      break;
    }
    case 'e84end':
      // 取放完成：BUSY 關 → TR_REQ 關、COMPT 開 → 機台 READY 關 → VALID、COMPT 關
      v.timer += dt;
      if (v.timer >= E84_END_TIME) { port.e84 = null; v.state = 'guardClose'; v.timer = 0; }
      break;
    case 'guardOpen':
      v.guard = Math.min(1, v.guard + dt / GUARD_TIME);
      if (v.guard >= 1) v.state = Math.abs(port.lat) > 0.05 ? 'shiftOut' : 'lower';
      break;
    case 'shiftOut':
      if (shiftMove(v, port.lat, dt)) v.state = 'lower';
      break;
    case 'lower':
      if (pendingCurtain && (port.owner.type === 'machine' || port.owner.type === 'ntb') && v.hoist < 0.05) { raiseCurtain(v); return; }   // 教學：下一台開始下降的車碰到光閘遮斷
      if (hoistMove(v, hoistDepth(port), dt)) { v.state = v.op === 'pick' ? 'grip' : 'release'; v.timer = CLAW_TIME; }
      break;
    case 'grip':
      v.timer -= dt; v.claw = Math.min(1, 1 - v.timer / CLAW_TIME);
      if (v.timer <= 0) {
        const f = v.job.foup;
        f.localRot = f.rot - v.group.rotation.y;                 // 保持世界方向不變
        f.carrier = v;                                             // 之後每幀跟著夾爪畫（main.js）
        f.state = 'moving'; port.foup = null; v.carry = f; v.claw = 1; v.state = 'raise';
      }
      break;
    case 'release':
      v.timer -= dt; v.claw = Math.max(0, v.timer / CLAW_TIME);
      if (v.timer <= 0) {
        const f = v.carry;
        f.carrier = null; placeFoupAt(f, port);
        port.foup = f; port.reserved = false; f.port = port; f.job = null; v.carry = null; v.claw = 0;
        if (port.owner.type === 'ntb') { f.state = 'ntbOut'; delete f.outputKind; f.storageWaitingSince = null; }
        else if (port.owner.type === 'stb') { f.state = 'buffered'; f.timer = STB_DWELL * (0.3 + rndD() * 0.7); }
        else { f.state = 'processing'; delete f.outputKind; f.storageWaitingSince = null; f.timer = procTime * (0.7 + rndD() * 0.6); }
        log(`${v.id} 放貨 ${f.id} → ${port.name}`);
        v.state = 'raise';
      }
      break;
    case 'raise':
      if (hoistMove(v, 0, dt)) v.state = Math.abs(v.shift) > 1e-4 ? 'shiftIn' : (port.owner.type === 'machine' || port.owner.type === 'ntb') ? 'e84end' : 'guardClose';
      break;
    case 'shiftIn':
      if (shiftMove(v, 0, dt)) v.state = 'guardClose';
      break;
    case 'guardClose':
      v.guard = Math.max(0, v.guard - dt / GUARD_TIME);
      if (v.guard <= 0) {
        if (v.op === 'pick') { v.op = null; v.state = 'toDrop'; setTarget(v, v.job.to); }
        else if (v.noComm) {                                           // 通訊中斷：完成了但回報不出去，先記在車上（comm.js）
          v.unreported = (v.unreported || 0) + 1; v.carryReport = v.carryReport || []; v.carryReport.push(v.job);
          v.job.foup.unreported = true; jobs.splice(jobs.indexOf(v.job), 1); v.job = null; v.op = null; v.state = 'idle'; v.route = []; v.target = null;
        } else {
          completed++; cycleSum += simTime - v.job.created; cycleByPri[v.job.pri][0] += simTime - v.job.created; cycleByPri[v.job.pri][1]++;
          jobs.splice(jobs.indexOf(v.job), 1); v.job = null; v.op = null; v.state = 'idle'; v.route = []; v.target = null;
        }
      }
      break;
  }
}
// 沿天車前方路線找下一個匯流點（MERGE_ZONE 以內）：{ node, dn 距離, inSeg 從哪一段進去 }
// 節點之間可能很短（2 公尺），所以要跨好幾段往前找，不能只看目前這一段
function findNextMerge(v) {
  for (const e of pathAhead(v, MERGE_ZONE)) {
    const dn = e.off + e.seg.len;
    if (dn > MERGE_ZONE) break;
    if (dn >= 0 && e.seg.to.in.length > 1) return { node: e.seg.to, dn, inSeg: e.seg };
  }
  return null;
}
function stepVehicles(dt) {
  for (const v of vehicles) v.nextMerge = v.parked ? null : findNextMerge(v);   // 休息中的車不搶匯流鎖
  // 鎖的持有者整台車通過匯流點（或改走別條路）後釋放
  for (const n of mergeNodes) if (n.lock) {
    const L = n.lock;
    if (!vehicles.includes(L) || !((L.nextMerge && L.nextMerge.node === n) || (L.seg.from === n && L.d < VLEN + 0.3))) n.lock = null;
  }
  // 每個匯流點：哪幾條支線上有車在等
  for (const n of mergeNodes) n.waitIn = null;
  for (const v of vehicles) if (v.nextMerge && v.waitT > 0) (v.nextMerge.node.waitIn || (v.nextMerge.node.waitIn = new Set())).add(v.nextMerge.inSeg);
  // 鎖沒人拿時：
  //   1. 已經煞不住、一定會開過匯流點的車先走（避免急煞）
  //   2. 否則比「路權分數」＝ 路權等級 × RANK_SEC ＋ 已經等了幾秒：急件／載貨的車先過；
  //      等最久的車分數會一直加，所以低路權的車也不會永遠插不進去（同分時給最近的車）
  //   鎖只能給「每條支線上排最前面」的車：給到後面的車，它會被前面沒鎖的車擋住，兩台互等就死結了
  const front = new Map();                                            // 匯流點|支線 → 該支線最前面的車
  for (const v of vehicles) { const nm = v.nextMerge; if (!nm) continue; const k = nm.node.id + '|' + nm.inSeg.id, f = front.get(k); if (!f || nm.dn < f.nextMerge.dn) front.set(k, v); }
  for (const n of mergeNodes) if (!n.lock) {
    let committed = null, cd = Infinity, best = null, bs = -Infinity;
    for (const v of vehicles) {
      const nm = v.nextMerge; if (!nm || nm.node !== n || front.get(n.id + '|' + nm.inSeg.id) !== v) continue;
      const brake = v.v * v.v / (2 * 2.5 * A) + 0.3;
      if (nm.dn - holdOf(nm) < brake && nm.dn < cd) { cd = nm.dn; committed = v; }
      // 只有「正在開、或停在等待線等鎖」的車才比分數；停在 Port 上取放貨、或被自己前車擋住的車拿了鎖也過不去
      const ready = ['idle', 'toPick', 'toDrop', 'toMaint'].includes(v.state) && !v.parked && ((v.waitT || 0) > 0 || v.v > 0.05);
      const sc = (ready ? 1000 : 0) + rankOf(v) * RANK_SEC + (v.waitT || 0) - nm.dn * 0.01;
      if (sc > bs) { bs = sc; best = v; }
    }
    n.lock = committed || best;
    if (n.lock && !committed) n.lockScore = bs;
  }
  for (const v of vehicles) updateVehicle(v, dt);
}
function stepPorts(dt) {
  for (const p of ports) {
    const f = p.foup; if (!f) continue;
    if (p.owner.down) continue;                                        // 機台當機：加工暫停
    if (f.state === 'processing' || f.state === 'buffered') { f.timer -= dt; if (f.timer <= 0) { if (f.state === 'processing') { delete f.outputKind; f.storageWaitingSince = null; } f.state = 'ready'; } }
  }
}
const pick = a => a[Math.floor(rndD() * a.length)];
// 從 Port a 沿軌道開到 Port b 的距離（單向軌道，可能要繞一圈）
function routeDist(a, b) {
  if (a.seg === b.seg && b.d >= a.d) return b.d - a.d;
  return (a.seg.len - a.d) + DIST[a.seg.to.id][b.seg.from.id] + b.d;
}
const nearest = (from, list) => { const r = list.reduce((best, q) => { const d = routeDist(from, q); return d < Infinity && (!best || d < best.d) ? { q, d } : best; }, null); return r && r.q; };
// Port 現在能不能用：機台沒當機、所在軌道沒封鎖
const usable = q => !q.owner.down && !q.seg.blocked;
const MAX_NEW_JOBS = 40;   // 每一輪最多產生幾筆新任務（地圖大時避免一次算太多）
const NEXT_TOOL_POOL = 12; // 機台下貨送下一台機台時，從最近的幾台空機台裡挑
const CROSS_ZONE = 0.25;   // 機台下貨送到「任何地方」的機台的機率（多半會跨區塊）
function dispatch() {
  stepMaintQueue();                                          // 維修區空出來就叫下一台排隊的車過去
  // 這一輪的空位清單只算一次；被選走的就從清單拿掉
  const freeMachines = [], freeStbs = [];
  for (const q of ports) if (q.owner.type !== 'ntb' && !q.foup && !q.reserved && usable(q)) (q.owner.type === 'machine' ? freeMachines : freeStbs).push(q);
  const take = (list, q) => { list.splice(list.indexOf(q), 1); return q; };
  // 1. 產生搬運任務
  let created = 0;
  // 特急／急件先挑目的地（空機台、空儲位很少時，才不會被一般 Lot 搶光）
  const jobOrder = ports.filter(p => p.foup && p.foup.pri > 0).sort((a, b) => b.foup.pri - a.foup.pri).concat(ports.filter(p => !(p.foup && p.foup.pri > 0)));
  for (const p of jobOrder) {

    const f = p.foup;
    if (!f || f.state !== 'ready' || f.job || f.unreported || !usable(p)) continue;   // 還沒回報放好的 FOUP，MCS 不知道它在這
    let dest = null;
    if (f.empty && p.owner.type === 'stb') continue; // 空盒留在儲格，等人員下 NTB 出庫指令
    if (p.owner.type === 'ntb' && p.ntbDirection !== 'in') continue;
    if (p.owner.type === 'ntb') { const q = nearest(p, freeStbs); if (q) dest = q; }
    else if (p.owner.type === 'stb') { const q = nearest(p, freeMachines); if (q) dest = q; }  // STB → 最近的空機台
    else {
      // 每次加工結束只決定一次流向；指定回 STB 的貨滿位時不可改送機台。
      const c = freeMachines.filter(q => q.owner !== p.owner);
      if (!f.outputKind) f.outputKind = rndD() < 0.6 ? 'machine' : 'stb';
      const toMachine = f.outputKind === 'machine';
      // 下一台機台：從沿軌道最近的 NEXT_TOOL_POOL 台空機台裡隨機挑（全廠隨機的話，車會一直繞大半圈，主幹線塞爆）
      //   另外 CROSS_ZONE 的機率送到其他區塊的機台（會走區塊之間的連接線）
      const reach = c.filter(q => routeDist(p, q) < Infinity);           // 軌道封鎖時有些機台到不了
      if (toMachine && reach.length) dest = (rndD() < CROSS_ZONE ? pick(reach)
        : pick(reach.map(q => [routeDist(p, q), q]).sort((a, b) => a[0] - b[0]).slice(0, NEXT_TOOL_POOL).map(x => x[1])));
      else if (!toMachine) { const q = nearest(p, freeStbs); if (q) dest = q; }
    }
    if (p.owner.type === 'machine' && f.outputKind === 'stb' && !dest) {
      if (f.storageWaitingSince == null) f.storageWaitingSince = simTime;
      // 有空位但不可達／不可用時明確區分，避免把封軌也當成滿位。
      const empty = ports.filter(q => q.owner.type === 'stb' && !q.foup && !q.reserved);
      f.storageWaitReason = empty.length ? '空位不可達／不可用' : '儲位已滿或已預約';
    }
    if (dest && created < MAX_NEW_JOBS) {
      if (f.storageWaitingSince != null) {
        const waited = simTime - f.storageWaitingSince;
        storageWaitSum += waited; storageWaitCount++;
        log(`📦 ${f.id} 等儲位 ${Math.round(waited)} 秒，已預約 ${dest.name}`);
        f.storageWaitingSince = null; f.storageWaitReason = null;
      }
      take(dest.owner.type === 'stb' ? freeStbs : freeMachines, dest);
      dest.reserved = true; created++;
      const job = { id: ++jobSeq, from: p, to: dest, foup: f, created: simTime, vehicle: null, pri: f.pri || 0 };
      f.job = job; jobs.push(job);
    }
  }
  // 2. 派車：每筆任務派給沿軌道最近的閒置天車（先建立的任務先派）
  const idle = vehicles.filter(v => v.state === 'idle' && !v.maintReq && !v.fault && !v.offline && !v.manual && commOk(v));   // 通訊中斷的車收不到指令   // 下線的車不派任務   // 排隊等維修的車不派任務
  const order = jobs.filter(j => !j.vehicle).sort((a, b) => b.pri - a.pri || a.created - b.created);   // 特急 → 急件 → 一般，同級先來先派
  if (DISPATCH_MODE === 'auto') return autoAssign(idle, order);
  if (hostDown) return;                                      // 派車系統當機：中央派車停止（alarms.js）
  for (const job of order) {
    if (!idle.length) break;
    let best = null, bd = Infinity;
    for (const v of idle) {                                    // 沿軌道網路的最短路線距離
      const d = planRoute(v, job.from.seg, job.from.d).dist;
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) continue;                                       // 軌道封鎖，沒有車到得了
    idle.splice(idle.indexOf(best), 1);
    job.vehicle = best; best.job = job; best.state = 'toPick'; setTarget(best, job.from);
    log(`${best.id} 派車 ${job.pri ? '【' + PRI_NAME[job.pri] + '】' : ''}${job.foup.id}：${job.from.name} → ${job.to.name}`);
  }
}

// ---------- 天車自主接任務（競標）----------
//   MCS 只把任務公告出去，不指定車；閒置的天車自己看「附近」的任務、自己算路線距離出價，
//   出價最好（最近、優先級高）的車得標。太遠的任務沒人搶時，等越久公告範圍越大，最後一定有車接。
let DISPATCH_MODE = 'central';
const AUTO_RANGE = 45;        // 天車只看沿軌道這麼近的任務（公尺）
const AUTO_GROW = 1.5;        // 任務每多等 1 秒，公告範圍多 1.5 公尺
let autoStat = { claims: 0, bids: 0, contested: 0 };
function autoAssign(idle, order) {
  const bids = [];
  for (const job of order) {
    const range = AUTO_RANGE + (simTime - job.created) * AUTO_GROW;
    for (const v of idle) {
      const d = planRoute(v, job.from.seg, job.from.d).dist;
      if (d <= range) bids.push({ v, job, d, score: d - job.pri * 40 });   // 急件／特急出價加分
    }
  }
  bids.sort((a, b) => a.score - b.score);
  const takenV = new Set(), takenJ = new Set(), nBid = new Map();
  for (const b of bids) nBid.set(b.job, (nBid.get(b.job) || 0) + 1);
  for (const b of bids) {
    if (takenV.has(b.v) || takenJ.has(b.job)) continue;
    takenV.add(b.v); takenJ.add(b.job);
    const job = b.job, v = b.v, k = nBid.get(job);
    job.vehicle = v; v.job = job; v.state = 'toPick'; setTarget(v, job.from);
    autoStat.claims++; autoStat.bids += k; if (k > 1) autoStat.contested++;
    log(`🤝 ${v.id} 自主接任務 ${job.pri ? '【' + PRI_NAME[job.pri] + '】' : ''}${job.foup.id}（${k} 台出價，距離 ${Math.round(b.d)} m 最近）`);
  }
}

// ---------- 插特急（教學用）：挑一個還沒派車的 Lot 改成特急 ----------
function insertHotLot() {
  const cand = ports.filter(p => p.foup && usable(p) && !p.foup.empty && p.foup.pri < 2 && (!p.foup.job || !p.foup.job.vehicle) && ['ready', 'processing', 'buffered'].includes(p.foup.state));
  if (!cand.length) { log('目前找不到可以插特急的 Lot'); return null; }
  // 挑「現在就走得動」的：已有任務只差派車 → 等搬運而且目的地有空位 → 快加工完的
  //   （儲位、機台都很滿時，隨便挑一個可能等很久都沒有目的地）
  const freeM = ports.some(q => q.owner.type === 'machine' && !q.foup && !q.reserved && usable(q));
  const freeS = ports.some(q => q.owner.type === 'stb' && !q.foup && !q.reserved && usable(q));
  const canGo = p => p.owner.type === 'stb' ? freeM : p.owner.type === 'ntb' ? freeS : (p.foup.outputKind === 'machine' ? freeM : p.foup.outputKind === 'stb' ? freeS : freeM || freeS);
  const proc = cand.filter(p => p.owner.type === 'machine' && p.foup.state === 'processing').sort((a, b) => a.foup.timer - b.foup.timer);
  const pickP = cand.find(p => p.foup.job && !p.foup.job.vehicle) || cand.find(p => p.foup.state === 'ready' && canGo(p))
    || proc.find(canGo) || cand.find(p => p.foup.state === 'ready') || proc[0] || cand[0];
  const f = pickP.foup;
  f.pri = 2; setFoupTag(f); if (f.job) f.job.pri = 2;
  if (f.state !== 'ready') f.timer = Math.min(f.timer, 5);
  log(`🔥 插特急：${f.id}（在 ${f.port.name}），派車時排第一、匯流點路權最大`);
  return f;
}
