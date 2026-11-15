// factory.js — 製程機台、Load Port、STB 儲格（沿軌道網路擺放；這個廠沒有 Stocker）
//
// 每條 Bay 有「進去」和「出來」兩條車道：
//   ・車道外側：機台（每台 2 個 Load Port，就在軌道正下方）
//   ・車道內側（兩條車道之間）：一整排 STB 儲格（吊在天花板，天車要側移才拿得到）
// 主幹線環內兩側也排一整排 STB 儲格
//
// 效能：機台本體、Load Port、STB 架子這些不會動的東西，全部合併成少數幾個網格；
//       指示燈合併成 InstancedMesh（見 scene.js 的 makeBatch / makeLedBank）

const staticBatch = makeBatch();                  // 機台本體、Load Port、STB 架子
const screenBatch = makeBatch();                  // 機台螢幕（會發光）
const portLeds = makeLedBank(new THREE.BoxGeometry(0.6, 0.08, 0.05));
const stbLeds = makeLedBank(new THREE.BoxGeometry(0.5, 0.05, 0.03));
const lcLeds = makeLedBank(new THREE.BoxGeometry(0.014, 0.66, 0.022));   // 光閘柱上的指示燈條：綠＝正常、紅＝被遮斷
let pendingLc = null;
const G = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  pin: new THREE.CylinderGeometry(0.03, 0.04, 0.05, 8),
  lcPost: new THREE.BoxGeometry(0.035, 0.8, 0.035), lcCap: new THREE.BoxGeometry(0.05, 0.05, 0.05),   // 光閘（Light Curtain）柱
  rod: new THREE.CylinderGeometry(0.025, 0.025, 10.5 - STB_TOP, 6),
  lamp: new THREE.CylinderGeometry(0.14, 0.14, 0.22, 12),
};
G.machine = G.box(4.4, 3.0, 2.6); G.front = G.box(3.6, 1.6, 0.05); G.screen = G.box(0.9, 0.55, 0.06);
G.portBase = G.box(0.95, 1.0, 0.95); G.portPlate = G.box(0.82, 0.04, 0.82);
G.stbShelf = G.box(2.3, 0.05, 0.95);                                       // 儲格底板
G.stbRailL = G.box(2.36, 0.06, 0.06); G.stbRailW = G.box(0.06, 0.06, 1.01);    // 底板四周的框（角鋼）
G.stbFenceL = G.box(2.3, 0.025, 0.025); G.stbFenceW = G.box(0.025, 0.025, 0.95); G.stbPost = G.box(0.03, 0.14, 0.03);   // 低矮護欄
G.stbDivider = G.box(0.03, 0.05, 0.95); G.stbTopPlate = G.box(0.14, 0.03, 0.14);   // 兩格之間的隔條、天花板吊座

// FOUP 擺在 Port 上時的轉角：門朝向 side 那一側（side = +1 天車左手邊、-1 右手邊）
// 天車取放貨不會轉 FOUP，所以所有 Port／STB 上的 FOUP 門都朝天車右手邊（機台都在車道右側）
const facing = (f, side) => Math.atan2(-side * f.tx, -side * f.tz);
// 建一個 Port 物件（位置在軌道 seg 的 d 處，側向偏移 lat）
function addPort(seg, d, lat, top, owner, name, doorSide, ledMat) {
  const f = frameAt(seg, d);
  const p = { id: ports.length, name, seg, d, lat, top, owner, foup: null, reserved: false, ledMat,
    x: f.x + lat * f.nx, z: f.z + lat * f.nz, rot: facing(f, doorSide) };
  if (owner.type === 'machine' || owner.type === 'ntb') { p.lcLeds = pendingLc; pendingLc = null; }
  ports.push(p); owner.ports.push(p); return p;
}
const LC_Z = 0.46;                                   // 光閘在 Load Port 靠走道那一側（區域座標 z）
// Load Port 外觀（群組 g 的區域座標，x 沿軌道、z 側向）
function portMesh(g, lx, ledSide) {
  staticBatch.add(G.portBase, 0x7d8894, g, lx, 0.5, 0);
  staticBatch.add(G.portPlate, 0x2a3138, g, lx, 1.0, 0);
  [[0.25, 0], [-0.15, 0.22], [-0.15, -0.22]].forEach(([px, pz]) => staticBatch.add(G.pin, 0xc9ced4, g, lx + px, 1.04, pz));
  // 光閘：Load Port 靠走道那一側的兩根柱子（發射器／接收器），中間有看不見的光束；有東西擋到就會讓 E84 的 HO_AVBL 掉下來
  pendingLc = [-1, 1].map(k => {
    staticBatch.add(G.lcPost, 0x2b3036, g, lx + k * 0.42, 1.45, LC_Z); staticBatch.add(G.lcCap, 0xf59e0b, g, lx + k * 0.42, 1.87, LC_Z);
    return lcLeds.add(g, lx + k * 0.42, 1.45, LC_Z + 0.022);                  // 燈條貼在柱子朝走道那一面
  });
  return portLeds.add(g, lx, 0.82, ledSide * 0.49);
}
// 在軌道 seg 的 d 處建一個群組，區域座標：x 沿行進方向、z 為天車左手邊
function groupAt(seg, d) {
  const f = frameAt(seg, d), g = new THREE.Group();
  g.position.set(f.x, 0, f.z); g.rotation.y = f.th; scene.add(g); return g;
}

