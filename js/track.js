// track.js — 鋁擠型軌道（沿整個軌道網路）、吊架、地面方向箭頭、Bay 名牌

// 軌道：C 形鋁擠型（下方開槽），天車的走行部在軌道裡面跑
//   直線段鋁色、彎道段淺綠色；頂板下方有非接觸供電線；外側有溝槽
const railMat = mat(0xffffff, { metalness: 0.45, roughness: 0.4 });
{
  const STEP = 0.3;                                   // 每一小段軌道的長度
  const samples = [];                                 // [x0, z0, x1, z1, 是否彎道]
  segs.forEach(sg => {
    const n = Math.max(1, Math.ceil(sg.len / STEP));
    for (let i = 0; i < n; i++) {
      const d0 = sg.len * i / n, d1 = sg.len * (i + 1) / n;
      if (onLifter(sg, (d0 + d1) / 2, LIFT_HALF)) continue;   // 捲揚機那段軌道是活動的（maintenance.js）
      samples.push([...sg.at(d0), ...sg.at(d1), sg.curveAt((d0 + d1) / 2)]);
    }
  });
  const N = samples.length;
  const grooveMat = mat(0x8a939b, { metalness: 0.5 });
  const parts = [ // [幾何, y 偏移, 側向偏移, 是否套用軌道顏色, 材質]
    [new THREE.BoxGeometry(1, 0.03, 0.62), 0.135, 0, true],       // 頂板
    [new THREE.BoxGeometry(1, 0.3, 0.03), 0, 0.295, true],        // 側壁
    [new THREE.BoxGeometry(1, 0.3, 0.03), 0, -0.295, true],
    [new THREE.BoxGeometry(1, 0.03, 0.17), -0.135, 0.195, true],  // 底部內翻邊（輪子壓在這上面跑）
    [new THREE.BoxGeometry(1, 0.03, 0.17), -0.135, -0.195, true],
    [new THREE.BoxGeometry(1, 0.02, 0.05), 0.11, 0, false, mat(0x1b1f24, { roughness: 0.8 })],  // 供電線
    ...[0.095, 0.035, -0.025, -0.085].flatMap(y => [              // 側面 T 型溝槽：每邊四條
      [new THREE.BoxGeometry(1, 0.016, 0.012), y, 0.312, false, grooveMat],
      [new THREE.BoxGeometry(1, 0.016, 0.012), y, -0.312, false, grooveMat],
    ]),
  ].map(([geo, oy, oz, colored, m]) => {
    const im = new THREE.InstancedMesh(geo, m || railMat, N); im.castShadow = colored; im.frustumCulled = false; scene.add(im);
    return { im, oy, oz, colored };
  });
  const ALU = new THREE.Color(0xd3d9de), MINT = new THREE.Color(0xa6dcc6);
  const d = new THREE.Object3D();
  samples.forEach(([x0, z0, x1, z1, curve], i) => {
    const ang = Math.atan2(-(z1 - z0), x1 - x0), len = Math.hypot(x1 - x0, z1 - z0) * (curve ? 1.2 : 1.06);   // 彎道外緣比中心線長，片段要拉長一點才不會在外緣留下鋸齒缺口
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    d.rotation.set(0, ang, 0); d.scale.set(len, 1, 1);
    // 彎道段（淺綠）稍微抬高 3 mm、側壁往內縮 4 mm：分岔／合流處直軌和彎軌重疊時，兩片才不會在同一個平面上互相閃爍（Z-fighting）
    const lift = curve ? 0.003 : 0, inset = curve ? 0.004 : 0;
    for (const p of parts) {
      const oz = p.oz ? p.oz - Math.sign(p.oz) * inset : 0;
      d.position.set(mx + oz * Math.sin(ang), H + p.oy + lift, mz + oz * Math.cos(ang));
      d.updateMatrix(); p.im.setMatrixAt(i, d.matrix);
      if (p.colored) p.im.setColorAt(i, curve ? MINT : ALU);
    }
  });
  parts.forEach(p => { if (p.colored) p.im.instanceColor.needsUpdate = true; });

  // 沿每段軌道每隔 every 公尺放一個東西（回傳位置與轉角）
  const along = (every, offset, fn) => segs.forEach(sg => {
    for (let s = offset; s < sg.len - 0.2; s += every) { if (onLifter(sg, s, LIFT_HALF + 0.6)) continue; const f = frameAt(sg, s); fn(f); }
  });
  // 分岔、合流處兩段軌道疊在一起：吊架、固定座各段各算會重複放在同一個位置，所以太靠近已經放過的就跳過
  const spaced = r => { const cell = new Map(), key = (i, j) => i * 100003 + j;
    return (x, z) => { const i = Math.floor(x / r), j = Math.floor(z / r);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [px, pz] of cell.get(key(i + a, j + b)) || []) if (Math.hypot(px - x, pz - z) < r) return false;
      const k = key(i, j); if (!cell.has(k)) cell.set(k, []); cell.get(k).push([x, z]); return true; }; };
  const placeInst = (geo, material, list) => {
    const im = new THREE.InstancedMesh(geo, material, list.length); im.castShadow = true; im.frustumCulled = false;
    list.forEach(([x, y, z, ang, sy], i) => { d.position.set(x, y, z); d.rotation.set(0, ang, 0); d.scale.set(1, sy || 1, 1); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    scene.add(im);
  };
  // 軌道頂部兩側邊緣的小固定座（每 2 公尺一組）
  const clamps = [];
  const clampOk = spaced(0.35);
  along(2, 1, f => [-0.27, 0.27].forEach(oz => { const x = f.x + oz * f.nx, z = f.z + oz * f.nz; if (clampOk(x, z)) clamps.push([x, H + 0.185, z, f.th]); }));
  placeInst(new THREE.BoxGeometry(0.12, 0.07, 0.07), mat(0xc9ced3, { metalness: 0.65, roughness: 0.3 }), clamps);
  // 吊架＋軌道上方固定座（每 4 公尺）
  const hangers = [], brackets = [];
  const hangOk = spaced(1.6);
  along(4, 0.5, f => { if (!hangOk(f.x, f.z)) return; hangers.push([f.x, H + (10.5 - H) / 2, f.z, 0, 10.5 - H]); brackets.push([f.x, H + 0.2, f.z, f.th]); });
  placeInst(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), mat(0x8a949d, { metalness: 0.5 }), hangers);
  placeInst(new THREE.BoxGeometry(0.28, 0.1, 0.72), mat(0xc7cdd3, { metalness: 0.6 }), brackets);

  // 地面方向箭頭（每 6 公尺，畫在軌道正下方）
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 });
  const shape = new THREE.Shape(); shape.moveTo(0.5, 0); shape.lineTo(-0.35, 0.35); shape.lineTo(-0.15, 0); shape.lineTo(-0.35, -0.35); shape.closePath();
  const ag = new THREE.ShapeGeometry(shape);
  const arrows = [];
  along(6, 2, f => arrows.push(f));
  const aim = new THREE.InstancedMesh(ag, arrowMat, arrows.length); aim.frustumCulled = false;
  const ae = new THREE.Euler(), aq = new THREE.Quaternion(), ap = new THREE.Vector3(), as = new THREE.Vector3(1, 1, 1), am = new THREE.Matrix4();
  arrows.forEach((f, i) => aim.setMatrixAt(i, am.compose(ap.set(f.x, 0.03, f.z), aq.setFromEuler(ae.set(-Math.PI / 2, 0, f.th)), as)));
  scene.add(aim);

  // 區塊名牌（浮在區塊中心上方，從遠處就看得到）
  ZONES.forEach(z => {
    const lb = makeLabel(`${z.name} 區`, { scale: 6, w: 200, bg: 'rgba(15,23,42,.75)', fg: '#7dd3fc' });
    lb.position.set(z.cx - 12, H + 6, z.zc); scene.add(lb);
  });
  // Bay 名牌（掛在 Bay 底端 U 彎上方）
  bays.forEach(b => {
    const lb = b.maint ? makeLabel(`BAY ${b.name} 車輛維修區`, { scale: 1.8, w: 380, bg: 'rgba(180,83,9,.92)' })
      : makeLabel('BAY ' + b.name, { scale: 1.8, w: 220, bg: 'rgba(30,64,175,.9)' });
    const zEnd = b.north ? b.zone.zc - MAIN_R - (b.len - MAIN_R) - BAY_W - 0.6 : b.zone.zc + MAIN_R + (b.len - MAIN_R) + BAY_W + 0.6;
    lb.position.set(b.x, H + 1.3, zEnd); scene.add(lb); labels.push(lb);
  });
}
