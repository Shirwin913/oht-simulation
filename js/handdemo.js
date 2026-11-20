// handdemo.js — 看軌道教學：山形機構上手／下手、分岔怎麼判斷、換手時機、合流三角凸塊、換錯會怎樣、練習題
// 獨立的 2D 教學視窗（不影響模擬）。畫面用 SVG，每一步有自己的動畫（t：0→1）。
const HD_COL = { rail: '#d4a017', roller: '#fb923c', up: '#2dd4bf', down: '#fb7185', mid: '#facc15', track: '#475569', body: '#cbd5e1',
  path: '#a78bfa', zone: 'rgba(250,204,21,.16)', zoneLine: '#facc15', stop: '#ef4444', wedge: '#94a3b8', txt: '#e2e8f0', mut: '#94a3b8' };
let HD = null;   // { ch, step, t, playing, last, raf, quiz }

// ---------- 幾何小工具 ----------
function hdBez(p0, p1, p2, p3, n = 36) {
  const o = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t;
    o.push([u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0], u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]]); }
  return o;
}
function hdPoly(pts) { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i-1] + Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1])); return { pts, L, len: L[L.length-1] }; }
function hdAt(P, s) {
  s = Math.max(0, Math.min(P.len, s)); let i = 1; while (i < P.L.length - 1 && P.L[i] < s) i++;
  const a = P.pts[i-1], b = P.pts[i], k = (s - P.L[i-1]) / ((P.L[i] - P.L[i-1]) || 1);
  return { x: a[0] + (b[0]-a[0]) * k, y: a[1] + (b[1]-a[1]) * k, ang: Math.atan2(b[1]-a[1], b[0]-a[0]) };
}
function hdSAtX(P, x) { for (let s = 0; s <= P.len; s += 1) if (hdAt(P, s).x >= x) return s; return P.len; }
function hdOffset(pts, d) {   // 沿法線平移（彎軌偏支線側）
  return pts.map((p, i) => { const a = pts[Math.max(0, i-1)], b = pts[Math.min(pts.length-1, i+1)], l = Math.hypot(b[0]-a[0], b[1]-a[1]) || 1;
    return [p[0] - (b[1]-a[1]) / l * d, p[1] + (b[0]-a[0]) / l * d]; });
}
const hdD = pts => 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
const hdE = (t) => t < 0 ? 0 : t > 1 ? 1 : t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
const hdSeg = (t, a, b) => hdE((t - a) / (b - a));
const hdLerp = (a, b, k) => a + (b - a) * k;
const hdHandTxt = h => h < 0.15 ? '上手' : h > 0.85 ? '下手' : '換手中';
const hdHandCol = h => h < 0.15 ? HD_COL.up : h > 0.85 ? HD_COL.down : HD_COL.mid;

// ---------- 場景：分岔（俯視） ----------
const HD_Y0 = 150, HD_GS = 268, HD_DIV = 330, HD_LAST = 256;
function hdDivGeo(f) {
  const Y = HD_Y0 - f * 55;
  const br = hdBez([HD_DIV, Y], [420, Y], [468, Y + f*36], [496, Y + f*150]);
  const straight = hdPoly([[-90, Y], [760, Y]]);
  const turn = hdPoly([[-90, Y], [HD_DIV, Y], ...br.slice(1), [506, Y + f*240]]);
  const guide = [[HD_GS, Y + f*9], [HD_DIV, Y + f*9], ...hdOffset(br, f*9).slice(1)];
  return { f, Y, br, straight, turn, guide };
}
// ---------- 場景：合流（俯視） ----------
const HD_MERGE = 410;
function hdMerGeo(f) {
  const Y = HD_Y0 - f * 60;
  const br = hdBez([120, Y + f*150], [175, Y + f*70], [300, Y], [HD_MERGE, Y]);
  const route = hdPoly([[95, Y + f*230], ...br, [760, Y]]);
  const main = hdPoly([[-90, Y], [760, Y]]);
  const k = Math.round(br.length * 0.5), guide = [...hdOffset(br.slice(k), f*9), [460, Y + f*9]];
  const sW = 92;   // 三角凸塊在 route 上的位置
  return { f, Y, br, route, main, guide, sW };
}

