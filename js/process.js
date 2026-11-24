// Load Port MOVIN / MOVOUT 與晶圓出入；加工時間沿用 procTime。
const DOCK_DISTANCE = .25, DOCK_SECONDS = 3, FOUP_DOOR_SECONDS = 2;
function machineCycleStart(p, f, duration) {
  if (p.owner.type !== 'machine') return;
  if (f.empty) { f.state='ready'; f.outputKind='stb'; f.waferCount=0; f.doorOpen=0; p.dock=0; p.processStage='空 FOUP，等待回儲位'; return; }
  f.state = 'docking'; f.timer = Math.max(.1,duration); f.processDuration = f.timer;
  f.waferCount = 25; f.waferTransfer = null; f.doorOpen = 0;
  f.storageWaitingSince = null; delete f.outputKind;
  p.dock = 0; p.processStage = 'MOVIN 前移對接';
}
function updateWaferProgress(f) {
  const progress = Math.max(0,Math.min(1,1-f.timer/f.processDuration));
  f.waferTransfer = null;
  if (progress < .35) {
    const u = progress/.35*25, n = Math.floor(u); f.waferCount = 25-n;
    f.waferTransfer = {index:24-n, x:(u-n)*.62};
  } else if (progress < .65) f.waferCount = 0;
  else {
    const u = Math.min(25,(progress-.65)/.35*25), n = Math.floor(u); f.waferCount = n;
    if (n < 25) f.waferTransfer = {index:n, x:(1-(u-n))*.62};
  }
}
function stepMachinePort(p, dt) {
  const f = p.foup; if (!f || p.owner.down) return;
  // 天車放貨後先完成吊升、交握與防墜收尾，台面才可前移。
  if (p.e84 || f.unreported || (f.state==='docking' && jobs.some(j=>j.to===p || j.from===p))) return;
  const before = [p.dock, f.doorOpen, f.waferCount];
  if (f.state === 'docking') {
    p.dock = Math.min(1,p.dock+dt/DOCK_SECONDS);
    if (p.dock >= 1) { f.state='processing'; p.processStage='開啟 FOUP 門'; }
  } else if (f.state === 'processing') {
    if (f.doorOpen < 1) f.doorOpen = Math.min(1,f.doorOpen+dt/FOUP_DOOR_SECONDS);
    else {
      f.timer = Math.max(0,f.timer-dt); updateWaferProgress(f);
      p.processStage = f.waferTransfer ? (f.timer/f.processDuration > .65 ? '逐片取出晶圓' : '逐片放回晶圓') : '機台內加工';
      if (f.timer <= 0) { f.waferCount=25; f.waferTransfer=null; f.state='undocking'; p.processStage='關閉 FOUP 門'; }
    }
  } else if (f.state === 'undocking') {
    if (f.doorOpen > 0) f.doorOpen = Math.max(0,f.doorOpen-dt/FOUP_DOOR_SECONDS);
    else {
      p.processStage='MOVOUT 後退解除對接'; p.dock=Math.max(0,p.dock-dt/DOCK_SECONDS);
      if (p.dock <= 0) { f.state='ready'; p.processStage='待取貨'; }
    }
  }
  if (p.deck) p.deck.position.z = -p.dock*DOCK_DISTANCE;
  if (before[0]!==p.dock || before[1]!==f.doorOpen || before[2]!==f.waferCount) placeFoupAt(f,p);
}
// 開場已有的在製品也走完整對接流程，保留原先隨機的剩餘加工時間。
for (const p of ports) if (p.owner.type==='machine' && p.foup && p.foup.state==='processing') machineCycleStart(p,p.foup,p.foup.timer);

function updateProcessUI() {
  const sel=document.getElementById('processPort'), info=document.getElementById('processInfo');
  if (!sel || !info) return;
  const p=ports.find(p=>p.id===Number(sel.value)); if(!p) return;
  const f=p.foup;
  const mb=document.getElementById('processMode'); if (mb) { mb.textContent = p.lpMode==='manual' ? 'Manual → 切 Auto' : 'Auto → 切 Manual'; mb.className = p.lpMode==='manual' ? 'warn' : ''; }
  info.textContent = `${p.name}（${p.lpMode==='manual'?'Manual：E84 只亮 ES、PWR，天車不能取放':'Auto'}）：${f ? (p.processStage || (f.state==='ready'?'待取貨':f.state)) : '空閒'} · 台面前移 ${Math.round((p.dock||0)*DOCK_DISTANCE*1000)} mm` +
    (f ? ` · ${f.id} · 盒內 ${f.empty?0:(f.waferCount??25)}／25 片${!f.empty && (f.waferCount??25)<25 ? '（其餘在機台內）':''}` : '');
}
{
  const sel=document.getElementById('processPort');
  sel.innerHTML=ports.filter(p=>p.owner.type==='machine').map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const first = ports.find(p=>p.owner.type==='machine' && p.foup); if(first) sel.value=String(first.id);
  document.getElementById('processView').onclick=()=>{
    const p=ports.find(p=>p.id===Number(sel.value)); if(!p) return; setFollow(null);
    const dx=Math.cos(p.rot), dz=-Math.sin(p.rot);
    controls.target.set(p.x+dx*.2,1.4,p.z+dz*.2);
    camera.position.set(p.x-dx*2.0-dz*1.7,2.15,p.z-dz*2.0+dx*1.7);
  };
  sel.onchange=updateProcessUI;
  // Load Port 模式：Manual 時 HO_AVBL 關掉（機台端 E84 只剩 ES、PWR 亮），派車系統不會派車過來；取放到一半切 Manual 會報 E-204
  document.getElementById('processMode').onclick=()=>{
    const p=ports.find(p=>p.id===Number(sel.value)); if(!p) return;
    p.lpMode = p.lpMode==='manual' ? 'auto' : 'manual';
    log(`🔧 ${p.name} Load Port 切成 ${p.lpMode==='manual'?'Manual（HO_AVBL OFF，不收送貨）':'Auto（HO_AVBL ON）'}`);
    updateProcessUI();
  };
}
