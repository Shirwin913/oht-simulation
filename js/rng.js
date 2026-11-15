// rng.js — 可以「指定種子」的亂數：比較實驗時每種組合用同一組亂數，任務和異常盡量一樣，比較才公平
//   分成兩條：demand（FOUP 加工時間、下一站、優先級）、alarm（異常什麼時候發生、發生在哪、自動復歸成不成功）
//   一般開網頁時種子是隨機的；比較實驗（網址有 ?bench=1）會指定種子
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const URLP = new URLSearchParams(location.search);
const BENCH = URLP.get('bench') ? {
  id: URLP.get('id'), seed: +URLP.get('seed') || 1, comm: URLP.get('comm') || 'ap', disp: URLP.get('disp') || 'central',
  hours: +URLP.get('hours') || 1, scen: URLP.get('scen') || 'normal', alarms: URLP.get('alarms') === '1',
} : null;
const SEED = BENCH ? BENCH.seed : Math.floor(Math.random() * 1e9);
const RNG = { demand: mulberry32(SEED), alarm: mulberry32(SEED * 7 + 13) };
const rndD = () => RNG.demand(), rndA = () => RNG.alarm();
const pickA = a => a[Math.floor(rndA() * a.length)];