// 畫一台俯視的天車：前輪組在 s，後輪組在 s-44；h=0 上手（兩導輪併在中間）、1 下手（分到兩邊）
function hdVeh(P, s, hf, hr, opt = {}) {
  const F = hdAt(P, s), R = hdAt(P, s - 44);
  let o = `<line x1="${R.x}" y1="${R.y}" x2="${F.x}" y2="${F.y}" stroke="${HD_COL.body}" stroke-width="22" stroke-linecap="round" opacity=".85"/>`;
  for (const [B, h, nm] of [[F, hf, '前'], [R, hr, '後']]) {
    const nx = -Math.sin(B.ang), ny = Math.cos(B.ang), d = 3 + 11 * h, c = hdHandCol(h);
    o += `<circle cx="${B.x}" cy="${B.y}" r="9" fill="#1e293b" stroke="${c}" stroke-width="2"/>`;
    for (const sg of [-1, 1]) o += `<circle cx="${(B.x + nx*d*sg).toFixed(1)}" cy="${(B.y + ny*d*sg).toFixed(1)}" r="3.4" fill="${HD_COL.roller}" stroke="#111" stroke-width=".6"/>`;
    o += `<text x="${(B.x - nx*22).toFixed(1)}" y="${(B.y - ny*22 + 4).toFixed(1)}" fill="${c}" font-size="11" font-weight="700" text-anchor="middle">${nm}</text>`;
  }
  if (opt.alarm) o += `<g><rect x="${F.x - 56}" y="${F.y + 20}" width="112" height="22" rx="4" fill="${HD_COL.stop}"/><text x="${F.x}" y="${F.y + 35}" fill="#fff" font-size="12" text-anchor="middle" font-weight="700">${opt.alarm}</text></g>`;
  if (opt.noSwitch) { const f = opt.f || 1, yy = R.y + f * 34 - 10; o += `<g><rect x="${R.x - 120}" y="${yy}" width="80" height="20" rx="4" fill="${HD_COL.stop}"/><text x="${R.x - 80}" y="${yy + 14}" fill="#fff" font-size="11.5" text-anchor="middle">不能換手 ✕</text></g>`; }
  return o;
}
function hdLbl(x, y, t, c = HD_COL.mut, a = 'start', sz = 12) { return `<text x="${x}" y="${y}" fill="${c}" font-size="${sz}" text-anchor="${a}">${t}</text>`; }

