// alarms.js — 異常事件（教學用）：天車故障停車、取放貨異常、機台／Load Port 當機、軌道區段封鎖
//
// 每個異常都有：警報代碼、發生了什麼、會造成什麼影響、現場一般怎麼處理（給新人看的說明），
// 以及「復歸」按鈕。可以手動觸發，也可以開「隨機自動發生」。
// 說明內容是一般 AMHS 的通用做法，各廠實際 SOP 以公司規定為準。

const alarms = [];
let alarmSeq = 0, autoAlarm = false, autoAlarmT = 120, pendingTransferFault = false;

// ---------- 教學說明 ----------
const ALARM_INFO = {
  vehicle: [
    { code: 'E-101', title: '天車走行馬達過載',
      what: '天車的走行馬達電流超過上限，控制器為了保護馬達自動停車。',
      impact: '軌道是單線的，後面的天車沒辦法超車，只能在後面排隊。塞車會一路往上游擴散，可能把匯流點堵住，連 Bay 裡的車都出不來。這台車手上的搬運任務也會延遲。',
      steps: ['在監控畫面（MCS）確認警報代碼與天車位置', '通知值班的 AMHS 工程師／維修人員', '必要時把這一段軌道設為封鎖，讓其他天車改道', '維修人員到現場（走維修走道或用高空作業車）檢查馬達、輪子', '排除後在控制器復歸，確認天車自我檢查正常', '解除封鎖，觀察後面排隊的車是否消化'] },
    { code: 'E-102', title: '定位條碼讀取失敗',
      what: '天車讀不到軌道上的定位條碼（位置標記），不確定自己的位置，為了安全停車。',
      impact: '跟所有「天車停在軌道上」的異常一樣：後面的車全部排隊，塞車往上游擴散。',
      steps: ['確認警報位置與天車編號', '檢查該處軌道的條碼標籤是否髒污、刮傷或脫落', '檢查天車的讀碼器鏡頭', '清潔或更換後復歸，讓天車重新定位', '觀察天車是否能正常行走到下一個條碼'] },
    { code: 'E-103', title: '前方障礙物感測持續觸發',
      what: '車頭的障礙物感測器一直偵測到前方有東西（可能是掉落物、維修人員，或感測器髒污誤判），天車停下等待。',
      impact: '天車停在原地，後面的車排隊。如果真的有人或東西在軌道附近，這是保護安全的正確反應。',
      steps: ['先確認前方軌道有沒有人員、工具或掉落物', '確認是誤判的話，清潔感測器鏡面', '確認安全後才能復歸', '同一位置常常發生的話，要回報檢查感測器或軌道周邊'] },
  ],
  transfer: [
    { code: 'E-201', title: '夾爪夾取失敗',
      what: '夾爪降到 FOUP 上方後，感測器沒有確認夾到 FOUP 頂部的 flange（可能 FOUP 放歪、flange 變形或有異物）。天車停在原地，吊帶還放著。',
      impact: '天車停在這個 Port 上方不能走，後面的天車都過不去；這個 Port 也暫時不能上下貨。',
      steps: ['確認警報的天車與 Port 位置', '不要直接用手拉 FOUP 或吊帶', '由工程師以手動模式把夾爪收回', '檢查 FOUP 擺放位置、flange 有沒有變形', '把 FOUP 重新放正後復歸，天車重新執行取貨'] },
    { code: 'E-202', title: '放貨在席感測／E84 交握異常',
      what: '放下 FOUP 後，Load Port 的在席感測沒有回報「放好了」，或是天車和機台之間的 E84 交握逾時。E84 是天車和 Load Port 互相確認「可以放／放好了」的訊號交握標準（SEMI E84）。',
      impact: '天車停在 Port 上方等確認，後面的車排隊；FOUP 狀態不確定，不能直接開始加工。',
      steps: ['確認 FOUP 是否正確坐在定位銷上', '檢查 Load Port 的在席感測器', '檢查 E84 訊號或光通訊器是否正常', '確認 FOUP 狀態正確後復歸'] },
    { code: 'E-203', title: '捲揚吊帶異常',
      what: '升降時吊帶張力或長度異常（打滑、纏繞），天車停止升降。',
      impact: '天車停在 Port 上方、吊帶放在半空中，後面的車排隊。',
      steps: ['不可以強行升降', '通知維修人員檢查吊帶與捲揚鼓', '吊帶有損傷的話要更換', '復歸後先試升降一次，確認正常'] },
  ],
  machine: [
    { code: 'M-301', title: '機台當機',
      what: '機台本身發生異常停機（製程、硬體或軟體問題），Load Port 不能上下貨。',
      impact: '機台上的 FOUP 出不去；本來要送來這台機台的 FOUP 要改送別台機台或先放 STB 暫存（改派）；派車系統要避開這台機台。',
      steps: ['機台工程師處理機台異常', '在 MES 把機台狀態改為停機（DOWN），派車系統就不會再派貨過來', '已經在路上的搬運任務改派到其他機台或 STB', '修好、確認後恢復機台狀態，派車系統才會再送貨'] },
    { code: 'M-302', title: 'Load Port 門開關異常',
      what: 'Load Port 開關 FOUP 門的機構異常，這台機台的 Port 暫時不能用。',
      impact: '跟機台當機一樣：要送來的貨要改派，機台上的 FOUP 卡住出不去。',
      steps: ['設備工程師檢查 Load Port 開門機構與感測器', '在系統把 Port／機台狀態設為不可用', '已經在路上的任務改派', '修好後恢復狀態'] },
  ],
  track: [
    { code: 'T-401', title: 'Bay 軌道維修封鎖',
      what: '這條 Bay 的軌道要做保養或維修，暫時封鎖，天車不能進去。',
      impact: 'Bay 裡的機台和 STB 暫時送不進去也拿不出來；要送進這條 Bay 的任務會改派；已經在 Bay 裡的天車開出來後就不能再進去。',
      steps: ['事先公告維修時段', '在系統把這段軌道設為封鎖，等 Bay 裡的天車都開出來', '確認區段內沒有天車才開始作業，現場掛警示', '作業完成、確認軌道上沒有遺留工具後解除封鎖'] },
    { code: 'T-402', title: '區塊連接線封鎖',
      what: '兩個區塊之間的一條連接線暫時封鎖（維修或異常）。',
      impact: '要跨區的天車會自動改走別條連接線繞路，路程變長、搬運時間增加，其他連接線的車流也會變多。',
      steps: ['在系統把連接線設為封鎖，派車系統自動改用其他路線', '觀察其他連接線和匯流點有沒有塞車', '作業完成、確認後解除封鎖，路線恢復'] },
  ],
  ap: [
    { code: 'N-501', title: '無線 AP 斷線（有線網路中斷）',
      what: '天花板上一台無線 AP 和控制系統之間的有線網路斷了（交換器、網路線或光纖異常）。AP 本身可能還亮著，但訊號送不回控制系統。',
      impact: '原本連這台 AP 的天車會自動漫遊到隔壁的 AP，大多數車不受影響；只有隔壁 AP 也收不到的角落，天車會「通訊中斷」：手上的指令照做，但收不到新指令，做完了也回報不出去，MCS 不知道 FOUP 已經放好，所以那個 FOUP 的下一站也會延遲。',
      steps: ['在監控畫面確認是哪一台 AP、影響範圍內有幾台車', '通知 IT／網路人員檢查交換器與網路線', '觀察範圍內的天車有沒有成功漫遊到其他 AP', '修復後確認 AP 重新上線、通訊中斷的車有恢復並補回報'] },
    { code: 'N-502', title: '無線 AP 故障（電源／硬體）',
      what: '一台 AP 斷電或硬體故障，完全沒有訊號。',
      impact: '跟有線網路中斷一樣：附近的車漫遊到隔壁 AP；AP 規劃時讓相鄰 AP 的範圍互相重疊，就是為了這種時候還能接手。重疊不夠的地方就會有通訊死角。',
      steps: ['確認 AP 的電源和指示燈', '通知 IT 更換 AP 或檢查供電（PoE）', '更換後確認訊號範圍和漫遊正常'] },
  ],
};
const ALARM_TYPE_NAME = { vehicle: '天車故障停車', transfer: '取放貨異常', machine: '機台／Load Port 當機', track: '軌道區段封鎖', ap: '無線 AP 斷線' };

