import {trainWater,PROTOCOL,evaluate} from './experiment.js';
import {trainDeposit,evaluateDeposit} from './deposit-experiment.js';
self.onmessage=async event=>{
  try{
    if(event.data.preset==='deposit-lab-v1'){
      const result=await trainDeposit({model:event.data.model,onProgress:p=>self.postMessage({type:'progress',...p})});
      const validation=evaluateDeposit(result.model);
      self.postMessage({type:'done',model:result.model,validation:{found:validation.candidates,total:validation.total,
        note:`лучшая проба в среднем ${(validation.meanBestConcentration*100).toFixed(1)}%`}});
      return;
    }
    const result=await trainWater({model:event.data.model||null,onProgress:p=>self.postMessage({type:'progress',...p})});
    const validation=evaluate(result.model,PROTOCOL.validationSeeds);
    self.postMessage({type:'done',model:result.model,validation});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
