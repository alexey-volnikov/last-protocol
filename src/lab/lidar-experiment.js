import {createSequentialController} from '../agent/sequential-controller.js';
import {LIDAR_MODE,LEGACY_LIDAR_MODE} from '../sim/lidar.js';
import {runMotionCase} from './motion-experiment.js';
import {summarizeOnline} from './online-audit.js';
export const LIDAR_PROTOCOL={id:'continuous-lidar-v1',model:'models/motion-decision-dqn-v2.json',
  validation:{maps:[19001,19002,19003],seeds:[127,937]},test:{maps:[20001,20002,20003,20004],seeds:[131,941]},
  resets:6,steps:2400,lifeSteps:43200,window:300,epsilon:.06,offlineTraining:false,
  variants:{sampled:LEGACY_LIDAR_MODE,continuous:LIDAR_MODE}};
export function evaluateLidar(model,set,{variant,onProgress=()=>{}}){
  const cases=[];
  for(const map of set.maps)for(const seed of set.seeds){
    onProgress({map,seed});cases.push(runMotionCase(model,map,seed,{createController:createSequentialController,
      simulationOptions:{lidarMode:LIDAR_PROTOCOL.variants[variant]}}));
  }
  return {summary:summarizeOnline(cases),candidates:cases.reduce((n,c)=>n+[...c.restarts,c.life].filter(r=>r.candidate).length,0),cases};
}
export function lidarPasses(next,base){
  return next.resetCollisions+next.lifeCollisions<base.resetCollisions+base.lifeCollisions&&next.badWindows<=base.badWindows&&
    ['lifeVisited','lifeObserved','lateVisited','lateObserved'].every(k=>next[k]>=base[k]*.9)&&
    next.resetShutdowns<=base.resetShutdowns&&next.lifeShutdowns<=base.lifeShutdowns;
}