function hdDrawDiv(st) {
  const G = hdDivGeo(st.f || 1), f = G.f, Y = G.Y;
  let o = '';
  if (st.zone) o += `<rect x="108" y="${Y - 34}" width="${HD_LAST - 108}" height="68" rx="6" fill="${HD_COL.zone}" stroke="${HD_COL.zoneLine}" stroke-dasharray="5 4"/>`
    + `<line x1="${HD_LAST}" y1="${Y - 44}" x2="${HD_LAST}" y2="${Y + 44}" stroke="${HD_COL.stop}" stroke-width="2"/>`
    + hdLbl(182, Y - (f > 0 ? 42 : -54), '換手區', HD_COL.zoneLine, 'middle', 13) + hdLbl(HD_LAST, Y - (f > 0 ? 52 : -64), '最後換手點', HD_COL.stop, 'middle');
  o += `<path d="${hdD([[-10, Y], [660, Y]])}" stroke="${HD_COL.track}" stroke-width="32" fill="none"/>`;
  o += `<path d="${hdD(G.br)}" stroke="${HD_COL.track}" stroke-width="32" fill="none"/>`;
  o += `<path d="${hdD(G.guide)}" stroke="${HD_COL.rail}" stroke-width="${st.hiGuide ? 5 : 3.5}" fill="none" stroke-linecap="round"/>`;
  if (st.hiGuide) o += `<circle cx="${HD_GS}" cy="${Y + f*9}" r="7" fill="none" stroke="${HD_COL.rail}" stroke-width="2"/>`
    + hdLbl(HD_GS - 6, Y + f*(f > 0 ? 70 : 62), '彎軌起點（分岔點前一小段）', HD_COL.rail, 'end')
    + hdLbl(420, Y + f*(f > 0 ? 120 : 112), '彎軌：偏支線那一側', HD_COL.rail, 'end');
  o += `<circle cx="${HD_DIV}" cy="${Y}" r="4" fill="#fff"/>` + hdLbl(HD_DIV - 8, Y - f*24 + (f > 0 ? 0 : 8), '分岔點', '#fff', 'end');
  o += hdLbl(630, Y - f*24 + (f > 0 ? 0 : 8), '主線（直行）', HD_COL.mut, 'end') + hdLbl(535, Y + f*(f > 0 ? 140 : 132), '支線', HD_COL.mut);
  if (st.dest) { const P = st.dest === 'turn' ? G.turn : G.straight, e = st.dest === 'turn' ? hdAt(G.turn, hdSAtX(G.turn, 482)) : { x: 600, y: Y };
    o += `<path d="${hdD(P.pts.filter(p => p[0] > 30 && p[0] < 610))}" stroke="${HD_COL.path}" stroke-width="2" stroke-dasharray="6 5" fill="none"/>`
      + `<g><rect x="${e.x - 34}" y="${e.y + (st.dest === 'turn' ? f*0 - 11 : -40)}" width="68" height="22" rx="11" fill="${HD_COL.path}"/>${hdLbl(e.x, e.y + (st.dest === 'turn' ? 4 : -25), '目的地', '#1e1b4b', 'middle')}</g>`; }
  if (st.veh) { const P = st.route === 'turn' ? G.turn : G.straight; o += hdVeh(P, st.s, st.hf, st.hr, { alarm: st.alarm, noSwitch: st.noSwitch, f }); }
  if (st.both) {   // 口訣：兩台車同時示範
    o += hdVeh(G.turn, st.s, 1, 1) + hdVeh(G.straight, st.s, 0, 0);
    o += hdLbl(600, Y - f*30 + (f > 0 ? 0 : 10), '上手 → 直行', HD_COL.up, 'end', 14) + hdLbl(370, Y + f*(f > 0 ? 120 : 112), '下手 → 轉彎', HD_COL.down, 'end', 14);
  }
  return o;
}
function hdDrawMer(st) {
  const G = hdMerGeo(st.f || 1), f = G.f, Y = G.Y;
  let o = '';
  if (st.zone) o += `<rect x="470" y="${Y - 34}" width="130" height="68" rx="6" fill="${HD_COL.zone}" stroke="${HD_COL.zoneLine}" stroke-dasharray="5 4"/>`
    + hdLbl(535, Y - f*44 + (f > 0 ? 0 : 10), st.zoneTxt || '換手區（看下一個分岔）', HD_COL.zoneLine, 'middle');
  o += `<path d="${hdD([[-10, Y], [660, Y]])}" stroke="${HD_COL.track}" stroke-width="32" fill="none"/>`;
  o += `<path d="${hdD([[95, Y + f*230], ...G.br])}" stroke="${HD_COL.track}" stroke-width="32" fill="none"/>`;
  o += `<path d="${hdD(G.guide)}" stroke="${HD_COL.rail}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  const W = hdAt(G.route, G.sW), ca = Math.cos(W.ang), sa = Math.sin(W.ang), nx = -sa, ny = ca;
  const tip = [W.x - ca*12, W.y - sa*12], b1 = [W.x + ca*12 + nx*13, W.y + sa*12 + ny*13], b2 = [W.x + ca*12 - nx*13, W.y + sa*12 - ny*13];
  o += `<polygon points="${[tip, b1, b2].map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="${HD_COL.wedge}" stroke="#e2e8f0" stroke-width="${st.hiWedge ? 2 : .8}"/>`;
  o += hdLbl(W.x + (f > 0 ? 24 : 26), W.y + f*(f > 0 ? 6 : 0) + 4, '三角凸塊（尖角朝來車）', st.hiWedge ? '#fff' : HD_COL.mut);
  o += `<circle cx="${HD_MERGE}" cy="${Y}" r="4" fill="#fff"/>` + hdLbl(HD_MERGE, Y - f*26 + (f > 0 ? 0 : 8), '合流點', '#fff', 'middle');
  o += hdLbl(24, Y - f*24 + (f > 0 ? 0 : 8), '主線 →', HD_COL.mut) + hdLbl(100, Y + f*(f > 0 ? 112 : 104), '支線來車 →', HD_COL.mut, 'end');
  if (st.veh) o += hdVeh(G.route, st.s, st.hf, st.hr, { names: true });
  if (st.mainVeh) o += hdVeh(G.main, st.ms, 0, 0, { names: true });
  return o;
}

