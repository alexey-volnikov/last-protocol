import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSimulation,step} from '../src/sim/engine.js';
import {sampleSensors} from '../src/sim/sensors.js';
import {createCuriosityController} from '../src/agent/curiosity-controller.js';
import {auditController,ONLINE_PROTOCOL,ONLINE_VARIANTS,summarizeOnline} from '../src/lab/online-audit.js';
import {runMotionCase} from '../src/lab/motion-experiment.js';
const root=new URL('../',import.meta.url),model=JSON.parse(await readFile(new URL('models/curiosity-dqn-v1.json',root),'utf8'));
const fixture=controller=>createSimulation(4233,{preset:'deposit-lab-v1',curiosity:true,controller});
test('LAB reset retains a deferred failure without performing unpowered learning',()=>{
  const controller=createCuriosityController({model}),s=fixture(controller);
  s.rover.batteryWh=.0001;step(s);
  assert.equal(s.rover.mode,'HIBERNATING');assert.equal(controller.info().deferredFailure,true);
  assert.equal(controller.info().replayTerminals,0);
  const saved=controller.save();
  for(let i=0;i<10;i++)step(s);
  controller.newTrial();
  assert.equal(controller.info().deferredFailure,true);assert.deepEqual(controller.save(),saved);
  const next=fixture(controller);step(next);
  assert.equal(controller.info().deferredFailure,false);assert.equal(controller.info().replayTerminals,1);
  assert.equal(controller.info().replaySize,2);
});
test('audit reproduces the legacy reset dropping a failure for a controlled comparison',()=>{
  const c=auditController(model,'legacy'),s=fixture(c);s.rover.batteryWh=.0001;step(s);
  assert.equal(c.info().deferredFailure,true);c.newTrial();
  assert.equal(c.info().deferredFailure,false);step(fixture(c));assert.equal(c.info().replayTerminals,0);
});
test('turning learning off preserves the deferred transition until powered learning resumes',()=>{
  const c=createCuriosityController({model}),s=fixture(c);s.rover.batteryWh=.0001;step(s);
  c.setLearning(false);c.newTrial();const saved=c.save();
  const next=fixture(c);step(next);assert.equal(c.info().deferredFailure,true);assert.deepEqual(c.save(),saved);
  c.setLearning(true);step(next);assert.equal(c.info().deferredFailure,false);assert.equal(c.info().replayTerminals,1);
});
test('bounded historical replay can keep an older failure after recent FIFO has replaced it',()=>{
  function fill(variant){
    const c=auditController(model,variant,71),s=fixture(c),obs=sampleSensors(s.world,s.rover,s.time);
    c.act(obs);c.observe({before:obs,after:obs,feedback:{shutdown:true}});c.newTrial();
    for(let i=0;i<580;i++){c.act(obs);c.observe({before:obs,after:obs,feedback:{}});}
    return c;
  }
  const recent=fill('pending'),mixed=fill('history');
  assert.equal(recent.info().replayTerminals,0);assert.equal(mixed.info().replayTerminals,1);
  assert.equal(recent.info().replaySize,512);assert.equal(mixed.info().replaySize,512);assert.equal(mixed.info().historySize,256);
});
test('a smaller learning step still changes weights deterministically with the same memory limit',()=>{
  const a=auditController(model,'slow',73),b=auditController(model,'slow',73),sa=fixture(a),sb=fixture(b);
  for(let i=0;i<200;i++){step(sa);step(sb);}
  assert.ok(a.info().updates>model.updates);assert.notDeepEqual(a.save().network,model.network);
  assert.deepEqual(a.save(),b.save());assert.ok(a.info().replaySize<=512);
});
test('online validation and held-out maps and learner seeds are disjoint',()=>{
  const maps=[...ONLINE_PROTOCOL.diagnostic.maps,...ONLINE_PROTOCOL.validation.maps,...ONLINE_PROTOCOL.test.maps];
  assert.equal(new Set(maps).size,maps.length);
  assert.ok(ONLINE_PROTOCOL.test.seeds.every(s=>!ONLINE_PROTOCOL.validation.seeds.includes(s)));
});
test('reported map 4233 reproduces legacy spinning; bounded historical replay avoids that six-reset regression',()=>{
  const legacyCase=variant=>runMotionCase(model,4233,71,{lifeSteps:0,simulationOptions:{lidarMode:'sampled-v1'},
    createController:options=>auditController(options.model,variant,options.seed,options.learning)});
  const old=legacyCase('legacy'),candidate=legacyCase('history');
  assert.equal(old.restarts[4].early.spin,true);assert.ok(old.restarts[4].early.distance<1);
  assert.ok(candidate.restarts.every(r=>!r.early.spin&&r.early.distance>1));
  assert.equal(candidate.deferredDropped,0);assert.ok(old.deferredDropped>0);
  assert.ok(candidate.restarts.every(r=>r.replaySize<=512));
});
test('online audit preserves the chosen validation variant, held-out cases and source provenance',async()=>{
  const report=JSON.parse(await readFile(new URL('experiments/online-audit.json',root),'utf8'));
  const diagnostic=JSON.parse(await readFile(new URL('experiments/online-audit-diagnosis.json',root),'utf8'));
  const validation=report.validation;
  const sha=s=>createHash('sha256').update(s).digest('hex');
  assert.equal(report.selected,validation.selected);assert.equal(report.selected,'history');
  assert.deepEqual(report.protocol,ONLINE_PROTOCOL);assert.deepEqual(report.settings,ONLINE_VARIANTS);
  assert.equal(report.modelSha256,sha(JSON.stringify(model)));
  assert.equal(Object.keys(validation.results).length,7);
  assert.equal(report.sourceRevision,'dee8a83cfca0e9f3683873c1dd1fc1dace5577dc');
  for(const hash of Object.values(report.sourceHashes))assert.match(hash,/^[a-f0-9]{64}$/);
  const expected=ONLINE_PROTOCOL.test.maps.flatMap(map=>ONLINE_PROTOCOL.test.seeds.map(seed=>[map,seed]));
  for(const [variant,result] of Object.entries(report.results)){
    assert.deepEqual(result.cases.map(c=>[c.map,c.seed]),expected);
    assert.deepEqual(result.summary,summarizeOnline(result.cases));
    for(const c of result.cases){
      assert.equal(c.restarts.length,6);
      if(variant!=='legacy')assert.equal(c.deferredDropped,0);
      for(const run of [...c.restarts,c.life])assert.ok(run.replaySize<=512);
    }
  }
  assert.equal(diagnostic.results.legacy.cases[0].map,4233);
  assert.equal(diagnostic.results.legacy.cases[0].restarts[4].early.spin,true);
  assert.equal(createCuriosityController({model}).info().training.history,false);
});