// ---------- 標記 ----------
function alarmMarker(text) {
  const sp = makeLabel(text, { bg: 'rgba(185,28,28,.95)', fg: '#fff', scale: 1.3, w: 300 });
  sp.renderOrder = 10; sp.material.depthTest = false; scene.add(sp); return sp;
}
// 封鎖區段：沿軌道每 3 公尺一支紅白警示柱
const barrierGeo = new THREE.BoxGeometry(0.15, 0.9, 0.9), barrierMat = mat(0xdc2626, { emissive: 0x7f1d1d, emissiveIntensity: 0.6 });
function barrierGroup(seg) {
  const g = new THREE.Group();
  for (let d = 0.5; d < seg.len; d += 3) {
    const f = frameAt(seg, d), b = new THREE.Mesh(barrierGeo, barrierMat);
    b.position.set(f.x, H - 0.55, f.z); b.rotation.y = f.th; g.add(b);
  }
  scene.add(g); return g;
}

// ---------- 發生異常 ----------
const pickInfo = type => pick(ALARM_INFO[type]);
function raiseAlarm(type, info, target, label, opts = {}) {
  const a = { id: ++alarmSeq, type, info, target, label, start: simTime, rerouted: 0, canceled: 0, auto: !!opts.auto,
    autoClearAt: opts.auto ? simTime + 150 + Math.random() * 150 : null };
  a.marker = alarmMarker(`⚠ ${info.code}`);
  alarms.push(a);
  log(`⚠ ${info.code} ${info.title}：${label}`);
  hmiOnAlarm(a);
  return a;
}
const MOVING = ['idle', 'toPick', 'toDrop'];
function raiseVehicleFault(v, opts) {
  v = v || pick(vehicles.filter(x => !x.fault && MOVING.includes(x.state) && x.v > 0.3));
  if (!v) return null;
  const a = raiseAlarm('vehicle', pickInfo('vehicle'), v, `天車 ${v.id}（${v.seg.name}）`, opts);
  v.fault = a; return a;
}
// 取放貨異常：找一台正在夾取／放貨的車；沒有的話，下一台開始夾取／放貨的車就會發生
function raiseTransferFault(v, opts) {
  if (!v) {
    v = pick(vehicles.filter(x => !x.fault && (x.state === 'grip' || x.state === 'release' || x.state === 'lower')));
    if (!v) { pendingTransferFault = opts || true; log('下一台開始夾取／放貨的天車會發生取放貨異常'); return null; }
  }
  if (pendingTransferFault && pendingTransferFault !== true) opts = pendingTransferFault;
  pendingTransferFault = false;
  const port = v.job ? (v.op === 'pick' ? v.job.from : v.job.to) : null;
  const a = raiseAlarm('transfer', pickInfo('transfer'), v, `天車 ${v.id} @ ${port ? port.name : v.seg.name}`, opts);
  v.fault = a; return a;
}
function raiseMachineDown(m, opts) {
  m = m || pick(machines.filter(x => !x.down && !x.seg.blocked));
  if (!m) return null;
  const a = raiseAlarm('machine', pickInfo('machine'), m, `機台 ${m.name}`, opts);
  m.down = a;
  reassignJobs(a, q => q.owner === m);
  return a;
}
function raiseTrackBlock(seg, opts) {
  // 可以封鎖的區段：Bay（裡面的機台、儲格暫時不能用）、區塊連接線（跨區要繞路）
  if (!seg) {
    const cand = [...bays.map(b => b.seg), ...links.map(l => l.seg)].filter(s => !s.blocked && !s.maint && !vehicles.some(v => v.fault && v.seg === s));
    seg = Math.random() < 0.5 ? pick(cand.filter(s => s.kind === 'link')) : pick(cand.filter(s => s.kind === 'bay'));
  }
  if (!seg) return null;
  const info = seg.kind === 'bay' ? ALARM_INFO.track[0] : ALARM_INFO.track[1];
  const a = raiseAlarm('track', info, seg, seg.name, opts);
  seg.blocked = a; a.barrier = barrierGroup(seg);
  computeRoutes();
  replanAll(a);
  reassignJobs(a, q => q.seg === seg);
  return a;
}

