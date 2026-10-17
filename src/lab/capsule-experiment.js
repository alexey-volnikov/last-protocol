import {createCapsuleController,CAPSULE_EXPERIMENT} from '../agent/capsule-controller.js';
import {runMotionCase,trainMotion} from './motion-experiment.js';
import {summarizeOnline} from './online-audit.js';
export const CAPSULE_PROTOCOL={id:'capsule-memory-v1',experiment:CAPSULE_EXPERIMENT,trainingSeeds:[1801,3109],episodes:80,steps:2400,
  trainMaps:Array.from({length:16},(_,i)=>21001+i),validation:{maps:[22001,22002,22003],seeds:[137,947]},test:{maps:[23001,23002,23003,23004],seeds:[139,953]},
  resets:6,lifeSteps:43200,window:300,lossPenalty:2,mapBytes:196608,simulationOptions:{capsuleMemory:true}};
export const capsuleFactory=variant=>options=>createCapsuleController(options,variant==='control'?0:CAPSULE_PROTOCOL.lossPenalty);
export function summarizeCapsule(cases){
  const runs=cases.flatMap(c=>[...c.restarts,c.life]);
  return {...summarizeOnline(cases),capsuleLosses:runs.reduce((n,r)=>n+r.capsule.losses,0),
    capsuleReacquired:runs.reduce((n,r)=>n+r.capsule.reacquired,0),unknownActiveSeconds:runs.reduce((n,r)=>n+r.capsule.unknownSeconds,0)};
}
export function evaluateCapsule(model,set=CAPSULE_PROTOCOL.validation,{variant='penalty',onProgress=()=>{}}={}){
  const cases=[];
  for(const map of set.maps)for(const seed of set.seeds){onProgress({map,seed});cases.push(runMotionCase(model,map,seed,
    {createController:capsuleFactory(variant),simulationOptions:CAPSULE_PROTOCOL.simulationOptions}));}
  return {summary:summarizeCapsule(cases),candidates:cases.reduce((n,c)=>n+[...c.restarts,c.life].filter(r=>r.candidate).length,0),cases};
}
export const trainCapsule=options=>trainMotion({...options,protocol:CAPSULE_PROTOCOL,createController:capsuleFactory(options.variant||'penalty'),simulationOptions:CAPSULE_PROTOCOL.simulationOptions});
export function compareCapsule(a,b){return a.badWindows-b.badWindows||a.capsuleLosses-b.capsuleLosses||b.lateVisited-a.lateVisited||a.resetShutdowns-b.resetShutdowns||a.resetCollisions-b.resetCollisions;}
export function capsulePasses(next,...controls){
  return controls.every(c=>next.capsuleLosses<c.capsuleLosses&&next.badWindows<=c.badWindows&&
    ['lifeVisited','lifeObserved','lateVisited','lateObserved'].every(k=>next[k]>=c[k]*.9)&&
    next.resetShutdowns+next.lifeShutdowns<=c.resetShutdowns+c.lifeShutdowns&&next.resetCollisions+next.lifeCollisions<=c.resetCollisions+c.lifeCollisions);
}
