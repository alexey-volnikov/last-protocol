import {ACTIONS,createQController} from './controller.js';
import {createCuriosityController,encodeCuriosityObservation,curiosityReward} from './curiosity-controller.js';
export const MOTION_EXPERIMENT='motion-lab-v1';
export const MOTION_POLICY='motion-dqn-v1';
export const MOTION_WINDOW=32;
export const MOTION_BYTES=MOTION_WINDOW*8*4;
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));

// Только наблюдаемая одометрия и последствия собственных действий. Без world.
export function createMotionMemory(){
  const records=new Float32Array(MOTION_WINDOW*8);
  let count=0,index=0;
  function summary(){
    let dx=0,dy=0,path=0,rotation=0,newData=0,contacts=0,energy=0,scans=0;
    const actions=Array(5).fill(0);
    for(let i=0;i<count;i++){
      const p=i*8;dx+=records[p];dy+=records[p+1];path+=Math.hypot(records[p],records[p+1]);
      rotation+=records[p+2];newData+=records[p+3];actions[records[p+4]]++;
      contacts+=records[p+5];energy+=records[p+6];scans+=records[p+7];
    }
    return {count,capacity:MOTION_WINDOW,bytes:MOTION_BYTES,path,displacement:Math.hypot(dx,dy),rotation,newData,contacts,energy,scans,actions};
  }
  return {
    record(before,after,feedback,action){
      const a=before.odometry,b=after.odometry,p=index*8;
      records.set([b.x-a.x,b.y-a.y,Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading)),
        Math.max(0,feedback.newKnowledge||0),action,Number(Boolean(after.contact)),Math.max(0,feedback.energySpentWh||0),Number(Boolean(after.scanFresh))],p);
      index=(index+1)%MOTION_WINDOW;count=Math.min(MOTION_WINDOW,count+1);
    },
    features(){
      const s=summary(),n=Math.max(1,s.count),pathScale=MOTION_WINDOW*.09;
      return Float32Array.from([s.count/MOTION_WINDOW,clamp(s.path/pathScale),clamp(s.displacement/pathScale),
        clamp(s.rotation/(MOTION_WINDOW*.28),-1,1),(s.actions[1]+s.actions[2])/n,s.actions[0]/n,s.actions[3]/n,s.actions[4]/n,
        s.contacts/n,clamp(s.newData/(MOTION_WINDOW*24)),clamp(s.energy/(MOTION_WINDOW*.05)),s.scans/n]);
    },
    clear(){records.fill(0);count=0;index=0;},summary
  };
}
export function createMotionController({masked=false,...options}={}){
  const memory=createMotionMemory();let action=0;
  const controller=createQController(options,{id:MOTION_POLICY,schema:4,inputs:61,
    encode(obs,lastAction){const x=new Float32Array(61);x.set(encodeCuriosityObservation(obs,lastAction));if(!masked)x.set(memory.features(),49);return x;},
    reward:curiosityReward,terminal:f=>f.newDeposit||f.shutdown,training:{history:true}});
  return {...controller,
    act(obs){const selected=controller.act(obs);action=selected.type==='turn'?(selected.amount<0?1:2):ACTIONS.indexOf(selected.type);return selected;},
    observe(event){memory.record(event.before,event.after,event.feedback,action);controller.observe(event);},
    newTrial(){memory.clear();controller.newTrial();},
    info(){return {...controller.info(),motion:{...memory.summary(),masked}};}
  };
}
export function transferCuriosityModel(model){
  createCuriosityController({model,learning:false});
  const old=model.network,w1=Array(61*32).fill(0);
  for(let j=0;j<32;j++)for(let i=0;i<49;i++)w1[j*61+i]=old.w1[j*49+i];
  return {schema_version:4,policy:MOTION_POLICY,updates:model.updates,network:{...structuredClone(old),inputs:61,w1},
    meta:{origin:'Explicit curiosity-dqn-v1 transfer; 12 motion inputs initially zero',pretrainingUpdates:model.updates}};
}
