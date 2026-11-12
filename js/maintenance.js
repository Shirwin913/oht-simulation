// maintenance.js — 車輛維修區：捲揚機（Lifter）把天車連同一小段軌道放到地面，人員在地面維修，修好再升回軌道
//   流程：排隊 → 前往維修區 → 捲揚機下降 → 地面維修 → 捲揚機上升 → 回到線上
//   一次只能修一台：那段軌道降下去的時候，軌道是斷的，所以下一台要等前一台升回來、離開以後才會被叫過去

const MAINT_STATES = ['maintLower', 'repair', 'maintRaise'];
const maintQueue = [];          // 等著進維修區的天車（排隊中照常巡航，但不派任務）
let maintDone = 0;

// ---------- 外觀 ----------
function buildLifter(LI) {
  const f = frameAt(LI.seg, LI.d);
  const g = new THREE.Group(); g.position.set(f.x, 0, f.z); g.rotation.y = f.th; scene.add(g);
  // 區域座標：x ＝ 沿軌道方向，z ＝ 軌道左右
  const b = makeBatch();
  const PX = 1.8, PZ = 1.05, TOP = H + 0.8, YEL = 0xf2c230, DARK = 0x2f3740;
  const post = new THREE.BoxGeometry(0.16, TOP, 0.16);
  [[PX, PZ], [PX, -PZ], [-PX, PZ], [-PX, -PZ]].forEach(([x, z]) => b.add(post, YEL, g, x, TOP / 2, z));
  const beamX = new THREE.BoxGeometry(2 * PX + 0.16, 0.18, 0.16), beamZ = new THREE.BoxGeometry(0.16, 0.18, 2 * PZ + 0.16);
  [PZ, -PZ].forEach(z => b.add(beamX, YEL, g, 0, TOP, z));
  [PX, -PX, 0.9, -0.9].forEach(x => b.add(beamZ, YEL, g, x, TOP, 0));
  // 四根柱子之間的斜撐（只做下半段，不擋人進出）
  const brace = new THREE.BoxGeometry(0.06, 0.06, 2 * PZ);
  [PX, -PX].forEach(x => b.add(brace, 0xd9a91c, g, x, 0.9, 0));
  // 頂上：馬達＋減速機，兩根捲筒軸（鏈條從捲筒放下來）
  b.add(new THREE.BoxGeometry(0.6, 0.42, 0.5), 0x3a4652, g, 0, TOP + 0.3, 0);
  b.add(new THREE.BoxGeometry(0.34, 0.3, 0.34), 0x1f2937, g, 0.45, TOP + 0.25, 0);
  const shaft = new THREE.CylinderGeometry(0.11, 0.11, 2.0, 14).rotateZ(Math.PI / 2);
  [0.62, -0.62].forEach(z => b.add(shaft, 0x6b7280, g, 0, TOP + 0.2, z));
  // 地面：鋼構平台、黃黑斑馬紋警示區、圍欄（一邊留出入口）
  b.add(new THREE.BoxGeometry(3.2, 0.3, 1.8), 0x5b6570, g, 0, 0.15, 0);
  const rail = new THREE.BoxGeometry(1, 0.05, 0.05), fp = new THREE.BoxGeometry(0.06, 1.1, 0.06);
  const FX = 2.3, FZ = 1.55;
  const fence = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0), n = Math.max(1, Math.round(L / 1.1));
    for (let i = 0; i <= n; i++) b.add(fp, YEL, g, x0 + (x1 - x0) * i / n, 0.55, z0 + (z1 - z0) * i / n);
    [0.5, 1.05].forEach(y => { const r = rail.clone(); r.scale(L, 1, 1); b.add(r, YEL, g, (x0 + x1) / 2, y, (z0 + z1) / 2, ry); });
  };
  fence(-FX, -FZ, FX, -FZ); fence(FX, -FZ, FX, FZ); fence(-FX, -FZ, -FX, FZ);
  fence(-FX, FZ, -0.7, FZ); fence(0.7, FZ, FX, FZ);                         // 正面中間是出入口
  // 維修工作台、工具櫃、零件架（擺在 Bay 中間的走道上）
  b.add(new THREE.BoxGeometry(1.6, 0.08, 0.75), 0x8b9299, g, -0.2, 0.9, 2.5);
  [[-0.9, -0.3], [0.5, -0.3], [-0.9, 0.3], [0.5, 0.3]].forEach(([x, z]) => b.add(new THREE.BoxGeometry(0.06, 0.88, 0.06), DARK, g, x, 0.44, 2.5 + z));
  b.add(new THREE.BoxGeometry(0.6, 1.1, 0.5), 0xc0392b, g, 1.55, 0.55, 2.55);        // 紅色工具櫃
  b.add(new THREE.BoxGeometry(1.2, 1.8, 0.45), 0x6b7682, g, -1.9, 0.9, 2.65);        // 零件架
  [0.45, 0.95, 1.45].forEach(y => b.add(new THREE.BoxGeometry(1.18, 0.04, 0.44), 0x9aa5b1, g, -1.9, y, 2.65));
  b.add(new THREE.BoxGeometry(0.35, 0.25, 0.3), 0x2563eb, g, -2.1, 1.6, 2.65);       // 備品盒
  b.add(new THREE.BoxGeometry(0.35, 0.25, 0.3), 0x16a34a, g, -1.65, 1.1, 2.65);
  scene.add(b.build(vcMat({ metalness: 0.35, roughness: 0.55 })));

  // 地上的斑馬紋（貼在平台四周）
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const cx = cv.getContext('2d'); cx.fillStyle = '#facc15'; cx.fillRect(0, 0, 256, 64); cx.fillStyle = '#111827';
  for (let i = -2; i < 12; i++) { cx.beginPath(); cx.moveTo(i * 32, 64); cx.lineTo(i * 32 + 16, 64); cx.lineTo(i * 32 + 48, 0); cx.lineTo(i * 32 + 32, 0); cx.fill(); }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(3, 1);
  const zebra = new THREE.Mesh(new THREE.PlaneGeometry(2 * FX, 2 * FZ), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  zebra.rotation.x = -Math.PI / 2; zebra.position.y = 0.015; zebra.receiveShadow = true; g.add(zebra);

  // 會動的部分：一小段軌道＋吊架（跟著天車一起升降），四條吊鏈
  const carrier = new THREE.Group(); g.add(carrier);
  const L = 2 * LIFT_HALF + 0.04;
  [[new THREE.BoxGeometry(L, 0.03, 0.62), 0.135, 0], [new THREE.BoxGeometry(L, 0.3, 0.03), 0, 0.295], [new THREE.BoxGeometry(L, 0.3, 0.03), 0, -0.295],
   [new THREE.BoxGeometry(L, 0.03, 0.17), -0.135, 0.195], [new THREE.BoxGeometry(L, 0.03, 0.17), -0.135, -0.195]]
    .forEach(([geo, y, z]) => { const m = new THREE.Mesh(geo, railMat); m.position.set(0, y, z); m.castShadow = true; carrier.add(m); });
  const frameMat = mat(YEL, { metalness: 0.4 });
  [0.9, -0.9].forEach(x => { const m = box(0.14, 0.12, 1.5, frameMat); m.position.set(x, 0.25, 0); carrier.add(m); });
  const lon = box(L, 0.1, 0.1, frameMat); lon.position.set(0, 0.25, 0); carrier.add(lon);
  [LIFT_HALF, -LIFT_HALF].forEach(x => { const m = box(0.05, 0.36, 0.7, mat(0x111827)); m.position.set(x, 0, 0); carrier.add(m); });   // 兩端的擋車板
  const chainMat = mat(0x4b5563, { metalness: 0.8, roughness: 0.35 });
  const chainGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6);
  const chains = [[0.9, 0.62], [0.9, -0.62], [-0.9, 0.62], [-0.9, -0.62]].map(([x, z]) => {
    const m = new THREE.Mesh(chainGeo, chainMat); m.userData.x = x; m.userData.z = z; g.add(m); return m;
  });
  // 頂上的旋轉警示燈：升降時閃
  const beaconMat = mat(0xf59e0b, { emissive: 0xf59e0b, emissiveIntensity: 0 });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.22, 12), beaconMat); beacon.position.set(-0.45, TOP + 0.62, 0); g.add(beacon);

  const label = makeLabel(`🔧 ${LI.name}・捲揚機`, { scale: 1.5, w: 400, bg: 'rgba(180,83,9,.92)' });
  label.position.set(f.x, TOP + 1.4, f.z); scene.add(label); labels.push(label);
  const status = makeLabel('空閒', { scale: 1.2, w: 320, bg: 'rgba(15,23,42,.85)', fg: '#67e8f9' });
  status.position.set(f.x, TOP + 0.85, f.z); scene.add(status); labels.push(status);
  return { g, carrier, chains, beaconMat, status, TOP, x: f.x, z: f.z, lastText: '' };
}
LIFTERS.forEach(L => L.vis = buildLifter(L));

