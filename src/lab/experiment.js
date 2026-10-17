// LAB-испытания: сброс мира — внешний эксперимент, не новая жизнь игрового ровера.
import {createSimulation,step} from '../sim/engine.js';
import {createNeuralController,ACTIONS} from '../agent/controller.js';
import {makeRandom} from '../agent/random.js';
export const PROTOCOL={id:'surface-water-v1',trainingSeed:2718,episodes:400,steps:1500,validationEvery:40,
  trainSeeds:Array.from({length:24},(_,i)=>101+i),validationSeeds:Array.from({length:12},(_,i)=>701+i),
  testSeeds:Array.from({length:32},(_,i)=>3001+i),rewardVersion:1};

export function runTrial(seed,controller,steps=PROTOCOL.steps){
  controller?.newTrial?.();
  const sim=createSimulation(seed,{controller});
  let count=0,sawWater=false;
  for(;count<steps&&!sim.water.found&&sim.rover.mode==='ACTIVE';count++){
    step(sim);
    sawWater||=Boolean(sim.rover.lastObservation?.waterReadings?.length);
  }
  return {seed,found:sim.water.found,sawWater,steps:count,distance:sim.rover.travelM,
    batteryWh:sim.rover.batteryWh,collisions:sim.stats.collisions,shutdowns:sim.stats.shutdowns,samples:sim.stats.samples};
}
export function randomController(seed=91){
  const random=makeRandom(seed);
  return {id:'random-v1',act(){const name=ACTIONS[Math.floor(random()*ACTIONS.length)];
    return name==='left'||name==='right'?{type:'turn',amount:name==='left'?-.28:.28}:{type:name};}};
}
export function evaluate(model,seeds=PROTOCOL.validationSeeds,kind='network',steps=PROTOCOL.steps){
  const trials=seeds.map(seed=>runTrial(seed,kind==='baseline'?null:kind==='random'?randomController(seed+50000):
    createNeuralController({model,seed:55,learning:false}),steps));
  return {kind,trials,found:trials.filter(t=>t.found).length,total:trials.length,
    successRate:trials.filter(t=>t.found).length/trials.length,
    meanCollisions:trials.reduce((s,t)=>s+t.collisions,0)/trials.length,
    shutdowns:trials.reduce((s,t)=>s+t.shutdowns,0)};
}
export async function trainWater({protocol=PROTOCOL,model=null,onProgress=()=>{}}={}){
  const learner=createNeuralController({seed:protocol.trainingSeed,model,learning:true});
  let successes=0;
  let bestModel=null,bestValidation=null;
  const history=[],checkpoints=[];
  for(let episode=0;episode<protocol.episodes;episode++){
    learner.setExploration(Math.max(.06,.85*(1-episode/(protocol.episodes*.8))));
    const seed=protocol.trainSeeds[episode%protocol.trainSeeds.length];
    const result=runTrial(seed,learner,protocol.steps);
    learner.finishLabTrial(); // Внешний LAB-компьютер обрабатывает записанный отказ; не игровой ровер без питания.
    successes+=Number(result.found);history.push(result);
    if((episode+1)%protocol.validationEvery===0||episode+1===protocol.episodes){
      const candidate=learner.save(),validation=evaluate(candidate,protocol.validationSeeds,'network',protocol.steps);
      checkpoints.push({episode:episode+1,updates:candidate.updates,found:validation.found,total:validation.total});
      if(!bestValidation||validation.found>bestValidation.found||
        validation.found===bestValidation.found&&validation.meanCollisions<bestValidation.meanCollisions){
        bestModel=candidate;bestValidation=validation;
      }
    }
    if((episode+1)%10===0||episode+1===protocol.episodes){
      onProgress({episode:episode+1,total:protocol.episodes,successes,updates:learner.info().updates});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  return {model:bestModel,history,successes,protocol,checkpoints};
}
