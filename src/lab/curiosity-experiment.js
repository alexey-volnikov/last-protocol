import {createSimulation,step} from '../sim/engine.js';
import {DEPOSIT_PRESET} from '../sim/world.js';
import {createDepositController} from '../agent/deposit-controller.js';
import {createCuriosityController,transferDepositModel,CURIOSITY_EXPERIMENT} from '../agent/curiosity-controller.js';
import {randomController} from './experiment.js';
export const CURIOSITY_PROTOCOL={id:CURIOSITY_EXPERIMENT,trainingSeeds:[1421,2593],episodes:160,steps:2400,validationEvery:40,
  trainSeeds:Array.from({length:16},(_,i)=>7001+i),validationSeeds:Array.from({length:8},(_,i)=>8001+i),testSeeds:Array.from({length:16},(_,i)=>9001+i)};
export function runCuriosityTrial(seed,controller,steps=CURIOSITY_PROTOCOL.steps){
  controller.newTrial?.();
  const sim=createSimulation(seed,{controller,preset:DEPOSIT_PRESET,curiosity:true});
  for(let i=0;i<steps;i++)step(sim);
  return {seed,observed:sim.rover.exploration.uniqueObserved,visited:sim.rover.exploration.uniqueVisited,
    shutdowns:sim.stats.shutdowns,collisions:sim.stats.collisions,energyWh:sim.stats.energySpentWh,
    activeSeconds:sim.stats.activeSeconds,sleepSeconds:sim.stats.sleepSeconds,distance:sim.rover.travelM,
    candidate:sim.survey.confirmed,bestConcentration:sim.survey.best};
}
export function evaluateCuriosity(model,seeds=CURIOSITY_PROTOCOL.validationSeeds,{steps=CURIOSITY_PROTOCOL.steps,kind='curiosity'}={}){
  const trials=seeds.map(seed=>runCuriosityTrial(seed,kind==='random'?randomController(seed+170000):
    kind==='deposit'?createDepositController({model,learning:false}):createCuriosityController({model,learning:false}),steps));
  const mean=key=>trials.reduce((n,t)=>n+t[key],0)/trials.length;
  const result={trials,total:trials.length,candidates:trials.filter(t=>t.candidate).length};
  for(const key of ['observed','visited','shutdowns','collisions','energyWh','activeSeconds','sleepSeconds','distance','bestConcentration'])result[key]=mean(key);
  result.score=result.observed+5*result.visited-20*result.shutdowns-.02*result.collisions;
  return result;
}
export async function trainCuriosity({depositModel=null,model=null,trainingSeed=1421,protocol=CURIOSITY_PROTOCOL,onProgress=()=>{}}={}){
  const initial=model||transferDepositModel(depositModel),learner=createCuriosityController({model:initial,seed:trainingSeed,learning:true});
  let best=initial,bestScore=evaluateCuriosity(initial,protocol.validationSeeds,{steps:protocol.steps}).score;
  const history=[],checkpoints=[{episode:0,updates:initial.updates,score:bestScore}];
  for(let e=0;e<protocol.episodes;e++){
    learner.setExploration(Math.max(.06,.65*(1-e/(protocol.episodes*.85))));
    history.push(runCuriosityTrial(protocol.trainSeeds[e%protocol.trainSeeds.length],learner,protocol.steps));
    learner.finishLabTrial(); // Внешний LAB-компьютер обрабатывает записанный отказ, не спящий ровер.
    if((e+1)%protocol.validationEvery===0||e+1===protocol.episodes){
      const candidate=learner.save(),validation=evaluateCuriosity(candidate,protocol.validationSeeds,{steps:protocol.steps});
      checkpoints.push({episode:e+1,updates:candidate.updates,score:validation.score});
      if(validation.score>bestScore){best=candidate;bestScore=validation.score;}
    }
    if((e+1)%10===0||e+1===protocol.episodes){
      const recent=history.slice(-10);
      onProgress({episode:e+1,total:protocol.episodes,successes:history.filter(t=>t.candidate).length,updates:learner.info().updates,
        observed:recent.reduce((n,t)=>n+t.observed,0)/recent.length});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  return {model:best,history,checkpoints,trainingSeed};
}
