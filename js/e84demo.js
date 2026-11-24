// e84demo.js — E84 交握動畫：挑一台正要到機台 Load Port 取放貨的天車，鏡頭跟著它，
//   畫面下方顯示 E84 訊號燈、訊號時序圖和每一步說明；交握那幾步自動放慢，讓人看得清楚。
//   訊號一律從 e84Signals(v)（hmi.js）讀，跟操作介面的 E84 燈號是同一套。

// 兩端 PIO 各 8 個送出（OUT）通道；天車的 OUT 就是機台的 IN，反之亦然。通道順序依 E84 訊號表，實際接腳依廠牌設備為準
const E84_DEMO_SIG = {
  active: [['VALID', '這次交握有效（天車要開始了）'], ['CS_0', '選擇 Load Port（第 1 組）'], ['CS_1', '選擇載台 1（OHT 一般只用 CS_0）'], ['AM_AVBL', '天車可以交握（多用在 AGV）'],
    ['TR_REQ', '請求搬送'], ['BUSY', '天車正在取放（機台不可動作）'], ['COMPT', '搬送完成'], ['CONT', '連續搬送（同一次交握接著做下一筆）']],
  passive: [['L_REQ', '可以放貨（Port 是空的）'], ['U_REQ', '可以取貨（貨在 Port 上）'], ['VA', '天車到站（多用在 AGV，OHT 不用）'], ['READY', '機台準備好，天車可以動作'],
    ['VS_0', '被動端車輛的載台 0（OHT 不用）'], ['VS_1', '被動端車輛的載台 1（OHT 不用）'], ['HO_AVBL', '可以交握（機台正常、光閘沒被擋）'], ['ES', '緊急停止：訊號 ON＝沒有急停，所以平常是亮的；EMO、門互鎖時熄滅']],
};
const E84_DEMO_USED = new Set(['VALID', 'CS_0', 'TR_REQ', 'BUSY', 'COMPT', 'L_REQ', 'U_REQ', 'READY', 'HO_AVBL', 'ES']);
const E84_DEMO_STEPS = [
  ['天車前往機台 Load Port', '天車接到搬運命令，正開往機台的 Load Port。開始交握前，機台端通訊器要先是待命的燈號：Load Port 在 Auto 模式時，INPUTS 的 7（HO_AVBL）、8（ES）和 PWR 三顆亮著，其他都暗（READY 也是暗的）。只亮 ES、PWR 代表 Load Port 在 Manual；只亮 PWR 代表 EMO、門或 Robot 互鎖有問題，天車到了也不能取放。'],
  ['確認 HO_AVBL', 'HO_AVBL＝機台告訴天車「現在可以交握」。機台異常或 Load Port 前的光閘被擋到時是 OFF，天車只能等，等到逾時就放棄這次取放。'],
  ['天車：CS_0 ＋ VALID', '天車送出 CS_0（選擇這個 Port）和 VALID（這次交握有效，我要開始了）。'],
  ['機台：L_REQ／U_REQ', '機台回覆：放貨時送 L_REQ（Port 是空的，可以放）；取貨時送 U_REQ（貨在 Port 上，可以取）。'],
  ['天車：TR_REQ', '天車送出 TR_REQ：請求開始搬送。'],
  ['機台：READY', '機台收到 TR_REQ、確認 Load Port 準備好，送出 READY（INPUTS 4 亮起來）：天車可以開始動作。'],
  ['天車：BUSY（取放動作）', '天車送出 BUSY 後開始動作：防墜板收回 → 捲揚下降 → 夾爪放開（放貨）或夾住（取貨）。BUSY 期間機台不能動 Load Port。'],
  ['機台：L_REQ／U_REQ 關', '機台的在席感測器確認 FOUP 已經放上（或已經被取走），把 L_REQ／U_REQ 關掉。天車捲揚上升。'],
  ['天車：BUSY、TR_REQ 關 → COMPT', '捲揚回到原點：天車關掉 BUSY 和 TR_REQ，送出 COMPT（搬送完成）。'],
  ['機台：READY 關', '機台收到 COMPT，確認完成，把 READY 關掉。機台端通訊器回到待命燈號（HO_AVBL、ES、PWR）。'],
  ['天車：VALID、COMPT、CS_0 關', '天車關掉 VALID、COMPT、CS_0，這次交握結束。防墜板放下，天車離開去做下一件事。'],
];
// 每一步的模擬速度：交握訊號那幾步很快（實際不到 1 秒），放很慢；取放動作用一般速度
const E84_DEMO_SPEED = [2, 0.5, 0.12, 0.12, 0.12, 0.12, 0.8, 0.8, 0.15, 0.15, 0.6];

