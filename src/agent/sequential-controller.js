import {createMotionController,createMotionQController} from './motion-controller.js';
export const SEQUENTIAL_EXPERIMENT='motion-lab-v2';
export const SEQUENTIAL_POLICY='motion-dqn-v2';
export function createSequentialController(options={},decisionNext=true){
  return createMotionQController(options,{id:SEQUENTIAL_POLICY,schema:5,decisionNext});
}
export function transferMotionModel(model){
  createMotionController({model,learning:false});
  return {...structuredClone(model),schema_version:5,policy:SEQUENTIAL_POLICY,
    meta:{origin:'Explicit motion-dqn-v1 transfer; same 61 inputs, bootstrap uses next decision observation',pretrainingUpdates:model.updates}};
}