// 機台當機／區段封鎖時，處理受影響的搬運任務
//   ・要「送去」受影響 Port、還沒放下的：改送最近的可用 STB（改派）
//   ・要「從」受影響 Port 取貨、還沒開始夾的：取消，天車回到閒置
//   ・天車已經在那個 Port 上方取放中的：讓它做完
const TRANSFERRING = ['e84', 'e84end', 'guardOpen', 'shiftOut', 'lower', 'grip', 'release', 'raise', 'shiftIn', 'guardClose'];
function busyAt(v, port) { return v && TRANSFERRING.includes(v.state) && ((v.op === 'pick' && v.job.from === port) || (v.op === 'drop' && v.job.to === port)); }
function reassignJobs(a, hit) {
  for (const job of jobs.slice()) {
    const v = job.vehicle;
    if (hit(job.to) && !busyAt(v, job.to)) {
      const free = ports.filter(q => q.owner.type === 'stb' && !q.foup && !q.reserved && usable(q));
      const nd = nearest(job.from, free);
      if (nd) {
        job.to.reserved = false; nd.reserved = true; job.to = nd; a.rerouted++;
        if (v && v.state === 'toDrop') setTarget(v, nd);
        log(`↪ 改派 ${job.foup.id} → ${nd.name}`);
      }
    }
    if (hit(job.from) && !job.pickedAt && !busyAt(v, job.from)) {
      job.to.reserved = false; job.foup.job = null; jobs.splice(jobs.indexOf(job), 1); a.canceled++;
      if (v) { v.job = null; v.state = 'idle'; v.route = []; v.target = null; v.op = null; }
      log(`✕ 取消 ${job.foup.id} 的取貨（${job.from.name} 不能用）`);
    }
  }
}
// 路線改變後：所有有目的地的天車重新規劃路線；到不了取貨點的任務取消、到不了放貨點的改派
function replanAll(a) {
  for (const v of vehicles) {
    if (v.state === 'toMaint' && !v.fault && !setTarget(v, v.lifter)) {   // 到不了維修區：先回去排隊
      v.state = 'idle'; v.route = []; v.target = null; v.lifter.busy = null; v.lifter = null; maintQueue.unshift(v);
      continue;
    }
    if (!v.job || v.fault) continue;
    if (v.state === 'toPick') {
      const old = v.route.slice();
      if (!setTarget(v, v.job.from)) {
        const job = v.job; job.to.reserved = false; job.foup.job = null; jobs.splice(jobs.indexOf(job), 1);
        v.job = null; v.state = 'idle'; v.route = []; v.target = null; if (a) a.canceled++;
      } else if (a && old.some(s => s.blocked)) a.rerouted++;
    } else if (v.state === 'toDrop') {
      const old = v.route.slice();
      if (!setTarget(v, v.job.to)) {
        const free = ports.filter(q => q.owner.type === 'stb' && !q.foup && !q.reserved && usable(q));
        const nd = free.find(q => planRoute(v, q.seg, q.d).dist < Infinity);
        if (nd) { v.job.to.reserved = false; nd.reserved = true; v.job.to = nd; setTarget(v, nd); if (a) a.rerouted++; }
      } else if (a && old.some(s => s.blocked)) a.rerouted++;
    }
  }
}

