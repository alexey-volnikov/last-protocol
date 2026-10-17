import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSimulation,step,status} from '../src/sim/engine.js';
import {sampleSensors} from '../src/sim/sensors.js';
import {recallCapsule} from '../src/sim/capsule-memory.js';
import {remember,OBS_BYTES} from '../src/sim/memory.js';
import {createSequentialController} from '../src/agent/sequential-controller.js';
import {createCapsuleController,transferSequentialModel,capsuleReward,capsuleFeatures} from '../src/agent/capsule-controller.js';
import {CAPSULE_PROTOCOL,capsulePasses,compareCapsule,summarizeCapsule,capsuleFactory} from '../src/lab/capsule-experiment.js';
const root=new URL('../',import.meta.url),origin=JSON.parse(await readFile(new URL('models/motion-decision-dqn-v2.json',root),'utf8')),model=transferSequentialModel(origin);
const fixture=(controller=null)=>createSimulation(42,{preset:'deposit-lab-v1',curiosity:true,capsuleMemory:true,controller});
function position(s,x,y){Object.assign(s.rover,{x,y,estimatedX:x,estimatedY:y});}
function clearTerrain(s){for(const c of s.world.cells){c.rock=false;c.ice=false;c.iceFraction=0;}}
test('capsule location is an ordinary evictable map record; skills and replay do not share its budget',()=>{
  const c=createCapsuleController({model,learning:false}),s=fixture(c),r=s.rover,saved=c.save();
  assert.equal(r.memory.cells.size,1);assert.equal(recallCapsule(r.memory,s.time).known,true);assert.deepEqual(r.mission,{});
  const copied=sampleSensors(s.world,r,s.time,{scan:false}).capsule;copied.position.x+=999;
  assert.equal(recallCapsule(r.memory,s.time).position.x,s.world.home.x);
  r.memory.capacityBytes=OBS_BYTES*2;remember(r.memory,1,1,{});remember(r.memory,2,2,{});
  assert.equal(r.memory.cells.size,2);assert.equal(recallCapsule(r.memory,s.time).known,false);assert.deepEqual(c.save(),saved);
  const legacy=createSimulation(42);assert.ok(legacy.rover.mission.rememberedHome);assert.equal('capsule' in status(legacy),false);
});
test('only record loss is penalized once; remaining unknown or moving out of beacon range is not',()=>{
  const s=fixture({act:()=>({type:'wait'})}),r=s.rover;clearTerrain(s);r.memory.capacityBytes=OBS_BYTES*3;
  position(s,s.world.home.x+12,s.world.home.y);s.tick=2;step(s);
  assert.equal(s.lastFeedback.capsuleLost,true);assert.equal(s.capsuleStats.losses,1);assert.equal(status(s).capsule.known,false);
  const first=capsuleReward({},r.lastObservation,s.lastFeedback);assert.equal(first.components.capsuleLoss,-2);
  step(s);assert.equal(s.lastFeedback.capsuleLost,false);assert.equal(s.capsuleStats.losses,1);
  assert.equal(capsuleReward({},r.lastObservation,s.lastFeedback).components.capsuleLoss,0);
  const retained=fixture({act:()=>({type:'wait'})});clearTerrain(retained);position(retained,retained.world.home.x+12,retained.world.home.y);step(retained);
  assert.equal(retained.rover.lastObservation.homeBeacon,false);assert.equal(retained.rover.lastObservation.capsule.known,true);assert.equal(retained.lastFeedback.capsuleLost,false);
});
test('paid unobstructed capsule measurement restores an estimated position, without a recovery bonus',()=>{
  const s=fixture({act:()=>({type:'wait'})}),r=s.rover;clearTerrain(s);r.memory.cells.clear();
  position(s,s.world.home.x+4,s.world.home.y);r.estimatedX+=.7;r.estimatedY-=.3;
  const cached=sampleSensors(s.world,r,s.time,{scan:false});assert.equal(cached.homeBeacon,true);assert.equal(cached.capsule.known,false);
  const o=sampleSensors(s.world,r,s.time,{scan:true});assert.equal(o.capsule.known,true);
  assert.ok(Math.abs(o.capsule.position.x-(s.world.home.x+.7))<1e-10);assert.ok(Math.abs(o.capsule.position.y-(s.world.home.y-.3))<1e-10);
  assert.equal(capsuleReward(cached,o,{capsuleLost:false}).components.capsuleLoss,0);
  assert.equal(r.memory.cells.size*OBS_BYTES<=r.memory.capacityBytes,true);
  r.memory.cells.clear();s.tick=2;step(s);assert.equal(s.capsuleStats.reacquired,1);assert.equal(s.lastFeedback.capsuleLost,false);
});
test('rocks, range and unavailable scan power cannot secretly restore the capsule record',()=>{
  const s=fixture({act:()=>({type:'wait'})}),r=s.rover;clearTerrain(s);r.memory.cells.clear();position(s,s.world.home.x+4,s.world.home.y);
  const wallX=Math.floor(s.world.home.x+2);for(let y=0;y<s.world.h;y++)s.world.cells[y*s.world.w+wallX].rock=true;
  assert.equal(sampleSensors(s.world,r,s.time).capsule.known,false); // Bearing can exist through this simplified radio channel.
  clearTerrain(s);r.capsuleSensorEnabled=false;assert.equal(sampleSensors(s.world,r,s.time).capsule.known,false);r.capsuleSensorEnabled=true;
  position(s,s.world.home.x+8,s.world.home.y);
  const far=sampleSensors(s.world,r,s.time);assert.equal(far.homeBeacon,true);assert.equal(far.capsule.known,false);
  position(s,s.world.home.x+4,s.world.home.y);r.batteryWh=.0001;s.tick=2;step(s);
  assert.equal(r.mode,'HIBERNATING');assert.equal(r.lastObservation.scanFresh,false);assert.equal(recallCapsule(r.memory,s.time).known,false);
});
test('hidden coordinates cannot leak into capsule features after record loss and outside local signal range',()=>{
  const s=fixture();clearTerrain(s);s.rover.memory.cells.clear();position(s,10.5,10.5);
  const a=sampleSensors(s.world,s.rover,s.time,{scan:false});s.world.home={x:60.5,y:35.5};
  const b=sampleSensors(s.world,s.rover,s.time,{scan:false});assert.deepEqual(a,b);assert.deepEqual([...capsuleFeatures(a)],Array(8).fill(0));
  assert.equal('world' in a,false);assert.equal('rememberedHome' in a,false);assert.equal(a.capsule.position,null);
});
test('sleep preserves the record and weights with no repeated loss penalty or scans; restart still requires 70 percent',()=>{
  const c=createCapsuleController({model}),s=fixture(c),r=s.rover;s.time=448;r.mode='HIBERNATING';r.offReason='EMPTY';r.batteryWh=r.capacityWh*.69;
  const saved=c.save(),memory=structuredClone(r.memory);step(s);assert.equal(r.mode,'HIBERNATING');
  assert.deepEqual(c.save(),saved);assert.deepEqual(r.memory,memory);assert.equal(s.capsuleStats.losses,0);assert.equal(r.scans,0);
  for(let i=0;i<250&&r.mode==='HIBERNATING';i++)step(s);assert.equal(r.mode,'ACTIVE');assert.ok(r.batteryWh>=r.capacityWh*.7);
});
test('explicit 61 to 69 transfer preserves frozen decisions and rejects incompatible models',()=>{
  const a=createSequentialController({model:origin,learning:false}),b=createCapsuleController({model,learning:false});
  const sa=fixture(a),sb=fixture(b);for(let i=0;i<120;i++){step(sa);step(sb);}assert.deepEqual(a.info().qValues,b.info().qValues);assert.equal(sa.rover.x,sb.rover.x);
  for(let j=0;j<32;j++)assert.ok(model.network.w1.slice(j*69+61,j*69+69).every(w=>w===0));
  assert.throws(()=>createCapsuleController({model:origin}),/Несовместимый/);
});
test('capsule-aware online updates are real, bounded and deterministic; LAB reset clears context but preserves failure',()=>{
  const a=createCapsuleController({model,seed:137}),b=createCapsuleController({model,seed:137}),sa=fixture(a),sb=fixture(b);
  for(let i=0;i<240;i++){step(sa);step(sb);}assert.deepEqual(a.save(),b.save());assert.notDeepEqual(a.save().network,model.network);assert.ok(a.info().replaySize<=512);
  sa.rover.batteryWh=.0001;step(sa);assert.equal(a.info().deferredFailure,true);a.newTrial();assert.equal(a.info().deferredFailure,true);assert.equal(a.info().motion.count,0);
  step(fixture(a));assert.equal(a.info().deferredFailure,false);
});
test('capsule protocol separates map and learner sets and rejects knowledge preservation through stagnation',()=>{
  const p=CAPSULE_PROTOCOL,maps=[...p.trainMaps,...p.validation.maps,...p.test.maps];assert.equal(new Set(maps).size,maps.length);assert.ok(maps.every(m=>m>=21001));
  assert.ok(p.test.seeds.every(s=>!p.validation.seeds.includes(s)));assert.equal(capsuleFactory('control')({model}).info().capsuleLossPenalty,0);
  assert.throws(()=>createCapsuleController({model},-1),/штраф/);
  const base={capsuleLosses:10,badWindows:10,lifeVisited:100,lifeObserved:500,lateVisited:30,lateObserved:300,resetShutdowns:10,lifeShutdowns:4,resetCollisions:4,lifeCollisions:2};
  assert.equal(capsulePasses({...base,capsuleLosses:5},base),true);assert.equal(capsulePasses({...base,capsuleLosses:5,lifeVisited:80},base),false);
  assert.equal(capsulePasses({...base,capsuleLosses:5,badWindows:11},base),false);
});
test('capsule report retains matched training, selection before test, model and exact source hashes',async()=>{
  const r=JSON.parse(await readFile(new URL('experiments/capsule-benchmark.json',root),'utf8')),sha=s=>createHash('sha256').update(s).digest('hex');
  assert.deepEqual(r.protocol,CAPSULE_PROTOCOL);assert.equal(r.originSha256,sha(JSON.stringify(origin)));assert.equal(r.initialSha256,sha(JSON.stringify(model)));assert.equal(r.training.length,4);
  for(const [name,h] of Object.entries(r.sourceHashes))assert.equal(sha((await readFile(new URL(name,root),'utf8')).replace(/\r\n/g,'\n')),h,name);
  for(const group of ['control','penalty']){
    const selected=r.protocol.trainingSeeds.map(s=>`${group}-${s}`).sort((a,b)=>compareCapsule(r.validation[a].summary,r.validation[b].summary))[0];assert.equal(r.selection[group],selected);
    const saved=JSON.parse(await readFile(new URL(`models/capsule-${group}-dqn-v1.json`,root),'utf8'));createCapsuleController({model:saved});assert.equal(r.test[group].modelSha256,sha(JSON.stringify(saved)));
    assert.equal(r.training.find(t=>t.name===selected).modelSha256,r.test[group].modelSha256);
  }
  const bundled=JSON.parse(await readFile(new URL('models/capsule-memory-dqn-v1.json',root),'utf8'));
  assert.equal(r.selection.bundled,capsulePasses(r.validation[r.selection.penalty].summary,r.validation.initial.summary)?r.selection.penalty:'initial');
  assert.equal(sha(JSON.stringify(bundled)),r.selection.bundled==='initial'?r.initialSha256:r.test.penalty.modelSha256);
  for(const [phase,set] of [['validation',r.protocol.validation],['test',r.protocol.test]])for(const result of Object.values(r[phase])){
    assert.deepEqual(result.cases.map(c=>[c.map,c.seed]),set.maps.flatMap(map=>set.seeds.map(seed=>[map,seed])));assert.deepEqual(result.summary,summarizeCapsule(result.cases));
    for(const c of result.cases){assert.equal(c.learning,true);assert.equal(c.deferredDropped,0);for(const run of [...c.restarts,c.life])assert.ok(run.replaySize<=512);}
  }
  assert.equal(r.criteria.validation,capsulePasses(r.validation[r.selection.penalty].summary,r.validation[r.selection.control].summary,r.validation.initial.summary));
  assert.equal(r.criteria.test,capsulePasses(r.test.penalty.summary,r.test.control.summary,r.test.initial.summary));
  assert.equal(r.criteria.accepted,r.criteria.validation&&r.criteria.test);
});
