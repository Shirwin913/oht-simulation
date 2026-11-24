// alarms.js — 異常事件（教學用）：天車故障停車、取放貨異常、機台／Load Port 當機、軌道區段封鎖
//
// 每個異常都有：警報代碼、發生了什麼、會造成什麼影響、現場一般怎麼處理（給新人看的說明），
// 以及「復歸」按鈕。可以手動觸發，也可以開「隨機自動發生」。
// 說明內容是一般 AMHS 的通用做法，各廠實際 SOP 以公司規定為準。

const alarms = [];
let alarmSeq = 0, autoAlarm = false, autoAlarmT = 120, pendingTransferFault = false;

// ---------- 教學說明 ----------
const ALARM_INFO = {
  vehicle: [
    { code: 'E-101', title: '天車走行馬達過載',
      what: '天車的走行馬達電流超過上限，控制器為了保護馬達自動停車。',
      impact: '軌道是單線的，後面的天車沒辦法超車，只能在後面排隊。塞車會一路往上游擴散，可能把匯流點堵住，連 Bay 裡的車都出不來。這台車手上的搬運任務也會延遲。',
      steps: ['在監控畫面（MCS）確認警報代碼與天車位置', '通知值班的 AMHS 工程師／維修人員', '必要時把這一段軌道設為封鎖，讓其他天車改道', '維修人員到現場（走維修走道或用高空作業車）檢查馬達、輪子', '排除後在控制器復歸，確認天車自我檢查正常', '解除封鎖，觀察後面排隊的車是否消化'] },
    { code: 'E-102', title: '定位條碼讀取失敗',
      what: '天車讀不到軌道上的定位條碼（位置標記），不確定自己的位置，為了安全停車。',
      impact: '跟所有「天車停在軌道上」的異常一樣：後面的車全部排隊，塞車往上游擴散。',
      steps: ['確認警報位置與天車編號', '檢查該處軌道的條碼標籤是否髒污、刮傷或脫落', '檢查天車的讀碼器鏡頭', '清潔或更換後復歸，讓天車重新定位', '觀察天車是否能正常行走到下一個條碼'] },
    { code: 'E-103', title: '前方障礙物感測持續觸發',
      what: '車頭的障礙物感測器一直偵測到前方有東西（可能是掉落物、維修人員，或感測器髒污誤判），天車停下等待。',
      impact: '天車停在原地，後面的車排隊。如果真的有人或東西在軌道附近，這是保護安全的正確反應。',
      steps: ['先確認前方軌道有沒有人員、工具或掉落物', '確認是誤判的話，清潔感測器鏡面', '確認安全後才能復歸', '同一位置常常發生的話，要回報檢查感測器或軌道周邊'] },
    // 走到一半（還沒到機台）就停下來的異常：車上有貨的話，貨留在車上，有貨賦歸後繼續送
    { code: 'E-106', title: '走行輪異常',
      what: '走行輪的轉速／扭力回饋不正常（輪子磨損、打滑，或卡到軌道上的異物），天車為了安全停車。',
      impact: '天車停在軌道上，後面的車全部排隊、塞車往上游擴散；車上的貨也送不出去。',
      steps: ['警報清除（天車切手動）', '檢查走行輪：磨損、異物卡住、軌道面有沒有油污或掉落物', '確認輪子可以轉動後，寸動確認走得動', '歸原點，原點成功後切上線（車上有貨就有貨賦歸，繼續送）'] },
    { code: 'E-107', title: '開蓋檢知觸發',
      what: '天車外殼或維修蓋的開蓋感測器觸發（蓋子沒蓋好、鎖扣鬆脫，或被碰開），天車停車。',
      impact: '天車停在軌道上，後面的車排隊。蓋子沒蓋好時內部機構外露，不能繼續跑。',
      steps: ['警報清除（天車切手動）', '確認外殼／維修蓋蓋好、鎖扣扣好，開蓋檢知燈熄滅', '歸原點，原點成功後切上線'] },
    { code: 'E-108', title: '碰撞感測器觸發',
      what: '天車前後的碰撞感測器（保險桿）被壓到：可能碰到前車、軌道上的東西，或感測器本身鬆脫誤動作。天車立刻停車。',
      impact: '天車停在軌道上，後面的車排隊。如果真的撞到東西，要先確認天車和貨有沒有受損。',
      steps: ['警報清除（天車切手動）', '檢查碰撞感測器（保險桿）有沒有被撞到、變形，讓它復位；確認前方沒有東西', '確認天車和車上的貨沒有受損', '歸原點，原點成功後切上線'] },
    { code: 'E-109', title: '天車無法賦歸（斷線／伺服無法切換）',
      what: '天車跟系統斷線，或伺服沒辦法切 On／Off，操作介面上的按鈕都沒有反應，沒辦法照一般步驟賦歸。',
      impact: '天車停在原地（可能在軌道上，也可能在 Port 上方），後面的車排隊。',
      steps: ['天車斷電重啟（等控制器重新開機、連線）', '警報清除（天車切手動）', '依貨物狀況選有貨或無貨賦歸', '歸原點，原點成功後切上線'] },
  ],
  transfer: [
    { code: 'E-201', title: '夾爪夾取失敗',
      what: '夾爪降到 FOUP 上方後，感測器沒有確認夾到 FOUP 頂部的 flange（可能 FOUP 放歪、flange 變形或有異物）。天車停在原地，吊帶還放著。',
      impact: '天車停在這個 Port 上方不能走，後面的天車都過不去；這個 Port 也暫時不能上下貨。',
      steps: ['確認警報的天車與 Port 位置', '不要直接用手拉 FOUP 或吊帶', '由工程師以手動模式把夾爪收回', '檢查 FOUP 擺放位置、flange 有沒有變形', '把 FOUP 重新放正後復歸，天車重新執行取貨'] },
    { code: 'E-202', title: '放貨在席感測／E84 交握異常',
      what: '放下 FOUP 後，Load Port 的在席感測沒有回報「放好了」，或是天車和機台之間的 E84 交握逾時。E84 是天車和 Load Port 互相確認「可以放／放好了」的訊號交握標準（SEMI E84）。',
      impact: '天車停在 Port 上方等確認，後面的車排隊；FOUP 狀態不確定，不能直接開始加工。',
      steps: ['確認 FOUP 是否正確坐在定位銷上', '檢查 Load Port 的在席感測器', '檢查 E84 訊號或光通訊器是否正常', '確認 FOUP 狀態正確後復歸'] },
    { code: 'E-203', title: '捲揚吊帶異常',
      what: '升降時吊帶張力或長度異常（打滑、纏繞），天車停止升降。',
      impact: '天車停在 Port 上方、吊帶放在半空中，後面的車排隊。',
      steps: ['不可以強行升降', '通知維修人員檢查吊帶與捲揚鼓', '吊帶有損傷的話要更換', '復歸後先試升降一次，確認正常'] },
  ],
  machine: [
    { code: 'M-301', title: '機台當機',
      what: '機台本身發生異常停機（製程、硬體或軟體問題），Load Port 不能上下貨。',
      impact: '機台上的 FOUP 出不去；本來要送來這台機台的 FOUP 要改送別台機台或先放 STB 暫存（改派）；派車系統要避開這台機台。',
      steps: ['CIM：確認是設備（機台）的問題 → 通知設備工程師到現場處理', '設備工程師：處理機台異常、賦歸 Load Port（CIM 不賦歸機台）', '機台停機期間，派車系統避開這台機台；路上的任務改派到其他機台或 STB', '如果有天車正在這台機台上下貨被中斷（E-204），CIM 只賦歸天車，不用等機台修好', '設備工程師修好、確認後，機台恢復，派車系統才會再派貨過來'], owner: '設備工程師' },
    { code: 'M-302', title: 'Load Port 門開關異常',
      what: 'Load Port 開關 FOUP 門的機構異常，這台機台的 Port 暫時不能用。',
      impact: '跟機台當機一樣：要送來的貨要改派，機台上的 FOUP 卡住出不去。',
      steps: ['CIM：確認是 Load Port（設備）的問題 → 通知設備工程師到現場處理', '設備工程師：檢查 Load Port 開門機構與感測器、賦歸 Load Port', '這個 Port 暫停收送貨，路上的任務改派', '如果有天車正在這個 Port 上下貨被中斷（E-204），CIM 只賦歸天車', '設備工程師修好後恢復'], owner: '設備工程師' },
  ],
  track: [
    { code: 'T-401', title: 'Bay 軌道維修封鎖',
      what: '這條 Bay 的軌道要做保養或維修，暫時封鎖，天車不能進去。',
      impact: 'Bay 裡的機台和 STB 暫時送不進去也拿不出來；要送進這條 Bay 的任務會改派；已經在 Bay 裡的天車開出來後就不能再進去。',
      steps: ['事先公告維修時段', '在系統把這段軌道設為封鎖，等 Bay 裡的天車都開出來', '確認區段內沒有天車才開始作業，現場掛警示', '作業完成、確認軌道上沒有遺留工具後解除封鎖'] },
    { code: 'T-402', title: '區塊連接線封鎖',
      what: '兩個區塊之間的一條連接線暫時封鎖（維修或異常）。',
      impact: '要跨區的天車會自動改走別條連接線繞路，路程變長、搬運時間增加，其他連接線的車流也會變多。',
      steps: ['在系統把連接線設為封鎖，派車系統自動改用其他路線', '觀察其他連接線和匯流點有沒有塞車', '作業完成、確認後解除封鎖，路線恢復'] },
  ],
  ap: [
    { code: 'N-501', title: '無線 AP 斷線（有線網路中斷）',
      what: '天花板上一台無線 AP 和控制系統之間的有線網路斷了（交換器、網路線或光纖異常）。AP 本身可能還亮著，但訊號送不回控制系統。',
      impact: '原本連這台 AP 的天車會自動漫遊到隔壁的 AP，大多數車不受影響；只有隔壁 AP 也收不到的角落，天車會「通訊中斷」：手上的指令照做，但收不到新指令，做完了也回報不出去，MCS 不知道 FOUP 已經放好，所以那個 FOUP 的下一站也會延遲。',
      steps: ['在監控畫面確認是哪一台 AP、影響範圍內有幾台車', '通知 IT／網路人員檢查交換器與網路線', '觀察範圍內的天車有沒有成功漫遊到其他 AP', '修復後確認 AP 重新上線、通訊中斷的車有恢復並補回報'] },
    { code: 'N-502', title: '無線 AP 故障（電源／硬體）',
      what: '一台 AP 斷電或硬體故障，完全沒有訊號。',
      impact: '跟有線網路中斷一樣：附近的車漫遊到隔壁 AP；AP 規劃時讓相鄰 AP 的範圍互相重疊，就是為了這種時候還能接手。重疊不夠的地方就會有通訊死角。',
      steps: ['確認 AP 的電源和指示燈', '通知 IT 更換 AP 或檢查供電（PoE）', '更換後確認訊號範圍和漫遊正常'] },
  ],
};
ALARM_INFO.host = [{ code: 'S-601', title: '派車控制系統（OCS）當機',
  what: '負責把搬運任務指定給天車的派車控制系統當機了（伺服器、程式或網路異常）。MCS 還會產生搬運任務，但沒有人把任務派給天車。',
  impact: '「中央派車」模式：完全停止派車，空車停著等、待搬運的 FOUP 越積越多，恢復後要一段時間才消化得完。「天車自主接任務」模式：天車互相協調、自己接任務，影響很小。已經在搬的貨都會照常送完。',
  steps: ['通知系統人員確認 OCS 伺服器和程式狀態', '必要時切換備援主機', '恢復後觀察待派車任務是否慢慢消化'] }];
