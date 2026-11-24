// detail.js — 畫質細節：高架地板材質、機台／Load Port 外觀細節、軌道接頭與分岔／合流彎軌、
//             「高」畫質才開的光影（環境反射、燈光平衡、陰影偏移）
// 全部合併成少數幾個網格（makeBatch），不增加太多繪圖次數；放在 factory.js、track.js 之後載入。

// ---------- 高架地板：600 mm 方形穿孔地板 ----------
(function floorTiles() {
  if (BENCH) return;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#56606b'; g.fillRect(0, 0, 256, 256);
  const pad = 22, n = 9, step = (256 - pad * 2) / (n - 1);                 // 中間一塊穿孔區
  g.fillStyle = '#434c56';
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.beginPath(); g.arc(pad + i * step, pad + j * step, 5.2, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#2f363e'; g.lineWidth = 6; g.strokeRect(0, 0, 256, 256);   // 地板接縫
  g.strokeStyle = '#6a747f'; g.lineWidth = 2; g.strokeRect(5, 5, 246, 246);   // 邊緣倒角的亮邊
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(FLOOR_W / 0.6, FLOOR_D / 0.6);
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  floor.material.map = tex; floor.material.color.set(0xffffff); floor.material.roughness = 0.82; floor.material.metalness = 0.1;
  floor.material.needsUpdate = true;
  grid.visible = false;                                                     // 地板本身就有接縫，不用格線
})();

// ---------- 機台與 Load Port 細節 ----------
const detailBatch = makeBatch();
const LPD = { mesh: null, tmp: new THREE.Matrix4(), m: new THREE.Matrix4(), s: new THREE.Matrix4() };
{
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const D = {
    plinth: B(4.5, 0.12, 2.7), frameH: B(3.7, 0.05, 0.035), frameV: B(0.05, 1.7, 0.035),
    lowerPanel: B(4.4, 0.95, 0.02), seamV: B(0.012, 2.75, 0.02), seamH: B(4.42, 0.012, 0.02),
    handle: B(0.03, 0.26, 0.04), sideSeam: B(0.02, 2.75, 0.012),
    topBox: B(1.6, 0.26, 1.2), grille: B(1.4, 0.012, 1.0), duct: new THREE.CylinderGeometry(0.17, 0.17, 0.55, 28), ductCap: new THREE.CylinderGeometry(0.2, 0.2, 0.05, 28),
    tray: B(4.0, 0.06, 0.3), emoPlate: B(0.17, 0.17, 0.02), emo: new THREE.CylinderGeometry(0.05, 0.055, 0.05, 24),
    lpLow: B(0.95, 1.09, 0.075), lpTop: B(0.95, 0.13, 0.075), lpSide: B(0.145, 0.53, 0.075),
    lpPanel: B(0.4, 0.17, 0.02), lpBtn: new THREE.CylinderGeometry(0.026, 0.026, 0.02, 16), lpFoot: B(1.0, 0.06, 1.0),
  };
  const emoRot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  D.emo.applyMatrix4(emoRot); D.lpBtn.applyMatrix4(emoRot);
  const lpDoors = [];
  machines.forEach(m => {
    const dc = m.ports.reduce((a, p) => a + p.d, 0) / m.ports.length;
    const g = groupAt(m.seg, dc), zc = -1.95, zf = -0.65;                  // 機台中心 z、正面（朝軌道、Load Port 那一面）
    const add = (geo, col, x, y, z) => detailBatch.add(geo, col, g, x, y, z);
    add(D.plinth, 0x2a3036, 0, 0.06, zc);                                  // 底座踢腳板
    add(D.lowerPanel, 0xbfc7ce, 0, 0.6, zf + 0.012);                       // 正面下半部面板
    add(D.frameH, 0x9aa5af, 0, 2.725, zf + 0.025); add(D.frameH, 0x9aa5af, 0, 1.075, zf + 0.025);   // 黑色觀察窗的外框
    add(D.frameV, 0x9aa5af, -1.825, 1.9, zf + 0.025); add(D.frameV, 0x9aa5af, 1.825, 1.9, zf + 0.025);
    [-2.2, 2.2].forEach(x => {                                              // 兩側的維修門：接縫＋把手
      [-1.3, -2.6].forEach(z => add(D.sideSeam, 0x8b949d, x + Math.sign(x) * 0.006, 1.5, z));
      add(D.handle, 0x3b434b, x + Math.sign(x) * 0.02, 1.45, -1.95);
    });
    add(D.seamH, 0x8b949d, 0, 2.98, zf + 0.01);                             // 頂邊收邊
    add(D.topBox, 0xc6cdd4, 0.2, 3.13, zc - 0.3);                          // 頂部控制箱＋排風口
    add(D.grille, 0x59626b, 0.2, 3.267, zc - 0.3);
    add(D.duct, 0x9aa3ab, 1.55, 3.27, zc - 0.55); add(D.ductCap, 0x7c858e, 1.55, 3.55, zc - 0.55);
    add(D.duct, 0x9aa3ab, -1.05, 3.27, zc - 0.75); add(D.ductCap, 0x7c858e, -1.05, 3.55, zc - 0.75);
    add(D.tray, 0x6b747d, 0, 3.03, zc - 1.1);                               // 頂部背面的線槽
    add(D.emoPlate, 0xf2c200, 2.02, 1.45, zf + 0.012); add(D.emo, 0xd62828, 2.02, 1.45, zf + 0.045);   // 緊急停止按鈕
    m.ports.forEach(p => {                                                  // Load Port：靠機台的直立面板（FIMS 開門口）、底座操作面板
      const lx = p.d - dc;
      // FIMS 對接面：中間是開門口（FOUP 門 0.6×0.5 m 剛好塞得進去），FOUP 前移 250 mm 後外殼正面貼平這片面板
      //   外殼前緣對接後在 z = -0.575（＝ -(0.25 + 0.325)）；開門口後面就是機台的黑色觀察窗，看起來是一個深色的洞
      const PZ = -0.6145;                                                     // 面板 z：-0.652 ～ -0.577，跟對接後的外殼留 2 mm，兩個面才不會疊在一起閃
      add(D.lpLow, 0xb6bfc7, lx, 0.545, PZ);                                 // 開門口下方
      add(D.lpTop, 0xb6bfc7, lx, 1.685, PZ);                                // 開門口上方
      add(D.lpSide, 0xb6bfc7, lx - 0.4025, 1.355, PZ); add(D.lpSide, 0xb6bfc7, lx + 0.4025, 1.355, PZ);   // 開門口兩側
      // Load Port 自己的門（關著時擋住開門口；FOUP 對接後跟 FOUP 門扣在一起，一起退後、下降）
      g.updateMatrixWorld(true);
      p.lpDoor = { idx: lpDoors.length, base: new THREE.Matrix4().multiplyMatrices(g.matrixWorld, new THREE.Matrix4().makeTranslation(lx, 1.35, -0.6075)), open: -1 };
      lpDoors.push(p);
      add(D.lpFoot, 0x2f363d, lx, 0.03, 0);
      add(D.lpPanel, 0x1f252b, lx, 0.5, 0.486);
      add(D.lpBtn, 0x22c55e, lx - 0.09, 0.5, 0.5); add(D.lpBtn, 0xfacc15, lx, 0.5, 0.5); add(D.lpBtn, 0x60a5fa, lx + 0.09, 0.5, 0.5);
    });
    scene.remove(g);
  });
  // 前面 0.6015、後面 0.6135：比機台黑色觀察窗（前面 -0.605）凸出 3.5 mm，不會跟它疊在一起閃
  const dim = new THREE.InstancedMesh(new THREE.BoxGeometry(0.64, 0.5, 0.012), mat(0x59616a, { metalness: 0.45, roughness: 0.4 }), Math.max(1, lpDoors.length));
  dim.castShadow = false; dim.receiveShadow = true; dim.count = lpDoors.length; scene.add(dim);
  LPD.mesh = dim;
  // 開門口後面的機台內部空間（EFEM）：晶圓被取出時是「進到一個空間裡」，不是被機台正面切掉
  //   機台正面的黑色觀察窗是實心的，挖不開，所以用模板緩衝（stencil）：
  //   1. 開門口畫一片看不見的「洞口」，只在 stencil 寫 1（被 Load Port 框、FOUP、晶圓擋住的地方就不會寫到）
  //   2. 在洞口範圍裡把深度重設到機台裡面（一片看不見的板子，深度測試一律通過）
  //   3. 再畫內部空間（深灰色的盒子內壁）、機械手臂和正在被取出的晶圓，都只畫在 stencil＝1 的地方
  const N = Math.max(1, lpDoors.length), st = (m, func, op) => Object.assign(m, { stencilWrite: true, stencilRef: 1, stencilFunc: func, stencilZPass: op || THREE.KeepStencilOp });
  const portal = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.66, 1), st(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), THREE.AlwaysStencilFunc, THREE.ReplaceStencilOp), N);
  const reset = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.5, 2.5), st(new THREE.MeshBasicMaterial({ colorWrite: false, depthFunc: THREE.AlwaysDepth }), THREE.EqualStencilFunc), N);
  const room = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.6, 0.9), st(mat(0x3a4148, { side: THREE.BackSide, roughness: 0.8 }), THREE.EqualStencilFunc), N);
  [[portal, 1], [reset, 2], [room, 3]].forEach(([m, o]) => { m.renderOrder = o; m.frustumCulled = false; m.castShadow = false; m.count = lpDoors.length; scene.add(m); });
  Object.assign(LPD, { portal, reset, room, roomM: new THREE.Matrix4().makeTranslation(0, 0, -0.4475), resetM: new THREE.Matrix4().makeTranslation(0, 0, -0.92) });
  lpDoors.forEach(p => { const d = p.lpDoor;
    LPD.m.multiplyMatrices(d.base, LPD.roomM); room.setMatrixAt(d.idx, LPD.m);       // 內部空間（EFEM）：寬 1.2 m、往機台裡 90 cm，裡面放取晶圓的機械手臂
    LPD.m.multiplyMatrices(d.base, LPD.resetM); reset.setMatrixAt(d.idx, LPD.m); });
  lpDoors.forEach(p => setLpDoor(p, 0));
}

