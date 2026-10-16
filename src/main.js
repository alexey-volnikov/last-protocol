import {createSimulation,step,STEP_SECONDS,status,SIM_VERSION} from './sim/engine.js';
import {LAB_DAY_SECONDS} from './sim/world.js';
import {drawWorld} from './ui/renderer.js';
const $=id=>document.getElementById(id);
let seed=42,sim=createSimulation(seed),paused=false,speed=20,mapMode='memory',accumulator=0,last=performance.now(),lastUI=0;
const canvas=$('worldCanvas');
function setBar(id,val){$(id).style.width=`${Math.min(100,Math.max(0,val))}%`;}
function timeStr(seconds){const s=Math.floor(seconds);return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(x=>String(x).padStart(2,'0')).join(':');}
function updateUI(){
  const s=status(sim),r=sim.rover;
  $('modeBadge').textContent=s.mode;
  $('modeBadge').style.color=s.mode==='ACTIVE'?'#73c79b':'#eeb36b';
  $('batteryTxt').textContent=`${s.batteryPct.toFixed(1)}%`;setBar('batteryBar',s.batteryPct);
  $('memoryTxt').textContent=`${s.memoryPct}%`;setBar('memoryBar',s.memoryPct);
  $('memoryDetail').textContent=`48 KiB · ${s.knownTiles} записей · удалено ${s.lost}`;
  $('sunTxt').textContent=`${Math.round(s.sun*100)}%`;setBar('sunBar',s.sun*100);
  $('tempTxt').textContent=`${Math.round(s.temp)}°`;
  $('distanceTxt').textContent=s.distance.toFixed(1);
  $('scansTxt').textContent=s.scans;
  $('lostTxt').textContent=s.lost;
  $('actionTxt').textContent=s.action;
  $('pos').textContent=`X ${r.estimatedX.toFixed(1)} · Y ${r.estimatedY.toFixed(1)} (одометрия)`;
  $('timeDisplay').textContent=`T+${timeStr(s.time)}`;
  $('seedShow').textContent=seed;
  const day=((s.time%LAB_DAY_SECONDS)+LAB_DAY_SECONDS)%LAB_DAY_SECONDS / LAB_DAY_SECONDS;
  $('lightState').textContent=`${s.sun>.08?'☀ ДЕНЬ':'☾ НОЧЬ / ТЕНЬ'} · ${Math.round(day*100)}% тестового цикла`;
  $('mapState').textContent=mapMode==='truth'?'РЕАЛЬНАЯ КАРТА (ТОЛЬКО ДЛЯ РАЗРАБОТЧИКА)':'КАРТА РОВЕРА / ЧАСТИЧНОЕ ЗНАНИЕ';
  $('eventLog').replaceChildren(...sim.events.map(e=>{
    const li=document.createElement('li'),time=document.createElement('time');
    time.textContent='T+'+timeStr(e.time);li.append(time,document.createTextNode(e.message));return li;
  }));
}
function frame(now){
  const dt=Math.min(.16,(now-last)/1000);last=now;
  if(!paused){
    accumulator+=dt*speed;
    let count=0;
    while(accumulator>=STEP_SECONDS && count<140){step(sim,STEP_SECONDS);accumulator-=STEP_SECONDS;count++;}
    if(count===140)accumulator=Math.min(accumulator,STEP_SECONDS*140);
  }
  drawWorld(canvas,sim,mapMode);
  if(now-lastUI>130){updateUI();lastUI=now;}
  requestAnimationFrame(frame);
}
function restart(s){seed=s;sim=createSimulation(s);accumulator=0;updateUI();drawWorld(canvas,sim,mapMode);}
$('pauseBtn').addEventListener('click',()=>{paused=!paused;$('pauseBtn').textContent=paused?'▶ Продолжить':'Ⅱ Пауза';});
$('stepBtn').addEventListener('click',()=>{paused=true;$('pauseBtn').textContent='▶ Продолжить';step(sim,STEP_SECONDS);updateUI();});
$('resetBtn').addEventListener('click',()=>restart(seed));
$('speed').addEventListener('change',e=>{speed=Number(e.target.value);accumulator=0;});
$('mapMode').addEventListener('change',e=>{mapMode=e.target.value;updateUI();});
$('newSeedBtn').addEventListener('click',()=>{const n=Math.floor(Number($('seedInput').value));restart(Number.isFinite(n)&&n>0?n:42);});
$('exportBtn').addEventListener('click',()=>{
  const report={schema_version:1,kind:'summary-only-not-replay',simulator:SIM_VERSION,policy:'baseline-heuristic-v0 (NOT AI learning)',seed,sim_time_seconds:sim.time,status:status(sim),events:[...sim.events].reverse(),worldSize:{w:sim.world.w,h:sim.world.h},
    note:'Лабораторная физика и условные единицы. Это сводка текущего запуска, не полный replay.'};
  const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`last-protocol-seed-${seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
updateUI();requestAnimationFrame(frame);