// ---------- 製程機台（在車道外側，side = -1）----------
const lampBank = makeLedBank(G.lamp);              // 所有機台的三色燈合在一起畫
const machineLabels = [];                          // 機台名牌（只在鏡頭附近顯示）
function makeMachine(seg, dc, name) {
  const side = -1, m = { type: 'machine', name, ports: [], lights: [] };
  const g = groupAt(seg, dc), zc = side * 1.95;
  { const f = frameAt(seg, dc); m.x = f.x + zc * f.nx; m.z = f.z + zc * f.nz; m.seg = seg; }
  staticBatch.add(G.machine, 0xd3d9df, g, 0, 1.5, zc);
  staticBatch.add(G.front, 0x23303c, g, 0, 1.9, side * 0.63);
  screenBatch.add(G.screen, 0x1d6fa5, g, 1.6, 2.4, side * 0.6);
  ['#ef4444', '#f59e0b', '#22c55e'].forEach((c, i) => {                 // 三色燈：紅、黃、綠
    const led = lampBank.add(g, -1.8, 3.15 + (2 - i) * 0.23, zc + side * 0.9);
    led.emissive.set(c); led.emissiveIntensity = 0.05; m.lights.push(led);
  });
  const lb = makeLabel(name, { scale: 0.8 }); lb.position.set(0, 3.9, zc); g.add(lb); labels.push(lb);
  g.updateMatrixWorld(true); lb.userData.wp = lb.getWorldPosition(new THREE.Vector3()); machineLabels.push(lb);
  [-0.95, 0.95].forEach((lx, i) => addPort(seg, dc + lx, 0, PORT_TOP, m, `${name}-P${i + 1}`, side, portMesh(g, lx, -side)));
  machines.push(m);
}