// ---------- 場景：橫切面（順著行進方向看） ----------
// h：0 上手、1 下手；rail：彎軌往支線側移動的量；side：支線在右(1)或左(-1)；wedge：三角凸塊的切面寬度；stuck：換手卡在一半
function hdDrawCs(st) {
  const cx = 320, side = st.side || 1, h = st.h, rail = st.rail || 0;
  const railX = cx + side * 44 + side * rail;                         // 彎軌中心
  const veh = h > 0.85 ? side * Math.max(0, rail - 11) : 0;           // 下手：支線側導輪在彎軌外側，彎軌移過來就把車推過去
  const vx = cx + veh;
  let o = `<text x="${cx - 120}" y="34" fill="${HD_COL.mut}" font-size="12" text-anchor="middle">${side > 0 ? '直行側' : '支線側'}</text><text x="${cx + 120}" y="34" fill="${HD_COL.mut}" font-size="12" text-anchor="middle">${side > 0 ? '支線側' : '直行側'}</text>`;
  o += `<path d="M${cx - 50} 222 L${cx - 140} 222 L${cx - 140} 46 L${cx + 140} 46 L${cx + 140} 222 L${cx + 50} 222" stroke="#64748b" stroke-width="6" fill="none" stroke-linejoin="round"/>`;
  o += `<rect x="${railX - 6}" y="49" width="12" height="78" fill="${HD_COL.rail}"/>`;
  if (st.wedge) o += `<rect x="${vx - st.wedge/2}" y="49" width="${st.wedge}" height="58" fill="${HD_COL.wedge}" stroke="#e2e8f0" stroke-width="1"/>`;
  o += `<g transform="translate(${veh},0)">`;
  o += `<rect x="${cx - 96}" y="176" width="192" height="22" rx="4" fill="#334155" stroke="#64748b"/>`;
  o += `<circle cx="${cx - 82}" cy="206" r="13" fill="#0f172a" stroke="#64748b" stroke-width="2"/><circle cx="${cx + 82}" cy="206" r="13" fill="#0f172a" stroke="#64748b" stroke-width="2"/>`;
  o += `<polygon points="${cx - 76},176 ${cx + 76},176 ${cx},112" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1.2"/>`;
  o += `<text x="${cx}" y="160" fill="#dbeafe" font-size="13" text-anchor="middle">山形機構</text>`;
  const rx = hdLerp(11, 68, h), ry = hdLerp(92, 130, h), postH = hdLerp(18, 42, h);
  for (const sg of [-1, 1]) {
    o += `<rect x="${cx + sg*rx - 6}" y="${ry + 6}" width="12" height="${postH}" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1"/>`;
    o += `<circle cx="${cx + sg*rx}" cy="${ry}" r="9" fill="${st.stuck ? HD_COL.stop : HD_COL.roller}" stroke="#111" stroke-width="1"/>`;
  }
  o += `<rect x="${cx - 18}" y="198" width="36" height="44" fill="#334155"/><rect x="${cx - 74}" y="242" width="148" height="34" rx="6" fill="#334155" stroke="#64748b"/>`;
  o += `<text x="${cx}" y="263" fill="${HD_COL.mut}" font-size="12" text-anchor="middle">天車本體</text></g>`;
  o += `<text x="${cx}" y="296" fill="${hdHandCol(h)}" font-size="15" font-weight="700" text-anchor="middle">${st.stuck ? '換手卡在一半 ✕' : hdHandTxt(h)}</text>`;
  if (st.labels) o += hdLbl(railX + side*14, 70, '彎軌', HD_COL.rail, side > 0 ? 'start' : 'end') + hdLbl(cx - 150, 212, '走行輪', HD_COL.mut, 'end') + hdLbl(cx - 150, 90, '導輪', HD_COL.roller, 'end')
    + `<line x1="${cx - 146}" y1="86" x2="${cx - rx - 10}" y2="${ry}" stroke="${HD_COL.mut}" stroke-dasharray="3 3"/>` + hdLbl(cx + 150, 214, '軌道槽（倒 U 型）', HD_COL.mut);
  if (st.wedge) o += hdLbl(vx, 40, '三角凸塊的切面（越往前越寬）', '#e2e8f0', 'middle');
  if (Math.abs(veh) > 2) o += `<text x="${cx + side*175}" y="150" fill="${HD_COL.path}" font-size="22" text-anchor="middle">${side > 0 ? '➜' : '⬅'}</text>`;
  return o;
}

