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
// 通訊方式：'ap' 固定 AP＋漫遊；'mesh' 天車自己組網狀網路（每台車都是一個節點，幫別台轉送，最後經過閘道器接回控制系統）
let COMM_MODE = 'ap';
const MESH_R = 18;          // 天車之間的無線距離
const GW_R = 12;            // 閘道器（接有線網路的節點）的範圍：比較小，大部分車要靠別台車轉送
const MESH_LOST_T = 3;     // 連續收不到這麼久才算斷線（車子開過網路比較稀的地方，短短一兩秒收不到不算）

// ---------- AP 擺放：每個區塊 3×2 台，掛在天花板 ----------
const aps = [];
let apMeshes = null;
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
  apMeshes = [b.build(vcMat({ roughness: 0.5 }))];
  const ledGeo = new THREE.BoxGeometry(0.12, 0.02, 0.04);
  for (const a of aps) {
    a.ledMat = mat(0x0a2a12, { emissive: 0x22c55e, emissiveIntensity: 1.2 });
    const led = new THREE.Mesh(ledGeo, a.ledMat); led.position.set(a.x, 10.31, a.z + 0.18); scene.add(led); a.led = led;
    const lb = makeLabel(a.id, { scale: 0.7, w: 170, bg: 'rgba(15,23,42,.8)', fg: '#a5f3fc' }); lb.position.set(a.x, 9.75, a.z); scene.add(lb); a.label = lb;
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
// Mesh 模式：所有「互相收得到」的天車之間畫淡淡的網（網狀網路長這樣）
const meshWeb = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3000 * 6), 3));
  const ln = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.28 }));
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
  if (COMM_MODE === 'mesh') return meshTick(step);
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
  benchLost++;
  v.noComm = true; v.ap = null; noCommMark(v, true);
  const a = alarms.find(x => x.type === 'ap'); if (a) a.lost = (a.lost || 0) + 1;
  v.lostAt = simTime; v.lostLogged = false;
  if (COMM_MODE !== 'mesh') { v.lostLogged = true; log(`📶✕ ${v.id} 通訊中斷（附近沒有可用的 AP）${v.job ? '：手上的指令照做，但收不到新指令' : ''}`); }
}
// Mesh：車子開過網路比較稀的地方常常斷幾秒又接上，太多了不一一寫紀錄；斷超過 15 秒才寫
const MESH_LOG_T = 15;
function reconnect(v) {
  v.noComm = false; noCommMark(v, false);
  const reps = v.carryReport || [];
  for (const job of reps) {                                    // 補回報：MCS 現在才知道 FOUP 放好了
    completed++; cycleSum += simTime - job.created; cycleByPri[job.pri][0] += simTime - job.created; cycleByPri[job.pri][1]++;
    job.foup.unreported = false;
  }
  if (v.lostLogged || reps.length) log(`📶 ${v.id} 恢復通訊${v.lostAt !== undefined ? `（斷了 ${Math.round(simTime - v.lostAt)} 秒）` : ''}${reps.length ? `，補回報 ${reps.length} 筆完成的搬運` : ''}`);
  v.carryReport = []; v.unreported = 0;
}
// 開場：每台車連最近的 AP
vehicles.forEach(v => { v.ap = bestAp(v)[0]; });