const ALARM_TYPE_NAME = { vehicle: '天車故障停車', transfer: '取放貨異常', machine: '機台／Load Port 當機', track: '軌道區段封鎖', ap: '無線 AP 斷線', host: '派車系統當機' };
// ---------- 換手失敗（山形上下手）----------
const E105_INFO = { code: 'E-105', title: '換手失敗（山形上下手）',
  what: '天車在分岔點前要切換導引輪（轉彎切下手、直行切上手），但換手動作沒有完成（機構卡住、感測器沒偵測到到位）。',
  impact: '天車停在分岔點前，後面的車排隊。前、後走行輪在彎道內時不能換手、不能歸原點、也不能切上線。',
  steps: ['確認天車不在彎道內（操作介面會顯示前車／後車有沒有入彎）', '警報清除（天車切手動）', '手動切換到需要的手（上手／下手）', '歸原點 → 原點成功後切上線'] };
function raiseHandFail(v, need, opts) {
  if (!v) { pendingHandFail = true; log('下一台要在分岔點換手的天車，換手會失敗'); return null; }
  handInit(v);
  const side = rndA() < 0.5 ? 'f' : 'r';                              // 其中一手沒切到位：另一手已經換好
  if (side === 'f') v.hr = need; else v.hf = need; v.hand = v.hf === v.hr ? v.hf : 'mixed';
  const a = raiseAlarm('vehicle', E105_INFO, v, `天車 ${v.id}（${v.seg.name}，要切${handName(need)}，${side === 'f' ? '前手' : '後手'}沒切到位）`, opts);
  a.handSide = side; v.fault = a; v.v = 0; v.handSw = null; v.handNeed = need; return a;
}
const E205_INFO = { code: 'E-205', title: '夾爪狀態不明（開、閉極限都沒亮）',
  what: '放貨時夾爪動作到一半停住，開極限、閉極限兩個感測器都沒亮，天車不知道夾爪現在是開還是閉，FOUP 有沒有夾牢也不確定。',
  impact: '天車停在 Port 上方，吊帶放著，後面的車排隊。夾爪狀態不明時貨不能留在車上，一定要清貨。',
  steps: ['警報清除（天車切手動）', '人員扶住 FOUP，把貨清到推車或機台上', '夾爪切到開極限', '捲揚、側移回原點', '歸原點，原點成功後切上線'] };
