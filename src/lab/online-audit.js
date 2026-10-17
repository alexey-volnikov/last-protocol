// Внешняя LAB-диагностика; эти метрики не передаются в политику ровера.
import {createSimulation,step} from '../sim/engine.js';
import {createQController} from '../agent/controller.js';
import {CURIOSITY_POLICY,encodeCuriosityObservation,curiosityReward} from '../agent/curiosity-controller.js';
export const ONLINE_PROTOCOL={id:'online-audit-v1',resets:6,steps:2400,lifeSteps:43200,window:300,
  diagnostic:{maps:[4233,42],seeds:[71]},validation:{maps:[10001,10002,10003],seeds:[71,909]},test:{maps:[11001,11002,11003,11004],seeds:[73,917]}};
export const ONLINE_VARIANTS={legacy:{preservePending:false},pending:{preservePending:true},
  slow:{preservePending:true,rate:.0003},slower:{preservePending:true,rate:.0001},history:{preservePending:true,history:true},
  historySlow:{preservePending:true,history:true,rate:.0003},historySlower:{preservePending:true,history:true,rate:.0001}};
export function auditController(model,variant,seed=71,learning=true){
  if(!(variant in ONLINE_VARIANTS))throw new Error('Неизвестный вариант опыта');
  return createQController({model,seed,learning,epsilon:.06},{id:CURIOSITY_POLICY,schema:3,inputs:49,
    encode:encodeCuriosityObservation,reward:curiosityReward,terminal:f=>f.newDeposit||f.shutdown,training:ONLINE_VARIANTS[variant]});
}
function measuredWindow(sim,start,actions){
  const active=Object.values(actions).reduce((a,b)=>a+b,0),distance=sim.rover.travelM-start.distance;
  const observed=sim.rover.exploration.uniqueObserved-start.observed,visited=sim.rover.exploration.uniqueVisited-start.visited;
  const spin=active>=100&&distance<1&&actions.turn/active>=.7;
  const stalled=active>=100&&distance<1&&observed<5&&visited===0;
  return {time:sim.time,active,distance,observed,visited,actions:{...actions},spin,stalled,bad:spin||stalled};
}
function run(sim,controller,steps){
  const actions={move:0,turn:0,wait:0,sample:0},windows=[],rewards={};
  let start={distance:0,observed:0,visited:1},windowActions={...actions},streak=0,maxTurnStreak=0;
  for(let i=0;i<steps;i++){
    const before=sim.rover.steps;step(sim);
    if(sim.rover.steps>before){
      const action=sim.rover.lastAction.type;actions[action]++;windowActions[action]++;
      streak=action==='turn'?streak+1:0;maxTurnStreak=Math.max(maxTurnStreak,streak);
      const r=controller.info();
      const sums=rewards[action]||={count:0,total:0,curiosity:0,shutdown:0,collision:0};
      sums.count++;sums.total+=r.lastReward;
      for(const k of ['curiosity','shutdown','collision'])sums[k]+=r.components[k]||0;
    }
    if((i+1)%ONLINE_PROTOCOL.window===0||i+1===steps){
      windows.push(measuredWindow(sim,start,windowActions));
      start={distance:sim.rover.travelM,observed:sim.rover.exploration.uniqueObserved,visited:sim.rover.exploration.uniqueVisited};windowActions={move:0,turn:0,wait:0,sample:0};
    }
  }
  const info=controller.info();
  return {distance:sim.rover.travelM,visited:sim.rover.exploration.uniqueVisited,observed:sim.rover.exploration.uniqueObserved,
    shutdowns:sim.stats.shutdowns,collisions:sim.stats.collisions,energyWh:sim.stats.energySpentWh,activeSeconds:sim.stats.activeSeconds,
    sleepSeconds:sim.stats.sleepSeconds,samples:sim.stats.samples,candidate:sim.survey.confirmed,updates:info.updates,
    replaySize:info.replaySize,replayTerminals:info.replayTerminals,historySize:info.historySize,deferredFailure:info.deferredFailure,
    maxTurnStreak,actions,rewards,early:windows[0],spinWindows:windows.filter(w=>w.spin).length,
    stalledWindows:windows.filter(w=>w.stalled).length,badWindows:windows.filter(w=>w.bad).length,windows};
}
export function runOnlineCase(model,variant,map,seed,{resets=ONLINE_PROTOCOL.resets,steps=ONLINE_PROTOCOL.steps,lifeSteps=ONLINE_PROTOCOL.lifeSteps,learning=true}={}){
  const controller=auditController(model,variant,seed,learning),restarts=[];
  let deferredBeforeReset=0,deferredDropped=0;
  for(let i=0;i<resets;i++){
    if(controller.info().deferredFailure)deferredBeforeReset++;
    controller.newTrial();
    if(deferredBeforeReset>0&&i>0&&!controller.info().deferredFailure&&restarts.at(-1).deferredFailure)deferredDropped++;
    const sim=createSimulation(map,{preset:'deposit-lab-v1',curiosity:true,controller});
    restarts.push(run(sim,controller,steps));
  }
  const living=auditController(model,variant,seed,learning),sim=createSimulation(map,{preset:'deposit-lab-v1',curiosity:true,controller:living});
  return {map,seed,variant,learning,deferredBeforeReset,deferredDropped,restarts,life:run(sim,living,lifeSteps)};
}
export function summarizeOnline(cases){
  const resets=cases.flatMap(c=>c.restarts),late=cases.flatMap(c=>c.restarts.slice(-3)),lives=cases.map(c=>c.life);
  const mean=(xs,k)=>xs.reduce((n,x)=>n+x[k],0)/xs.length,sum=(xs,k)=>xs.reduce((n,x)=>n+x[k],0);
  return {cases:cases.length,badWindows:sum(resets,'badWindows')+sum(lives,'badWindows'),spinWindows:sum(resets,'spinWindows')+sum(lives,'spinWindows'),
    stalledWindows:sum(resets,'stalledWindows')+sum(lives,'stalledWindows'),lateVisited:mean(late,'visited'),lateObserved:mean(late,'observed'),
    resetShutdowns:sum(resets,'shutdowns'),resetCollisions:sum(resets,'collisions'),resetMeanDistance:mean(resets,'distance'),
    lifeVisited:mean(lives,'visited'),lifeObserved:mean(lives,'observed'),lifeShutdowns:sum(lives,'shutdowns'),lifeCollisions:sum(lives,'collisions'),
    lifeMeanDistance:mean(lives,'distance'),deferredDropped:sum(cases,'deferredDropped')};
}
export function compareOnline(a,b){return a.badWindows-b.badWindows||b.lateVisited-a.lateVisited||a.resetShutdowns-b.resetShutdowns||a.resetCollisions-b.resetCollisions;}
