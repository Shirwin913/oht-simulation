// network.js — 軌道網路：4 個區塊（2×2），每個區塊是一套主幹線環＋Bay，區塊之間有連接線互相通車
//
// 佈局是參考一般晶圓廠 AMHS 的結構自行設計的通用版：
//   ・每個區塊：主幹線是一個長環線（北側直線往東、南側直線往西、兩端半圓），北側 5 條、南側 4 條 Bay
//   ・Bay：從主幹線分岔出去的細長迴圈，一條車道進去、轉 U 彎、另一條車道出來，再匯流回主幹線
//   ・左右相鄰的區塊：北側直線接到隔壁北側直線（往東）、南側直線接到隔壁南側直線（往西）
//   ・上下相鄰的區塊：區塊西端一條往南的連接線、東端一條往北的連接線
//   ・軌道是單向的：每段軌道（segment）都有起點節點與終點節點
// 位置的表示法：(segment, d) ＝ 在某一段軌道上、離該段起點 d 公尺

const ZONE_HALF = 36;     // 每個區塊主幹線直線段半長（直線從 cx-36 到 cx+36）
const MAIN_R = 2.5;       // 主幹線兩端半圓半徑（上下兩條直線相距 2 × MAIN_R）
const ZONE_GAP = 12;      // 左右兩個區塊主幹線直線末端之間的距離（連接線長度）
const ROW_GAP = 50;       // 上下兩排區塊主幹線中心線的距離
const BAY_W = 2.5;        // Bay 兩條車道離 Bay 中心線的距離（分岔到匯流 2×(BAY_W+BAY_R)：太短的話，在匯流點前等的車會擋住 Bay 入口，塞車時整圈卡死）
const BAY_R = 2.0;        // 從主幹線轉進／轉出 Bay 的彎道半徑（太小的話車身會掃到主幹線）
const LINK_R = 2.0;       // 上下區塊連接線的彎道半徑
const LINK_X = 32;        // 上下連接線離區塊中心的 x 距離（西端往南、東端往北）
// 4 個區塊：A 西北、B 東北、C 西南、D 東南
const ZONES = [
  { name: 'A', cx: -(ZONE_HALF + ZONE_GAP / 2), zc: -ROW_GAP / 2 }, { name: 'B', cx: ZONE_HALF + ZONE_GAP / 2, zc: -ROW_GAP / 2 },
  { name: 'C', cx: -(ZONE_HALF + ZONE_GAP / 2), zc: ROW_GAP / 2 }, { name: 'D', cx: ZONE_HALF + ZONE_GAP / 2, zc: ROW_GAP / 2 },
];
// 每個區塊北側 5 條、南側 4 條 Bay（x 為相對區塊中心）；len ＝ Bay 深度（U 彎中心離主幹線中心線的距離）
// 上排區塊南側、下排區塊北側的 Bay 會伸進兩排之間的走道，所以比較短
const BAY_XS_N = [-24, -12, 0, 12, 24], BAY_XS_S = [-18, -6, 6, 18];
const BAY_LENS = { outer: [18, 22, 20, 22, 18], inner: [16, 19, 19, 16] };
const CROSS_DX = null;    // 區塊內南北捷徑離區塊中心的 x 距離（null ＝ 不設捷徑，原因見下面）

// ---------- 基本圖元：直線、圓弧 ----------
function line(x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  return { len, curve: false, at: u => [x0 + (x1 - x0) * u / len, z0 + (z1 - z0) * u / len] };
}
function arc(cx, cz, r, a0, a1) {
  const len = r * Math.abs(a1 - a0);
  return { len, curve: true, at: u => { const a = a0 + (a1 - a0) * u / len; return [cx + r * Math.cos(a), cz + r * Math.sin(a)]; } };
}
// 一串圖元接成一條路徑：at(d) 位置、curveAt(d) 是否在彎道上
function chain(prims) {
  const len = prims.reduce((a, p) => a + p.len, 0);
  const find = d => { for (const p of prims) { if (d <= p.len) return [p, d]; d -= p.len; } const p = prims[prims.length - 1]; return [p, p.len]; };
  return { len, at: d => { const [p, u] = find(Math.max(0, d)); return p.at(u); }, curveAt: d => find(Math.max(0, d))[0].curve };
}

