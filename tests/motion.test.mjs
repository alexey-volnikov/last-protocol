import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSimulation,step} from '../src/sim/engine.js';
import {sampleSensors} from '../src/sim/sensors.js';
import {createCuriosityController} from '../src/agent/curiosity-controller.js';
import {createMotionMemory,createMotionController,transferCuriosityModel,MOTION_BYTES,MOTION_WINDOW} from '../src/agent/motion-controller.js';
import {MOTION_PROTOCOL,runMotionCase,motionPasses,compareMotion} from '../src/lab/motion-experiment.js';
import {summarizeOnline} from '../src/lab/online-audit.js';
const root=new URL('../',import.meta.url),original=JSON.parse(await readFile(new URL('models/curiosity-dqn-v1.json',root),'utf8')),model=transferCuriosityModel(original);
const fixture=controller=>createSimulation(42,{controller,preset:'deposit-lab-v1',curiosity:true});
test('motion memory distinguishes stationary turning from translation using observed odometry',()=>{
  const turn=createMotionMemory(),move=createMotionMemory(),before={odometry:{x:0,y:0,heading:Math.PI-.1}};
  for(let i=0;i<32;i++){
    turn.record(before,{odometry:{x:0,y:0,heading:-Math.PI+.18},scanFresh:true},{},1);
    move.record(before,{odometry:{x:.09,y:0,heading:Math.PI-.1},scanFresh:true},{newKnowledge:2},0);
  }
  assert.equal(turn.summary().path,0);assert.ok(Math.abs(turn.summary().rotation-8.96)<1e-5);
  assert.equal(turn.features()[4],1);assert.equal(turn.features()[5],0);
  assert.ok(move.features()[2]>.99);assert.equal(move.features()[4],0);assert.equal(move.features()[5],1);
  assert.notDeepEqual(turn.features(),move.features());assert.equal(MOTION_BYTES,1024);
});
test('motion window evicts old outcomes and reset clears it without touching other memory',()=>{
  const memory=createMotionMemory(),obs={odometry:{x:2,y:3,heading:0}};
  memory.record(obs,{...obs,contact:true},{newKnowledge:24,energySpentWh:.1},1);
  for(let i=0;i<1000;i++)memory.record(obs,obs,{},3);
  assert.equal(memory.summary().count,MOTION_WINDOW);assert.equal(memory.summary().contacts,0);assert.equal(memory.summary().newData,0);
  assert.equal(memory.features()[6],1);memory.clear();assert.ok(memory.features().every(x=>x===0));
});
test('explicit motion transfer preserves Q values and rejects models of other experiments',()=>{
  const old=createCuriosityController({model:original,learning:false}),next=createMotionController({model,learning:false}),s=fixture(next);
  const obs=sampleSensors(s.world,s.rover,0),before=structuredClone(obs);
  assert.deepEqual(old.act(obs),next.act(obs));assert.deepEqual(old.info().qValues,next.info().qValues);assert.deepEqual(obs,before);
  assert.throws(()=>createMotionController({model:original}),/Несовместимый/);
  assert.throws(()=>createCuriosityController({model}),/Несовместимый/);
});
test('short working memory updates with learning disabled, and sleep performs no processing',()=>{
  const c=createMotionController({model,learning:false}),s=fixture(c),saved=c.save();
  step(s);assert.equal(c.info().motion.count,1);assert.deepEqual(c.save(),saved);
  s.rover.batteryWh=.0001;step(s);assert.equal(s.rover.mode,'HIBERNATING');
  const memory=c.info().motion;for(let i=0;i<20;i++)step(s);assert.deepEqual(c.info().motion,memory);
  c.newTrial();assert.equal(c.info().motion.count,0);assert.deepEqual(c.save(),saved);
});
test('motion reset clears the short context while retaining deferred failure and replay',()=>{
  const c=createMotionController({model}),s=fixture(c);s.rover.batteryWh=.0001;step(s);
  assert.equal(c.info().deferredFailure,true);assert.equal(c.info().motion.count,1);c.newTrial();
  assert.equal(c.info().deferredFailure,true);assert.equal(c.info().motion.count,0);step(fixture(c));
  assert.equal(c.info().replayTerminals,1);assert.equal(c.info().replaySize,2);
});
test('motion inputs acquire nonzero learned weights reproducibly, ablated links stay zero',()=>{
  function train(masked){const c=createMotionController({model,seed:101,masked}),s=fixture(c);for(let i=0;i<160;i++)step(s);return c;}
  const a=train(false),b=train(false),masked=train(true);
  assert.deepEqual(a.save(),b.save());assert.ok(a.info().updates>model.updates);
  const added=c=>c.save().network.w1.filter((v,i)=>i%61>=49);
  assert.ok(added(a).some(v=>v!==0));assert.ok(added(masked).every(v=>v===0));assert.ok(a.info().replaySize<=512);
});
test('motion experiment uses disjoint new map/learner splits and excludes unsafe promotion',()=>{
  const maps=[...MOTION_PROTOCOL.trainMaps,...MOTION_PROTOCOL.validation.maps,...MOTION_PROTOCOL.test.maps];
  assert.equal(new Set(maps).size,maps.length);assert.ok(maps.every(s=>s>=12001));
  assert.ok(MOTION_PROTOCOL.test.seeds.every(s=>!MOTION_PROTOCOL.validation.seeds.includes(s)));
  const baseline={badWindows:10,lifeVisited:20,lifeObserved:200,resetShutdowns:6,lifeShutdowns:2,resetCollisions:3,lifeCollisions:4};
  assert.equal(motionPasses({...baseline,badWindows:5},baseline,baseline),true);
  assert.equal(motionPasses({...baseline,badWindows:5,lifeVisited:19},baseline,baseline),false);
  const c=runMotionCase(model,14001,103,{steps:100,lifeSteps:100,resets:1});
  assert.ok(c.restarts[0].motion.count<=32);assert.equal(c.deferredDropped,0);
});
test('motion report preserves ablation, selection before held-out testing and exact source/model hashes',async()=>{
  const report=JSON.parse(await readFile(new URL('experiments/motion-benchmark.json',root),'utf8'));
  const sha=s=>createHash('sha256').update(s).digest('hex');
  assert.deepEqual(report.protocol,MOTION_PROTOCOL);assert.equal(report.originSha256,sha(JSON.stringify(original)));
  assert.equal(report.initialSha256,sha(JSON.stringify(model)));assert.equal(report.training.length,4);
  for(const [name,hash] of Object.entries(report.sourceHashes))assert.equal(sha((await readFile(new URL(name,root),'utf8')).replace(/\r\n/g,'\n')),hash,name);
  for(const group of ['context','masked']){
    const winner=MOTION_PROTOCOL.trainingSeeds.map(s=>`${group}-${s}`).sort((a,b)=>compareMotion(report.validation[a].summary,report.validation[b].summary))[0];
    assert.equal(report.selection[group],winner);
    const selected=JSON.parse(await readFile(new URL(`models/motion-${group}-dqn-v1.json`,root),'utf8'));
    createMotionController({model:selected});
    assert.equal(report.test[group].modelSha256,sha(JSON.stringify(selected)));
    assert.equal(report.training.find(t=>t.name===winner).modelSha256,report.test[group].modelSha256);
    if(group==='masked')assert.ok(selected.network.w1.filter((v,i)=>i%61>=49).every(v=>v===0));
  }
  for(const [phase,set] of [['validation',MOTION_PROTOCOL.validation],['test',MOTION_PROTOCOL.test]]){
    for(const result of Object.values(report[phase])){
      assert.deepEqual(result.cases.map(c=>[c.map,c.seed]),set.maps.flatMap(map=>set.seeds.map(seed=>[map,seed])));
      assert.deepEqual(result.summary,summarizeOnline(result.cases));
      for(const c of result.cases){
        assert.equal(c.learning,true);assert.equal(c.restarts.length,6);
        for(const run of [...c.restarts,c.life]){assert.ok(run.replaySize<=512);assert.ok(run.motion.count<=32);assert.equal(run.motion.bytes,1024);}
      }
    }
  }
  assert.equal(report.promotion.validation,motionPasses(report.validation[report.selection.context].summary,report.validation[report.selection.masked].summary,report.validation.initial.summary));
  assert.equal(report.promotion.test,motionPasses(report.test.context.summary,report.test.masked.summary,report.test.initial.summary));
  assert.equal(report.promotion.accepted,report.promotion.validation&&report.promotion.test);
});
