// ui.js — 右側控制面板、統計數字、天車列表、事件紀錄、點擊跟隨

// ================== UI ==================
const $ = id => document.getElementById(id);
let lastStock = -1;
function updateUI() {
  $('simTime').textContent = fmt(simTime);
  $('done').textContent = completed;
  $('tph').textContent = simTime > 60 ? Math.round(completed / (simTime / 3600)) : '–';
  $('avgWait').textContent = waitN ? (waitSum / waitN).toFixed(1) + 's' : '–';
  $('avgCycle').textContent = completed ? (cycleSum / completed).toFixed(1) + 's' : '–';
  $('queue').textContent = jobs.filter(j => !j.vehicle).length;
  $('active').textContent = jobs.filter(j => j.vehicle).length;
  $('foupTotal').textContent = ports.filter(p => p.foup).length + vehicles.filter(v => v.carry).length;
  const stbPorts = ports.filter(p => p.owner.type === 'stb'), used = stbPorts.filter(p => p.foup).length;
  $('stbUse').textContent = `${used}/${stbPorts.length}`;
  $('vehTotal').textContent = vehicles.length;
  $('vehCount').textContent = vehicles.length;
  $('vehList').innerHTML = vehicles.map(v => {
    const route = v.job ? `${v.job.from.name} → ${v.job.to.name}` : '';
    const pr = v.job && v.job.pri ? `<span class="pri${v.job.pri}">【${PRI_NAME[v.job.pri]}】</span>` : '';
    return `<tr class="v${v === followed ? ' sel' : ''}" data-id="${v.id}"><td><i class="dot" style="background:${v.color}"></i>${v.id}</td>` +
      `<td>${stateText(v)}</td><td class="route" title="${route}">${pr}${route}</td><td style="text-align:right">${v.v.toFixed(1)}</td></tr>`;
  }).join('');
  renderAlarms();
  const nc = vehicles.filter(v => v.noComm), ho = vehicles.filter(v => v.handover > 0).length;
  $('commInfo').innerHTML = `AP：${aps.length - aps.filter(a => a.down).length}／${aps.length} 台正常 · 漫遊（換 AP）${roamCount} 次` +
    `<br>通訊中斷：<b style="color:${nc.length ? '#f87171' : 'inherit'}">${nc.length} 台</b>${nc.length ? `（${nc.map(v => v.id).join('、')}）` : ''}${ho ? ` · 切換 AP 中 ${ho} 台` : ''}` +
    `<br>E84 交握完成 ${e84Count} 次`;
  const avg = ([s, n]) => n ? (s / n).toFixed(0) + 's' : '–';
  const act = [0, 1, 2].map(p => jobs.filter(j => j.pri === p).length);
  const parked = vehicles.filter(v => v.state === 'idle' && v.parked).length;
  $('priInfo').innerHTML = `<table style="width:100%;font-size:12px"><tr><td></td><td>任務中</td><td>平均等車</td><td>平均週期</td></tr>` +
    [0, 1, 2].map(p => `<tr><td class="pri${p}">${PRI_NAME[p]}</td><td>${act[p]}</td><td>${avg(waitByPri[p])}</td><td>${avg(cycleByPri[p])}</td></tr>`).join('') +
    `</table>軌道上休息的空車：${parked} 台 · 推車 ${pushCount} 次`;
  $('maintInfo').innerHTML = LIFTERS.map(L => `${L.name}（${L.bay.name}）：<b>${lifterText(L)}</b>`).join('<br>') +
    (maintQueue.length ? `<br>排隊：${maintQueue.map(v => v.id + (v.job ? '（送完貨再去）' : '')).join('、')}` : '') +
    `<br>已修好／保養 ${maintDone} 台`;
  $('log').innerHTML = logs.slice(0, 12).map(([t, m]) => `<div><span>${t}</span>${m}</div>`).join('');
  if (followed) {
    const f = followed, inMaint = f.maintReq || f.state === 'toMaint' || MAINT_STATES.includes(f.state);
    $('followState').textContent = ' · ' + stateText(f) + (f.carry ? ' · ' + f.carry.id : '') + (f.maintReq && f.state !== 'toMaint' ? ' · 排隊等保養' : '');
    $('btnOnline').textContent = f.offline ? '切上線' : '切下線';
    $('btnOnline').className = f.offline ? 'off' : '';
    $('btnOnline').disabled = !!(f.offline && inMaint);
    $('btnVehPm').disabled = !f.offline || !!inMaint;
  }
}
function setFollow(v) {
  followed = v;
  $('followBar').style.display = v ? 'flex' : 'none';
  if (v) $('followName').textContent = v.id;
  updateUI();
}
$('vehList').addEventListener('click', e => {
  const tr = e.target.closest('tr'); if (!tr) return;
  const v = vehicles.find(x => x.id === tr.dataset.id); setFollow(v === followed ? null : v);
});
$('btnUnfollow').onclick = () => setFollow(null);
$('btnOnline').onclick = () => { if (followed) setOffline(followed, !followed.offline); updateUI(); };
$('btnVehPm').onclick = () => { if (followed) vehPm(followed); updateUI(); };
// 異常事件
document.querySelectorAll('[data-alarm]').forEach(b => b.onclick = () => {
  const t = b.dataset.alarm;
  const a = ({ vehicle: raiseVehicleFault, transfer: raiseTransferFault, machine: raiseMachineDown, track: raiseTrackBlock, ap: raiseApDown })[t]();
  if (a) { openAlarmCard(a); focusAlarm(a); } else if (t !== 'transfer') log('現在找不到可以發生這個異常的對象');
  updateUI();
});
function setShowComm(on) { showComm = on; $('showComm').checked = on; }
$('showComm').onchange = e => setShowComm(e.target.checked);
$('btnCommInfo').onclick = () => { openInfoCard('comm'); setShowComm(true); };
$('btnE84Info').onclick = () => openInfoCard('e84');
$('btnHot').onclick = () => { insertHotLot(); updateUI(); };
$('btnPriInfo').onclick = () => openInfoCard('pri');
$('btnParkInfo').onclick = () => openInfoCard('park');
$('btnPm').onclick = () => { const v = sendPm(); if (v) setFollow(v); updateUI(); };
$('btnMaintView').onclick = () => focusMaint(LIFTERS[0]);
$('btnMaintView2').onclick = () => focusMaint(LIFTERS[1]);
$('btnMaintInfo').onclick = () => { openMaintCard(); };
$('autoAlarm').onchange = e => { autoAlarm = e.target.checked; autoAlarmT = 30; log(autoAlarm ? '開啟隨機異常' : '關閉隨機異常'); };
$('alarmList').addEventListener('click', e => {
  const btn = e.target.closest('button'), card = e.target.closest('.alarm'); if (!btn || !card) return;
  const a = alarms.find(x => x.id === +card.dataset.id); if (!a) return;
  if (btn.dataset.act === 'info') openAlarmCard(a);
  if (btn.dataset.act === 'view') focusAlarm(a);
  if (btn.dataset.act === 'clear') clearAlarm(a);
  updateUI();
});
$('alarmBanner').onclick = () => { if (alarms.length) { openAlarmCard(alarms[0]); focusAlarm(alarms[0]); } };
$('btnPause').onclick = () => { paused = !paused; $('btnPause').textContent = paused ? '▶ 繼續' : '⏸ 暫停'; };
$('btnView').onclick = () => { setFollow(null); resetView(); };
$('speed').oninput = e => { speed = +e.target.value; $('speedVal').textContent = speed + 'x'; };
$('procTime').oninput = e => { procTime = +e.target.value; $('procVal').textContent = procTime + 's'; };
$('hoistSpd').oninput = e => { HS = +e.target.value; $('hoistVal').textContent = HS.toFixed(1); };
$('vmax').oninput = e => { VMAX = +e.target.value; $('vmaxVal').textContent = VMAX; };
$('xray').onchange = e => {           // 透視模式：軌道與車殼半透明，看得到走行部、捲揚、側移機構
  xray = e.target.checked;
  [railMat, VG.white, VG.offWhite, ...vehicles.map(v => v.topMat)].forEach(m => setXrayMat(m, xray));
  vehicles.forEach(setHiddenParts);
};
$('showLabels').onchange = e => { showLabels = e.target.checked; labels.forEach(l => l.visible = showLabels); };
$('btnAdd').onclick = () => {
  if (vehicles.length >= VEH_MAX) { log(`已達天車上限 ${VEH_MAX} 台`); return updateUI(); }
  // 在主幹線上找一個離所有天車最遠的位置放新車
  let best = null;
  for (let s = 0; s < MAIN_LEN; s += 1) {
    const [sg, d] = mainLoc(s), [x, z] = sg.at(d);
    const m = Math.min(Infinity, ...vehicles.map(u => { const [ux, uz] = u.seg.at(u.d); return Math.hypot(ux - x, uz - z); }));
    if (!best || m > best.m) best = { sg, d, m };
  }
  if (!best || best.m < VLEN + 2) { log('主幹線空間不足，無法加車'); return updateUI(); }
  const nv = createVehicle(best.sg, best.d); log(`新增天車 ${nv.id}`); updateUI();
};
$('btnRemove').onclick = () => {
  const ok = x => x.state === 'idle' && !x.maintReq && !x.fault;          // 排隊等維修、故障中的車不移除
  const v = vehicles.find(x => ok(x) && x !== followed) || vehicles.find(ok);
  if (!v) { log('目前沒有閒置天車可移除'); return updateUI(); }
  if (v === followed) setFollow(null);
  scene.remove(v.group); scene.remove(v.label); vehicles.splice(vehicles.indexOf(v), 1);
  const li = labels.indexOf(v.label); if (li >= 0) labels.splice(li, 1);
  log(`移除天車 ${v.id}`); updateUI();
};

