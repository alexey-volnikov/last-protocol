import {createQController} from './controller.js';
import {createDepositController,encodeDepositObservation,depositReward} from './deposit-controller.js';
export const CURIOSITY_EXPERIMENT='curiosity-lab-v1';
export const CURIOSITY_POLICY='curiosity-dqn-v1';
export function encodeCuriosityObservation(obs,lastAction=-1){
  const x=new Float32Array(49);x.set(encodeDepositObservation(obs,lastAction));
  for(let i=0;i<12;i++)x[35+i]=obs.exploration?.directions[i]?.unknown||0;
  x[47]=Math.min(1,Math.max(0,obs.memoryUsedPct/100));
  x[48]=Math.min(1,(obs.exploration?.lastGain||0)/24);
  return x;
}
export function curiosityReward(before,after,feedback){
  const components={...depositReward(before,after,feedback).components};
  delete components.exploration;
  components.curiosity=.03*Math.min(24,Math.max(0,feedback.newKnowledge||0));
  return {total:Object.values(components).reduce((a,b)=>a+b,0),components};
}
export function createCuriosityController(options={}){
  return createQController(options,{id:CURIOSITY_POLICY,schema:3,inputs:49,encode:encodeCuriosityObservation,
    reward:curiosityReward,terminal:f=>f.newDeposit||f.shutdown});
}
export function transferDepositModel(model){
  createDepositController({model,learning:false});
  const old=model.network,w1=Array(49*32).fill(0);
  for(let j=0;j<32;j++)for(let i=0;i<35;i++)w1[j*49+i]=old.w1[j*35+i];
  return {schema_version:3,policy:CURIOSITY_POLICY,updates:model.updates,network:{...structuredClone(old),inputs:49,w1},
    meta:{origin:'Explicit deposit-dqn-v1 transfer; 14 new inputs initially zero',pretrainingUpdates:model.updates}};
}
