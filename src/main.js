import {createSimulation,step,STEP_SECONDS,status,SIM_VERSION} from './sim/engine.js';
import {LAB_DAY_SECONDS} from './sim/world.js';
import {drawWorld} from './ui/renderer.js';
import {createNeuralController} from './agent/controller.js';
const $=id=>document.getElementById(id);
const STORAGE_KEY='last-protocol-water-dqn-v1';
let brain=createNeuralController({seed:71,epsilon:.03}),worker=null;
let seed=42,sim=createSimulation(seed,{controller:brain}),paused=false,speed=20,mapMode='memory',accumulator=0,last=performance.now(),lastUI=0,lastSave=0;
const canvas=$('worldCanvas');
function persistBrain(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(brain.save()));}catch{$('trainingStatus').textContent='Автосохранение недоступно. Можно скачать мозг кнопкой ниже.';}}
function setPaused(value){paused=value;$('pauseBtn').textContent=paused?'▶ Продолжить':'Ⅱ Пауза';}
function setBar(id,val){$(id).style.width=`${Math.min(100,Math.max(0,val))}%`;}
function timeStr(seconds){const s=Math.floor(seconds);return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(x=>String(x).padStart(2,'0')).join(':');}
function updateUI(){
  const s=status(sim),r=sim.rover;
  $('modeBadge').textContent=s.mode;
  $('modeBadge').style.color=s.mode==='ACTIVE'?'#73c79b':'#eeb36b';
  $('batteryTxt').textContent=`${s.batteryPct.toFixed(1)}%`;setBar('batteryBar',s.batteryPct);
  $('memoryTxt').textContent=`${s.memoryPct}%`;setBar('memoryBar',s.memoryPct);
  $('memoryDetail').textContent=`192 KiB · ${s.knownTiles} записей · удалено ${s.lost}`;
  $('sunTxt').textContent=`${Math.round(s.sun*100)}%`;setBar('sunBar',s.sun*100);
  $('tempTxt').textContent=`${Math.round(s.temp)}°`;
  $('distanceTxt').textContent=s.distance.toFixed(1);
  $('scansTxt').textContent=s.scans;
  $('lostTxt').textContent=s.lost;
  $('actionTxt').textContent=s.action;
  $('pos').textContent=`X ${r.estimatedX.toFixed(1)} · Y ${r.estimatedY.toFixed(1)} (одометрия)`;
  $('timeDisplay').textContent=`T+${timeStr(s.time)}`;
  $('seedShow').textContent=seed;
  const neural=Boolean(sim.controller),info=s.controller;
  $('runState').textContent=sim.water.found?'ВОДА ПОДТВЕРЖДЕНА':paused?'ПАУЗА':'СИМУЛЯЦИЯ АКТИВНА';
  $('policyCaption').textContent=neural?'ЛОКАЛЬНАЯ НЕЙРОСЕТЬ / Q-LEARNING':'ЭВРИСТИКА / БЕЗ ОБУЧЕНИЯ';
  $('brainDetail').textContent=neural?`Мозг E${info.updates} · опыт ${info.replaySize}/${info.replayCapacity} · оценка ${info.lastReward.toFixed(3)}`:'Исходные правила возврата. Пробы льда этот алгоритм не выбирает.';
  const signals=r.lastObservation?.waterReadings?.length||0;
  $('waterStatus').textContent=sim.water.found?'ВОДЯНОЙ ЛЁД НАЙДЕН':signals?'ЕСТЬ ПРИЗНАКИ ЛЬДА':'НАЙТИ ВОДУ.';
  $('waterHint').textContent=sim.water.found?`Положительная контактная проба в T+${timeStr(sim.water.sample.time)}. Добыча ещё не реализована.`:
    signals?`В памяти ${signals} измеренных пятен. Нужно добраться и проверить пробой. Выполнено проб: ${s.samples}.`:'Сканер ищет поверхностный лёд в пределах 4 м. Скрытые залежи мозгу неизвестны.';
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
    while(accumulator>=STEP_SECONDS && count<140){
      const foundBefore=sim.water.found;step(sim,STEP_SECONDS);accumulator-=STEP_SECONDS;count++;
      if(sim.water.found&&!foundBefore){setPaused(true);persistBrain();break;}
    }
    if(count===140)accumulator=Math.min(accumulator,STEP_SECONDS*140);
  }
  drawWorld(canvas,sim,mapMode);
  if(now-lastUI>130){updateUI();lastUI=now;}
  if(now-lastSave>10000){persistBrain();lastSave=now;}
  requestAnimationFrame(frame);
}
function restart(s){persistBrain();seed=s;brain.newTrial();sim=createSimulation(s,{controller:$('controllerMode').value==='neural'?brain:null});accumulator=0;updateUI();drawWorld(canvas,sim,mapMode);}
$('pauseBtn').addEventListener('click',()=>{setPaused(!paused);updateUI();});
$('stepBtn').addEventListener('click',()=>{setPaused(true);step(sim,STEP_SECONDS);updateUI();});
$('resetBtn').addEventListener('click',()=>restart(seed));
$('speed').addEventListener('change',e=>{speed=Number(e.target.value);accumulator=0;});
$('mapMode').addEventListener('change',e=>{mapMode=e.target.value;updateUI();});
$('newSeedBtn').addEventListener('click',()=>{const n=Math.floor(Number($('seedInput').value));restart(Number.isFinite(n)&&n>0?n:42);});
$('controllerMode').addEventListener('change',()=>{sim.controller=$('controllerMode').value==='neural'?brain:null;sim.rover.modelVersion=sim.controller?.id||'baseline-heuristic-v0';updateUI();});
$('learningToggle').addEventListener('change',()=>brain.setLearning($('learningToggle').checked));
function download(data,name){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('saveBrainBtn').addEventListener('click',()=>download(brain.save(),`last-protocol-brain-E${brain.info().updates}.json`));
$('brainFile').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>1000000)throw new Error('Файл мозга слишком большой');
    const model=JSON.parse(await file.text());
    const loaded=createNeuralController({model,seed:71,learning:$('learningToggle').checked,epsilon:.03});
    brain=loaded;if($('controllerMode').value==='neural')sim.controller=brain;
    persistBrain();$('trainingStatus').textContent=`Загружен мозг E${brain.info().updates}. Положение ровера сохранено.`;
  }catch(error){$('trainingStatus').textContent=`Загрузка не выполнена: ${error.message}`;}
  event.target.value='';updateUI();
});
$('trainBtn').addEventListener('click',()=>{
  setPaused(true);$('trainBtn').disabled=true;$('cancelTrainingBtn').hidden=false;
  $('trainingStatus').textContent='LAB: обучение на отдельных картах. Положение текущего ровера сохраняется.';
  worker=new Worker('./src/lab/training-worker.js',{type:'module'});
  worker.onmessage=event=>{
    const p=event.data;
    if(p.type==='progress')$('trainingStatus').textContent=`LAB ${p.episode}/${p.total} · положительных проб: ${p.successes} · мозг E${p.updates}`;
    else if(p.type==='done'){
      brain=createNeuralController({model:p.model,seed:71,learning:$('learningToggle').checked,epsilon:.03});
      if($('controllerMode').value==='neural')sim.controller=brain;
      persistBrain();$('trainingStatus').textContent=`Обучение завершено. Проверка на новых картах: ${p.validation.found}/${p.validation.total}. Позиция ровера сохранена.`;
      finishTraining();
    }else if(p.type==='error'){$('trainingStatus').textContent=p.message;finishTraining();}
  };
  worker.onerror=()=>{$('trainingStatus').textContent='Не удалось выполнить обучение. Текущий мозг сохранён.';finishTraining();};
  worker.postMessage({model:brain.save()});
});
function finishTraining(){worker?.terminate();worker=null;$('trainBtn').disabled=false;$('cancelTrainingBtn').hidden=true;updateUI();}
$('cancelTrainingBtn').addEventListener('click',()=>{finishTraining();$('trainingStatus').textContent='Обучение остановлено. Текущий мозг и ровер сохранены.';});
$('exportBtn').addEventListener('click',()=>{
  const report={schema_version:2,kind:'summary-and-model-not-replay',simulator:SIM_VERSION,policy:sim.controller?.id||'baseline-heuristic-v0',seed,sim_time_seconds:sim.time,status:status(sim),water:sim.water,model:brain.save(),events:[...sim.events].reverse(),worldSize:{w:sim.world.w,h:sim.world.h},
    note:'Лабораторная физика и условные единицы. Это сводка текущего запуска, не полный replay.'};
  download(report,`last-protocol-seed-${seed}.json`);
});
try{
  const response=await fetch('./models/water-dqn-v1.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Модель ещё не подготовлена');
  const bundled=await response.json();
  let saved=null;try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY));if(saved)createNeuralController({model:saved});}catch{saved=null;}
  brain=createNeuralController({model:saved&&saved.updates>=bundled.updates?saved:bundled,seed:71,epsilon:.03});
  sim.controller=brain;$('trainingStatus').textContent='Мозг загружен. Опыт сохраняется в этом браузере; LAB-сброс сохраняет веса.';
}catch{$('trainingStatus').textContent='Старт с необученной сетью. Можно запустить локальное обучение кнопкой выше.';}
try{
  const response=await fetch('./experiments/water-benchmark.json',{cache:'no-store'});
  if(response.ok){const report=await response.json();$('benchmarkStatus').textContent=`Проверка комплектной модели: ${report.test.trained.found}/${report.test.trained.total} карт; до обучения: ${report.test.untrained.found}/${report.test.untrained.total}. Это не гарантия успеха на любой карте.`;}
}catch{}
updateUI();requestAnimationFrame(frame);