// 教學觸發：下一台「放貨」的天車夾爪狀態不明／下一台在機台下降快到底的天車停住（貨離機台很近）／下一台故障的車無法復歸
function raiseClawUnknown() { pendingTransferFault = { clawUnknown: true, autoFail: true }; log('下一台放貨的天車，夾爪會停在半途（狀態不明）'); return null; }
function raiseNearPort() { pendingTransferFault = { nearPort: true, autoFail: true }; log('下一台在機台放貨的天車，捲揚會在快到底時停住'); return null; }
function raiseNoRecover() { return raiseVehicleFault(null, { noRecover: true, autoFail: true }); }
// ---------- 光閘遮斷／機台異常：E84 的 HO_AVBL 掉下來，取放貨中斷 ----------
// ---------- 現場常見的三種取放貨失敗 ----------
// 1) HO_AVBL 中斷：交握前就沒有 HO → 天車等到逾時，不取放、直接把貨送回儲位（不報警）；
//    取放到一半 HO 才中斷 → 天車卡在 Port 上方，報 E-204
// 2) 夾貨時捲揚皮帶張力異常：夾爪夾歪，或 FOUP 上放了東西（手機、原子筆）頂到夾爪
const E206_INFO = { code: 'E-206', title: '捲揚皮帶張力異常（夾爪夾歪／FOUP 上有異物）',
  what: '天車下降夾貨時，夾爪沒有對正 FOUP 頂部的 flange（夾歪），或是 FOUP 上面放了東西（產線人員順手放的手機、原子筆等），夾爪頂到、捲揚皮帶張力突然變大，天車立刻停止捲揚。',
  impact: '天車停在 Port 上方、吊帶放在半空中，夾爪可能卡在 FOUP 上；後面的車排隊。異物沒拿掉之前，重試一樣會失敗。',
  steps: ['警報清除（天車切手動）', '到 Port 旁檢查 FOUP 上方：拿掉異物（手機、筆等），確認 FOUP 擺正', '夾爪切到開極限', '捲揚、側移回原點', '歸原點，原點成功後切上線（天車重新取貨）'] };