// ---------- 節點與軌道段 ----------
const nodes = [], segs = [];
const newNode = name => { const n = { id: nodes.length, name, in: [], out: [], def: null }; nodes.push(n); return n; };
function newSeg(path, from, to, kind, name) {
  const s = { id: segs.length, len: path.len, at: path.at, curveAt: path.curveAt, from, to, kind, name };
  segs.push(s); from.out.push(s); to.in.push(s);
  if (kind === 'main') from.def = s;                 // 沒有指定路線時，預設沿本區塊主幹線走
  else if (!from.def) from.def = s;
  return s;
}

// 區塊主幹線（一整圈）：從北側直線西端開始，往東 → 東端半圓 → 南側直線往西 → 西端半圓
function zoneMain(z) {
  const L = ZONE_HALF, R = MAIN_R, x = z.cx, c = z.zc;
  z.main = chain([
    line(x - L, c - R, x + L, c - R), arc(x + L, c, R, -Math.PI / 2, Math.PI / 2),
    line(x + L, c + R, x - L, c + R), arc(x - L, c, R, Math.PI / 2, 3 * Math.PI / 2),
  ]);
  z.sTop = wx => wx - (x - L);                                       // 北側直線上世界座標 wx 的里程
  z.sBot = wx => 2 * L + Math.PI * R + (x + L - wx);                 // 南側直線上
  z.marks = [];                                                      // 主幹線上的節點（之後依里程切段）
  z.mark = (s, name) => { const n = newNode(name); z.marks.push({ s, node: n }); return n; };
}

// Bay 迴圈的路徑（從主幹線分岔點到匯流點），北側／南側方向相反；x、zm 為世界座標
function bayPath(x, zm, len, north) {
  const w = BAY_W, r = BAY_R;
  if (north) {
    const z1 = zm - r, zEnd = zm - (len - MAIN_R);                  // zm ＝ 北側直線的 z
    return { branchX: x - w - r, mergeX: x + w + r, path: chain([
      arc(x - w - r, z1, r, Math.PI / 2, 0), line(x - w, z1, x - w, zEnd),
      arc(x, zEnd, w, Math.PI, 2 * Math.PI), line(x + w, zEnd, x + w, z1), arc(x + w + r, z1, r, Math.PI, Math.PI / 2),
    ]) };
  }
  const z1 = zm + r, zEnd = zm + (len - MAIN_R);                     // zm ＝ 南側直線的 z
  return { branchX: x + w + r, mergeX: x - w - r, path: chain([
    arc(x + w + r, z1, r, -Math.PI / 2, -Math.PI), line(x + w, z1, x + w, zEnd),
    arc(x, zEnd, w, 0, Math.PI), line(x - w, zEnd, x - w, z1), arc(x - w - r, z1, r, 0, -Math.PI / 2),
  ]) };
}

