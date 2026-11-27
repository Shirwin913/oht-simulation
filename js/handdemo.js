// handdemo.js — 看軌道教學：軌道構造（抬頭看）、山形機構上手／下手、分岔怎麼判斷、換手時機、合流三角凸塊、換錯會怎樣、練習題
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
  // 俯視（照現場人員畫的示意圖）：車身兩側是走行輪；每組走行部有 2×2 顆換手輪，
  // 上手時集中在中間（彎軌內側）、下手時分到車身兩邊（支線側那排在彎軌外側）。彎軌掛在車頂上方，車身畫半透明看得到。
  const F = hdAt(P, s), R = hdAt(P, s - 44);
  let o = `<line x1="${R.x}" y1="${R.y}" x2="${F.x}" y2="${F.y}" stroke="#4472c4" stroke-width="22" stroke-linecap="butt" opacity=".55"/>`;
  const ext = 7, ux = (F.x - R.x) / 44, uy = (F.y - R.y) / 44;
  o += `<line x1="${R.x - ux*ext}" y1="${R.y - uy*ext}" x2="${F.x + ux*ext}" y2="${F.y + uy*ext}" stroke="#4472c4" stroke-width="22" opacity=".55"/>`;
  for (const [B, h, nm] of [[F, hf, '前'], [R, hr, '後']]) {
    const tx = Math.cos(B.ang), ty = Math.sin(B.ang), nx = -ty, ny = tx, c = hdHandCol(h), deg = B.ang * 180 / Math.PI;
    for (const sg of [-1, 1]) o += `<rect x="${(B.x + nx*16.5*sg - 5).toFixed(1)}" y="${(B.y + ny*16.5*sg - 1.8).toFixed(1)}" width="10" height="3.6" rx="1" fill="#f8fafc" stroke="#0b1220" stroke-width=".8" transform="rotate(${deg.toFixed(1)} ${(B.x + nx*16.5*sg).toFixed(1)} ${(B.y + ny*16.5*sg).toFixed(1)})"/>`;
    const d = hdLerp(3, 13, h);
    for (const sg of [-1, 1]) for (const a of [-3, 3]) o += `<circle cx="${(B.x + nx*d*sg + tx*a).toFixed(1)}" cy="${(B.y + ny*d*sg + ty*a).toFixed(1)}" r="2.7" fill="#f8fafc" stroke="${c}" stroke-width="1.2"/>`;
    o += `<text x="${(B.x - nx*27).toFixed(1)}" y="${(B.y - ny*27 + 4).toFixed(1)}" fill="${c}" font-size="11" font-weight="700" text-anchor="middle">${nm}</text>`;
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
  if (st.both) {   // 判斷步驟：兩台車同時示範
    o += hdVeh(G.turn, st.s, 1, 1) + hdVeh(G.straight, st.s, 0, 0);
    o += hdLbl(500, Y - f*30 + (f > 0 ? 0 : 10), '上手 → 不跟彎軌，直行', HD_COL.up, 'end', 14) + hdLbl(370, Y + f*(f > 0 ? 120 : 112), '下手 → 跟著彎軌（支線）', HD_COL.down, 'end', 14);
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
// h：0 上手、1 下手；go：0→1 顯示被帶進支線／直行的提示（彎軌固定不動）；side：支線在右(1)或左(-1)；wedge：三角凸塊的切面寬度；stuck：換手卡在一半
function hdDrawCs(st) {
  // 橫切面（順著行進方向往前看），照現場人員畫的示意圖：
  // 倒 U 型軌道槽、下緣往內翻；走行輪立在下緣上、下導輪卡在縫的兩邊；車頂山形兩側各有一組換手輪（從前面看是扁的，輪子水平放）。
  // 上手：換手輪往內、往上靠攏，在彎軌內側；下手：往外、往下分開，支線側那顆貼在彎軌外側。
  const cx = 320, side = st.side || 1, h = st.h, go = st.go || 0, K = 215;   // 彎軌固定在軌道裡不會動；go 0→1 只用來慢慢顯示「被帶進支線／直行」的提示
  const X = x => cx + x * K, Y = y => 40 + (.84 - y) * K, W = w => w * K, f = v => v.toFixed(1);
  const R = (x0, y0, x1, y1, fill, ex = '') => `<rect x="${f(X(Math.min(x0, x1)))}" y="${f(Y(Math.max(y0, y1)))}" width="${f(W(Math.abs(x1 - x0)))}" height="${f(W(Math.abs(y1 - y0)))}" fill="${fill}" ${ex}/>`;
  const P = (pts, fill, ex = '') => `<polygon points="${pts.map(([x, y]) => f(X(x)) + ',' + f(Y(y))).join(' ')}" fill="${fill}" ${ex}/>`;
  const BLUE = '#4472c4', WH = '#f8fafc', OUT = 'stroke="#0b1220" stroke-width="2"', GUIDE = '#ed7d31';
  const veh = 0;
  const railX = X(side * .2425);                                        // 彎軌中心（0.215～0.27），固定
  const wx = hdLerp(.12, .355, h), wy = hdLerp(.658, .534, h);          // 換手輪中心
  const hand = st.stuck ? HD_COL.stop : WH;
  let o = `<text x="${cx - 120}" y="28" fill="${HD_COL.mut}" font-size="12" text-anchor="middle">${side > 0 ? '直行側' : '支線側'}</text><text x="${cx + 120}" y="28" fill="${HD_COL.mut}" font-size="12" text-anchor="middle">${side > 0 ? '支線側' : '直行側'}</text>`;
  // 軌道槽
  o += `<g transform="translate(${f(veh)},0)">` + P([[-.62, .84], [.62, .84], [.62, -.1], [.335, -.1], [.335, 0], [.55, 0], [.55, .73], [-.55, .73], [-.55, 0], [-.335, 0], [-.335, -.1], [-.62, -.1]], BLUE, 'stroke="#2f528f" stroke-width="1"') + `</g>`;
  // 彎軌：從槽頂往下掛，偏支線側
  o += `<rect x="${f(railX - W(.0275))}" y="${f(Y(.73))}" width="${f(W(.055))}" height="${f(W(.24))}" fill="${GUIDE}" stroke="#ae5a21" stroke-width=".8"/>`;
  if (st.wedge) o += `<rect x="${f(cx + veh - st.wedge / 2)}" y="${f(Y(.73))}" width="${f(st.wedge)}" height="${f(W(.24))}" fill="${HD_COL.wedge}" stroke="#e2e8f0" stroke-width="1"/>`;
  o += `<g transform="translate(${f(veh)},0)">`;
  // 下面吊著天車本體
  o += `<rect x="${cx - 16}" y="${f(Y(-.1))}" width="32" height="${f(250 - Y(-.1))}" fill="#334155"/><rect x="${cx - 74}" y="250" width="148" height="28" rx="6" fill="#334155" stroke="#64748b"/><text x="${cx}" y="268" fill="${HD_COL.mut}" font-size="12" text-anchor="middle">天車本體</text>`;
  // 換手輪的立柱（先畫，車體蓋在下半段上）
  for (const sg of [-1, 1]) o += R(sg * wx - .04, wy - .03, sg * wx + .04, .36, BLUE);
  // 車體：下半方、上面山形
  o += `<path d="M${f(X(-.376))} ${f(Y(.39))} L${f(X(-.09))} ${f(Y(.607))} L${f(X(.09))} ${f(Y(.607))} L${f(X(.376))} ${f(Y(.39))} L${f(X(.376))} ${f(Y(.05))} Q${f(X(.376))} ${f(Y(.0))} ${f(X(.326))} ${f(Y(.0))} L${f(X(-.326))} ${f(Y(.0))} Q${f(X(-.376))} ${f(Y(.0))} ${f(X(-.376))} ${f(Y(.05))} Z" fill="${BLUE}"/>`;
  o += `<text x="${cx}" y="${f(Y(.5) + 4)}" fill="#e0e7ff" font-size="12" text-anchor="middle">山形機構</text>`;
  o += `<circle cx="${cx}" cy="${f(Y(.24))}" r="${f(W(.14))}" fill="#000"/>`;
  // 走行輪（立在下緣上）、下導輪（卡在縫的兩邊）、換手輪
  for (const sg of [-1, 1]) {
    o += R(sg * .384, .005, sg * .494, .48, WH, `rx="6" ${OUT}`);
    o += R(sg * .06, -.11, sg * .33, 0, WH, `rx="6" ${OUT}`);
    o += R(sg * wx - .085, wy - .03, sg * wx + .085, wy + .03, hand, `rx="4" ${OUT}`);
  }
  o += `</g>`;
  o += `<text x="${cx}" y="296" fill="${hdHandCol(h)}" font-size="15" font-weight="700" text-anchor="middle">${st.stuck ? '換手卡在一半 ✕' : hdHandTxt(h)}</text>`;
  if (st.labels) {
    o += hdLbl(railX + side * 14, f(Y(.62)), '彎軌', GUIDE, side > 0 ? 'start' : 'end')
      + hdLbl(cx - 160, 78, '換手輪（導輪）', HD_COL.roller, 'end') + `<line x1="${cx - 156}" y1="74" x2="${f(X(-wx - .085) - 2)}" y2="${f(Y(wy))}" stroke="${HD_COL.mut}" stroke-dasharray="3 3"/>`
      + hdLbl(cx - 160, 172, '走行輪', HD_COL.mut, 'end') + `<line x1="${cx - 156}" y1="168" x2="${f(X(-.494) - 2)}" y2="${f(Y(.24))}" stroke="${HD_COL.mut}" stroke-dasharray="3 3"/>`
      + hdLbl(cx - 160, 244, '下導輪', HD_COL.mut, 'end') + `<line x1="${cx - 156}" y1="240" x2="${f(X(-.2))}" y2="${f(Y(-.055))}" stroke="${HD_COL.mut}" stroke-dasharray="3 3"/>`
      + hdLbl(cx + 160, 214, '軌道槽（倒 U 型）', HD_COL.mut);
  }
  if (st.wedge) o += hdLbl(cx, 40, '三角凸塊的切面（越往前越寬）', '#e2e8f0', 'middle');
  if (go > 0) {
    const op = `opacity="${Math.min(1, go * 1.6).toFixed(2)}"`, ax = cx + side * 190;
    if (st.stuck) o += `<g ${op}><circle cx="${f(X(side * .245))}" cy="${f(Y(wy))}" r="13" fill="none" stroke="${HD_COL.stop}" stroke-width="3"/><text x="${ax}" y="150" fill="${HD_COL.stop}" font-size="14" font-weight="700" text-anchor="middle">撞到彎軌 ✕</text></g>`;
    else if (h > .85) o += `<g ${op}><circle cx="${f(X(side * .27))}" cy="${f(Y(wy))}" r="9" fill="none" stroke="${HD_COL.path}" stroke-width="2.5"/><text x="${ax}" y="146" fill="${HD_COL.path}" font-size="22" text-anchor="middle">${side > 0 ? '➜' : '⬅'}</text><text x="${ax}" y="168" fill="${HD_COL.path}" font-size="12" text-anchor="middle">貼著彎軌外側</text><text x="${ax}" y="184" fill="${HD_COL.path}" font-size="12" text-anchor="middle">被帶進支線</text></g>`;
    else if (h < .15) o += `<g ${op}><text x="${ax}" y="148" fill="${HD_COL.up}" font-size="22" text-anchor="middle">⊙</text><text x="${ax}" y="168" fill="${HD_COL.up}" font-size="12" text-anchor="middle">碰不到彎軌</text><text x="${ax}" y="184" fill="${HD_COL.up}" font-size="12" text-anchor="middle">繼續直行</text></g>`;
  }
  return o;
}

// ---------- 場景：軌道構造示意圖（照現場照片畫的示意，不放照片） ----------
// v：'under' 抬頭看直軌＋彎道（裝好的樣子）、'section' 直軌橫切面、'branch' 抬頭看分岔／合流
const HD_AL = '#cfd5db', HD_AL2 = '#a9b1b9', HD_COVER = '#eceae4', HD_SLOT = '#0b1220';
function hdRailStrip(x0, x1, y, w) {           // 抬頭看的一段直軌：兩根鋁擠型＋中間的縫
  const h = w / 2 - 5;
  let o = `<rect x="${x0}" y="${y - w/2}" width="${x1 - x0}" height="${h}" fill="${HD_AL}" stroke="#7b8590"/>`
    + `<rect x="${x0}" y="${y + 5}" width="${x1 - x0}" height="${h}" fill="${HD_AL}" stroke="#7b8590"/>`
    + `<rect x="${x0}" y="${y - 5}" width="${x1 - x0}" height="10" fill="${HD_SLOT}"/>`;
  for (const k of [-1, 1]) for (const d of [.3, .62]) o += `<line x1="${x0}" y1="${y + k*(5 + h*d)}" x2="${x1}" y2="${y + k*(5 + h*d)}" stroke="${HD_AL2}" stroke-width="1.2"/>`;  // 擠型上的溝
  return o;
}
function hdJoint(x, y, w) {                     // 接板：跨在兩根擠型的接縫上，一排螺絲
  let o = `<rect x="${x - 9}" y="${y - w/2 - 3}" width="18" height="${w + 6}" rx="2" fill="#b8c0c8" stroke="#6b7580"/>`;
  for (const k of [-1, 1]) for (const d of [.25, .55, .85]) o += `<circle cx="${x}" cy="${y + k*(5 + (w/2 - 5)*d)}" r="2.2" fill="#4b5563"/>`;
  return o;
}
function hdHanger(x, y) {                       // 吊桿（從下往上看是一個點）＋中間的圓柱（緩衝／調整長度）
  return `<rect x="${x - 7}" y="${y - 14}" width="14" height="28" rx="6" fill="#9aa3ab" stroke="#5b6470"/><circle cx="${x}" cy="${y}" r="3.5" fill="#374151"/>`;
}
function hdDrawLook(st) {
  let o = '';
  if (st.v === 'section') {                     // 直軌橫切面（順著行進方向看）
    const cx = 320, top = 66, bot = 206;
    o += `<rect x="${cx - 4}" y="6" width="8" height="46" fill="#9aa3ab"/><rect x="${cx - 11}" y="18" width="22" height="20" rx="4" fill="#b8c0c8" stroke="#5b6470"/>`;
    o += hdLbl(cx + 18, 26, '吊桿（往上接天花板）', HD_COL.mut) + hdLbl(cx + 18, 42, '中間的圓柱：緩衝／調整長度', HD_COL.mut);
    o += `<rect x="${cx - 170}" y="52" width="340" height="12" rx="2" fill="#b8c0c8" stroke="#6b7580"/>` + hdLbl(cx - 178, 62, '橫向支架', HD_COL.mut, 'end');
    for (const k of [-1, 1]) {                   // 左右兩根 C 型鋁擠型，開口朝內：外牆＋上緣＋往內翻的下緣（走行輪踩這裡）
      const xo = cx + k*150, T = 10;
      const wall = k > 0 ? [xo - T, xo] : [xo, xo + T];
      o += `<rect x="${wall[0]}" y="${top}" width="${T}" height="${bot - top + T}" fill="${HD_AL}" stroke="#6b7580"/>`;
      o += `<rect x="${Math.min(xo, cx + k*3)}" y="${top}" width="${Math.abs(xo - cx) - 3}" height="${T}" fill="${HD_AL}" stroke="#6b7580"/>`;
      o += `<rect x="${Math.min(xo, cx + k*16)}" y="${bot}" width="${Math.abs(xo - cx) - 16}" height="${T}" fill="${HD_AL}" stroke="#6b7580"/>`;
      o += `<rect x="${k > 0 ? xo : xo - 9}" y="${top - 4}" width="9" height="${bot - top + 18}" rx="4" fill="${HD_COVER}" stroke="#9ca3af"/>`;   // 外蓋
      o += `<circle cx="${cx + k*92}" cy="${bot - 15}" r="15" fill="#1e293b" stroke="#94a3b8" stroke-width="2"/>`;   // 走行輪
    }
    o += `<rect x="${cx - 14}" y="${top + 10}" width="28" height="14" fill="${HD_COL.rail}"/>` + hdLbl(cx, top + 40, '彎軌（只在分岔／合流段，偏支線側）', HD_COL.rail, 'middle', 11);
    o += `<rect x="${cx - 100}" y="${bot - 26}" width="200" height="18" rx="4" fill="#334155" stroke="#64748b"/>`;   // 走行部（在槽裡）
    o += `<rect x="${cx - 10}" y="${bot - 8}" width="20" height="60" fill="#334155"/><rect x="${cx - 80}" y="${bot + 52}" width="160" height="30" rx="6" fill="#334155" stroke="#64748b"/>`;
    o += hdLbl(cx, bot + 72, '天車本體（從中間的縫吊下來）', HD_COL.mut, 'middle');
    o += hdLbl(cx - 175, 120, '鋁擠型（左）', HD_COL.txt, 'end') + hdLbl(cx + 175, 120, '鋁擠型（右）', HD_COL.txt)
      + hdLbl(cx + 175, 196, '走行輪踩在往內翻的下緣', HD_COL.mut) + hdLbl(cx - 175, 160, '外蓋', HD_COL.mut, 'end') + hdLbl(cx - 175, 176, '（裝好後看到的白色外殼）', HD_COL.mut, 'end')
      + hdLbl(cx + 24, bot + 30, '← 中間的縫', '#93c5fd', 'start', 11);
    return o;
  }
  if (st.v === 'under') {                       // 抬頭看：左邊直軌（還沒裝外蓋，看得到兩根擠型），右邊接彎道（裝好外蓋的樣子）
    const y = 150, w = 62;
    o += hdRailStrip(20, 380, y, w);
    for (const x of [120, 260]) o += hdJoint(x, y, w);
    for (const x of [70, 330]) o += hdHanger(x, y - w/2 - 22) + hdHanger(x, y + w/2 + 22);
    const R = 150, c = [380, y + R];                                     // 彎道：圓心在下方，往下彎
    const arc = (r) => `M380 ${c[1] - r} A${r} ${r} 0 0 1 ${380 + r} ${c[1]}`;
    o += `<path d="${arc(R)}" stroke="${HD_COVER}" stroke-width="${w + 18}" fill="none"/>`;
    o += `<path d="${arc(R)}" stroke="#d6d3ca" stroke-width="${w + 18}" fill="none" stroke-dasharray="1 30" opacity=".6"/>`;
    o += `<path d="${arc(R)}" stroke="${HD_SLOT}" stroke-width="12" fill="none"/>`;
    o += `<path d="${arc(R - 13)}" stroke="${HD_COL.rail}" stroke-width="3" fill="none" stroke-dasharray="5 4" opacity=".85"/>`;
    o += hdLbl(200, 40, '直軌（拆掉外蓋）：兩根鋁擠型，中間一條縫', HD_COL.txt, 'middle', 13);
    o += hdLbl(120, y + w/2 + 52, '接板＋螺絲（兩段軌道的接縫）', HD_COL.mut, 'middle') + hdLbl(70, y - w/2 - 42, '吊桿', HD_COL.mut, 'middle');
    o += hdLbl(560, 60, '彎道（裝好的樣子）', HD_COL.txt, 'middle', 13) + hdLbl(560, 78, '一整塊白色外蓋，看不到擠型', HD_COL.mut, 'middle');
    o += hdLbl(20, 272, '虛線＝彎軌（分岔／合流的彎道才有）：在槽裡，從下面看不到', HD_COL.rail, 'start', 11) + hdLbl(20, 290, '中間的縫在彎道一樣連續', '#93c5fd', 'start', 11);
    return o;
  }
  // branch：抬頭看分岔（左右跟俯視圖相反）
  const y = 110, w = 46;
  o += hdRailStrip(10, 630, y, w);
  const br = hdBez([250, y], [330, y], [380, y + 30], [400, y + 175]);
  o += `<path d="${hdD(br)}" stroke="${HD_COVER}" stroke-width="${w + 12}" fill="none"/><path d="${hdD(br)}" stroke="${HD_SLOT}" stroke-width="10" fill="none"/>`;
  o += hdRailStrip(250, 420, y, w).replace(/fill="#cfd5db"/g, `fill="${HD_COVER}"`);   // 分岔段整塊外蓋
  const g = [[170, y + 9], [250, y + 9], ...hdOffset(br, 9).slice(1)];
  o += `<path d="${hdD(g)}" stroke="${HD_COL.rail}" stroke-width="3.5" fill="none" stroke-dasharray="5 4"/>`;
  o += `<circle cx="170" cy="${y + 9}" r="6" fill="none" stroke="${HD_COL.rail}" stroke-width="2"/>`;
  o += hdLbl(170, y + 52, '彎軌起點（分岔點前一小段）', HD_COL.rail, 'middle', 11) + hdLbl(250, y - 34, '分岔點', '#fff', 'middle');
  o += hdLbl(360, y + 170, '支線', HD_COL.mut, 'end') + hdLbl(625, y - 34, '主線', HD_COL.mut, 'end');
  o += hdLbl(320, 34, '抬頭看時，左右會跟教學裡的俯視圖相反（像照鏡子）', '#fde68a', 'middle', 12);
  o += hdLbl(560, y + 60, '分岔／合流段：一整塊外蓋', HD_COL.mut, 'middle', 11);
  return o;
}

// ---------- 教學內容 ----------
const HD_CH = [
  { name: '0. 認識軌道', steps: [
    { scene: 'look', dur: 0.1, t: '抬頭看直軌', x: '直軌不是一整塊槽，而是<b>左右兩根鋁擠型</b>，中間留一條縫，天車從縫裡吊下來。<br>兩段軌道接在一起的地方有<b>接板和一排螺絲</b>；軌道兩側用吊桿吊在天花板上，吊桿中間有一段圓柱（緩衝／調整長度）。<br>裝好後擠型外面會蓋上白色外蓋，平常抬頭只看得到外蓋。', st: () => ({ v: 'under' }) },
    { scene: 'look', dur: 0.1, t: '直軌橫切面', x: '兩根擠型的開口朝內，底部往內翻的邊是<b>走行輪</b>踩的地方。<br>天車頂部的走行機構在槽裡；分岔、合流段的槽裡多一條<b>彎軌</b>，偏在支線那一側。<br>（下一章用 3D 模型講走行機構和上手／下手。）', st: () => ({ v: 'section' }) },
    { scene: 'look', dur: 0.1, t: '彎道', x: '彎道是<b>一整塊</b>做好的彎道件，裝好後是一整片白色外蓋，看不到擠型。<br>中間的縫一樣連續；如果是分岔、合流的彎道，彎軌在槽裡面，從下面看不到。<br><a data-hd="ch:1" class="hdlink">▶ 到「1. 認識走行機構」用 3D 看導軌和走行部（可以旋轉）</a>', st: () => ({ v: 'under' }) },
    { scene: 'look', dur: 0.1, t: '抬頭看分岔', x: '分岔段：主線直直往前，支線從旁邊彎出去；彎軌在<b>分岔點前一小段</b>就開始，偏支線那一側。<br><b>注意</b>：站在地上抬頭看時，左右會跟教學裡的俯視圖<b>相反</b>。判斷時看「支線往哪邊彎出去」，不要死記左右。', st: () => ({ v: 'branch' }) },
  ] },
  { name: '1. 認識走行機構', td3d: true, steps: [
    { dur: 0.1, t: '走行部長什麼樣子', x: '這是天車頂部的<b>走行部</b>，前後各一組，跟全廠模擬裡是同一個 3D 模型；透明的是軌道和彎軌。<br>每組有：<b>走行輪</b>（兩側的大輪，踩在軌道下緣，由中間的馬達帶動）、<b>下導輪</b>（卡在軌道縫的兩邊）、<b>山形座</b>和兩側的<b>斜軌</b>、左右各一座<b>換手輪座</b>（每座兩顆換手輪，前後兩組共八顆）。<br>可以拖曳旋轉、滾輪縮放看細節。', td: () => ({ view: 'iso', hand: 1, route: 'turn', progress: .17, status: '走行部（上手），還沒進導軌' }) },
    { dur: 0.1, t: '上手', x: '換成<b>正視</b>，順著行進方向看。<br><b class="up">上手</b>：兩邊的換手輪座沿斜軌滑到<b>內、上方</b>，換手輪靠中間、位置高，在彎軌的<b>內側</b>。', td: () => ({ view: 'front', hand: 1, route: 'turn', progress: .17, status: '上手：換手輪靠中間、位置高' }) },
    { dur: 2.4, t: '切成下手', x: '換手時，左右輪座同步沿斜軌往<b>外、下方</b>滑。<br><b class="down">下手</b>：換手輪分到兩邊、位置低，彎軌那一側的輪子落在彎軌<b>外側</b>。<br>前、後兩組要一起換好。', td: t => ({ view: 'front', hand: 1 - hdSeg(t, .1, .9), route: 'turn', progress: .17, status: t < .9 ? '換手中：輪座沿斜軌往外、往下滑' : '下手：換手輪分到兩邊、位置低' }) },
    { dur: 10, t: '下手 → 跟著彎軌走', x: '<b class="down">下手</b>開進分岔：彎軌那側的換手輪貼著彎軌外側滾，前後走行部被彎軌帶著轉向，走<b>彎軌那條路</b>（這裡是支線）。', td: t => ({ view: 'iso', hand: 0, route: 'turn', progress: .17 + .83 * hdSeg(t, 0, 1) }) },
    { dur: 10, t: '上手 → 走另一條', x: '<b class="up">上手</b>：換手輪在彎軌內側，彎軌彎開也帶不走它，走<b>另一條路</b>（這裡直行）。<br>哪個手走哪條路要看該分岔的彎軌設計，第 2 章會講怎麼判斷。', td: t => ({ view: 'iso', hand: 1, route: 'straight', progress: .17 + .83 * hdSeg(t, 0, 1) }) },
    { t: '自己操作看看', x: '上面出現了播放控制列，可以自己操作。<br>選分岔路線後按「播放路線」：天車在進導軌<b>之前</b>先把前後八顆換手輪同步切好，要<b class="down">跟著彎軌進支線走下手</b>、<b class="up">直行不跟彎軌走上手</b>（這個分岔的彎軌在支線側），然後沿導軌通過分岔。<br>可以拖進度條停在任何位置，切「正視／俯視／側視」看導輪跟導軌的相對位置；拖曳旋轉、滾輪縮放。<br><span style="color:#94a3b8">傳動與尺寸是示意，不是製造圖。</span>' },
  ] },
  { name: '2. 進導軌會往哪走', steps: [
    { scene: 'div', dur: 0.1, t: '先找彎軌', x: '天車開進分岔會往哪走，是由<b>彎軌</b>和<b>換手輪的位置</b>決定的，不是天車自己轉方向盤。<br>第一步：找彎軌。它掛在槽頂、偏一側，在分岔點<b>前一小段</b>就開始，順著其中一條路彎過去（這個分岔是往支線彎）。', st: () => ({ hiGuide: true }) },
    { scene: 'div', dur: 5, t: '下手 → 跟著彎軌走', x: '第二步：看前、後換手輪是上手還是下手。<br><b class="down">下手</b>：換手輪分到車身兩邊，彎軌那側的輪子落在彎軌<b>外側</b>。開進去後輪子貼著彎軌滾，整台車被帶著走 → 走<b>彎軌那條路</b>（這裡是支線）。', st: t => ({ hiGuide: true, veh: true, route: 'turn', s: hdLerp(60, 700, hdSeg(t, 0, 1)), hf: 1, hr: 1 }) },
    { scene: 'div', dur: 5, t: '上手 → 走另一條', x: '<b class="up">上手</b>：換手輪集中在中間，在彎軌<b>內側</b>。彎軌彎開也碰不到輪子，彎軌帶不走它 → 走<b>另一條路</b>（這裡是主線直行）。', st: t => ({ hiGuide: true, veh: true, route: 'straight', s: hdLerp(60, 780, hdSeg(t, 0, 1)), hf: 0, hr: 0 }) },
    { scene: 'div', dur: 5, t: '彎軌在另一邊也一樣', x: '支線往左或往右分，彎軌就在那一側，判斷方法一樣：<b class="down">下手</b>跟著彎軌走，<b class="up">上手</b>走另一條。', st: t => ({ f: -1, veh: true, route: 'turn', s: hdLerp(60, 700, hdSeg(t, 0, 1)), hf: 1, hr: 1 }) },
    { scene: 'div', dur: 5, t: '判斷步驟', x: '<ol><li>找彎軌：在哪一側、往哪條路彎</li><li>看前後換手輪：上手還是下手</li><li><b class="down">下手</b>＝跟著彎軌走；<b class="up">上手</b>＝走另一條</li></ol>一直一彎的分岔彎軌在支線側，所以下手進支線、上手直行；<b>T 字路口</b>等形式要看現場的彎軌設計，上手也可能是轉彎。<br>派車時反過來：先決定要走哪條，再在進導軌前換好手（下一章）。', st: t => ({ both: true, s: hdLerp(60, 560, hdSeg(t, 0, 1)) }) },
  ] },
  { name: '3. 換手的時機', steps: [
    { scene: 'div', dur: 0.1, t: '換手區', x: '換手要在<b>彎軌起點之前</b>完成，而且<b>前、後兩組輪子都還在直線段</b>。<br>黃色是換手區，紅線是最後換手點：過了紅線，導輪就要碰到彎軌了。', st: () => ({ zone: true, hiGuide: true, veh: true, route: 'turn', s: 150, hf: 0, hr: 0 }) },
    { scene: 'div', dur: 6, t: '在換手區換好', x: '這台車要進支線，目前是上手。開進換手區後，前、後輪組一起換成下手，換好了才通過最後換手點。', st: t => { const k = hdSeg(t, .25, .45); return { zone: true, dest: 'turn', veh: true, route: 'turn', s: t < .25 ? hdLerp(150, 250, hdE(t / .25)) : t < .45 ? 250 : hdLerp(250, 700, hdSeg(t, .45, 1)), hf: k, hr: k }; } },
    { scene: 'div', dur: 6, t: '前後手同步，先後通過導軌', x: '前輪組先碰到彎軌，後輪組隔一個車身才到。兩組的山形都要在<b>前輪組</b>到最後換手點之前換好；只換好一組也算換手失敗。', st: t => ({ zone: true, hiGuide: true, veh: true, route: 'turn', s: hdLerp(240, 420, hdSeg(t, 0, 1)), hf: 1, hr: 1 }) },
    { scene: 'div', dur: 0.1, t: '彎道內不能換手', x: '前車或後車在彎道裡時，導輪正卡著彎軌，<b>不能換手</b>，也不能歸原點、切上線。<br>現場排除時，要先把車寸動到直線段（操作介面上「前車／後車：直線」）再換。', st: () => ({ veh: true, route: 'turn', s: 482, hf: 1, hr: 1, noSwitch: true }) },
  ] },
  { name: '4. 合流：三角凸塊', steps: [
    { scene: 'mer', dur: 3, t: '支線來車', x: '從支線要合流回主線的車，合流前的槽裡有一個<b>三角形凸塊</b>，尖角朝著來車。<br>這台車現在是<b class="up">上手</b>。', st: t => ({ hiWedge: true, veh: true, s: hdLerp(40, 76, hdSeg(t, 0, 1)), hf: 0, hr: 0 }) },
    { scene: 'cs', dur: 3.5, t: '凸塊把山形切開', x: '天車往前走，凸塊越來越寬，尖角從兩個併在一起的導輪<b>中間插進去</b>，把它們往兩邊撐開——上手被<b>強制切成下手</b>。<br>這是機構硬切的，不是天車自己換手。', st: t => { const w = 150 * hdSeg(t, .05, .9); return { wedge: w, h: Math.max(0, Math.min(1, (w / 2 - 7.5) / 50.5)) }; } },
    { scene: 'mer', dur: 5, t: '下手吃彎軌 → 合流', x: '變成<b class="down">下手</b>後，導輪吃到彎軌外側，被導引順著彎道合流進主線。', st: t => { const s = hdLerp(76, 470, hdSeg(t, 0, 1)), k = (x) => Math.max(0, Math.min(1, (x - 84) / 16)); return { veh: true, s, hf: k(s), hr: k(s - 44) }; } },
    { scene: 'mer', dur: 6, t: '合流後看下一個分岔', x: '合流後在主線直線段，看<b>下一個分岔</b>決定：下一個要直行就<b class="up">換回上手</b>；要轉彎就<b class="down">保持下手</b>。<br>這裡示範下一個要直行。', st: t => { const s = hdLerp(470, 800, hdSeg(t, 0, 1)), k = 1 - hdSeg(t, .25, .45); return { zone: true, zoneTxt: '下一個直行 → 換回上手', veh: true, s: t > .25 && t < .45 ? 560 : t <= .25 ? hdLerp(470, 560, hdE(t / .25)) : hdLerp(560, 800, hdSeg(t, .45, 1)), hf: k, hr: k }; } },
    { scene: 'mer', dur: 5, t: '主線來車不受影響', x: '三角凸塊只在<b>支線</b>的槽裡。主線直行過來的車碰不到它，維持原本的手（這台是上手）。', st: t => ({ mainVeh: true, ms: hdLerp(60, 800, hdSeg(t, 0, 1)) }) },
  ] },
  { name: '5. 換錯會怎樣', steps: [
    { scene: 'div', dur: 4, t: '沒換好就停車', x: '天車到最後換手點前會確認山形位置。該進支線卻還是<b class="up">上手</b>（或只換好一組），就會停在彎軌前報 <b>E-105 換手失敗</b>，不會硬闖。', st: t => { const s = hdLerp(60, 286, hdSeg(t, 0, .8)); return { zone: true, dest: 'turn', veh: true, route: 'turn', s, hf: 0, hr: 0, alarm: t > .82 ? 'E-105 換手失敗' : '' }; } },
    { scene: 'cs', dur: 3, t: '卡在一半最危險', x: '如果換手輪停在中間，剛好落在彎軌的位置：往前走會撞上彎軌，或被帶到錯的路線。所以換手沒到位一定要停車。', st: t => ({ h: .5, stuck: true, go: hdSeg(t, .1, .9) }) },
    { scene: 'div', dur: 0.1, t: '現場怎麼排除', x: '<ol><li>操作介面「警報清除」，天車切手動</li><li>看「前手／後手」目前是上手還是下手</li><li>確認前車、後車都在<b>直線</b>（不在彎道內）</li><li>手動換到需要的手（這裡要下手）</li><li>選有／無 FOUP → 歸原點 → 切上線</li></ol>', st: () => ({ zone: true, veh: true, route: 'turn', s: 286, hf: 0, hr: 0, alarm: 'E-105 換手失敗' }) },
  ] },
  { name: '6. 練習題', quiz: true, steps: [] },
];

// ---------- 練習題 ----------
function hdQuizNew() {
  const f = Math.random() < .5 ? 1 : -1, kind = ['pred', 'pred', 'div', 'wedge', 'after', 'curve'][Math.floor(Math.random() * 6)];
  if (kind === 'pred') { const h = Math.random() < .5 ? 1 : 0;
    return { kind, f, h, q: `這台天車前、後都是<b>${h ? '下手' : '上手'}</b>，開進前面的彎軌後會走哪條？（彎軌在支線側）`, opts: ['主線（直行）', '支線'], ans: h,
      why: h ? '下手時換手輪在彎軌外側，被彎軌帶著走，走彎軌那條：支線。' : '上手時換手輪在彎軌內側，彎軌帶不走它，走另一條：主線直行。' }; }
  if (kind === 'div') { const dest = Math.random() < .5 ? 'turn' : 'straight';
    return { kind, f, dest, q: `這台天車要${dest === 'turn' ? '<b>進支線</b>' : '<b>直行</b>'}（看紫色虛線和「目的地」）。到換手區要切成？`, opts: ['上手', '下手'], ans: dest === 'turn' ? 1 : 0,
      why: dest === 'turn' ? '這個分岔的彎軌在支線側，要進支線就跟著彎軌走，用下手：換手輪貼在彎軌外側，被帶進支線。' : '直行不跟彎軌走，用上手：換手輪在彎軌內側，彎軌彎開碰不到。' }; }
  if (kind === 'wedge') return { kind, f, q: '支線來的天車現在是<b>上手</b>，經過合流前的三角凸塊後會？', opts: ['變成下手', '維持上手', '停車報警'], ans: 0,
    why: '三角凸塊的尖角從兩個導輪中間插進去，把它們撐開，上手被強制切成下手。' };
  if (kind === 'after') { const nx = Math.random() < .5 ? 'turn' : 'straight';
    return { kind, f, nx, q: `天車剛從支線合流進主線（現在是下手）。下一個分岔要<b>${nx === 'turn' ? '轉彎' : '直行'}</b>，天車要？`, opts: ['換回上手', '保持下手'], ans: nx === 'turn' ? 1 : 0,
      why: nx === 'turn' ? '下一個分岔要跟著彎軌進支線，就保持下手。' : '下一個分岔要直行、不跟彎軌，在直線段換回上手。' }; }
  return { kind, f, q: '天車的<b>前輪組已經在彎道裡</b>，發現手不對，可以現在換手嗎？', opts: ['可以，馬上換', '不行，先寸動到直線段再換'], ans: 1,
    why: '彎道內導輪卡著彎軌，不能換手。要先把前、後車都移到直線段。' };
}
function hdQuizState(q, t) {
  if (!q) return { scene: 'div', st: { hiGuide: true } };
  const done = q.picked != null, ok = done && q.picked === q.ans;
  if (q.kind === 'pred') { const route = q.h ? 'turn' : 'straight';
    return { scene: 'div', st: { f: q.f, hiGuide: !done, veh: true, route, s: done ? hdLerp(150, route === 'turn' ? 700 : 760, hdSeg(t, 0, 1)) : 150, hf: q.h, hr: q.h } }; }
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
      if (a === 'replay') { const C = HD_CH[HD.ch]; if (C.td3d && !(C.steps[HD.step] || {}).td) return; if (HD.td) HD.td.set({ resetUser: true }); HD.t = 0; HD.playing = true; return; }
      if (a.startsWith('ans:')) { const q = HD.quiz; if (!q || q.picked != null) return; q.picked = +a.slice(4); HD.score[1]++; if (q.picked === q.ans) HD.score[0]++; HD.t = 0; HD.playing = true; return hdPanel(); }
      if (a === 'newq') { HD.quiz = hdQuizNew(); HD.t = 0; HD.playing = false; return hdPanel(); }
    });
  }
  if (HD) { cancelAnimationFrame(HD.raf); hd3dSet(false); }   // 視窗已經開著又按一次：先收掉舊的 3D
  HD = { ch: 0, step: 0, t: 0, playing: true, last: 0, raf: 0, quiz: null, score: [0, 0], td: null };
  el.style.display = 'flex';
  el.innerHTML = `<div class="hdwin"><div class="hdhd"><span>看軌道：山形機構 上手／下手</span><button data-hd="close" title="關閉">✕</button></div>
    <div class="hdtabs">${HD_CH.map((c, i) => `<button data-hd="ch:${i}">${c.name}</button>`).join('')}</div>
    <div class="hdbd"><svg id="hdSvg" viewBox="0 0 640 300"></svg><div class="hdside" id="hdSide"></div></div></div>`;
  hdGo(ch, 0);
  HD.last = performance.now(); HD.raf = requestAnimationFrame(hdLoop);
}
function closeHandDemo() { const el = document.getElementById('handDemo'); if (el) el.style.display = 'none'; if (HD) { cancelAnimationFrame(HD.raf); hd3dSet(false); } HD = null; }
// 3D 章：把 SVG 換成 createTravelDemo（traveldemo.js）；離開這章就釋放 WebGL
function hd3dSet(on) {
  const svg = document.getElementById('hdSvg'); if (!svg || !HD) return;
  if (!on) { if (HD.td) { HD.td.dispose(); HD.td = null; } const b = document.getElementById('hd3d'); if (b) b.remove(); svg.style.display = ''; return; }
  if (HD.td) return;
  svg.style.display = 'none';
  const box = document.createElement('div'); box.id = 'hd3d'; svg.after(box);
  if (typeof createTravelDemo === 'function' && typeof OHTTravelModel !== 'undefined') HD.td = createTravelDemo(box, { controls: false });
  else box.textContent = '3D 模型沒有載入（缺 travel_mechanism.js／traveldemo.js）';
}
// 3D 章節：有 td(t) 的步驟由教學帶（藏控制列、自動控制視角與上下手）；沒有的步驟讓使用者自己操作
function hd3dStep() { const S = HD_CH[HD.ch].steps[HD.step]; if (!HD.td || !S) return; HD.td.controls(!S.td); if (S.td) HD.td.set(S.td(HD.t)); }
function hdGo(ch, step) {
  const C = HD_CH[ch]; if (!C) return;
  HD.ch = ch; HD.step = Math.max(0, Math.min(step, Math.max(0, C.steps.length - 1))); HD.t = 0; HD.playing = !C.td3d || !!(C.steps[HD.step] || {}).td;
  hd3dSet(!!C.td3d); if (HD.td) HD.td.set({ resetUser: true }); if (HD.td && C.td3d && !(C.steps[HD.step] || {}).td) HD.td.set({ hand: null, progress: 0, view: 'iso' }); hd3dStep();
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
    <div class="hdctl"><button data-hd="prev" ${HD.step === 0 ? 'disabled' : ''}>◀ 上一步</button>${C.td3d && !S.td ? '' : '<button data-hd="replay">↻ 重播</button>'}
    <button data-hd="next" class="pri" ${HD.step + 1 >= C.steps.length && HD.ch + 1 >= HD_CH.length ? 'disabled' : ''}>${HD.step + 1 >= C.steps.length ? '下一章 ▶' : '下一步 ▶'}</button></div>`;
}
function hdCur() {
  const C = HD_CH[HD.ch];
  if (C.quiz) { const r = hdQuizState(HD.quiz, HD.t); return { scene: r.scene, st: r.st, dur: 5 }; }
  const S = C.steps[HD.step]; if (C.td3d) return { dur: S.dur || .1 };
  return { scene: S.scene, st: S.st(HD.t), dur: S.dur };
}
function hdRender() {
  const svg = document.getElementById('hdSvg'); if (!svg || !HD || HD_CH[HD.ch].td3d) return;
  const { scene, st } = hdCur();
  svg.innerHTML = scene === 'cs' ? hdDrawCs(st) : scene === 'mer' ? hdDrawMer(st) : scene === 'look' ? hdDrawLook(st) : hdDrawDiv(st);
  const L = document.getElementById('hdLamps');
  if (L) { const hs = scene === 'look' ? [] : scene === 'cs' ? [['山形', st.h]] : (st.veh ? [['前手', st.hf], ['後手', st.hr]] : st.mainVeh ? [['前手', 0], ['後手', 0]] : []);
    L.innerHTML = hs.map(([n, h]) => `<span><i style="background:${hdHandCol(h)};box-shadow:0 0 8px ${hdHandCol(h)}"></i>${n}：${st.stuck ? '卡住' : hdHandTxt(h)}</span>`).join(''); }
}
function hdLoop(now) {
  if (!HD) return;
  const dt = Math.min(0.1, (now - HD.last) / 1000); HD.last = now;
  if (HD.playing) { const { dur } = hdCur(); HD.t = Math.min(1, HD.t + dt / dur); if (HD.t >= 1) HD.playing = false; if (HD_CH[HD.ch].td3d) hd3dStep(); else hdRender(); }
  HD.raf = requestAnimationFrame(hdLoop);
}