// 教學觸發
function raiseHoDrop() {                                              // 交握前：下一台要到機台 Load Port 取放貨的天車，那個 Port 的 HO_AVBL 斷 40 秒
  const cand = vehicles.filter(v => !v.fault && !v.manual && v.job && (v.state === 'toPick' || v.state === 'toDrop')).map(v => [v, v.state === 'toPick' ? v.job.from : v.job.to]).filter(([, p]) => p.owner.type === 'machine' && hoAvbl(p));
  const [v, p] = cand.sort((a, b) => a[0].route.length - b[0].route.length)[0] || [];
  if (!p) { log('目前沒有天車正要去機台取放貨，等一下再試'); return null; }
  p.hoOff = simTime + 40;
  log(`⚡ ${p.name} 的 HO_AVBL 訊號中斷（約 40 秒）：${v.id} 到站後等不到 HO_AVBL，逾時就不取放、把貨送回儲位`);
  return null;
}
const FOREIGN = { phone: ['手機', () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.009, 0.155), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: .3 }));
    const sc = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.002, 0.14), new THREE.MeshStandardMaterial({ color: 0x1e3a8a, emissive: 0x1e40af, emissiveIntensity: .5 })); sc.position.y = 0.0055; g.add(b, sc); return g; }],
  pen: ['原子筆', () => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.145, 10), new THREE.MeshStandardMaterial({ color: 0x2563eb }));
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0xf8fafc })); c.position.y = 0.06; g.add(m, c); g.rotation.z = Math.PI / 2; g.rotation.y = 0.5; return g; }] };
function raiseForeignObject(kind) {                                   // 產線人員把手機／筆放在等著被取走的 FOUP 上
  const ps = ports.filter(p => p.owner.type === 'machine' && p.foup && !p.foup.empty && !p.foup.foreign);
  // 先挑天車已經在路上要來取的，再挑做完在等取的，最後挑最快做完的
  const busy = q => ['docking', 'processing', 'undocking'].includes(q.foup.state);   // 對接、加工、退出中的 FOUP 在機台裡，人員放不了東西
  const p = ps.find(q => q.foup.job && q.foup.job.vehicle) || ps.find(q => q.foup.state === 'ready')
    || ps.filter(busy).sort((x, y) => x.foup.timer - y.foup.timer)[0];
  if (!p) { log('目前沒有在機台 Port 上等著被取走的 FOUP'); return null; }
  kind = kind || (rndA() < 0.5 ? 'phone' : 'pen');
  const [name, make] = FOREIGN[kind], f = p.foup, m = make();
  const r = portRot(p), ox = -0.12, oz = 0.1;
  m.position.set(p.x + ox * Math.cos(r) + oz * Math.sin(r), p.top + 0.66, p.z - ox * Math.sin(r) + oz * Math.cos(r)); m.rotation.y += r;
  if (!BENCH) scene.add(m);
  f.foreign = { kind, name, mesh: m };
  log(`📱 產線人員把${name}放在 ${p.name} 的 ${f.id} 上面，下一台來取貨的天車夾爪會頂到`);
  return null;
}
function removeForeign(f) { if (f && f.foreign) { if (f.foreign.mesh && f.foreign.mesh.parent) f.foreign.mesh.parent.remove(f.foreign.mesh); f.foreign = null; } }
function raiseCantRecover() { const v = pickA(vehicles.filter(x => !x.fault && !x.manual && (MOVING.includes(x.state) || TRANSFERRING.includes(x.state))));
  if (!v) return null; const a = raiseAlarm('vehicle', ALARM_INFO.vehicle.find(i => i.code === 'E-109'), v, `天車 ${v.id}（${v.seg.name}）`); v.fault = a; v.v = 0; return a; }
function raiseGripTilt() { pendingTransferFault = { tension: true, autoFail: true }; log('下一台夾貨的天車，夾爪會夾歪（捲揚皮帶張力異常）'); return null; }
function raiseHoMid() {                                               // 取放中：正在機台 Load Port 下降／夾放的天車，HO_AVBL 突然中斷 20 秒 → E-204 卡在那邊
  const v = pickA(vehicles.filter(x => !x.fault && ['lower', 'grip', 'release'].includes(x.state) && transferPort(x) && transferPort(x).owner.type === 'machine'));
  if (!v) { pendingHoMid = true; log('下一台在機台 Load Port 開始下降的天車，HO_AVBL 會在取放中途中斷'); return null; }
  return hoMidCut(v);
}
let pendingHoMid = false;
function hoMidCut(v) { pendingHoMid = false; const p = transferPort(v); p.hoOff = simTime + 20; log(`⚡ ${p.name} 取放到一半 HO_AVBL 訊號中斷`); return e204(v, p, 'HO 訊號中斷'); }
const E204_INFO = { code: 'E-204', title: '取放貨中斷：HO_AVBL OFF（光閘遮斷／機台異常）',
  what: '天車在機台 Load Port 取放貨時，機台送來的 E84 訊號 HO_AVBL（可以交握）突然變 OFF。常見原因：Load Port 前面的光閘被擋到（人員、手推車、工具伸進去），或是機台本身異常。',
  impact: '天車立刻停止捲揚動作，吊帶和夾爪停在半空中，這次取放貨失敗；後面的車在 Bay 裡排隊。機台端也會跳警報。',
  steps: ['確認原因：光閘區域有沒有人員、物品擋住，或是機台故障', '機台／Load Port 故障是設備問題：通知設備工程師到現場，Load Port 由設備工程師賦歸', 'CIM 不用等 HO 恢復，直接賦歸天車：警報清除 → 選有／無貨賦歸 → 捲揚、側移回原點 → 歸原點 → 切上線', '切上線後天車重新做 E84 交握；HO 還沒恢復就逾時，貨回原儲位'] };