// ---------- 復歸 ----------
function clearAlarm(a) {
  const i = alarms.indexOf(a); if (i < 0) return;
  alarms.splice(i, 1);
  scene.remove(a.marker);
  if (a.type === 'vehicle' || a.type === 'transfer') {
    const v = a.target; v.fault = null; v.estop = false;
    if (v.servo) Object.keys(v.servo).forEach(k => v.servo[k] = true);   // 直接按「復歸」（沒走操作介面）：伺服一起恢復
  }
  if (a.type === 'machine') a.target.down = null;
  if (a.type === 'ap') a.target.down = null;
  if (a.type === 'track') { a.target.blocked = null; scene.remove(a.barrier); computeRoutes(); replanAll(null); }
  log(`✔ 復歸 ${a.info.code} ${a.label}（處理 ${fmtDur(simTime - a.start)}）`);
  if (openAlarm === a) closeAlarmCard();
}
const fmtDur = t => { t = Math.max(0, Math.floor(t)); return `${Math.floor(t / 60)}分${String(t % 60).padStart(2, '0')}秒`; };

// ---------- 每幀：標記位置、自動發生／自動復歸 ----------
function alarmPos(a) {
  if (a.type === 'vehicle' || a.type === 'transfer') { const p = a.target.group.position; return [p.x, H + 2.2, p.z]; }
  if (a.type === 'machine') return [a.target.x, 5.2, a.target.z];
  if (a.type === 'ap') return [a.target.x, 11.3, a.target.z];
  const [x, z] = a.target.at(a.target.len / 2); return [x, H + 2.2, z];
}
function alarmTick(simDt) {
  for (const a of alarms) { const [x, y, z] = alarmPos(a); a.marker.position.set(x, y, z); }
  if (paused) return;
  for (const a of alarms.slice()) if (a.autoClearAt && simTime >= a.autoClearAt) {
    if (a.type === 'vehicle' && Math.random() < 0.4) sendToMaint(a);     // 約四成的天車故障要送維修區
    else clearAlarm(a);
  }
  if (autoAlarm) {
    autoAlarmT -= simDt;
    if (autoAlarmT <= 0) {
      autoAlarmT = 120 + Math.random() * 120;
      const t = pick(['vehicle', 'transfer', 'machine', 'track', 'ap']);
      ({ vehicle: raiseVehicleFault, transfer: raiseTransferFault, machine: raiseMachineDown, track: raiseTrackBlock, ap: raiseApDown })[t](null, { auto: true });
    }
  }
}