const bays = [], crosses = [], links = [];
ZONES.forEach(zoneMain);
ZONES.forEach((z, zi) => {
  const top = zi < 2;                                                 // 上排區塊
  let k = 0;
  BAY_XS_N.forEach((dx, i) => {
    const len = top ? BAY_LENS.outer[i] : [16, 19, 20, 19, 16][i];
    const p = bayPath(z.cx + dx, z.zc - MAIN_R, len, true);
    bays.push({ zone: z, name: z.name + (++k), x: z.cx + dx, len, north: true, ...p, maint: (zi === 0 && i === 0) || (zi === 3 && i === 4),   // 車輛維修區：A 區最西北角、D 區最東北角各一條
      branchNode: z.mark(z.sTop(p.branchX), `${z.name}${k}分岔`), mergeNode: z.mark(z.sTop(p.mergeX), `${z.name}${k}匯流`) });
  });
  BAY_XS_S.forEach((dx, i) => {
    const len = top ? BAY_LENS.inner[i] : [18, 22, 22, 18][i];
    const p = bayPath(z.cx + dx, z.zc + MAIN_R, len, false);
    bays.push({ zone: z, name: z.name + (++k), x: z.cx + dx, len, north: false, ...p,
      branchNode: z.mark(z.sBot(p.branchX), `${z.name}${k}分岔`), mergeNode: z.mark(z.sBot(p.mergeX), `${z.name}${k}匯流`) });
  });
  // 區塊內南北捷徑：Bay 每 12 公尺一條、每條佔 9 公尺，主幹線上找不到離所有分岔／匯流點夠遠的位置，
  // 太近的話剛轉進捷徑的車會跟剛轉進 Bay 的車撞在一起，所以區塊內不設捷徑（要回頭就走兩端半圓或連接線）
  if (CROSS_DX !== null) {
    const cx = z.cx + CROSS_DX;
    crosses.push({ zone: z, x: cx, zc: z.zc, branchNode: z.mark(z.sTop(cx), `${z.name}捷徑分岔`), mergeNode: z.mark(z.sBot(cx), `${z.name}捷徑匯流`) });
  }
});
// 左右相鄰區塊：北側直線末端 → 隔壁北側直線起點（往東）；隔壁南側直線末端 → 本區塊南側直線起點（往西）
[[0, 1], [2, 3]].forEach(([wi, ei]) => {
  const W = ZONES[wi], E = ZONES[ei], L = ZONE_HALF;
  links.push({ kind: 'east', from: W.mark(2 * L, `${W.name}→${E.name}出口`), to: E.mark(0, `${W.name}→${E.name}入口`),
    path: chain([line(W.cx + L, W.zc - MAIN_R, E.cx - L, E.zc - MAIN_R)]), name: `${W.name}→${E.name} 連接線` });
  links.push({ kind: 'west', from: E.mark(4 * L + Math.PI * MAIN_R, `${E.name}→${W.name}出口`), to: W.mark(2 * L + Math.PI * MAIN_R, `${E.name}→${W.name}入口`),
    path: chain([line(E.cx - L, E.zc + MAIN_R, W.cx + L, W.zc + MAIN_R)]), name: `${E.name}→${W.name} 連接線` });
});
// 上下相鄰區塊：西端從上排南側直線往南接到下排北側直線；東端從下排北側直線往北接到上排南側直線
[[0, 2], [1, 3]].forEach(([ni, si]) => {
  const N = ZONES[ni], S = ZONES[si], r = LINK_R;
  const xd = N.cx - LINK_X, zN = N.zc + MAIN_R, zS = S.zc - MAIN_R;            // 往南
  links.push({ kind: 'south', from: N.mark(N.sBot(xd + r), `${N.name}→${S.name}出口`), to: S.mark(S.sTop(xd + r), `${N.name}→${S.name}入口`),
    path: chain([arc(xd + r, zN + r, r, -Math.PI / 2, -Math.PI), line(xd, zN + r, xd, zS - r), arc(xd + r, zS - r, r, Math.PI, Math.PI / 2)]),
    name: `${N.name}→${S.name} 連接線` });
  const xu = N.cx + LINK_X;                                                     // 往北
  links.push({ kind: 'north', from: S.mark(S.sTop(xu - r), `${S.name}→${N.name}出口`), to: N.mark(N.sBot(xu - r), `${S.name}→${N.name}入口`),
    path: chain([arc(xu - r, zS - r, r, Math.PI / 2, 0), line(xu, zS - r, xu, zN + r), arc(xu - r, zN + r, r, 0, -Math.PI / 2)]),
    name: `${S.name}→${N.name} 連接線` });
});
// 依里程把每個區塊的主幹線切段
ZONES.forEach(z => {
  const marks = z.marks.sort((a, b) => a.s - b.s), M = z.main;
  marks.forEach((m, i) => {
    const n = marks[(i + 1) % marks.length];
    let len = n.s - m.s; if (len <= 0) len += M.len;
    const s0 = m.s, wrap = s => s0 + s >= M.len ? s0 + s - M.len : s0 + s;
    const sg = newSeg({ len, at: d => M.at(wrap(d)), curveAt: d => M.curveAt(wrap(d)) }, m.node, n.node, 'main', `${z.name} 區主幹線`);
    sg.zone = z;
  });
});
bays.forEach(b => { b.seg = newSeg(b.path, b.branchNode, b.mergeNode, 'bay', b.maint ? `Bay ${b.name}（車輛維修區）` : 'Bay ' + b.name); b.seg.zone = b.zone; b.seg.maint = !!b.maint; });
// 車輛維修區的捲揚機（Lifter）：在維修 Bay 進車道的正中間，把天車連同一小段軌道一起放到地面
const LIFTERS = bays.filter(b => b.maint).map((b, i) => ({ no: i + 1, name: `維修區 ${i + 1}`, bay: b, seg: b.seg,
  d: Math.PI / 2 * BAY_R + (b.len - MAIN_R - BAY_R) / 2, lat: 0, top: 0, busy: null, rail: 0 }));