let pendingCurtain = false;
const transferPort = v => v.job ? (v.op === 'pick' ? v.job.from : v.job.to) : null;
const hoAvbl = p => !!p && (p.owner.type === 'machine' || p.owner.type === 'ntb') && !p.owner.down && p.lpMode !== 'manual' && !(p.curtain > simTime) && !(p.hoOff > simTime) && (p.owner.type !== 'machine' || ((p.dock || 0) <= .001 && !(p.foup && p.foup.doorOpen > .001))) && (p.owner.type !== 'ntb' || p.gate <= 0.001);   // 機台給的 HO_AVBL
// 光閘遮斷：stepTransfer 在天車開始下降時呼叫（pendingCurtain），或手動觸發時直接找正在取放的車
function raiseCurtain(v, opts = {}) {
  if (!v) {
    v = pickA(vehicles.filter(x => !x.fault && ['lower', 'grip', 'release'].includes(x.state) && transferPort(x) && transferPort(x).owner.type === 'machine'));
    if (!v) { pendingCurtain = opts.pending || true; log('下一台在機台 Load Port 開始下降的天車，光閘會被擋到'); return null; }
  }
  pendingCurtain = false;
  const port = transferPort(v);
  port.curtain = simTime + (opts.block || 5);                     // 光閘被擋 5 秒
  curtainFx(port, true);
  log(`🚧 ${port.name} 光閘被遮斷 → E84 HO_AVBL OFF`);
  return e204(v, port, '光閘遮斷', opts);
}
function e204(v, port, why, opts = {}) {
  const a = raiseAlarm('transfer', E204_INFO, v, `天車 ${v.id} @ ${port.name}（${why}）`, opts);
  v.fault = a; a.port = port; return a;
}
// 光閘的紅色光束（被擋到時閃）
const curtainBeams = new Map();
function curtainFx(port, on) {
  if (on && !curtainBeams.has(port)) {
    const g = groupAt(port.seg, port.d), m = mat(0xff2020, { emissive: 0xff2020, emissiveIntensity: 2 });
    for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.012, 0.012), m); b.position.set(0, 1.12 + k * 0.13, LC_Z); g.add(b); }
    curtainBeams.set(port, { g, m });
  }
  if (!on && curtainBeams.has(port)) { scene.remove(curtainBeams.get(port).g); curtainBeams.delete(port); }
}
function curtainTick(t) {
  for (const [p, fx] of curtainBeams) {
    if (!(p.curtain > simTime)) { curtainFx(p, false); continue; }
    fx.m.emissiveIntensity = Math.sin(t * 12) > 0 ? 2.2 : 0.2;
  }
}
// 派車控制系統當機（中央派車停止；自主接任務不受影響）
let hostDown = null;
const OCS_TARGET = { name: 'OCS', x: 0, z: 0 };
function raiseHostDown(_, opts) {
  if (hostDown) return null;
  const a = raiseAlarm('host', ALARM_INFO.host[0], OCS_TARGET, '派車控制系統（中控室）', opts);
  hostDown = a; return a;
}

// ---------- 標記 ----------
function alarmMarker(text) {
  const sp = makeLabel(text, { bg: 'rgba(185,28,28,.95)', fg: '#fff', scale: 1.3, w: 300 });
  sp.renderOrder = 10; sp.material.depthTest = false; scene.add(sp); return sp;
}
// 封鎖區段：沿軌道每 3 公尺一支紅白警示柱
const barrierGeo = new THREE.BoxGeometry(0.15, 0.9, 0.9), barrierMat = mat(0xdc2626, { emissive: 0x7f1d1d, emissiveIntensity: 0.6 });
function barrierGroup(seg) {
  const g = new THREE.Group();
  for (let d = 0.5; d < seg.len; d += 3) {
    const f = frameAt(seg, d), b = new THREE.Mesh(barrierGeo, barrierMat);
    b.position.set(f.x, H - 0.55, f.z); b.rotation.y = f.th; g.add(b);
  }
  scene.add(g); return g;
}

// ---------- 發生異常 ----------
const pickInfo = type => pickA(ALARM_INFO[type]);
function raiseAlarm(type, info, target, label, opts = {}) {
  if ((type === 'vehicle' || type === 'transfer') && target) target.homeFoup = '';   // 每次異常都要重新選有／無 FOUP 才能歸原點
  const a = { id: ++alarmSeq, type, info, target, label, start: simTime, rerouted: 0, canceled: 0, auto: !!opts.auto,
    autoClearAt: opts.auto ? simTime + 150 + rndA() * 150 : null };
  // 天車的異常先「自動復歸」：天車自己重試幾秒，成功就繼續跑；失敗才需要人到現場用操作介面復歸
  if ((type === 'vehicle' || type === 'transfer') && AUTO_REC_P[info.code] === 0) { a.noAutoRec = true; a.autoRecFailed = true; }   // 機台訊號、碰撞、貨物安全相關：不會自動復歸
  else if ((type === 'vehicle' || type === 'transfer') && AUTO_REC_P[info.code] !== undefined) {
    a.autoRec = { t: AUTO_REC_TIME, ok: opts.autoFail ? false : opts.autoOk ? true : rndA() < AUTO_REC_P[info.code] };
    if (opts.noRecover || (!opts.autoFail && !a.autoRec.ok && type === 'vehicle' && rndA() < 0.12)) a.noRecover = true;   // 少數情況：連人工都復歸不了，要推車
  }
  a.marker = alarmMarker(`⚠ ${info.code}`);
  alarms.push(a);
  log(`⚠ ${info.code} ${info.title}：${label}`);
  hmiOnAlarm(a);
  return a;
}
const MOVING = ['idle', 'toPick', 'toDrop'];
function raiseVehicleFault(v, opts) {
  v = v || pickA(vehicles.filter(x => !x.fault && MOVING.includes(x.state) && x.v > 0.3));
  if (!v) return null;
  const a = raiseAlarm('vehicle', pickInfo('vehicle'), v, `天車 ${v.id}（${v.seg.name}）`, opts);
  v.fault = a; return a;
}
// 取放貨異常：找一台正在夾取／放貨的車；沒有的話，下一台開始夾取／放貨的車就會發生
function raiseTransferFault(v, opts) {
  if (!v) {
    v = pickA(vehicles.filter(x => !x.fault && (x.state === 'grip' || x.state === 'release' || x.state === 'lower')));
    if (!v) { pendingTransferFault = opts || true; log('下一台開始夾取／放貨的天車會發生取放貨異常'); return null; }
  }
  if (pendingTransferFault && pendingTransferFault !== true) opts = pendingTransferFault;
  pendingTransferFault = false;
  const port = v.job ? (v.op === 'pick' ? v.job.from : v.job.to) : null;
  opts = opts || {};
  const info = opts.tension ? E206_INFO : opts.clawUnknown ? E205_INFO : opts.nearPort ? ALARM_INFO.transfer[2] : pickInfo('transfer');
  const a = raiseAlarm('transfer', info, v, `天車 ${v.id} @ ${port ? port.name : v.seg.name}`, opts);
  if (opts.clawUnknown) { a.clawUnknown = true; v.claw = 0.5; }
  if (opts.tension) { v.claw = 0.45; const f = v.job && v.job.foup; if (f && f.foreign) a.foreignObj = f; }   // 夾歪：夾爪卡在半開
  v.fault = a; return a;
}
function raiseMachineDown(m, opts) {
  m = m || pickA(machines.filter(x => !x.down && !x.seg.blocked));
  if (!m) return null;
  const a = raiseAlarm('machine', pickInfo('machine'), m, `機台 ${m.name}`, opts);
  m.down = a;
  if (opts.auto) { a.autoClearAt = null; notifyEngineer(a, 150 + rndA() * 150); }   // 自動異常：當作已經通知設備工程師
  // 機台異常 → HO_AVBL OFF：正在這台機台的 Load Port 上取放貨的天車也跟著中斷
  for (const v of vehicles) if (!v.fault && ['lower', 'grip', 'release', 'raise'].includes(v.state) && transferPort(v) && transferPort(v).owner === m) e204(v, transferPort(v), '機台異常');
  reassignJobs(a, q => q.owner === m);
  return a;
}
// 設備（機台／Load Port）問題：CIM 通知設備工程師到現場，由設備工程師修機台、賦歸 Load Port
function notifyEngineer(a, after) {
  if (a.notified != null) return;
  a.notified = simTime; a.fixAt = simTime + (after != null ? after : 600 + rndA() * 900);
  log(`📞 已通知設備工程師到 ${a.target.name} 處理（${a.info.title}）`);
  if (typeof renderAlarms === 'function') renderAlarms();
}
const e204Of = m => alarms.filter(x => x.info === E204_INFO && x.port && x.port.owner === m);
function raiseTrackBlock(seg, opts) {
  // 可以封鎖的區段：Bay（裡面的機台、儲格暫時不能用）、區塊連接線（跨區要繞路）
  if (!seg) {
    const cand = [...bays.map(b => b.seg), ...links.map(l => l.seg)].filter(s => !s.blocked && !s.maint && !vehicles.some(v => v.fault && v.seg === s));
    seg = rndA() < 0.5 ? pickA(cand.filter(s => s.kind === 'link')) : pickA(cand.filter(s => s.kind === 'bay'));
  }
  if (!seg) return null;
  const info = seg.kind === 'bay' ? ALARM_INFO.track[0] : ALARM_INFO.track[1];
  const a = raiseAlarm('track', info, seg, seg.name, opts);
  seg.blocked = a; a.barrier = barrierGroup(seg);
  computeRoutes();
  replanAll(a);
  reassignJobs(a, q => q.seg === seg);
  return a;
}

