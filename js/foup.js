// foup.js — FOUP 模型（琥珀橘半透明外殼、flange、握把、晶圓）、所有 FOUP 合在一起畫（instanced）、初始擺放

// ================== FOUP ==================
// 依照實際 FOUP 外觀：琥珀橘半透明外殼、後側大圓角、頂部 OHT flange、兩側握把、門上條碼、內部晶圓
// FOUP 本地座標：原點在底部中心，+x 為門（朝機台）
function foupShape(w, d, rf, rb) {
  const s = new THREE.Shape(), x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  s.moveTo(x0 + rb, y0); s.lineTo(x1 - rf, y0); s.quadraticCurveTo(x1, y0, x1, y0 + rf);
  s.lineTo(x1, y1 - rf); s.quadraticCurveTo(x1, y1, x1 - rf, y1);
  s.lineTo(x0 + rb, y1); s.quadraticCurveTo(x0, y1, x0, y1 - rb);
  s.lineTo(x0, y0 + rb); s.quadraticCurveTo(x0, y0, x0 + rb, y0); return s;
}
const FG = (() => {
  const shell = new THREE.ExtrudeGeometry(foupShape(0.62, 0.64, 0.035, 0.22),
    { depth: 0.46, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.018, bevelSegments: 3, curveSegments: 12 });
  shell.rotateX(-Math.PI / 2); shell.translate(0, 0.104, 0);   // 外殼底面比底板頂面高 4 mm：兩個面重疊會閃（Z-fighting）
  // 晶圓堆疊紋理
  const c = document.createElement('canvas'); c.width = 16; c.height = 256;
  const x = c.getContext('2d'); x.fillStyle = '#5b636c'; x.fillRect(0, 0, 16, 256);
  for (let i = 0; i < 25; i++) { x.fillStyle = '#d7dde3'; x.fillRect(0, 4 + i * 10, 16, 4); }
  const waferTex = new THREE.CanvasTexture(c); waferTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());   // 斜看晶圓堆疊時條紋比較不會糊、不會出現斜紋
  // 條碼紋理
  const b = document.createElement('canvas'); b.width = 128; b.height = 72;
  const y = b.getContext('2d'); y.fillStyle = '#f7f7f5'; y.fillRect(0, 0, 128, 72); y.fillStyle = '#111';
  for (let px = 10; px < 118;) { const w = 1 + Math.floor(Math.random() * 3); y.fillRect(px, 8, w, 40); px += w + 1 + Math.floor(Math.random() * 3); }
  y.font = '12px monospace'; y.fillText('F0UP-300', 34, 64);
  // 外殼、可動門獨立實例繪製；底座、長把手與 flange 共用合併幾何。
  const shellB = makeBatch();
  shellB.add(smoothNormals(shell, 50), 0xff5708, null, 0, 0, 0);   // 圓角、倒角用平滑法線，看起來光滑
  // FOUP 門獨立繪製，讓 FIMS 對接時能下降開門。
  const solidB = makeBatch();
  // 完整不透明底盤，封住橘色外殼底面；底緣保持平順。
  const baseShape = foupShape(.68,.70,.065,.23);

  const base = new THREE.ExtrudeGeometry(baseShape,{depth:.022,bevelEnabled:true,bevelThickness:.010,bevelSize:.012,bevelSegments:5,curveSegments:24});
  base.rotateX(-Math.PI/2);base.translate(0,.014,0);
  solidB.add(smoothNormals(base,60),0x303438,null,0,0,0);
  const floor = new THREE.ExtrudeGeometry(foupShape(.62,.64,.055,.22),{depth:.049,bevelEnabled:true,bevelThickness:.008,bevelSize:.008,bevelSegments:4,curveSegments:24});
  floor.rotateX(-Math.PI/2);floor.translate(0,.048,0);
  solidB.add(smoothNormals(floor,60),0x34383c,null,0,0,0);
  // 圓滑連續的底緣，不設外露齒塊。
  const detailB = makeBatch();
  [-1,1].forEach(k => {
    // 參考照片的寬版格柵握把：上段握持面寬，下段收成 S 形支臂。
    const gripCurve=new THREE.CatmullRomCurve3([
      new THREE.Vector3(-.10,.535,k*.012),new THREE.Vector3(-.105,.52,k*.095),new THREE.Vector3(-.11,.47,k*.16),new THREE.Vector3(-.10,.37,k*.17),new THREE.Vector3(-.085,.265,k*.16),new THREE.Vector3(-.07,.205,k*.095),new THREE.Vector3(-.065,.19,k*.012)
    ]);
    const grip=new THREE.TubeGeometry(gripCurve,32,.032,12,false);
    grip.scale(1,1,.78);grip.translate(0,0,k*.335);
    solidB.add(grip,0x25292c,null,0,0,0);
    [0,1].forEach(t=>{const q=gripCurve.getPoint(t);const end=new THREE.SphereGeometry(.041,12,8);end.scale(1,.9,.65);solidB.add(end,0x2b3034,null,q.x,q.y,k*.344);});
    for(let i=0;i<25;i++) detailB.add(new THREE.BoxGeometry(.30,.003,.025),0x783916,null,-.025,.145+i*.014,k*.265);
    detailB.add(new THREE.BoxGeometry(.018,.39,.024),0x683416,null,-.17,.32,k*.27);
    // 頂部透明盒殼的補強肋，以低矮橘紅構件呈現。
    solidB.add(new THREE.BoxGeometry(.45,.012,.012),0xda430a,null,-.015,.596,k*.205);
    solidB.add(new THREE.BoxGeometry(.014,.026,.40),0xf26513,null,k*.18,.594,0);
  });
  // 頂部夾取板中央為凹入的圓形定位槽，沒有凸起圓柱。
  solidB.add(new THREE.BoxGeometry(.13,.075,.13),0x41484d,null,0,.625,0);
  const flangeShape=foupShape(.34,.34,.025,.025);
  const recess=new THREE.Path();recess.absarc(0,0,.058,0,Math.PI*2,true);flangeShape.holes.push(recess);
  const flange = new THREE.ExtrudeGeometry(flangeShape,{depth:.022,bevelEnabled:true,bevelSize:.003,bevelThickness:.002,bevelSegments:1,curveSegments:16});
  flange.rotateX(-Math.PI/2); flange.translate(0,.662,0);solidB.add(flange,0x6e757a,null,0,0,0);
  solidB.add(new THREE.CylinderGeometry(.058,.058,.004,32),0x41484e,null,0,.661,0);
  [-1,1].forEach(x=>[-1,1].forEach(z=>detailB.add(new THREE.CylinderGeometry(.008,.008,.006,6),0x343a40,null,x*.133,.69,z*.133)));
  // 黑色圓角密封框和乳白門蓋，所有細節隨門一起移動。
  const doorB=makeBatch(),frameShape=foupShape(.63,.55,.03,.03);
  frameShape.holes.push(new THREE.Path(foupShape(.576,.498,.025,.025).getPoints(8).reverse()));
  const frame=new THREE.ExtrudeGeometry(frameShape,{depth:.014,bevelEnabled:false,curveSegments:6});
  frame.rotateY(Math.PI/2);frame.translate(.338,.335,0);doorB.add(frame,0x302c28,null,0,0,0);
  for(const sign of [-1,1]) for(let j=0;j<5;j++) doorB.add(new THREE.BoxGeometry(.009,.006,.43),0xa74310,null,.357,.335+sign*(.10+j*.026),0);
  [-1,1].forEach(k=>{const lock=new THREE.CylinderGeometry(.024,.024,.01,12);lock.rotateZ(Math.PI/2);doorB.add(lock,0x6e4b32,null,.36,.335,k*.17);doorB.add(new THREE.BoxGeometry(.012,.025,.006),0x2d2b29,null,.368,.335,k*.17);});
  const dc=document.createElement('canvas');dc.width=dc.height=256;const dx=dc.getContext('2d');
  dx.fillStyle='#a94312';dx.fillRect(0,0,256,256);dx.strokeStyle='#df7b35';dx.lineWidth=3;dx.strokeRect(11,11,234,234);
  dx.lineWidth=1;for(let i=0;i<8;i++){dx.strokeRect(28,24+i*8,200,3);dx.strokeRect(28,176+i*8,200,3);}
  const doorTex=new THREE.CanvasTexture(dc);
  return {
    shellAll: shellB.geometry(), solid: solidB.geometry(), details: detailB.geometry(), doorTrim: doorB.geometry(),
    doorMat: new THREE.MeshStandardMaterial({map:doorTex,transparent:true,opacity:.78,roughness:.28,depthWrite:false}),
    shellMat: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, emissive: 0x3d0d00, emissiveIntensity: 0.10, roughness: 0.19,
      metalness: 0, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
    solidMat: vcMat({ metalness: 0.22, roughness: .48 }), tagGeo: new THREE.BoxGeometry(0.1, 0.012, 0.1),
    wafer: new THREE.CylinderGeometry(0.235, 0.235, 0.36, 40),
    waferMat: new THREE.MeshStandardMaterial({ map: waferTex, metalness: 0.55, roughness: 0.35 }),
    gray: mat(0x6f757c, { metalness: 0.3 }), darkGray: mat(0x3a4047, { metalness: 0.4 }), baseMat: mat(0x8d939a, { metalness: 0.35 }),
    label: new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(b) }),
    labelGeo: new THREE.PlaneGeometry(0.17, 0.095),
  };
})();
const portRot = p => p.rot;   // FOUP 門的朝向（在 factory.js 依 Port 位置算好）
// ---------- 所有 FOUP 合在一起畫（InstancedMesh）----------
// 每個 FOUP 佔一個編號 idx；5 個零件（不透明部分、晶圓、外殼、條碼、批號色標）各是一個 InstancedMesh
// FOUP 放在 Port 上時位置固定；被天車吊著時，每幀依夾爪位置更新（main.js）
const FOUP_MAX = ports.length + 400;
const FB = (() => {
  const M = (x, y, z, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
  const tagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const parts = [
    [FG.solid, FG.solidMat, M(0, 0, 0), true],
    [FG.wafer, FG.waferMat, M(0.02, 0.34, 0), false],
    [FG.labelGeo, FG.label, M(.371,.335,0,Math.PI/2), false],
    [FG.tagGeo, tagMat, M(-.20,.608,0), false],
    [FG.shellAll, FG.shellMat, M(0, 0, 0), false],
    [new THREE.BoxGeometry(.026,.52,.60), FG.doorMat, M(.335,.335,0), false],
    [FG.doorTrim, FG.solidMat, M(0,0,0), false],
  ].map(([geo, material, local, cast]) => {
    const im = new THREE.InstancedMesh(geo, material, FOUP_MAX);
    im.frustumCulled = false; im.castShadow = cast; im.count = 0;
    scene.add(im); return { im, local };
  });
  parts[5].im.renderOrder = 2;
  parts[4].im.renderOrder = 2;                                           // 半透明外殼最後畫
  return { parts, tag: parts[3].im, used: 0, free: [], tmp: new THREE.Matrix4(), local: new THREE.Matrix4(), foups: new Map(), dirty: false };
})();
// 設定某個 FOUP 的世界矩陣
function setFoupMatrix(f, m) {
  FB.foups.set(f.idx,f);
  if (!f.worldMatrix) f.worldMatrix = new THREE.Matrix4(); f.worldMatrix.copy(m);
  const count = f.empty ? 0 : (f.waferCount ?? 25), open = f.doorOpen || 0;
  for (let i=0;i<FB.parts.length;i++) {
    const p = FB.parts[i]; FB.local.copy(p.local);
    if (i===1) {
      if (f.detailedWafers || count===0) FB.tmp.makeScale(0,0,0);
      else { FB.local.makeScale(1,count/25,1); FB.local.setPosition(.02,.14+.18*count/25,0); FB.tmp.multiplyMatrices(m,FB.local); }
    } else {
      if (i===2 || i===5 || i===6) { FB.local.elements[12] += open*.08; FB.local.elements[13] -= open*.57; }
      FB.tmp.multiplyMatrices(m,FB.local);
    }
    p.im.setMatrixAt(f.idx,FB.tmp);
  }
  FB.dirty = true;
}
const _fm = new THREE.Matrix4(), _fq = new THREE.Quaternion(), _fe = new THREE.Euler(), _fv = new THREE.Vector3(), _fs = new THREE.Vector3(1, 1, 1);
function placeFoupAt(f, port) {
  f.rot = portRot(port);
  _fm.compose(_fv.set(port.x + Math.cos(port.rot)*(port.dock || 0)*.25, port.top, port.z - Math.sin(port.rot)*(port.dock || 0)*.25), _fq.setFromEuler(_fe.set(0, f.rot, 0)), _fs);
  setFoupMatrix(f, _fm);
}
// 每幀：被吊著的 FOUP 跟著夾爪走；有改動才通知 GPU 更新
const _carryLocal = new THREE.Matrix4();
function updateFoupInstances() {
  for (const v of vehicles) if (v.carry) {
    const f = v.carry;
    v.group.updateMatrixWorld(true);
    _carryLocal.compose(_fv.set(0, -FOUP_OFF, 0), _fq.setFromEuler(_fe.set(0, f.localRot, 0)), _fs);
    _fm.multiplyMatrices(v.gripper.matrixWorld, _carryLocal);
    setFoupMatrix(f, _fm);
  }
  updateDetailedWafers();
  if (FB.dirty) {
    for (const p of FB.parts) { p.im.count = FB.used; p.im.instanceMatrix.needsUpdate = true; }
    if (FB.tag.instanceColor) FB.tag.instanceColor.needsUpdate = true;
    FB.dirty = false;
  }
}
// 批號色標：一般 Lot 隨機顏色；急件橘色、特急紅色（一眼就看得出來）
function setFoupTag(f) {
  FB.tag.setColorAt(f.idx, f.empty ? new THREE.Color(0x22d3ee) : f.pri === 2 ? new THREE.Color(0xff1f1f) : f.pri === 1 ? new THREE.Color(0xff8a00) : new THREE.Color().setHSL(0.45 + Math.random() * 0.25, 0.25, 0.75));
  if (FB.tag.instanceColor) FB.tag.instanceColor.needsUpdate = true;
}
function spawnFoup(port, state, empty = false) {
  const idx = FB.free.length ? FB.free.pop() : FB.used++;
  const f = { empty, id: 'LOT' + String(++foupSeq).padStart(4, '0'), idx, state, timer: 0, job: null, port, carrier: null, rot: 0, localRot: 0 };
  const r = rndD(); f.pri = r < 0.03 ? 2 : r < 0.15 ? 1 : 0;              // 約 12% 急件、3% 特急
  if (empty) f.pri = 0;
  setFoupTag(f);
  placeFoupAt(f, port);
  if (state === 'processing') f.timer = procTime * (0.2 + rndD());
  port.foup = f; return f;
}
machines.forEach(m => m.ports.forEach(p => { if (rndD() < 0.55) spawnFoup(p, 'processing'); }));
// 洗牌後依比例放貨，確保開場佔用率接近設定值，且不集中於前幾條 Bay。
const initialStbs = ports.filter(p => p.owner.type === 'stb');
for (let i = initialStbs.length - 1; i > 0; i--) { const j = Math.floor(rndD() * (i + 1)); [initialStbs[i], initialStbs[j]] = [initialStbs[j], initialStbs[i]]; }
initialStbs.slice(0, Math.round(initialStbs.length * STB_INITIAL_FILL / 100)).forEach(p => {
  const f = spawnFoup(p, 'buffered', rndD() < 0.15); f.timer = rndD() * STB_DWELL;
});
// 近看才使用獨立晶圓：最多 32 個 FOUP × 25 片，共用一個 InstancedMesh。
const waferDetail = (() => {
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(.235,.235,.003,36),FG.waferMat,32*25);
  mesh.count=0; mesh.frustumCulled=false; mesh.castShadow=false; scene.add(mesh);
  const details = new THREE.InstancedMesh(FG.details,FG.solidMat,32); details.count=0;details.frustumCulled=false;details.castShadow=false;scene.add(details);
  return {mesh, details, selected:[], time:-Infinity, local:new THREE.Matrix4(), world:new THREE.Matrix4(), zero:new THREE.Matrix4().makeScale(0,0,0)};
})();
function updateDetailedWafers() {
  if (BENCH) return;
  const bank=waferDetail, now=performance.now(), power=GFX.level==='power' || GFX.level==='low';
  if (now-bank.time > 250) {
    bank.time=now;
    const radius = GFX.level==='high' ? 28 : 18;
    const candidates = power ? [] : [...FB.foups.values()].filter(f=>!['cart','outside'].includes(f.state) && f.worldMatrix && f.worldMatrix.elements[15]!==0)
      .map(f=>({f,d:Math.hypot(f.worldMatrix.elements[12]-camera.position.x,f.worldMatrix.elements[13]-camera.position.y,f.worldMatrix.elements[14]-camera.position.z)}))
      .filter(o=>o.d<radius).sort((a,b)=>a.d-b.d).slice(0,32).map(o=>o.f);
    const next=new Set(candidates), previous=new Set(bank.selected);
    for (const f of bank.selected) if (!next.has(f)) {f.detailedWafers=false;setFoupMatrix(f,f.worldMatrix);}
    for (const f of candidates) if (!previous.has(f)) {f.detailedWafers=true;setFoupMatrix(f,f.worldMatrix);}
    bank.selected=candidates;
  }
  let n=0, detailCount=0;
  for (const f of bank.selected) {
    bank.details.setMatrixAt(detailCount++,f.worldMatrix);
    const count=f.empty?0:(f.waferCount??25), transfer=f.waferTransfer;
    for(let i=0;i<25;i++) {
      if (i<count || (transfer && transfer.index===i)) {
        bank.local.makeTranslation(.02+(transfer && transfer.index===i?transfer.x:0),.145+i*.014,0);
        bank.world.multiplyMatrices(f.worldMatrix,bank.local); bank.mesh.setMatrixAt(n++,bank.world);
      }
    }
  }
  bank.details.count=detailCount;if(detailCount) bank.details.instanceMatrix.needsUpdate=true;
  bank.mesh.count=n; if(n) bank.mesh.instanceMatrix.needsUpdate=true;
}
