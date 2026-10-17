import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {QNetwork} from '../src/agent/network.js';
import {createQController} from '../src/agent/controller.js';
import {createMotionController} from '../src/agent/motion-controller.js';
import {createSequentialController,transferMotionModel} from '../src/agent/sequential-controller.js';
import {createSimulation,step} from '../src/sim/engine.js';
import {SEQUENTIAL_PROTOCOL,compareSequential,sequentialPasses,sequentialFactory} from '../src/lab/sequential-experiment.js';
import {runMotionCase} from '../src/lab/motion-experiment.js';
import {summarizeOnline} from '../src/lab/online-audit.js';
const root=new URL('../',import.meta.url),origin=JSON.parse(await readFile(new URL('models/motion-context-dqn-v1.json',root),'utf8')),model=transferMotionModel(origin);
const fixture=c=>createSimulation(4295,{controller:c,preset:'deposit-lab-v1',curiosity:true});
test('TD target uses the observation at the next actual decision, not an unreachable after-scan state',()=>{
  const net=new QNetwork(1,32,5,()=>.5);net.w1[0]=1;net.w2[0]=1;
  const train=QNetwork.prototype.train,targets=[];
  QNetwork.prototype.train=function(x,a,target){targets.push(target);};
  try{
    const run=decisionNext=>{
      targets.length=0;
      const c=createQController({model:{schema_version:99,policy:'fixture',updates:0,network:net.save()},epsilon:0},
        {id:'fixture',schema:99,inputs:1,encode:obs=>Float32Array.of(obs.marker),reward:()=>({total:0,components:{}}),terminal:()=>false,training:{decisionNext}});
      for(let i=0;i<17;i++){c.act({marker:0});c.observe({before:{marker:0},after:{marker:100},feedback:{}});}
      return [...targets];
    };
    assert.ok(run(false).every(t=>t>.98));
    const actual=run(true);assert.ok(actual.length>=8);assert.ok(actual.every(t=>t===0));
  }finally{QNetwork.prototype.train=train;}
});
test('nonterminal transition waits for the real next decision; LAB truncation never bootstraps into a new world',()=>{
  const c=createSequentialController({model}),s=fixture(c);step(s);
  assert.equal(c.info().replaySize,0);assert.equal(c.info().awaitingDecision,true);
  step(s);assert.equal(c.info().replaySize,1);c.newTrial();
  assert.equal(c.info().discardedTruncations,1);assert.equal(c.info().awaitingDecision,false);
  step(fixture(c));assert.equal(c.info().replaySize,1);
});
test('terminal power failure survives LAB reset and is learned once only after available power',()=>{
  const c=createSequentialController({model}),s=fixture(c);s.rover.batteryWh=.0001;step(s);
  assert.equal(c.info().deferredFailure,true);const saved=c.save();
  for(let i=0;i<20;i++)step(s);assert.deepEqual(c.save(),saved);c.newTrial();
  assert.equal(c.info().deferredFailure,true);step(fixture(c));assert.equal(c.info().replaySize,1);assert.equal(c.info().replayTerminals,1);
  assert.equal(c.info().deferredFailure,false);
});
test('switching learning off retains a completed pending decision without using a later observation as its next state',()=>{
  const c=createSequentialController({model}),s=fixture(c);step(s);c.setLearning(false);step(s);
  assert.equal(c.info().replaySize,0);const saved=c.save();step(s);assert.deepEqual(c.save(),saved);
  c.setLearning(true);step(s);assert.equal(c.info().replaySize,1);assert.equal(c.info().awaitingDecision,true);
});
test('explicit sequential transfer preserves frozen decisions; live weight changes remain deterministic',()=>{
  const old=createMotionController({model:origin,learning:false}),next=createSequentialController({model,learning:false}),a=fixture(old),b=fixture(next);
  for(let i=0;i<100;i++){step(a);step(b);}
  assert.equal(a.rover.x,b.rover.x);assert.equal(a.rover.heading,b.rover.heading);assert.deepEqual(old.info().qValues,next.info().qValues);
  assert.throws(()=>createSequentialController({model:origin}),/Несовместимый/);
  const p=createSequentialController({model,seed:111}),q=createSequentialController({model,seed:111}),sp=fixture(p),sq=fixture(q);
  for(let i=0;i<200;i++){step(sp);step(sq);}
  assert.deepEqual(p.save(),q.save());assert.notDeepEqual(p.save().network,model.network);assert.ok(p.info().replaySize<=512);
});
test('sequential protocol keeps new train/validation/test splits separate and does not hide spin as waiting',()=>{
  const p=SEQUENTIAL_PROTOCOL,maps=[...p.trainMaps,...p.validation.maps,...p.test.maps];
  assert.equal(new Set(maps).size,maps.length);assert.ok(maps.every(m=>m>=15001));assert.ok(p.test.seeds.every(s=>!p.validation.seeds.includes(s)));
  const base={spinWindows:20,badWindows:30,lifeVisited:50,lifeObserved:500,resetShutdowns:6,lifeShutdowns:3,resetCollisions:0,lifeCollisions:4};
  assert.equal(sequentialPasses({...base,spinWindows:10,badWindows:20},base),true);
  assert.equal(sequentialPasses({...base,spinWindows:10,badWindows:40},base),false);
  assert.equal(sequentialPasses({...base,spinWindows:10,badWindows:20,lifeVisited:40},base),false);
});
test('sequential report retains matched controls, selection, all held-out pairs and source/model checksums',async()=>{
  const r=JSON.parse(await readFile(new URL('experiments/sequential-benchmark.json',root),'utf8')),sha=s=>createHash('sha256').update(s).digest('hex');
  assert.deepEqual(r.protocol,SEQUENTIAL_PROTOCOL);assert.equal(r.originSha256,sha(JSON.stringify(origin)));assert.equal(r.initialSha256,sha(JSON.stringify(model)));
  assert.equal(r.training.length,4);
  // Исторический опыт закреплён за ревизией до исправления геометрии лидара.
  assert.equal(r.sourceRevision,'8b4a1ca3fd3f87f29d5e081231a339096624d00f');
  for(const hash of Object.values(r.sourceHashes))assert.match(hash,/^[a-f0-9]{64}$/);
  for(const group of ['after','decision']){
    const selected=r.protocol.trainingSeeds.map(s=>`${group}-${s}`).sort((a,b)=>compareSequential(r.validation[a].summary,r.validation[b].summary))[0];
    assert.equal(r.selection[group],selected);
    const saved=JSON.parse(await readFile(new URL(`models/motion-${group}-dqn-v2.json`,root),'utf8'));createSequentialController({model:saved});
    assert.equal(r.test[group].modelSha256,sha(JSON.stringify(saved)));assert.equal(r.training.find(t=>t.name===selected).modelSha256,r.test[group].modelSha256);
  }
  for(const [phase,set] of [['validation',r.protocol.validation],['test',r.protocol.test]])for(const result of Object.values(r[phase])){
    assert.deepEqual(result.cases.map(c=>[c.map,c.seed]),set.maps.flatMap(map=>set.seeds.map(seed=>[map,seed])));
    assert.deepEqual(result.summary,summarizeOnline(result.cases));
    for(const c of result.cases){assert.equal(c.learning,true);assert.equal(c.deferredDropped,0);for(const run of [...c.restarts,c.life])assert.ok(run.replaySize<=512);}
  }
  assert.equal(r.promotion.validation,sequentialPasses(r.validation[r.selection.decision].summary,r.validation[r.selection.after].summary,r.validation.initial.summary));
  assert.equal(r.promotion.test,sequentialPasses(r.test.decision.summary,r.test.after.summary,r.test.initial.summary));
  assert.equal(r.promotion.accepted,r.promotion.validation&&r.promotion.test);
});
test('reported map 4295 starts with actual exploration instead of the packaged stationary-turn regression',async()=>{
  const selected=JSON.parse(await readFile(new URL('models/motion-decision-dqn-v2.json',root),'utf8'));
  const before=runMotionCase(model,4295,71,{steps:300,resets:1,lifeSteps:0,createController:sequentialFactory('initial'),simulationOptions:{lidarMode:'sampled-v1'}});
  const after=runMotionCase(selected,4295,71,{steps:300,resets:1,lifeSteps:0,createController:sequentialFactory('decision'),simulationOptions:{lidarMode:'sampled-v1'}});
  assert.equal(before.restarts[0].early.spin,true);assert.ok(before.restarts[0].distance<1);
  assert.equal(after.restarts[0].early.spin,false);assert.ok(after.restarts[0].distance>3);
  const diagnostic=JSON.parse(await readFile(new URL('experiments/sequential-known.json',root),'utf8'));
  assert.equal(diagnostic.kind,'diagnostic-only-not-model-selection');
  assert.equal(diagnostic.cases.decision[1].restarts[0].early.distance,after.restarts[0].distance);
});
