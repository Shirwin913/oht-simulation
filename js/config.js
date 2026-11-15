// config.js — 基本參數與全域狀態（軌道幾何在 network.js）

// ================== 基本參數 ==================
const H = 6.2;           // 軌道高度
const VLEN = 2.4;        // 車長（含前後保險桿約 2.24）
const MIN_GAP = 0.6;     // 前後車最小間距
const A = 1.6;           // 加速度
// --- 捲揚（Hoist）---
let   HS = 2.2;          // 捲揚最高速度
const HA = 2.5;          // 捲揚加減速度
const HS_CREEP = 0.2;    // 接近目標時的低速段速度
const CREEP_ZONE = 0.15; // 低速段距離
const DRUM_R = 0.11;     // 捲揚鼓半徑（只影響動畫轉速）
// --- 側移（Shift / Traverse）---
const SHIFT_SPEED = 0.8; // 側移速度
// --- 防墜（Fall prevention）---
const GUARD_TIME = 0.5;  // 防墜擋片開／關時間
const CLAW_TIME = 0.9;   // 夾爪開／合時間
// --- 高度 ---
const PORT_TOP = 1.02;   // Load Port 表面高度
const STB_TOP = 4.3;     // STB（軌道旁暫存架）表面高度
const STB_OFFSET = 1.1;  // STB 離軌道中心的側向距離
const STB_DWELL = 2400;   // FOUP 放在 STB 暫存的最長時間（秒，實際隨機 30%~100%）
const FOUP_OFF = 0.74;   // FOUP 原點到夾爪距離
const UNIT_DY = 0.07;     // 模型的側移＋捲揚單元往上移一點，接到原本外殼的滑軌下面
const GRIP_REST = OHT_MODEL.meta.gripRest + UNIT_DY; // 夾爪收起位置（車體座標，照模型夾爪底面，約 -0.86）
// 捲揚要放多深才能把 FOUP 放到某個 Port 上
const hoistDepth = port => GRIP_REST - (port.top + FOUP_OFF - H);

let xray = false;   // 透視模式
let VMAX = 3.5, speed = 2, procTime = 1500, paused = false, showLabels = true;
const waitByPri = [[0, 0], [0, 0], [0, 0]], cycleByPri = [[0, 0], [0, 0], [0, 0]];   // 各優先級的 [總秒數, 筆數]
let simTime = 0, completed = 0, waitSum = 0, waitN = 0, cycleSum = 0;
let jobSeq = 0, vehSeq = 0, foupSeq = 0;
const jobs = [], vehicles = [], ports = [], machines = [], logs = [];
let followed = null;

// 自動復歸：天車異常後先自己重試 AUTO_REC_TIME 秒，成功機率依異常碼（急停不會自動復歸）
const AUTO_REC_TIME = 6;
const AUTO_REC_P = { 'E-101': 0.5, 'E-102': 0.7, 'E-103': 0.6, 'E-201': 0.5, 'E-202': 0.6, 'E-203': 0.3 };

// 車輛維修區的捲揚機（Lifter）
const LIFT_HALF = 1.45;     // 跟著天車一起降下去的那段軌道長度的一半
const LIFT_LOW = 2.15;      // 降到底時天車（軌道）的高度：車底離地約 0.5 公尺，人員站著就能修
const LIFT_TIME = 20;       // 升／降一趟的秒數（實際的捲揚機很慢，安全第一）
const REPAIR_TIME = 120;    // 故障維修平均秒數（模擬用，已縮短）
const PM_TIME = 75;         // 定期保養平均秒數
const liftEase = l => l * l * (3 - 2 * l);                         // 起步、到底都慢慢的
const liftY = l => H - liftEase(l) * (H - LIFT_LOW);
