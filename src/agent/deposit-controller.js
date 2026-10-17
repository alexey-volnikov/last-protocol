import {createQController,createNeuralController,encodeObservation,GAMMA} from './controller.js';
export const DEPOSIT_POLICY='deposit-dqn-v1';
export function encodeDepositObservation(obs,lastAction=-1){
  const base=encodeObservation(obs,lastAction),x=new Float32Array(35);
  x.set(base);
  x.set([obs.surfaceConcentration??0,obs.survey?.lastConcentration??0,obs.survey?.concentrationDelta??0,
    obs.survey?.bestConcentration??0,Math.max(0,...(obs.waterReadings||[]).map(p=>p.concentration||0)),(obs.survey?.richCount||0)/3],29);
  return x;
}
export function depositReward(before,after,f){
  const potential=obs=>2*(obs.surfaceConcentration??0)+2*(obs.survey?.bestConcentration??0);
  const components={time:-.015,discovery:f.newDeposit?30:0,collision:f.collision?-.35:0,shutdown:f.shutdown?-8:0,
    sample:f.sampleAttempt?(f.newSurvey ? .12+3*(f.sampleConcentration||0) : -.12):0,
    evidence:f.newRich?2:0,exploration:Math.min(12,f.newCells||0)*.006,
    energy:-Math.max(0,f.energySpentWh||0)*.5,approach:(f.newDeposit?0:GAMMA*potential(after))-potential(before)};
  return {total:Object.values(components).reduce((a,b)=>a+b,0),components};
}
export function createDepositController(options={}){
  return createQController(options,{id:DEPOSIT_POLICY,schema:2,inputs:35,encode:encodeDepositObservation,
    reward:depositReward,terminal:f=>f.newDeposit||f.shutdown});
}
// Явный перенос старого навыка; новые входы концентрации не имеют готовой стратегии.
export function transferSurfaceModel(surface){
  createNeuralController({model:surface,learning:false}); // проверка исходной схемы
  const old=surface.network,w1=Array(35*32).fill(0);
  for(let j=0;j<32;j++)for(let i=0;i<29;i++)w1[j*35+i]=old.w1[j*29+i];
  return {schema_version:2,policy:DEPOSIT_POLICY,updates:surface.updates,
    network:{...structuredClone(old),inputs:35,w1},meta:{origin:'surface-water-v1 transfer; new concentration weights initially zero',pretrainingUpdates:surface.updates}};
}