// ---------- 教學內容 ----------
const HD_CH = [
  { name: '1. 認識山形機構', steps: [
    { scene: 'cs', dur: 0.1, t: '橫切面', x: '這是順著行進方向往前看的切面。軌道是倒 U 型的槽，天車的走行輪在槽底兩邊走，車身從中間的縫吊在下面。<br>分岔、合流段的槽頂，會在<b>支線那一側</b>多一條往下凸的「彎軌」。', st: () => ({ h: 0, labels: true }) },
    { scene: 'cs', dur: 0.1, t: '上手', x: '車頂的「山形機構」是一個三角形，上面有兩個導輪。<br><b class="up">上手</b>：兩個導輪併在三角形<b>頂端</b>，位置高、靠中間，都在彎軌的<b>內側</b>（直行側）。', st: () => ({ h: 0 }) },
    { scene: 'cs', dur: 2.2, t: '切成下手', x: '換手時，兩個導輪沿著三角形斜面往下、往兩邊分開。<br><b class="down">下手</b>：導輪在三角形<b>底部兩端</b>，位置低、間距寬。', st: t => ({ h: hdSeg(t, .1, .9) }) },
    { scene: 'cs', dur: 3, t: '下手 → 被導引轉彎', x: '下手時，支線側的導輪落在彎軌<b>外側</b>。天車往前走，彎軌往支線彎過去，就把這個導輪往支線推，天車跟著轉進支線。', st: t => ({ h: 1, rail: 46 * hdSeg(t, .1, .9) }) },
    { scene: 'cs', dur: 3, t: '上手 → 直行', x: '上手時兩個導輪都在彎軌<b>內側</b>。彎軌往支線彎開，碰不到導輪，天車繼續直行。<br>口訣：<b class="down">轉彎下手</b>、<b class="up">直行上手</b>。', st: t => ({ h: 0, rail: 60 * hdSeg(t, .1, .9) }) },
    { scene: 'cs', dur: 3, t: '支線在另一邊也一樣', x: '支線可能往左分、也可能往右分，彎軌就在支線那一側。下手時兩個導輪都往兩邊分開，所以不管彎軌在哪一邊，都有一個導輪落在它外側。', st: t => ({ h: 1, side: -1, rail: 46 * hdSeg(t, .1, .9) }) },
  ] },
  { name: '2. 分岔怎麼判斷', steps: [
    { scene: 'div', dur: 0.1, t: '看分岔', x: '抬頭看分岔：主線直直往前，支線從旁邊彎出去。<br>彎軌在槽裡<b>偏支線那一側</b>，而且在分岔點<b>前一小段</b>就開始了。', st: () => ({ hiGuide: true }) },
    { scene: 'div', dur: 5, t: '要進支線 → 下手', x: '這台車的目的地在支線：用<b class="down">下手</b>。導輪吃到彎軌外側，被彎軌帶進支線。<br>（俯視圖上，下手＝兩個橘色導輪分開到兩邊）', st: t => ({ dest: 'turn', veh: true, route: 'turn', s: hdLerp(60, 700, hdSeg(t, 0, 1)), hf: 1, hr: 1 }) },
    { scene: 'div', dur: 5, t: '要直行 → 上手', x: '目的地在主線前方：用<b class="up">上手</b>。導輪併在中間、在彎軌內側，彎軌彎開，天車直直過去。', st: t => ({ dest: 'straight', veh: true, route: 'straight', s: hdLerp(60, 780, hdSeg(t, 0, 1)), hf: 0, hr: 0 }) },
    { scene: 'div', dur: 5, t: '支線往另一邊分', x: '支線往左或往右分，判斷方法都一樣：看天車<b>要不要進支線</b>。要進支線就下手，不進就上手。', st: t => ({ f: -1, dest: 'turn', veh: true, route: 'turn', s: hdLerp(60, 700, hdSeg(t, 0, 1)), hf: 1, hr: 1 }) },
    { scene: 'div', dur: 5, t: '口訣', x: '<b class="down">轉彎下手</b>、<b class="up">直行上手</b>。<br>判斷的依據是「這台車接下來要往哪走」，不是它現在在哪條線上。', st: t => ({ both: true, s: hdLerp(60, 560, hdSeg(t, 0, 1)) }) },
  ] },
  { name: '3. 換手的時機', steps: [
    { scene: 'div', dur: 0.1, t: '換手區', x: '換手要在<b>彎軌起點之前</b>完成，而且<b>前、後兩組輪子都還在直線段</b>。<br>黃色是換手區，紅線是最後換手點：過了紅線，導輪就要碰到彎軌了。', st: () => ({ zone: true, hiGuide: true, veh: true, route: 'turn', s: 150, hf: 0, hr: 0 }) },
    { scene: 'div', dur: 6, t: '在換手區換好', x: '這台車要進支線，目前是上手。開進換手區後，前、後輪組一起換成下手，換好了才通過最後換手點。', st: t => { const k = hdSeg(t, .25, .45); return { zone: true, dest: 'turn', veh: true, route: 'turn', s: t < .25 ? hdLerp(150, 250, hdE(t / .25)) : t < .45 ? 250 : hdLerp(250, 700, hdSeg(t, .45, 1)), hf: k, hr: k }; } },
    { scene: 'div', dur: 6, t: '前輪組先、後輪組後', x: '前輪組先碰到彎軌，後輪組隔一個車身才到。兩組的山形都要在<b>前輪組</b>到最後換手點之前換好；只換好一組也算換手失敗。', st: t => ({ zone: true, hiGuide: true, veh: true, route: 'turn', s: hdLerp(240, 420, hdSeg(t, 0, 1)), hf: 1, hr: 1 }) },
    { scene: 'div', dur: 0.1, t: '彎道內不能換手', x: '前車或後車在彎道裡時，導輪正卡著彎軌，<b>不能換手</b>，也不能歸原點、切上線。<br>現場排除時，要先把車寸動到直線段（操作介面上「前車／後車：直線」）再換。', st: () => ({ veh: true, route: 'turn', s: 482, hf: 1, hr: 1, noSwitch: true }) },
  ] },
  { name: '4. 合流：三角凸塊', steps: [
    { scene: 'mer', dur: 3, t: '支線來車', x: '從支線要合流回主線的車，合流前的槽裡有一個<b>三角形凸塊</b>，尖角朝著來車。<br>這台車現在是<b class="up">上手</b>。', st: t => ({ hiWedge: true, veh: true, s: hdLerp(40, 76, hdSeg(t, 0, 1)), hf: 0, hr: 0 }) },
    { scene: 'cs', dur: 3.5, t: '凸塊把山形切開', x: '天車往前走，凸塊越來越寬，尖角從兩個併在一起的導輪<b>中間插進去</b>，把它們往兩邊撐開——上手被<b>強制切成下手</b>。<br>這是機構硬切的，不是天車自己換手。', st: t => { const w = 150 * hdSeg(t, .05, .9); return { wedge: w, h: Math.max(0, Math.min(1, (w / 2 - 6) / 60)) }; } },
    { scene: 'mer', dur: 5, t: '下手吃彎軌 → 合流', x: '變成<b class="down">下手</b>後，導輪吃到彎軌外側，被導引順著彎道合流進主線。', st: t => { const s = hdLerp(76, 470, hdSeg(t, 0, 1)), k = (x) => Math.max(0, Math.min(1, (x - 84) / 16)); return { veh: true, s, hf: k(s), hr: k(s - 44) }; } },
    { scene: 'mer', dur: 6, t: '合流後看下一個分岔', x: '合流後在主線直線段，看<b>下一個分岔</b>決定：下一個要直行就<b class="up">換回上手</b>；要轉彎就<b class="down">保持下手</b>。<br>這裡示範下一個要直行。', st: t => { const s = hdLerp(470, 800, hdSeg(t, 0, 1)), k = 1 - hdSeg(t, .25, .45); return { zone: true, zoneTxt: '下一個直行 → 換回上手', veh: true, s: t > .25 && t < .45 ? 560 : t <= .25 ? hdLerp(470, 560, hdE(t / .25)) : hdLerp(560, 800, hdSeg(t, .45, 1)), hf: k, hr: k }; } },
    { scene: 'mer', dur: 5, t: '主線來車不受影響', x: '三角凸塊只在<b>支線</b>的槽裡。主線直行過來的車碰不到它，維持原本的手（這台是上手）。', st: t => ({ mainVeh: true, ms: hdLerp(60, 800, hdSeg(t, 0, 1)) }) },
  ] },
  { name: '5. 換錯會怎樣', steps: [
    { scene: 'div', dur: 4, t: '沒換好就停車', x: '天車到最後換手點前會確認山形位置。該進支線卻還是<b class="up">上手</b>（或只換好一組），就會停在彎軌前報 <b>E-105 換手失敗</b>，不會硬闖。', st: t => { const s = hdLerp(60, 286, hdSeg(t, 0, .8)); return { zone: true, dest: 'turn', veh: true, route: 'turn', s, hf: 0, hr: 0, alarm: t > .82 ? 'E-105 換手失敗' : '' }; } },
    { scene: 'cs', dur: 3, t: '卡在一半最危險', x: '如果導輪停在斜面中間，兩邊都沒吃好彎軌：進去可能撞到彎軌，或被帶到錯的路線。所以換手沒到位一定要停車。', st: t => ({ h: .5, stuck: true, rail: 30 * hdSeg(t, .1, .9) }) },
    { scene: 'div', dur: 0.1, t: '現場怎麼排除', x: '<ol><li>操作介面「警報清除」，天車切手動</li><li>看「前手／後手」目前是上手還是下手</li><li>確認前車、後車都在<b>直線</b>（不在彎道內）</li><li>手動換到需要的手（這裡要下手）</li><li>選有／無 FOUP → 歸原點 → 切上線</li></ol>', st: () => ({ zone: true, veh: true, route: 'turn', s: 286, hf: 0, hr: 0, alarm: 'E-105 換手失敗' }) },
  ] },
  { name: '6. 練習題', quiz: true, steps: [] },
];

