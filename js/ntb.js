// NTB 人員投取貨：只有人員取走時 FOUP 才離開系統。
let ntbInCount = 0, ntbOutCount = 0;
const ntbSelected = () => ntbs[Number(document.getElementById('ntbSelect').value) || 0];
// 選站別就好：投貨按鈕自動用該站的投貨座（M 奇數），出庫／取走自動用取貨座（M 偶數）
const ntbInPort = () => ntbSelected().ports.find(p => p.ntbDirection === 'in');
const ntbOutPort = () => ntbSelected().ports.find(p => p.ntbDirection === 'out');
const ntbBusy = p => p.reserved || !!p.e84 || jobs.some(j => j.from === p || j.to === p);
function ntbMessage(message) { document.getElementById('ntbMessage').textContent = message; }
function ntbExportEmpty(p) {
  if (p.ntbDirection !== 'out') return ntbMessage('這是投貨座；請選取貨座下出庫指令');
  if (p.foup || ntbBusy(p) || !usable(p)) return ntbMessage('這個 NTB Port 已佔用、已預約或不可用，請換一格');
  const sources = ports.filter(q => q.owner.type === 'stb' && q.foup && q.foup.empty && !q.foup.job && !q.foup.unreported && usable(q) && routeDist(q,p) < Infinity);
  sources.sort((a,b) => routeDist(a,p) - routeDist(b,p));
  if (!sources.length) return ntbMessage('目前沒有可出庫且可到達本站的空 FOUP');
  const from = sources[0], f = from.foup;
  p.gateAccess = false; p.reserved = true; f.state = 'ready';
  const job = {id:++jobSeq, from, to:p, foup:f, created:simTime, vehicle:null, pri:0};
  f.job = job; jobs.push(job);
  log(`📤 NTB 出庫 ${f.id}：${from.name} → ${p.name}`);
  ntbMessage(`已下出庫指令：${f.id} → ${p.name}，抵達並完成交握後再按「人員取走」`);
}
function ntbTick(dt) {
  for (const station of ntbs) for (const p of station.ports) {
    const open = !ntbBusy(p) && ((p.ntbDirection === 'out' && p.foup && p.foup.state === 'ntbOut') || (p.ntbDirection === 'in' && !p.foup && p.gateAccess));
    const target = open ? 1 : 0;
    p.gate += Math.sign(target-p.gate) * Math.min(Math.abs(target-p.gate), dt/2);
    p.gateMesh.position.y = -p.gate * .82;
  }
}
const ntbDoorText = p => p.gate >= .999 ? '窗門已降下／可投取貨' : p.gate <= .001 ? '窗門升起／封閉' : '窗門升降中';
function ntbTake(p) {
  if (p.ntbDirection !== 'out') return ntbMessage('這是投貨座；只能從取貨座取走 FOUP');
  if (ntbBusy(p)) return ntbMessage('天車已預約或正在作業，請等任務與交握結束');
  if (!p.foup || p.foup.state !== 'ntbOut') return ntbMessage('這個 Port 沒有等待人員取走的 FOUP');
  if (p.gate < .999) return ntbMessage('氣動門尚未全開，不能取貨');
  const slot = p.owner.rack.find(s => !s.foup);
  if (!slot) return ntbMessage('旁邊的 FOUP 鐵架已滿，請先將架上的 FOUP 重新投入');
  p.gateAccess = false;
  const f = p.foup; p.foup = null; f.port = null; f.state = 'rack';
  slot.foup = f; placeFoupAt(f,slot); ntbOutCount++;
  log(`🧑 ${p.name} 人員取走${f.empty ? '空' : '有貨'} FOUP ${f.id}`);
  ntbMessage(`已取走 ${f.id}，FOUP 已移出天車系統、放到 ${slot.name} 鐵架`);
}
function ntbInsert(p, empty) {
  if (p.ntbDirection !== 'in') return ntbMessage('這是取貨座；請改選投貨座投入 FOUP');
  if (p.foup || ntbBusy(p) || !usable(p)) return ntbMessage('Port 已佔用、已預約或不可用，不能投貨');
  if (p.gate < .999) return ntbMessage('氣動門尚未全開，不能投貨');
  const slot = p.owner.rack.find(s => s.foup && s.foup.empty === empty);
  if (!slot && !FB.free.length && FB.used >= FOUP_MAX) return ntbMessage('模擬 FOUP 顯示容量已滿，請先取走 FOUP');
  let f;
  if (slot) { f = slot.foup; slot.foup = null; f.port = p; f.state = 'ready'; f.job = null; f.unreported = false; delete f.outputKind; p.foup = f; placeFoupAt(f,p); }
  else f = spawnFoup(p, 'ready', empty);
  p.gateAccess = false; ntbInCount++;
  log(`🧑 ${p.name} 人員投入${empty ? '空' : '有貨'} FOUP ${f.id}`);
  ntbMessage(`已投入 ${f.id}；等待預約 STB 空儲位後派車入庫`);
}
function updateNtbUI() {
  const station = ntbSelected(); if (!station) return;
  const pin = ntbInPort(), pout = ntbOutPort();
  const lbl = { ntbOpen: `${pin.moduleId} 開門允許投貨`, ntbClose: `${pin.moduleId} 結束投貨／升門`, ntbEmpty: `${pin.moduleId} 投入空 FOUP`, ntbLoaded: `${pin.moduleId} 投入有貨 FOUP`, ntbExport: `叫空 FOUP 出庫到 ${pout.moduleId}`, ntbTake: `${pout.moduleId} 人員取走` };
  for (const id in lbl) { const b = document.getElementById(id); if (b && b.textContent !== lbl[id]) b.textContent = lbl[id]; }
  document.getElementById('ntbInfo').innerHTML = station.ports.map(p => `<div><b>${p.name}（${p.ntbDirection === 'in' ? '投貨' : '取貨'}）</b>：${p.foup ? `${p.foup.id}（${p.foup.empty ? '空盒' : '有貨'}）· ${p.foup.state === 'ntbOut' ? '等待人員取走' : p.foup.job ? '等待天車入庫' : '等待空儲位入庫'}` : p.reserved ? '天車送貨中／已預約' : '空閒'}${p.e84 ? ' · E84 交握中' : ''} · ${ntbDoorText(p)}</div>`).join('') + `<div>站旁鐵架：${station.rack.filter(s=>s.foup).length}／${station.rack.length} 格${station.rack.filter(s=>s.foup).map(s=>`<br>${s.name}：${s.foup.id}（${s.foup.empty?'空盒':'有貨'}）`).join('')}</div><div class="mut">累計投入 ${ntbInCount} 個／取走 ${ntbOutCount} 個 · 場上空 FOUP ${ports.filter(p=>p.foup && p.foup.empty).length + vehicles.filter(v=>v.carry && v.carry.empty).length} 個</div>`;
}
{
  const select = document.getElementById('ntbSelect');
  select.innerHTML = ntbs.map((s,i) => `<option value="${i}">${s.name}</option>`).join('');
  select.onchange = () => { updateNtbUI(); ntbMessage(''); }; updateNtbUI();
  document.getElementById('ntbView').onclick = () => { const s = ntbSelected(); setFollow(null); controls.target.set(s.x,2,s.z); camera.position.set(s.x+9,11,s.z+12); };
  document.getElementById('ntbOpen').onclick = () => { const p = ntbInPort(); if (p.ntbDirection !== 'in') return ntbMessage('只能在投貨座申請開門'); if (ntbBusy(p) || p.foup || !usable(p)) return ntbMessage('Port 已佔用或正在作業，不能開門投貨'); p.gateAccess = true; ntbMessage('允許投貨，窗門下降中；完全降下後再投入 FOUP'); };
  document.getElementById('ntbClose').onclick = () => { const p = ntbInPort(); p.gateAccess = false; if (p.foup && p.foup.state === 'ntbOut') return ntbMessage('這一格正在等待人員取貨，取走後會自動升門'); ntbMessage('結束投貨許可，窗門升起封閉'); };
  document.getElementById('ntbExport').onclick = () => ntbExportEmpty(ntbOutPort());
  document.getElementById('ntbTake').onclick = () => ntbTake(ntbOutPort());
  document.getElementById('ntbEmpty').onclick = () => ntbInsert(ntbInPort(),true);
  document.getElementById('ntbLoaded').onclick = () => ntbInsert(ntbInPort(),false);
}
