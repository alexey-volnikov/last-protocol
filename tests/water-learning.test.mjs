import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,step,STEP_SECONDS} from '../src/sim/engine.js';
import {sampleSensors} from '../src/sim/sensors.js';
import {remember} from '../src/sim/memory.js';
import {createNeuralController,encodeObservation,rewardFor,REPLAY_CAPACITY} from '../src/agent/controller.js';
import {runTrial,PROTOCOL} from '../src/lab/experiment.js';

function fixture(action={type:'wait'}){
  const sim=createSimulation(42,{controller:{id:'test',act:()=>action}});
  for(const cell of sim.world.cells)Object.assign(cell,{ice:false,rock:false,crater:0,rim:0});
  sim.rover.heading=0;
  return sim;
}
const cell=(sim,x,y)=>sim.world.cells[y*sim.world.w+x];

test('spectrometer reveals only measured, unobstructed surface ice within range',()=>{
  const far=fixture();cell(far,20,22).ice=true;
  assert.deepEqual(sampleSensors(far.world,far.rover,far.time).waterReadings,[]);
  const near=fixture();cell(near,16,22).ice=true;
  assert.ok(sampleSensors(near.world,near.rover,near.time).waterReadings.length>0);
  const blocked=fixture();cell(blocked,16,22).ice=true;
  for(let y=0;y<blocked.world.h;y++)cell(blocked,15,y).rock=true;
  assert.deepEqual(sampleSensors(blocked.world,blocked.rover,blocked.time).waterReadings,[]);
});

test('changing hidden ice does not change observations or provide target coordinates',()=>{
  const a=fixture(),b=fixture();
  cell(b,50,30).ice=true;
  const oa=sampleSensors(a.world,a.rover,a.time),ob=sampleSensors(b.world,b.rover,b.time);
  assert.deepEqual(oa,ob);
  assert.equal('world' in ob,false);assert.equal('seed' in ob,false);
  assert.equal('cells' in ob,false);assert.equal('target' in ob,false);
  assert.equal(encodeObservation(ob).length,29);
});

test('spectral records vanish on map eviction; novelty is not rewarded twice',()=>{
  const sim=fixture();sim.rover.memory.capacityBytes=384;
  remember(sim.rover.memory,15,22,{ice:true,waterPosition:{x:15.5,y:22.5}});
  remember(sim.rover.memory,16,22,{rock:false});
  assert.deepEqual(sampleSensors(sim.world,sim.rover,sim.time,{scan:false}).waterReadings,[]);
  const unique=sim.rover.memory.uniqueSeen;
  remember(sim.rover.memory,15,22,{rock:false});
  assert.equal(sim.rover.memory.uniqueSeen,unique);
});

test('finding water requires powered contact sample; moving or scanning is insufficient',()=>{
  const waiting=fixture();cell(waiting,14,22).ice=true;step(waiting);
  assert.equal(waiting.water.found,false);
  const sampling=fixture({type:'sample'});cell(sampling,14,22).ice=true;step(sampling);
  assert.equal(sampling.water.found,true);
  assert.equal(sampling.water.sample.method,'LAB contact sample');
  assert.equal(sampling.lastFeedback.newWater,true);
  assert.ok(sampling.rover.batteryWh<waiting.rover.batteryWh);
  step(sampling);assert.equal(sampling.lastFeedback.newWater,false);
  const empty=fixture({type:'sample'});cell(empty,14,22).ice=true;empty.rover.batteryWh=0;step(empty);
  assert.equal(empty.water.found,false);assert.equal(empty.rover.mode,'HIBERNATING');
  const insufficient=fixture({type:'sample'});cell(insufficient,14,22).ice=true;insufficient.rover.batteryWh=.0001;step(insufficient);
  assert.equal(insufficient.water.found,false);
});

test('controller receives isolated copies; collision physics does not write into its brain',()=>{
  const sim=fixture({type:'move'});sim.rover.x=14.99;sim.tick=2;cell(sim,15,22).rock=true;
  const before=structuredClone(sim.rover.brain);
  sim.controller.act=obs=>{obs.odometry.x=-500;obs.lidar[0].distance=-500;return {type:'move'};};
  step(sim);
  assert.equal(sim.rover.contact,true);
  assert.deepEqual(sim.rover.brain,before);
  assert.notEqual(sim.rover.estimatedX,-500);
  assert.ok(sim.rover.lastLidar[0].distance>=0);
});

test('bounded real learning changes weights reproducibly and preserves them when reloaded',()=>{
  const a=createNeuralController({seed:2718}),b=createNeuralController({seed:2718});
  const initial=a.save();
  runTrial(102,a,600);runTrial(102,b,600);
  assert.ok(a.info().updates>0);assert.ok(a.info().replaySize<=REPLAY_CAPACITY);
  assert.notDeepEqual(a.save().network,initial.network);
  assert.deepEqual(a.save(),b.save());
  const restored=createNeuralController({model:JSON.parse(JSON.stringify(a.save())),learning:false});
  const frozen=createNeuralController({model:a.save(),learning:false});
  assert.deepEqual(runTrial(103,restored,200),runTrial(103,frozen,200));
  assert.throws(()=>createNeuralController({model:{...a.save(),schema_version:99}}));
  const invalid=a.save();invalid.network.w1[0]=Infinity;
  assert.throws(()=>createNeuralController({model:invalid}));
});

test('no controller decisions or weight updates while unpowered; physical 0/70 rule remains',()=>{
  const controller=createNeuralController(),sim=createSimulation(42,{controller});
  for(let i=0;i<20;i++)step(sim);
  sim.rover.batteryWh=0;sim.time=1400;step(sim);
  const saved=controller.save();
  for(let i=0;i<30;i++)step(sim);
  assert.deepEqual(controller.save(),saved);
  assert.equal(sim.rover.batteryWh,0);
  assert.equal(sim.rover.mode,'HIBERNATING');
});

test('probe rewards cannot be farmed; physical step and actuator bounds are enforced',()=>{
  const sim=fixture({type:'turn',amount:100});step(sim);
  assert.equal(sim.rover.heading,.28);
  assert.throws(()=>step(sim,STEP_SECONDS*2));
  const obs=sampleSensors(sim.world,sim.rover,sim.time);
  assert.ok(rewardFor(obs,obs,{sampleAttempt:true,newWater:false}).total<0);
  assert.ok(rewardFor(obs,obs,{newCells:0}).total<0);
});

test('training, model selection and final test maps are disjoint',()=>{
  const all=[...PROTOCOL.trainSeeds,...PROTOCOL.validationSeeds,...PROTOCOL.testSeeds];
  assert.equal(new Set(all).size,all.length);
});