let e84Demo = null;     // { v, port, op, step, samples:[{S,step}], prevSpeed, prevFollow, done }

function e84DemoPort(v) {
  if (!v.job) return null;
  if (v.state === 'toPick' || (v.op === 'pick' && TRANSFERRING.includes(v.state))) return v.job.from;
  if (v.state === 'toDrop' || (v.op === 'drop' && TRANSFERRING.includes(v.state))) return v.job.to;
  return null;
}
function e84DemoPick() {
  let best = null, bd = Infinity;
  for (const v of vehicles) {
    if (v.fault || v.manual || v.offline || v.noComm || !(v.state === 'toPick' || v.state === 'toDrop')) continue;
    const p = e84DemoPort(v); if (!p || p.owner.type !== 'machine' || !hoAvbl(p)) continue;
    const f = frameAt(p.seg, p.d), d = Math.hypot(v.group.position.x - f.x, v.group.position.z - f.z);
    const score = d < 8 ? 1000 + d : d;                         // 太近的看不到接近過程，排後面
    if (score < bd) { bd = score; best = v; }
  }
  return best;
}
function e84DemoStepOf(v, S) {
  const st = v.state;
  if (st === 'toPick' || st === 'toDrop') return 0;
  if (st === 'e84') return !S.HO_AVBL ? 1 : 2 + Math.min(3, Math.floor(v.timer / E84_TIME * 4));   // READY 現場是提早亮的，所以照交握進度判斷
  if (st === 'e84end') return S.READY ? 8 : 9;
  if (st === 'raise' || st === 'shiftIn') return 7;
  if (st === 'guardClose') return 10;
  return 6;
}
function e84DemoSetSpeed(x) {
  speed = x;
  const sv = document.getElementById('speedVal'); if (sv) sv.textContent = `${x}x（動畫）`;
}
function startE84Demo() {
  if (e84Demo) stopE84Demo(true);
  e84Demo = { v: null, port: null, op: null, step: -1, samples: [], prevSpeed: speed, prevFollow: followed, done: false, waitT: 0, note: '' };
  if (paused && typeof $ === 'function' && $('btnPause')) $('btnPause').click();
  e84DemoBuild();
  e84DemoAttach(e84DemoPick());
}
function e84DemoAttach(v) {
  const D = e84Demo; if (!D) return;
  if (!v) { D.note = '正在等一台天車接到機台的取放貨任務…'; e84DemoRender(); return; }
  D.v = v; D.port = e84DemoPort(v); D.op = v.state === 'toPick' ? 'pick' : 'drop'; D.step = -1; D.samples = []; D.done = false; D.note = '';
  setFollow(v);
  // 鏡頭拉近到天車斜後上方
  v.group.getWorldPosition(tmp); tmp.y -= 1.5;
  controls.target.copy(tmp); camera.position.set(tmp.x + 6, tmp.y + 3.2, tmp.z + 6);
  e84DemoRender();
}
function stopE84Demo(silent) {
  const D = e84Demo; if (!D) return;
  e84Demo = null;
  speed = D.prevSpeed; const s = document.getElementById('speed'); if (s) s.value = speed;
  const sv = document.getElementById('speedVal'); if (sv) sv.textContent = speed + 'x';
  if (!silent) setFollow(D.prevFollow && vehicles.includes(D.prevFollow) ? D.prevFollow : null);
  const el = document.getElementById('e84Demo'); if (el) el.style.display = 'none';
}
// 每一幀（main.js）呼叫
function e84DemoTick() {
  const D = e84Demo; if (!D) return;
  if (!D.v) {                                                     // 還在等適合的車
    D.waitT += 1; if (D.waitT % 30 === 0) e84DemoAttach(e84DemoPick());
    e84DemoSetSpeed(4); return;
  }
  if (D.done) return;
  const v = D.v;
  if (v.fault || v.manual || v.offline) { D.note = '這台天車發生異常／被切手動，動畫中止。可以按「換一台再看」。'; D.done = true; e84DemoFinish(); return; }
  const p = e84DemoPort(v);
  if (D.step >= 6 && !TRANSFERRING.includes(v.state)) { D.step = 10; D.done = true; e84DemoFinish(); return; }   // 交握結束、天車離開
  if (p !== D.port) {
    if (D.step <= 0) { D.port = p; if (!p || p.owner.type !== 'machine') { e84DemoAttach(e84DemoPick()); return; } }   // 任務被改掉：換一台
    else { D.note = '交握中斷（機台逾時或任務取消）。'; D.done = true; e84DemoFinish(); return; }
  }
  const { S } = e84Signals(v), step = e84DemoStepOf(v, S);
  if (step < D.step && D.step >= 2 && step <= 1) { D.note = '交握被中斷（HO_AVBL 變 OFF），天車重新等待。'; }
  D.step = step;
  if (step >= 1) D.samples.push({ S: Object.assign({}, S), step });
  if (D.samples.length > 4000) D.samples.splice(0, D.samples.length - 4000);
  e84DemoSetSpeed(E84_DEMO_SPEED[step]);
  e84DemoRender();
}
function e84DemoFinish() {
  const D = e84Demo; if (!D) return;
  speed = D.prevSpeed; const s = document.getElementById('speed'); if (s) s.value = speed;
  const sv = document.getElementById('speedVal'); if (sv) sv.textContent = speed + 'x';
  e84DemoRender();
}