// ---------- NTB：地面人員投取貨站，一區一站、每站兩個 Port ----------
const ntbs = [], ntbZones = new Set();
function makeNtb(seg, dc, zone) {
  const stationNo = ntbs.length + 1, name = `NTB${String(stationNo).padStart(2,'0')}`, owner = {type:'ntb', name, ports:[], zone}, g = groupAt(seg, dc);
  owner.x = g.position.x; owner.z = g.position.z;
  // NTB 直接安裝於原地板；無獨立操作台、無黃色地板或大型背板。
  [-.95,.95].forEach((lx,i) => {
    const moduleId = `M${String((stationNo-1)*2+i+1).padStart(2,'0')}`;
    const p = addPort(seg, dc+lx, 0, PORT_TOP, owner, `${name}-${moduleId}`, -1, portMesh(g,lx,1));
    p.moduleId = moduleId; p.ntbDirection = i === 0 ? 'in' : 'out';
    const tag = makeLabel(`${moduleId} ${i === 0 ? '投貨' : '取貨'}`, {scale:.55}); tag.position.set(lx,2.05,.5); g.add(tag); labels.push(tag);
  });
  const lb = makeLabel(name + ' 投取貨站', {scale:1.0}); lb.position.set(0,2.65,-1.1); g.add(lb); labels.push(lb);
  // 壓克力罩由 NTB 台面與光閘柱延伸；頂部保留天車吊掛通道。
  const acrylic = new THREE.MeshStandardMaterial({color:0xbceafa, transparent:true, opacity:.22, roughness:.18, metalness:0, depthWrite:false, side:THREE.DoubleSide});
  const metal = mat(0xa8b4bf, {metalness:.6, roughness:.35});
  const piece = (w,h,d,x,y,z,material=metal,parent=g) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material); mesh.position.set(x,y,z); parent.add(mesh); return mesh; };
  owner.ports.forEach((p,i) => {
    const lx = i ? .95 : -.95;
    [-.42,.42].forEach(x => { piece(.025,.8,.92,lx+x,1.45,0,acrylic); piece(.035,.82,.035,lx+x,1.45,-LC_Z); piece(.035,.035,.94,lx+x,1.87,0); });
    piece(.84,.8,.025,lx,1.45,-LC_Z,acrylic);
    piece(.86,.035,.035,lx,1.87,-LC_Z);
    // 氣缸在台體內，窗片向下收入 NTB，並由台體前板遮住。
    piece(.91,.98,.055,lx,.51,LC_Z+.06,mat(0x8996a3));
    piece(.06,.65,.06,lx+.37,.52,LC_Z-.05);
    const door = new THREE.Group(); door.position.set(lx,0,LC_Z); g.add(door);
    piece(.79,.78,.025,0,1.45,0,acrylic,door);
    piece(.81,.035,.04,0,1.84,0,metal,door);
    p.gate = 0; p.gateAccess = false; p.gateMesh = door;
  });
  // 鐵架：兩層、每層兩格，放在投取貨站外側的人員區。
  owner.rack = [];
  [-1.45,1.45].forEach(x => [-3.85,-2.95].forEach(z => piece(.06,2.55,.06,x,1.275,z)));
  [.65,1.65,2.55].forEach(y => piece(3,.06,1.0,0,y,-3.4));
  const frame = frameAt(seg,dc);
  [.68,1.68].forEach(top => [-.76,.76].forEach(x => {
    owner.rack.push({name:`${name}-R${owner.rack.length+1}`, top, x:frame.x+x*frame.tx-3.4*frame.nx, z:frame.z+x*frame.tz-3.4*frame.nz, rot:owner.ports[0].rot, foup:null});
  }));
  const rackLabel = makeLabel(name + ' FOUP 鐵架', {scale:.8}); rackLabel.position.set(0,2.95,-3.4);g.add(rackLabel);labels.push(rackLabel);
  ntbs.push(owner);
}

// ---------- STB 儲格（吊在天花板、軌道內側，天車要側移 STB_OFFSET 才拿得到）----------
// 一組架子 2 個儲格
const stbs = [];
function makeStb(seg, dc, name) {
  // 一組兩格的儲格架：四個角各一支吊桿吊在天花板上（四點吊掛），底板四周有框、遠側和兩端有低矮護欄
  //   天車從正上方把 FOUP 放下來，所以靠軌道那一側不做護欄
  const owner = { type: 'stb', name, ports: [] }, g = groupAt(seg, dc), z = STB_OFFSET, hw = 0.475, hl = 1.15, y = STB_TOP;
  const MET = 0x8d979f, FR = 0x6f7880, ROD = 0xb3bcc4;
  staticBatch.add(G.stbShelf, MET, g, 0, y - 0.025, z);
  [-1, 1].forEach(k => staticBatch.add(G.stbRailL, FR, g, 0, y - 0.03, z + k * hw));
  [-1, 1].forEach(k => staticBatch.add(G.stbRailW, FR, g, k * hl, y - 0.03, z));
  staticBatch.add(G.stbDivider, FR, g, 0, y + 0.02, z);
  staticBatch.add(G.stbFenceL, FR, g, 0, y + 0.13, z + hw);                    // 遠側護欄
  [-1, 1].forEach(k => staticBatch.add(G.stbFenceW, FR, g, k * hl, y + 0.13, z));   // 兩端護欄
  [[-1, 1], [1, 1], [-1, 0], [1, 0]].forEach(([a, b]) => staticBatch.add(G.stbPost, FR, g, a * hl, y + 0.07, z + b * hw));   // 護欄立柱
  // 四支吊桿＋天花板吊座
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([a, b]) => {
    staticBatch.add(G.rod, ROD, g, a * hl, (10.5 + y) / 2, z + b * hw);
    staticBatch.add(G.stbTopPlate, FR, g, a * hl, 10.48, z + b * hw);
  });
  // 每一格：FOUP 定位用的三支 pin（跟 Load Port 一樣）＋靠軌道那一側的狀態燈
  [-0.55, 0.55].forEach((lx, i) => {
    [[0.25, 0], [-0.15, 0.22], [-0.15, -0.22]].forEach(([px, pz]) => staticBatch.add(G.pin, 0xc9ced4, g, lx + px, y + 0.02, z + pz));
    addPort(seg, dc + lx, STB_OFFSET, STB_TOP, owner, `${name}-${i + 1}`, -1, stbLeds.add(g, lx, y - 0.03, z - hw - 0.02));
  });
  stbs.push(owner);
  scene.remove(g);                                                          // STB 群組只用來算位置，不需要留在場景
}
// 在一段軌道的 [d0, d1] 範圍內，每 STB_PITCH 公尺排一組 STB（置中排列）
const STB_PITCH = 2.6;
const STB_CLEAR = 0.6 + 0.5;   // 儲格中心到架子邊緣 0.6，再留 0.5 公尺：整組架子都要在直線段上，彎道不放儲格
// seg 上 d 附近 ±r 公尺內都是直線（沒有彎道）
const straightAround = (seg, d, r) => { for (let t = -r; t <= r; t += 0.1) { const x = d + t; if (x < 0 || x > seg.len || seg.curveAt(x)) return false; } return true; };
function stbRow(seg, d0, d1, prefix, maxN = 99) {
  const span = d1 - d0 - 1.1; if (span < 0) return 0;                   // 1.1 ＝ 一組兩個儲格中心的距離
  const n = Math.min(maxN, Math.floor(span / STB_PITCH) + 1), start = (d0 + d1) / 2 - (n - 1) * STB_PITCH / 2;
  for (let i = 0; i < n; i++) makeStb(seg, start + i * STB_PITCH, `${prefix}${i + 1}`);
  return n;
}