// 點擊天車跟隨
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let downXY = null;
renderer.domElement.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 5) return;
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const live = pickables.filter(m => vehicles.includes(m.userData.vehicle));
  const hit = ray.intersectObjects(live, false)[0];
  if (hit) setFollow(hit.object.userData.vehicle);
});

// ---------- 說明卡：優先級與路權、休息與推車 ----------
const INFO_CARDS = {
  pri: ['🔥 優先級與路權', `
    <h4>Lot 的優先級</h4><p>每個 Lot 都有優先級：<span class="pri0">一般</span>、<span class="pri1">急件（Hot Lot）</span>、<span class="pri2">特急（Super Hot）</span>。
    這個模擬大約 12% 是急件、3% 是特急。FOUP 上的色標：<span class="pri1">橘色＝急件</span>、<span class="pri2">紅色＝特急</span>；天車名牌也會標出來。</p>
    <h4>派車順序</h4><p>有空車時先派特急、再急件、最後一般；同一級的先來先派。</p>
    <h4>路權（匯流點誰先過）</h4><p>兩條軌道匯流時，只有拿到「匯流鎖」的車能過。誰拿到鎖，比的是路權分數：</p>
    <ol><li>特急載貨</li><li>特急去取貨</li><li>急件載貨</li><li>急件去取貨</li><li>一般載貨</li><li>一般去取貨</li><li>空車（閒置、休息、去保養）</li></ol>
    <p>路權每高一級，等於多等了 ${RANK_SEC} 秒。所以急件會先過，但一般的車等久了分數會一直加，最後還是輪得到，不會永遠插不進去。
    已經煞不住、一定會開過匯流點的車例外，一律先讓它過（避免急煞）。</p>
    <ul class="impact"><li>面板上的表格可以比較各優先級的平均等車時間、搬運週期</li><li>按「插一筆特急」，把一個還沒派車的 Lot 改成特急，看它怎麼插隊</li></ul>
    <p class="mut">各廠的優先級分幾級、路權怎麼算都不一樣，這裡是通用的簡化版，實際以各廠 MCS 設定為準。</p>`],
  comm: ['📶 天車怎麼跟控制系統連線（無線 AP）', `
    <h4>架構</h4><p>天花板上沿著軌道掛著固定的無線 AP，AP 用有線網路接回天車控制系統（OCS）；OCS 再跟上層的 MCS 拿搬運命令。
    天車<b>不是</b>每台都當 AP 組 Mesh，而是一直連著附近的一台 AP。這個模擬每個區塊掛 6 台（全廠 ${aps.length} 台），每台範圍約 ${AP_RANGE} 公尺。</p>
    <h4>漫遊（換 AP）</h4><p>天車邊開邊量訊號：離目前的 AP 太遠（這裡設 ${ROAM_TH} 公尺）、而且附近有明顯比較近的 AP，就切過去，切換只要零點幾秒，不用斷線重連。
    勾「顯示無線網路」可以看到每台車連到哪一台 AP（線的顏色＝AP），地上的圓圈是每台 AP 的範圍。</p>
    <h4>AP 斷線時</h4><p>相鄰 AP 的範圍刻意重疊，所以一台 AP 斷了，大部分車會漫遊到隔壁；隔壁也收不到的角落，天車會「通訊中斷」（頭上出現紅色記號）：</p>
    <ul class="impact"><li>手上已經收到的指令照做（路線已經在車上）</li><li>收不到新指令，派車系統不會派給它</li>
    <li>做完了回報不出去，MCS 不知道 FOUP 已經放好，那個 FOUP 的下一站也會延遲；恢復通訊後才補回報</li><li>前後車防撞靠車頭感測器，跟無線網路無關，所以不會因為斷線撞車</li></ul>
    <p class="mut">AP 數量、位置、漫遊門檻都是示意，實際以各廠網路規劃為準。</p>`],
  e84: ['🤝 E84 交握（天車 ↔ 機台 Load Port）', `
    <h4>為什麼要交握</h4><p>天車要把 FOUP 放到機台的 Load Port（或從上面拿走）之前，要先跟機台確認「現在可以」，不然機台正在動作時放下去會撞到。
    這套訊號的標準叫 SEMI E84，通常是 Load Port 旁邊的光通訊器（PIO）跟天車對傳，跟無線 AP 是分開的。</p>
    <h4>流程（簡化）</h4><ol><li>天車：CS_0（選哪個 Port）＋ VALID（我要開始了）</li><li>機台：L_REQ（可以放）／U_REQ（可以取）</li>
    <li>天車：TR_REQ（請求搬運）</li><li>機台：READY → 天車：BUSY（開始下降、取放）</li><li>取放完、捲揚升上來：天車 BUSY 關、COMPT（完成）</li><li>機台 READY 關 → 天車 VALID、COMPT 關，交握結束</li></ol>
    <h4>在模擬裡看</h4><ul class="impact"><li>跟隨一台天車，到機台 Load Port 時狀態會顯示 E84 每一步；Port 的燈號青色快閃＝交握中</li>
    <li>STB 儲格是被動的架子，不用交握，直接放</li>
    <li>機台當機時機台不會回應，天車等 ${E84_TIMEOUT} 秒逾時就放棄：放貨改送 STB、取貨取消</li></ul>
    <p class="mut">實際的訊號時序、逾時時間（TA1～TA3 等）依 E84 規範和各廠設定為準。</p>`],
  park: ['🅿 空車在軌道上休息、推車', `
    <h4>休息</h4><p>沒有接到指令的空車，不會一直繞圈，而是在軌道上找個不擋路的地方停下來休息（LED 綠燈調暗，狀態顯示「軌道上休息」）。
    可以停的地方：主幹線和區塊之間的連接線上，離分岔點夠遠、離下一個匯流點也夠遠，Bay 裡面不停。</p>
    <h4>推車</h4><p>後面有車要開過休息車的位置時，休息的車會被「推」著往前開，讓出路來（狀態顯示「被後車推著前進」），讓完再找下一個地方停。
    好幾台空車停在一起時，前面那台會被後面一台一台推走。</p>
    <h4>有任務的時候</h4><p>派車一樣找沿軌道最近的空車，休息中的車直接從原地出發。</p>
    <ul class="impact"><li>空車休息：省電、減少磨耗，主幹線上也比較不擠</li><li>代價：停的車擋到後面時，後車要先慢下來等它開走</li></ul>`],
};
function openInfoCard(kind) {
  if (typeof openAlarm !== 'undefined' && openAlarm) closeAlarmCard();
  maintCardOpen = false;
  const [title, body] = INFO_CARDS[kind], c = $('alarmCard');
  c.innerHTML = `<div class="hd"><span>${title}</span><button id="acClose">✕</button></div>${body}`;
  c.style.display = 'block';
  $('acClose').onclick = () => { c.style.display = 'none'; };
}
