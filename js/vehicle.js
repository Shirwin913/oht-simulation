// vehicle.js — OHT 天車模型（白色車體、LED 燈條、吊升機構）與位置更新

// ================== 天車 ==================
const pickables = [];
// 參考實車外觀：白色高車體、前後端板上寬下窄、車頂綠色 LED 燈條、側面露出內部機構
const WHEEL_R = 0.065;
const END_X = 0.8;       // 前後端外殼中心位置（車體半長 = END_X + END_T/2）
const END_T = 0.4;       // 前後端外殼頂部厚度（防墜板收起時藏在外殼底部）
const BODY_W = 1.0;      // 車寬
const END_CHAMFER = 0.25; // 俯視時外殼外側兩角切掉的斜邊大小（外側面寬 = 車寬 − 2 × 這個值）
const faceX = y => END_X + END_T / 2;   // 外殼外側面位置
const VISOR_OUT = 0.12;  // 頂部防撞板往前後凸出多少
const VISOR_H = 0.055;   // 頂部防撞板厚度（薄板）
const VISOR_TOP = -0.16; // 頂部防撞板頂面（車子最頂部）
const BODY_TOP = -0.24, BODY_BOT = -1.66;
const VPIO = { y: BODY_TOP - 0.1, z: -0.58 };   // 天車端 E84 PIO 收發窗（車頂、靠機台那一側，在車身外側一點點）
const BOX_H = 0.33, BOX_Y = -0.535;   // 捲揚盒高度與中心（盒底 -0.70，吊帶從盒底出來）
const BELT_XY = 0.22;   // 吊帶離中心的距離（前後、左右）
// 三條吊帶（[前後, 左右]）：一側兩條（前後各一）、另一側一條（置中），三點吊掛比較穩、不會晃
const BELT_POS = [[1, 1], [-1, 1], [0, -1]];
const GUARD_L = 0.38;    // 防墜板長度（從外殼內側伸到 FOUP 底下約 0.1）
const GUARD_W = 0.18;    // 防墜板寬度
const GUARD_Z = 0.3;     // 防墜板轉軸的左右位置（靠近 FOUP 兩側邊緣）
function idPlateMat(id, accent) {                 // 車號牌：白底黑字＋車色條
  const c = document.createElement('canvas'); c.width = 192; c.height = 108;
  const x = c.getContext('2d');
  x.fillStyle = '#f3f4f2'; x.fillRect(0, 0, 192, 108);
  x.fillStyle = '#111'; x.font = 'bold 64px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(id.replace('V', '0'), 96, 48);
  x.fillStyle = accent; x.fillRect(16, 88, 160, 12);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true });
}
const VG = (() => {
  // 前後端外殼：從上往下看，外側兩個角切成斜邊；前後兩個外殼合起來，整台車俯視是長八邊形
  //   （兩條比較長的對稱邊＝車子左右兩側）。+x 為外側
  const B = 0.02;                                                        // 小倒角
  const t = END_T / 2 - B, w = BODY_W / 2 - B, ch = END_CHAMFER;
  const sh = new THREE.Shape();
  sh.moveTo(-t, -w); sh.lineTo(t - ch, -w); sh.lineTo(t, -w + ch);        // 側邊 → 斜邊
  sh.lineTo(t, w - ch); sh.lineTo(t - ch, w); sh.lineTo(-t, w);           // 外側面 → 斜邊 → 側邊
  sh.closePath();                                                        // 內側面（直的，留給 FOUP）
  const endPanel = new THREE.ExtrudeGeometry(sh, { depth: BODY_TOP - BODY_BOT - 2 * B, bevelEnabled: true, bevelThickness: B, bevelSize: B, bevelSegments: 2 });
  endPanel.rotateX(-Math.PI / 2); endPanel.translate(0, BODY_BOT + B, 0);
  // 整台車俯視的長八邊形輪廓（前後往外擴 gx、左右往外擴 gz）
  const octagon = (gx, gz = gx, path = new THREE.Shape()) => {
    const hx = END_X + END_T / 2 + gx, hw = BODY_W / 2 + gz, cc = END_CHAMFER + (gx + gz) / 2 * 0.414;
    path.moveTo(-hx + cc, -hw); path.lineTo(hx - cc, -hw); path.lineTo(hx, -hw + cc); path.lineTo(hx, hw - cc);
    path.lineTo(hx - cc, hw); path.lineTo(-hx + cc, hw); path.lineTo(-hx, hw - cc); path.lineTo(-hx, -hw + cc); path.closePath();
    return path;
  };
  // 車頂蓋
  const capGeo = new THREE.ExtrudeGeometry(octagon(0.01), { depth: 0.07, bevelEnabled: false });
  capGeo.rotateX(-Math.PI / 2); capGeo.translate(0, -0.235, 0);
  // 頂部防撞板（像遮陽板一樣往前凸出的薄板）：只在車頭、車尾，沿外側面和兩個斜角往外凸出；
  //   板子下緣內嵌綠色 LED 燈條。形狀用「機殼外緣往外偏移 dIn ~ dOut 的一圈帶狀」做，以外殼中心為原點、+x 朝外
  const ht = END_T / 2, hw2 = BODY_W / 2, hc = END_CHAMFER, k8 = 0.414, n = 0.7071;
  const band = (dIn, dOut) => {
    const P = d => [[ht - hc + d * n, -hw2 - d * n], [ht + d, -hw2 + hc - d * k8], [ht + d, hw2 - hc + d * k8], [ht - hc + d * n, hw2 + d * n]];
    const a = P(dIn), b = P(dOut).reverse(), sh = new THREE.Shape();
    [...a, ...b].forEach(([x, z], i) => i ? sh.lineTo(x, z) : sh.moveTo(x, z)); sh.closePath(); return sh;
  };
  const visorGeo = new THREE.ExtrudeGeometry(band(-0.06, VISOR_OUT - 0.012), { depth: VISOR_H - 0.024, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3 });
  visorGeo.rotateX(-Math.PI / 2); visorGeo.translate(0, VISOR_TOP - VISOR_H + 0.012, 0);
  const visorLedGeo = new THREE.ExtrudeGeometry(band(VISOR_OUT - 0.055, VISOR_OUT - 0.02), { depth: 0.018, bevelEnabled: false });
  visorLedGeo.rotateX(-Math.PI / 2); visorLedGeo.translate(0, VISOR_TOP - VISOR_H - 0.016, 0);
  // 防墜板（盟立樣式）：淺灰金屬板，上面有維修蓋板的框線和固定螺絲
  const gc = document.createElement('canvas'); gc.width = 128; gc.height = 64;
  const gx = gc.getContext('2d');
  gx.fillStyle = '#d9dde1'; gx.fillRect(0, 0, 128, 64);
  gx.strokeStyle = '#9aa1a8'; gx.lineWidth = 2; gx.strokeRect(3, 3, 122, 58);          // 板邊
  gx.strokeStyle = '#8a9198'; gx.strokeRect(30, 16, 68, 32);                          // 維修蓋板框線
  gx.fillStyle = '#7d848b'; [[8, 8], [120, 8], [8, 56], [120, 56], [34, 20], [94, 20], [34, 44], [94, 44]].forEach(([a, b]) => { gx.beginPath(); gx.arc(a, b, 2, 0, 7); gx.fill(); });
  const guardTex = new THREE.CanvasTexture(gc);
  const guardGeo = new THREE.BoxGeometry(GUARD_L, 0.02, GUARD_W);
  // ---------- 外殼花紋（照使用者模型外殼上的花紋）：斜向散熱槽一整片＋下面一排圓孔＋上方維修蓋板框 ----------
  //   貼在前後外殼四個斜角面上；外殼最底下一圈深色護邊
  const pc = document.createElement('canvas'); pc.width = 256; pc.height = 320;
  const px = pc.getContext('2d');
  px.strokeStyle = 'rgba(120,126,132,.85)'; px.lineWidth = 3; px.strokeRect(30, 14, 196, 70);            // 維修蓋板框
  [[44, 28], [212, 28], [44, 70], [212, 70]].forEach(([x, y]) => { px.fillStyle = '#9aa1a8'; px.beginPath(); px.arc(x, y, 4, 0, 7); px.fill(); });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {                                            // 斜向散熱槽
    const x0 = 34 + c * 34 + r * 6, y0 = 110 + r * 34;
    px.save(); px.translate(x0, y0); px.rotate(-Math.PI / 4);
    px.fillStyle = '#4f5459'; px.fillRect(-15, -4, 30, 8);
    px.fillStyle = 'rgba(255,255,255,.75)'; px.fillRect(-15, 4, 30, 2);                                // 槽下緣的亮邊（看起來有深度）
    px.restore();
  }
  for (let c = 0; c < 7; c++) { const x = 40 + c * 30; px.fillStyle = '#4f5459'; px.beginPath(); px.arc(x, 270, 6, 0, 7); px.fill();
    px.fillStyle = 'rgba(255,255,255,.7)'; px.beginPath(); px.arc(x, 273, 6, 0.2, Math.PI - 0.2); px.lineWidth = 1.5; px.strokeStyle = 'rgba(255,255,255,.7)'; px.stroke(); }
  const patTex = new THREE.CanvasTexture(pc); patTex.anisotropy = 4;
  const patMat = new THREE.MeshStandardMaterial({ map: patTex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  const patGeo = new THREE.PlaneGeometry(0.3, 0.375);
  // 底部深色護邊（外殼形狀往外擴一點的薄片）
  const trimGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.055, bevelEnabled: true, bevelThickness: 0.004, bevelSize: B + 0.008, bevelSegments: 1 });
  trimGeo.rotateX(-Math.PI / 2); trimGeo.translate(0, BODY_BOT + 0.004, 0);
  return {
    patMat, patGeo, trimGeo, trimMat: mat(0x26282d, { roughness: 0.7 }),
    endPanel, capGeo, visorGeo, visorLedGeo, visorMat: mat(0xdfe3e6, { roughness: 0.45, metalness: 0.15 }), guardGeo,
    guardMat: new THREE.MeshStandardMaterial({ map: guardTex, metalness: 0.35, roughness: 0.5 }),
    white: mat(0xf3f4f2, { roughness: 0.45 }), offWhite: mat(0xe3e6e6, { roughness: 0.5 }),
    black: mat(0x15181b, { roughness: 0.6 }), gray: mat(0x8f979e, { metalness: 0.5 }),
    orange: mat(0xff6a1a, { emissive: 0x7a2200, emissiveIntensity: 0.5 }), red: mat(0x2a0505, { emissive: 0xff2a2a, emissiveIntensity: 0.6 }),
    belt: mat(0x1d2329), motor: mat(0xd0d4d8, { metalness: 0.5, roughness: 0.4 }),
    tire: mat(0x2a2c2e, { roughness: 0.9 }), hub: mat(0xb7bec5, { metalness: 0.7 }),
  };
})();
// ---------- 天車外形：使用者和同事做的 3D 模型（js/vehicle_model.js，由 OHT.glb 轉出）----------
//   body：車體（前後外殼、頂蓋）；shift：側移＋捲揚單元（跟著側移動）；grip：夾爪（跟著捲揚上下，原點在夾爪底面）
//   near 近看用、far 遠看用（簡化）。每個三角形一個顏色，用頂點色畫，所以一個部件只要一次 draw call
const MODEL = (() => {
  const b64 = str => { const bin = atob(str), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const geo = e => {
    const q = new Int16Array(b64(e.p)), c = new Uint8Array(b64(e.c));
    const pos = new Float32Array(q.length), col = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) pos[i] = q[i] / 10000;
    for (let t = 0; t < e.n; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) col[t * 9 + v * 3 + k] = c[t * 3 + k] / 255;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals(); return g;
  };
  const M = OHT_MODEL.meta, out = { meta: M, near: {}, far: {} };
  for (const k of ['body', 'shift', 'grip', 'sensor']) { out.near[k] = geo(OHT_MODEL.near[k]); out.far[k] = geo(OHT_MODEL.far[k]); }
  out.mat = vcMat({ roughness: 0.5, metalness: 0.15 });
  // 前後狀態燈：貼在前後外殼頂部下緣的一條燈帶
  out.ledGeo = new THREE.BoxGeometry(0.012, 0.035, 0.62);
  return out;
})();

