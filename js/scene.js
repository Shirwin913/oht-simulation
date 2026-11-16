// scene.js — Three.js 場景、相機、燈光、地板，以及共用的建模工具（mat / box / makeLabel）

// ================== 場景 ==================
const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1419);
scene.fog = new THREE.Fog(0x0f1419, 260, 520);
// ================== 畫質 ==================
// 沒有獨立顯卡（內顯）的電腦會卡：自動偵測顯示卡，內顯一開始就用「標準」；
// 「自動」模式下如果實際每秒畫面數還是太低，會再往下降一級。也可以在「控制」分頁手動選。
const GFX_LEVELS = {
  high: { name: '高',   pr: 2,    shadow: 4096, soft: true,  every: 1, lod: 45, fps: 0 },    // 陰影每幀更新、完整細節
  mid:  { name: '標準', pr: 1.25, shadow: 2048, soft: false, every: 3, lod: 30, fps: 0 },    // 解析度、陰影降一級，陰影每 3 幀更新
  low:  { name: '省電', pr: 1,    shadow: 0,    soft: false, every: 0, lod: 18, fps: 30 },   // 關陰影、近看細節範圍縮小、最多 30 FPS
};
const GFX = (() => {
  let pref = 'auto'; try { pref = localStorage.getItem('ohtGfx') || 'auto'; } catch (e) {}
  if (pref !== 'auto' && !GFX_LEVELS[pref]) pref = 'auto';
  let gpu = '', weak = false;
  if (!BENCH) try {
    const gl = document.createElement('canvas').getContext('webgl'), ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    weak = /Intel|UHD|Iris|HD Graphics|Microsoft Basic|SwiftShader|llvmpipe|Mali|Adreno|PowerVR|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d/i.test(gpu)
      && !/RTX|GTX|Quadro|Radeon RX|Radeon Pro|Arc\(TM\) A|Arc A/i.test(gpu);
    const lc = gl && gl.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext();
  } catch (e) {}
  return { pref, gpu, weak, level: pref === 'auto' ? (weak ? 'mid' : 'high') : pref, lod: 45, fps: 0, drops: 0 };
})();
// 比較實驗（背景執行）不需要畫面：用一個什麼都不畫的假 renderer，省掉 WebGL
const renderer = BENCH ? { domElement: document.createElement('canvas'), setPixelRatio() {}, setSize() {}, render() {}, shadowMap: {} }
  : new THREE.WebGLRenderer({ antialias: !GFX.weak && GFX.level === 'high', powerPreference: 'high-performance' });   // 反鋸齒在內顯上很吃效能
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;   // 陰影由主迴圈依畫質決定多久更新一次
app.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 900);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
function resetView() { camera.position.set(-15, 125, 125); controls.target.set(0, 1, 2); }
resetView();
function resize() { const w = app.clientWidth, h = app.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3440, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(25, 60, 20); sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -92, right: 92, top: 58, bottom: -58, near: 1, far: 170 });
scene.add(sun);

function applyGfx(level, why) {
  const L = GFX_LEVELS[level]; if (!L) return; GFX.level = level; GFX.lod = L.lod;
  if (BENCH) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, L.pr)); resize();
  const wasShadow = sun.castShadow, wasSoft = renderer.shadowMap.type === THREE.PCFSoftShadowMap;
  sun.castShadow = L.shadow > 0;
  if (L.shadow && sun.shadow.mapSize.x !== L.shadow) { sun.shadow.mapSize.set(L.shadow, L.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  renderer.shadowMap.type = L.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if (wasShadow !== sun.castShadow || wasSoft !== L.soft)                      // 陰影開關、種類改了：材質要重新編譯
    scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
  renderer.shadowMap.needsUpdate = true;
  if (why && typeof log === 'function') log(why);
  const sel = document.getElementById('gfxLevel'); if (sel) sel.value = GFX.pref;
}

const mat = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.15 }, o));
function box(w, h, d, color, o) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), color instanceof THREE.Material ? color : mat(color, o));
  m.castShadow = true; m.receiveShadow = true; return m;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function makeLabel(text, { bg = 'rgba(15,20,28,.85)', fg = '#e6edf3', scale = 1, w = 256 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = 72;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.4 * scale * w / 256, 0.675 * scale, 1);
  sp.userData.draw = t => {
    ctx.clearRect(0, 0, w, 72); ctx.fillStyle = bg; roundRect(ctx, 4, 4, w - 8, 64, 14); ctx.fill();
    ctx.fillStyle = fg; ctx.font = 'bold 34px system-ui, "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, w / 2, 38); tex.needsUpdate = true;
  };
  sp.userData.draw(text); return sp;
}
const labels = [];