const onLifter = (sg, d, r) => LIFTERS.some(L => L.seg === sg && Math.abs(d - L.d) < r);
crosses.forEach(c => { c.seg = newSeg(chain([arc(c.x, c.zc, MAIN_R, -Math.PI / 2, Math.PI / 2)]), c.branchNode, c.mergeNode, 'cross', `${c.zone.name} 區捷徑`); c.seg.zone = c.zone; });
links.forEach(l => { l.seg = newSeg(l.path, l.from, l.to, 'link', l.name); });
const mainSegs = segs.filter(s => s.kind === 'main');
const mergeNodes = nodes.filter(n => n.in.length > 1);
const MAIN_LEN = mainSegs.reduce((a, s) => a + s.len, 0);
const CROSS_X = crosses.map(c => c.x);

// ---------- 最短路徑（Floyd–Warshall）----------
// 軌道封鎖（seg.blocked）時要重算，被封鎖的段當成不存在
const N_ = nodes.length, DIST = [], NEXT = [];
for (let i = 0; i < N_; i++) { DIST.push(new Array(N_)); NEXT.push(new Array(N_)); }
function computeRoutes() {
  for (let i = 0; i < N_; i++) { DIST[i].fill(Infinity); NEXT[i].fill(null); DIST[i][i] = 0; }
  segs.forEach(s => { if (!s.blocked && s.len < DIST[s.from.id][s.to.id]) { DIST[s.from.id][s.to.id] = s.len; NEXT[s.from.id][s.to.id] = s; } });
  for (let k = 0; k < N_; k++) { const Dk = DIST[k]; for (let i = 0; i < N_; i++) { const Di = DIST[i], dik = Di[k]; if (dik === Infinity) continue; const Ni = NEXT[i];
    for (let j = 0; j < N_; j++) { const v = dik + Dk[j]; if (v < Di[j]) { Di[j] = v; Ni[j] = Ni[k]; } } } }
}
computeRoutes();
// 沒有指定路線時的下一段：預設主幹線；被封鎖就改走其他沒封鎖的出口
function nextDefault(seg) {
  const n = seg.to;
  if (n.def && !n.def.blocked) return n.def;
  return n.out.find(s => !s.blocked) || n.def;
}
// 從節點 a 走到節點 b 要經過哪些軌道段
function segPath(a, b) { const out = []; let n = a; while (n !== b) { const s = NEXT[n.id][b.id]; if (!s) return null; out.push(s); n = s.to; } return out; }

// 某段軌道上 d 處的姿態：位置、行進方向、天車座標轉角 th、側向單位向量 N（天車座標 +z）
function frameAt(seg, d) {
  const [x, z] = seg.at(d);
  let [x2, z2] = seg.at(Math.min(seg.len, d + 0.05)), dx = x2 - x, dz = z2 - z;
  if (Math.hypot(dx, dz) < 1e-6) { const [x0, z0] = seg.at(Math.max(0, d - 0.05)); dx = x - x0; dz = z - z0; }
  const l = Math.hypot(dx, dz) || 1, tx = dx / l, tz = dz / l;
  return { x, z, tx, tz, th: Math.atan2(-tz, tx), nx: -tz, nz: tx };
}

// ---------- 天車在軌道網路上的位置工具 ----------
// 天車位置：v.seg（目前軌道段）、v.d（離段起點距離）、v.prevSeg（上一段）、v.route（之後要走的軌道段）
// 沿天車前方路線列出接下來的軌道段：[{ seg, off }]，off ＝ 該段起點離天車的距離（第一段為負）
function pathAhead(v, maxDist) {
  const out = [{ seg: v.seg, off: -v.d }];
  let off = v.seg.len - v.d, seg = v.seg, i = 0;
  while (off < maxDist) { seg = i < v.route.length ? v.route[i++] : nextDefault(seg); out.push({ seg, off }); off += seg.len; }
  return out;
}
// 天車前方（off > 0）或後方（off < 0）某距離處的 [段, 段內距離]
function locAlong(v, off, pa) {
  if (off < 0) {
    const d = v.d + off;
    if (d >= 0 || !v.prevSeg) return [v.seg, Math.max(0, d)];
    return [v.prevSeg, Math.max(0, v.prevSeg.len + d)];
  }
  pa = pa || pathAhead(v, off + 0.1);
  for (let i = pa.length - 1; i >= 0; i--) if (off >= pa[i].off) return [pa[i].seg, Math.min(pa[i].seg.len, off - pa[i].off)];
  return [v.seg, v.d];
}
const pointAlong = (v, off, pa) => { const [s, d] = locAlong(v, off, pa); return s.at(d); };