// ---------- 練習題 ----------
function hdQuizNew() {
  const f = Math.random() < .5 ? 1 : -1, kind = ['div', 'div', 'wedge', 'after', 'curve'][Math.floor(Math.random() * 5)];
  if (kind === 'div') { const dest = Math.random() < .5 ? 'turn' : 'straight';
    return { kind, f, dest, q: `這台天車要${dest === 'turn' ? '<b>進支線</b>' : '<b>直行</b>'}（看紫色虛線和「目的地」）。到換手區要切成？`, opts: ['上手', '下手'], ans: dest === 'turn' ? 1 : 0,
      why: dest === 'turn' ? '要進支線＝轉彎，用下手：導輪吃彎軌外側，被帶進支線。' : '直行用上手：導輪在彎軌內側，彎軌彎開碰不到。' }; }
  if (kind === 'wedge') return { kind, f, q: '支線來的天車現在是<b>上手</b>，經過合流前的三角凸塊後會？', opts: ['變成下手', '維持上手', '停車報警'], ans: 0,
    why: '三角凸塊的尖角從兩個導輪中間插進去，把它們撐開，上手被強制切成下手。' };
  if (kind === 'after') { const nx = Math.random() < .5 ? 'turn' : 'straight';
    return { kind, f, nx, q: `天車剛從支線合流進主線（現在是下手）。下一個分岔要<b>${nx === 'turn' ? '轉彎' : '直行'}</b>，天車要？`, opts: ['換回上手', '保持下手'], ans: nx === 'turn' ? 1 : 0,
      why: nx === 'turn' ? '下一個要轉彎，就保持下手。' : '下一個要直行，在直線段換回上手。' }; }
  return { kind, f, q: '天車的<b>前輪組已經在彎道裡</b>，發現手不對，可以現在換手嗎？', opts: ['可以，馬上換', '不行，先寸動到直線段再換'], ans: 1,
    why: '彎道內導輪卡著彎軌，不能換手。要先把前、後車都移到直線段。' };
}
function hdQuizState(q, t) {
  if (!q) return { scene: 'div', st: { hiGuide: true } };
  const done = q.picked != null, ok = done && q.picked === q.ans;
  if (q.kind === 'div') {
    if (!done) return { scene: 'div', st: { f: q.f, zone: true, dest: q.dest, veh: true, route: q.dest, s: 150, hf: 0, hr: 0 } };
    const want = q.dest === 'turn' ? 1 : 0, chose = q.picked === 1 ? 1 : 0, k = hdSeg(t, .2, .35) * chose;
    if (!ok && q.dest === 'turn') return { scene: 'div', st: { f: q.f, zone: true, dest: q.dest, veh: true, route: 'turn', s: hdLerp(150, 286, hdSeg(t, 0, .7)), hf: 0, hr: 0, alarm: t > .72 ? 'E-105 換手失敗' : '' } };
    if (!ok) return { scene: 'div', st: { f: q.f, zone: true, dest: q.dest, veh: true, route: 'turn', s: t < .2 ? hdLerp(150, 230, hdE(t / .2)) : t < .35 ? 230 : hdLerp(230, 700, hdSeg(t, .35, 1)), hf: k, hr: k, alarm: t > .7 ? '走錯路：進了支線' : '' } };
    return { scene: 'div', st: { f: q.f, zone: true, dest: q.dest, veh: true, route: q.dest, s: t < .2 ? hdLerp(150, 230, hdE(t / .2)) : t < .35 ? 230 : hdLerp(230, 760, hdSeg(t, .35, 1)), hf: want * hdSeg(t, .2, .35), hr: want * hdSeg(t, .2, .35) } };
  }
  if (q.kind === 'wedge') { const s = done ? hdLerp(40, 470, hdSeg(t, 0, 1)) : 50, k = x => Math.max(0, Math.min(1, (x - 84) / 16));
    return { scene: 'mer', st: { f: q.f, hiWedge: true, veh: true, s, hf: k(s), hr: k(s - 44) } }; }
  if (q.kind === 'after') { const keep = q.nx === 'turn', s = done ? hdLerp(470, 800, hdSeg(t, 0, 1)) : 470, k = keep ? 1 : 1 - hdSeg(t, .3, .5);
    return { scene: 'mer', st: { f: q.f, zone: true, zoneTxt: q.nx === 'turn' ? '下一個要轉彎' : '下一個要直行', veh: true, s, hf: k, hr: k } }; }
  return { scene: 'div', st: { f: q.f, veh: true, route: 'turn', s: 482, hf: 0, hr: 0, noSwitch: done } };
}

