// ui.js — 右側控制面板、統計數字、天車列表、事件紀錄、點擊跟隨

// ================== UI ==================
const $ = id => document.getElementById(id);
let lastStock = -1;
function updateUI() {
  updateNtbUI();
  $('simTime').textContent = fmt(simTime);
  $('done').textContent = completed;
  $('tph').textContent = simTime > 60 ? Math.round(completed / (simTime / 3600)) : '–';
  $('avgWait').textContent = waitN ? (waitSum / waitN).toFixed(1) + 's' : '–';
  $('avgCycle').textContent = completed ? (cycleSum / completed).toFixed(1) + 's' : '–';
  $('queue').textContent = jobs.filter(j => !j.vehicle).length;
  $('active').textContent = jobs.filter(j => j.vehicle).length;
  $('foupTotal').textContent = ports.filter(p => p.foup).length + vehicles.filter(v => v.carry).length;
  const stbPorts = ports.filter(p => p.owner.type === 'stb'), used = stbPorts.filter(p => p.foup).length;
  $('stbUse').textContent = `${used}/${stbPorts.length}（${(used / stbPorts.length * 100).toFixed(1)}%）`;
  const waitingStorage = ports.filter(p => p.owner.type === 'machine' && p.foup && p.foup.storageWaitingSince != null && !p.foup.job);
  const emptyStbs = stbPorts.filter(p => !p.foup).length, reservedStbs = stbPorts.filter(p => !p.foup && p.reserved).length;
  const longestStorage = waitingStorage.reduce((n,p) => Math.max(n, simTime - p.foup.storageWaitingSince), 0);
  $('storageInfo').innerHTML = `實體空儲格：${emptyStbs} 格（已預約 ${reservedStbs} 格）<br>等待空儲位：<b>${waitingStorage.length}</b> 個 FOUP<br>目前最久等待：${Math.floor(longestStorage)} 秒<br>已取得儲位的平均等待：${storageWaitCount ? (storageWaitSum / storageWaitCount).toFixed(1) + ' 秒' : '—'}` + (waitingStorage.length ? `<details ${$('storageInfo').querySelector('details[open]') ? 'open' : ''}><summary>查看等待中的機台</summary>${waitingStorage.map(p => `<div>${p.name} · ${p.foup.id} · ${Math.floor(simTime - p.foup.storageWaitingSince)} 秒<br>${p.foup.storageWaitReason}</div>`).join('')}</details>` : '');
  $('vehTotal').textContent = vehicles.length;
  $('vehCount').textContent = vehicles.length;
  $('vehList').innerHTML = vehicles.map(v => {
    const route = v.job ? `${v.job.from.name} → ${v.job.to.name}` : '';
    const pr = v.job && v.job.pri ? `<span class="pri${v.job.pri}">【${PRI_NAME[v.job.pri]}】</span>` : '';
    return `<tr class="v${v === followed ? ' sel' : ''}" data-id="${v.id}"><td><i class="dot" style="background:${v.color}"></i>${v.id}</td>` +
      `<td>${stateText(v)}</td><td class="route" title="${route}">${pr}${route}</td><td style="text-align:right">${v.v.toFixed(1)}</td></tr>`;
  }).join('');
  renderAlarms();
  $('alarmCount').textContent = alarms.length; $('alarmBadge').textContent = alarms.length || ''; $('alarmBadge').className = alarms.length ? 'on' : '';
  renderHmi();
  const nc = vehicles.filter(v => v.noComm), ho = vehicles.filter(v => v.handover > 0).length;
  $('commBadge').textContent = COMM_MODE === 'mesh' ? '📡 通訊：天車 Mesh 網狀網路' : '📶 通訊：固定 AP＋漫遊';
  $('commBadge').className = COMM_MODE === 'mesh' ? 'mesh' : '';
  $('commInfo').innerHTML = (COMM_MODE === 'mesh'
    ? `閘道器：${gws.length - gws.filter(g => g.down).length}／${gws.length} 台正常 · 連上 ${meshStat.ok}／${vehicles.length} 台 · 平均 ${meshStat.avgHop.toFixed(1)} 跳、最多 ${meshStat.maxHop} 跳` +
      `<br>延遲：平均 ${Math.round(meshStat.avgLat)} ms、最大 ${Math.round(meshStat.maxLat)} ms（超過 ${LAT_MAX} ms 算逾時）· 最滿的閘道器 ${(() => { const g = gws.slice().sort((p, q) => (q.load || 0) - (p.load || 0))[0]; return `${g.id} ${g.load || 0}／${GW_CAP}`; })()} · 容量滿了連不上 ${apFullCount} 次`
    : `AP：${aps.length - aps.filter(a => a.down).length}／${aps.length} 台正常 · 漫遊（換 AP）${roamCount} 次` + (() => {
        const top = aps.slice().sort((p, q) => loadOf(q) - loadOf(p))[0], ld = loadOf(top);
        return `<br>最滿的 AP：${top.id} <b style="color:${ld >= AP_CAP ? '#f87171' : ld >= AP_CAP * 0.75 ? '#facc15' : 'inherit'}">${ld}／${AP_CAP}</b> · 因為 AP 滿了連不上 ${apFullCount} 次`; })()) +
    (DISPATCH_MODE === 'auto' ? `<br>自主接任務 ${autoStat.claims} 筆 · 平均 ${(autoStat.bids / Math.max(1, autoStat.claims)).toFixed(1)} 台出價 · 有競爭 ${autoStat.contested} 筆` : '') +
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
$('btnHmi').onclick = () => { if (followed) openHmi(followed, 'main'); };
$('btnOnline').onclick = () => { if (followed) setOffline(followed, !followed.offline); updateUI(); };
$('btnVehPm').onclick = () => { if (followed) vehPm(followed); updateUI(); };
// 異常事件
document.querySelectorAll('[data-alarm]').forEach(b => b.onclick = () => {
  const t = b.dataset.alarm;
  const a = ({ vehicle: raiseVehicleFault, transfer: raiseTransferFault, machine: raiseMachineDown, track: raiseTrackBlock, ap: raiseApDown, host: raiseHostDown, curtain: raiseCurtain, hand: raiseHandFail, claw: raiseClawUnknown, near: raiseNearPort, norec: raiseNoRecover })[t]();
  if (a) { openAlarmCard(a); focusAlarm(a); } else if (!['transfer', 'curtain', 'hand', 'claw', 'near'].includes(t)) log('現在找不到可以發生這個異常的對象');
  updateUI();
});
function setShowComm(on) { showComm = on; $('showComm').checked = on; }
$('showComm').onchange = e => setShowComm(e.target.checked);
$('btnCommInfo').onclick = () => {                                      // 看說明時先打開連線顯示；關掉說明就恢復原本的設定
  const prev = showComm; setShowComm(true);
  openInfoCard('comm', () => setShowComm(prev));
  const c = $('alarmCard'), b = document.createElement('div'); b.className = 'btns';
  b.innerHTML = '<button id="icComm"></button>'; c.appendChild(b);
  const sync = () => { $('icComm').textContent = showComm ? '隱藏 AP 範圍和連線' : '顯示 AP 範圍和連線'; };
  $('icComm').onclick = () => { setShowComm(!showComm); sync(); }; sync();
};
$('btnE84Info').onclick = () => openInfoCard('e84');
$('apCap').oninput = e => { AP_CAP = +e.target.value; $('apCapVal').textContent = AP_CAP + ' 台'; };
$('gwCap').oninput = e => { GW_CAP = +e.target.value; $('gwCapVal').textContent = GW_CAP + ' 台'; };
$('relayCap').oninput = e => { RELAY_CAP = +e.target.value; $('relayCapVal').textContent = RELAY_CAP + ' 台'; };
$('commMode').onchange = e => { setCommMode(e.target.value); setShowComm(true); updateUI(); };   // 切換時自動打開顯示，才看得出差別
$('dispMode').onchange = e => { DISPATCH_MODE = e.target.value; log(DISPATCH_MODE === 'auto' ? '🤝 派車方式切換：天車自主接任務（競標）' : '🖥 派車方式切換：中央派車（MCS 指定最近的車）'); updateUI(); };
$('btnMeshInfo').onclick = () => { const prev = showComm; setShowComm(true); openInfoCard('mesh', () => setShowComm(prev)); };
$('btnAutoInfo').onclick = () => openInfoCard('auto');
$('btnHot').onclick = () => { insertHotLot(); updateUI(); };
$('btnPriInfo').onclick = () => openInfoCard('pri');
$('btnParkInfo').onclick = () => openInfoCard('park');
$('gfxLevel').value = GFX.pref;
$('gfxLevel').onchange = e => {                                         // 畫質：記在這台電腦的瀏覽器裡，下次開也用同樣設定
  GFX.pref = e.target.value; try { localStorage.setItem('ohtGfx', GFX.pref); } catch (err) {}
  const lv = GFX.pref === 'auto' ? (GFX.weak ? 'mid' : 'high') : GFX.pref;
  applyGfx(lv, `🖥 畫質：${GFX.pref === 'auto' ? '自動（' + GFX_LEVELS[lv].name + '）' : GFX_LEVELS[lv].name}`);
};
$('btnQtimeInfo').onclick = () => openInfoCard('qtime');
$('btnDispatchInfo').onclick = () => openInfoCard('dispatch');
$('btnDirectInfo').onclick = () => openInfoCard('direct');
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
// 右側面板分頁
function showPanelTab(k) {
  document.querySelectorAll('.ptabs [data-pt]').forEach(b => b.classList.toggle('cur', b.dataset.pt === k));
  document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('cur', t.dataset.ptab === k));
}
document.querySelectorAll('.ptabs [data-pt]').forEach(b => b.onclick = () => showPanelTab(b.dataset.pt));
showPanelTab('ov');
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
    <h4>AP 連線數上限</h4><p>一台 AP 同時能連的天車有限（這裡預設 ${AP_CAP} 台，可以在「系統功能」調）。滿了，新來的車只能找旁邊的 AP；旁邊也滿了或收不到，就會斷線。
    平常車子分散不會滿；但前面有車故障擋路、後面塞了一長串時，那一區的 AP 就可能被塞滿，後面的車跟著斷線。顯示無線網路時，AP 名牌會寫「連線數／上限」，範圍圈快滿變黃、滿了變紅。</p>
    <h4>AP 斷線時</h4><p>相鄰 AP 的範圍刻意重疊，所以一台 AP 斷了，大部分車會漫遊到隔壁；隔壁也收不到的角落，天車會「通訊中斷」（頭上出現紅色記號）：</p>
    <ul class="impact"><li>手上已經收到的指令照做（路線已經在車上）</li><li>收不到新指令，派車系統不會派給它</li>
    <li>做完了回報不出去，MCS 不知道 FOUP 已經放好，那個 FOUP 的下一站也會延遲；恢復通訊後才補回報</li><li>前後車防撞靠車頭感測器，跟無線網路無關，所以不會因為斷線撞車</li></ul>
    <p class="mut">AP 數量、位置、漫遊門檻都是示意，實際以各廠網路規劃為準。</p>`],
  e84: ['🤝 E84 交握（天車 ↔ 機台 Load Port）', `
    <h4>為什麼要交握</h4><p>天車要把 FOUP 放到機台的 Load Port（或從上面拿走）之前，要先跟機台確認「現在可以」，不然機台正在動作時放下去會撞到。
    這套訊號的標準叫 SEMI E84，通常是 Load Port 旁邊的光通訊器（PIO）跟天車對傳，跟無線 AP 是分開的。</p>
    <h4>流程（簡化）</h4><ol><li>前提：機台送出 HO_AVBL（可以交握）＝ON，代表機台正常、Load Port 前面的光閘沒被擋到</li><li>天車：CS_0（選哪個 Port）＋ VALID（我要開始了）</li><li>機台：L_REQ（可以放）／U_REQ（可以取）</li>
    <li>天車：TR_REQ（請求搬運）</li><li>機台：READY → 天車：BUSY（開始下降、取放）</li><li>取放完、捲揚升上來：天車 BUSY 關、COMPT（完成）</li><li>機台 READY 關 → 天車 VALID、COMPT 關，交握結束</li></ol>
    <h4>光閘和 HO_AVBL</h4><p>Load Port 靠走道那一側有兩根光閘柱（頂端橘色），柱子上有指示燈條：平常是<b>綠色</b>，被擋到時變<b>紅色</b>，中間有看不見的光束。取放貨過程中只要有東西擋到光閘，或機台異常，
    機台的 HO_AVBL 就會變 OFF，天車立刻停止捲揚、這次取放貨失敗（E-204），要人員確認淨空、機台復歸後，再用操作介面復歸，天車會重新交握再做一次。
    「異常」分頁的「光閘遮斷（E84 中斷）」可以示範：光束會變紅閃，操作介面主畫面的 E84 訊號燈 HO_AVBL 會變紅。</p>
    <h4>在模擬裡看</h4><ul class="impact"><li>跟隨一台天車，到機台 Load Port 時狀態會顯示 E84 每一步；Port 的燈號青色快閃＝交握中；操作介面主畫面有 E84 訊號燈</li>
    <li>STB 儲格是被動的架子，不用交握，直接放</li>
    <li>機台當機時機台不會回應，天車等 ${E84_TIMEOUT} 秒逾時就放棄：放貨改送 STB、取貨取消</li></ul>
    <p class="mut">實際的訊號時序、逾時時間（TA1～TA3 等）依 E84 規範和各廠設定為準。</p>`],
  mesh: ['📡 天車 Mesh 網狀網路', `
    <h4>跟固定 AP 有什麼不同</h4><p>固定 AP：每台天車直接連天花板上最近的 AP。<br>
    Mesh：每台天車本身也是一個無線節點，會<b>幫別台車轉送</b>訊息；訊息一跳一跳傳到「閘道器」（接有線網路的節點），再回到控制系統。
    這個模擬每個區塊掛 2 台閘道器（黃色，全廠 ${gws.length} 台），天車之間約 ${MESH_R} 公尺內能互傳，閘道器範圍約 ${GW_R} 公尺。</p>
    <h4>在畫面上看</h4><p>上面「通訊方式」選「天車 Mesh 網狀網路」，勾「顯示無線網路」：每台車拉一條線到它的「下一跳」（另一台車或閘道器），顏色代表第幾跳：綠＝1～2 跳、黃＝3 跳、橘＝4 跳、紅＝5 跳以上。</p>
    <h4>Mesh 也有容量限制</h4><p>每台閘道器最多接 ${GW_CAP} 台車（包含經過轉送進來的），每台天車最多幫 ${RELAY_CAP} 台車轉送；大家共用同一個無線頻道，
    車越擠每一跳的延遲增加越快，總延遲超過 ${LAT_MAX} ms 就逾時。所以 Mesh 不會有「AP 被塞滿」的問題，但塞車時瓶頸會換到「靠近閘道器的轉送車」和「頻道擁擠」。三個上限都可以在「系統功能」調。</p>
    <h4>優點和缺點</h4><ul class="impact"><li>需要的固定設備少，閘道器或某台車斷了會自動改走別條路（自我修復）</li>
    <li>要靠天車夠密：車少、區域偏僻時可能連不上；跳數越多延遲越大</li><li>軌道上休息的空車也能幫忙轉送</li>
    <li>可以試試：觸發「無線 AP 斷線」（Mesh 模式下是閘道器斷線），或減少天車數量，看看斷線的車變多</li></ul>
    <p class="mut">範圍、閘道器數量都是示意，實際以各廠設備為準。</p>`],
  auto: ['🤝 天車自主接任務（競標）', `
    <h4>中央派車</h4><p>MCS／OCS 看全廠，把每筆任務直接指定給沿軌道最近的空車。</p>
    <h4>自主接任務</h4><p>MCS 只把任務<b>公告</b>出去。閒置的天車自己看附近（沿軌道 ${AUTO_RANGE} 公尺內）的任務，自己算路線出價；最近的車得標（急件、特急出價加分）。
    太遠的任務一開始沒人接，<b>等越久公告範圍越大</b>（每秒多 ${AUTO_GROW} 公尺），最後一定有車接。紀錄會寫「V12 自主接任務（3 台出價）」。</p>
    <h4>優點和缺點</h4><ul class="impact"><li>每台車自己決定、自己規劃路線，控制系統的負擔小；中央系統短暫有問題時比較不會全部停擺</li>
    <li>偏遠位置的任務要等公告範圍擴大才有人接，等車時間可能比較久</li>
    <li>可以切換兩種派車方式，比較面板上的「平均等車時間」和「每小時搬運量」</li></ul>
    <p class="mut">「自主接任務」需要天車連得上控制系統才看得到公告（固定 AP 或 Mesh 都可以）。範圍、加分都是示意。</p>`],
  park: ['🅿 空車在軌道上休息、推車', `
    <h4>休息</h4><p>沒有接到指令的空車，不會一直繞圈，而是在軌道上找個不擋路的地方停下來休息（狀態燈變白色＝待機，狀態顯示「軌道上休息」）。
    可以停的地方：主幹線和區塊之間的連接線上，離分岔點夠遠、離下一個匯流點也夠遠，Bay 裡面不停。</p>
    <h4>推車</h4><p>後面有車要開過休息車的位置時，休息的車會被「推」著往前開，讓出路來（狀態顯示「被後車推著前進」），讓完再找下一個地方停。
    好幾台空車停在一起時，前面那台會被後面一台一台推走。</p>
    <h4>有任務的時候</h4><p>派車一樣找沿軌道最近的空車，休息中的車直接從原地出發。</p>
    <ul class="impact"><li>空車休息：省電、減少磨耗，主幹線上也比較不擠</li><li>代價：停的車擋到後面時，後車要先慢下來等它開走</li></ul>`],
  qtime: ['⏱ Q-time（等候時間限制）', `
    <h4>Q-time 是什麼</h4><p>Q-time（Queue time）是<b>兩道製程之間最多能等多久</b>的規定。例如晶圓做完清洗後，要在 4 小時內進爐管；
    超過時間，表面可能重新氧化或沾上微粒，這批貨就可能要重工、送工程判定，甚至報廢。</p>
    <h4>對派工和搬運的影響</h4><ul>
      <li>有 Q-time 的貨，派工時通常會被提高優先順序；越接近到期越急。</li>
      <li>搬運越少繞路越好：少回一次儲位，就少等一段時間（見「機台直送」說明）。</li>
      <li>天車異常、軌道塞車、派車系統當機，都可能讓貨超過 Q-time。所以現場異常要盡快復歸。</li></ul>
    <h4>這個模擬</h4><p>目前還沒有模擬 Q-time，只有一般、急件、特急三種優先級。</p>
    <ul class="impact"><li>超過 Q-time：可能要重工、工程判定或報廢，損失比單純延遲大很多</li></ul>`],
  dispatch: ['📋 派工與派車邏輯（這個模擬）', `
    <p class="mut">以下是這個模擬的簡化規則，用來教學；實際工廠以 MCS／RTD 的設定為準。</p>
    <h4>第一步：決定貨要去哪（產生搬運任務）</h4>
    <table class="kt"><tr><th>貨在哪裡</th><th>要去哪裡</th></tr>
      <tr><td>STB 儲位</td><td>放滿暫存時間後（最長 40 分鐘的 30%～100%），送到沿軌道最近的空機台</td></tr>
      <tr><td>機台做完</td><td>做完時抽一次決定流向、之後不改：60% 直接送下一台機台、40% 回 STB</td></tr>
      <tr><td>　└ 送機台</td><td>從最近的 12 台空機台隨機挑一台；另有 25% 機率挑全廠任何一台（多半跨區）</td></tr>
      <tr><td>　└ 回 STB</td><td>最近的空儲位；儲位滿了就留在機台 Port 上等，不改送機台</td></tr>
      <tr><td>NTB 投貨座</td><td>最近的空儲位</td></tr>
      <tr><td>空 FOUP</td><td>留在儲位，等人員下 NTB 出庫指令</td></tr></table>
    <ul><li>特急、急件比一般貨先挑目的地，避免空機台被一般貨搶光。</li>
      <li>目的地選好就先「預約」，一個空位只給一筆任務。</li>
      <li>每顆貨開場抽一次優先級：約 3% 特急、12% 急件，其他一般；空 FOUP 一律一般。</li></ul>
    <h4>第二步：派哪台車</h4><ul>
      <li><b>中央派車</b>：任務依「特急 → 急件 → 一般」排序，同級先建立的先派；每筆派給沿軌道最近的閒置天車。</li>
      <li><b>自主接任務</b>：天車自己看附近 45 公尺內的任務來搶，範圍會隨等待時間慢慢擴大。</li>
      <li>故障、下線、手動、通訊中斷、排隊等保養的車不會被派。</li></ul>
    <h4>跟真實 RTD 的差別</h4><p>這個模擬是「<b>貨挑機台</b>」：貨準備好就找最近的空機台。
    真實工廠多半是「<b>機台挑貨</b>」：機台空了，RTD 從所有在等的貨裡，依優先級、Q-time、等待時間、recipe 等規則挑一顆上機。</p>`],
  direct: ['🔀 機台直送 vs 先回儲位', `
    <p>貨在機台做完後，有兩種走法：</p><ol>
      <li><b>先回儲位</b>：機台 → STB → 下一台機台，共兩趟搬運。</li>
      <li><b>機台直送</b>（tool-to-tool）：下一站有機台空著、而且可以收貨，就直接送過去，一趟搬運。</li></ol>
    <h4>直送的好處</h4><ul>
      <li>搬運次數變少，天車負擔和軌道擁擠降低。</li>
      <li>這顆貨等待時間變短，對有 Q-time 的製程特別有幫助。</li>
      <li>少一次取放，就少一次取放貨異常的機會。</li></ul>
    <h4>很多廠還是先回儲位的原因</h4><ul>
      <li><b>派工通常是機台挑貨</b>：一律直送，等比較久或更急的 Lot 可能被插隊。</li>
      <li><b>空著不代表能收</b>：機台可能在換 recipe、等工程確認、準備 PM，或已經預約給別的貨。</li>
      <li><b>Lot 本身可能還不能走</b>：要抽檢、被 Hold，或系統上還沒完成出站和下一站的進站。</li>
      <li><b>會佔住下一台的 Load Port</b>：送過去不能馬上開始，就卡在 Port 上擋到別的貨。</li>
      <li><b>車還沒到，機台可能被搶走</b>：所以直送一定要先預約下一台的 Port。</li></ul>
    <h4>這個模擬</h4><p>目前是混合的：機台做完約 60% 直接送下一台、40% 回 STB，是隨機分配，不是看下一台有沒有空來決定。</p>`],
};
function openInfoCard(kind, onClose) {
  if (typeof openAlarm !== 'undefined' && openAlarm) closeAlarmCard();
  maintCardOpen = false;
  const [title, body] = INFO_CARDS[kind], c = $('alarmCard');
  c.innerHTML = `<div class="hd"><span>${title}</span><button id="acClose">✕</button></div>${body}`;
  c.style.display = 'block';
  $('acClose').onclick = () => { c.style.display = 'none'; if (onClose) onClose(); };
}

// 只變更下一次初始化的佔用率，不在運行途中憑空增減貨物。
if (!$('stbFill').querySelector(`option[value="${STB_INITIAL_FILL}"]`)) {
  const o = document.createElement('option'); o.value = STB_INITIAL_FILL; o.textContent = STB_INITIAL_FILL + '%'; $('stbFill').appendChild(o);
}
$('stbFill').value = String(STB_INITIAL_FILL);
$('applyStbFill').onclick = () => { const url = new URL(location.href); url.searchParams.set('stbFill', $('stbFill').value); location.href = url.href; };
