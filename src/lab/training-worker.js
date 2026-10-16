import {trainWater,PROTOCOL,evaluate} from './experiment.js';
self.onmessage=async event=>{
  try{
    const result=await trainWater({model:event.data.model||null,onProgress:p=>self.postMessage({type:'progress',...p})});
    const validation=evaluate(result.model,PROTOCOL.validationSeeds);
    self.postMessage({type:'done',model:result.model,validation});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