// 地板（高架地板）
const FLOOR_W = 180, FLOOR_D = 112, FLOOR_Z = 0;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, FLOOR_D), mat(0x39424d, { roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.position.z = FLOOR_Z; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(FLOOR_W, FLOOR_W, 0x4a5561, 0x434d58); grid.position.set(0, 0.01, FLOOR_Z);
grid.scale.z = FLOOR_D / FLOOR_W; scene.add(grid);

// 透視模式：把外殼材質變半透明，看得到裡面的機構
function setXrayMat(m, on) {
  m.transparent = on; m.opacity = on ? 0.18 : 1; m.depthWrite = !on; m.needsUpdate = true;
}

// ================== 合併靜態物件（場景大時減少繪圖次數，才不會卡）==================
// 把很多小幾何（各自有位置、顏色）合併成一個幾何，顏色存在頂點上
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
function makeBatch() {
  const items = [];
  const api = {
    // 加一個幾何：在群組 g 的區域座標 (x,y,z)，可轉角 ry、垂直縮放 sy；g 為 null 表示世界座標
    add(geo, color, g, x, y, z, ry = 0, sy = 1) {
      const m = new THREE.Matrix4().compose(_v3.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s3.set(1, sy, 1));
      if (g) { g.updateMatrixWorld(true); m.premultiply(g.matrixWorld); }
      items.push([geo, m, new THREE.Color(color)]);
    },
    geometry() {
      let n = 0;
      const parts = items.map(([geo, m, c]) => { const g2 = geo.index ? geo.toNonIndexed() : geo.clone(); g2.applyMatrix4(m); n += g2.attributes.position.count; return [g2, c]; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
      let o = 0;
      parts.forEach(([g2, c]) => {
        const cnt = g2.attributes.position.count;
        pos.set(g2.attributes.position.array, o * 3); nor.set(g2.attributes.normal.array, o * 3);
        for (let i = 0; i < cnt; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
        o += cnt; g2.dispose();
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return geo;
    },
    build(material, cast = true) {
      const mesh = new THREE.Mesh(api.geometry(), material);
      mesh.castShadow = cast; mesh.receiveShadow = true; scene.add(mesh); return mesh;
    },
  };
  return api;
}
const vcMat = (o = {}) => mat(0xffffff, Object.assign({ vertexColors: true }, o));

// 很多顆指示燈合併成一個 InstancedMesh；每顆燈給一個「假材質」{ emissive, emissiveIntensity }，
// 程式照常改它的顏色，每幀再用 sync() 把顏色寫進 InstancedMesh
const ledBanks = [], LED_OFF = new THREE.Color(0x2b323a), _lc = new THREE.Color();
function makeLedBank(geo) {
  const list = [];
  const bank = {
    add(g, x, y, z) {
      g.updateMatrixWorld(true);
      const led = { emissive: new THREE.Color(0), emissiveIntensity: 0, m: new THREE.Matrix4().makeTranslation(x, y, z).premultiply(g.matrixWorld) };
      list.push(led); return led;
    },
    build() {
      bank.im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, list.length));
      bank.im.frustumCulled = false;   // three.js r128 的 InstancedMesh 只用原點附近的包圍球判斷要不要畫，地圖大時會整批消失
      list.forEach((l, i) => { bank.im.setMatrixAt(i, l.m); bank.im.setColorAt(i, LED_OFF); });
      scene.add(bank.im);
    },
    sync() {
      if (!bank.im) return;
      list.forEach((l, i) => {
        if (l.emissiveIntensity < 0.05) _lc.copy(LED_OFF); else _lc.copy(l.emissive).multiplyScalar(Math.min(1.3, 0.35 + l.emissiveIntensity * 0.6));
        bank.im.setColorAt(i, _lc);
      });
      if (bank.im.instanceColor) bank.im.instanceColor.needsUpdate = true;
    },
  };
  ledBanks.push(bank); return bank;
}