// ---------- EFEM 機械手臂（青蛙腿型 frog-leg＋吸盤式托片）：從 FOUP 逐片取出／放回晶圓 ----------
//   座標用 Load Port 門的座標（d.base：x 左右、y 上下、+z 朝軌道／FOUP）。手臂中心（升降立柱）在開門口後面 0.8 m。
//   青蛙腿：中心兩隻上臂（各 0.4 m）往左右對稱張開，各接一隻前臂（0.4 m），兩隻前臂在手腕會合；
//   上臂張開角度 φ＝acos(D／0.8)（D＝中心到手腕距離），兩隻手臂同時往內收，手腕就沿直線往前推，托片一直朝 FOUP。
//   托片從手腕往前 0.38 m 是吸盤中心（＝晶圓中心）：托片伸進 FOUP 時，手腕還在機台裡面。
//   只畫在近處的機台（最多 32 台，跟近看晶圓同一批）；每個零件畫兩次：一般的一份＋只畫在開門口洞口裡的一份
const ARM = { L: 0.4, blade: 0.38, colZ: -0.8, floorY: -0.3, max: 32 };
const robot = (() => {
  const st = m => Object.assign(m.clone(), { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc });
  const link = (L, w, t, col) => { const b = makeBatch();                                     // 一隻手臂：沿 +x，兩端圓頭
    b.add(new THREE.BoxGeometry(L, t, w), col, null, L / 2, 0, 0);
    [0, L].forEach(x => b.add(new THREE.CylinderGeometry(w / 2, w / 2, t, 20), col, null, x, 0, 0)); return b.geometry(); };
  const col = (() => { const b = makeBatch();                                                  // 立柱（高度用 scale.y）＋頂端的轉盤
    b.add(new THREE.CylinderGeometry(0.075, 0.085, 1, 24), 0x8b949c, null, 0, 0.5, 0); return b.geometry(); })();
  const hub = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 24);                                 // 手腕會合處的轉軸
  const blade = (() => { const b = makeBatch();                                               // 托片：根部＋兩根叉指，叉指上三個黑色吸盤
    b.add(new THREE.BoxGeometry(0.16, 0.004, 0.07), 0xd9dee2, null, 0.08, 0, 0);
    [-1, 1].forEach(k => b.add(new THREE.BoxGeometry(0.3, 0.004, 0.022), 0xd9dee2, null, 0.31, 0, k * 0.028));
    [[0.3, -0.028], [0.3, 0.028], [0.44, 0]].forEach(([x, z]) => b.add(new THREE.CylinderGeometry(0.011, 0.011, 0.0015, 14), 0x1a1d21, null, x, 0.00275, z));
    b.add(new THREE.BoxGeometry(0.03, 0.004, 0.078), 0xd9dee2, null, 0.44, 0, 0); return b.geometry(); })();
  // 每個零件：[形狀, 每台幾個]
  const defs = [[col, 1], [link(ARM.L, 0.1, 0.026, 0xe7eaed), 2], [link(ARM.L, 0.075, 0.02, 0xdfe3e7), 2], [hub, 1], [blade, 1]];
  const parts = defs.map(([g, k], idx) => {
    const m = idx === 3 ? mat(0xb7bec5, { metalness: 0.45, roughness: 0.4 }) : vcMat({ metalness: 0.3, roughness: 0.45 });
    return [m, st(m)].map((mm, i) => { const im = new THREE.InstancedMesh(g, mm, ARM.max * k);
      im.count = 0; im.frustumCulled = false; im.castShadow = false; im.renderOrder = i ? 4 : 0; scene.add(im); return im; });
  });
  return { parts, per: defs.map(d => d[1]), m: new THREE.Matrix4(), t: new THREE.Matrix4(), r: new THREE.Matrix4(), sc: new THREE.Matrix4() };
})();
// 一台手臂的姿勢：armX＝托片伸出量（0＝吸盤在 FOUP 裡的晶圓中心，0.62＝收回機台裡），padTop＝吸盤上緣高度（門座標）
function robotPose(p, n, armX, padTop) {
  const d = p.lpDoor, R = robot, put = (k, slot, x, y, z, ang, sy) => {
    R.t.makeTranslation(x, y, z).multiply(R.r.makeRotationY(ang)); if (sy) R.t.multiply(R.sc.makeScale(1, sy, 1));
    R.m.multiplyMatrices(d.base, R.t); R.parts[k].forEach(im => im.setMatrixAt(n * R.per[k] + slot, R.m)); };
  const L = ARM.L, pz = 0.3425 - armX, wz = pz - ARM.blade, D = Math.max(0.08, Math.min(2 * L - 1e-3, wz - ARM.colZ));
  const phi = Math.acos(D / (2 * L)), ex = L * Math.sin(phi), ez = ARM.colZ + L * Math.cos(phi), wzz = ARM.colZ + D;
  const yB = padTop - 0.0015 - 0.002, y2 = yB - 0.014, y1 = y2 - 0.023, yc = y1 - 0.013;
  put(0, 0, 0, ARM.floorY, ARM.colZ, 0, Math.max(0.02, yc - ARM.floorY));                       // 立柱（升降軸）
  [-1, 1].forEach((k, i) => {
    put(1, i, 0, y1, ARM.colZ, Math.atan2(-(ez - ARM.colZ), k * ex), 0);                         // 上臂：中心 → 左／右手肘
    put(2, i, k * ex, y2, ez, Math.atan2(-(wzz - ez), -k * ex), 0);                              // 前臂：手肘 → 手腕
  });
  put(3, 0, 0, y2, wzz, 0, 0);                                                                  // 手腕轉軸
  put(4, 0, 0, yB, wzz, -Math.PI / 2, 0);                                                        // 托片：一直朝 FOUP（+z）
}
function drawRobots(list) {                                                                      // list：[{ p, armX, padTop }]
  const n = Math.min(list.length, ARM.max);
  for (let i = 0; i < n; i++) robotPose(list[i].p, i, list[i].armX, list[i].padTop);
  robot.parts.forEach((pp, k) => pp.forEach(im => { im.count = n * robot.per[k]; if (n) im.instanceMatrix.needsUpdate = true; }));
}

