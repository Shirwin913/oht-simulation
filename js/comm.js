// comm.js — 天車和控制系統（OCS）之間的無線通訊：天花板上的固定 AP、天車邊開邊漫遊（換 AP）、AP 斷線
//
// 架構（一般 OHT 的做法）：AP 固定掛在天花板、用有線網路接回控制系統；天車不互相組 Mesh，
// 而是一直連著附近的 AP，訊號變弱就切到比較近的另一台 AP（漫遊）。
// 天車收不到任何 AP 時＝通訊中斷：手上已經收到的指令照做，但收不到新指令、做完了也回報不出去，
// 要等通訊恢復才補回報（這段時間 MCS 不知道 FOUP 已經放好，所以那個 FOUP 也不會被安排下一站）。
// 前後車防撞靠車頭的感測器，跟無線網路無關。

const AP_RANGE = 22;        // 訊號夠用的距離（公尺）
const ROAM_TH = 15;         // 離目前的 AP 超過這個距離，就開始找比較近的 AP
const ROAM_GAIN = 2;        // 新 AP 要比目前的近這麼多才換（避免在兩台 AP 中間一直來回切）
const HANDOVER_TIME = 0.3;  // 切換 AP 要花的時間（秒）
let showComm = false, roamCount = 0, e84Count = 0;

// ---------- AP 擺放：每個區塊 3×2 台，掛在天花板 ----------
const aps = [];
ZONES.forEach(z => [-24, 0, 24].forEach(dx => [-13, 13].forEach(dz => aps.push({ id: `AP-${z.name}${aps.filter(a => a.zone === z).length + 1}`, zone: z, x: z.cx + dx, z: z.zc + dz, down: null }))));
aps.forEach((a, i) => { a.idx = i; a.color = new THREE.Color().setHSL((i * 0.618) % 1, 0.75, 0.6); });

{
  const b = makeBatch(), Y = 10.25;
  for (const a of aps) {
    b.add(new THREE.BoxGeometry(0.4, 0.06, 0.4), 0x2f3740, null, a.x, 10.47, a.z);       // 天花板固定座
    b.add(new THREE.BoxGeometry(0.36, 0.1, 0.36), 0xeef0f1, null, a.x, Y + 0.12, a.z);   // AP 本體
    [[0.13, 0.13], [-0.13, 0.13], [0.13, -0.13], [-0.13, -0.13]].forEach(([ox, oz]) =>  // 四支天線（朝下）
      b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 6), 0x1f2937, null, a.x + ox, Y - 0.06, a.z + oz));
  }
  b.build(vcMat({ roughness: 0.5 }));
  const ledGeo = new THREE.BoxGeometry(0.12, 0.02, 0.04);
  for (const a of aps) {
    a.ledMat = mat(0x0a2a12, { emissive: 0x22c55e, emissiveIntensity: 1.2 });
    const led = new THREE.Mesh(ledGeo, a.ledMat); led.position.set(a.x, 10.31, a.z + 0.18); scene.add(led);
    const lb = makeLabel(a.id, { scale: 0.7, w: 170, bg: 'rgba(15,23,42,.8)', fg: '#a5f3fc' }); lb.position.set(a.x, 9.75, a.z); scene.add(lb); labels.push(lb);
    // 涵蓋範圍（地板上的圓圈，勾「顯示無線網路」才看得到）
    a.ringMat = new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    a.ring = new THREE.Mesh(new THREE.RingGeometry(AP_RANGE - 0.25, AP_RANGE, 72), a.ringMat);
    a.ring.rotation.x = -Math.PI / 2; a.ring.position.set(a.x, 0.04 + a.idx * 0.001, a.z); a.ring.visible = false; scene.add(a.ring);
  }
}
// 天車 → AP 的連線（細線，顏色＝連到哪一台 AP）
const commLines = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VEH_MAX * 6), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(VEH_MAX * 6), 3));
  const ln = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
  ln.frustumCulled = false; ln.visible = false; scene.add(ln); return ln;
})();
// 通訊中斷的車頭上顯示紅色記號
const noCommMarks = new Map();
function noCommMark(v, on) {
  let m = noCommMarks.get(v);
  if (on && !m) { m = makeLabel('📶✕ 通訊中斷', { scale: 0.8, w: 260, bg: 'rgba(127,29,29,.92)', fg: '#fecaca' }); scene.add(m); noCommMarks.set(v, m); }
  if (!on && m) { scene.remove(m); noCommMarks.delete(v); }
}

const vPos = v => v.seg.at(Math.min(v.d, v.seg.len));                   // 天車在軌道上的位置（不靠畫面更新）
const apDist = (a, v) => { const [x, z] = vPos(v); return Math.hypot(a.x - x, a.z - z); };
function bestAp(v) {
  let best = null, bd = Infinity;
  for (const a of aps) if (!a.down) { const d = apDist(a, v); if (d < bd) { bd = d; best = a; } }
  return bd <= AP_RANGE ? [best, bd] : [null, Infinity];
}
const commOk = v => !!v.ap && !v.noComm;          // 派車系統只派給「連得上」的車

