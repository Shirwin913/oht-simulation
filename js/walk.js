// walk.js — 人員視角：站在地上、眼睛高度 1.65 m，用鍵盤走路、滑鼠拖曳轉頭，看天車在頭上跑
//   W/A/S/D 或方向鍵：前後左右走；Shift：快走；按住滑鼠左鍵拖曳：轉頭／抬頭；滾輪：往前／往後一步；Esc：回到俯瞰
let walkOn = false;
const WALK = { eye: 1.65, yaw: 0, pitch: 0, keys: new Set(), drag: null, saved: null, obstacles: null };

// 機台、NTB 的佔地（照它們在軌道上的方向擺的長方形），走路時不能穿過去
function walkObstacles() {
  const list = [];
  const box = (seg, dc, along, n0, n1) => { const f = frameAt(seg, dc); list.push({ x: f.x, z: f.z, tx: f.tx, tz: f.tz, nx: f.nx, nz: f.nz, along, n0, n1 }); };
  machines.forEach(m => { const dc = m.ports.reduce((a, p) => a + p.d, 0) / m.ports.length; box(m.seg, dc, MACH_W / 2 + 0.1, -(MACH_F + MACH_D + 0.1), 0.5); });
  ntbs.forEach(o => { const dc = o.ports.reduce((a, p) => a + p.d, 0) / o.ports.length; box(o.ports[0].seg, dc, 1.55, -3.95, 0.55); });
  return list;
}
function walkBlocked(x, z, r = 0.3) {
  if (Math.abs(x) > FLOOR_W / 2 - 0.5 || Math.abs(z - FLOOR_Z) > FLOOR_D / 2 - 0.5) return true;   // 地板邊緣
  for (const o of WALK.obstacles) {
    const dx = x - o.x, dz = z - o.z, a = dx * o.tx + dz * o.tz, n = dx * o.nx + dz * o.nz;
    if (Math.abs(a) < o.along + r && n > o.n0 - r && n < o.n1 + r) return true;
  }
  return false;
}
function enterWalk() {
  if (walkOn) return;
  setFollow(null);
  if (!WALK.obstacles) WALK.obstacles = walkObstacles();
  WALK.saved = { cam: camera.position.clone(), target: controls.target.clone() };
  // 站在目前畫面中心點的地上，面向原本鏡頭看的方向；如果剛好在機台裡面，就往旁邊找空地
  const dir = new THREE.Vector3().subVectors(controls.target, camera.position); dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();
  let x = controls.target.x, z = controls.target.z;
  for (let r = 0; r < 15 && walkBlocked(x, z, 1.0); r += 0.5) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, tx = controls.target.x + Math.cos(a) * r, tz = controls.target.z + Math.sin(a) * r; if (!walkBlocked(tx, tz, 1.0)) { x = tx; z = tz; break; } }   // 找一個四周至少 1 m 空的地方
  WALK.yaw = Math.atan2(-dir.x, -dir.z); WALK.pitch = 0.18;               // 稍微抬頭，一進來就看得到軌道
  camera.position.set(x, WALK.eye, z);
  walkOn = true; controls.enabled = false; camera.rotation.order = 'YXZ';
  walkCeiling().visible = true; WALK.bg = scene.background; scene.background = new THREE.Color(0x3a424c);   // 從地上看：有天花板，不是黑色的天空
  document.getElementById('btnWalk').classList.add('on'); document.getElementById('btnWalk').textContent = '🦅 俯瞰視角';
  document.getElementById('hint').textContent = '人員視角：W/A/S/D 或方向鍵走路 · Shift 快走 · 按住滑鼠拖曳轉頭 · 滾輪往前後 · Esc 回到俯瞰';
  walkAim();
}
function exitWalk() {
  if (!walkOn) return;
  walkOn = false; controls.enabled = true; WALK.keys.clear(); WALK.drag = null;
  camera.rotation.order = 'XYZ';
  walkCeiling().visible = false; scene.background = WALK.bg;
  if (WALK.saved) { camera.position.copy(WALK.saved.cam); controls.target.copy(WALK.saved.target); }
  controls.update();
  document.getElementById('btnWalk').classList.remove('on'); document.getElementById('btnWalk').textContent = '🚶 人員視角';
  document.getElementById('hint').textContent = '左鍵拖曳旋轉 · 右鍵平移 · 滾輪縮放 · 點擊天車跟隨';
}
// 天花板（只有人員視角才顯示，俯瞰時會擋住）：吊桿上端 10.5 m 的高度，白色 600 mm 天花板＋一排排燈具
//   A 區（有微影 LITHO 機台）做成黃光區：燈具是黃光、天花板偏黃，區內再打幾盞黃色的燈，地面、機台都會染上黃光
const YELLOW_ZONE = 'A';
let walkCeil = null;
function walkCeiling() {
  if (walkCeil) return walkCeil;
  const z = ZONES.find(q => q.name === YELLOW_ZONE);
  const yx0 = z.cx < 0 ? -FLOOR_W / 2 : 0, yz0 = z.zc < FLOOR_Z ? FLOOR_Z - FLOOR_D / 2 : FLOOR_Z;   // 黃光區：地板的那四分之一
  const inYellow = (x, zz) => x >= yx0 && x < yx0 + FLOOR_W / 2 && zz >= yz0 && zz < yz0 + FLOOR_D / 2;
  const tile = (bg, line) => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 128, 128); g.strokeStyle = line; g.lineWidth = 3; g.strokeRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  walkCeil = new THREE.Group();
  const white = tile('#f4f6f8', '#d5dade'); white.repeat.set(FLOOR_W / 1.2, FLOOR_D / 1.2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, FLOOR_D), new THREE.MeshBasicMaterial({ map: white, side: THREE.DoubleSide }));   // 不受光照影響，看起來就是白色
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 10.55, FLOOR_Z); walkCeil.add(ceil);
  const yel = tile('#f7e7b4', '#ddc98a'); yel.repeat.set(FLOOR_W / 2 / 1.2, FLOOR_D / 2 / 1.2);
  const yc = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W / 2, FLOOR_D / 2), new THREE.MeshBasicMaterial({ map: yel, side: THREE.DoubleSide }));
  yc.rotation.x = Math.PI / 2; yc.position.set(yx0 + FLOOR_W / 4, 10.54, yz0 + FLOOR_D / 4); walkCeil.add(yc);
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.04, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff }), 400), o = new THREE.Object3D();
  const W = new THREE.Color(0xf8fafc), Y = new THREE.Color(0xffc23d); let n = 0;
  for (let x = -FLOOR_W / 2 + 4; x < FLOOR_W / 2 - 2 && n < 400; x += 6) for (let zz = FLOOR_Z - FLOOR_D / 2 + 3; zz < FLOOR_Z + FLOOR_D / 2 - 2 && n < 400; zz += 4.8) {
    o.position.set(x, 10.5, zz); o.updateMatrix(); lamps.setMatrixAt(n, o.matrix); lamps.setColorAt(n, inYellow(x, zz) ? Y : W); n++; }
  lamps.count = n; walkCeil.add(lamps);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) {                // 黃光區裡的黃色燈光（只在人員視角開）
    const L = new THREE.PointLight(0xffb52e, 1.8, 38, 1.4);
    L.position.set(yx0 + FLOOR_W / 2 * (i + 0.5) / 3, 9.5, yz0 + FLOOR_D / 2 * (k + 0.5) / 2); walkCeil.add(L);
  }
  walkCeil.visible = false; scene.add(walkCeil); return walkCeil;
}
// 鏡頭朝向；controls.target 放在前方 8 m（陰影範圍、遠近模型切換都用它當中心）
function walkAim() {
  camera.rotation.set(WALK.pitch, WALK.yaw, 0);
  const fx = -Math.sin(WALK.yaw), fz = -Math.cos(WALK.yaw);
  controls.target.set(camera.position.x + fx * 8, WALK.eye, camera.position.z + fz * 8);
}
function walkStep(dist, side) {                                            // 往前 dist、往右 side（公尺），撞到東西就沿著邊滑過去
  const fx = -Math.sin(WALK.yaw), fz = -Math.cos(WALK.yaw), rx = -fz, rz = fx;
  const mx = fx * dist + rx * side, mz = fz * dist + rz * side, p = camera.position;
  if (!walkBlocked(p.x + mx, p.z + mz)) { p.x += mx; p.z += mz; }
  else if (!walkBlocked(p.x + mx, p.z)) p.x += mx;
  else if (!walkBlocked(p.x, p.z + mz)) p.z += mz;
}
function walkTick(dt) {
  const k = WALK.keys, sp = (k.has('shift') ? 3.6 : 1.4) * Math.min(dt, 0.1);   // 走路 1.4 m/s、快走 3.6 m/s
  const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
  const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
  if (f || s) walkStep(f * sp, s * sp);
  camera.position.y = WALK.eye;
  walkAim();
}
{
  const typing = e => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;
  window.addEventListener('keydown', e => {
    if (!walkOn || typing(e)) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') { exitWalk(); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) { WALK.keys.add(key); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => WALK.keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => WALK.keys.clear());               // 切到別的視窗時不要一直往前走
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => { if (walkOn && e.button === 0) WALK.drag = [e.clientX, e.clientY]; });
  window.addEventListener('pointermove', e => {
    if (!walkOn || !WALK.drag) return;
    WALK.yaw -= (e.clientX - WALK.drag[0]) * 0.004; WALK.pitch = Math.max(-1.2, Math.min(1.35, WALK.pitch - (e.clientY - WALK.drag[1]) * 0.004));
    WALK.drag = [e.clientX, e.clientY];
  });
  window.addEventListener('pointerup', () => { WALK.drag = null; });
  cv.addEventListener('wheel', e => { if (!walkOn) return; e.preventDefault(); walkStep(e.deltaY < 0 ? 0.6 : -0.6, 0); }, { passive: false });
  document.getElementById('btnWalk').onclick = () => walkOn ? exitWalk() : enterWalk();
  const sf = setFollow; setFollow = function (v) { if (v && walkOn) exitWalk(); return sf(v); };   // 點到天車：回俯瞰並跟隨那台車
  const rv = document.getElementById('btnView'), rvOld = rv.onclick; rv.onclick = e => { if (walkOn) exitWalk(); rvOld(e); };
}
