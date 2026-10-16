import {sunlightAt,surfaceTempC,tileAt,DEPOSIT_PRESET} from './world.js';
import {remember} from './memory.js';
export const LIDAR_RAYS=12;
export const LIDAR_RANGE=7; // клетки = условные метры для первой лаборатории
export const SPECTRAL_RANGE=4; // LAB: видимый поверхностный лёд; не поиск подземной воды.

// ВАЖНО: world используется исключительно сенсорной системой, не политикой.
export function sampleSensors(world,rover,time,{scan=true}={}){
  const deposit=world.preset===DEPOSIT_PRESET,spectrum=rover.spectrometerEnabled!==false;
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
  reading.contact=Boolean(rover.contact);
  reading.sampleResult=rover.sampleResult??null;
  reading.energyDeltaWh=rover.energyDeltaWh||0;
  reading.surfaceIce=!spectrum?false:scan?Boolean(cell?.ice):Boolean(rover.lastSurfaceIce&&Math.hypot(rover.x-rover.scanX,rover.y-rover.scanY)<.15);
  if(deposit){
    const valid=spectrum&&(scan||Math.hypot(rover.x-rover.scanX,rover.y-rover.scanY)<.15);
    reading.surfaceConcentration=valid?(scan?cell?.iceFraction??0:rover.lastSurfaceConcentration):null;
    reading.survey={...(rover.surveySummary||{lastConcentration:null,bestConcentration:0,concentrationDelta:0,uniqueProbes:0,richCount:0,confirmed:false})};
  }
  if(scan){
    rover.lastSurfaceIce=reading.surfaceIce;rover.scanX=rover.x;rover.scanY=rover.y;
    if(deposit)rover.lastSurfaceConcentration=reading.surfaceConcentration;
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
        const record={rock:t.rock,crater:t.crater,rim:t.rim,seenAt:time};
        if(d<=SPECTRAL_RANGE&&spectrum&&(!deposit||!t.rock)){
          record.ice=t.ice;
          if(deposit)record.iceFraction=t.iceFraction;
          if(t.ice)record.waterPosition={x:rover.estimatedX+Math.floor(tx)+.5-rover.x,y:rover.estimatedY+Math.floor(ty)+.5-rover.y};
        }
        evicted+=remember(rover.memory,tx,ty,record);
        if(t.rock){distance=d;hit=true;break;}
      }
      rays.push({angle,distance,hit});
    }
    reading.lidar=rays; reading.scanFresh=true; reading.evicted=evicted;
    rover.lastLidar=rays;
  }
  // Только записи реально измеренных участков, исчезают при вытеснении карты.
  reading.waterReadings=[...rover.memory.cells.values()].filter(c=>c.ice&&c.waterPosition)
    .map(c=>({...c.waterPosition,...(deposit?{concentration:c.iceFraction}: {})})).sort((a,b)=>Math.hypot(a.x-rover.estimatedX,a.y-rover.estimatedY)-Math.hypot(b.x-rover.estimatedX,b.y-rover.estimatedY)).slice(0,8);
  reading.lidar=reading.lidar.map(ray=>({...ray}));
  // Маяк базы физически ограничен радиусом, а не всеведущими координатами.
  const baseDistance=Math.hypot(rover.x-world.home.x,rover.y-world.home.y);
  if(baseDistance<9){
    reading.homeBeacon=true;
    reading.homeBearing=Math.atan2(world.home.y-rover.y,world.home.x-rover.x);
  }
  return reading;
}
