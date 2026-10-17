import {createSequentialController,SEQUENTIAL_EXPERIMENT} from '../agent/sequential-controller.js';
import {runMotionCase,trainMotion,compareMotion} from './motion-experiment.js';
import {summarizeOnline} from './online-audit.js';
export const SEQUENTIAL_PROTOCOL={id:'decision-transitions-v1',experiment:SEQUENTIAL_EXPERIMENT,trainingSeeds:[1709,3011],episodes:80,steps:2400,
  trainMaps:Array.from({length:16},(_,i)=>15001+i),validation:{maps:[16001,16002,16003],seeds:[111,911]},test:{maps:[17001,17002,17003,17004],seeds:[113,929]},
  resets:6,lifeSteps:43200,window:300};
export const sequentialFactory=variant=>options=>createSequentialController(options,variant==='decision');
export function evaluateSequential(model,set=SEQUENTIAL_PROTOCOL.validation,{variant='decision',onProgress=()=>{}}={}){
  const cases=[];
  for(const map of set.maps)for(const seed of set.seeds){
    onProgress({map,seed});cases.push(runMotionCase(model,map,seed,{createController:sequentialFactory(variant)}));
  }
  return {summary:summarizeOnline(cases),candidates:cases.reduce((n,c)=>n+[...c.restarts,c.life].filter(r=>r.candidate).length,0),cases};
}
export const trainSequential=options=>trainMotion({...options,protocol:SEQUENTIAL_PROTOCOL,createController:sequentialFactory(options.variant||'decision')});
export {compareMotion as compareSequential};
export function sequentialPasses(fixed,...controls){
  return controls.every(c=>fixed.spinWindows<c.spinWindows&&fixed.badWindows<c.badWindows&&fixed.lifeVisited>=c.lifeVisited&&fixed.lifeObserved>=c.lifeObserved&&
    fixed.resetShutdowns<=c.resetShutdowns&&fixed.lifeShutdowns<=c.lifeShutdowns&&fixed.resetCollisions<=Math.max(c.resetCollisions*1.25,c.resetCollisions+5)&&fixed.lifeCollisions<=Math.max(c.lifeCollisions*1.25,c.lifeCollisions+5));
}
