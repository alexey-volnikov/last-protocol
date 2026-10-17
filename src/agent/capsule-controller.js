import {ACTIONS,createQController} from './controller.js';
import {encodeCuriosityObservation,curiosityReward} from './curiosity-controller.js';
import {createMotionMemory} from './motion-controller.js';
import {createSequentialController} from './sequential-controller.js';
export const CAPSULE_EXPERIMENT='capsule-memory-lab-v1';
export const CAPSULE_POLICY='capsule-dqn-v1';
export const CAPSULE_LOSS_PENALTY=2;
export function capsuleFeatures(obs){
  const known=Boolean(obs.capsule?.known&&obs.capsule.position),p=obs.capsule?.position,o=obs.odometry;
  const direction=known?Math.atan2(p.y-o.y,p.x-o.x)-o.heading:0;
  const beacon=Boolean(obs.homeBeacon&&Number.isFinite(obs.homeBearing)),bearing=beacon?obs.homeBearing-o.heading:0;
  return Float32Array.from([Number(known),known?Math.cos(direction):0,known?Math.sin(direction):0,
    known?Math.min(1,Math.hypot(p.x-o.x,p.y-o.y)/40):0,Number(beacon),beacon?Math.cos(bearing):0,beacon?Math.sin(bearing):0,
    known?Math.min(1,Math.max(0,obs.capsule.ageSeconds||0)/7200):0]);
}
export function capsuleReward(before,after,feedback,lossPenalty=CAPSULE_LOSS_PENALTY){
  const components={...curiosityReward(before,after,feedback).components,capsuleLoss:feedback.capsuleLost?-lossPenalty:0};
  return {total:Object.values(components).reduce((a,b)=>a+b,0),components};
}
export function createCapsuleController(options={},lossPenalty=CAPSULE_LOSS_PENALTY){
  if(!Number.isFinite(lossPenalty)||lossPenalty<0)throw new Error('Некорректный штраф потери капсулы');
  const memory=createMotionMemory();let action=0;
  const controller=createQController(options,{id:CAPSULE_POLICY,schema:6,inputs:69,
    encode(obs,lastAction){const x=new Float32Array(69);x.set(encodeCuriosityObservation(obs,lastAction));x.set(memory.features(),49);x.set(capsuleFeatures(obs),61);return x;},
    reward:(before,after,f)=>capsuleReward(before,after,f,lossPenalty),terminal:f=>f.newDeposit||f.shutdown,training:{history:true,decisionNext:true}});
  return {...controller,
    act(obs){const selected=controller.act(obs);action=selected.type==='turn'?(selected.amount<0?1:2):ACTIONS.indexOf(selected.type);return selected;},
    observe(event){memory.record(event.before,event.after,event.feedback,action);controller.observe(event);},
    newTrial(){memory.clear();controller.newTrial();},
    info(){return {...controller.info(),motion:{...memory.summary(),masked:false},capsuleLossPenalty:lossPenalty};}
  };
}
export function transferSequentialModel(model){
  createSequentialController({model,learning:false});
  const old=model.network,w1=Array(69*32).fill(0);
  for(let j=0;j<32;j++)for(let i=0;i<61;i++)w1[j*69+i]=old.w1[j*61+i];
  return {schema_version:6,policy:CAPSULE_POLICY,updates:model.updates,network:{...structuredClone(old),inputs:69,w1},
    meta:{origin:'Explicit motion-dqn-v2 transfer; 8 capsule inputs initially zero',pretrainingUpdates:model.updates}};
}
