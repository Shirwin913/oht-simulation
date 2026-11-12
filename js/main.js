// main.js — 每幀的視覺更新（燈號）與主迴圈

// ================== 視覺更新 ==================
const C = { red: new THREE.Color(0xef4444), off: new THREE.Color(0x000000), green: new THREE.Color(0x22c55e), amber: new THREE.Color(0xf59e0b), blue: new THREE.Color(0x3b82f6), cyan: new THREE.Color(0x22d3ee), purple: new THREE.Color(0xa855f7), white: new THREE.Color(0xe5e7eb) };
function setLed(m, c, k) { m.emissive.copy(c); m.emissiveIntensity = k; }
function updateVisuals(t) {
  const pulse = 0.55 + 0.45 * Math.sin(t * 6);
  for (const p of ports) {
    const f = p.foup;
    if (p.owner.down || p.seg.blocked) setLed(p.ledMat, C.red, 1.4 * pulse);     // 機台當機／區段封鎖：紅燈閃
    else if (p.e84) setLed(p.ledMat, C.cyan, 1.8 * (0.5 + 0.5 * Math.sin(t * 14)));   // E84 交握中：青燈快閃
    else if (p.reserved && !f) setLed(p.ledMat, C.blue, 1.2);
    else if (!f) setLed(p.ledMat, C.off, 0);
    else if (f.state === 'processing') setLed(p.ledMat, C.green, 1.1);
    else if (f.state === 'ready') setLed(p.ledMat, C.amber, 1.4 * pulse);
    else if (f.state === 'buffered') setLed(p.ledMat, C.purple, 1.2);
    else setLed(p.ledMat, C.off, 0);
  }
  ledBanks.forEach(b => b.sync());                                   // 合併後的指示燈寫回顏色
  for (const m of machines) {
    const run = m.ports.some(p => p.foup && p.foup.state === 'processing');
    const wait = m.ports.some(p => p.foup && p.foup.state === 'ready');
    if (m.down) { m.lights[0].emissiveIntensity = 1.8 * pulse; m.lights[1].emissiveIntensity = m.lights[2].emissiveIntensity = 0.05; continue; }  // 當機：紅燈閃
    m.lights[2].emissiveIntensity = run ? 1.6 : 0.05;
    m.lights[1].emissiveIntensity = wait ? 1.6 * pulse : 0.05;
    m.lights[0].emissiveIntensity = (!run && !wait) ? 0.9 : 0.05;
  }
  const cam = camera.position;
  vehicles.forEach((v, i) => {
    // 近的畫完整細節，遠的只畫簡化外形（被跟隨的車和透視模式一律完整）
    const near = xray || v === followed || cam.distanceTo(v.group.position) < LOD_DIST;
    placeVehicle(v, near); v.group.visible = near;
    // LED 燈條：綠＝行走／閒置，黃（閃）＝吊掛作業中
    const hoisting = !['idle', 'toPick', 'toDrop', 'toMaint'].includes(v.state);
    let ledC = hoisting ? C.amber : C.green, ledK = hoisting ? 1.6 * pulse : (v.state === 'idle' ? 0.8 : 1.6);
    if (v.state === 'idle' && v.parked) ledK = 0.25;                     // 休息中：綠燈調暗
    const lt = v.id + (v.job && v.job.pri ? ' ' + PRI_NAME[v.job.pri] : '');   // 名牌：載急件／特急的車標出來
    if (v.labelText !== lt) { v.labelText = lt; v.label.userData.draw(lt); }
    if (v.offline && !v.job && !v.fault) { ledC = C.white; ledK = 0.35; }   // 下線（沒有任務）：暗白色
    if (v.state === 'toMaint' || MAINT_STATES.includes(v.state)) { ledC = C.cyan; ledK = v.state === 'repair' ? 1.2 : 1.6 * pulse; }   // 維修區：青色
    if (v.fault) { ledC = C.red; ledK = 1.8 * pulse; }                // 異常：紅燈閃
    if (near) {
      v.topMat.emissiveIntensity = v === followed ? 0.45 : 0;
      setLed(v.ledMat, ledC, ledK);
      VP.hide(i);
    } else {
      VP.set(i, v);
      VP.led.setColorAt(i, VP.c.copy(ledC).multiplyScalar(Math.min(1.2, 0.3 + ledK * 0.55)));
    }
  });
  VP.finish(vehicles.length);
  updateFoupInstances();
  updateMaintVisuals(t);
  updateCommVisuals(t);
}
// 機台名牌：只在鏡頭附近顯示（每 0.3 秒判斷一次）
let labelT = 0;
function updateLabelLod(dt) {
  labelT += dt; if (labelT < 0.3) return; labelT = 0;
  const cam = camera.position;
  for (const l of machineLabels) l.visible = showLabels && cam.distanceTo(l.userData.wp) < 55;
}


// ================== 主迴圈 ==================
const clock = new THREE.Clock();
let uiT = 0, dispT = 0;
const tmp = new THREE.Vector3();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!paused) {
    const sd = dt * speed, n = Math.max(1, Math.ceil(sd / 0.04)), h = sd / n;
    for (let i = 0; i < n; i++) {
      simTime += h; stepPorts(h); stepVehicles(h); commTick(h);
      dispT += h; if (dispT >= 0.5) { dispT = 0; dispatch(); }
    }
  }
  updateVisuals(clock.elapsedTime);
  alarmTick(paused ? 0 : dt * speed);
  updateLabelLod(dt);
  if (followed) {
    followed.group.getWorldPosition(tmp); tmp.y -= 1.5;
    tmp.sub(controls.target); controls.target.add(tmp); camera.position.add(tmp);
  }
  controls.update();
  renderer.render(scene, camera);
  uiT += dt; if (uiT > 0.25) { uiT = 0; updateUI(); }
}
log('模擬開始：' + vehicles.length + ' 台天車上線');
updateUI(); loop();
