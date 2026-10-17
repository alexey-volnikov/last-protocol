import {createSimulation,step} from '../sim/engine.js';
import {DEPOSIT_PRESET} from '../sim/world.js';
import {createDepositController,transferSurfaceModel} from '../agent/deposit-controller.js';
import {randomController} from './experiment.js';
export const DEPOSIT_PROTOCOL={id:'deposit-lab-v1',episodes:80,steps:2400,validationEvery:20,
  trainingSeeds:[431,991],trainSeeds:Array.from({length:12},(_,i)=>4001+i),
  validationSeeds:Array.from({length:6},(_,i)=>5001+i),testSeeds:Array.from({length:12},(_,i)=>6001+i)};
export function runDepositTrial(seed,controller,steps=DEPOSIT_PROTOCOL.steps){
  controller.newTrial?.();
  const sim=createSimulation(seed,{controller,preset:DEPOSIT_PRESET});
  let count=0;
  for(;count<steps&&!sim.survey.confirmed&&sim.rover.mode==='ACTIVE';count++)step(sim);
  return {seed,candidate:sim.survey.confirmed,steps:count,bestConcentration:sim.survey.best,
    uniqueProbes:sim.survey.uniqueProbes,collisions:sim.stats.collisions,shutdowns:sim.stats.shutdowns,distance:sim.rover.travelM};
}
export function evaluateDeposit(model,seeds=DEPOSIT_PROTOCOL.validationSeeds,{steps=DEPOSIT_PROTOCOL.steps,random=false}={}){
  const trials=seeds.map(seed=>runDepositTrial(seed,random?randomController(80000+seed):createDepositController({model,learning:false}),steps));
  const mean=key=>trials.reduce((sum,t)=>sum+t[key],0)/trials.length;
  const candidates=trials.filter(t=>t.candidate).length;
  return {trials,total:trials.length,candidates,meanBestConcentration:mean('bestConcentration'),meanUniqueProbes:mean('uniqueProbes'),
    meanCollisions:mean('collisions'),score:candidates*100+mean('bestConcentration')*20+mean('uniqueProbes')*.02};
}
export async function trainDeposit({surfaceModel=null,model=null,trainingSeed=431,protocol=DEPOSIT_PROTOCOL,onProgress=()=>{}}={}){
  const initial=model||transferSurfaceModel(surfaceModel);
  const learner=createDepositController({model:initial,seed:trainingSeed,learning:true});
  const initialValidation=evaluateDeposit(initial,protocol.validationSeeds,{steps:protocol.steps});
  let best=initial,bestScore=initialValidation.score;
  const history=[],checkpoints=[{episode:0,updates:initial.updates,score:bestScore}];
  for(let e=0;e<protocol.episodes;e++){
    learner.setExploration(Math.max(.06,.45*(1-e/(protocol.episodes*.8))));
    const trial=runDepositTrial(protocol.trainSeeds[e%protocol.trainSeeds.length],learner,protocol.steps);
    learner.finishLabTrial();history.push(trial);
    if((e+1)%protocol.validationEvery===0||e+1===protocol.episodes){
      const candidate=learner.save(),evaluation=evaluateDeposit(candidate,protocol.validationSeeds,{steps:protocol.steps});
      checkpoints.push({episode:e+1,updates:candidate.updates,score:evaluation.score});
      if(evaluation.score>bestScore){best=candidate;bestScore=evaluation.score;}
    }
    if((e+1)%10===0||e+1===protocol.episodes){
      onProgress({episode:e+1,total:protocol.episodes,successes:history.filter(t=>t.candidate).length,updates:learner.info().updates});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  return {model:best,history,checkpoints,trainingSeed,protocol};
}