function createVehicle(seg, d) {
  const id = 'V' + String(++vehSeq).padStart(2, '0');
  const accent = new THREE.Color().setHSL((vehSeq * 0.137) % 1, 0.7, 0.55);
  const g = new THREE.Group();
  const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  // ---------- 走行部：前後兩組台車，在 C 形軌道裡跑；過彎時台車會相對車體轉向 ----------
  const bogies = [0.42, -0.42].map(ox => {
    const b = new THREE.Group(); b.userData.ox = ox; g.add(b);
    const bAdd = (m, x, y, z) => { m.position.set(x, y, z); b.add(m); return m; };
    bAdd(box(0.34, 0.04, 0.3, VG.gray), 0, -0.02, 0);                       // 台車框架
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.18, 24), VG.motor);
    motor.rotation.z = Math.PI / 2; bAdd(motor, 0.02, 0.05, 0.07);          // 走行馬達
    bAdd(box(0.12, 0.12, 0.1, VG.motor), -0.1, 0.04, -0.05);               // 減速機
    bAdd(box(0.05, 0.03, 0.05, VG.black), 0.13, 0.05, 0.07);               // 編碼器
    [-0.05, 0.05].forEach(z => {                                            // 頂部導引輪（分岔用）
      const gr = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 18), VG.black); bAdd(gr, 0.1, 0.105, z);
    });
    bAdd(box(0.08, 0.13, 0.06, VG.gray), 0, -0.11, 0);                     // 穿過軌道開槽的連桿
    b.userData.wheels = [-0.195, 0.195].map(z => {                         // 走行輪（壓在軌道內翻邊上）
      const w = new THREE.Group(); bAdd(w, 0, -0.12 + WHEEL_R, z);
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.05, 32), VG.tire); tire.rotation.x = Math.PI / 2; w.add(tire);
      const hub = box(0.07, 0.07, 0.055, VG.hub); w.add(hub);               // 方形輪轂：看得出輪子在轉
      return w;
    });
    return b;
  });
  // ---------- 外殼：原本的造型（八邊形前後外殼、車頂蓋、頂部防撞板＋LED）----------
  const M = MODEL.meta;
  const capMat = mat(0xf3f4f2, { roughness: 0.45, emissive: accent, emissiveIntensity: 0 });
  const cap = add(new THREE.Mesh(VG.capGeo, capMat), 0, 0, 0); cap.castShadow = true;
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x0a2a12, emissive: 0x39ff6a, emissiveIntensity: 1.3 });
  const pads = [1, -1].map(k => {
    const pd = add(new THREE.Mesh(VG.visorGeo, VG.visorMat), k * END_X, 0, 0); pd.castShadow = true;
    const led = add(new THREE.Mesh(VG.visorLedGeo, ledMat), k * END_X, 0, 0);
    if (k < 0) { pd.rotation.y = Math.PI; led.rotation.y = Math.PI; }
    return pd;
  });
  const OX = END_X + END_T / 2;
  const front = new THREE.Mesh(VG.endPanel, VG.white); front.castShadow = true; add(front, END_X, 0, 0);
  const rear = new THREE.Mesh(VG.endPanel, VG.white); rear.castShadow = true; add(rear, -END_X, 0, 0); rear.rotation.y = Math.PI;
  [-1, 1].forEach(k => add(box(2 * (END_X - END_T / 2) + 0.04, 0.04, 0.05, VG.gray), 0, BODY_BOT + 0.02, k * 0.47)); // 底部連接框
  [1, -1].forEach(k => {                                                  // 底部深色護邊＋四個斜角面上的花紋
    const tr = add(new THREE.Mesh(VG.trimGeo, VG.trimMat), k * END_X, 0, 0); if (k < 0) tr.rotation.y = Math.PI;
    [-1, 1].forEach(sz => {
      const n = [k / Math.SQRT2, sz / Math.SQRT2];                         // 斜角面的朝外方向
      const cx = END_T / 2 - END_CHAMFER / 2, cz = BODY_W / 2 - END_CHAMFER / 2;
      const d = add(new THREE.Mesh(VG.patGeo, VG.patMat), k * (END_X + cx) + n[0] * 0.004, -0.8, sz * cz + n[1] * 0.004);
      d.rotation.y = Math.atan2(n[0], n[1]);
    });
  });
  // 車頭的測距 Area Sensor（用使用者模型裡的：上下兩組），裝在車頭外側面上
  const sens = add(new THREE.Mesh(MODEL.near.sensor, MODEL.mat), OX - M.sensorBack + 0.003, BODY_BOT - M.sensorBottom, 0); sens.castShadow = true;
  const plateMat = idPlateMat(id, '#' + accent.getHexString());           // 前後車號牌
  const plateGeo = new THREE.PlaneGeometry(0.34, 0.19);
  const pf = add(new THREE.Mesh(plateGeo, plateMat), OX + 0.006, -0.65, 0); pf.rotation.y = Math.PI / 2;
  const pr = add(new THREE.Mesh(plateGeo, plateMat), -OX - 0.006, -0.65, 0); pr.rotation.y = -Math.PI / 2;
  add(box(1.12, 0.05, 0.92, VG.gray), 0, -0.265, 0);                       // 側移固定節（吊在車頂下）
  const body = cap;

  // ---------- 側移＋捲揚單元（模型）：整個單元跟著側移左右移動 ----------
  //   多節伸縮滑軌：固定節 → 第 1 節（移動 1/3）→ 第 2 節（移動 2/3）→ 側移＋捲揚單元（模型，移動全程）
  const stageMats = [mat(0xc3c9cf, { metalness: 0.6, roughness: 0.35 }), mat(0xaeb5bc, { metalness: 0.6, roughness: 0.35 })];
  const stages = [[1.08, -0.305, 1 / 3], [1.04, -0.345, 2 / 3]].map(([w, y, f], i) => {
    const st = add(box(w, 0.04, 0.88 - i * 0.02, stageMats[i]), 0, y, 0);
    [-1, 1].forEach(k => { const lip = box(0.02, 0.06, 0.88 - i * 0.02, VG.gray); lip.position.x = k * w / 2; st.add(lip); });
    st.userData.f = f; return st;
  });
  const shiftG = new THREE.Group(); g.add(shiftG);
  const sAdd = (m, x, y, z) => { m.position.set(x, y, z); shiftG.add(m); return m; };
  const housing = sAdd(new THREE.Mesh(MODEL.near.shift, MODEL.mat), 0, UNIT_DY, 0); housing.castShadow = true;
  // 捲揚鼓：在捲揚盒裡（勾「透視」才看得到）
  const drum = new THREE.Group(); sAdd(drum, 0, M.hoistBoxY + UNIT_DY, 0);
  const drumCyl = new THREE.Mesh(new THREE.CylinderGeometry(DRUM_R, DRUM_R, 0.8, 32), mat(0x9aa3ab, { metalness: 0.7, roughness: 0.3 }));
  drumCyl.rotation.z = Math.PI / 2; drum.add(drumCyl);
  const mark = box(0.75, 0.025, 0.03, mat(0xf2c94c)); mark.position.y = DRUM_R + 0.005; drum.add(mark);
  // 夾爪（模型）：跟著捲揚上下
  const gripper = new THREE.Group(); sAdd(gripper, 0, GRIP_REST, 0);
  const gm = new THREE.Mesh(MODEL.near.grip, MODEL.mat); gm.castShadow = true; gripper.add(gm);
  const fingers = [];
  // 三條吊帶：一邊兩條、另一邊一條（位置照模型）
  const beltMat = mat(0xd3d7db, { roughness: 0.6 });
  const belts = M.belts.map(([bx, bz]) => sAdd(new THREE.Mesh(new THREE.BoxGeometry(0.045, 1, 0.008), beltMat), bx, 0, bz));

  // ---------- 防墜機構：前後外殼底部各兩片小金屬板，伸到 FOUP 四個角落下方 ----------
  //   轉軸直立、裝在外殼內側角落；收起時板子轉 90° 藏進外殼底部，
  //   揮出時水平轉進車體中間，前後四片在 FOUP 底下合起來托住
  const guards = [];
  [-1, 1].forEach(k => {                                                  // k=+1 車頭端，k=-1 車尾端
    [-1, 1].forEach((sz, i) => {                                          // sz：左右兩片
      const pv = new THREE.Group(); pv.position.set(k * (END_X - END_T / 2), BODY_BOT + 0.04 - i * 0.012, sz * GUARD_Z); g.add(pv);   // 外殼底部（FOUP 底面再下面一點），揮出時托住 FOUP
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 14), VG.gray); pv.add(pin);  // 直立轉軸
      const plate = new THREE.Mesh(VG.guardGeo, VG.guardMat); plate.castShadow = true;
      plate.position.set(-k * GUARD_L / 2, 0, -sz * GUARD_W / 2); pv.add(plate);
      pv.userData.open = -sz * k * Math.PI / 2;                           // 收起時的轉角（轉進外殼底下）
      guards.push(pv);
    });
  });

  // E84 光通訊器（PIO）天車端：裝在車頂、靠機台那一側的邊緣，收發窗朝下對著機台頂部那一顆；停在 Port 上方時正好對準
  const pioMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: 0x000000, roughness: 0.4 });
  add(box(0.1, 0.06, 0.1, VG.gray), PIO_X, VPIO.y + 0.036, VPIO.z);
  add(box(0.06, 0.03, 0.06, VG.gray), PIO_X, VPIO.y + 0.05, -0.52);            // 固定座（接到車身側面）
  add(box(0.05, 0.012, 0.05, pioMat), PIO_X, VPIO.y, VPIO.z);
  const label = makeLabel(id, { scale: 0.62, w: 160, bg: '#' + accent.getHexString() + 'dd', fg: '#0b0f14' });
  scene.add(label); labels.push(label); label.visible = showLabels;   // 名牌不放在車子群組裡：遠看（簡化外形）時也看得到
  scene.add(g);
  const v = { id, seg, d, prevSeg: null, route: [], target: null, v: 0, state: 'idle', op: null, job: null, carry: null, timer: 0,
    hoist: 0, hv: 0, shift: 0, guard: 0, claw: 0, dist: 0,          // 機構狀態：捲揚深度、捲揚速度、側移量、防墜開度(0關1開)、夾爪(0開1合)
    group: g, bogies, shiftG, stages, drum, gripper, belts, fingers, guards, label,
    topMat: capMat, ledMat, pioMat, color: '#' + accent.getHexString() };
  [cap, ...pads, front, rear, housing, gm].forEach(m => pickables.push(m));
  if (xray) setXrayMat(capMat, true);
  setHiddenParts(v);
  g.traverse(o => o.userData.vehicle = v);
  vehicles.push(v); placeVehicle(v); return v;
}
// 走行部（在軌道裡）和捲揚鼓（在盒子裡）平常看不到，只在透視模式才畫，省效能
function setHiddenParts(v) { v.bogies.forEach(b => b.visible = xray); v.drum.visible = xray; }
function placeVehicle(v, detailed = true) {
  const pa = pathAhead(v, 0.6);
  const [x, z] = pointAlong(v, 0, pa), [x2, z2] = pointAlong(v, 0.05, pa);
  v.group.position.set(x, liftY(v.lift || 0), z);                    // 平常在軌道高度；在維修區捲揚機上會跟著降下去
  v.group.rotation.y = Math.atan2(-(z2 - z), x2 - x);
  v.label.position.set(x, v.group.position.y + 0.95, z);
  // 側移、捲揚（被吊著的 FOUP 跟著夾爪走，所以遠處也要更新）
  v.shiftG.position.z = v.shift;
  const gy = GRIP_REST - v.hoist;
  v.gripper.position.y = gy;
  if (!detailed) return;                                             // 遠處只畫簡化外形，下面的細節不用算
  // 走行部：台車跟著自己所在位置的軌道方向轉，輪子依行走距離轉動
  const th = v.group.rotation.y, c = Math.cos(th), sn = Math.sin(th);
  if (xray) v.bogies.forEach(b => {
    const ox = b.userData.ox, [bx, bz] = pointAlong(v, ox, pa), [bx2, bz2] = pointAlong(v, ox + 0.05, pa);
    const wx = bx - x, wz = bz - z;
    b.position.set(wx * c - wz * sn, 0, wx * sn + wz * c);
    let rel = Math.atan2(-(bz2 - bz), bx2 - bx) - th;
    rel = ((rel + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    b.rotation.y = rel;
    b.userData.wheels.forEach(w => w.rotation.z = -v.dist / WHEEL_R);
  });
  v.stages.forEach(st => st.position.z = v.shift * st.userData.f);
  v.drum.rotation.x = v.hoist / DRUM_R;
  const top = MODEL.meta.beltTop + UNIT_DY, bot = gy + MODEL.meta.beltGrip, len = Math.max(0.01, top - bot);
  v.belts.forEach(b => { b.scale.y = len; b.position.y = (top + bot) / 2; });
  // 夾爪
  v.fingers.forEach(f => f.position.z = f.userData.k * (0.27 - 0.08 * v.claw));
  // 防墜板：0＝揮出托在 FOUP 下方，1＝收進外殼底部（繞直立軸水平轉動）
  v.guards.forEach(pv => pv.rotation.y = pv.userData.open * v.guard);
}

// ---------- 遠處的天車：只畫簡化外形（車身＋狀態燈），所有天車合在一起畫 ----------
const VEH_MAX = 150;      // 天車數量上限
const LOD_DIST = 45;      // 離鏡頭多遠以內才畫完整細節（實際用 GFX.lod，依畫質調整）
const VP = (() => {
  // 遠處用的簡化天車：同一個模型的簡化版（far），車體、側移＋捲揚單元、夾爪、吊帶、前後燈各一個 InstancedMesh，
  //   所有天車一起畫；側移單元跟著側移、夾爪跟著捲揚，所以遠看也看得到取放貨的動作
  const Mm = MODEL.meta, make = fill => { const b = makeBatch(); fill(b); return b.geometry(); };
  const beltGeo = make(b => Mm.belts.forEach(([x, z]) => b.add(new THREE.BoxGeometry(0.045, 1, 0.008), 0xd3d7db, null, x, -0.5, z)));
  const ledGeo = make(b => { b.add(VG.visorLedGeo, 0xffffff, null, END_X, 0, 0); b.add(VG.visorLedGeo, 0xffffff, null, -END_X, 0, 0, Math.PI); });
  const W = 0xf3f4f2, GR = 0x8f979e;
  const bodyGeo = make(b => {                                         // 外殼：原本的造型
    b.add(VG.endPanel, W, null, END_X, 0, 0); b.add(VG.endPanel, W, null, -END_X, 0, 0, Math.PI);
    b.add(VG.capGeo, W, null, 0, 0, 0);
    b.add(VG.visorGeo, 0xdfe3e6, null, END_X, 0, 0); b.add(VG.visorGeo, 0xdfe3e6, null, -END_X, 0, 0, Math.PI);
    b.add(VG.trimGeo, 0x26282d, null, END_X, 0, 0); b.add(VG.trimGeo, 0x26282d, null, -END_X, 0, 0, Math.PI);
    b.add(new THREE.BoxGeometry(1.12, 0.05, 0.92), GR, null, 0, -0.265, 0);
    [-1, 1].forEach(k => b.add(new THREE.BoxGeometry(2 * (END_X - END_T / 2) + 0.04, 0.04, 0.05), GR, null, 0, BODY_BOT + 0.02, k * 0.47));
  });
  const unitGeo = MODEL.far.shift.clone().translate(0, UNIT_DY, 0);
  const body = new THREE.InstancedMesh(bodyGeo, vcMat({ roughness: 0.45, metalness: 0.15 }), VEH_MAX), unit = new THREE.InstancedMesh(unitGeo, MODEL.mat, VEH_MAX);
  const grip = new THREE.InstancedMesh(MODEL.far.grip, MODEL.mat, VEH_MAX), belt = new THREE.InstancedMesh(beltGeo, vcMat({ roughness: 0.6 }), VEH_MAX);
  const led = new THREE.InstancedMesh(ledGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), VEH_MAX);
  const all = [body, unit, grip, belt, led];
  all.forEach(m => { m.frustumCulled = false; m.count = 0; scene.add(m); });
  body.castShadow = unit.castShadow = grip.castShadow = true;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), m = new THREE.Matrix4(), t = new THREE.Matrix4(), t2 = new THREE.Matrix4(), q = new THREE.Quaternion(), q0 = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), sc = new THREE.Vector3(), c = new THREE.Color();
  return {
    body, led, all, c,
    hide(i) { all.forEach(x => x.setMatrixAt(i, zero)); },
    set(i, v) {
      const g = v.group.position;
      m.compose(p.set(g.x, g.y, g.z), q.setFromEuler(e.set(0, v.group.rotation.y, 0)), one);
      body.setMatrixAt(i, m); led.setMatrixAt(i, m);
      unit.setMatrixAt(i, t.copy(m).multiply(t2.makeTranslation(0, 0, v.shift)));
      const gy = GRIP_REST - v.hoist;
      grip.setMatrixAt(i, t.copy(m).multiply(t2.makeTranslation(0, gy, v.shift)));
      const top = Mm.beltTop + UNIT_DY, len = Math.max(0.01, top - (gy + Mm.beltGrip));
      belt.setMatrixAt(i, t.copy(m).multiply(t2.compose(p.set(0, top, v.shift), q0, sc.set(1, len, 1))));
    },
    finish(n) { all.forEach(x => { x.count = n; x.instanceMatrix.needsUpdate = true; }); if (led.instanceColor) led.instanceColor.needsUpdate = true; },
  };
})();
// 初始天車：平均分散在主幹線上
function mainLoc(s) { for (const sg of mainSegs) { if (s < sg.len) return [sg, s]; s -= sg.len; } return [mainSegs[0], 0]; }
const INIT_VEHICLES = 56;
for (let i = 0; i < INIT_VEHICLES; i++) createVehicle(...mainLoc(i * MAIN_LEN / INIT_VEHICLES));
