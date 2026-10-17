import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {traceLidar,LIDAR_MODE,LEGACY_LIDAR_MODE} from '../src/sim/lidar.js';
import {createSimulation,step,status} from '../src/sim/engine.js';
import {sampleSensors} from '../src/sim/sensors.js';
import {LIDAR_PROTOCOL,lidarPasses} from '../src/lab/lidar-experiment.js';
import {summarizeOnline} from '../src/lab/online-audit.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const world=()=>({w:5,h:5,cells:Array.from({length:25},()=>({rock:false}))});
test('continuous lidar detects a near obstacle and a short corner intersection skipped by 35 cm sampling',()=>{
  const w=world();w.cells[1*5+2].rock=true;
  let hit=traceLidar(w,1.98,1.5,0,7);assert.equal(hit.hit,true);close(hit.distance,.02);
  hit=traceLidar(w,1.99,1.99,-Math.PI/4,7);assert.equal(hit.hit,true);close(hit.distance,.01*Math.SQRT2);
  const a=createSimulation(42),b=createSimulation(42,{lidarMode:LEGACY_LIDAR_MODE});
  for(const s of [a,b])Object.assign(s.rover,{x:47.9367983945094,y:32.108212741007335,estimatedX:47.9367983945094,estimatedY:32.108212741007335,heading:36.94000000000007});
  const correct=sampleSensors(a.world,a.rover,a.time).lidar[0],old=sampleSensors(b.world,b.rover,b.time).lidar[0];
  assert.equal(old.distance,7);assert.equal(old.hit,false);assert.equal(correct.hit,true);assert.ok(correct.distance<.09);
});
test('lidar handles negative and axis directions, exact starting corners, boundaries and finite range',()=>{
  const w=world();
  close(traceLidar(w,.03,2.5,Math.PI,7).distance,.03);
  close(traceLidar(w,2.5,.02,-Math.PI/2,7).distance,.02);
  close(traceLidar(w,2.5,4.98,Math.PI/2,7).distance,.02);
  assert.deepEqual(traceLidar(w,2.5,2.5,0,1),{distance:1,hit:false});
  w.cells[1*5+1].rock=true;
  assert.deepEqual(traceLidar(w,1,1,Math.PI/4,1),{distance:0,hit:true});
  const tie=world();tie.cells[2*5+2].rock=true;
  close(traceLidar(tie,1.5,1.5,Math.PI/4,7).distance,Math.SQRT1_2);
});
test('a detected wall occludes map and spectrum; cached readings do not become free new scans',()=>{
  const s=createSimulation(42,{preset:'deposit-lab-v1',curiosity:true}),r=s.rover;
  for(const c of s.world.cells){c.rock=false;c.ice=false;c.iceFraction=0;}
  Object.assign(r,{x:10.98,y:10.5,estimatedX:10.98,estimatedY:10.5,heading:0});
  for(let y=0;y<s.world.h;y++)s.world.cells[y*s.world.w+11].rock=true;
  s.world.cells[10*s.world.w+12].ice=true;s.world.cells[10*s.world.w+12].iceFraction=1;
  const o=sampleSensors(s.world,r,s.time);assert.equal(o.lidar[0].hit,true);close(o.lidar[0].distance,.02);
  assert.equal(r.memory.cells.get('11,10').rock,true);assert.equal(r.memory.cells.has('12,10'),false);assert.deepEqual(o.waterReadings,[]);
  const count=r.memory.cells.size,observed=r.exploration.uniqueObserved;
  r.x+=.001;r.heading+=.28;
  const cached=sampleSensors(s.world,r,s.time+2,{scan:false});assert.deepEqual(cached.lidar,o.lidar);assert.equal(cached.scanFresh,false);
  assert.equal(r.memory.cells.size,count);assert.equal(r.exploration.uniqueObserved,observed);assert.equal('world' in cached,false);
});
test('corrected lidar preserves deterministic physics, sleep and the explicit legacy control',()=>{
  const a=createSimulation(317),b=createSimulation(317);
  for(let i=0;i<200;i++){step(a);step(b);}assert.deepEqual(a.rover,b.rover);assert.deepEqual(a.stats,b.stats);
  assert.equal(status(a).lidarMode,LIDAR_MODE);assert.throws(()=>createSimulation(1,{lidarMode:'other'}));
  const rays=structuredClone(a.rover.lastLidar),scans=a.rover.scans;
  a.rover.mode='HIBERNATING';a.rover.offReason='EMPTY';a.rover.batteryWh=0;a.time=1400;
  for(let i=0;i<20;i++)step(a);assert.deepEqual(a.rover.lastLidar,rays);assert.equal(a.rover.scans,scans);
});
test('sensor comparison uses untouched map/learner pairs and cannot pass by stopping exploration',()=>{
  const p=LIDAR_PROTOCOL,maps=[...p.validation.maps,...p.test.maps];assert.equal(new Set(maps).size,maps.length);
  assert.ok(maps.every(m=>m>=19001));assert.ok(p.test.seeds.every(s=>!p.validation.seeds.includes(s)));assert.equal(p.offlineTraining,false);
  const base={resetCollisions:20,lifeCollisions:4,badWindows:10,lifeVisited:100,lifeObserved:500,lateVisited:30,lateObserved:300,resetShutdowns:10,lifeShutdowns:4};
  assert.equal(lidarPasses({...base,resetCollisions:10},base),true);
  assert.equal(lidarPasses({...base,resetCollisions:10,lifeVisited:80},base),false);
  assert.equal(lidarPasses({...base,resetCollisions:10,badWindows:11},base),false);
});
test('lidar comparison retains the same starting model, exact sources and all live evaluation pairs',async()=>{
  const root=new URL('../',import.meta.url),r=JSON.parse(await readFile(new URL('experiments/lidar-benchmark.json',root),'utf8'));
  const sha=s=>createHash('sha256').update(s).digest('hex');assert.deepEqual(r.protocol,LIDAR_PROTOCOL);
  assert.equal(r.modelSha256,sha(JSON.stringify(JSON.parse(await readFile(new URL(LIDAR_PROTOCOL.model,root),'utf8')))));
  for(const [name,hash] of Object.entries(r.sourceHashes))assert.equal(sha((await readFile(new URL(name,root),'utf8')).replace(/\r\n/g,'\n')),hash,name);
  for(const phase of ['validation','test']){
    const set=LIDAR_PROTOCOL[phase];
    for(const result of Object.values(r[phase])){
      assert.deepEqual(result.cases.map(c=>[c.map,c.seed]),set.maps.flatMap(m=>set.seeds.map(s=>[m,s])));
      assert.deepEqual(result.summary,summarizeOnline(result.cases));
      for(const c of result.cases){assert.equal(c.learning,true);assert.equal(c.deferredDropped,0);for(const run of [...c.restarts,c.life])assert.ok(run.replaySize<=512);}
    }
    assert.equal(r.criteria[phase],lidarPasses(r[phase].continuous.summary,r[phase].sampled.summary));
  }
  assert.equal(r.criteria.accepted,r.criteria.validation&&r.criteria.test);
});