// 機台當機／區段封鎖時，處理受影響的搬運任務
//   ・要「送去」受影響 Port、還沒放下的：改送最近的可用 STB（改派）
//   ・要「從」受影響 Port 取貨、還沒開始夾的：取消，天車回到閒置
//   ・天車已經在那個 Port 上方取放中的：讓它做完
const TRANSFERRING = ['e84', 'e84end', 'guardOpen', 'shiftOut', 'lower', 'grip', 'release', 'raise', 'shiftIn', 'guardClose'];
function busyAt(v, port) { return v && TRANSFERRING.includes(v.state) && ((v.op === 'pick' && v.job.from === port) || (v.op === 'drop' && v.job.to === port)); }
function reassignJobs(a, hit) {
  for (const job of jobs.slice()) {
    const v = job.vehicle;
    if (hit(job.to) && !busyAt(v, job.to)) {
      const free = ports.filter(q => q.owner.type === 'stb' && !q.foup && !q.reserved && usable(q));
      const nd = nearest(job.from, free);
      if (nd) {
        job.to.reserved = false; nd.reserved = true; job.to = nd; a.rerouted++;
        if (v && v.state === 'toDrop') setTarget(v, nd);
        log(`↪ 改派 ${job.foup.id} → ${nd.name}`);
      }
    }
    if (hit(job.from) && !job.pickedAt && !busyAt(v, job.from)) {
      job.to.reserved = false; job.foup.job = null; jobs.splice(jobs.indexOf(job), 1); a.canceled++;
      if (v) { v.job = null; v.state = 'idle'; v.route = []; v.target = null; v.op = null; }
      log(`✕ 取消 ${job.foup.id} 的取貨（${job.from.name} 不能用）`);
    }
  }
}
// 路線改變後：所有有目的地的天車重新規劃路線；到不了取貨點的任務取消、到不了放貨點的改派
function replanAll(a) {
  for (const v of vehicles) {
    if (v.state === 'toMaint' && !v.fault && !setTarget(v, v.lifter)) {   // 到不了維修區：先回去排隊
      v.state = 'idle'; v.route = []; v.target = null; v.lifter.busy = null; v.lifter = null; maintQueue.unshift(v);
      continue;
    }
    if (!v.job || v.fault) continue;
    if (v.state === 'toPick') {
      const old = v.route.slice();
      if (!setTarget(v, v.job.from)) {
        const job = v.job; job.to.reserved = false; job.foup.job = null; jobs.splice(jobs.indexOf(job), 1);
        v.job = null; v.state = 'idle'; v.route = []; v.target = null; if (a) a.canceled++;
      } else if (a && old.some(s => s.blocked)) a.rerouted++;
    } else if (v.state === 'toDrop') {
      const old = v.route.slice();
      if (!setTarget(v, v.job.to)) {
        const free = ports.filter(q => q.owner.type === 'stb' && !q.foup && !q.reserved && usable(q));
        const nd = free.find(q => planRoute(v, q.seg, q.d).dist < Infinity);
        if (nd) { v.job.to.reserved = false; nd.reserved = true; v.job.to = nd; setTarget(v, nd); if (a) a.rerouted++; }
      } else if (a && old.some(s => s.blocked)) a.rerouted++;
    }
  }
}