// Load Port 門的位置：open 0→0.3 往機台退 LP_DOOR_BACK，0.3→1 下降 LP_DOOR_DOWN（跟 FOUP 門同一套動作）
function setLpDoor(p, open) {
  const d = p.lpDoor; if (!d || !LPD.mesh || d.open === open) return; d.open = open;
  LPD.tmp.makeTranslation(0, -Math.max(0, (open - .3) / .7) * 0.55, -Math.min(open / .3, 1) * 0.012);
  LPD.m.multiplyMatrices(d.base, LPD.tmp); LPD.mesh.setMatrixAt(d.idx, LPD.m); LPD.mesh.instanceMatrix.needsUpdate = true;
  // 洞口：門上緣以上、開門口上緣（1.62）以下；門沒開時不畫
  if (LPD.portal) {
    const lo = Math.max(1.09, 1.60 - Math.max(0, (open - .3) / .7) * 0.55) - 1.35, hi = 1.62 - 1.35;
    if (open <= 0 || hi - lo < 0.005) LPD.tmp.makeScale(0, 0, 0);
    else LPD.tmp.makeTranslation(0, (lo + hi) / 2, 0.0085).multiply(LPD.s.makeScale(1, hi - lo, 1));   // z -0.599：在 Load Port 面板後面、黑色觀察窗前面
    LPD.m.multiplyMatrices(d.base, LPD.tmp); LPD.portal.setMatrixAt(d.idx, LPD.m); LPD.portal.instanceMatrix.needsUpdate = true;
  }
}

