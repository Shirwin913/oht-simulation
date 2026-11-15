// tour.js — 自動導覽：一步一步示範每個功能。要按的地方會框起來、旁邊有說明，
//   「自動播放」時會有一個假滑鼠移過去按，新人自己打開就能看，不用有人在旁邊教。
//   每一章是一串步驟：{ t 標題, x 說明, el 要框起來的東西, pre 進入這步時先做的事, act 要示範按的動作, wait 等到條件成立才往下 }

// ---------- 小工具 ----------
const $t = s => document.querySelector(s);
const tourV = () => TOUR.ctx.v;
function followPick(filter, key = u => Math.hypot(u.group.position.x, u.group.position.z)) {
  const v = vehicles.filter(u => !u.fault && !u.manual && !u.offline && !u.maintReq && filter(u)).sort((a, b) => key(a) - key(b))[0]
    || vehicles.find(u => !u.fault && !u.manual);
  TOUR.ctx.v = v; setFollow(v); return v;
}
function closeCards() { if (openAlarm) closeAlarmCard(); if (maintCardOpen) closeMaintCard(); const c = $t('#alarmCard'); if (c) c.style.display = 'none'; }
const HMI_SEL = { manual: '[data-a="manual"]', clear: '.aclr', 'servo:walk': '[data-a="servo:walk:on"]', 'servo:hoist': '[data-a="servo:hoist:on"]',
  'jog:walk': '[data-hold="walk:1"]', claw: '[data-a="claw:open"]', 'home:hoist': '[data-a="home:hoist"]', 'home:shift': '[data-a="home:shift"]',
  confirm: '.rec [data-a="confirm"]', release: '.estop', auto: '[data-a="auto"]',
  cargo: '.rec [data-a="cargo:cart"]', homeall: '[data-a="home:all"]', online: '[data-a="online"]', hand: '.rec [data-a="hand:need"]', hoavbl: '.rec' };
const HMI_WHY = {
  manual: '異常排除一定先切「手動」：天車就不會被系統自動叫走，人員才能安全操作。', clear: '按畫面下方紅色的「警報清除」：清掉異常碼，天車同時切成手動，人員才能安全操作各軸（異常碼不清，伺服、各軸都不能動）。',
  'servo:walk': '馬達過載時走行伺服會跳脫（Off），清完警報要再把走行「伺服 On」。', 'servo:hoist': '吊帶異常時捲揚伺服跳脫了，要先把捲揚「伺服 On」，捲揚才能動。',
  'jog:walk': '讀不到條碼，天車不知道自己在哪。手動往前「寸動」一小段，讓讀碼器重新讀到條碼。', claw: '夾爪「開」，人員確認 FOUP 有放正。',
  'home:hoist': '捲揚「原點」：把吊帶和夾爪收回車上。', 'home:shift': '側移「原點」：把滑台收回車子正中間。', confirm: '先確認前方軌道上沒有人員、工具或掉落物，再往下做。',
  release: '把緊急停止解除。',
  cargo: '看貨物狀況：要清貨就把 FOUP 放到推車（或機台）上，這裡示範放到推車；不清貨可以選「保留在車上」。',
  homeall: '按「歸原點」：所有機構依序做一次原點校正，等「原點成功」。', online: '原點成功後「切上線」：天車恢復自動、重新接任務。',
  hand: '手動切換到需要的手：轉彎切下手、直行切上手（前、後車都不在彎道內才能換）。', hoavbl: '等機台端復歸、光閘淨空，HO_AVBL 恢復 ON。', auto: '最後「切自動」：系統檢查步驟都完成、各軸都在原點，天車就恢復運行（取放貨會重新做一次）。',
};
// 異常排除：依異常碼產生步驟（每一步都用操作介面上的按鈕）
function recoverySteps() {
  const a = vAlarm(tourV()); if (!a) return [];
  const out = [];
  for (const s of recList(a).filter(s => s === 'online' || !stepDone(tourV(), a, s))) {
    if (s === 'homeall' && bogieInCurve(tourV()).some(Boolean)) out.push({   // 停在彎道裡：先寸動移出彎道，才能歸原點、切上線
      t: '排除：走行寸動，把車移出彎道', x: '前車或後車在彎道內時不能歸原點、也不能切上線。按住「前進」寸動，直到前車、後車都顯示「直線」再放開。', el: '[data-hold="walk:1"]',
      act: { fn: () => { const v = tourV(); if (v.man) v.man.jog = 4; } },
      wait: () => { const v = tourV(), out = !bogieInCurve(v).some(Boolean); if (v.man) v.man.jog = out ? 0 : Math.max(v.man.jog || 0, 1); return out; } });
    out.push({ t: `排除：${STEP_TXT[s]}`, x: HMI_WHY[s], el: HMI_SEL[s],
      act: s !== 'hoavbl', wait: () => s === 'online' ? !vAlarm(tourV()) && !tourV().manual : stepDone(tourV(), a, s) && !(tourV().man && Object.keys(tourV().man).length) && !tourV().homing });
  }
  return out;
}

