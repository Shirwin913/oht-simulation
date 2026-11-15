// bench.js — 比較實驗：把「通訊方式 × 派車方式」四種組合，用同一組亂數（種子）、同一個情境各跑一次，最後出一張比較表
//
//   做法：每種組合開一個看不到的小視窗（iframe，網址加 ?bench=1&...），裡面不畫 3D、全速快轉，
//   跑完把結果傳回來。一次跑一種（瀏覽器同一個分頁只能用一顆 CPU），跑的時候主畫面會先暫停。
//   前 15 分鐘（模擬時間）是暖機，不算進結果。

const BENCH_WARMUP = 900;
const BENCH_SCENARIOS = {
  normal: { name: '正常運作', desc: '目前的設定（56 台車、加工時間 1500 秒）' },
  fewer: { name: '天車較少', desc: '只有 36 台車：車不夠用，派車方式的差別會比較明顯' },
  peak: { name: '任務尖峰', desc: '加工時間縮短成 600 秒：搬運需求大增' },
  host: { name: '派車系統當機', desc: '每小時第 20 分鐘起，派車控制系統（OCS）當機 5 分鐘' },
  apstorm: { name: 'AP／閘道器連續斷線', desc: '每 10 分鐘有 2 台 AP（Mesh 模式是閘道器）斷線 5 分鐘' },
};
const BENCH_COMBOS = [['ap', 'central', '固定 AP＋中央派車'], ['ap', 'auto', '固定 AP＋自主接任務'], ['mesh', 'central', 'Mesh＋中央派車'], ['mesh', 'auto', 'Mesh＋自主接任務']];

// ================== 背景執行的那一邊（iframe 裡）==================
let benchWaits = null, benchLost = 0;
function benchRun() {
  const P = BENCH, post = m => parent.postMessage(Object.assign({ benchId: P.id }, m), '*');
  // 情境設定
  if (P.scen === 'fewer') for (let i = 0; i < 20; i++) document.getElementById('btnRemove').click();
  if (P.scen === 'peak') procTime = 600;
  setCommMode(P.comm); DISPATCH_MODE = P.disp;
  autoAlarm = P.alarms; autoAlarmT = 60;
  const END = BENCH_WARMUP + P.hours * 3600, dt = 0.04;
  let dispT = 0, measuring = false, c0 = 0, w0 = null, cyc0 = null;
  const M = { lostSec: 0, faultSec: 0, hostSec: 0, alarms: {}, maxWait: 0, stuckSec: 0 };
  const alarmSeen = new Set();
  function step() {
    simTime += dt; stepPorts(dt); stepVehicles(dt); commTick(dt); hmiTick(dt); alarmTick(dt);
    dispT += dt; if (dispT >= 0.5) { dispT = 0; dispatch(); }
    // 情境事件
    if (P.scen === 'host') { const m = simTime % 3600; if (m >= 1200 && m < 1200 + dt && !hostDown) { const a = raiseHostDown(null, {}); if (a) a.autoClearAt = simTime + 300; } }
    if (P.scen === 'apstorm' && simTime % 600 < dt) for (let k = 0; k < 2; k++) { const a = raiseApDown(null, {}); if (a) a.autoClearAt = simTime + 300; }
    if (!measuring && simTime >= BENCH_WARMUP) {
      measuring = true; c0 = completed; w0 = waitByPri.map(x => [...x]); cyc0 = cycleByPri.map(x => [...x]); benchWaits = []; benchLost = 0;
    }
    if (measuring) {
      for (const v of vehicles) { if (v.noComm) M.lostSec += dt; if (v.fault) M.faultSec += dt; }
      if (hostDown) M.hostSec += dt;
      for (const a of alarms) if (!alarmSeen.has(a)) { alarmSeen.add(a); M.alarms[a.type] = (M.alarms[a.type] || 0) + 1; }
    }
  }
  function chunk() {
    const t0 = performance.now();
    while (simTime < END && performance.now() - t0 < 40) for (let i = 0; i < 200 && simTime < END; i++) step();
    if (simTime < END) { post({ progress: simTime / END }); setTimeout(chunk, 0); return; }
    // 結果
    const hrs = P.hours, sum = (A, B) => A.reduce((s, x, i) => s + x[0] - B[i][0], 0), cnt = (A, B) => A.reduce((s, x, i) => s + x[1] - B[i][1], 0);
    const pri = [0, 1, 2].map(i => { const n = waitByPri[i][1] - w0[i][1]; return n ? (waitByPri[i][0] - w0[i][0]) / n : null; });
    const ws = benchWaits.slice().sort((a, b) => a - b);
    post({ done: true, result: {
      tph: (completed - c0) / hrs, wait: sum(waitByPri, w0) / Math.max(1, cnt(waitByPri, w0)), waitPri: pri,
      p95: ws.length ? ws[Math.floor(ws.length * 0.95)] : 0, maxWait: ws.length ? ws[ws.length - 1] : 0,
      cycle: sum(cycleByPri, cyc0) / Math.max(1, cnt(cycleByPri, cyc0)), backlog: jobs.filter(j => !j.vehicle).length,
      lostEvents: benchLost, lostMin: M.lostSec / 60, faultMin: M.faultSec / 60, hostMin: M.hostSec / 60, alarms: M.alarms,
      vehicles: vehicles.length,
    } });
  }
  post({ progress: 0 }); setTimeout(chunk, 0);
}