// ---------- 復歸 ----------
function clearAlarm(a) {
  const i = alarms.indexOf(a); if (i < 0) return;
  alarms.splice(i, 1);
  if (a.type === 'vehicle' || a.type === 'transfer') hmiHistoryEnd(a);
  scene.remove(a.marker);
  if (a.type === 'vehicle' || a.type === 'transfer') {
    const v = a.target; v.fault = null; v.estop = false;
    if (v.servo) Object.keys(v.servo).forEach(k => v.servo[k] = true);   // 直接按「復歸」（沒走操作介面）：伺服一起恢復
  }
  if (a.type === 'machine') a.target.down = null;
  if (a.type === 'ap') a.target.down = null;
  if (a.type === 'host') hostDown = null;
  if (a.type === 'track') { a.target.blocked = null; scene.remove(a.barrier); computeRoutes(); replanAll(null); }
  log(`✔ 復歸 ${a.info.code} ${a.label}（處理 ${fmtDur(simTime - a.start)}）`);
  if (openAlarm === a) closeAlarmCard();
}
const fmtDur = t => { t = Math.max(0, Math.floor(t)); return `${Math.floor(t / 60)}分${String(t % 60).padStart(2, '0')}秒`; };

// ---------- 每幀：標記位置、自動發生／自動復歸 ----------
function alarmPos(a) {
  if (a.type === 'vehicle' || a.type === 'transfer') { const p = a.target.group.position; return [p.x, H + 2.2, p.z]; }
  if (a.type === 'machine') return [a.target.x, 5.2, a.target.z];
  if (a.type === 'ap') return [a.target.x, 11.3, a.target.z];
  if (a.type === 'host') return [0, 14, 0];
  const [x, z] = a.target.at(a.target.len / 2); return [x, H + 2.2, z];
}
function alarmTick(simDt) {
  for (const a of alarms) { const [x, y, z] = alarmPos(a); a.marker.position.set(x, y, z); }
  if (paused) return;
  for (const a of alarms.slice()) if (a.autoRec) {                    // 自動復歸倒數
    a.autoRec.t -= simDt;
    if (a.autoRec.t > 0) continue;
    if (a.autoRec.ok) { log(`🔄 ${a.target.id} 自動復歸成功（${a.info.code}），繼續運行`); a.autoRecovered = true; a.autoRec = null; clearAlarm(a); }
    else { a.autoRec = null; a.autoRecFailed = true; hmiHistory(a.target, 'Warning', '0762', '自動復歸失敗（教學）', a.id); log(`✋ ${a.target.id} 自動復歸失敗（${a.info.code}），需要人員到現場復歸`); }
  }
  for (const a of alarms.slice()) if (a.type === 'machine' && a.fixAt && simTime >= a.fixAt) { log(`🛠 設備工程師修好 ${a.target.name}，Load Port 已賦歸`); clearAlarm(a); }
  for (const a of alarms.slice()) if (a.autoClearAt && simTime >= a.autoClearAt) {
    if (a.type === 'vehicle' && rndA() < 0.4) sendToMaint(a);     // 約四成的天車故障要送維修區
    else clearAlarm(a);
  }
  if (autoAlarm) {
    autoAlarmT -= simDt;
    if (autoAlarmT <= 0) {
      autoAlarmT = 120 + rndA() * 120;
      const t = pickA(['vehicle', 'transfer', 'machine', 'track', 'ap']);
      ({ vehicle: raiseVehicleFault, transfer: raiseTransferFault, machine: raiseMachineDown, track: raiseTrackBlock, ap: raiseApDown })[t](null, { auto: true });
    }
  }
}

// ---------- 影響（即時計算，顯示在說明卡上）----------
function alarmImpact(a) {
  if (a.type === 'vehicle' || a.type === 'transfer') {
    const v = a.target;
    // 後面被擋住的車：沿自己前方 40 公尺內會碰到故障車、而且停住的
    const queued = vehicles.filter(u => u !== v && u.v < 0.05 && MOVING.includes(u.state) &&
      pathAhead(u, 40).some(e => e.seg === v.seg && e.off + v.d > 0)).length;
    return [`後面排隊停住的天車：${queued} 台`, v.job ? `延遲中的搬運任務：${v.job.foup.id}（${v.job.from.name} → ${v.job.to.name}）` : '這台天車沒有搬運任務'];
  }
  if (a.type === 'ap') return apImpact(a);
  if (a.type === 'host') {
    const waiting = jobs.filter(j => !j.vehicle).length;
    return DISPATCH_MODE === 'auto' ? ['現在是「天車自主接任務」：天車互相協調繼續接任務，派車不受影響', `等待派車的任務：${waiting} 筆`]
      : ['現在是「中央派車」：派車完全停止，空車停著等', `等待派車的任務：${waiting} 筆（越積越多）`, '可以到「系統功能」把派車方式切成「天車自主接任務」比較看看'];
  }
  if (a.type === 'machine') {
    const stuck = a.target.ports.filter(p => p.foup).length;
    return [`卡在機台上的 FOUP：${stuck} 個`, `改派到 STB 的任務：${a.rerouted} 筆`, `取消的取貨任務：${a.canceled} 筆`];
  }
  const seg = a.target, inside = vehicles.filter(v => v.seg === seg).length, affected = ports.filter(p => p.seg === seg).length;
  return [seg.kind === 'bay' ? `暫時不能用的 Port／儲格：${affected} 個` : '跨區的天車改走其他連接線', `區段內還沒開出來的天車：${inside} 台`,
    `改走其他路線的天車：${a.rerouted} 台`, `改派／取消的任務：${a.rerouted + a.canceled} 筆`];
}