function updateMaintVisuals(t) {
  for (const L of LIFTERS) {
    const LF = L.vis, y = liftY(L.rail);
    LF.carrier.position.y = y;
    const top = LF.TOP + 0.2, bot = y + 0.3;
    for (const c of LF.chains) { c.position.set(c.userData.x, (top + bot) / 2, c.userData.z); c.scale.y = Math.max(0.01, top - bot); }
    const v = L.busy, moving = v && (v.state === 'maintLower' || v.state === 'maintRaise');
    LF.beaconMat.emissiveIntensity = moving ? (Math.sin(t * 10) > 0 ? 2 : 0.1) : (v && v.state === 'repair' ? 0.4 : 0);
    const txt = lifterText(L);
    if (txt !== LF.lastText) { LF.lastText = txt; LF.status.userData.draw(txt); }
  }
}
// 一台捲揚機現在在做什麼
function lifterText(L) {
  const v = L.busy;
  if (!v) return '空閒';
  const s = { toMaint: '前往中', maintLower: '下降中', repair: `維修中 ${fmtDur(v.timer)}`, maintRaise: '上升中' }[v.state] || '';
  return `${v.id} ${s}`;
}
function maintStatusText() {
  return LIFTERS.map(L => `${L.name}：${lifterText(L)}`).join('　') + (maintQueue.length ? `　排隊 ${maintQueue.length} 台` : '');
}
// 離天車沿軌道最近的空捲揚機（都在忙就回傳 null）
function nearestFreeLifter(v) {
  let best = null, bd = Infinity;
  for (const L of LIFTERS) if (!L.busy) { const d = planRoute(v, L.seg, L.d).dist; if (d < bd) { bd = d; best = L; } }
  return best;
}
const distToLifter = v => Math.min(...LIFTERS.map(L => planRoute(v, L.seg, L.d).dist));

