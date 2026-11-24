// main.js — 每幀的視覺更新（燈號）與主迴圈

// ================== 視覺更新 ==================
const C = { red: new THREE.Color(0xef4444), off: new THREE.Color(0x000000), green: new THREE.Color(0x22c55e), amber: new THREE.Color(0xf59e0b), blue: new THREE.Color(0x3b82f6), cyan: new THREE.Color(0x22d3ee), purple: new THREE.Color(0xa855f7), white: new THREE.Color(0xe5e7eb) };
function setLed(m, c, k) { m.emissive.copy(c); m.emissiveIntensity = k; }
function updateVisuals(t) {
  const pulse = 0.55 + 0.45 * Math.sin(t * 6);
  for (const p of ports) {
    const f = p.foup;
    if (p.lcLeds) {                                                          // 光閘燈條：平常綠、被遮斷紅（閃）
      const blocked = p.curtain > simTime;
      for (const l of p.lcLeds) setLed(l, blocked ? C.red : C.green, blocked ? 1.6 * pulse + 0.4 : 0.9);
    }
    if (p.owner.down || p.seg.blocked) setLed(p.ledMat, C.red, 1.4 * pulse);     // 機台當機／區段封鎖：紅燈閃
    else if (p.e84) setLed(p.ledMat, C.cyan, 1.8 * (0.5 + 0.5 * Math.sin(t * 14)));   // E84 交握中：青燈快閃
    else if (p.reserved && !f) setLed(p.ledMat, C.blue, 1.2);
    else if (!f) setLed(p.ledMat, C.off, 0);
    else if (['docking','processing','undocking'].includes(f.state)) setLed(p.ledMat, C.green, 1.1);
    else if (f.state === 'ready') setLed(p.ledMat, C.amber, 1.4 * pulse);
    else if (f.state === 'ntbOut') setLed(p.ledMat, C.amber, 1.4 * pulse);
    else if (f.state === 'buffered') setLed(p.ledMat, C.purple, 1.2);
    else setLed(p.ledMat, C.off, 0);
  }
  ledBanks.forEach(b => b.sync());                                   // 合併後的指示燈寫回顏色
  for (const m of machines) {
    const run = m.ports.some(p => p.foup && ['docking','processing','undocking'].includes(p.foup.state));
    const wait = m.ports.some(p => p.foup && p.foup.state === 'ready');
    if (m.down) { m.lights[0].emissiveIntensity = 1.8 * pulse; m.lights[1].emissiveIntensity = m.lights[2].emissiveIntensity = 0.05; continue; }  // 當機：紅燈閃
    m.lights[2].emissiveIntensity = run ? 1.6 : 0.05;
    m.lights[1].emissiveIntensity = wait ? 1.6 * pulse : 0.05;
    m.lights[0].emissiveIntensity = (!run && !wait) ? 0.9 : 0.05;
  }
  const cam = camera.position;
  vehicles.forEach((v, i) => {
    // 近的畫完整細節，遠的只畫簡化外形（被跟隨的車和透視模式一律完整）
    const near = xray || v === followed || cam.distanceTo(v.group.position) < GFX.lod;
    placeVehicle(v, near); v.group.visible = near;
    // 狀態燈（照現場天車）：白＝待機、綠＝有任務或行駛中、綠燈閃＝取放貨中、紫燈閃＝前方有東西停車
    const blink = Math.sin(t * 9) > 0 ? 1.8 : 0.12;
    const transferring = TRANSFERRING.includes(v.state);
    const moving = ['idle', 'toPick', 'toDrop', 'toMaint'].includes(v.state);
    let ledC = C.green, ledK = 1.6;
    if (transferring) ledK = blink;                                                   // 取放貨：綠燈閃
    else if (moving && v.v < 0.05 && v.gapAhead < 1.5) { ledC = C.purple; ledK = blink; }   // 前方有車／障礙停車：紫燈閃
    else if (v.state === 'idle' && !v.job && v.v < 0.05) { ledC = C.white; ledK = 1.1; }  // 待機（沒任務、停著）：白燈
    const lt = v.id + (v.job && v.job.pri ? ' ' + PRI_NAME[v.job.pri] : '');   // 名牌：載急件／特急的車標出來
    if (v.labelText !== lt) { v.labelText = lt; v.label.userData.draw(lt); }
    if (v.offline && !v.job && !v.fault && ledC !== C.purple) { ledC = C.white; ledK = 0.45; }   // 下線（沒有任務）：暗白色
    if (v.manual && !v.fault) { ledC = C.amber; ledK = 1.4; }                              // 手動模式：黃燈
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
  curtainTick(t);
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
// 畫質：限制每秒畫面數、陰影更新頻率、量 FPS（「自動」太慢時往下降一級）
let gfxFrame = 0, gfxLast = 0, fpsN = 0, fpsT = 0, fpsLow = 0;
// 閒置時降速：15 秒沒有滑鼠、鍵盤、觸控 → 模擬執行中每秒 20 張、暫停中每秒 5 張；一有操作馬上恢復
function idleFps(now) {
  if (!IDLE.on || now - IDLE.last < IDLE.ms) return 0;
  if (walkOn || TOUR.on || e84Demo) return 0;          // 導覽、人員視角、E84 動畫時不降
  return paused ? 5 : 20;
}
function gfxTick(now) {
  const L = GFX_LEVELS[GFX.level], cap = Math.min(L.fps || 999, idleFps(now) || 999);
  const iv = cap < 999 ? 1000 / cap : 0;
  if (iv && now - gfxLast < iv - 2) return false;                          // 省電最多 30 FPS；閒置時再往下降
  gfxLast = iv ? Math.max(gfxLast + iv, now - iv) : now;                   // 用固定間隔往前推，平均剛好是上限（不會因為螢幕更新率對不齊掉成一半）
  gfxFrame++; if (!fpsT) fpsT = now;
  renderer.shadowMap.needsUpdate = L.every > 0 && gfxFrame % L.every === 0;
  if (renderer.shadowMap.needsUpdate) fitShadow();
  fpsN++; if (now - fpsT >= 1000) {
    GFX.fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now;
    const el = document.getElementById('gfxFps'); if (el) el.textContent = `${GFX.fps} FPS（${GFX_LEVELS[GFX.level].name}${idleFps(now) ? '・閒置' : ''}）`;
    // 自動：開場 5 秒後，連續 4 秒低於 25 FPS 就降一級（只降不升，避免一直跳）
    if (GFX.pref === 'auto' && now > 5000 && GFX.level !== 'low' && !document.hidden && !idleFps(now) && GFX.fps < 25) {   // 閒置降速時不算卡
      if (++fpsLow >= 4) { fpsLow = 0; const nx = GFX.level === 'high' ? 'mid' : 'low'; applyGfx(nx, `🖥 畫面太卡（${GFX.fps} FPS），畫質自動降為「${GFX_LEVELS[nx].name}」`); }
    } else fpsLow = 0;
  }
  return true;
}
function loop(now) {
  requestAnimationFrame(loop);
  if (!gfxTick(now || performance.now())) return;
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!paused) {
    const sd = dt * speed, n = Math.max(1, Math.ceil(sd / 0.04)), h = sd / n;
    for (let i = 0; i < n; i++) {
      simTime += h; stepPorts(h); ntbTick(h); stepVehicles(h); commTick(h); hmiTick(h); eventTick();
      dispT += h; if (dispT >= 0.5) { dispT = 0; dispatch(); }
    }
  }
  if (e84Demo) e84DemoTick();
  pioVisuals(clock.elapsedTime);                                   // E84 PIO 燈號、光束（要在 updateVisuals 前，燈號一起寫回）
  updateVisuals(clock.elapsedTime);
  alarmTick(paused ? 0 : dt * speed);
  updateLabelLod(dt);
  if (walkOn) walkTick(dt);                                             // 人員視角：自己控制鏡頭
  else {
    if (followed) {
      followed.group.getWorldPosition(tmp); tmp.y -= 1.5;
      tmp.sub(controls.target); controls.target.add(tmp); camera.position.add(tmp);
    }
    controls.update();
  }
  renderer.render(scene, camera);
  uiT += dt; if (uiT > 0.25) { uiT = 0; updateUI(); }
}
eventTick();
log('模擬開始：' + vehicles.length + ' 台天車上線');
if (BENCH) benchRun(); else { applyGfx(GFX.level, GFX.pref === 'auto' && GFX.weak ? `🖥 偵測到內建顯示卡，畫質自動用「${GFX_LEVELS[GFX.level].name}」（可在「控制」分頁調整）` : ''); updateUI(); requestAnimationFrame(loop); }