// ---------- 畫面 ----------
function e84DemoBuild() {
  let el = document.getElementById('e84Demo');
  if (!el) {
    el = document.createElement('div'); el.id = 'e84Demo'; document.body.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-e84d]'); if (!b) return;
      if (b.dataset.e84d === 'close') stopE84Demo();
      if (b.dataset.e84d === 'again' && e84Demo) { e84Demo.v = null; e84Demo.waitT = 0; e84DemoAttach(e84DemoPick()); }
    });
  }
  el.style.display = 'block';
}
function e84DemoRender() {
  const D = e84Demo, el = document.getElementById('e84Demo'); if (!D || !el) return;
  // 交握結束後天車已經離開（換了任務），燈號停在最後一刻；不然會讀到下一個 Port 的訊號（HO_AVBL 誤顯示 OFF）
  const v = D.v, S = D.done && D.samples.length ? D.samples[D.samples.length - 1].S : v ? e84Signals(v).S : {}, step = Math.max(0, D.step);
  const reqOn = n => (D.op === 'pick' ? n !== 'L_REQ' : n !== 'U_REQ');          // 這次用得到的 REQ
  // 兩顆 PIO 畫成實際 E84 光通訊器（Optical Transceiver）的面板：黑色方形外殼，左排 OUTPUTS 1～8＋GO、右排 INPUTS 1～8＋PWR，
  //   燈號亮在編號方框裡（紅點）。接腳照 DB-25 表：機台端 INPUTS 是機台送出的訊號（L_REQ…ES）、OUTPUTS 是收到的天車訊號（VALID…CONT）；
  //   天車端剛好相反。GO＝兩顆對準、光通訊建立；PWR＝通訊器有電。ES 訊號 ON＝沒有急停，所以平常是亮的
  const used = n => E84_DEMO_USED.has(n) && (n === 'L_REQ' || n === 'U_REQ' ? reqOn(n) : true);
  const go = !!(v && !D.done && e84Signals(v).p);                          // 天車停在 Port 上方、兩顆對準
  const ledOn = n => n === 'GO' ? go : n === 'PWR' ? true : !!(v && S[n]);
  const tipOf = n => ((E84_DEMO_SIG.active.concat(E84_DEMO_SIG.passive).find(x => x[0] === n) || [])[1] || '') + (E84_DEMO_USED.has(n) ? '' : '（這個模擬沒有用到）');
  const device = (title, outs, ins, isEq, uid) => {
    const box = (x, y, num, on, tip, w = 15) => `<g><title>${tip}</title><rect x="${x}" y="${y}" width="${w}" height="12" rx="1" fill="#0b0c0e" stroke="#e5e7eb" stroke-width=".9"/>`
      + (on ? `<circle cx="${x + w / 2}" cy="${y + 6}" r="3.6" fill="#ff2a2a" filter="url(#gl${uid})"/>` : `<text x="${x + w / 2}" y="${y + 9}" class="bn">${num}</text>`) + '</g>';
    const rowY = i => 48 + i * 16;
    const rows = outs.map(([o], i) => {
      const y = rowY(i), n2 = ins[i][0], oOn = ledOn(o), iOn = ledOn(n2);
      return box(97, y, i + 1, oOn, `OUTPUTS ${i + 1}：${o}，${tipOf(o)}`) + box(166, y, i + 1, iOn, `INPUTS ${i + 1}：${n2}，${tipOf(n2)}`)
        + `<text x="66" y="${y + 9}" class="nm l ${oOn ? 'on' : ''} ${used(o) ? '' : 'un'}"><title>${tipOf(o)}</title>${o}</text>`
        + `<text x="216" y="${y + 9}" class="nm ${iOn ? 'on' : ''} ${used(n2) ? '' : 'un'}"><title>${tipOf(n2)}</title>${n2}</text>`;
    }).join('');
    const gy = rowY(8) + 6;
    const extra = box(97, gy, 'GO', ledOn('GO'), 'GO：兩顆通訊器對準、光通訊建立', 19) + box(164, gy, 'PWR', true, 'PWR：通訊器有電', 21)
      + `<text x="66" y="${gy + 9}" class="nm l ${go ? 'on' : ''}">GO</text><text x="216" y="${gy + 9}" class="nm on">PWR</text>`;
    const svg = `<svg viewBox="0 0 282 232" class="pio-svg" role="img" aria-label="${title}">
      <defs><linearGradient id="bg${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2d32"/><stop offset="1" stop-color="#111214"/></linearGradient>
        <filter id="gl${uid}" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <rect x="74" y="14" width="134" height="208" rx="9" fill="url(#bg${uid})" stroke="#000" stroke-width="1.4"/>
      ${[[80, 20], [202, 20], [80, 216], [202, 216]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#050506" stroke="#3a3d42"/>`).join('')}
      <text x="141" y="34" class="ttl">E84 OPTICAL TRANSCEIVER</text>
      <text x="117" y="112" class="vt" transform="rotate(90 117 112)">OUTPUTS</text>
      <text x="153" y="112" class="vt" transform="rotate(90 153 112)">INPUTS</text>
      ${rows}${extra}
    </svg>`;
    // 機台端：照現場文件的判讀方式提示（Load Port 空的、在 Online 時）
    const ho = ledOn('HO_AVBL'), es = ledOn('ES');
    const hint = isEq ? `<div class="pio-3t">${ho && es ? 'HO_AVBL、ES、PWR 都亮：Auto 模式正常' : es ? '只亮 ES、PWR：Load Port 在 Manual（不是的話：查 LP 安全感測器、連線、線材）' : '只亮 PWR：查 EMO、機台門互鎖、Robot 互鎖'}</div>` : '';
    return `<div class="pio-dev2"><div class="pio-hd">${title}</div>${svg}${hint}</div>`;
  };
  const R = D.op === 'pick' ? 'U_REQ' : 'L_REQ';
  const ladder = [['r', 'VALID、CS_0 ON', 2], ['l', `${R} ON`, 3], ['r', 'TR_REQ ON', 4], ['l', 'READY ON', 5], ['r', 'BUSY ON', 6],
    ['a', D.op === 'pick' ? '捲揚下降、夾取 FOUP' : '捲揚下降、FOUP 放置', 6], ['l', `${R} OFF`, 7], ['r', 'BUSY、TR_REQ OFF・COMPT ON', 8], ['l', 'READY OFF', 9], ['r', 'VALID、CS_0、COMPT OFF', 10]]
    .map(([d, t, s]) => `<div class="lr ${d} ${s < step || (D.done && step >= 10) ? 'done' : s === step ? 'cur' : ''}"><span>${t}</span>${d === 'a' ? '' : '<b></b>'}</div>`).join('');
  const head = v ? `${v.id} → ${D.port ? D.port.name : '—'}（${D.op === 'pick' ? '取貨' : '放貨'}）` : '尋找天車中…';
  const [title, text] = E84_DEMO_STEPS[step];
  const html = `<div class="hd"><span>🤝 E84 交握動畫｜${head}</span>
      <span class="sp">${D.done ? '' : `模擬速度 ${speed}x`}</span>
      <button data-e84d="again">換一台再看</button><button data-e84d="close">✕ 結束</button></div>
    <div class="bd">
      <div class="col">${device('天車端（主動端 Active）', E84_DEMO_SIG.passive, E84_DEMO_SIG.active, false, 'a')}</div>
      <div class="col">${device('機台端（被動端 Passive）', E84_DEMO_SIG.active, E84_DEMO_SIG.passive, true, 'p')}</div>
      <div class="col wide">
        <div class="now"><b>${D.done && step >= 10 ? '✔ 交握完成' : step === 1 ? `等待：${title}` : `第 ${step === 0 ? 1 : step} 步：${title}`}</b><p>${D.note || text}</p></div>
        <canvas width="460" height="150"></canvas>
        <div class="mut pn">兩顆通訊器用紅外光對射。機台端：INPUTS 是機台自己送出的訊號、OUTPUTS 是收到的天車訊號；天車端剛好相反。方框裡紅點亮＝訊號 ON（ES 平常就亮）；GO＝兩顆對準、PWR＝有電。灰字的通道 OHT 用不到。</div>
      </div>
      <div class="steps ladder"><div class="lh"><span>OHT 天車</span><span>Load Port</span></div>${ladder}</div>
    </div>`;
  // 只換文字區，canvas 保留（避免閃爍）
  if (!el.dataset.built) { el.innerHTML = html; el.dataset.built = '1'; }
  else {
    const tmpEl = document.createElement('div'); tmpEl.innerHTML = html;
    el.querySelector('.hd').replaceWith(tmpEl.querySelector('.hd'));
    const cols = el.querySelectorAll('.bd > .col'), ncols = tmpEl.querySelectorAll('.bd > .col');
    cols[0].replaceWith(ncols[0]); cols[1].replaceWith(ncols[1]);
    el.querySelector('.now').replaceWith(tmpEl.querySelector('.now'));
    el.querySelector('.steps').replaceWith(tmpEl.querySelector('.steps'));
  }
  e84DemoWave(el.querySelector('canvas'));
}
// 訊號時序圖：橫軸是播放順序（放慢的步驟自然拉得比較寬），每條訊號一列
function e84DemoWave(cv) {
  const D = e84Demo; if (!cv || !D) return;
  if (cv.clientWidth && cv.width !== Math.round(cv.clientWidth)) cv.width = Math.round(cv.clientWidth);   // 依實際寬度畫，避免拉伸模糊
  const cx = cv.getContext('2d'), W = cv.width, Hc = cv.height;
  const rows = ['CS_0', 'VALID', D.op === 'pick' ? 'U_REQ' : 'L_REQ', 'TR_REQ', 'READY', 'BUSY', 'COMPT', 'HO_AVBL'];
  const act = new Set(['CS_0', 'VALID', 'TR_REQ', 'BUSY', 'COMPT']);
  const LW = 62, rh = (Hc - 8) / rows.length, n = D.samples.length;
  cx.clearRect(0, 0, W, Hc);
  cx.font = '10px ui-monospace, monospace'; cx.textBaseline = 'middle';
  rows.forEach((r, i) => {
    const y0 = 4 + i * rh;
    cx.fillStyle = act.has(r) ? '#38bdf8' : '#fbbf24'; cx.fillText(r, 2, y0 + rh / 2);
    cx.strokeStyle = 'rgba(148,163,184,.25)'; cx.beginPath(); cx.moveTo(LW, y0 + rh - 1); cx.lineTo(W, y0 + rh - 1); cx.stroke();
    if (!n) return;
    cx.strokeStyle = act.has(r) ? '#38bdf8' : '#fbbf24'; cx.lineWidth = 1.6; cx.beginPath();
    for (let k = 0; k < n; k++) {
      const x = LW + (W - LW - 4) * (k / Math.max(1, n - 1)), on = D.samples[k].S[r];
      const y = on ? y0 + 3 : y0 + rh - 3;
      if (k === 0) cx.moveTo(x, y); else {
        const prevOn = D.samples[k - 1].S[r]; if (prevOn !== on) cx.lineTo(x, prevOn ? y0 + 3 : y0 + rh - 3);
        cx.lineTo(x, y);
      }
    }
    cx.stroke(); cx.lineWidth = 1;
  });
}

// ---------- 3D：兩顆 PIO 的燈號和中間的紅外光束（每幀，main.js 呼叫） ----------
//   Load Port 端：綠＝HO_AVBL ON 待命、紅閃＝OFF；交握中兩顆都青色閃，訊號一變就亮一下，中間畫一道光束
const pioBeams = [], _pioA = new THREE.Vector3();
function pioBeam(i) {
  if (!pioBeams[i]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.frustumCulled = false; scene.add(m); pioBeams[i] = m;
  }
  return pioBeams[i];
}
function pioVisuals(t) {
  const blink = 0.5 + 0.5 * Math.sin(t * 16);
  for (const p of ports) if (p.pioLed) {
    const ok = hoAvbl(p); setLed(p.pioLed, ok ? C.green : C.red, ok ? 0.55 : 0.3 + 1.2 * blink);
    if (p.pio3) { setLed(p.pio3[0], C.red, 1.3); setLed(p.pio3[1], C.red, ok ? 1.3 : 0); setLed(p.pio3[2], C.red, 0); }   // READY：交握時收到 TR_REQ 才亮（下面天車迴圈設定）
  }
  let n = 0;
  for (const v of vehicles) {
    let on = false;
    if (v.job && v.state !== 'guardClose' && TRANSFERRING.includes(v.state)) {
      const p = transferPort(v);
      if (p && p.pioLed) {
        const { S } = e84Signals(v);
        if (S.VALID || S.CS_0) {
          on = true;
          const key = Object.values(S).join('');
          if (key !== v.pioKey) { v.pioKey = key; v.pioFlash = 1; }
          v.pioFlash = Math.max(0, (v.pioFlash || 0) - 0.035);
          setLed(p.pioLed, C.cyan, 0.7 + 0.5 * blink + 1.6 * v.pioFlash);
          if (p.pio3) setLed(p.pio3[2], C.red, S.READY ? 1.3 : 0);
          if (v.group.visible !== false) {
            v.group.localToWorld(_pioA.set(PIO_X, VPIO.y - 0.006, VPIO.z));
            const b = pioBeam(n++), len = _pioA.distanceTo(p.pioPos);
            b.position.copy(_pioA).add(p.pioPos).multiplyScalar(0.5); b.scale.set(1 + v.pioFlash * 1.5, len, 1 + v.pioFlash * 1.5);
            b.quaternion.setFromUnitVectors(THREE.Object3D.DefaultUp, _pioA.clone().sub(p.pioPos).normalize());
            b.material.opacity = 0.25 + 0.25 * blink + 0.5 * v.pioFlash; b.visible = true;
          }
        }
      }
    }
    if (v.pioMat) { v.pioMat.emissive.copy(on ? C.cyan : C.off); v.pioMat.emissiveIntensity = on ? (0.6 + 0.4 * blink) * (1 + 1.5 * (v.pioFlash || 0)) : 0; }
    if (!on) v.pioKey = null;
  }
  for (let i = n; i < pioBeams.length; i++) pioBeams[i].visible = false;
}