// ---------- Mesh 網狀網路 ----------
//   閘道器：每個區塊 2 台，接有線網路回控制系統。天車彼此在 MESH_R 內就能互傳，一跳一跳轉送到閘道器
const gws = [];
ZONES.forEach(z => [-18, 18].forEach(dx => gws.push({ id: `GW-${z.name}${gws.filter(g => g.zone === z).length + 1}`, zone: z, x: z.cx + dx, z: z.zc, down: null, mesh: true })));
gws.forEach((g, i) => { g.idx = i; g.color = new THREE.Color(0xf59e0b); });
{
  const b = makeBatch();
  for (const g of gws) {
    b.add(new THREE.BoxGeometry(0.5, 0.06, 0.5), 0x2f3740, null, g.x, 10.47, g.z);
    b.add(new THREE.BoxGeometry(0.46, 0.16, 0.46), 0xfbbf24, null, g.x, 10.33, g.z);                 // 閘道器本體（黃色）
    [[0.17, 0.17], [-0.17, 0.17], [0.17, -0.17], [-0.17, -0.17], [0, 0]].forEach(([ox, oz]) =>
      b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 6), 0x1f2937, null, g.x + ox, 10.08, g.z + oz));
  }
  const gm = b.build(vcMat({ roughness: 0.5 })); gm.visible = false; window.gwMesh = gm;
  for (const g of gws) {
    g.ledMat = mat(0x0a2a12, { emissive: 0x22c55e, emissiveIntensity: 1.2 });
    g.led = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.04), g.ledMat); g.led.position.set(g.x, 10.24, g.z + 0.24); g.led.visible = false; scene.add(g.led);
    g.label = makeLabel(g.id, { scale: 0.75, w: 180, bg: 'rgba(120,53,15,.85)', fg: '#fde68a' }); g.label.position.set(g.x, 9.65, g.z); g.label.visible = false; scene.add(g.label);
    g.ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
    g.ring = new THREE.Mesh(new THREE.RingGeometry(GW_R - 0.3, GW_R, 72), g.ringMat); g.ring.rotation.x = -Math.PI / 2; g.ring.position.set(g.x, 0.05, g.z); g.ring.visible = false; scene.add(g.ring);
  }
}
let meshStat = { ok: 0, avgHop: 0, maxHop: 0 };
function meshTick(step) {
  // 從每台閘道器開始做廣度優先搜尋（BFS）：一跳一跳找到每台車，記下要經過誰（parent）、幾跳（hops）
  const P = vehicles.map(vPos), n = vehicles.length, hop = new Array(n).fill(-1), par = new Array(n).fill(null), root = new Array(n).fill(null), q = [];
  for (const g of gws) if (!g.down) for (let i = 0; i < n; i++) {
    if (hop[i] === 1) continue;
    if (Math.hypot(P[i][0] - g.x, P[i][1] - g.z) <= GW_R) { hop[i] = 1; par[i] = g; root[i] = g; q.push(i); }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (let j = 0; j < n; j++) if (hop[j] < 0 && Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]) <= MESH_R) {
      hop[j] = hop[i] + 1; par[j] = vehicles[i]; root[j] = root[i]; q.push(j);
    }
  }
  let ok = 0, sum = 0, mx = 0;
  vehicles.forEach((v, i) => {
    v.meshHops = hop[i]; v.meshParent = par[i];
    if (hop[i] > 0) {
      ok++; sum += hop[i]; mx = Math.max(mx, hop[i]);
      if (v.ap !== root[i] && v.ap && v.ap.down) { const a = alarms.find(x => x.target === v.ap); if (a) a.roamed = (a.roamed || 0) + 1; }
      v.ap = root[i]; v.lostT = 0; if (v.noComm) reconnect(v);
    } else {
      v.lostT = (v.lostT || 0) + step;
      if (!v.noComm && v.lostT >= MESH_LOST_T) lostComm(v);
      if (v.noComm && !v.lostLogged && simTime - v.lostAt >= MESH_LOG_T) { v.lostLogged = true; log(`📶✕ ${v.id} Mesh 連不到任何閘道器，已經 ${MESH_LOG_T} 秒${v.job ? '：手上的指令照做，但收不到新指令' : ''}`); }
    }
  });
  meshStat = { ok, avgHop: ok ? sum / ok : 0, maxHop: mx };
}
function setCommMode(m) {
  if (m === COMM_MODE) return;
  for (const a of alarms.slice()) if (a.type === 'ap') clearAlarm(a);   // 換通訊方式：原本的 AP／閘道器異常先復歸
  COMM_MODE = m;
  vehicles.forEach(v => { v.ap = null; v.handover = 0; v.nextAp = null; v.lostT = 0; v.meshHops = -1; });
  if (m === 'ap') vehicles.forEach(v => { const [b] = bestAp(v); if (b) { v.ap = b; if (v.noComm) reconnect(v); } });
  else meshTick(0);
  log(m === 'mesh' ? '📡 通訊方式切換：天車 Mesh 網狀網路（天車互相轉送，經閘道器接回控制系統）' : '📶 通訊方式切換：固定 AP＋漫遊');
}