// ---------- 軌道：接頭、分岔／合流段槽內的彎軌、合流前的三角凸塊 ----------
{
  const joints = [];
  segs.forEach(sg => { for (let s = 1.5; s < sg.len - 0.2; s += 3) { if (onLifter(sg, s, LIFT_HALF + 0.6)) continue; const f = frameAt(sg, s); if (!joints.some(j => Math.hypot(j.x - f.x, j.z - f.z) < 1.2)) joints.push(f); } });   // 兩段軌道疊在一起的地方不要重複放
  const jGeo = new THREE.BoxGeometry(0.035, 0.34, 0.665), jMat = mat(0x9aa4ad, { metalness: 0.6, roughness: 0.35 });
  const jim = new THREE.InstancedMesh(jGeo, jMat, joints.length), o3 = new THREE.Object3D();
  joints.forEach((f, i) => { o3.position.set(f.x, H, f.z); o3.rotation.set(0, f.th, 0); o3.updateMatrix(); jim.setMatrixAt(i, o3.matrix); });
  jim.castShadow = true; jim.frustumCulled = false; scene.add(jim);

  // 彎軌：分岔點前 1.5 m 開始，沿支線 3.5 m；合流點前 3.5 m 沿支線到合流點後 0.5 m。偏支線那一側（槽頂往下凸）
  const GUIDE_Y = H + 0.075, GUIDE_OFF = 0.14, STEP = 0.25;
  const gGeo = new THREE.BoxGeometry(STEP * 1.08, 0.09, 0.025), guideMats = [], wedges = [];
  const strip = (sg, d0, d1, sd) => {
    for (let s = Math.max(0, d0); s < Math.min(sg.len, d1); s += STEP) {
      const f = frameAt(sg, s + STEP / 2);
      guideMats.push(new THREE.Matrix4().compose(new THREE.Vector3(f.x + sd * GUIDE_OFF * f.nx, GUIDE_Y, f.z + sd * GUIDE_OFF * f.nz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f.th, 0)), new THREE.Vector3(1, 1, 1)));
    }
  };
  nodes.forEach(n => {
    if (n.out.length > 1) {                                                // 分岔
      const main = n.def, branches = n.out.filter(s => s !== main);
      branches.forEach(br => {
        const inc = n.in[0];
        const fM = frameAt(main, 0), [bx, bz] = br.at(Math.min(br.len, 2.5));
        const sd = Math.sign((bx - fM.x) * fM.nx + (bz - fM.z) * fM.nz) || 1;
        if (inc) strip(inc, inc.len - 1.5, inc.len, sd);
        strip(br, 0, 3.5, sd);
      });
    }
    if (n.in.length > 1) {                                                 // 合流
      const out = n.out[0]; if (!out) return;
      n.in.forEach(br => {
        if (br.kind === 'main') return;                                    // 主線來車不用導引
        const fO = frameAt(out, 0), [bx, bz] = br.at(Math.max(0, br.len - 2.5));
        const sd = Math.sign((bx - fO.x) * fO.nx + (bz - fO.z) * fO.nz) || 1;
        strip(br, br.len - 3.5, br.len, sd); strip(out, 0, 0.5, sd);
        wedges.push({ sg: br, d: br.len - 3.9 });
      });
    }
  });
  const gim = new THREE.InstancedMesh(gGeo, mat(0xc9a227, { metalness: 0.55, roughness: 0.35 }), Math.max(1, guideMats.length));
  guideMats.forEach((m4, i) => gim.setMatrixAt(i, m4)); gim.frustumCulled = false; scene.add(gim);
  // 三角凸塊：在支線槽內，尖角朝來車；把上手（兩導輪併在中間）撐開成下手
  const tri = new THREE.Shape(); tri.moveTo(-0.22, 0); tri.lineTo(0.22, 0.13); tri.lineTo(0.22, -0.13); tri.closePath();
  const wGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.07, bevelEnabled: false }); wGeo.rotateX(Math.PI / 2); wGeo.translate(0, 0.035, 0);
  const wim = new THREE.InstancedMesh(wGeo, mat(0x8f99a3, { metalness: 0.6, roughness: 0.3 }), Math.max(1, wedges.length));
  wedges.forEach((w, i) => { const f = frameAt(w.sg, w.d); o3.position.set(f.x, H + 0.09, f.z); o3.rotation.set(0, f.th, 0); o3.updateMatrix(); wim.setMatrixAt(i, o3.matrix); });
  wim.frustumCulled = false; scene.add(wim);
}
detailBatch.build(vcMat({ metalness: 0.3, roughness: 0.5 }));

