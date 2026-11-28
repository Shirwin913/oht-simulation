// track.js — 鋁擠型軌道（沿整個軌道網路）、吊架、地面方向箭頭、Bay 名牌

// 軌道：C 形鋁擠型（下方開槽），天車的走行部在軌道裡面跑
//   直線段鋁色、彎道段淺綠色；頂板下方有非接觸供電線；外側有溝槽
// 軌道頂面是一大片平面：反光太強時，「高」畫質的環境反射會把天花板燈條照成一塊一塊的亮斑（彎道最明顯），所以霧一點、反射弱一點
const RAIL_LOOK = { metalness: 0.45, roughness: 0.7, envMapIntensity: 0.2 };
const railMat = mat(0xffffff, RAIL_LOOK);
const TRACK_XRAY_MATERIALS=[railMat];
// ---------- 分岔／匯流處（照現場：分岔、匯流和彎道是一整片白色的板件，直軌是鋁擠型，兩者斷面一樣大）----------
// 每個分岔／匯流點，算出相連的各段從節點開始「跟其他路線還疊在一起」的長度 J；這段範圍叫「交會段」：
//   直軌在交會段也改用白色寬板件（跟彎軌一起掃），兩條路線的側壁互相讓開（不能穿過另一條的內部），
//   底部內翻邊也要讓出另一條路線的「縫」—— 不然天車轉進支線時，吊臂會穿過直軌的底板。
const RAIL_SEP = 1.0;                                 // 中心線離其他路線超過這個距離，就算分開了
const junctionRuns = new Map();                       // seg.id → [[a, b], ...]（該段上屬於交會段的里程）
const railJunction = (() => {
  const cells = new Map(), key = (x, z) => Math.floor(x) + ',' + Math.floor(z);
  const polyOf = sg => { const pts = []; for (let d = 0; d <= sg.len + 1e-6; d += .05) pts.push(sg.at(Math.min(d, sg.len))); return pts; };
  const distTo = (p, pts) => { let m = Infinity; for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], vx = b[0] - a[0], vz = b[1] - a[1], den = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / den)); m = Math.min(m, Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vz)); } return m; };
  const addRun = (sg, r) => { if (!junctionRuns.has(sg.id)) junctionRuns.set(sg.id, []); junctionRuns.get(sg.id).push(r); };
  const addEdges = (sg, a, b) => { for (let d = a; d < b - 1e-6; d += .08) { const p = sg.at(d), q = sg.at(Math.min(b, d + .08)), k = key((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    if (!cells.has(k)) cells.set(k, []); cells.get(k).push({ id: sg.id, a: p, b: q }); } };
  nodes.filter(n => n.out.length > 1 || n.in.length > 1).forEach(n => {
    const div = n.out.length > 1, group = div ? n.out : n.in, near = sg => div ? d => sg.at(Math.min(d, sg.len)) : d => sg.at(Math.max(0, sg.len - d));
    const polys = new Map(group.map(sg => [sg.id, polyOf(sg)]));
    let J = 0;
    for (const sg of group) {                       // 這條路線離同一點分出去的其他路線多遠才算分開
      const at = near(sg); let d = 0;
      for (; d < Math.min(sg.len, 7); d += .05) { const p = at(d); if (group.every(o => o === sg || distTo(p, polys.get(o.id)) > RAIL_SEP)) break; }
      J = Math.max(J, d);
    }
    J = Math.min(J + .3, 7);
    for (const sg of group) { const L = Math.min(J, sg.len); if (div) { addRun(sg, [0, L]); addEdges(sg, 0, Math.min(sg.len, L + .5)); } else { addRun(sg, [sg.len - L, sg.len]); addEdges(sg, Math.max(0, sg.len - L - .5), sg.len); } }
    for (const sg of div ? n.in : n.out) { const L = Math.min(1.0, sg.len); if (div) addRun(sg, [sg.len - L, sg.len]); else addRun(sg, [0, L]); }
  });
  // (x, z) 離「別條」路線中心線多遠（只看交會段附近；遠的回傳 Infinity）
  return (x, z, own) => { const ix = Math.floor(x), iz = Math.floor(z); let m = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const e of cells.get((ix + dx) + ',' + (iz + dz)) || []) {
      if (e.id === own) continue; const vx = e.b[0] - e.a[0], vz = e.b[1] - e.a[1], den = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - e.a[0]) * vx + (z - e.a[1]) * vz) / den)); m = Math.min(m, Math.hypot(x - e.a[0] - t * vx, z - e.a[1] - t * vz)); }
    return m; };
})();
const railJunctionCavity = (x, z, own) => railJunction(x, z, own) < .286;   // 在別條路線的槽裡面（側壁要讓開）
const inJunctionRun = (sg, d) => (junctionRuns.get(sg.id) || []).some(([a, b]) => d > a - 1e-6 && d < b + 1e-6);

