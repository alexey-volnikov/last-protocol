import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSimulation,step,STEP_SECONDS} from '../src/sim/engine.js';
import {sampleSensors} from '../src/sim/sensors.js';
import {createExploration,markObserved,explorationReading,EXPLORATION_BYTES} from '../src/sim/exploration.js';
import {createCuriosityController,transferDepositModel,encodeCuriosityObservation,curiosityReward} from '../src/agent/curiosity-controller.js';
import {createDepositController} from '../src/agent/deposit-controller.js';
import {CURIOSITY_PROTOCOL} from '../src/lab/curiosity-experiment.js';
const root=new URL('../',import.meta.url);
const deposit=JSON.parse(await readFile(new URL('models/deposit-dqn-v1.json',root),'utf8'));
function fixture(action={type:'wait'}){
  const s=createSimulation(42,{preset:'deposit-lab-v1',curiosity:true,controller:{id:'test',act:()=>action}});
  for(const c of s.world.cells)Object.assign(c,{rock:false,crater:0,rim:0,ice:false,iceFraction:0});
  s.rover.heading=0;return s;
}
test('curiosity footprints have fixed budgets and directional estimates require actual lidar',()=>{
  const state=createExploration(),pose={x:34.5,y:22.5,heading:0};
  assert.equal(state.observed.byteLength+state.visited.byteLength,EXPLORATION_BYTES);
  assert.ok(explorationReading(state,pose,[]).directions.every(d=>!d.available&&d.unknown===0));
  assert.equal(markObserved(state,34.5,22.5),true);assert.equal(markObserved(state,34.8,22.6),false);
  assert.equal(markObserved(state,-1,22),false);assert.equal(markObserved(state,200,200),false);
  const reading=explorationReading(state,pose,[{angle:0,distance:.35}]);
  assert.equal(reading.directions[0].unknown,0);
});
test('same measured scene and deleted detailed map cannot regenerate curiosity',()=>{
  const s=fixture(),r=s.rover;r.memory.capacityBytes=384;
  const first=sampleSensors(s.world,r,s.time),count=r.exploration.uniqueObserved;
  assert.ok(first.exploration.lastGain>0);assert.ok(r.memory.lost>0);
  r.memory.cells.clear();
  const repeat=sampleSensors(s.world,r,s.time+100);
  assert.equal(repeat.exploration.lastGain,0);assert.equal(repeat.exploration.uniqueObserved,count);
  r.x+=2;r.estimatedX+=2;
  const moved=sampleSensors(s.world,r,s.time+200);
  assert.ok(moved.exploration.lastGain>0);assert.ok(r.memory.cells.size<=1);
});
test('novelty uses sensed odometry footprints and ignores hidden deposit and unseen terrain',()=>{
  const a=fixture(),b=fixture();
  b.world.deposit={x:0,y:0,rx:100,ry:100};b.world.cells[0].rock=true;b.world.cells[0].iceFraction=.98;
  const oa=sampleSensors(a.world,a.rover,a.time),ob=sampleSensors(b.world,b.rover,b.time);
  assert.deepEqual(oa.exploration,ob.exploration);
  const copy=structuredClone(oa);copy.exploration.directions[0].unknown=999;
  assert.notEqual(sampleSensors(a.world,a.rover,a.time,{scan:false}).exploration.directions[0].unknown,999);
  const shifted=fixture();shifted.rover.estimatedX+=20;
  sampleSensors(shifted.world,shifted.rover,shifted.time);
  assert.notDeepEqual(shifted.rover.exploration.observed,a.rover.exploration.observed);
});
test('powered scan follows action, costs energy, and yields one intrinsic reward pulse',()=>{
  const s=fixture({type:'move'});s.tick=2;
  const before=s.rover.estimatedX;step(s);
  assert.ok(s.rover.estimatedX>before);assert.equal(s.rover.scans,1);
  assert.equal(s.rover.lastObservation.odometry.x,s.rover.estimatedX);
  assert.ok(s.lastFeedback.newKnowledge>0);assert.ok(s.stats.energySpentWh>(3.6+2.2+26)*STEP_SECONDS/3600);
  const obs=s.rover.lastObservation;
  assert.ok(curiosityReward(obs,obs,s.lastFeedback).components.curiosity>0);
  step(s);assert.equal(s.lastFeedback.newKnowledge,0);
  assert.equal(curiosityReward(obs,obs,s.lastFeedback).components.curiosity,0);
});
test('controller cannot modify retained observations through reward feedback',()=>{
  const s=fixture();s.tick=2;
  s.controller.observe=({after})=>{after.exploration.uniqueObserved=-999;after.lidar[0].distance=-999;};
  step(s);
  assert.ok(s.rover.lastObservation.exploration.uniqueObserved>0);
  assert.ok(s.rover.lastObservation.lidar[0].distance>=0);
  assert.ok(s.rover.lastLidar[0].distance>=0);
});
test('low energy and sleep cannot collect new data or update weights, 70 percent still applies',()=>{
  const c=createCuriosityController({model:transferDepositModel(deposit)});
  const s=fixture();s.controller=c;s.tick=2;s.rover.batteryWh=.0001;
  step(s);assert.equal(s.rover.exploration.uniqueObserved,0);assert.equal(s.rover.scans,0);
  const state=structuredClone(s.rover.exploration),model=c.save(),position=[s.rover.x,s.rover.y];
  s.time=1400;for(let i=0;i<20;i++)step(s);
  assert.deepEqual(c.save(),model);assert.deepEqual(s.rover.exploration,state);
  assert.deepEqual([s.rover.x,s.rover.y],position);
  s.rover.batteryWh=s.rover.capacityWh*.69;step(s);assert.equal(s.rover.mode,'HIBERNATING');
  s.rover.batteryWh=s.rover.capacityWh*.7;s.rover.bodyTempC=-20;step(s);assert.equal(s.rover.mode,'ACTIVE');
});
test('curiosity transfer is explicit and compatible actions start with zero new connections',()=>{
  const model=transferDepositModel(deposit),s=fixture(),obs=sampleSensors(s.world,s.rover,s.time);
  assert.equal(encodeCuriosityObservation(obs).length,49);
  for(let j=0;j<32;j++)assert.ok(model.network.w1.slice(j*49+35,j*49+49).every(v=>v===0));
  const a=createDepositController({model:deposit,learning:false}),b=createCuriosityController({model,learning:false});
  assert.deepEqual(a.act(obs),b.act(obs));assert.deepEqual(a.info().qValues,b.info().qValues);
  assert.throws(()=>createCuriosityController({model:deposit}));assert.throws(()=>createDepositController({model}));
  assert.deepEqual(createCuriosityController({model:JSON.parse(JSON.stringify(b.save()))}).save(),b.save());
  s.rover.memory.cells.clear();assert.deepEqual(b.save(),model);
});
test('curiosity really changes weights reproducibly without scripted frontier steering',()=>{
  const model=transferDepositModel(deposit),a=createCuriosityController({model,seed:57}),b=createCuriosityController({model,seed:57});
  const sa=fixture(),sb=fixture();sa.controller=a;sb.controller=b;
  for(let i=0;i<120;i++){step(sa);step(sb);}
  assert.ok(a.info().updates>model.updates);assert.notDeepEqual(a.save().network,model.network);
  assert.deepEqual(a.save(),b.save());assert.deepEqual(sa.rover.exploration,sb.rover.exploration);
});
test('historical curiosity artifacts preserve protocol, model and untouched test seeds',async()=>{
  const all=[...CURIOSITY_PROTOCOL.trainSeeds,...CURIOSITY_PROTOCOL.validationSeeds,...CURIOSITY_PROTOCOL.testSeeds];
  assert.equal(new Set(all).size,all.length);
  const model=JSON.parse(await readFile(new URL('models/curiosity-dqn-v1.json',root),'utf8'));
  const report=JSON.parse(await readFile(new URL('experiments/curiosity-benchmark.json',root),'utf8'));
  const sha=s=>createHash('sha256').update(s).digest('hex');
  assert.equal(sha(JSON.stringify(model)),report.modelSha256);assert.deepEqual(report.protocol,CURIOSITY_PROTOCOL);
  assert.equal(report.runs.length,2);
  assert.equal(report.sourceRevision,'f3907e213c85175197f2194f6763391d649e7c95');
  for(const hash of Object.values(report.sourceHashes))assert.match(hash,/^[a-f0-9]{64}$/);
  for(const result of Object.values(report.test))assert.deepEqual(result.trials.map(t=>t.seed),CURIOSITY_PROTOCOL.testSeeds);
});
