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
      add(D.lpFoot, 0x2f363d, lx, 0.03, 0);
      add(D.lpPanel, 0x1f252b, lx, 0.5, 0.486);
      add(D.lpBtn, 0x22c55e, lx - 0.09, 0.5, 0.5); add(D.lpBtn, 0xfacc15, lx, 0.5, 0.5); add(D.lpBtn, 0x60a5fa, lx + 0.09, 0.5, 0.5);
    });
    scene.remove(g);
  });
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