{
  const STEP = 0.3;                                   // 每一小段軌道的長度
  const samples = [];                                 // [x0, z0, x1, z1, 是否彎道]
  const curveRuns = [];                               // 用白色寬板件掃出來的區間：彎道＋交會段
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
    for(const r of junctionRuns.get(sg.id)||[]) cuts.push(Math.max(0,r[0]),Math.min(sg.len,r[1]));
    cuts.push(sg.len);cuts.sort((a,b)=>a-b);
    for(let j=0;j+1<cuts.length;j++){
      const a=cuts[j],b=cuts[j+1],mid=(a+b)/2;if(b-a<1e-7||onLifter(sg,mid,LIFT_HALF))continue;
      if(sg.curveAt(mid)||inJunctionRun(sg,mid)){
        const last=curveRuns[curveRuns.length-1];                 // 接在一起的區間併成一段，掃出來才不會有接縫
        if(last&&last[0]===sg&&Math.abs(last[2]-a)<1e-6)last[2]=b;else curveRuns.push([sg,a,b]);
        continue;
      }
      const n=Math.max(1,Math.ceil((b-a)/STEP));
      for(let i=0;i<n;i++) samples.push([...sg.at(a+(b-a)*i/n),...sg.at(a+(b-a)*(i+1)/n),false,sg.id]);
    }
  });
  function lifterCuts(sg){return LIFTERS.filter(l=>l.seg===sg).map(l=>[Math.max(0,l.d-LIFT_HALF),Math.min(sg.len,l.d+LIFT_HALF)]);}
  // ---------- 彎道／交會段：白色寬板件（照現場照片），斷面沿路線連續掃出來 ----------
  {
    // 斷面跟直軌一樣大（外緣 ±0.31，現場彎道件跟直軌是同一個尺寸，只是顏色、做法不同）；裡面的槽、底部內翻邊和縫也一樣
    const W = .31;
    const OUT = [[-W, .302], [W, .302], [W, -.15]];
    const sub = (p, q, step) => { const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step)), o = []; for (let i = 0; i < n; i++) o.push([p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n]); return o; };
    // 底部（y ≤ -0.12）的邊切細：交會處要一小格一小格判斷是不是落在別條路線的縫裡
    // 縫 ±0.174、內壁 ±0.287：跟走行機構模型（travel_mechanism.js）對齊，下導輪剛好貼著縫邊、走行輪踩在內翻邊上
    const RAW = [...OUT, [.174, -.15], [.174, -.12], [.287, -.12], [.287, .284], [-.287, .284], [-.287, -.12], [-.174, -.12], [-.174, -.15], [-W, -.15]];
    const PROF = RAW.flatMap((p, k) => { const q = RAW[(k + 1) % RAW.length]; return p[1] <= -.11 && q[1] <= -.11 ? sub(p, q, .04) : [p]; });
    const runs = curveRuns;
    const runFrames = runs.map(([sg, a, b]) => {
      const frames = []; let last = null;
      const frame = distance => { const f = frameAt(sg, distance), pa = sg.at(Math.max(0, distance - .0001)), pb = sg.at(Math.min(sg.len, distance + .0001));
        const tangent = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]); f.th = -tangent; f.nx = -Math.sin(tangent); f.nz = Math.cos(tangent); f.railOwner = sg.id; return f; };
      for (let d = a; d <= b + 1e-6; d += 0.02) {
        const f = frame(Math.min(d, b));
        if (!last) { frames.push(f); last = f; continue; }
        let dth = Math.abs(f.th - last.th); if (dth > Math.PI) dth = 2 * Math.PI - dth;
        const step = railJunction(f.x, f.z, sg.id) < 1.2 ? .05 : .8;          // 交會處切細，縫才切得準
        if (dth > 0.05 || Math.hypot(f.x - last.x, f.z - last.z) > step) { frames.push(f); last = f; }
      }
      const end = frame(b);
      if (Math.hypot(last.x - end.x, last.z - end.z) > 1e-7) frames.push(end);
      return frames;
    });
    const sweepMesh = (prof, material, cast, opt = {}) => {
      if(cast)TRACK_XRAY_MATERIALS.push(material);
      // 不用 polygonOffset：它依斜率把面往鏡頭拉，側壁（斜著看幾乎是垂直的面）被拉得最多，頂邊就從頂板透出來，看起來像黑線。
      // 交會處兩條路線的板件同色同高，重疊也看不出來；直軌在交會段已經不畫，不會跟板件打架。
      const pos = [], nor = [];
      const edgeN = prof.map((p, k) => { const q = prof[(k + 1) % prof.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); return [-dy / l, dx / l]; });
      const ring = f => prof.map(([x, y]) => [f.x + x * f.nx, H + y, f.z + x * f.nz]);
      const tri = (a, b, c, na, nb, nc) => { pos.push(...a, ...b, ...c); nor.push(...na, ...nb, ...nc); };
      const quad = (A, B, C, D, n0, n1) => {
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;   // 三角形繞向要跟法線同一邊（外面看得到）
        if (cx * n0[0] + cy * n0[1] + cz * n0[2] >= 0) { tri(A, B, C, n0, n0, n1); tri(A, C, D, n0, n1, n1); }
        else { tri(A, C, B, n0, n1, n0); tri(A, D, C, n0, n1, n1); }
      };
      // 交會處不是整片面「留或丟」（一格一格判斷，邊緣會變成鋸齒，兩條路線的階梯轉角還會剛好都沒畫、留下縫），
      // 而是算出每個頂點離別條路線多遠，沿著交界線把三角形精確切開：側壁離別條路線中心 < 0.30 讓開、底板 < 0.18 讓開（縫）
      const limits = prof.map((p, k) => { const q = prof[(k + 1) % prof.length];
        return Math.abs(p[1] - q[1]) > Math.abs(p[0] - q[0]) ? .30 : (p[1] <= -.11 && q[1] <= -.11 ? .18 : -1); });
      const tri3 = (A, B, C, fa, fb, fc, na, nb, nc) => {
        if (fa >= 0 && fb >= 0 && fc >= 0) { tri(A, B, C, na, nb, nc); return; }
        if (fa < 0 && fb < 0 && fc < 0) return;
        const P = [A, B, C], F = [fa, fb, fc], N = [na, nb, nc], poly = [];
        for (let i = 0; i < 3; i++) { const j = (i + 1) % 3;
          if (F[i] >= 0) poly.push([P[i], N[i]]);
          if ((F[i] >= 0) !== (F[j] >= 0)) { const t = F[i] / (F[i] - F[j]), L = (u, v) => u.map((x, k) => x + (v[k] - x) * t); poly.push([L(P[i], P[j]), L(N[i], N[j])]); } }
        for (let i = 1; i + 1 < poly.length; i++) tri(poly[0][0], poly[i][0], poly[i + 1][0], poly[0][1], poly[i][1], poly[i + 1][1]);
      };
      const quadClip = (A, B, C, D, n0, n1, fA, fB, fC, fD) => {   // A,B 在前一個斷面，C,D 在下一個斷面（A→B 是斷面上的一條邊）
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;   // 三角形繞向要跟法線同一邊（外面看得到）
        if (cx * n0[0] + cy * n0[1] + cz * n0[2] >= 0) { tri3(A, B, C, fA, fB, fC, n0, n0, n1); tri3(A, C, D, fA, fC, fD, n0, n1, n1); }
        else { tri3(A, C, B, fA, fC, fB, n0, n1, n0); tri3(A, D, C, fA, fD, fC, n0, n1, n1); }
      };
      runFrames.forEach(frames => {
        let r0 = ring(frames[0]), d0 = r0.map(v => Math.min(9, railJunction(v[0], v[2], frames[0].railOwner)));
        for (let i = 0; i + 1 < frames.length; i++) {
          const f0 = frames[i], f1 = frames[i + 1], r1 = ring(f1), d1 = r1.map(v => Math.min(9, railJunction(v[0], v[2], f1.railOwner)));
          for (let k = 0; k < prof.length; k++) {
            const k2 = (k + 1) % prof.length, [ex, ey] = edgeN[k], L = limits[k];
            const n0 = [ex * f0.nx, ey, ex * f0.nz], n1 = [ex * f1.nx, ey, ex * f1.nz];
            if (L < 0) { quad(r0[k], r0[k2], r1[k2], r1[k], n0, n1); continue; }
            quadClip(r0[k], r0[k2], r1[k2], r1[k], n0, n1, d0[k] - L, d0[k2] - L, d1[k2] - L, d1[k] - L);
          }
          r0 = r1; d0 = d1;
        }
        // 板件兩端：比直軌寬出來的那一圈要封起來（接直軌的地方看得到端面）
        if (opt.caps) for (const [f, sgn] of [[frames[0], -1], [frames[frames.length - 1], 1]]) {
          const n = [sgn * -f.nz, 0, sgn * f.nx], tx = -f.nz, tz = f.nx;            // 行進方向
          const P = (x, y) => [f.x + x * f.nx, H + y, f.z + x * f.nz];
          for (const sd of [-1, 1]) {
            const A = P(sd * .31, .302), B = P(sd * W, .302), Cc = P(sd * W, -.15), D = P(sd * .31, -.15);
            if (railJunction(f.x + sd * .37 * f.nx, f.z + sd * .37 * f.nz, f.railOwner) < .45) continue;   // 端面落在交會處（被另一條蓋住）
            const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
            const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
            if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) { tri(A, B, Cc, n, n, n); tri(A, Cc, D, n, n, n); } else { tri(A, Cc, B, n, n, n); tri(A, D, Cc, n, n, n); }
          }
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      const m = new THREE.Mesh(g, material); m.renderOrder = 1; m.castShadow = cast; m.frustumCulled = false; scene.add(m);
    };
    const rect = (cx, cy, hx, hy) => [[cx - hx, cy + hy], [cx + hx, cy + hy], [cx + hx, cy - hy], [cx - hx, cy - hy]];
    sweepMesh(PROF, mat(0xf1eee6, RAIL_LOOK), true);                                     // 白色板件本體（彎道、分岔、匯流）
    sweepMesh(rect(0, 0.274, 0.025, 0.01), mat(0x1b1f24, { roughness: 0.8 }), false, { offset: false });   // 供電線（藏在頂板下面 2 cm：不能也往鏡頭拉，不然遠一點看會透出頂板，變成一條黑線）
  }
  const N = samples.length;
  const grooveMat = mat(0x8a939b, { metalness: 0.5 }); grooveMat.userData.fineDetail = true;   // 外側溝槽：只在「高」畫質畫（scene.js applyGfx；遠看看不出來，卻有幾十萬個三角形）
  const parts = [ // [幾何, y 偏移, 側向偏移, 是否套用軌道顏色, 材質]
    [new THREE.BoxGeometry(1, 0.018, 0.62), 0.293, 0, true],       // 頂板
    [new THREE.BoxGeometry(1, 0.452, 0.023), 0.076, 0.2985, true],      // 側壁（內面 ±0.287，外面 ±0.31）
    [new THREE.BoxGeometry(1, 0.452, 0.023), 0.076, -0.2985, true],
    [new THREE.BoxGeometry(1, 0.03, 0.113), -0.135, 0.2305, true],  // 底部內翻邊（走行輪壓在這上面跑；縫 ±0.174）
    [new THREE.BoxGeometry(1, 0.03, 0.113), -0.135, -0.2305, true],
    [new THREE.BoxGeometry(1, 0.02, 0.05), 0.274, 0, false, mat(0x1b1f24, { roughness: 0.8 })],  // 供電線
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
  samples.forEach(([x0, z0, x1, z1, curve, owner], i) => {
    const ang = Math.atan2(-(z1 - z0), x1 - x0), len = Math.hypot(x1 - x0, z1 - z0);   // 彎道外緣比中心線長，片段要拉長一點才不會在外緣留下鋸齒缺口
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    d.rotation.set(0, ang, 0); d.scale.set(len, 1, 1);
    // 彎道段（淺綠）稍微抬高 3 mm、側壁往內縮 4 mm：分岔／合流處直軌和彎軌重疊時，兩片才不會在同一個平面上互相閃爍（Z-fighting）
    const lift = curve ? 0.003 : 0, inset = curve ? 0.004 : 0;
    for (const p of parts) {
      if (curve) { p.im.setMatrixAt(i, ZERO_M); if (p.colored) p.im.setColorAt(i, MINT); continue; }   // 彎道整個由連續曲面負責（本體、溝槽、供電線）
      const oz = p.oz ? p.oz - Math.sign(p.oz) * inset : 0;
      d.position.set(mx + oz * Math.sin(ang), H + p.oy + lift, mz + oz * Math.cos(ang));
      if(Math.abs(p.oz)>=.28&&railJunctionCavity(d.position.x,d.position.z,owner)){
        p.im.setMatrixAt(i,ZERO_M);if(p.colored)p.im.setColorAt(i,ALU);continue;
      }
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
  along(2, 1, f => [-0.27, 0.27].forEach(oz => { const x = f.x + oz * f.nx, z = f.z + oz * f.nz; if (clampOk(x, z)) clamps.push([x, H + 0.337, z, f.th]); }));
  placeInst(new THREE.BoxGeometry(0.12, 0.07, 0.07), mat(0xc9ced3, { metalness: 0.65, roughness: 0.3 }), clamps);
  // 吊架＋軌道上方固定座（每 4 公尺）
  const hangers = [], brackets = [];
  const hangOk = spaced(1.6);
  along(4, 0.5, f => { if (!hangOk(f.x, f.z)) return; hangers.push([f.x, (H + 0.4 + 10.5) / 2, f.z, 0, 10.5 - H - 0.4]);   /* 吊桿從固定座上面（H+0.4）往上到天花板，不能伸進軌道裡 */ brackets.push([f.x, H + 0.352, f.z, f.th]); });
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