// ---------- 每 0.25 秒：漫遊判斷 ----------
let commT = 0;
function commTick(dt) {
  commT += dt; if (commT < 0.25) return; const step = commT; commT = 0;
  for (const v of vehicles) {
    if (v.handover > 0) { v.handover -= step; if (v.handover <= 0) { v.ap = v.nextAp; v.nextAp = null; roamCount++; } continue; }
    const dCur = v.ap && !v.ap.down ? apDist(v.ap, v) : Infinity;
    if (dCur <= ROAM_TH) { if (v.noComm) reconnect(v); continue; }
    const [b, bd] = bestAp(v);
    if (!b) { if (dCur <= AP_RANGE) continue; if (!v.noComm) lostComm(v); continue; }   // 收不到任何 AP
    if (v.noComm) { if (bd <= AP_RANGE - 1.5) { v.ap = b; reconnect(v); } continue; }   // 訊號要夠好才算恢復（避免在邊界一直斷斷續續）
    if (b !== v.ap && (dCur > AP_RANGE || bd < dCur - ROAM_GAIN)) {               // 漫遊：換到比較近的 AP
      if (v.ap && v.ap.down) { const a = alarms.find(x => x.target === v.ap); if (a) a.roamed = (a.roamed || 0) + 1; }
      v.nextAp = b; v.ap = null; v.handover = HANDOVER_TIME;
    }
  }
}
function lostComm(v) {
  v.noComm = true; v.ap = null; noCommMark(v, true);
  const a = alarms.find(x => x.type === 'ap'); if (a) a.lost = (a.lost || 0) + 1;
  log(`📶✕ ${v.id} 通訊中斷（附近沒有可用的 AP）${v.job ? '：手上的指令照做，但收不到新指令' : ''}`);
}
function reconnect(v) {
  v.noComm = false; noCommMark(v, false);
  const reps = v.carryReport || [];
  for (const job of reps) {                                    // 補回報：MCS 現在才知道 FOUP 放好了
    completed++; cycleSum += simTime - job.created; cycleByPri[job.pri][0] += simTime - job.created; cycleByPri[job.pri][1]++;
    job.foup.unreported = false;
  }
  log(`📶 ${v.id} 恢復通訊${reps.length ? `，補回報 ${reps.length} 筆完成的搬運` : ''}`);
  v.carryReport = []; v.unreported = 0;
}
// 開場：每台車連最近的 AP
vehicles.forEach(v => { v.ap = bestAp(v)[0]; });

// ---------- 每幀：畫面 ----------
function updateCommVisuals(t) {
  for (const a of aps) {
    a.ledMat.emissive.setHex(a.down ? 0xef4444 : 0x22c55e);
    a.ledMat.emissiveIntensity = a.down ? (Math.sin(t * 6) > 0 ? 1.8 : 0.1) : 1.2;
    a.ring.visible = showComm;
    if (a.down) { a.ringMat.color.setHex(0xef4444); a.ringMat.opacity = 0.6; } else { a.ringMat.color.copy(a.color); a.ringMat.opacity = 0.35; }
  }
  for (const [v, m] of noCommMarks) { if (!vehicles.includes(v)) { scene.remove(m); noCommMarks.delete(v); continue; } const p = v.group.position; m.position.set(p.x, p.y + 1.55, p.z); }
  commLines.visible = showComm;
  if (!showComm) return;
  const pos = commLines.geometry.attributes.position.array, col = commLines.geometry.attributes.color.array;
  let n = 0;
  for (const v of vehicles) {
    const a = v.ap; if (!a) continue;
    const p = v.group.position;
    pos.set([p.x, p.y + 0.05, p.z, a.x, 10.1, a.z], n * 6);
    col.set([a.color.r, a.color.g, a.color.b, a.color.r, a.color.g, a.color.b], n * 6); n++;
  }
  commLines.geometry.setDrawRange(0, n * 2);
  commLines.geometry.attributes.position.needsUpdate = commLines.geometry.attributes.color.needsUpdate = true;
}

// ---------- 異常：AP 斷線 ----------
function raiseApDown(ap, opts) {
  if (!ap) {
    // 挑一台有車連著的 AP（比較看得到影響）
    const cand = aps.filter(a => !a.down);
    const busy = cand.filter(a => vehicles.some(v => v.ap === a));
    ap = pick(busy.length ? busy : cand);
  }
  if (!ap) return null;
  const a = raiseAlarm('ap', pickInfo('ap'), ap, `${ap.id}（${ap.zone.name} 區天花板）`, opts);
  ap.down = a; a.roamed = 0; a.lost = 0;
  return a;
}
function apImpact(a) {
  const ap = a.target;
  const lost = vehicles.filter(v => v.noComm), unrep = lost.reduce((s, v) => s + (v.unreported || 0), 0);
  return [`漫遊到其他 AP 的天車：${a.roamed} 次`, `現在通訊中斷的天車：${lost.length} 台${lost.length ? `（${lost.map(v => v.id).join('、')}）` : ''}`,
    `做完了、還沒回報的搬運：${unrep} 筆`, `這台 AP 範圍內的天車都會先試著連隔壁的 AP；隔壁也收不到的角落才會斷線`];
}
