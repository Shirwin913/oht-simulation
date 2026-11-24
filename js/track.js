// track.js — 鋁擠型軌道（沿整個軌道網路）、吊架、地面方向箭頭、Bay 名牌

// 軌道：C 形鋁擠型（下方開槽），天車的走行部在軌道裡面跑
//   直線段鋁色、彎道段淺綠色；頂板下方有非接觸供電線；外側有溝槽
// 軌道頂面是一大片平面：反光太強時，「高」畫質的環境反射會把天花板燈條照成一塊一塊的亮斑（彎道最明顯），所以霧一點、反射弱一點
const RAIL_LOOK = { metalness: 0.45, roughness: 0.7, envMapIntensity: 0.2 };
const railMat = mat(0xffffff, RAIL_LOOK);
{
  const STEP = 0.3;                                   // 每一小段軌道的長度
  const samples = [];                                 // [x0, z0, x1, z1, 是否彎道]
  const curveRuns = [];
  // Split at the actual curvature transitions; straight and curved meshes share an endpoint.
  segs.forEach(sg => {
    const cuts=[0];let previous=sg.curveAt(0);
    for(let d=.02;d<sg.len+.02;d+=.02){
      const end=Math.min(d,sg.len), current=sg.curveAt(end);
      if(current!==previous){let lo=Math.max(0,d-.02),hi=end;
        for(let j=0;j<24;j++){const mid=(lo+hi)/2;if(sg.curveAt(mid)===previous)lo=mid;else hi=mid;}
        cuts.push((lo+hi)/2);previous=current;
      }
    }
    for(const lift of lifterCuts(sg)) cuts.push(...lift);
    cuts.push(sg.len);cuts.sort((a,b)=>a-b);
    for(let j=0;j+1<cuts.length;j++){
      const a=cuts[j],b=cuts[j+1],mid=(a+b)/2;if(b-a<1e-7||onLifter(sg,mid,LIFT_HALF))continue;
      if(sg.curveAt(mid)){curveRuns.push([sg,a,b]);continue;}
      const n=Math.max(1,Math.ceil((b-a)/STEP));
      for(let i=0;i<n;i++) samples.push([...sg.at(a+(b-a)*i/n),...sg.at(a+(b-a)*(i+1)/n),false]);
    }
  });
  function lifterCuts(sg){return LIFTERS.filter(l=>l.seg===sg).map(l=>[Math.max(0,l.d-LIFT_HALF),Math.min(sg.len,l.d+LIFT_HALF)]);}
  // ---------- 彎道：把軌道斷面（倒 U 型＋底部內翻邊）沿著彎道連續掃出來，表面是光滑曲面，沒有鋸齒和接縫 ----------
  {
    // Cross-section matches straight rails; depth bias resolves branch/merge surface overlap.
    const PROF = [[-0.31, 0.15], [0.31, 0.15], [0.31, -0.15], [0.11, -0.15], [0.11, -0.12], [0.28, -0.12], [0.28, 0.12],
      [-0.28, 0.12], [-0.28, -0.12], [-0.11, -0.12], [-0.11, -0.15], [-0.31, -0.15]];
    // Sweep only the exact curved intervals, without extending into adjoining straights.
    const runs = curveRuns;
    const runFrames = runs.map(([sg, a, b]) => {                          // 彎越急切越細：約每轉 3 度一段
      const frames = []; let last = null;
      for (let d = a; d <= b + 1e-6; d += 0.02) {
        const distance=Math.min(d,b), f = frameAt(sg,distance);
        const pa=sg.at(Math.max(0,distance-.0001)),pb=sg.at(Math.min(sg.len,distance+.0001));
        const tangent=Math.atan2(pb[1]-pa[1],pb[0]-pa[0]);f.th=-tangent;f.nx=-Math.sin(tangent);f.nz=Math.cos(tangent);
        if (!last) { frames.push(f); last = f; continue; }
        let dth = Math.abs(f.th - last.th); if (dth > Math.PI) dth = 2 * Math.PI - dth;
        if (dth > 0.05 || Math.hypot(f.x - last.x, f.z - last.z) > 0.8 || d + 0.02 > b) { frames.push(f); last = f; }
      }
      const end=frameAt(sg,b),pa=sg.at(Math.max(0,b-.0001)),pb=sg.at(Math.min(sg.len,b+.0001));
      const tangent=Math.atan2(pb[1]-pa[1],pb[0]-pa[0]);end.th=-tangent;end.nx=-Math.sin(tangent);end.nz=Math.cos(tangent);
      if(!frames.length || Math.hypot(frames[frames.length-1].x-end.x,frames[frames.length-1].z-end.z)>1e-7)frames.push(end);
      return frames;
    });
    // 把一個封閉斷面（順時針的 [側向, 高度] 點）沿所有彎道掃成一個網格
    const sweepMesh = (prof, material, cast) => {
      // Branch/merge paths share a footprint even when their endpoints meet exactly.
      // Resolve coplanar fragments consistently without raising or shrinking the rail.
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -4;
      const pos = [], nor = [];
      const edgeN = prof.map((p, k) => { const q = prof[(k + 1) % prof.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); return [-dy / l, dx / l]; });
      const ring = f => prof.map(([x, y]) => [f.x + x * f.nx, H + y, f.z + x * f.nz]);
      const tri = (a, b, c, na, nb, nc) => { pos.push(...a, ...b, ...c); nor.push(...na, ...nb, ...nc); };
      runFrames.forEach(frames => {
        for (let i = 0; i + 1 < frames.length; i++) {
          const f0 = frames[i], f1 = frames[i + 1], r0 = ring(f0), r1 = ring(f1);
          for (let k = 0; k < prof.length; k++) {
            const k2 = (k + 1) % prof.length, [ex, ey] = edgeN[k];
            const n0 = [ex * f0.nx, ey, ex * f0.nz], n1 = [ex * f1.nx, ey, ex * f1.nz];
            const A = r0[k], B = r0[k2], C = r1[k2], D = r1[k];
            const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
            const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;   // 三角形繞向要跟法線同一邊（外面看得到）
            if (cx * n0[0] + cy * n0[1] + cz * n0[2] >= 0) { tri(A, B, C, n0, n0, n1); tri(A, C, D, n0, n1, n1); }
            else { tri(A, C, B, n0, n1, n0); tri(A, D, C, n0, n1, n1); }
          }
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      const m = new THREE.Mesh(g, material); m.renderOrder = 1; m.castShadow = cast; m.frustumCulled = false; scene.add(m);
    };
    const rect = (cx, cy, hx, hy) => [[cx - hx, cy + hy], [cx + hx, cy + hy], [cx + hx, cy - hy], [cx - hx, cy - hy]];
    sweepMesh(PROF, mat(0xa6dcc6, RAIL_LOOK), true);                                       // 軌道本體
    [0.095, 0.035, -0.025, -0.085].forEach(y => [-1, 1].forEach(k =>                                                   // 側面溝槽：每邊四條
      sweepMesh(rect(k * 0.312, y, 0.006, 0.008), mat(0x8a939b, { metalness: 0.5 }), false)));
    sweepMesh(rect(0, 0.11, 0.025, 0.01), mat(0x1b1f24, { roughness: 0.8 }), false);                                    // 供電線
  }
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
  const ALU = new THREE.Color(0xd3d9de), MINT = new THREE.Color(0xa6dcc6), ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
  const d = new THREE.Object3D();
  samples.forEach(([x0, z0, x1, z1, curve], i) => {
    const ang = Math.atan2(-(z1 - z0), x1 - x0), len = Math.hypot(x1 - x0, z1 - z0);   // 彎道外緣比中心線長，片段要拉長一點才不會在外緣留下鋸齒缺口
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    d.rotation.set(0, ang, 0); d.scale.set(len, 1, 1);
    // 彎道段（淺綠）稍微抬高 3 mm、側壁往內縮 4 mm：分岔／合流處直軌和彎軌重疊時，兩片才不會在同一個平面上互相閃爍（Z-fighting）
    const lift = curve ? 0.003 : 0, inset = curve ? 0.004 : 0;
    for (const p of parts) {
      if (curve) { p.im.setMatrixAt(i, ZERO_M); if (p.colored) p.im.setColorAt(i, MINT); continue; }   // 彎道整個由連續曲面負責（本體、溝槽、供電線）
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
  placeInst(new THREE.CylinderGeometry(0.05, 0.05, 1, 14), mat(0x8a949d, { metalness: 0.5 }), hangers);
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