// ---------- 影響（即時計算，顯示在說明卡上）----------
function alarmImpact(a) {
  if (a.type === 'vehicle' || a.type === 'transfer') {
    const v = a.target;
    // 後面被擋住的車：沿自己前方 40 公尺內會碰到故障車、而且停住的
    const queued = vehicles.filter(u => u !== v && u.v < 0.05 && MOVING.includes(u.state) &&
      pathAhead(u, 40).some(e => e.seg === v.seg && e.off + v.d > 0)).length;
    return [`後面排隊停住的天車：${queued} 台`, v.job ? `延遲中的搬運任務：${v.job.foup.id}（${v.job.from.name} → ${v.job.to.name}）` : '這台天車沒有搬運任務'];
  }
  if (a.type === 'ap') return apImpact(a);
  if (a.type === 'machine') {
    const stuck = a.target.ports.filter(p => p.foup).length;
    return [`卡在機台上的 FOUP：${stuck} 個`, `改派到 STB 的任務：${a.rerouted} 筆`, `取消的取貨任務：${a.canceled} 筆`];
  }
  const seg = a.target, inside = vehicles.filter(v => v.seg === seg).length, affected = ports.filter(p => p.seg === seg).length;
  return [seg.kind === 'bay' ? `暫時不能用的 Port／儲格：${affected} 個` : '跨區的天車改走其他連接線', `區段內還沒開出來的天車：${inside} 台`,
    `改走其他路線的天車：${a.rerouted} 台`, `改派／取消的任務：${a.rerouted + a.canceled} 筆`];
}

