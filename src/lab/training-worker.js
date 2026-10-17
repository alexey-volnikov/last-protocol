import {trainWater,PROTOCOL,evaluate} from './experiment.js';
import {trainDeposit,evaluateDeposit} from './deposit-experiment.js';
import {trainCuriosity,evaluateCuriosity} from './curiosity-experiment.js';
import {trainMotion,evaluateMotion,compareMotion} from './motion-experiment.js';
import {trainSequential,evaluateSequential,compareSequential} from './sequential-experiment.js';
self.onmessage=async event=>{
  try{
    if(event.data.preset==='motion-lab-v2'){
      const result=await trainSequential({model:event.data.model,onProgress:p=>self.postMessage({type:'progress',...p})});
      const previous=evaluateSequential(event.data.model),candidate=evaluateSequential(result.model);
      const improved=compareSequential(candidate.summary,previous.summary)<0,validation=improved?candidate:previous;
      self.postMessage({type:'done',model:improved?result.model:event.data.model,validation:{found:validation.candidates,total:validation.cases.length*7,
        note:`живая проверка: ${validation.summary.badWindows} проблемных окон; ${improved?'выбран новый checkpoint':'прежние веса сохранены'}`}});
      return;
    }
    if(event.data.preset==='motion-lab-v1'){
      const result=await trainMotion({model:event.data.model,onProgress:p=>self.postMessage({type:'progress',...p})});
      const previous=evaluateMotion(event.data.model),candidate=evaluateMotion(result.model);
      const improved=compareMotion(candidate.summary,previous.summary)<0,validation=improved?candidate:previous;
      self.postMessage({type:'done',model:improved?result.model:event.data.model,validation:{found:validation.candidates,total:validation.cases.length*7,
        note:`живая проверка: ${validation.summary.badWindows} проблемных окон, за 24 ч посещено ${validation.summary.lifeVisited.toFixed(1)}; ${improved?'выбран новый checkpoint':'прежние веса сохранены'}`}});
      return;
    }
    if(event.data.preset==='curiosity-lab-v1'){
      const result=await trainCuriosity({model:event.data.model,onProgress:p=>self.postMessage({type:'progress',...p})});
      const validation=evaluateCuriosity(result.model);
      self.postMessage({type:'done',model:result.model,validation:{found:validation.candidates,total:validation.total,
        note:`наблюдено ${validation.observed.toFixed(0)}, посещено ${validation.visited.toFixed(0)} клеток, отключений ${validation.shutdowns.toFixed(1)}`}});
      return;
    }
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