// ================== 主畫面那一邊：設定、依序執行、比較表 ==================
let benchState = null;
function benchStart() {
  if (benchState) return;
  const $b = id => document.getElementById(id);
  const opt = { scen: $b('bScen').value, hours: +$b('bHours').value, seed: +$b('bSeed').value || 1, alarms: $b('bAlarms').checked };
  const combos = BENCH_COMBOS.filter((c, i) => $b('bCombo' + i).checked);
  if (!combos.length) return;
  const wasPaused = paused; if (!paused) $b('btnPause').click();                 // 主畫面先暫停，讓比較跑快一點
  benchState = { opt, combos, i: 0, results: [], wasPaused, t0: performance.now() };
  $b('bStart').disabled = true; benchNext();
}
function benchNext() {
  const S = benchState, $b = id => document.getElementById(id);
  if (S.i >= S.combos.length) return benchFinish();
  const [comm, disp] = S.combos[S.i], id = 'b' + Date.now();
  S.cur = id;
  const q = new URLSearchParams({ bench: 1, id, seed: S.opt.seed, comm, disp, hours: S.opt.hours, scen: S.opt.scen, alarms: S.opt.alarms ? 1 : 0 });
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:2px;height:2px;left:0;bottom:0;border:0;opacity:0.01;pointer-events:none';   // 留在畫面內（太遠或隱藏的話，有些瀏覽器會把它的計時器放慢）
  f.src = location.href.split('?')[0].split('#')[0] + '?' + q; document.body.appendChild(f); S.frame = f;
  benchProgress(0);
}
function benchProgress(p) {
  const S = benchState; if (!S) return;
  const el = document.getElementById('bProg'), n = S.combos.length;
  const total = (S.i + p) / n, sec = (performance.now() - S.t0) / 1000, eta = total > 0.02 ? sec / total - sec : null;
  el.innerHTML = `<div class="bbar"><i style="width:${(total * 100).toFixed(1)}%"></i></div>正在跑：${S.combos[S.i][2]}（${S.i + 1}／${n}）· ${Math.round(p * 100)}%` + (eta ? ` · 約再 ${Math.ceil(eta / 60)} 分鐘` : '');
}
window.addEventListener('message', e => {
  const S = benchState, m = e.data; if (!S || !m || m.benchId !== S.cur) return;
  if (m.progress !== undefined) benchProgress(m.progress);
  if (m.done) {
    S.results.push({ name: S.combos[S.i][2], r: m.result }); S.frame.remove(); S.i++;
    benchNext();
  }
});
function benchCancel() {
  const S = benchState; if (!S) return;
  if (S.frame) S.frame.remove();
  document.getElementById('bProg').textContent = '已取消';
  document.getElementById('bStart').disabled = false;
  if (!S.wasPaused && paused) document.getElementById('btnPause').click();
  benchState = null;
}
function benchFinish() {
  const S = benchState; benchState = null;
  document.getElementById('bStart').disabled = false;
  document.getElementById('bProg').textContent = `完成（花了 ${Math.round((performance.now() - S.t0) / 1000)} 秒）`;
  if (!S.wasPaused && paused) document.getElementById('btnPause').click();
  benchLast = S; benchShow(S);
}
let benchLast = null;
function benchShow(S) {
  const R = S.results, f0 = x => x == null ? '–' : Math.round(x), f1 = x => x == null ? '–' : x.toFixed(1);
  // 每一列：[名稱, 取值, 格式, 越大越好?]
  const rows = [
    ['每小時搬運量', r => r.tph, f0, true], ['平均等車（秒）', r => r.wait, f0, false], ['95% 的任務等車在幾秒內', r => r.p95, f0, false],
    ['最久等車（秒）', r => r.maxWait, f0, false], ['一般 Lot 等車', r => r.waitPri[0], f0, false], ['急件等車', r => r.waitPri[1], f0, false],
    ['特急等車', r => r.waitPri[2], f0, false], ['平均搬運週期（秒）', r => r.cycle, f0, false], ['結束時還沒派車的任務', r => r.backlog, f0, false],
    ['通訊中斷（次）', r => r.lostEvents, f0, false], ['通訊中斷（車·分鐘）', r => r.lostMin, f1, false], ['異常停車（車·分鐘）', r => r.faultMin, f1, false],
    ['異常發生（件）', r => Object.values(r.alarms).reduce((a, b) => a + b, 0), f0, false],
  ];
  const sc = BENCH_SCENARIOS[S.opt.scen];
  let h = `<div class="hd"><span>📊 比較結果：${sc.name}</span><button id="acClose">✕</button></div>
    <div class="mut">${sc.desc} · 每種組合跑 ${S.opt.hours} 小時（不含 15 分鐘暖機）· 種子 ${S.opt.seed}${S.opt.alarms ? ' · 有隨機異常' : ''}</div>
    <div style="overflow:auto"><table class="btab"><tr><th></th>${R.map(x => `<th>${x.name}</th>`).join('')}</tr>`;
  for (const [label, get, fmt, big] of rows) {
    const vals = R.map(x => get(x.r)), ok = vals.filter(v => v != null);
    const best = ok.length ? (big ? Math.max(...ok) : Math.min(...ok)) : null, worst = ok.length ? (big ? Math.min(...ok) : Math.max(...ok)) : null;
    h += `<tr><td>${label}</td>${vals.map(v => `<td class="${v != null && ok.length > 1 && best !== worst ? (v === best ? 'best' : v === worst ? 'worst' : '') : ''}">${fmt(v)}</td>`).join('')}</tr>`;
  }
  h += `</table></div><p class="mut">綠色＝這一列最好、紅色＝最差。同一個種子、同一個情境，任務和異常盡量相同，但車子的動作不同後，後面發生的事還是會慢慢不一樣，所以差幾 % 以內可以當作差不多。
    想確認結果穩不穩定，可以換幾個種子再跑。</p>
    <div class="btns"><button id="bCsv">複製成表格（可貼到 Excel）</button></div>`;
  const c = document.getElementById('alarmCard'); if (openAlarm) closeAlarmCard(); maintCardOpen = false;
  c.innerHTML = h; c.style.display = 'block'; c.classList.add('wide');
  document.getElementById('acClose').onclick = () => { c.style.display = 'none'; c.classList.remove('wide'); };
  document.getElementById('bCsv').onclick = () => {
    const lines = [['項目', ...R.map(x => x.name)].join('\t'), ...rows.map(([label, get, fmt]) => [label, ...R.map(x => fmt(get(x.r)))].join('\t'))];
    navigator.clipboard && navigator.clipboard.writeText(lines.join('\n')).then(() => { document.getElementById('bCsv').textContent = '已複製 ✔'; });
  };
}
if (!BENCH) {
  const $b = id => document.getElementById(id);
  $b('bStart').onclick = benchStart;
  $b('bCancel').onclick = benchCancel;
  $b('bShow').onclick = () => benchLast && benchShow(benchLast);
  $b('bSeed').value = Math.floor(Math.random() * 9000) + 1000;
  $b('bScen').onchange = () => { $b('bScenDesc').textContent = BENCH_SCENARIOS[$b('bScen').value].desc; };
  $b('bScen').onchange();
}
