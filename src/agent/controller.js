import {QNetwork} from './network.js';
import {makeRandom} from './random.js';
export const MODEL_SCHEMA=1;
export const POLICY_ID='water-dqn-v1';
export const ACTIONS=['move','left','right','wait','sample'];
export const REPLAY_CAPACITY=512; // 512 * (2*29*4 + 16) = 124 KiB логических данных.
export const GAMMA=.985;
const clamp=(v,min=-1,max=1)=>Math.max(min,Math.min(max,v));

export function perceivedWater(obs){
  let nearest=null;
  for(const p of obs.waterReadings||[]){
    const dx=p.x-obs.odometry.x,dy=p.y-obs.odometry.y,distance=Math.hypot(dx,dy);
    if(!nearest||distance<nearest.distance)nearest={distance,angle:Math.atan2(dy,dx)-obs.odometry.heading};
  }
  return nearest;
}
export function encodeObservation(obs,lastAction=-1){
  const water=perceivedWater(obs);
  const x=[water?1:0,water?Math.cos(water.angle):0,water?Math.sin(water.angle):0,
    water?clamp(water.distance/7,0,1):1,obs.surfaceIce?1:0,
    clamp(obs.batteryPct/100,0,1),clamp(obs.temperatureC/100),obs.sunlight,
    obs.contact?1:0,obs.sampleResult===true?1:0,obs.scanFresh?1:0,
    clamp((obs.energyDeltaWh||0)*100)];
  for(let i=0;i<12;i++){
    const angle=obs.odometry.heading+i*Math.PI/6;
    let best=null,delta=Infinity;
    for(const ray of obs.lidar||[]){
      const d=Math.abs(Math.atan2(Math.sin(ray.angle-angle),Math.cos(ray.angle-angle)));
      if(d<delta){best=ray;delta=d;}
    }
    x.push(best?clamp(best.distance/7,0,1):1);
  }
  for(let a=0;a<ACTIONS.length;a++)x.push(a===lastAction?1:0);
  return Float32Array.from(x);
}
// Potential-based shaping: только расстояние до уже измеренного пятна, не скрытая карта.
export function rewardFor(before,after,feedback){
  const potential=obs=>{const water=perceivedWater(obs);return water?3*(1-clamp(water.distance/7,0,1)):0;};
  const components={time:-.015,discovery:feedback.newWater?30:0,
    collision:feedback.collision?-.35:0,shutdown:feedback.shutdown?-8:0,
    sample:feedback.sampleAttempt&&!feedback.newWater?-.08:0,
    exploration:Math.min(12,feedback.newCells||0)*.006,
    energy:-Math.max(0,feedback.energySpentWh||0)*.5,
    approach:(feedback.newWater?0:GAMMA*potential(after))-potential(before)};
  return {total:Object.values(components).reduce((a,b)=>a+b,0),components};
}
export function createNeuralController({model=null,seed=71,learning=true,epsilon=.12}={}){
  return createQController({model,seed,learning,epsilon},{id:POLICY_ID,schema:MODEL_SCHEMA,inputs:29,
    encode:encodeObservation,reward:rewardFor,terminal:f=>f.newWater||f.shutdown});
}
export function createQController({model=null,seed=71,learning=true,epsilon=.12}={},spec){
  const random=makeRandom(seed);
  const training={rate:.003,every:4,batchSize:8,preservePending:true,history:false,decisionNext:false,...spec.training};
  const historyRandom=makeRandom(seed^0x64A17),recentCapacity=training.history?REPLAY_CAPACITY/2:REPLAY_CAPACITY;
  const architecture={inputs:spec.inputs,hidden:32,outputs:5};
  if(model&&(model.schema_version!==spec.schema||model.policy!==spec.id||!Number.isSafeInteger(model.updates)||model.updates<0))throw new Error('Несовместимый формат мозга или режим опыта');
  const meta=model?.meta?structuredClone(model.meta):null;
  let network=model?QNetwork.load(model.network,architecture):new QNetwork(spec.inputs,32,5,random);
  let target=QNetwork.load(network.save(),architecture);
  const replay=[],history=[];
  let replayIndex=0,historySeen=0,replayTerminals=0,lastAction=-1,chosen=0,updates=model?.updates||0,transitions=0,lastReward=0,lastComponents={},qValues=[];
  let pending=null,chosenInput=null; // Опыт при потере питания; обучение только после пробуждения.
  let awaiting=null,discardedTruncations=0;
  function learn(item){
    const displaced=replay[replayIndex];
    if(displaced)replayTerminals-=Number(displaced.done);
    replay[replayIndex]=item;replayTerminals+=Number(item.done);replayIndex=(replayIndex+1)%recentCapacity;
    if(displaced&&training.history){
      historySeen++;
      const slot=history.length<recentCapacity?history.length:Math.floor(historyRandom()*historySeen);
      if(slot<recentCapacity){if(history[slot])replayTerminals-=Number(history[slot].done);history[slot]=displaced;replayTerminals+=Number(displaced.done);}
    }
    transitions++;
    const size=replay.length+history.length;
    if(transitions%training.every!==0||size<16)return;
    for(let b=0;b<training.batchSize;b++){
      const slot=Math.floor(random()*size),e=slot<replay.length?replay[slot]:history[slot-replay.length];
      const nextQ=target.forward(e.next).q;
      network.train(e.x,e.action,e.reward+(e.done?0:GAMMA*Math.max(...nextQ)),training.rate);
    }
    updates++;
    if(updates%100===0)target=QNetwork.load(network.save(),architecture);
  }
  return {
    id:spec.id,
    act(obs){
      if(pending&&learning){learn(pending);pending=null;}
      const x=spec.encode(obs,lastAction);
      if(awaiting){
        if(!awaiting.next)awaiting.next=x.slice();
        if(learning){learn(awaiting);awaiting=null;}
      }
      chosenInput=x;
      qValues=network.forward(x).q;
      chosen=learning&&random()<epsilon?Math.floor(random()*5):qValues.indexOf(Math.max(...qValues));
      lastAction=chosen;
      const name=ACTIONS[chosen];
      return name==='left'||name==='right'?{type:'turn',amount:name==='left'?-.28:.28,reason:name==='left'?'Сеть: поворот влево':'Сеть: поворот вправо'}:
        {type:name,reason:{move:'Сеть: движение',wait:'Сеть: ожидание',sample:'Сеть: анализ пробы'}[name]};
    },
    observe({before,after,feedback}){
      const reward=spec.reward(before,after,feedback);lastReward=reward.total;lastComponents=reward.components;
      if(!learning)return;
      const done=Boolean(spec.terminal(feedback));
      const item={x:chosenInput.slice(),action:chosen,reward:reward.total,
        next:training.decisionNext&&!done?null:spec.encode(after,chosen),done};
      if(feedback.shutdown)pending=item;
      else if(training.decisionNext&&!done)awaiting=item;
      else learn(item);
    },
    setExploration(value){epsilon=clamp(value,0,1);},
    setLearning(value){learning=Boolean(value);},
    newTrial(){lastAction=-1;if(!training.preservePending)pending=null;if(awaiting&&!awaiting.next){awaiting=null;discardedTruncations++;}},
    finishLabTrial(){
      if(pending&&learning){learn(pending);pending=null;}
      if(awaiting){if(awaiting.next&&learning)learn(awaiting);if(!awaiting.next)discardedTruncations++;awaiting=null;}
    },
    info(){return {id:spec.id,updates,replaySize:replay.length+history.length,replayCapacity:REPLAY_CAPACITY,
      replayTerminals,historySize:history.length,deferredFailure:Boolean(pending),training:{...training},
      learning,epsilon,lastReward,components:{...lastComponents},qValues:[...qValues],lastAction,
      ...(training.decisionNext?{awaitingDecision:Boolean(awaiting),discardedTruncations}: {})};},
    save(){return {schema_version:spec.schema,policy:spec.id,updates,network:network.save(),...(meta?{meta:structuredClone(meta)}:{})};}
  };
}