// ---------- 流程 ----------
function cancelPick(v) {
  const job = v.job;
  job.to.reserved = false; job.foup.job = null; jobs.splice(jobs.indexOf(job), 1);
  v.job = null; v.op = null; v.state = 'idle'; v.route = []; v.target = null;
  log(`✕ 取消 ${job.foup.id} 的取貨（${v.id} 要進維修區）`);
}
// 把天車排進維修區：why ＝ 'repair'（故障維修）或 'pm'（定期保養）
function requestMaint(v, why) {
  if (!v || v.maintReq || v.state === 'toMaint' || MAINT_STATES.includes(v.state)) return false;
  v.maintReq = why;
  if (v.state === 'toPick') cancelPick(v);                     // 還沒取到貨：任務取消，交給別台
  maintQueue.push(v);
  log(`🔧 ${v.id} 排入維修區（${why === 'pm' ? '定期保養' : '故障維修'}）${v.job ? '，先把手上的貨送完' : ''}`);
  return true;
}
// 切上線／下線：下線的車不再接新任務；手上的任務會做完，之後在線上慢慢巡航（不停在軌道上擋路）
function setOffline(v, off) {
  if (!v || !!v.offline === off) return;
  v.offline = off;
  if (off) log(`⏸ ${v.id} 切下線${v.job ? '（手上的任務做完後就不再接新任務）' : '，不再接新任務'}`);
  else {
    if (v.maintReq || v.state === 'toMaint' || MAINT_STATES.includes(v.state)) { v.offline = true; log(`${v.id} 還在保養流程中，不能切上線`); return; }
    log(`▶ ${v.id} 切上線，開始接任務`);
  }
}
// 對單台下線的車下「保養」指令
function vehPm(v) {
  if (!v || !v.offline) { log('要先把天車切下線，才能下保養指令'); return false; }
  return requestMaint(v, 'pm');
}
// 異常說明卡上的「送維修區」
function sendToMaint(a) {
  const v = a.target;
  clearAlarm(a);
  requestMaint(v, 'repair');
}
// 定期保養：挑一台閒置、沒在排隊的車
function sendPm() {
  const cand = vehicles.filter(v => v.state === 'idle' && !v.fault && !v.maintReq && !v.job && !v.offline);
  const v = cand.sort((a, b) => distToLifter(a) - distToLifter(b))[0];
  if (!v) { log('目前沒有閒置的天車可以送保養'); return null; }
  requestMaint(v, 'pm');
  return v;
}
// 每 0.5 秒（dispatch）：有捲揚機空著，就叫排最前面、已經閒下來的車去離它最近的那台
function stepMaintQueue() {
  for (let i = maintQueue.length - 1; i >= 0; i--) if (!vehicles.includes(maintQueue[i])) maintQueue.splice(i, 1);
  for (const L of LIFTERS) if (L.busy && !vehicles.includes(L.busy)) { L.busy = null; L.rail = 0; }
  for (const v of maintQueue.slice()) {
    if (v.state !== 'idle' || v.fault || v.job || !commOk(v)) continue;   // 通訊中斷的車收不到「去維修區」的指令
    const L = nearestFreeLifter(v);
    if (!L) break;                                               // 兩台都在忙
    if (!setTarget(v, L)) continue;
    maintQueue.splice(maintQueue.indexOf(v), 1);
    v.state = 'toMaint'; v.lifter = L; L.busy = v;
    log(`🔧 ${v.id} 前往${L.name}（${L.bay.name}）`);
  }
}
// 捲揚機上的天車：下降 → 地面維修 → 上升
function stepMaintVehicle(v, dt) {
  v.v = 0;
  switch (v.state) {
    case 'maintLower':
      v.lift = Math.min(1, (v.lift || 0) + dt / LIFT_TIME); v.lifter.rail = v.lift;
      if (v.lift >= 1) {
        v.state = 'repair';
        v.timer = (v.maintReq === 'pm' ? PM_TIME : REPAIR_TIME) * (0.75 + Math.random() * 0.5);
        log(`🔧 ${v.id} 已降到地面，開始${v.maintReq === 'pm' ? '定期保養' : '維修'}`);
      }
      break;
    case 'repair':
      v.timer -= dt;
      if (v.timer <= 0) { v.timer = 0; v.state = 'maintRaise'; log(`🔧 ${v.id} ${v.maintReq === 'pm' ? '保養' : '維修'}完成，捲揚機上升`); }
      break;
    case 'maintRaise':
      v.lift = Math.max(0, v.lift - dt / LIFT_TIME); v.lifter.rail = v.lift;
      if (v.lift <= 0) {
        v.lift = 0; v.lifter.rail = 0; v.lifter.busy = null; v.lifter = null; maintDone++;
        v.state = 'idle'; v.maintReq = null; v.route = []; v.target = null;
        if (v.offline) log(`✔ ${v.id} 回到軌道，保養完成；仍是下線狀態，確認沒問題後請切上線`);
        else log(`✔ ${v.id} 回到軌道，重新上線`);
      }
      break;
  }
}