// ---------- 介面：警報列表、說明卡 ----------
let openAlarm = null;
function renderAlarms() {
  const el = document.getElementById('alarmList'), ban = document.getElementById('alarmBanner');
  if (!el) return;
  el.innerHTML = alarms.length ? alarms.map(a => `<div class="alarm" data-id="${a.id}">
      <div><b>⚠ ${a.info.code}</b> ${a.info.title}${a.auto ? ' <span class="mut">（自動）</span>' : ''}</div>
      <div class="mut">${a.label} · 已經 ${fmtDur(simTime - a.start)}${a.autoClearAt ? ` · ${fmtDur(a.autoClearAt - simTime)} 後自動復歸` : ''}</div>
      <div class="btns"><button data-act="info">說明</button><button data-act="view">查看位置</button><button data-act="clear" class="ok">復歸</button></div>
    </div>`).join('') : '<div class="mut">目前沒有異常</div>';
  ban.style.display = alarms.length ? 'block' : 'none';
  ban.textContent = `⚠ 目前 ${alarms.length} 件異常 — 點這裡看說明`;
  if (openAlarm) renderAlarmCard(); else if (maintCardOpen) renderMaintCard();
}
function focusAlarm(a) {
  if (a.type === 'vehicle' || a.type === 'transfer') { setFollow(a.target); return; }
  setFollow(null);
  if (a.type === 'ap') setShowComm(true);                              // AP 斷線：順便打開無線網路顯示
  const [x, , z] = alarmPos(a);
  controls.target.set(x, 2, z); camera.position.set(x - 12, 24, z + 26);
}
function renderAlarmCard() {
  const a = openAlarm, c = document.getElementById('alarmCard');
  c.innerHTML = `<div class="hd"><span>⚠ ${a.info.code}　${a.info.title}</span><button id="acClose">✕</button></div>
    <div class="mut">${ALARM_TYPE_NAME[a.type]} · ${a.label} · 已經 ${fmtDur(simTime - a.start)}</div>
    <h4>發生了什麼</h4><p>${a.info.what}</p>
    <h4>會造成什麼影響</h4><p>${a.info.impact}</p>
    <ul class="impact">${alarmImpact(a).map(t => `<li>${t}</li>`).join('')}</ul>
    <h4>現場一般怎麼處理</h4><ol>${a.info.steps.map(t => `<li>${t}</li>`).join('')}</ol>
    <p class="mut">以上是一般 AMHS 的通用做法，實際處理以各廠 SOP 為準。</p>
    <div class="btns"><button id="acView">查看位置</button>${a.type === 'vehicle' || a.type === 'transfer' ? '<button id="acHmi" class="hmiBtn">開操作介面（現場排除）</button>' : ''}${a.type === 'vehicle' ? '<button id="acMaint">送維修區</button>' : ''}<button id="acClear" class="ok">處理完成，復歸</button></div>
    ${a.type === 'vehicle' ? '<p class="mut">「復歸」＝現場排除後直接重新上線；「送維修區」＝復歸後開到車輛維修區，用捲揚機放到地面檢修。</p>' : ''}`;
  c.style.display = 'block';
  document.getElementById('acClose').onclick = closeAlarmCard;
  document.getElementById('acView').onclick = () => focusAlarm(a);
  if (a.type === 'vehicle' || a.type === 'transfer') document.getElementById('acHmi').onclick = () => { const v = a.target; closeAlarmCard(); setFollow(v); openHmi(v, 'quick'); };
  document.getElementById('acClear').onclick = () => clearAlarm(a);
  if (a.type === 'vehicle') document.getElementById('acMaint').onclick = () => { const v = a.target; sendToMaint(a); openMaintCard(); focusMaint(LIFTERS.slice().sort((p, q) => planRoute(v, p.seg, p.d).dist - planRoute(v, q.seg, q.d).dist)[0]); };
}
function openAlarmCard(a) { maintCardOpen = false; openAlarm = a; renderAlarmCard(); }
function closeAlarmCard() { openAlarm = null; document.getElementById('alarmCard').style.display = 'none'; }
