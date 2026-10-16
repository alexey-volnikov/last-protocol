import {createWorld,sunlightAt,surfaceTempC,tileAt,SURFACE_PRESET,DEPOSIT_PRESET} from './world.js';
import {createSurvey,registerProbe,surveySummary} from './survey.js';
import {createMemory,memoryPercent,remember} from './memory.js';
import {sampleSensors} from './sensors.js';
import {chooseBaselineAction} from './policy.js';
export const SIM_VERSION='0.2.0';
export const STEP_SECONDS=2;

function makeRover(world){
  const {x,y}=world.home;
  return {x,y,estimatedX:x,estimatedY:y,heading:-.3,
    capacityWh:36,batteryWh:27,bodyTempC:-10,mode:'ACTIVE',offReason:null,steps:0,scans:0,travelM:0,
    memory:createMemory(),lastLidar:[],brain:{wanderHeading:-.3},lastObservation:null,lastAction:null,
    mission:{rememberedHome:{x,y}},
    generation:1,modelVersion:'baseline-heuristic-v0',storageLoss:0};
}
export function createSimulation(seed=42,{controller=null,preset=SURFACE_PRESET}={}){
  const world=createWorld(seed,{preset});
  const rover=makeRover(world);
  const sim={world,rover,controller,preset,survey:preset===DEPOSIT_PRESET?createSurvey():null,time:145,events:[],tick:0,water:{found:false,sample:null},
    stats:{collisions:0,evictions:0,distance:0,samples:0,shutdowns:0,activeSeconds:0,sleepSeconds:0},lastEvent:'Капсула раскрыта. Ровер активирован.'};
  if(controller)rover.modelVersion=controller.id;
  addEvent(sim,sim.lastEvent);
  remember(rover.memory,rover.x,rover.y,{rock:false,crater:0,rim:0,seenAt:sim.time});
  return sim;
}
function addEvent(sim,message){
  if(sim.events[0]?.message===message && sim.time-sim.events[0].time<5)return;
  sim.events.unshift({time:sim.time,message});
  if(sim.events.length>18)sim.events.length=18;
  sim.lastEvent=message;
}
export function step(sim,dt=STEP_SECONDS){
  if(dt!==STEP_SECONDS)throw new Error('Физический шаг фиксирован: 2 секунды');
  const {world,rover}=sim;
  sim.time+=dt; sim.tick++;
  const sun=sunlightAt(world,rover.x,rover.y,sim.time);
  const surf=surfaceTempC(world,rover.x,rover.y,sim.time);
  // Упрощённая теплоёмкость корпуса: источник ≠ моментальная температура батареи.
  rover.bodyTempC += (surf-rover.bodyTempC) * Math.min(.1,dt/3600);
  if(rover.mode==='HIBERNATING'){
    sim.stats.sleepSeconds+=dt;
    // В тестовой модели внешнее Солнце постепенно прогревает неподвижный корпус.
    rover.bodyTempC+=sun*70*dt/700;
    rover.batteryWh=Math.min(rover.capacityWh,rover.batteryWh+12*sun*dt/3600);
    const mustReach70=rover.offReason==='EMPTY';
    const needed=mustReach70?.7:.1;
    if(rover.batteryWh>=rover.capacityWh*needed && rover.bodyTempC>-55){
      rover.mode='ACTIVE';rover.offReason=null;
      addEvent(sim,mustReach70?'Питание восстановлено до 70%. Ровер пробудился.':'Корпус согрелся. Ровер возобновил работу.');
    }
    rover.lastAction={type:'sleep',reason:'Полное отключение; пассивная зарядка'};
    return sim;
  }
  // При сильном холоде, который модель пока не позволяет преодолеть, включается защита.
  if(rover.bodyTempC< -70||rover.batteryWh<=0){
    rover.mode='HIBERNATING';rover.offReason=rover.batteryWh<=0?'EMPTY':'COLD';sim.stats.shutdowns++;
    addEvent(sim,rover.offReason==='COLD'?'Критический холод: система ушла в спячку.':'Питание отключено до восстановления 70%.');return sim;
  }
  const batteryBefore=rover.batteryWh,uniqueBefore=rover.memory.uniqueSeen;
  sim.stats.activeSeconds+=dt;
  const controllerLearning=Boolean(sim.controller?.info?.().learning);
  const scan=sim.tick%3===0&&(!sim.survey||rover.batteryWh>=(3.6+2.2+(controllerLearning?4:0)+(rover.spectrometerEnabled===false?5.5:11.5))*dt/3600);
  const obs=sampleSensors(world,rover,sim.time,{scan});
  rover.lastObservation=obs;
  if(scan)rover.scans++;
  if(obs.evicted>0){
    sim.stats.evictions+=obs.evicted;
    if(sim.tick%24===0)addEvent(sim,'Накопитель переполнен: старые клетки карты удалены.');
  }
  const requested=sim.controller?sim.controller.act(structuredClone(obs)):chooseBaselineAction(obs,rover.brain,rover.mission);
  const action=['move','turn','wait','sample'].includes(requested?.type)?{...requested}:{type:'wait',reason:'Недопустимый запрос привода'};
  if(action.type==='turn')action.amount=Number.isFinite(action.amount)?Math.max(-.28,Math.min(.28,action.amount)):0;
  rover.lastAction=action;
  rover.contact=false;rover.sampleResult=null;
  const learning=controllerLearning;
  let watts=3.6+2.2+(learning?4:0)+(scan?(rover.spectrometerEnabled===false?5.5:11.5):0); // LAB-стоимости
  let newWater=false;
  let surveyFeedback={newSurvey:false,newRich:false,newDeposit:false,sampleConcentration:null};
  if(action.type==='turn'){
    rover.heading+=action.amount;watts+=7;
  } else if(action.type==='move'){
    const cell=tileAt(world,rover.x,rover.y);
    const speedMps=.045 / (1+((cell?.rim)||0)*1.5);
    const nx=rover.x+Math.cos(rover.heading)*speedMps*dt;
    const ny=rover.y+Math.sin(rover.heading)*speedMps*dt;
    const next=tileAt(world,nx,ny);
    watts+=26+((cell?.rim)||0)*11;
    if(next && !next.rock){
      rover.x=nx;rover.y=ny;
      // Инерциальная оценка позиции имеет систематический дрейф и ограниченную точность.
      const drift=1+.012*Math.sin(sim.tick*.23+world.seed);
      rover.estimatedX+=Math.cos(rover.heading)*speedMps*dt*drift;
      rover.estimatedY+=Math.sin(rover.heading)*speedMps*dt*drift;
      rover.travelM+=speedMps*dt;sim.stats.distance+=speedMps*dt;
    }else{
      sim.stats.collisions++;
      rover.contact=true;
      if(sim.tick%20===0)addEvent(sim,'Обнаружено препятствие. Попытка объезда.');
    }
  } else if(action.type==='sample'){
    watts+=18;sim.stats.samples++;
    const powered=rover.batteryWh>=watts*dt/3600;
    const sampledCell=tileAt(world,rover.x,rover.y);
    rover.sampleResult=powered&&Boolean(sim.survey?(sampledCell?.iceFraction||0)>=.025:sampledCell?.ice);
    if(sim.survey&&powered&&sampledCell){
      surveyFeedback=registerProbe(sim.survey,{x:rover.estimatedX,y:rover.estimatedY,concentration:sampledCell.iceFraction,time:sim.time},[Math.floor(rover.x),Math.floor(rover.y)]);
      rover.surveySummary=surveySummary(sim.survey);
      if(surveyFeedback.newDeposit)addEvent(sim,'КАНДИДАТ КРУПНОГО ИСТОЧНИКА: три разнесённые богатые пробы. Разведка продолжается.');
      else if(surveyFeedback.newSurvey)addEvent(sim,`Новая проба: ${(sampledCell.iceFraction*100).toFixed(1)}% льда. Разведка продолжается.`);
    }
    if(rover.sampleResult&&!sim.water.found){
      newWater=true;sim.water.found=true;
      sim.water.sample={x:rover.estimatedX,y:rover.estimatedY,time:sim.time,kind:'surface-water-ice',method:'LAB contact sample'};
      if(!sim.survey)addEvent(sim,'ВОДЯНОЙ ЛЁД ПОДТВЕРЖДЁН: положительная контактная проба.');
    }
  }
  // Нагреватель при низкой температуре тоже расходует электричество.
  if(rover.bodyTempC< -30){watts+=7;rover.bodyTempC+=dt*.009;}
  const solarWatts=12*sun;
  const energySpentWh=watts*dt/3600;
  rover.batteryWh=Math.max(0,Math.min(rover.capacityWh,rover.batteryWh+(solarWatts-watts)*dt/3600));
  rover.steps++;
  if(rover.batteryWh<=0){
    sim.stats.shutdowns++;
    rover.mode='HIBERNATING';rover.offReason='EMPTY';addEvent(sim,'Аккумулятор разряжен: полное отключение до 70%.');
  }
  // Маяк базы восстанавливает абсолютную точку привязки только поблизости.
  if(Math.hypot(rover.x-world.home.x,rover.y-world.home.y)<2.5){
    rover.estimatedX=rover.x;rover.estimatedY=rover.y;
  }
  rover.energyDeltaWh=rover.batteryWh-batteryBefore;
  sim.lastFeedback={newWater,collision:rover.contact,shutdown:rover.mode==='HIBERNATING',sampleAttempt:action.type==='sample',
    newCells:rover.memory.uniqueSeen-uniqueBefore,energySpentWh,...surveyFeedback};
  // Контроллер видит только копии показаний/результатов. Физика никогда не пишет в мозг.
  if(sim.controller?.observe)sim.controller.observe({before:structuredClone(obs),
    after:sampleSensors(world,rover,sim.time,{scan:false}),feedback:{...sim.lastFeedback}});
  return sim;
}
export function status(sim){
  const r=sim.rover;
  return {sun:sunlightAt(sim.world,r.x,r.y,sim.time),temp:r.bodyTempC,batteryPct:r.batteryWh/r.capacityWh*100,
    memoryPct:memoryPercent(r.memory),knownTiles:r.memory.cells.size,lost:r.memory.lost,time:sim.time,mode:r.mode,
    distance:r.travelM,collisions:sim.stats.collisions,scans:r.scans,waterFound:sim.water.found,samples:sim.stats.samples,
    shutdowns:sim.stats.shutdowns,survey:sim.survey?surveySummary(sim.survey):null,activeSeconds:sim.stats.activeSeconds,sleepSeconds:sim.stats.sleepSeconds,
    controller:sim.controller?.info?.()||{id:'baseline-heuristic-v0',learning:false,updates:0},
    action:r.lastAction?.reason||'Ожидание'};
}
