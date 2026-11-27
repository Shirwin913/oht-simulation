// traveldemo.js — 走行與分岔 3D 示範（原本只在 travel-demo.html，現在嵌進「看軌道」教學視窗的一章；travel-demo.html 也改用這支）
// createTravelDemo(root)：在 root 裡放控制列＋3D 畫面，回傳 { dispose }。
// 只在畫面有變化時才畫（不跑常駐迴圈），離開這一章／關掉視窗就 dispose() 釋放 WebGL，不會多吃 GPU。
// 走行機構模型（OHTTravelModel）跟全廠模擬共用 travel_mechanism.js；軌道與導軌位置是示意，不是製造尺寸。
function createTravelDemo(root, opts = {}) {
  // opts.controls === false：不顯示播放控制列（給教學章節用 set() 一步步帶），只留上手／下手燈號
  const T = THREE;
  root.classList.add('td3d');
  root.innerHTML = `<div class="tdctl">
      <label>分岔路線 <select data-td="route"><option value="turn">走彎軌那條（支線）· 下手</option><option value="straight">不跟彎軌（直行）· 上手</option></select></label>
      <button data-td="play" class="pri">▶ 播放路線</button>
      <label class="tdprog">進度 <input data-td="prog" type="range" min="0" max="1000" value="0"></label>
      <label>視角 <select data-td="view"><option value="iso">立體</option><option value="front">正視</option><option value="top">俯視</option><option value="side">側視</option></select></label>
      <label><input data-td="rail" type="checkbox" checked> 透明軌道</label>
      <span class="tdhand"><i data-hand="1" title="點一下切換成上手">上手</i><i data-hand="0" title="點一下切換成下手">下手</i><i data-body title="顯示／隱藏走行部下面吊著的車廂">車廂</i></span>
    </div>
    <div class="tdcanvas" role="img" aria-label="走行部與山形換手機構的 3D 示意，可拖曳旋轉、滾輪縮放"></div>
    <div class="tdfoot"><span class="tdstatus" aria-live="polite"></span><span class="tdmut">拖曳旋轉 · 滾輪縮放 · 模型與全廠共用 · 傳動與尺寸為示意</span></div>`;
  const $ = k => root.querySelector(`[data-td="${k}"]`), host = root.querySelector('.tdcanvas'), status = root.querySelector('.tdstatus');

  // ---------- 場景 ----------
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(36, 1, .01, 50);
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputEncoding = T.sRGBEncoding; host.append(renderer.domElement);
  scene.add(new T.HemisphereLight(0xffffff, 0x646464, .85));
  const key = new T.DirectionalLight(0xffffff, 1); key.position.set(3, 5, 4); scene.add(key);
  const back = new T.DirectionalLight(0xffffff, .6); back.position.set(-3, 2, -3); scene.add(back);
  const metal = new T.MeshStandardMaterial({ color: 0xaab2ba, metalness: .4, roughness: .5 });
  const railMat = new T.MeshStandardMaterial({ color: 0xb7c9d4, transparent: true, opacity: .16, depthWrite: false, side: T.DoubleSide });
  const own = [metal, railMat];   // 自己建的材質／幾何，dispose 時一起釋放（走行機構模型的幾何是共用的，不在這裡釋放）

  const units = [OHTTravelModel.create(.42), OHTTravelModel.create(-.42)];   // 前、後兩組走行部
  units.forEach(u => scene.add(u));
  const box = (parent, w, h, d, material, x = 0, y = 0, z = 0) => { const g = new T.BoxGeometry(w, h, d), m = new T.Mesh(g, material); own.push(g); m.position.set(x, y, z); parent.add(m); return m; };

  let p = 1, yaw = .70, pitch = .48, distance = 2.5, focusZ = 0, focusX = 0, drag = null, dead = false;
  const setPose = () => { for (const u of units) OHTTravelModel.setHand(u, p); };
  function render() {
    if (dead || !renderer.domElement.isConnected) return;
    const fy = showBody ? -.45 : .30, dist = distance * (showBody ? 1.8 : 1);   // 有車廂時鏡頭拉遠、看的位置往下
    camera.position.set(focusX + Math.sin(yaw) * Math.cos(pitch) * dist, fy + Math.sin(pitch) * dist, focusZ + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(focusX, fy, focusZ); renderer.render(scene, camera);
  }

  // ---------- 軌道：轉彎路線（直線接 R=2 的 90° 彎）＋直行路線，同一個開放的槽 ----------
  const turnRail = new T.Group(); scene.add(turnRail);
  const R = 2, path = (s, curved = true) => !curved || s <= 0 ? { x: 0, z: s, a: 0 } : s < R * Math.PI / 2 ? { x: R - R * Math.cos(s / R), z: R * Math.sin(s / R), a: s / R } : { x: R + s - R * Math.PI / 2, z: R, a: Math.PI / 2 };
  // 軌道斷面（跟全廠模擬 track.js 同一個，這裡用「斷面單位」＝世界尺寸 ÷ 0.52、高度再平移）：
  //   外寬 ±0.31 m、頂 0.302、內壁 ±0.287、天花板 0.284、底部內翻邊 -0.12～-0.15、中間的縫 ±0.174（下導輪貼著縫邊）
  const U = v => v / .52, Y = y => (y + .122) / .52;
  const RAW = [[-.31, .302], [.31, .302], [.31, -.15], [.174, -.15], [.174, -.12], [.287, -.12], [.287, .284], [-.287, .284], [-.287, -.12], [-.174, -.12], [-.174, -.15], [-.31, -.15]].map(([x, y]) => [U(x), Y(y)]);
  const BOT = Y(-.11);                                                   // 這個高度以下算底板
  const sub = (p, q, n) => Array.from({ length: n }, (_, i) => [p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n]);
  const profile = RAW.flatMap((p, k) => { const q = RAW[(k + 1) % RAW.length]; return p[1] < BOT && q[1] < BOT ? sub(p, q, Math.max(1, Math.ceil(Math.abs(q[0] - p[0]) / .08))) : [p]; });
  // 另一條路線的中心線離 (x, z)（斷面單位）多遠：轉彎路線只看直線；直行路線只看彎出去的那段（s > 0，前面那段兩條重疊、只畫一次）
  const otherDist = (x, z, curved) => {
    if (curved) return z >= -3 && z <= 5.2 ? Math.abs(x) : Infinity;
    let m = Infinity;
    if (x <= R && z >= 0) m = Math.min(m, Math.abs(Math.hypot(x - R, z) - R));
    if (x >= R) m = Math.min(m, Math.abs(z - R));
    return m;
  };
  // 照全廠的做法：彎道和交會段是白色板件、直軌是鋁擠型；交會處兩條合成一片 ——
  //   側壁落在另一條路線的槽或板件裡就讓開，底板落在另一條路線的縫裡也讓開（吊臂要從這裡過）
  function sweep(prof, mat, curved = true, startDistance = -3, endDistance = 5.2, cut = false) {
    const verts = [];
    const ring = s => { const q = path(s, curved); return prof.map(([x, y]) => [(q.x + x * Math.cos(q.a)) * .52, y * .52 - .122, (q.z - x * Math.sin(q.a)) * .52]); };
    let prev = ring(startDistance);
    for (let s = startDistance + .04; s <= endDistance + .0001; s += .04) {
      const next = ring(s);
      for (let i = 0; i < prof.length; i++) {
        const j = (i + 1) % prof.length;
        if (cut) {
          const vertical = Math.abs(prof[i][1] - prof[j][1]) > .1, bottom = prof[i][1] < BOT && prof[j][1] < BOT;
          if (vertical || bottom) {
            const mx = (prev[i][0] + next[i][0] + prev[j][0] + next[j][0]) / 4 / .52, mz = (prev[i][2] + next[i][2] + prev[j][2] + next[j][2]) / 4 / .52, d = otherDist(mx, mz, curved);
            if (vertical && d < U(.30)) continue;
            if (bottom && d < U(.18)) continue;
          }
        }
        verts.push(...prev[i], ...next[j], ...prev[j], ...prev[i], ...next[i], ...next[j]);
      }
      prev = next;
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3)); geo.computeVertexNormals();
    own.push(geo); turnRail.add(new T.Mesh(geo, mat));
  }
  const railLook = (color, opacity) => { const m = new T.MeshStandardMaterial({ color, roughness: .55, metalness: .25, transparent: true, opacity, depthWrite: false, side: T.DoubleSide }); own.push(m); return m; };
  const whiteMat = railLook(0xf1eee6, .30), aluMat = railLook(0xd3d9de, .20);
  // 直行路線在交會段（離彎出去那條不到 1 m 的地方，前面再多 1 m）用白色板件，其他是鋁擠型
  let J = 0; for (let z = 0; z < 5.2; z += .02) { if (otherDist(0, z, false) > U(1.0)) { J = z + U(.3); break; } }
  const L0 = -U(1.0);
  sweep(profile, aluMat, false, -3, L0); sweep(profile, whiteMat, false, L0, J, true); sweep(profile, aluMat, false, J, 5.2);
  sweep(profile, whiteMat, true, .0001, 5.2, true);                       // 轉彎路線：從分岔點開始（前面跟直行那條是同一段）
  void railMat;
  // 導軌：只標示位置（斷面沒實測）
  const guideMat = metal.clone(); guideMat.transparent = true; guideMat.opacity = .32; guideMat.side = T.DoubleSide; own.push(guideMat);
  sweep([[.257, .78], [.302, .78], [.302, .54], [.257, .54]], guideMat, true, -.40, 1.36);
  sweep([[.248, .78], [.266, .78], [.266, .67], [.248, .67]], guideMat, false, -.40, 1.36);
  box(turnRail, .12 * .52, .025 * .52, .20 * .52, guideMat, .225 * .52, .79 * .52 - .122, -.30 * .52);
  const bodyLink = box(scene, .23, .06, 1.2, metal, 0, -.32, 0);   // 前後走行部之間的車身連桿（示意；顯示車廂時藏起來）
  // 車廂：在全廠模擬裡（有 vehicle.js 的外殼模型）才做得出來，跟全廠的天車用同一份幾何和材質（不在這裡釋放）
  const canBody = typeof VG !== 'undefined' && typeof MODEL !== 'undefined' && typeof END_X !== 'undefined';
  let showBody = false, bodyG = null;
  function buildBody() {
    const g = new T.Group(), add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
    const capMat = new T.MeshStandardMaterial({ color: 0xf3f4f2, roughness: .45 }); own.push(capMat);
    add(new T.Mesh(VG.capGeo, capMat), 0, 0, 0);
    [1, -1].forEach(k => {
      for (const [geo, m] of [[VG.visorGeo, VG.visorMat], [VG.endPanel, VG.white], [VG.trimGeo, VG.trimMat]]) { const o = add(new T.Mesh(geo, m), k * END_X, 0, 0); if (k < 0) o.rotation.y = Math.PI; }
    });
    const rail = new T.BoxGeometry(2 * (END_X - END_T / 2) + .04, .04, .05), stage = new T.BoxGeometry(1.12, .05, .92); own.push(rail, stage);
    [-1, 1].forEach(k => add(new T.Mesh(rail, VG.gray), 0, BODY_BOT + .02, k * .47));     // 底部連接框
    add(new T.Mesh(stage, VG.gray), 0, -.265, 0);                                           // 側移固定節
    add(new T.Mesh(MODEL.near.shift, MODEL.mat), 0, UNIT_DY, 0);                            // 側移＋捲揚單元
    const grip = add(new T.Group(), 0, GRIP_REST, 0); grip.add(new T.Mesh(MODEL.near.grip, MODEL.mat));
    for (const k of [-1, 1]) { const f = new T.Mesh(VG.clawGeo, VG.clawMat); if (k < 0) f.rotation.y = Math.PI; grip.add(f); }
    scene.add(g); return g;
  }

  // ---------- 路線播放 ----------
  let progress = 0, playing = false, last = 0, curvedRoute = true, raf = 0, handOverride = null, statusOverride = null, curView = 'iso', userHand = false, handRaf = 0;
  const prog = $('prog'), play = $('play');
  function pose() {
    const q = progress, change = Math.max(0, Math.min(1, (q - .04) / .11));
    p = handOverride != null ? handOverride : curvedRoute ? 1 - change : change; setPose();
    const target = p > .5 ? 1 : 0;
    root.querySelectorAll('[data-hand]').forEach(b => b.classList.toggle('on', Number(b.dataset.hand) === target));
    const center = q < .20 ? -1.6 : -1.6 + (q - .20) / .80 * 6.0;
    const front = path(center + .42 / .52, curvedRoute), rear = path(center - .42 / .52, curvedRoute);
    [front, rear].forEach((v, i) => {
      units[i].position.set(v.x * .52, 0, v.z * .52); units[i].rotation.y = v.a - Math.PI / 2;
      // 換手輪只有碰到導軌才轉：這台走行部在導軌範圍裡，而且手跟這條路線的導軌對得上
      //（下手走彎路 → 貼著彎導軌外側；上手直行 → 貼著直導軌內側），導軌在 +側
      const s = center + (i ? -1 : 1) * .42 / .52, inGuide = s > -.40 && s < 1.36;
      const touch = inGuide && (curvedRoute ? p < .5 : p > .5);
      OHTTravelModel.roll(units[i], center * .52, side => touch && side > 0);
    });
    focusX = (front.x + rear.x) * .26; focusZ = (front.z + rear.z) * .26;
    const dx = front.x - rear.x, dz = front.z - rear.z;
    bodyLink.position.set(focusX, -.32, focusZ); bodyLink.scale.z = Math.hypot(dx, dz) * .52 / 1.2; bodyLink.rotation.y = Math.atan2(dx, dz);
    bodyLink.visible = !showBody;
    if (bodyG) { bodyG.visible = showBody; bodyG.position.set(focusX, -.06, focusZ); bodyG.rotation.y = Math.atan2(-dz, dx); }   // 車廂跟著前後走行部中點、朝行進方向
    const hand = curvedRoute ? '下手' : '上手';
    status.textContent = q < .04 ? '依下一個分岔路線，準備切換至' + hand : q < .15 ? '前後八顆換手輪同步切換至' + hand : q < .20 ? hand + '已完成，尚未進入導軌'
      : center + .60 <= 0 ? hand + '保持到位，進入分岔導軌'
      : curvedRoute ? (center - .60 < R * Math.PI / 2 ? '選擇彎路：維持下手，前後走行部沿彎導軌轉向' : '離開分岔：維持下手，不自動復位')
      : '選擇直路：維持上手，沿直導軌通過分岔';
    if (statusOverride != null) status.textContent = statusOverride;
    render();
  }
  const setPlay = on => { playing = on; play.textContent = on ? '⏸ 暫停' : progress >= 1 ? '↻ 重播路線' : progress > 0 ? '▶ 繼續播放' : '▶ 播放路線'; };
  function tick(now) {
    raf = 0; if (!playing || dead) return;
    progress = Math.min(1, progress + (now - last) / 22000); last = now; prog.value = Math.round(progress * 1000); pose();
    if (progress < 1) raf = requestAnimationFrame(tick); else setPlay(false);
  }
  play.onclick = () => { if (!playing && progress >= 1) progress = 0; setPlay(!playing); last = performance.now(); if (playing && !raf) raf = requestAnimationFrame(tick); };
  $('route').onchange = e => { curvedRoute = e.target.value === 'turn'; progress = 0; prog.value = 0; handOverride = null; userHand = false; statusOverride = null; setPlay(false); pose(); };
  // 點右上角的「上手／下手」直接切換：換手輪座沿斜軌滑過去（0.8 秒）。
  // 已經進導軌（前後走行部在分岔裡）就不能換手；自由操作時，切換手也一起換路線（這個分岔：下手跟彎軌進支線、上手直行）
  const controlsOn = () => $('route').style.display !== 'none';
  const bodyBtn = root.querySelector('[data-body]');
  if (!canBody) bodyBtn.style.display = 'none';
  bodyBtn.onclick = () => { showBody = !showBody; if (showBody && !bodyG) bodyG = buildBody(); bodyBtn.classList.toggle('on', showBody); pose(); };
  root.querySelectorAll('.tdhand i[data-hand]').forEach(b => b.onclick = () => {
    const to = Number(b.dataset.hand), center = progress < .20 ? -1.6 : -1.6 + (progress - .20) / .80 * 6.0;
    if (center + .42 / .52 > -.40) { statusOverride = '已經進入導軌，不能換手（要在進導軌前換好）'; pose(); return; }
    if (playing) setPlay(false);
    if (controlsOn()) { curvedRoute = to === 0; $('route').value = curvedRoute ? 'turn' : 'straight'; }
    userHand = true; statusOverride = to ? '切換成上手：換手輪座沿斜軌往內、往上滑' : '切換成下手：換手輪座沿斜軌往外、往下滑';
    const from = p, t0 = performance.now(); if (handRaf) cancelAnimationFrame(handRaf);
    const step = now => { handRaf = 0; if (dead) return; const u = Math.min(1, (now - t0) / 800), e = u * u * (3 - 2 * u); handOverride = from + (to - from) * e; pose();
      if (u < 1) handRaf = requestAnimationFrame(step); else { statusOverride = to ? '上手：換手輪靠中間、位置高（在彎軌內側）' : '下手：換手輪分到兩邊、位置低（彎軌那側貼在彎軌外側）'; pose(); } };
    handRaf = requestAnimationFrame(step);
  });
  prog.oninput = () => { progress = Number(prog.value) / 1000; setPlay(false); pose(); };
  const setView = v => { curView = v; $('view').value = v; [yaw, pitch, distance] = v === 'front' ? [0, 0, 1.4] : v === 'top' ? [0, Math.PI / 2 - .001, 2.6] : v === 'side' ? [Math.PI / 2, 0, 2.2] : [.7, .48, 2.5]; };
  $('view').onchange = e => { setView(e.target.value); render(); };
  $('rail').onchange = e => { turnRail.visible = e.target.checked; render(); };

  // ---------- 滑鼠：拖曳旋轉、滾輪縮放 ----------
  host.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY }; host.setPointerCapture(e.pointerId); };
  host.onpointermove = e => { if (!drag) return; yaw -= (e.clientX - drag.x) * .008; pitch = Math.max(-1.3, Math.min(1.55, pitch + (e.clientY - drag.y) * .008)); drag = { x: e.clientX, y: e.clientY }; render(); };
  host.onpointerup = host.onpointercancel = () => drag = null;
  const onWheel = e => { e.preventDefault(); distance = Math.min(7, Math.max(1.2, distance * Math.exp(e.deltaY * .001))); render(); };
  host.addEventListener('wheel', onWheel, { passive: false });
  const ro = new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); render(); });
  ro.observe(host);

  const showControls = on => { if (!on && playing) setPlay(false); root.querySelectorAll('.tdctl > :not(.tdhand)').forEach(e => e.style.display = on ? '' : 'none'); };
  showControls(opts.controls !== false);
  pose();
  return {
    controls: showControls,
    // 教學章節用：{ view, hand(1 上手～0 下手，null＝照路線自動), route('turn'|'straight'), progress(0～1), status }
    set(o = {}) {
      if (dead) return;
      if (o.view && o.view !== curView) setView(o.view);
      if (o.resetUser) { userHand = false; if (handRaf) { cancelAnimationFrame(handRaf); handRaf = 0; } }
      if (userHand) { pose(); return; }      // 使用者自己點了上手／下手：這一步裡不再被教學蓋掉
      if ('hand' in o) handOverride = o.hand;
      if (o.route) { curvedRoute = o.route === 'turn'; $('route').value = o.route; }
      if (o.progress != null) { progress = o.progress; prog.value = Math.round(progress * 1000); }
      statusOverride = o.status != null ? o.status : null;
      pose();
    },
    dispose() {
      if (dead) return; dead = true; playing = false; if (raf) cancelAnimationFrame(raf);
      ro.disconnect(); host.removeEventListener('wheel', onWheel);
      for (const o of own) o.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
