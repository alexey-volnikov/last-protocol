import {createSimulation,step,STEP_SECONDS,status,SIM_VERSION} from './sim/engine.js';
import {LAB_DAY_SECONDS,SURFACE_PRESET,DEPOSIT_PRESET} from './sim/world.js';
import {drawWorld} from './ui/renderer.js';
import {createNeuralController} from './agent/controller.js';
import {createDepositController,transferSurfaceModel} from './agent/deposit-controller.js';
const $=id=>document.getElementById(id);
const profiles={
  [SURFACE_PRESET]:{key:'last-protocol-water-dqn-v1',file:'water-dqn-v1',report:'water-benchmark',create:createNeuralController},
  [DEPOSIT_PRESET]:{key:'last-protocol-deposit-dqn-v1',file:'deposit-dqn-v1',report:'deposit-benchmark',create:createDepositController}
};
let preset=DEPOSIT_PRESET,brain=createDepositController({seed:71,epsilon:.06}),worker=null;
const brains=new Map();
let seed=42,sim=createSimulation(seed,{controller:brain,preset}),paused=false,speed=20,mapMode='memory',accumulator=0,last=performance.now(),lastUI=0,lastSave=0;
const canvas=$('worldCanvas');
function persistBrain(){try{localStorage.setItem(profiles[preset].key,JSON.stringify(brain.save()));}catch{$('trainingStatus').textContent='Автосохранение недоступно. Можно скачать мозг кнопкой ниже.';}}
function setPaused(value){paused=value;$('pauseBtn').textContent=paused?'▶ Продолжить':'Ⅱ Пауза';}
function setBar(id,val){$(id).style.width=`${Math.min(100,Math.max(0,val))}%`;}
function timeStr(seconds){const s=Math.floor(seconds);return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(x=>String(x).padStart(2,'0')).join(':');}
function updateUI(){
  const s=status(sim),r=sim.rover;
  $('labTitle').textContent=sim.survey?'По следам — к большому пласту.':'Поверхностный лёд: малый опыт.';
  $('labEyebrow').textContent=sim.survey?'ОПЫТ LP-045 / 046 · ДЛИТЕЛЬНАЯ РАЗВЕДКА':'ОПЫТ LP-003 · ЕДИНИЧНАЯ ПРОБА';
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
  $('runState').textContent=paused?'ПАУЗА':sim.survey?'ДЛИТЕЛЬНАЯ РАЗВЕДКА':sim.water.found?'ВОДА ПОДТВЕРЖДЕНА':'СИМУЛЯЦИЯ АКТИВНА';
  $('policyCaption').textContent=neural?'ЛОКАЛЬНАЯ НЕЙРОСЕТЬ / Q-LEARNING':'ЭВРИСТИКА / БЕЗ ОБУЧЕНИЯ';
  $('brainDetail').textContent=neural?`Мозг E${info.updates} · буфер опыта ${info.replaySize}/${info.replayCapacity} · оценка за шаг ${info.lastReward.toFixed(3)}`:'Исходные правила возврата. Пробы льда этот алгоритм не выбирает.';
  const signals=r.lastObservation?.waterReadings?.length||0;
  $('waterStatus').textContent=sim.water.found?'ВОДЯНОЙ ЛЁД НАЙДЕН':signals?'ЕСТЬ ПРИЗНАКИ ЛЬДА':'НАЙТИ ВОДУ.';
  $('waterHint').textContent=sim.water.found?`Положительная контактная проба в T+${timeStr(sim.water.sample.time)}. Добыча ещё не реализована.`:
    signals?`В памяти ${signals} измеренных пятен. Нужно добраться и проверить пробой. Выполнено проб: ${s.samples}.`:'Сканер ищет поверхностный лёд в пределах 4 м. Скрытые залежи мозгу неизвестны.';
  $('surveyPanel').hidden=!sim.survey;
  if(sim.survey){
    const survey=sim.survey,local=r.lastObservation?.surfaceConcentration;
    $('waterStatus').textContent=survey.confirmed?'КАНДИДАТ ИСТОЧНИКА':survey.best>0?'ПО СЛЕДАМ К ПЛАСТУ':'РАЗВЕДАТЬ БОЛЬШОЙ ПЛАСТ';
    $('waterHint').textContent=survey.confirmed?'Три разнесённые богатые пробы. Разведка продолжается; объём и добыча ещё не подтверждены.':
      'Льдинки — промежуточные следы. Нужны три разнесённые пробы ≥65% с размахом ≥4 м. Первая находка не завершает экспедицию.';
    $('concentrationTxt').textContent=local==null?'нет свежего измерения':`${(local*100).toFixed(1)}%`;
    $('bestProbeTxt').textContent=survey.last?`${(survey.best*100).toFixed(1)}%`:'—';
    $('surveyProgress').textContent=`Богатые разнесённые пробы: ${survey.richCount}/3 · разных точек: ${survey.uniqueProbes} · всего проб: ${survey.totalProbes}`;
    $('expeditionAge').textContent=`Световой цикл ${Math.floor(sim.time/LAB_DAY_SECONDS)+1} · работа ${timeStr(s.activeSeconds)} · спячка ${timeStr(s.sleepSeconds)}`;
    $('surveyLog').replaceChildren(...survey.probes.slice(-5).reverse().map(p=>{
      const li=document.createElement('li');li.textContent=`T+${timeStr(p.time)} · ${(p.concentration*100).toFixed(1)}% · X ${p.x.toFixed(1)} Y ${p.y.toFixed(1)}${p.fresh?'':' · повтор'}`;return li;
    }));
    const records=survey.probes;
    $('probeChartLine').setAttribute('points',records.map((p,i)=>`${8+i/Math.max(1,records.length-1)*244},${62-p.concentration*54}`).join(' '));
  }
  $('decisionDetail').textContent=neural?`Оценки вариантов: ${(info.qValues||[]).map((q,i)=>`${['ехать','влево','вправо','ждать','проба'][i]} ${q.toFixed(2)}`).join(' · ')}. Это прогнозы сети, не вероятность успеха.`:'Сейчас работают заданные вручную правила.';
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
      if(!sim.survey&&sim.water.found&&!foundBefore){setPaused(true);persistBrain();break;}
    }
    if(count===140)accumulator=Math.min(accumulator,STEP_SECONDS*140);
  }
  drawWorld(canvas,sim,mapMode);
  if(now-lastUI>130){updateUI();lastUI=now;}
  if(now-lastSave>10000){persistBrain();lastSave=now;}
  requestAnimationFrame(frame);
}
function restart(s){persistBrain();seed=s;brain.newTrial();sim=createSimulation(s,{controller:$('controllerMode').value==='neural'?brain:null,preset});accumulator=0;updateUI();drawWorld(canvas,sim,mapMode);}
$('pauseBtn').addEventListener('click',()=>{setPaused(!paused);updateUI();});
$('stepBtn').addEventListener('click',()=>{setPaused(true);step(sim,STEP_SECONDS);updateUI();});
$('resetBtn').addEventListener('click',()=>restart(seed));
$('speed').addEventListener('change',e=>{speed=Number(e.target.value);accumulator=0;});
$('mapMode').addEventListener('change',e=>{mapMode=e.target.value;updateUI();});
$('newSeedBtn').addEventListener('click',()=>{const n=Math.floor(Number($('seedInput').value));restart(Number.isFinite(n)&&n>0?n:42);});
$('controllerMode').addEventListener('change',()=>{sim.controller=$('controllerMode').value==='neural'?brain:null;sim.rover.modelVersion=sim.controller?.id||'baseline-heuristic-v0';updateUI();});
$('learningToggle').addEventListener('change',()=>brain.setLearning($('learningToggle').checked));
$('presetSelect').addEventListener('change',async event=>{
  setPaused(true);persistBrain();brains.set(preset,brain);finishTraining();
  const selected=event.target.value;event.target.disabled=true;
  const loaded=brains.get(selected)||await loadBrain(selected);
  preset=selected;brain=loaded;brain.setLearning($('learningToggle').checked);
  brains.set(preset,brain);restart(seed);await showBenchmark();event.target.disabled=false;setPaused(false);
});
function download(data,name){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('saveBrainBtn').addEventListener('click',()=>download(brain.save(),`last-protocol-brain-E${brain.info().updates}.json`));
$('restoreBrainBtn').addEventListener('click',async()=>{
  setPaused(true);
  try{
    const response=await fetch(`./models/${profiles[preset].file}.json`,{cache:'no-store'});
    if(!response.ok)throw new Error('Комплектная модель недоступна');
    const loaded=profiles[preset].create({model:await response.json(),seed:71,learning:$('learningToggle').checked,epsilon:.06});
    brain=loaded;if($('controllerMode').value==='neural')sim.controller=brain;
    persistBrain();$('trainingStatus').textContent='Комплектный мозг загружен. Положение и журнал проб сохранены; можно продолжить.';
  }catch(error){$('trainingStatus').textContent=error.message;}
  updateUI();
});
$('brainFile').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>1000000)throw new Error('Файл мозга слишком большой');
    const model=JSON.parse(await file.text());
    const loaded=profiles[preset].create({model,seed:71,learning:$('learningToggle').checked,epsilon:.06});
    brain=loaded;if($('controllerMode').value==='neural')sim.controller=brain;
    persistBrain();$('trainingStatus').textContent=`Загружен мозг E${brain.info().updates}. Положение ровера сохранено.`;
  }catch(error){$('trainingStatus').textContent=`Загрузка не выполнена: ${error.message}`;}
  event.target.value='';updateUI();
});
$('trainBtn').addEventListener('click',()=>{
  setPaused(true);$('trainBtn').disabled=true;$('cancelTrainingBtn').hidden=false;
  $('brainFile').disabled=true;
  $('restoreBrainBtn').disabled=true;
  $('trainingStatus').textContent='LAB: обучение на отдельных картах. Положение текущего ровера сохраняется.';
  worker=new Worker('./src/lab/training-worker.js',{type:'module'});
  const currentWorker=worker;
  worker.onmessage=event=>{
    if(worker!==currentWorker)return;
    const p=event.data;
    if(p.type==='progress')$('trainingStatus').textContent=`LAB ${p.episode}/${p.total} · ${preset===DEPOSIT_PRESET?'кандидатов':'находок'}: ${p.successes} · мозг E${p.updates}`;
    else if(p.type==='done'){
      brain=profiles[preset].create({model:p.model,seed:71,learning:$('learningToggle').checked,epsilon:.06});
      if($('controllerMode').value==='neural')sim.controller=brain;
      persistBrain();$('trainingStatus').textContent=`Обучение завершено. Проверка: ${p.validation.found}/${p.validation.total}${p.validation.note?`, ${p.validation.note}`:''}. Позиция ровера сохранена.`;
      finishTraining();
    }else if(p.type==='error'){$('trainingStatus').textContent=p.message;finishTraining();}
  };
  worker.onerror=()=>{$('trainingStatus').textContent='Не удалось выполнить обучение. Текущий мозг сохранён.';finishTraining();};
  worker.postMessage({model:brain.save(),preset});
});
function finishTraining(){worker?.terminate();worker=null;$('trainBtn').disabled=false;$('brainFile').disabled=false;$('restoreBrainBtn').disabled=false;$('cancelTrainingBtn').hidden=true;updateUI();}
$('cancelTrainingBtn').addEventListener('click',()=>{finishTraining();$('trainingStatus').textContent='Обучение остановлено. Текущий мозг и ровер сохранены.';});
$('exportBtn').addEventListener('click',()=>{
  const report={schema_version:3,kind:'summary-and-model-not-replay',simulator:SIM_VERSION,preset,policy:sim.controller?.id||'baseline-heuristic-v0',seed,sim_time_seconds:sim.time,status:status(sim),water:sim.water,
    survey:sim.survey?{summary:status(sim).survey,probes:sim.survey.probes,confirmedAt:sim.survey.confirmedAt}:null,model:brain.save(),events:[...sim.events].reverse(),worldSize:{w:sim.world.w,h:sim.world.h},
    note:'Лабораторная физика и условные единицы. Это сводка текущего запуска, не полный replay.'};
  download(report,`last-protocol-seed-${seed}.json`);
});
async function loadBrain(profile){
  const config=profiles[profile],options={seed:71,learning:$('learningToggle').checked,epsilon:profile===DEPOSIT_PRESET?.06:.03};
  try{
    const saved=JSON.parse(localStorage.getItem(config.key));
    if(saved){const loaded=config.create({...options,model:saved});$('trainingStatus').textContent='Загружен ваш сохранённый мозг этого опыта. Мир запущен заново как LAB-опыт.';return loaded;}
  }catch{}
  try{
    const response=await fetch(`./models/${config.file}.json`,{cache:'no-store'});
    if(response.ok){const model=await response.json(),loaded=config.create({...options,model});
      $('trainingStatus').textContent=profile===DEPOSIT_PRESET&&model.updates===model.meta?.pretrainingUpdates?
        'Перенесён навык малого опыта. Новый навык поиска по концентрации пока не подтверждён.':'Комплектный локальный мозг загружен. Поиск пласта не гарантирован.';return loaded;}
  }catch{}
  if(profile===DEPOSIT_PRESET){
    try{
      const response=await fetch('./models/water-dqn-v1.json');
      if(response.ok){$('trainingStatus').textContent='Перенесён навык малого опыта. Использование концентрации ещё предстоит выучить.';return config.create({...options,model:transferSurfaceModel(await response.json())});}
    }catch{}
  }
  $('trainingStatus').textContent='Старт с необученной локальной сетью.';return config.create(options);
}
async function showBenchmark(){
  $('benchmarkStatus').textContent='';
  try{
    const response=await fetch(`./experiments/${profiles[preset].report}.json`,{cache:'no-store'});
    if(response.ok){const report=await response.json();
      $('benchmarkStatus').textContent=preset===DEPOSIT_PRESET?
        `Кандидатов на новых картах: ${report.test.trained.candidates}/${report.test.trained.total}. Две тренировки не улучшили проверку; комплектный мозг оставлен исходным переносом. Навык долгой разведки пока не освоен.`:
        `Малый опыт: ${report.test.trained.found}/${report.test.trained.total} карт; до обучения: ${report.test.untrained.found}/${report.test.untrained.total}. Это не поиск большого пласта.`;
    }
  }catch{}
}
brain=await loadBrain(preset);brains.set(preset,brain);sim.controller=brain;sim.rover.modelVersion=brain.id;
await showBenchmark();
updateUI();requestAnimationFrame(frame);
