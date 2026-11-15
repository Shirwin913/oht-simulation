// 詳細操作：相對位移命令，位置 mm、速度 mm/s、加減速度 mm/s²。
// 旋轉軸僅監視，夾爪沿用既有開閉互鎖（不虛構馬達脈衝或電流）。
const DETAIL_AXES = ['walk', 'hoist', 'shift', 'rot', 'claw'];
const DETAIL_LIMITS = { walk: [300, 10000, 1600], hoist: [450, (H - 1.2) * 1000, 1000], shift: [300, STB_OFFSET * 2000, 800] };
function detailInit(v) {
  hmiInit(v);
  if (!v.detailParams) v.detailParams = Object.fromEntries(['walk','hoist','shift'].map(k => [k, {speed:100, distance:100, accel:200, decel:200}]));
  if (!v.detailStatus) v.detailStatus = {};
}
function detailSample(v, dt) {
  const now = {hoist:v.hoist, shift:v.shift, rot:v.rot || 0, claw:v.claw};
  v.detailVelocity = {};
  if (v.detailSample && dt > 0) for (const ax of ['hoist','shift','rot','claw']) {
    v.detailVelocity[ax] = Math.abs(now[ax] - v.detailSample[ax]) / dt * (ax === 'rot' ? 1 : ax === 'claw' ? 100 : 1000);
  }
  v.detailSample = now;
}
function detailStop(v, reason) {
  if (v.detailMove) { v.detailStatus[v.detailMove.ax] = reason; v.detailMove = null; }
}
function detailPosition(v, ax) {
  if (ax === 'walk') return ((v.odo || 0) - (v.encZero || 0)) * 1000;
  if (ax === 'hoist') return -v.hoist * 1000;
  if (ax === 'shift') return v.shift * 1000;
  return ax === 'rot' ? (v.rot || 0) : v.claw * 100;
}
function detailRead(v, ax) {
  const fields = ['speed','distance','accel','decel'], values = {}, limits = DETAIL_LIMITS[ax];
  for (const k of fields) {
    const el = document.getElementById(`dp-${ax}-${k}`), value = el ? Number(el.value) : v.detailParams[ax][k];
    const max = k === 'speed' ? limits[0] : k === 'distance' ? limits[1] : limits[2];
    if ((el && !el.value.trim()) || !Number.isFinite(value) || value <= 0 || value > max) {
      hmiMsg(`${AXIS_NAME[ax]}：${{speed:'速度',distance:'移動量',accel:'加速度',decel:'減速度'}[k]}請輸入大於 0、且不超過 ${max} 的數字`); return null;
    }
    values[k] = value;
  }
  v.detailParams[ax] = values; return values;
}
function detailAct(v, act) {
  detailInit(v);
  const [, op, ax, sign] = act.split(':');
  if (op === 'stop') { detailStop(v, '已停止'); return hmiMsg(`${AXIS_NAME[ax]}停止`); }
  if (op !== 'move' || !DETAIL_LIMITS[ax]) return;
  if (!needManual(v, ax)) return;
  if (v.homing || v.handSw || v.detailMove || Object.keys(v.man).some(k => v.man[k])) return hmiMsg('其他手動動作尚未完成，請先停止');
  const dir = Number(sign), why = holdBlock(v, ax, dir);
  if (why) return hmiMsg(why);
  const p = detailRead(v, ax); if (!p) return;
  const distance = p.distance / 1000;
  const end = ax === 'hoist' ? v.hoist + dir * distance : v.shift + dir * distance;
  if ((ax === 'hoist' && (end < 0 || end > H - 1.2)) || (ax === 'shift' && Math.abs(end) > STB_OFFSET)) return hmiMsg('移動量超出軸行程，請減少移動量');
  v.man = {}; v.manTouched = true;
  v.detailMove = {ax, dir, remaining:distance, speed:0, top:p.speed / 1000, accel:p.accel / 1000, decel:p.decel / 1000};
  v.detailStatus[ax] = '動作中';
  log(`🛠 ${v.id} 詳細操作：${AXIS_NAME[ax]}相對移動 ${dir * p.distance} mm`);
  hmiMsg(`${AXIS_NAME[ax]}執行 ${p.distance} mm 相對移動；可按該軸「停止」中止`);
}
function detailTick(v, dt) {
  const m = v.detailMove; if (!m) return;
  const a = vAlarm(v), why = !v.manual ? '已離開手動模式' : v.estop ? '緊急停止' : !v.servo[m.ax] ? '伺服 Off' : a && !a.codeCleared ? '異常停止' : holdBlock(v, m.ax, m.dir);
  if (why) { detailStop(v, why); if (v === hmiV) hmiMsg(why); return; }
  const targetSpeed = Math.min(m.top, Math.sqrt(2 * m.decel * m.remaining));
  const prev = m.speed;
  m.speed += Math.sign(targetSpeed - m.speed) * Math.min(Math.abs(targetSpeed - m.speed), (targetSpeed > m.speed ? m.accel : m.decel) * dt);
  let step = Math.min(m.remaining, (prev + m.speed) * 0.5 * dt);
  if (m.ax === 'walk') {
    const {gap, lead} = leaderInfo(v, pathAhead(v, LOOK));
    // 詳細操作遇到前車即停止，不自行越過路權或推動其他車。
    if (gap - MIN_GAP - 0.05 < Math.max(step, m.speed * m.speed / (2 * m.decel))) {
      detailStop(v, '前方有車，已停止'); if (v === hmiV) hmiMsg('前方有車，詳細走行已停止'); return;
    }
    advance(v, step); v.odo += step;
    if (a && a.codeCleared) { a.jogDist = (a.jogDist || 0) + step; if (a.jogDist >= 0.3) a.jogged = true; }
  } else { v[m.ax] += m.dir * step; if (m.ax === 'hoist') v.hv = 0; }
  m.remaining = Math.max(0, m.remaining - step);
  if (m.remaining < 1e-7) { detailStop(v, '命令完成'); if (v === hmiV) hmiMsg(`${AXIS_NAME[m.ax]}命令完成`); }
}
function renderDetail(v, d) {
  detailInit(v); const a = vAlarm(v), active = v.detailMove;
  const dirs = {walk:['後退','前進'], hoist:['上升','下降'], shift:['右移','左移']};
  const axes = DETAIL_AXES.map(ax => {
    const p = v.detailParams[ax], limits = DETAIL_LIMITS[ax], busy = active && active.ax === ax;
    const param = (key, label) => `<label>${label}<input id="dp-${ax}-${key}" data-dparam="${ax}:${key}" aria-label="${AXIS_NAME[ax]}${label}" type="number" min="0.1" max="${key === 'speed' ? limits[0] : key === 'distance' ? limits[1] : limits[2]}" step="any" value="${p[key]}" ${active ? 'disabled' : ''}></label>`;
    const code = AXIS_OF_CODE[a && a.info.code] === ax ? d.code : '0';
    const speed = busy ? active.speed * 1000 : ax === 'walk' ? v.v * 1000 : (v.detailVelocity && v.detailVelocity[ax]) || 0;
    return `<section class="detail-axis"><div class="da-title"><h5>${AXIS_NAME[ax]}</h5><button class="svl ${v.servo[ax] ? 'on' : 'off'}" data-a="servo:${ax}:${v.servo[ax] ? 'off' : 'on'}">伺服 ${v.servo[ax] ? 'On' : 'Off'}</button><span class="done ${busy ? '' : 'ok'}">${busy ? '動作中' : v.detailStatus[ax] || (ax === 'rot' ? '固定軸' : '待命')}</span></div>
    <div class="da-fields">${p ? param('speed','速度 (mm/s)') + param('distance','移動量 (mm)') + param('accel','加速度 (mm/s²)') + param('decel','減速度 (mm/s²)') : `<div class="da-note">${ax === 'rot' ? '本機型旋轉軸固定，僅顯示角度。' : '夾爪使用開／閉極限控制；位置以行程百分比表示。'}</div>`}
    <label>目前位置 (${ax === 'rot' ? 'rad' : ax === 'claw' ? '%' : 'mm'})<output>${f1(detailPosition(v,ax))}</output></label><label>目前速度 (${ax === 'rot' ? 'rad/s' : ax === 'claw' ? '%/s' : 'mm/s'})<output>${f1(speed)}</output></label><label>異常碼<output class="da-code ${code !== '0' ? 'bad' : ''}">${code}</output></label></div>
    <div class="da-actions">${p ? [-1,1].map(dir => `<button data-a="detail:move:${ax}:${dir}" ${active || (ax === 'walk' && dir < 0) ? 'disabled' : ''}>${dirs[ax][dir > 0 ? 1 : 0]}指定量</button>`).join('') : ax === 'claw' ? '<button data-a="claw:open">開極限</button><button data-a="claw:close">閉極限</button>' : '<button disabled>旋轉固定</button>'}
    ${['hoist','shift'].includes(ax) ? `<button data-a="home:${ax}">回原點</button>` : ''}<button data-a="${busy ? 'detail:stop:' + ax : 'stop'}">停止</button></div></section>`;
  }).join('');
  const io = [['FOUP 在席', !!v.carry],['夾爪開極限',v.claw < .01],['夾爪閉極限',v.claw > .99],['捲揚原點',v.hoist < .005],['側移原點',Math.abs(v.shift)<.002],['防墜伸出',v.guard < .01],['防墜收合',v.guard > .99],['控制系統連線',commOk(v)],['緊急停止',!!v.estop]];
  return `<div class="detail-note">相對移動：輸入參數後按方向鍵，執行指定距離。走行只支援單向前進；參數僅套用本車手動命令。位置與速度來自模擬。</div><div class="hdetail"><div>${axes}</div><aside><div class="hbox"><h5>台車目前位置</h5>${fld('Barcode',d.barcode)}${fld('Encoder',d.enc)}${fld('X 座標 (mm)',d.x)}${fld('Y 座標 (mm)',d.y)}${fld('Section ID',d.sect)}${fld('Address ID',d.addr)}</div><div class="hbox"><h5>山形上下手</h5><table class="axt">${handRows(v)}</table><h5>防墜</h5><button data-a="guard:out">伸出</button> <button data-a="guard:in">收合</button></div><div class="hbox"><h5>I/O 狀態</h5><div class="detail-io">${io.map(([n,on])=>`<div class="${on?'on':''}"><span>${n}</span><b>${on?'ON':'OFF'}</b></div>`).join('')}</div>${e84Panel(v)}</div><button class="estop ${v.estop?'on':''}" data-a="estop"><span>${v.estop?'解除急停':'EMERGENCY STOP'}</span></button>${recoveryBox(v,a)}</aside></div>`;
}
// 編輯時保留草稿，避免定時重畫吃掉輸入或失去焦點。
document.getElementById('hmi').addEventListener('input', e => {
  if (!e.target.dataset.dparam || !hmiV) return;
  const [ax,key] = e.target.dataset.dparam.split(':'); detailInit(hmiV);
  hmiV.detailParams[ax][key] = e.target.value;
});