// ---------- 分岔／匯流處要讓開多遠（開場時用車身矩形實際算，換佈局也會自動正確）----------
const BODY_HL = 1.12, BODY_HW = 0.53;   // 車身半長（含前後防撞板）、半寬
function bodyAt(seg, d) { const f = frameAt(seg, Math.max(0, Math.min(seg.len, d))); return { x: f.x, z: f.z, a: [f.tx, f.tz], b: [f.nx, f.nz] }; }
function bodiesOverlap(A, B, m = 0.08) {
  if (Math.abs(A.x - B.x) > 3 || Math.abs(A.z - B.z) > 3) return false;
  const hl = BODY_HL + m, hw = BODY_HW + m, dx = A.x - B.x, dz = A.z - B.z;
  for (const R of [A, B]) for (const ax of [R.a, R.b]) {
    const pa = hl * Math.abs(A.a[0] * ax[0] + A.a[1] * ax[1]) + hw * Math.abs(A.b[0] * ax[0] + A.b[1] * ax[1]);
    const pb = hl * Math.abs(B.a[0] * ax[0] + B.a[1] * ax[1]) + hw * Math.abs(B.b[0] * ax[0] + B.b[1] * ax[1]);
    if (Math.abs(dx * ax[0] + dz * ax[1]) > pa + pb) return false;
  }
  return true;
}
// 從某段起點往前 d 公尺（超過就沿預設下一段走）；從某段終點往回 d 公尺（超過就走回上一段）
function fwdPos(seg, d) { while (d > seg.len && seg.to.def) { d -= seg.len; seg = seg.to.def; } return bodyAt(seg, d); }
function backPos(seg, d) {
  while (d > seg.len && seg.from.in.length) { d -= seg.len; seg = seg.from.in.find(s => s.kind === 'main') || seg.from.in[0]; }
  return bodyAt(seg, seg.len - d);
}
// 分岔：天車走 own 這條分支時，另一條分支 sib 上前 clr 公尺內的車會跟自己車身重疊 → 要當成前車
nodes.forEach(n => {
  n.clr = new Map();
  if (n.out.length < 2) return;
  for (const own of n.out) for (const sib of n.out) if (own !== sib) {
    let clr = 0;
    for (let ds = 0; ds <= 10; ds += 0.1) {
      const S = fwdPos(sib, ds);
      for (let d0 = 0; d0 <= 8; d0 += 0.2) if (bodiesOverlap(S, fwdPos(own, d0))) { clr = ds; break; }
    }
    n.clr.set(own.id + '>' + sib.id, clr > 0 ? clr + 0.4 : 0);
  }
});
// 匯流：從 inSeg 進來、沒拿到鎖的車要停在離匯流點多遠，才不會跟另一條支線過來的車（或剛通過匯流點的車）重疊
nodes.forEach(n => {
  n.hold = new Map();
  if (n.in.length < 2) return;
  for (const a of n.in) {
    let need = 0;
    for (const b of n.in) if (b !== a) {
      const others = [];
      for (let db = 0; db <= 8; db += 0.2) others.push(backPos(b, db));
      for (let df = 0; df <= 6; df += 0.2) others.push(fwdPos(n.def || n.out[0], df));
      for (let da = 12; da >= 0; da -= 0.1) { const A = backPos(a, da); if (others.some(o => bodiesOverlap(A, o))) { need = Math.max(need, da); break; } }
    }
    n.hold.set(a.id, Math.max(2.5, need + 0.6));
  }
});
const MAX_HOLD = Math.max(...nodes.flatMap(n => [...n.hold.values()]), 0);