// ---------- 依 Bay 擺放：車道外側機台、內側一整排 STB ----------
const PROCESS = ['LITHO', 'ETCH', 'CVD', 'DIFF', 'CMP', 'WET', 'PVD', 'IMP', 'METRO', 'CLEAN', 'ASH', 'EPI', 'RTP', 'ALD', 'INSP'];
const BAY_PROCESS = Object.fromEntries(bays.map((b, i) => [b.name, PROCESS[i % PROCESS.length]]));
bays.forEach(b => {
  if (b.maint) return;                                                    // 車輛維修區：不放機台、儲格（maintenance.js）
  const qa = Math.PI / 2 * BAY_R, laneLen = b.len - (MAIN_R + BAY_R), uLen = Math.PI * BAY_W;
  const laneStarts = [qa, qa + laneLen + uLen];                           // 兩條車道在 Bay 軌道上的起點
  let k = 0;
  laneStarts.forEach((d0, li) => {
    [2.6, 7.6, 12.6, 17.6, 22.6].forEach(off => { if (off + 2.5 < laneLen) { const zone = b.zone.name; if (!ntbZones.has(zone)) { ntbZones.add(zone); makeNtb(b.seg, d0 + off, zone); } else makeMachine(b.seg, d0 + off, `${BAY_PROCESS[b.name]}-${b.name}${++k}`); } });
    stbRow(b.seg, d0 + STB_CLEAR, d0 + laneLen - STB_CLEAR, `STB-${b.name}${li ? 'R' : 'L'}`);
  });
});
// ---------- 主幹線環內側也排一整排 STB（只放在直線段，兩端彎道不放）----------
mainSegs.forEach((sg, i) => {
  // 一段主幹線裡可能夾著彎道（前後都是直線），所以要把每一段「連續可放」的直線分開排
  let d0 = null, d1 = null, run = 0;
  const flush = () => { if (d0 !== null) stbRow(sg, d0, d1, `STB-M${i + 1}${String.fromCharCode(97 + run++)}-`); d0 = null; };
  for (let d = 0; d <= sg.len; d += 0.1) {
    const [x, z] = sg.at(d);
    const nearCross = crosses.some(c => Math.abs(z - c.zc) < 4 && x > c.x - 2.5 - STB_CLEAR && x < c.x + 4.5 + STB_CLEAR);   // 捷徑 U 彎在環內，儲格要讓開
    const ok = d >= 1.2 && d <= sg.len - 1.2 && straightAround(sg, d, STB_CLEAR) && !nearCross;
    if (ok) { if (d0 === null) d0 = d; d1 = d; } else flush();
  }
  flush();
});

// ---------- 把合併好的靜態物件放進場景 ----------
staticBatch.build(vcMat({ metalness: 0.3, roughness: 0.55 }));
screenBatch.build(vcMat({ color: 0x0b1a26, emissive: 0x1d6fa5, emissiveIntensity: 0.6 }), false);
portLeds.build(); stbLeds.build(); lampBank.build(); lcLeds.build();
