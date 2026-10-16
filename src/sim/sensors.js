import {sunlightAt,surfaceTempC,tileAt} from './world.js';
import {remember} from './memory.js';
export const LIDAR_RAYS=12;
export const LIDAR_RANGE=7; // клетки = условные метры для первой лаборатории

// ВАЖНО: world используется исключительно сенсорной системой, не политикой.
export function sampleSensors(world,rover,time,{scan=true}={}){
  const cell=tileAt(world,rover.x,rover.y);
  const reading={
    batteryPct:Math.max(0,rover.batteryWh/rover.capacityWh*100),
    batteryWh:rover.batteryWh,
    temperatureC:rover.bodyTempC,
    sunlight:sunlightAt(world,rover.x,rover.y,time),
    surfaceTempC:surfaceTempC(world,rover.x,rover.y,time),
    odometry:{x:rover.estimatedX,y:rover.estimatedY,heading:rover.heading},
    inclination:cell?.rim||0,
    memoryUsedPct:rover.memory.cells.size*384/rover.memory.capacityBytes*100,
    lidar:rover.lastLidar||[],
    scanFresh:false,
    homeBeacon:false,
    homeBearing:null
  };
  if(scan){
    let evicted=0;
    const rays=[];
    for(let i=0;i<LIDAR_RAYS;i++){
      const angle=rover.heading+i*2*Math.PI/LIDAR_RAYS;
      const dx=Math.cos(angle),dy=Math.sin(angle);
      let distance=LIDAR_RANGE,hit=false;
      for(let d=.35;d<=LIDAR_RANGE;d+=.32){
        const tx=rover.x+dx*d,ty=rover.y+dy*d;
        const t=tileAt(world,tx,ty);
        if(!t){distance=d;hit=true;break;}
        evicted+=remember(rover.memory,tx,ty,{rock:t.rock,crater:t.crater,rim:t.rim,seenAt:time});
        if(t.rock){distance=d;hit=true;break;}
      }
      rays.push({angle,distance,hit});
    }
    reading.lidar=rays; reading.scanFresh=true; reading.evicted=evicted;
    rover.lastLidar=rays;
  }
  // Маяк базы физически ограничен радиусом, а не всеведущими координатами.
  const baseDistance=Math.hypot(rover.x-world.home.x,rover.y-world.home.y);
  if(baseDistance<9){
    reading.homeBeacon=true;
    reading.homeBearing=Math.atan2(world.home.y-rover.y,world.home.x-rover.x);
  }
  return reading;
}
