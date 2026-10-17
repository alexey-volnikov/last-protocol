// Ограниченные отпечатки ИЗМЕРЕННОГО пространства, без доступа к world.
export const EXPLORATION_BYTES=2048;
const WIDTH=128,HEIGHT=64;
const offsets=Array.from({length:12},(_,i)=>[2,4,6].map(r=>[Math.cos(i*Math.PI/6)*r,Math.sin(i*Math.PI/6)*r])).flat();
function index(x,y){const ix=Math.floor(x),iy=Math.floor(y);return ix>=0&&ix<WIDTH&&iy>=0&&iy<HEIGHT?iy*WIDTH+ix:-1;}
function add(bits,x,y){const i=index(x,y);if(i<0)return false;const byte=i>>>3,mask=1<<(i&7);if(bits[byte]&mask)return false;bits[byte]|=mask;return true;}
function seen(bits,x,y){const i=index(x,y);return i<0||Boolean(bits[i>>>3]&(1<<(i&7)));}
export function createExploration(){return {observed:new Uint8Array(1024),visited:new Uint8Array(1024),uniqueObserved:0,uniqueVisited:0,lastGain:0,scans:0};}
export function markObserved(state,x,y){if(add(state.observed,x,y)){state.uniqueObserved++;return true;}return false;}
export function markVisited(state,x,y){if(add(state.visited,x,y))state.uniqueVisited++;}
export function explorationReading(state,odometry,lidar){
  const {x,y,heading}=odometry;
  const directions=Array.from({length:12},(_,i)=>{
    const angle=heading+i*Math.PI/6;
    let nearest=null,delta=Infinity;
    for(const ray of lidar){const d=Math.abs(Math.atan2(Math.sin(ray.angle-angle),Math.cos(ray.angle-angle)));if(d<delta){delta=d;nearest=ray;}}
    if(!nearest)return {angle,unknown:0,available:false};
    const distance=Math.min(3,Math.max(0,nearest.distance-.35));
    const cx=x+Math.cos(angle)*distance,cy=y+Math.sin(angle)*distance;
    const unknown=distance<.1?0:offsets.reduce((n,[dx,dy])=>n+Number(!seen(state.observed,cx+dx,cy+dy)),0)/offsets.length;
    return {angle,unknown,available:true};
  });
  return {uniqueObserved:state.uniqueObserved,uniqueVisited:state.uniqueVisited,lastGain:state.lastGain,scans:state.scans,
    footprintBytes:EXPLORATION_BYTES,directions};
}
