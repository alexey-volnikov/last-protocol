import {createSimulation,step} from '../sim/engine.js';
import {createMotionController,MOTION_EXPERIMENT} from '../agent/motion-controller.js';
import {summarizeOnline,compareOnline} from './online-audit.js';
export const MOTION_PROTOCOL={id:'motion-context-v1',experiment:MOTION_EXPERIMENT,trainingSeeds:[1601,2909],episodes:80,steps:2400,
  trainMaps:Array.from({length:16},(_,i)=>12001+i),validation:{maps:[13001,13002,13003],seeds:[101,907]},test:{maps:[14001,14002,14003,14004],seeds:[103,919]},
  resets:6,lifeSteps:43200,window:300};
function run(controller,map,steps){
  const sim=createSimulation(map,{controller,preset:'deposit-lab-v1',curiosity:true}),windows=[];
  let distance=0,observed=0,visited=1,active=0,turns=0;
  for(let i=0;i<steps;i++){
    const before=sim.rover.steps;step(sim);
    if(sim.rover.steps>before){active++;turns+=Number(sim.rover.lastAction.type==='turn');}
    if((i+1)%MOTION_PROTOCOL.window===0||i+1===steps){
      const path=sim.rover.travelM-distance,newObserved=sim.rover.exploration.uniqueObserved-observed,newVisited=sim.rover.exploration.uniqueVisited-visited;
      const spin=active>=100&&path<1&&turns/active>=.7,stalled=active>=100&&path<1&&newObserved<5&&newVisited===0;
      windows.push({time:sim.time,active,distance:path,observed:newObserved,visited:newVisited,spin,stalled,bad:spin||stalled});
      distance=sim.rover.travelM;observed=sim.rover.exploration.uniqueObserved;visited=sim.rover.exploration.uniqueVisited;active=0;turns=0;
    }
  }
  const info=controller.info();
  return {distance:sim.rover.travelM,visited:sim.rover.exploration.uniqueVisited,observed:sim.rover.exploration.uniqueObserved,
    shutdowns:sim.stats.shutdowns,collisions:sim.stats.collisions,energyWh:sim.stats.energySpentWh,activeSeconds:sim.stats.activeSeconds,
    sleepSeconds:sim.stats.sleepSeconds,samples:sim.stats.samples,candidate:sim.survey.confirmed,updates:info.updates,replaySize:info.replaySize,
    replayTerminals:info.replayTerminals,historySize:info.historySize,deferredFailure:info.deferredFailure,motion:info.motion,
    ...(info.awaitingDecision!=null?{awaitingDecision:info.awaitingDecision,discardedTruncations:info.discardedTruncations}: {}),
    early:windows[0],spinWindows:windows.filter(w=>w.spin).length,stalledWindows:windows.filter(w=>w.stalled).length,badWindows:windows.filter(w=>w.bad).length,windows};
}
export function runMotionCase(model,map,seed,{masked=false,learning=true,resets=MOTION_PROTOCOL.resets,steps=MOTION_PROTOCOL.steps,lifeSteps=MOTION_PROTOCOL.lifeSteps,createController=createMotionController}={}){
  const controller=createController({model,seed,masked,learning,epsilon:.06}),restarts=[];let deferredDropped=0;
  for(let i=0;i<resets;i++){
    const pending=controller.info().deferredFailure;controller.newTrial();
    if(pending&&!controller.info().deferredFailure)deferredDropped++;
    restarts.push(run(controller,map,steps));
  }
  const living=createController({model,seed,masked,learning,epsilon:.06});
  return {map,seed,masked,learning,deferredDropped,restarts,life:run(living,map,lifeSteps)};
}
export function evaluateMotion(model,set=MOTION_PROTOCOL.validation,{masked=false,learning=true,onProgress=()=>{}}={}){
  const cases=[];
  for(const map of set.maps)for(const seed of set.seeds){onProgress({map,seed});cases.push(runMotionCase(model,map,seed,{masked,learning}));}
  return {summary:summarizeOnline(cases),candidates:cases.reduce((n,c)=>n+[...c.restarts,c.life].filter(r=>r.candidate).length,0),cases};
}
export async function trainMotion({model,masked=false,trainingSeed=1601,protocol=MOTION_PROTOCOL,onProgress=()=>{},createController=createMotionController}){
  const controller=createController({model,masked,seed:trainingSeed,learning:true}),history=[];
  for(let e=0;e<protocol.episodes;e++){
    controller.setExploration(Math.max(.06,.65*(1-e/(protocol.episodes*.85))));controller.newTrial();
    const result=run(controller,protocol.trainMaps[e%protocol.trainMaps.length],protocol.steps);
    const {windows,...metrics}=result;history.push(metrics);controller.finishLabTrial();
    if((e+1)%10===0||e+1===protocol.episodes){
      onProgress({episode:e+1,total:protocol.episodes,updates:controller.info().updates,successes:history.filter(r=>r.candidate).length,
        observed:history.slice(-10).reduce((n,r)=>n+r.observed,0)/Math.min(10,history.length)});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  return {model:controller.save(),trainingSeed,masked,history};
}
export const compareMotion=compareOnline;
export function motionPasses(context,masked,initial){
  return [masked,initial].every(other=>context.badWindows<other.badWindows&&context.lifeVisited>=other.lifeVisited&&context.lifeObserved>=other.lifeObserved&&
    context.resetShutdowns<=other.resetShutdowns&&context.lifeShutdowns<=other.lifeShutdowns&&context.resetCollisions<=other.resetCollisions&&context.lifeCollisions<=other.lifeCollisions);
}