// ---------- 「高」畫質才開：環境反射、燈光平衡、陰影偏移 ----------
let envTex = null;
const hemiLight = scene.children.find(o => o.isHemisphereLight);
function makeEnvTex() {                                                    // 一個簡單的無塵室：淺灰牆、深色地板、天花板一排排燈條
  const es = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(100, 30, 100), new THREE.MeshBasicMaterial({ color: 0x7f8891, side: THREE.BackSide }));
  room.position.y = 10; es.add(room);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ color: 0x353c45 }));
  fl.rotation.x = -Math.PI / 2; fl.position.y = -4.9; es.add(fl);
  const lm = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = -4; i <= 4; i++) for (let j = -2; j <= 2; j++) { const l = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.2), lm); l.rotation.x = Math.PI / 2; l.position.set(i * 11, 24.8, j * 18); es.add(l); }
  const pm = new THREE.PMREMGenerator(renderer), t = pm.fromScene(es, 0.02).texture; pm.dispose(); return t;
}
function setFineLook(on) {
  if (BENCH) return;
  if (on && !envTex) envTex = makeEnvTex();
  scene.environment = on ? envTex : null;
  if (hemiLight) hemiLight.intensity = on ? FINE_LOOK.hemi : 0.75;
  sun.intensity = on ? FINE_LOOK.sun : 0.85;
  scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
  renderer.shadowMap.needsUpdate = true;
}
const FINE_LOOK = { hemi: 0.45, sun: 0.85 };
{
  const base = applyGfx;
  applyGfx = function (level, why) { base(level, why); setFineLook(level === 'high'); };   // eslint-disable-line no-global-assign
}