// ---------- 介面：警報列表、說明卡 ----------
let openAlarm = null;
function renderAlarms() {
  const el = document.getElementById('alarmList'), ban = document.getElementById('alarmBanner');
  if (!el) return;
  el.innerHTML = alarms.length ? alarms.map(a => `<div class="alarm" data-id="${a.id}">
      <div><b>⚠ ${a.info.code}</b> ${a.info.title}${a.auto ? ' <span class="mut">（自動）</span>' : ''}</div>
      <div class="mut">${a.label} · 已經 ${fmtDur(simTime - a.start)}${a.autoClearAt ? ` · ${fmtDur(a.autoClearAt - simTime)} 後自動復歸` : ''}</div>
      <div class="btns"><button data-act="info">說明</button><button data-act="view">查看位置</button>${a.type === 'machine' ? (a.notified != null ? `<span class="mut">設備工程師處理中・約 ${fmtDur(Math.max(0, a.fixAt - simTime))}</span>` : '<button data-act="notify" class="ok">通知設備工程師</button>') : '<button data-act="clear" class="ok">復歸</button>'}</div>
    </div>`).join('') : '<div class="mut">目前沒有異常</div>';
  ban.style.display = alarms.length ? 'block' : 'none';
  ban.textContent = `⚠ 目前 ${alarms.length} 件異常 — 點這裡看說明`;
  if (openAlarm) renderAlarmCard(); else if (maintCardOpen) renderMaintCard();
}
function focusAlarm(a) {
  if (a.type === 'vehicle' || a.type === 'transfer') { setFollow(a.target); return; }
  setFollow(null);
  if (a.type === 'ap') setShowComm(true);                              // AP 斷線：順便打開無線網路顯示
  const [x, , z] = alarmPos(a);
  controls.target.set(x, 2, z); camera.position.set(x - 12, 24, z + 26);
}
function renderAlarmCard() {
  const a = openAlarm, c = document.getElementById('alarmCard');
  c.innerHTML = `<div class="hd"><span>⚠ ${a.info.code}　${a.info.title}</span><button id="acClose">✕</button></div>
    <div class="mut">${ALARM_TYPE_NAME[a.type]} · ${a.label} · 已經 ${fmtDur(simTime - a.start)}</div>
    ${a.autoRec ? `<div class="arec run">🔄 自動復歸中…（天車自己重試，約 ${Math.ceil(a.autoRec.t)} 秒）</div>` : a.autoRecFailed ? '<div class="arec fail">✋ 自動復歸失敗：需要人員到現場，用天車操作介面「警報清除」後手動復歸</div>' : ''}
    ${a.info.owner ? `<div class="arec own">負責：${a.info.owner}（CIM 不賦歸機台，只要通知設備工程師）${a.notified != null ? `<br>📞 已通知，設備工程師處理中・約 ${fmtDur(Math.max(0, a.fixAt - simTime))} 後修好` : ''}</div>` : ''}
    ${a.type === 'machine' && e204Of(a.target).length ? `<div class="arec fail">這台機台故障時有天車正在上下貨，卡在 Port 上方（E-204），要由 CIM 賦歸：${e204Of(a.target).map(x => `<button class="e204go" data-id="${x.id}">天車 ${x.target.id}</button>`).join(' ')}</div>` : ''}
    ${a.info === E204_INFO && a.port && a.port.owner.down ? `<div class="arec fail">機台 ${a.port.owner.name} 故障中：Load Port 等設備工程師處理，CIM 直接賦歸天車，不用等 HO 恢復</div>` : ''}
    <h4>發生了什麼</h4><p>${a.info.what}</p>
    <h4>會造成什麼影響</h4><p>${a.info.impact}</p>
    <ul class="impact">${alarmImpact(a).map(t => `<li>${t}</li>`).join('')}</ul>
    <h4>現場一般怎麼處理</h4><ol>${a.info.steps.map(t => `<li>${t}</li>`).join('')}</ol>
    <p class="mut">以上是一般 AMHS 的通用做法，實際處理以各廠 SOP 為準。</p>
    <div class="btns"><button id="acView">查看位置</button>${a.type === 'vehicle' || a.type === 'transfer' ? '<button id="acHmi" class="hmiBtn">開操作介面（現場排除）</button>' : ''}${a.type === 'vehicle' ? '<button id="acMaint">送維修區</button>' : ''}${a.type === 'machine' ? (a.notified != null ? '<button id="acClear">（模擬）設備工程師修好了</button>' : '<button id="acNotify" class="ok">📞 通知設備工程師</button>') : '<button id="acClear" class="ok">處理完成，復歸</button>'}</div>
    ${a.type === 'vehicle' ? '<p class="mut">「復歸」＝現場排除後直接重新上線；「送維修區」＝復歸後開到車輛維修區，用捲揚機放到地面檢修。</p>' : ''}`;
  c.style.display = 'block';
  document.getElementById('acClose').onclick = closeAlarmCard;
  document.getElementById('acView').onclick = () => focusAlarm(a);
  if (a.type === 'vehicle' || a.type === 'transfer') document.getElementById('acHmi').onclick = () => { const v = a.target; closeAlarmCard(); setFollow(v); openHmi(v, 'main'); };
  const ac = document.getElementById('acClear'); if (ac) ac.onclick = () => { if (a.type === 'machine') log(`🛠 設備工程師修好 ${a.target.name}，Load Port 已賦歸`); clearAlarm(a); };
  const an = document.getElementById('acNotify'); if (an) an.onclick = () => { notifyEngineer(a); renderAlarmCard(); };
  c.querySelectorAll('.e204go').forEach(b => b.onclick = () => { const x = alarms.find(y => y.id === +b.dataset.id); if (x) openAlarmCard(x); });
  if (a.type === 'vehicle') document.getElementById('acMaint').onclick = () => { const v = a.target; sendToMaint(a); openMaintCard(); focusMaint(LIFTERS.slice().sort((p, q) => planRoute(v, p.seg, p.d).dist - planRoute(v, q.seg, q.d).dist)[0]); };
}
function openAlarmCard(a) { maintCardOpen = false; openAlarm = a; renderAlarmCard(); }
function closeAlarmCard() { openAlarm = null; document.getElementById('alarmCard').style.display = 'none'; }
