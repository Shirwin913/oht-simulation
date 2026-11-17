// Per-vehicle in-memory event journal. Only transitions are recorded.
const EVENT_TYPES = ['全部','警報','命令','走行','機構','PIO','操作','通訊','修改'];
const EVENT_LIMIT = 5000, EVENT_PAGE = 100;
let eventSeq = 0, eventQuery = '', eventPage = 0, eventFrom = '', eventTo = '';
const eventPrevious = new WeakMap();
function eventAdd(v, type, message, extra = {}) {
  if (!v) return;
  const rows = v.eventJournal || (v.eventJournal = []);
  const row = {seq:++eventSeq, time:simTime, type, message, ...extra};
  rows.push(row); if (rows.length > EVENT_LIMIT) rows.splice(0, rows.length-EVENT_LIMIT);
  return row;
}
function eventSample(v) {
  const j = v.job, p = eventPrevious.get(v), sig = e84Signals(v), m = v.man || {};
  const active = k => m[k] !== undefined && (k !== 'jog' || m[k] > 0);
  const n = {job:j?.id, route:j ? `${j.foup.id}：${j.from.name} → ${j.to.name}`:'', state:v.state, moving:v.v > .05, carry:v.carry?.id, mode:!!v.manual, offline:!!v.offline, estop:!!v.estop, ap:v.ap?.id || v.nextAp?.id || '', lost:!!v.noComm, port:sig.p?.name || '', signals:sig.S, home:!!v.homing, hold:m.hold ? `${m.hold.ax}:${m.hold.dir}`:'', detail:v.detailMove ? `${v.detailMove.ax}:${v.detailMove.dir}`:'', hand:v.handSw ? `${v.handSw.which}:${v.handSw.to}`:'', servo:{...v.servo}, axes:Object.fromEntries(['hoist','shift','claw','guard','jog'].map(k=>[k,active(k)?m[k]:null]))};
  // Jog remaining distance changes continuously: record only start/stop.
  n.axes.jog = n.axes.jog !== null ? true : null;
  eventPrevious.set(v,n);
  if (!p) {eventAdd(v,'操作','模擬車輛初始化'); return;}
  const add=(t,s)=>eventAdd(v,t,s);
  if(n.job!==p.job){if(p.job!=null)add('命令',`命令 ${p.job} 結束或取消：${p.route}`); if(n.job!=null)add('命令',`接收命令 ${n.job}：${n.route}`);}
  else if(n.route!==p.route && n.job!=null)add('命令',`命令 ${n.job} 改派：${n.route}`);
  if(n.state!==p.state)add(['idle','toPick','toDrop','toMaint'].includes(n.state)?'走行':n.state.startsWith('e84')?'PIO':'機構',`${STATE_TXT[p.state]||p.state} → ${STATE_TXT[n.state]||n.state}`);
  if(n.moving!==p.moving)add('走行',n.moving?'開始走行':'停止走行');
  if(n.carry!==p.carry)add('機構',n.carry?`FOUP 在席：${n.carry}`:`FOUP 離席：${p.carry}`);
  for(const [k,a,b] of [['mode','手動','自動'],['offline','下線','上線'],['estop','緊急停止','解除急停'],['home','開始全軸歸原點','全軸歸原點程序結束']])if(n[k]!==p[k])add('操作',n[k]?a:b);
  if(n.lost!==p.lost)add('通訊',n.lost?'通訊中斷':'恢復通訊');
  if(n.ap!==p.ap && n.ap)add('通訊',`AP／閘道器：${p.ap||'無'} → ${n.ap}`);
  if(n.port!==p.port)add('PIO',n.port?`開始監控 ${n.port}`:`結束監控 ${p.port}`);
  for(const [k,val] of Object.entries(n.signals))if((n.port||p.port)&&val!==p.signals[k])add('PIO',`${n.port||p.port} ${k} ${val?'ON':'OFF'}`);
  for(const k of ['hold','detail','hand'])if(n[k]!==p[k])add('機構',`${({hold:'寸動',detail:'相對移動',hand:'山形換手'})[k]} ${n[k]?'開始 '+n[k]:'結束 '+p[k]}`);
  for(const k of Object.keys(n.axes))if(n.axes[k]!==p.axes[k])add('機構',`${AXIS_NAME[k]||({guard:'防墜',jog:'走行寸動'})[k]||k} ${n.axes[k]===null?'動作結束':'目標 '+n.axes[k]}`);
  for(const k of Object.keys(n.servo))if(n.servo[k]!==p.servo[k])add('操作',`${AXIS_NAME[k]||k} 伺服 ${n.servo[k]?'ON':'OFF'}`);
}
// 效能：每個計算小步驟都會呼叫。車子不在取放貨／E84 時，先用一串簡單的「狀態指紋」比對，
// 沒變就跳過（不讀 E84 訊號、不建立物件）；有變或正在取放貨才做完整比對。記錄內容和原本一樣。
function eventKey(v){
  const j=v.job, m=v.man||{}, s=v.servo||{}, d=v.detailMove, h=v.handSw;
  return (j?j.id+'>'+j.foup.id+j.from.name+j.to.name:'')+'|'+v.state+'|'+(v.v>.05?1:0)+'|'+(v.carry?v.carry.id:'')+'|'+(v.manual?1:0)+(v.offline?1:0)+(v.estop?1:0)+(v.noComm?1:0)+(v.homing?1:0)
    +'|'+((v.ap&&v.ap.id)||(v.nextAp&&v.nextAp.id)||'')+'|'+(m.hold?m.hold.ax+m.hold.dir:'')+'|'+(d?d.ax+d.dir:'')+'|'+(h?h.which+h.to:'')
    +'|'+(s.walk?1:0)+(s.hoist?1:0)+(s.shift?1:0)+(s.rot?1:0)+(s.claw?1:0)+'|'+m.hoist+','+m.shift+','+m.claw+','+m.guard+','+(m.jog?1:0);
}
function eventTick(){
  for(const v of vehicles){
    const p=eventPrevious.get(v), busy=!p||p.port||v.state==='e84'||v.state==='e84end'||TRANSFERRING.includes(v.state);
    if(!busy){const k=eventKey(v); if(k===v.evKey)continue; v.evKey=k;} else v.evKey=null;
    eventSample(v);
  }
}
function eventEscape(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function eventTime(s){if(!s)return null; const a=s.split(':'); return a.length===3&&a.every(x=>/^\d+$/.test(x))&&+a[1]<60&&+a[2]<60?+a[0]*3600+ +a[1]*60+ +a[2]:null;}
function eventFiltered(v){const q=eventQuery.toLowerCase(), from=eventTime(eventFrom), to=eventTime(eventTo);return (v.eventJournal||[]).filter(r=>(hmiLogFilter==='all'||r.type===hmiLogFilter||r.level===hmiLogFilter)&&(!q||`${r.message} ${r.type} ${r.level||''}`.toLowerCase().includes(q))&&(from===null||r.time>=from)&&(to===null||r.time<to+1)).reverse();}
function eventExport(v, csv){const rows=eventFiltered(v).reverse(), quote=x=>'"'+String(x??'').replace(/"/g,'""')+'"'; const table=[['車號','模擬時間','類型','等級','內容','結束時間'],...rows.map(r=>[v.id,fmt(r.time),r.type,r.level||'',r.message,r.end==null?'':fmt(r.end)])];const body=csv?'\uFEFF'+table.map(r=>r.map(quote).join(',')).join('\r\n'):table.map(r=>r.join('\t')).join('\n');const url=URL.createObjectURL(new Blob([body],{type:csv?'text/csv;charset=utf-8':'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${v.id}-events.${csv?'csv':'log'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
