import {createWorld,sunlightAt,surfaceTempC,tileAt} from './world.js';
import {createMemory,memoryPercent,remember} from './memory.js';
import {sampleSensors} from './sensors.js';
import {chooseBaselineAction} from './policy.js';
export const SIM_VERSION='0.0.1';
export const STEP_SECONDS=2;

function makeRover(world){
  const {x,y}=world.home;
  return {x,y,estimatedX:x,estimatedY:y,heading:-.3,
    capacityWh:36,batteryWh:27,bodyTempC:-10,mode:'ACTIVE',steps:0,scans:0,travelM:0,
    memory:createMemory(),lastLidar:[],brain:{wanderHeading:-.3},lastObservation:null,lastAction:null,
    mission:{rememberedHome:{x,y}},
    generation:1,modelVersion:'baseline-heuristic-v0',storageLoss:0};
}
export function createSimulation(seed=42){
  const world=createWorld(seed);
  const rover=makeRover(world);
  const sim={world,rover,time:145,events:[],tick:0,stats:{collisions:0,evictions:0,distance:0},lastEvent:'Капсула раскрыта. Ровер активирован.'};
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
  const {world,rover}=sim;
  sim.time+=dt; sim.tick++;
  const sun=sunlightAt(world,rover.x,rover.y,sim.time);
  const surf=surfaceTempC(world,rover.x,rover.y,sim.time);
  // Упрощённая теплоёмкость корпуса: источник ≠ моментальная температура батареи.
  rover.bodyTempC += (surf-rover.bodyTempC) * Math.min(.1,dt/3600);
  if(rover.mode==='HIBERNATING'){
    rover.batteryWh=Math.min(rover.capacityWh,rover.batteryWh+12*sun*dt/3600);
    if(rover.batteryWh>=rover.capacityWh*.7 && rover.bodyTempC>-70){
      rover.mode='ACTIVE';addEvent(sim,'Питание восстановлено до 70%. Ровер пробудился.');
    }
    rover.lastAction={type:'sleep',reason:'Полное отключение; пассивная зарядка'};
    return sim;
  }
  // При сильном холоде, который модель пока не позволяет преодолеть, включается защита.
  if(rover.bodyTempC< -70){rover.mode='HIBERNATING';addEvent(sim,'Критический холод: система ушла в спячку.');return sim;}
  const scan=sim.tick%3===0;
  const obs=sampleSensors(world,rover,sim.time,{scan});
  rover.lastObservation=obs;
  if(scan)rover.scans++;
  if(obs.evicted>0){
    sim.stats.evictions+=obs.evicted;
    if(sim.tick%24===0)addEvent(sim,'Накопитель переполнен: старые клетки карты удалены.');
  }
  const action=chooseBaselineAction(obs,rover.brain,rover.mission);
  rover.lastAction=action;
  let watts=3.6+2.2+(scan?5.5:0); // базовая электроника + процессор + лидар
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
      rover.brain.wanderHeading=rover.heading+1.05;
      if(sim.tick%20===0)addEvent(sim,'Обнаружено препятствие. Попытка объезда.');
    }
  }
  // Нагреватель при низкой температуре тоже расходует электричество.
  if(rover.bodyTempC< -30){watts+=7;rover.bodyTempC+=dt*.009;}
  const solarWatts=12*sun;
  rover.batteryWh=Math.max(0,Math.min(rover.capacityWh,rover.batteryWh+(solarWatts-watts)*dt/3600));
  rover.steps++;
  if(rover.batteryWh<=0){
    rover.mode='HIBERNATING';addEvent(sim,'Аккумулятор разряжен: полное отключение до 70%.');
  }
  // Маяк базы восстанавливает абсолютную точку привязки только поблизости.
  if(Math.hypot(rover.x-world.home.x,rover.y-world.home.y)<2.5){
    rover.estimatedX=rover.x;rover.estimatedY=rover.y;
  }
  return sim;
}
export function status(sim){
  const r=sim.rover;
  return {sun:sunlightAt(sim.world,r.x,r.y,sim.time),temp:r.bodyTempC,batteryPct:r.batteryWh/r.capacityWh*100,
    memoryPct:memoryPercent(r.memory),knownTiles:r.memory.cells.size,lost:r.memory.lost,time:sim.time,mode:r.mode,
    distance:r.travelM,collisions:sim.stats.collisions,scans:r.scans,action:r.lastAction?.reason||'Ожидание'};
}