// ---------- 章節 ----------
const CHAPTERS = [
  { name: '1. 認識畫面', steps: [
    { t: '歡迎', x: '這是一座晶圓廠的天車（OHT）搬運模擬：天花板上有四個區塊的單向軌道，天車在上面跑，把 FOUP 在機台的 Load Port 和天花板的儲格（STB）之間搬來搬去。<br>滑鼠左鍵拖曳可以旋轉、右鍵平移、滾輪縮放。', pre: () => { closeCards(); setFollow(null); resetView(); } },
    { t: '統計數字', x: '右邊最上面是最重要的四個數字：模擬時間、每小時搬運量、平均等車時間（FOUP 好了到天車來取要等多久）、目前有幾個異常。下面分成幾個分頁：總覽（更多數字、天車清單、紀錄）、設定、異常、系統功能、燈號／說明。', el: '.stats' },
    { t: '模擬速度', x: '模擬速度可以調快調慢。導覽時先設成 3 倍，看得比較清楚。', el: () => $t('#speed').closest('.row'), act: { fn: () => { const s = $t('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); } } },
    { t: '透視', x: '勾「透視」可以看到車殼裡面：上面的走行輪組（在軌道裡面跑）、捲揚的捲筒。再按一次就關掉。', el: () => $t('#xray').closest('label'), act: true },
    { t: '天車清單', x: '下面是每台天車的狀態清單，點一台就會「跟隨」它，鏡頭會一直跟著那台車。我們挑一台正要去機台取貨的車。', el: () => $t('#vehList').closest('div'),
      pre: () => { if ($t('#xray').checked) $t('#xray').click(); },
      act: { fn: () => followPick(u => u.state === 'toPick' && u.job.from.owner.type === 'machine' && distToTarget(u) > 12, distToTarget) } },   // 挑快到的，不用等太久
    { t: '跟隨列', x: '跟隨時上方會出現這一列：目前狀態、切下線、送保養、操作介面、取消跟隨。', el: '#followBar' },
    { t: '等它開到機台…', x: '天車沿著單向軌道開到機台的 Load Port 上方。注意：進 Bay 前在分岔點、出 Bay 在匯流點，都會跟其他車協調誰先走。', el: '#followBar',
      wait: () => tourV() && ['e84', 'guardOpen', 'shiftOut', 'lower', 'grip'].includes(tourV().state) },
    { t: 'E84 交握', x: '停好以後，天車先跟機台做 <b>E84 交握</b>：天車送 VALID → 機台回 U_REQ（可以取）→ 天車 TR_REQ → 機台 READY。Port 的燈會青色快閃。確認好了才開始動作。', el: '#followBar',
      wait: () => tourV() && ['lower', 'grip', 'raise'].includes(tourV().state) },
    { t: '取貨動作', x: '防墜板先收合 → 捲揚放下吊帶和夾爪 → 夾爪夾住 FOUP → 捲揚收回 → 防墜板伸出擋住（車子行駛中 FOUP 不會掉）。FOUP 不會旋轉，取放都保持同一個方向。', el: '#followBar',
      wait: () => tourV() && tourV().state === 'toDrop' },
    { t: '送去下一站', x: '取到貨了，現在開去下一站（另一台機台，或天花板的 STB 儲格暫放）。這一章結束，可以從選單選下一章。', el: '#followBar' },
  ] },
  { name: '2. 天車故障：用操作介面排除', steps: [
    { t: '天車故障停車', x: '我們跟隨一台正在開的天車，然後讓它發生「馬達過載（E-101）」。', pre: () => { closeCards(); closeHmi(); followPick(u => (u.state === 'toPick' || u.state === 'toDrop') && u.v > 0.5); },
      el: '[data-alarm="vehicle"]',
      act: { fn: () => { const v = tourV(); const a = raiseAlarm('vehicle', ALARM_INFO.vehicle.find(i => i.code === 'E-101'), v, `天車 ${v.id}（${v.seg.name}）`, { autoFail: true }); v.fault = a; TOUR.ctx.a = a; openAlarmCard(a); } } },
    { t: '先自動復歸', x: '天車發生異常後，會先自己「自動復歸」：重試幾秒，成功就自己繼續跑，不用人處理。這次我們讓它失敗，看看人工復歸怎麼做。', el: '#alarmCard',
      wait: () => TOUR.ctx.a && TOUR.ctx.a.autoRecFailed },
    { t: '自動復歸失敗', x: '自動復歸失敗，說明卡會顯示紅字。這時才需要人到現場處理。說明卡上有異常碼、發生了什麼、影響、處理步驟；後面的車會在它後面排隊。', el: '#alarmCard' },
    { t: '開操作介面', x: '到現場要用天車的操作介面處理。按「開操作介面（現場排除）」。', el: '#acHmi', act: true },
    { t: '快速操作畫面', x: '最上面大字是天車狀態（異常停止）。左邊是五個軸：走行、捲揚、側移、旋轉、夾爪，每一軸有伺服、位置、速度、異常碼。走行的異常碼紅色在閃，伺服也跳成 Off 了。', el: '.hquick .axt' },
    { t: '排除步驟', x: '右邊是這個異常碼的排除步驟，現在該做的那一步會亮黃色。照著做就好；按錯順序，下面的訊息列會提醒你。', el: '.rec' },
    { gen: recoverySteps },
    { t: '完成！', x: '天車恢復運行了。<br>你也可以自己試：在面板按「天車故障停車」，再開操作介面，故意按錯順序看看會出現什麼提示。', el: '#followBar', pre: () => setTimeout(closeHmi, 1500) },
  ] },
  { name: '3. 取放貨異常', steps: [
    { t: '取放貨異常', x: '這次讓「下一台開始夾取或放貨的天車」發生取放貨異常（夾爪、吊帶這類問題）。等一下就會有一台車停在半空中。', pre: () => { closeCards(); closeHmi(); setFollow(null); },
      el: '[data-alarm="transfer"]', act: { fn: () => { pendingTransferFault = { autoFail: true }; log('下一台開始夾取／放貨的天車會發生取放貨異常'); } },
      wait: () => alarms.some(a => a.type === 'transfer' && a.autoRecFailed) },
    { t: '找到那台車', x: '異常發生了，而且自動復歸失敗。吊帶和夾爪停在下面，可能還夾著 FOUP。我們直接開它的操作介面。', pre: () => { const a = alarms.find(a => a.type === 'transfer'); TOUR.ctx.v = a.target; setFollow(a.target); openHmi(a.target, 'quick'); }, el: '.rec' },
    { gen: recoverySteps },
    { t: '完成！', x: '吊帶收回、歸原點成功、切上線以後，天車會把這次取放貨從頭重新做一次（如果貨被清到推車或機台上，這筆搬運就取消，由系統重新安排）。<br>互鎖：有貨又不在放貨位置時按「夾爪開」會被擋下來，因為 FOUP 會掉下去。', el: '#followBar', pre: () => setTimeout(closeHmi, 1500) },
  ] },
  { name: '4. 優先級與路權', steps: [
    { t: 'Lot 的優先級', x: '每個 Lot 有優先級：一般、急件、特急。這個表格比較各級的平均等車時間；FOUP 色標橘色是急件、紅色是特急。', pre: () => { closeCards(); closeHmi(); setFollow(null); }, el: '.priBox' },
    { t: '插一筆特急', x: '按「插一筆特急」，把一個還沒派車的 Lot 改成特急。', el: '#btnHot', act: { fn: () => { TOUR.ctx.hot = insertHotLot(); } } },
    { t: '派車', x: '有空車時，系統會先派特急。等它被派到車…', el: '.priBox', wait: () => TOUR.ctx.hot && TOUR.ctx.hot.job && TOUR.ctx.hot.job.vehicle },
    { t: '跟隨特急的車', x: '天車名牌上會標「特急」。在匯流點，特急載貨的車路權最大，其他車要讓它先過；但等很久的一般車分數也會一直加，不會永遠插不進去。', pre: () => { TOUR.ctx.v = TOUR.ctx.hot.job.vehicle; setFollow(TOUR.ctx.v); }, el: '#followBar' },
    { t: '路權規則', x: '「說明」裡有完整的路權排序和規則。', el: '#btnPriInfo', act: true },
    { t: '空車休息、推車', x: '沒接到指令的空車會停在軌道上休息，後面有車要過才會被「推」著往前開。按「休息／推車」可以看說明。這章結束。', el: '#btnParkInfo', act: true },
  ] },
  { name: '5. 下線與保養（捲揚機）', steps: [
    { t: '挑一台空車', x: '跟隨一台沒有任務的空車。', pre: () => { closeCards(); closeHmi(); followPick(u => u.state === 'idle' && !u.job); }, el: '#followBar' },
    { t: '切下線', x: '按「切下線」：天車不再接新任務（手上有任務會先做完），LED 變暗白色。', el: '#btnOnline', act: true, wait: () => tourV().offline },
    { t: '下保養指令', x: '下線的車才能按「送保養」。它會排進維修區，去離它最近、空著的捲揚機。', el: '#btnVehPm', act: true, wait: () => tourV().state === 'toMaint' || MAINT_STATES.includes(tourV().state) },
    { t: '前往維修區…', x: '天車開到維修 Bay，停在捲揚機那一段活動軌道上。（這段先把模擬加速到 6 倍）', el: '#followBar', pre: () => { const s = $t('#speed'); s.value = 6; s.dispatchEvent(new Event('input')); }, wait: () => MAINT_STATES.includes(tourV().state) },
    { t: '捲揚機下降', x: '捲揚機用四條鏈條，把<b>天車連同那一段軌道</b>一起慢慢放到地面（頂上黃燈閃）。這時那段軌道是斷的，所以一台捲揚機一次只能修一台。', el: '#followBar', wait: () => tourV().state === 'repair' },
    { t: '地面維修', x: '天車降到地面，人員站在地上就能檢修（頭上的牌子在倒數）。修好以後捲揚機會升回去，把軌道接回去。', el: () => $t('#maintInfo').closest('.maintBox'), wait: () => tourV().state === 'idle' && !tourV().lift },
    { t: '切上線', x: '保養完回到軌道，但還是「下線」狀態，要人員確認沒問題再「切上線」，才會開始接任務。', el: '#btnOnline', act: true, pre: () => { const s = $t('#speed'); s.value = 3; s.dispatchEvent(new Event('input')); }, wait: () => !tourV().offline },
    { t: '完成！', x: '這台車回到線上接任務了。這章結束。', el: '#followBar' },
  ] },
  { name: '6. 無線 AP 與 AP 斷線', steps: [
    { t: '顯示無線網路', x: '勾「顯示無線網路」：地上的圓圈是天花板每台 AP 的訊號範圍，每台天車拉一條線到它連著的 AP（線的顏色＝哪一台 AP）。', pre: () => { closeCards(); closeHmi(); setFollow(null); resetView(); }, el: () => $t('#showComm').closest('label'), act: { fn: () => { if (!$t('#showComm').checked) $t('#showComm').click(); } } },
    { t: '漫遊（換 AP）', x: '天車不是互相組 Mesh，而是連附近的固定 AP。開遠了、旁邊有更近的 AP，就切過去（漫遊），只要零點幾秒。面板上有累計的漫遊次數。', el: '.commBox' },
    { t: 'AP 斷線', x: '讓一台 AP 斷線看看。', el: '[data-alarm="ap"]', act: { fn: () => { const a = raiseApDown(); TOUR.ctx.ap = a; openAlarmCard(a); focusAlarm(a); } } },
    { t: '影響', x: '斷線的 AP 燈號變紅、範圍圈變紅。原本連它的車會漫遊到隔壁 AP；隔壁也收不到的角落，天車會「通訊中斷」（頭上紅色記號）：手上的指令照做，但收不到新指令、做完也回報不出去。', el: '#alarmCard' },
    { t: '修好 AP', x: 'AP 修好復歸以後，通訊中斷的車會恢復連線並「補回報」。這章結束，全部導覽也都看完了！', el: '#acClear', act: true },
  ] },
];

// ---------- 導覽引擎 ----------
const TOUR = { on: false, ch: null, steps: [], i: -1, auto: false, actDone: true, acting: false, readyAt: 0, enterAt: 0, ctx: {}, saved: null };
const tourUI = (() => {
  const hl = document.createElement('div'); hl.id = 'tourHl'; document.body.appendChild(hl);
  const bub = document.createElement('div'); bub.id = 'tourBub'; document.body.appendChild(bub);
  const cur = document.createElement('div'); cur.id = 'tourCur';
  cur.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M3 2 L3 20 L8 15 L11.5 22 L14.5 20.6 L11 13.8 L18 13.8 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur);
  const btn = document.createElement('button'); btn.id = 'tourBtn'; btn.textContent = '🎓 導覽'; document.body.appendChild(btn);
  const menu = document.createElement('div'); menu.id = 'tourMenu'; document.body.appendChild(menu);
  btn.onclick = () => { menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; renderMenu(); };
  return { hl, bub, cur, btn, menu };
})();
function renderMenu() {
  tourUI.menu.innerHTML = `<div class="tm-h">🎓 自動導覽：選一章開始</div>${CHAPTERS.map((c, i) => `<button data-ch="${i}">${c.name}</button>`).join('')}
    <label><input type="checkbox" id="tourAutoChk" ${TOUR.auto ? 'checked' : ''}> 自動播放（假滑鼠自己按）</label>`;
  tourUI.menu.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => { TOUR.auto = $t('#tourAutoChk').checked; tourUI.menu.style.display = 'none'; tourStart(+b.dataset.ch); });
}
function tourStart(ci) {
  if (!TOUR.on) TOUR.saved = { autoAlarm, speed };
  autoAlarm = false; const aa = $t('#autoAlarm'); if (aa) aa.checked = false;
  if (paused) $t('#btnPause').click();
  const s = $t('#speed'); s.value = 3; s.dispatchEvent(new Event('input'));
  TOUR.on = true; TOUR.ch = ci; TOUR.steps = CHAPTERS[ci].steps.slice(); TOUR.i = -1; TOUR.ctx = {};
  tourNext();
}
function tourEnd() {
  TOUR.on = false; tourUI.hl.style.display = tourUI.bub.style.display = tourUI.cur.style.display = 'none';
  if (TOUR.saved) { const s = $t('#speed'); s.value = TOUR.saved.speed; s.dispatchEvent(new Event('input')); }
}
function tourNext() {
  TOUR.i++;
  while (TOUR.i < TOUR.steps.length && TOUR.steps[TOUR.i].gen) {           // 動態步驟（異常排除依異常碼產生）
    const g = TOUR.steps[TOUR.i].gen(); TOUR.steps.splice(TOUR.i, 1, ...g);
  }
  if (TOUR.i >= TOUR.steps.length) { tourChapterDone(); return; }
  const st = TOUR.steps[TOUR.i];
  try { st.pre && st.pre(TOUR.ctx); } catch (e) { console.warn(e); }
  TOUR.actDone = !st.act; TOUR.acting = false; TOUR.enterAt = performance.now(); TOUR.readyAt = 0;
  setTimeout(() => {
    const el = tourEl(st); if (!el) return;
    const tab = el.closest('[data-ptab]'); if (tab) showPanelTab(tab.dataset.ptab);   // 要按的東西在別的分頁：先切過去
    if (el.closest('#panel')) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 50);
  renderBubble();
}
function tourChapterDone() {
  const nx = TOUR.ch + 1 < CHAPTERS.length ? TOUR.ch + 1 : null;
  tourUI.hl.style.display = 'none'; tourUI.cur.style.display = 'none';
  const b = tourUI.bub; b.style.display = 'block'; b.style.left = '50%'; b.style.top = '18%'; b.style.transform = 'translateX(-50%)';
  b.innerHTML = `<div class="tb-h">✔ ${CHAPTERS[TOUR.ch].name} 完成</div><div class="tb-x">${nx !== null ? `下一章：${CHAPTERS[nx].name}` : '全部章節都看完了！之後可以自己動手操作看看。'}</div>
    <div class="tb-b">${nx !== null ? `<button id="tbNextCh" class="pri">繼續下一章</button>` : ''}<button id="tbMenu">章節選單</button><button id="tbEnd">結束導覽</button></div>`;
  if (nx !== null) $t('#tbNextCh').onclick = () => tourStart(nx);
  $t('#tbMenu').onclick = () => { tourEnd(); tourUI.menu.style.display = 'block'; renderMenu(); };
  $t('#tbEnd').onclick = tourEnd;
  if (TOUR.auto && nx !== null) TOUR.autoNextCh = setTimeout(() => { if (TOUR.on && TOUR.i >= TOUR.steps.length) tourStart(nx); }, 5000);
}
function tourEl(st) { if (!st || !st.el) return null; try { return typeof st.el === 'function' ? st.el() : $t(st.el); } catch (e) { return null; } }
const tourCanNext = st => TOUR.actDone && (!st.wait || st.wait(TOUR.ctx));
function renderBubble() {
  const st = TOUR.steps[TOUR.i]; if (!st) return;
  const b = tourUI.bub; b.style.display = 'block'; b.style.transform = 'none';
  const n = TOUR.steps.filter(s => !s.gen).length;
  b.innerHTML = `<div class="tb-h"><span>${CHAPTERS[TOUR.ch].name}</span><span class="tb-n">${TOUR.i + 1}／${n}</span></div>
    <div class="tb-t">${st.t}</div><div class="tb-x">${st.x || ''}</div><div class="tb-w" id="tbWait"></div>
    <div class="tb-b">${st.act ? '<button id="tbDo">👆 示範這一步</button>' : ''}<button id="tbNext" class="pri">下一步 ▶</button>
    <label><input type="checkbox" id="tbAuto" ${TOUR.auto ? 'checked' : ''}>自動播放</label><button id="tbEnd">結束</button></div>`;
  if (st.act) $t('#tbDo').onclick = () => tourDoAct();
  $t('#tbNext').onclick = () => { if (tourCanNext(st)) tourNext(); };
  $t('#tbAuto').onchange = e => { TOUR.auto = e.target.checked; };
  $t('#tbEnd').onclick = tourEnd;
}
// 示範按：假滑鼠移過去 → 點一下 → 真的執行
function tourDoAct() {
  const st = TOUR.steps[TOUR.i]; if (!st || !st.act || TOUR.actDone || TOUR.acting) return;
  TOUR.acting = true;
  const el = tourEl(st), c = tourUI.cur;
  const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  c.style.display = 'block';
  requestAnimationFrame(() => { c.style.left = (r.left + r.width / 2) + 'px'; c.style.top = (r.top + r.height / 2) + 'px'; });
  setTimeout(() => {
    c.classList.add('click'); setTimeout(() => c.classList.remove('click'), 350);
    const cur = TOUR.steps[TOUR.i]; if (cur !== st) return;
    { const e3 = tourEl(st), tab = e3 && e3.closest('[data-ptab]'); if (tab) showPanelTab(tab.dataset.ptab); }
    try { if (st.act.fn) st.act.fn(TOUR.ctx); else { const e2 = tourEl(st); if (e2) e2.click(); } } catch (e) { console.warn(e); }
    TOUR.actDone = true; TOUR.acting = false;
  }, 900);
}
// 使用者自己按到被框起來的按鈕，也算完成這一步（有自訂動作的步驟改成執行導覽的版本）
document.addEventListener('click', e => {
  if (!TOUR.on) return; const st = TOUR.steps[TOUR.i]; if (!st || !st.act || TOUR.actDone) return;
  const el = tourEl(st); if (!el || !el.contains(e.target)) return;
  if (st.act.fn) { e.preventDefault(); e.stopPropagation(); st.act.fn(TOUR.ctx); }
  TOUR.actDone = true;
}, true);
// 每幀：框框和說明跟著目標走；自動播放時到時間就自己按、自己下一步
function tourFrame() {
  requestAnimationFrame(tourFrame);
  if (!TOUR.on || TOUR.i < 0 || TOUR.i >= TOUR.steps.length) return;
  const st = TOUR.steps[TOUR.i], el = tourEl(st), hl = tourUI.hl, b = tourUI.bub;
  if (el && el.getClientRects().length) {
    const r = el.getBoundingClientRect();
    Object.assign(hl.style, { display: 'block', left: (r.left - 6) + 'px', top: (r.top - 6) + 'px', width: (r.width + 12) + 'px', height: (r.height + 12) + 'px' });
    const bw = b.offsetWidth, bh = b.offsetHeight;
    let x = r.left - bw - 18, y = r.top + r.height / 2 - bh / 2;
    if (x < 10) x = r.right + 18;
    if (x + bw > innerWidth - 10) { x = Math.min(Math.max(10, r.left), innerWidth - bw - 10); y = r.bottom + 14; if (y + bh > innerHeight - 10) y = r.top - bh - 14; }
    b.style.left = x + 'px'; b.style.top = Math.max(10, Math.min(innerHeight - bh - 10, y)) + 'px';
  } else { hl.style.display = 'none'; b.style.left = '50%'; b.style.top = '14%'; b.style.transform = 'translateX(-50%)'; }
  const ok = tourCanNext(st), w = $t('#tbWait'), nb = $t('#tbNext');
  if (nb) nb.disabled = !ok;
  if (w) w.textContent = !TOUR.actDone ? (TOUR.auto ? '' : '👉 自己按框起來的地方，或按「示範這一步」') : ok ? '' : '⏳ 等待中…（模擬進行中，稍等一下）';
  if (TOUR.auto) {
    const now = performance.now();
    if (!TOUR.actDone && !TOUR.acting && now - TOUR.enterAt > 1500 + (st.x || '').length * 25) tourDoAct();
    if (ok) { if (!TOUR.readyAt) TOUR.readyAt = now; if (now - TOUR.readyAt > (st.act ? 1500 : 2200 + (st.x || '').length * 35)) tourNext(); }
  }
}
tourFrame();