// ---------- 說明卡 ----------
let maintCardOpen = false;
function renderMaintCard() {
  const c = document.getElementById('alarmCard'), busy = LIFTERS.filter(L => L.busy);
  c.innerHTML = `<div class="hd"><span>🔧 車輛維修區・捲揚機（Lifter）</span><button id="acClose">✕</button></div>
    <div class="mut">${LIFTERS.map(L => `${L.name}（${L.bay.name}）：${lifterText(L)}`).join(' · ')} · 排隊 ${maintQueue.length} 台 · 已修好 ${maintDone} 台</div>
    <h4>這是什麼</h4><p>天車吊在天花板的軌道上，人員爬上去修既危險又不方便。所以會在一條專用的 Bay 設「車輛維修區」，
    軌道上有一段是活動的：天車開到這段軌道上停好，捲揚機就把<b>天車連同這段軌道</b>一起用鏈條慢慢放到地面，人員站在地上就能檢修。</p>
    <h4>流程</h4><ol><li>天車排進維修區（故障車、或是到了定期保養的時間）</li><li>手上有貨的先送完；還沒取到貨的任務取消，交給別台</li>
    <li>開到捲揚機上方停好 → 捲揚機下降（頂上黃燈閃）</li><li>地面維修／保養（倒數計時）</li><li>捲揚機上升，軌道接回去 → 天車重新上線</li></ol>
    <h4>要注意的地方</h4><ul class="impact"><li>全廠有 ${LIFTERS.length} 個維修區，每一台捲揚機一次只能修一台：軌道降下去時那段是斷的。排隊的車會被叫去離自己最近、空著的那一台</li>
    <li>排隊中的車照常在線上巡航，但不會派新任務，所以線上能用的車會變少</li>
    <li>升降中和車在地面時，圍欄內禁止進入；實際作業要先上鎖掛牌（LOTO）</li></ul>
    <p class="mut">實務上故障車常常要先切手動模式，由人員慢慢開到維修區。以上為通用做法，實際以各廠 SOP 為準。</p>
    <div class="btns">${LIFTERS.map(L => `<button data-mv="${L.no - 1}">看${L.name}</button>`).join('')}${busy.map(L => `<button data-mf="${L.no - 1}">跟隨 ${L.busy.id}</button>`).join('')}<button id="mcPm" class="ok">送一台去保養</button></div>`;
  c.style.display = 'block';
  document.getElementById('acClose').onclick = closeMaintCard;
  c.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => focusMaint(LIFTERS[+b.dataset.mv]));
  c.querySelectorAll('[data-mf]').forEach(b => b.onclick = () => { const v = LIFTERS[+b.dataset.mf].busy; if (v) setFollow(v); });
  document.getElementById('mcPm').onclick = () => { sendPm(); renderMaintCard(); };
}
function openMaintCard() { if (openAlarm) closeAlarmCard(); maintCardOpen = true; renderMaintCard(); }
function closeMaintCard() { maintCardOpen = false; document.getElementById('alarmCard').style.display = 'none'; }
function focusMaint(L = LIFTERS[0]) { const LF = L.vis; setFollow(null); controls.target.set(LF.x, 2.5, LF.z); camera.position.set(LF.x + 9, 9, LF.z + 11); }