// ---------- 視窗 ----------
function openHandDemo(ch = 0) {
  let el = document.getElementById('handDemo');
  if (!el) {
    el = document.createElement('div'); el.id = 'handDemo'; document.body.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-hd]'); if (!b) return;
      const a = b.dataset.hd;
      if (a === 'close') return closeHandDemo();
      if (a.startsWith('ch:')) return hdGo(+a.slice(3), 0);
      if (a === 'prev') return hdGo(HD.ch, HD.step - 1);
      if (a === 'next') return HD.step + 1 < HD_CH[HD.ch].steps.length ? hdGo(HD.ch, HD.step + 1) : HD.ch + 1 < HD_CH.length && hdGo(HD.ch + 1, 0);
      if (a === 'replay') { HD.t = 0; HD.playing = true; return; }
      if (a.startsWith('ans:')) { const q = HD.quiz; if (!q || q.picked != null) return; q.picked = +a.slice(4); HD.score[1]++; if (q.picked === q.ans) HD.score[0]++; HD.t = 0; HD.playing = true; return hdPanel(); }
      if (a === 'newq') { HD.quiz = hdQuizNew(); HD.t = 0; HD.playing = false; return hdPanel(); }
    });
  }
  HD = { ch: 0, step: 0, t: 0, playing: true, last: 0, raf: 0, quiz: null, score: [0, 0] };
  el.style.display = 'flex';
  el.innerHTML = `<div class="hdwin"><div class="hdhd"><span>看軌道：山形機構 上手／下手</span><button data-hd="close" title="關閉">✕</button></div>
    <div class="hdtabs">${HD_CH.map((c, i) => `<button data-hd="ch:${i}">${c.name}</button>`).join('')}</div>
    <div class="hdbd"><svg id="hdSvg" viewBox="0 0 640 300"></svg><div class="hdside" id="hdSide"></div></div></div>`;
  hdGo(ch, 0);
  HD.last = performance.now(); HD.raf = requestAnimationFrame(hdLoop);
}
function closeHandDemo() { const el = document.getElementById('handDemo'); if (el) el.style.display = 'none'; if (HD) cancelAnimationFrame(HD.raf); HD = null; }
function hdGo(ch, step) {
  const C = HD_CH[ch]; if (!C) return;
  HD.ch = ch; HD.step = Math.max(0, Math.min(step, Math.max(0, C.steps.length - 1))); HD.t = 0; HD.playing = true;
  if (C.quiz && !HD.quiz) HD.quiz = hdQuizNew();
  document.querySelectorAll('#handDemo .hdtabs button').forEach((b, i) => b.classList.toggle('cur', i === ch));
  hdPanel(); hdRender();
}
function hdPanel() {
  const C = HD_CH[HD.ch], side = document.getElementById('hdSide'); if (!side) return;
  const lamp = `<div class="hdlamps" id="hdLamps"></div>`;
  if (C.quiz) {
    const q = HD.quiz, done = q.picked != null;
    side.innerHTML = `<div class="hdt">練習題 <span class="hdsc">答對 ${HD.score[0]}／${HD.score[1]}</span></div><div class="hdx">${q.q}</div>
      <div class="hdopts">${q.opts.map((o, i) => `<button data-hd="ans:${i}" class="${done ? (i === q.ans ? 'ok' : i === q.picked ? 'ng' : '') : ''}" ${done ? 'disabled' : ''}>${o}</button>`).join('')}</div>
      ${done ? `<div class="hdres ${q.picked === q.ans ? 'ok' : 'ng'}">${q.picked === q.ans ? '✔ 答對了！' : '✘ 不對喔。'}${q.why}</div>` : ''}
      ${lamp}<div class="hdctl"><button data-hd="replay" ${done ? '' : 'disabled'}>↻ 重播</button><button data-hd="newq" class="pri">下一題 ▶</button></div>`;
    return;
  }
  const S = C.steps[HD.step];
  side.innerHTML = `<div class="hdt">${S.t}</div><div class="hdx">${S.x}</div>${lamp}
    <div class="hddots">${C.steps.map((s, i) => `<i class="${i === HD.step ? 'cur' : i < HD.step ? 'done' : ''}"></i>`).join('')}<span>${HD.step + 1}／${C.steps.length}</span></div>
    <div class="hdctl"><button data-hd="prev" ${HD.step === 0 ? 'disabled' : ''}>◀ 上一步</button><button data-hd="replay">↻ 重播</button>
    <button data-hd="next" class="pri" ${HD.step + 1 >= C.steps.length && HD.ch + 1 >= HD_CH.length ? 'disabled' : ''}>${HD.step + 1 >= C.steps.length ? '下一章 ▶' : '下一步 ▶'}</button></div>`;
}
function hdCur() {
  const C = HD_CH[HD.ch];
  if (C.quiz) { const r = hdQuizState(HD.quiz, HD.t); return { scene: r.scene, st: r.st, dur: 5 }; }
  const S = C.steps[HD.step]; return { scene: S.scene, st: S.st(HD.t), dur: S.dur };
}
function hdRender() {
  const svg = document.getElementById('hdSvg'); if (!svg || !HD) return;
  const { scene, st } = hdCur();
  svg.innerHTML = scene === 'cs' ? hdDrawCs(st) : scene === 'mer' ? hdDrawMer(st) : hdDrawDiv(st);
  const L = document.getElementById('hdLamps');
  if (L) { const hs = scene === 'cs' ? [['山形', st.h]] : (st.veh ? [['前手', st.hf], ['後手', st.hr]] : st.mainVeh ? [['前手', 0], ['後手', 0]] : []);
    L.innerHTML = hs.map(([n, h]) => `<span><i style="background:${hdHandCol(h)};box-shadow:0 0 8px ${hdHandCol(h)}"></i>${n}：${st.stuck ? '卡住' : hdHandTxt(h)}</span>`).join(''); }
}
function hdLoop(now) {
  if (!HD) return;
  const dt = Math.min(0.1, (now - HD.last) / 1000); HD.last = now;
  if (HD.playing) { const { dur } = hdCur(); HD.t = Math.min(1, HD.t + dt / dur); if (HD.t >= 1) HD.playing = false; hdRender(); }
  HD.raf = requestAnimationFrame(hdLoop);
}