// ---------- 每幀：畫面 ----------
const HOP_COL = [0x22c55e, 0x22c55e, 0x84cc16, 0xeab308, 0xf97316, 0xef4444].map(c => new THREE.Color(c));
function updateCommVisuals(t) {
  const mesh = COMM_MODE === 'mesh';
  if (window.gwMesh) window.gwMesh.visible = mesh;
  for (const g of gws) {
    g.led.visible = mesh; g.label.visible = mesh && showLabels; g.ring.visible = mesh && showComm;
    g.ledMat.emissive.setHex(g.down ? 0xef4444 : 0x22c55e); g.ledMat.emissiveIntensity = g.down ? (Math.sin(t * 6) > 0 ? 1.8 : 0.1) : 1.2;
    g.ringMat.color.setHex(g.down ? 0xef4444 : 0xf59e0b);
  }
  if (apMeshes) apMeshes.forEach(m => m.visible = !mesh);
  for (const a of aps) {
    a.ledMat.emissive.setHex(a.down ? 0xef4444 : 0x22c55e);
    a.ledMat.emissiveIntensity = a.down ? (Math.sin(t * 6) > 0 ? 1.8 : 0.1) : 1.2;
    a.ring.visible = showComm && !mesh; a.led.visible = !mesh; a.label.visible = !mesh && showLabels;
    if (a.down) { a.ringMat.color.setHex(0xef4444); a.ringMat.opacity = 0.6; } else { a.ringMat.color.copy(a.color); a.ringMat.opacity = 0.35; }
  }
  for (const [v, m] of noCommMarks) { if (!vehicles.includes(v)) { scene.remove(m); noCommMarks.delete(v); continue; } const p = v.group.position; m.position.set(p.x, p.y + 1.55, p.z); }
  commLines.visible = showComm; meshWeb.visible = showComm && mesh;
  if (!showComm) return;
  if (mesh) {                                                          // 網狀的淡線：每一對收得到的天車
    const wp = meshWeb.geometry.attributes.position.array; let m = 0;
    for (let i = 0; i < vehicles.length && m < 3000; i++) for (let j = i + 1; j < vehicles.length && m < 3000; j++) {
      const a = vehicles[i].group.position, b = vehicles[j].group.position;
      if (Math.hypot(a.x - b.x, a.z - b.z) <= MESH_R) { wp.set([a.x, a.y - 0.9, a.z, b.x, b.y - 0.9, b.z], m * 6); m++; }
    }
    meshWeb.geometry.setDrawRange(0, m * 2); meshWeb.geometry.attributes.position.needsUpdate = true;
  }
  const pos = commLines.geometry.attributes.position.array, col = commLines.geometry.attributes.color.array;
  let n = 0;
  for (const v of vehicles) {
    const p = v.group.position;
    if (mesh) {                                                        // Mesh：畫每台車往閘道器方向的下一跳，顏色＝第幾跳
      const pr = v.meshParent; if (!pr || v.meshHops < 1) continue;
      const tp = pr.mesh ? [pr.x, 10.1, pr.z] : [pr.group.position.x, pr.group.position.y - 0.9, pr.group.position.z];
      const c = HOP_COL[Math.min(v.meshHops, HOP_COL.length - 1)];
      pos.set([p.x, p.y - 0.9, p.z, ...tp], n * 6); col.set([c.r, c.g, c.b, c.r, c.g, c.b], n * 6); n++;
      continue;
    }
    const a = v.ap; if (!a) continue;
    pos.set([p.x, p.y + 0.05, p.z, a.x, 10.1, a.z], n * 6);
    col.set([a.color.r, a.color.g, a.color.b, a.color.r, a.color.g, a.color.b], n * 6); n++;
  }
  commLines.geometry.setDrawRange(0, n * 2);
  commLines.geometry.attributes.position.needsUpdate = commLines.geometry.attributes.color.needsUpdate = true;
}

// ---------- 異常：AP 斷線 ----------
function raiseApDown(ap, opts) {
  if (!ap) {
    // 挑一台有車連著的 AP（比較看得到影響）；Mesh 模式挑閘道器
    const cand = (COMM_MODE === 'mesh' ? gws : aps).filter(a => !a.down);
    const busy = cand.filter(a => vehicles.some(v => v.ap === a));
    ap = pickA(busy.length ? busy : cand);
  }
  if (!ap) return null;
  const a = raiseAlarm('ap', ap.mesh ? GW_INFO : pickInfo('ap'), ap, `${ap.id}（${ap.zone.name} 區天花板）`, opts);
  ap.down = a; a.roamed = 0; a.lost = 0;
  return a;
}
const GW_INFO = { code: 'N-503', title: 'Mesh 閘道器斷線',
  what: '一台 Mesh 閘道器（天車網狀網路接回控制系統的出口）斷線了。',
  impact: '原本經過它的天車會自動改走別條路：透過旁邊的天車一跳一跳轉送到其他閘道器（自我修復）。附近天車夠多就幾乎沒影響；車子少、離其他閘道器又遠的地方，天車會連不上而通訊中斷。',
  steps: ['在監控畫面看哪些車改走其他閘道器、哪些車斷線', '通知 IT 檢查閘道器的網路和電源', '修好後確認天車重新經過這台閘道器連線'] };
function apImpact(a) {
  if (a.target.mesh) {
    const lost = vehicles.filter(v => v.noComm);
    return [`改走其他閘道器的天車：${a.roamed} 次`, `現在通訊中斷的天車：${lost.length} 台${lost.length ? `（${lost.map(v => v.id).join('、')}）` : ''}`,
      `Mesh 平均 ${meshStat.avgHop.toFixed(1)} 跳、最多 ${meshStat.maxHop} 跳`, '天車越密，可以轉送的路越多；空車休息在軌道上也能幫忙轉送'];
  }
  const ap = a.target;
  const lost = vehicles.filter(v => v.noComm), unrep = lost.reduce((s, v) => s + (v.unreported || 0), 0);
  return [`漫遊到其他 AP 的天車：${a.roamed} 次`, `現在通訊中斷的天車：${lost.length} 台${lost.length ? `（${lost.map(v => v.id).join('、')}）` : ''}`,
    `做完了、還沒回報的搬運：${unrep} 筆`, `這台 AP 範圍內的天車都會先試著連隔壁的 AP；隔壁也收不到的角落才會斷線`];
}
