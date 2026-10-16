import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createWorld,DEPOSIT_PRESET} from '../src/sim/world.js';
import {createSimulation,step} from '../src/sim/engine.js';
import {sampleSensors} from '../src/sim/sensors.js';
import {createSurvey,registerProbe,SURVEY_CAPACITY} from '../src/sim/survey.js';
import {createDepositController,transferSurfaceModel,encodeDepositObservation,depositReward} from '../src/agent/deposit-controller.js';
import {createNeuralController} from '../src/agent/controller.js';
import {DEPOSIT_PROTOCOL} from '../src/lab/deposit-experiment.js';
const root=new URL('../',import.meta.url);
const model=JSON.parse(await readFile(new URL('models/water-dqn-v1.json',root),'utf8'));
function fixture(action={type:'wait'}){
  const sim=createSimulation(42,{preset:DEPOSIT_PRESET,controller:{id:'test',act:()=>action}});
  for(const c of sim.world.cells)Object.assign(c,{ice:false,iceFraction:0,rock:false,crater:0,rim:0});
  sim.rover.heading=0;
  return sim;
}
const cell=(s,x,y)=>s.world.cells[y*s.world.w+x];
function probe(survey,x,y,concentration=.8,time=0){return registerProbe(survey,{x,y,concentration,time},[Math.floor(x),Math.floor(y)]);}

test('deposit preset has deterministic distant source; original generator stays separate',()=>{
  for(let seed=1;seed<=20;seed++){
    const world=createWorld(seed,{preset:DEPOSIT_PRESET});
    assert.ok(Math.hypot(world.deposit.x-world.home.x,world.deposit.y-world.home.y)>=24);
    assert.ok(world.cells.some(c=>c.iceFraction>=.65));
    assert.ok(world.cells.every(c=>c.iceFraction>=0&&c.iceFraction<=.98));
    assert.deepEqual(world,createWorld(seed,{preset:DEPOSIT_PRESET}));
  }
  assert.equal(createWorld(42).deposit,undefined);
  assert.notDeepEqual(createWorld(42,{preset:DEPOSIT_PRESET}).deposit,createWorld(43,{preset:DEPOSIT_PRESET}).deposit);
});

test('hidden source metadata and remote composition cannot change agent observation',()=>{
  const a=fixture(),b=fixture();
  b.world.deposit={x:0,y:0,rx:100,ry:100};cell(b,0,0).iceFraction=.98;
  const oa=sampleSensors(a.world,a.rover,a.time),ob=sampleSensors(b.world,b.rover,b.time);
  assert.deepEqual(oa,ob);
  assert.equal('deposit' in ob,false);assert.equal('gradient' in ob,false);assert.equal('seed' in ob,false);
  assert.equal(encodeDepositObservation(ob).length,35);
});

test('composition is measured locally, occluded by rocks and unavailable with spectrometer off',()=>{
  const s=fixture();cell(s,34,22).iceFraction=.12;
  cell(s,36,22).iceFraction=.8;cell(s,36,22).ice=true;
  const reading=sampleSensors(s.world,s.rover,s.time);
  assert.equal(reading.surfaceConcentration,.12);
  assert.ok(reading.waterReadings.some(p=>p.concentration===.8));
  const blocked=fixture();cell(blocked,36,22).ice=true;cell(blocked,36,22).iceFraction=.8;
  for(let y=0;y<blocked.world.h;y++)cell(blocked,35,y).rock=true;
  assert.deepEqual(sampleSensors(blocked.world,blocked.rover,blocked.time).waterReadings,[]);
  const off=fixture();off.rover.spectrometerEnabled=false;cell(off,34,22).ice=true;cell(off,34,22).iceFraction=.8;
  const o=sampleSensors(off.world,off.rover,off.time);
  assert.equal(o.surfaceConcentration,null);assert.equal(o.surfaceIce,false);assert.deepEqual(o.waterReadings,[]);
  off.rover.lastSurfaceIce=true;
  assert.equal(sampleSensors(off.world,off.rover,off.time).surfaceIce,false);
});

test('trace and one rich sample do not confirm large source; continued steps keep same rover',()=>{
  const s=fixture({type:'sample'});cell(s,34,22).iceFraction=.15;
  const rover=s.rover;step(s);
  assert.equal(s.water.found,true);assert.equal(s.survey.confirmed,false);
  const firstTime=s.time;step(s);
  assert.equal(s.rover,rover);assert.ok(s.time>firstTime);
  assert.equal(s.survey.uniqueProbes,1);assert.equal(s.survey.totalProbes,2);
  assert.equal(s.lastFeedback.newSurvey,false);
  cell(s,34,22).iceFraction=.9;step(s);
  assert.equal(s.survey.confirmed,false);
});

test('candidate requires rich, spatially spread, nearby measurements; no repeat bonus',()=>{
  const s=createSurvey();probe(s,0,0);probe(s,0,4);
  const final=probe(s,3,0);
  assert.equal(final.newDeposit,true);assert.equal(s.confirmed,true);
  assert.equal(probe(s,3,0).newDeposit,false);
  assert.equal(probe(s,3,0).newSurvey,false);
  const poor=createSurvey();probe(poor,0,0,.64);probe(poor,0,4,.64);probe(poor,3,0,.64);
  assert.equal(poor.confirmed,false);
  const tiny=createSurvey();probe(tiny,0,0);probe(tiny,2,0);probe(tiny,1,Math.sqrt(3));assert.equal(tiny.confirmed,false);
  const far=createSurvey();probe(far,0,0);probe(far,20,0);probe(far,0,20);assert.equal(far.confirmed,false);
});

test('survey archive is bounded and evicting an old probe cannot farm novelty',()=>{
  const s=createSurvey();probe(s,1,1,.1);
  for(let i=0;i<100;i++)probe(s,2+i%50,2+Math.floor(i/50),.1,i);
  assert.equal(s.probes.length,SURVEY_CAPACITY);assert.equal(s.seen.byteLength,1024);
  const unique=s.uniqueProbes;
  assert.equal(probe(s,1,1,.1).newSurvey,false);assert.equal(s.uniqueProbes,unique);
  const obs=sampleSensors(fixture().world,fixture().rover,0);
  assert.ok(depositReward(obs,obs,{sampleAttempt:true,newSurvey:false}).total<0);
});

test('insufficient power gives no new spectral scan or contact probe',()=>{
  const s=fixture({type:'sample'});cell(s,34,22).iceFraction=.9;s.tick=2;s.rover.batteryWh=.0001;
  step(s);
  assert.equal(s.rover.lastObservation.scanFresh,false);
  assert.equal(s.survey.totalProbes,0);assert.equal(s.survey.confirmed,false);
  const off=fixture({type:'sample'});cell(off,34,22).iceFraction=.9;off.rover.batteryWh=0;step(off);
  assert.equal(off.survey.totalProbes,0);
});

test('sleep retains position, survey and weights, with no unpowered decisions',()=>{
  const controller=createDepositController({model:transferSurfaceModel(model)});
  const s=createSimulation(42,{preset:DEPOSIT_PRESET,controller});
  probe(s.survey,s.rover.x,s.rover.y,.1);
  s.rover.batteryWh=0;s.time=1400;step(s);
  const snapshot=controller.save(),position={x:s.rover.x,y:s.rover.y};
  for(let i=0;i<30;i++)step(s);
  assert.deepEqual(controller.save(),snapshot);assert.equal(s.survey.totalProbes,1);
  assert.deepEqual({x:s.rover.x,y:s.rover.y},position);assert.ok(s.stats.sleepSeconds>0);
  s.rover.batteryWh=s.rover.capacityWh*.69;step(s);assert.equal(s.rover.mode,'HIBERNATING');
  s.rover.batteryWh=s.rover.capacityWh*.7;s.rover.bodyTempC=-20;step(s);assert.equal(s.rover.mode,'ACTIVE');
  assert.deepEqual({x:s.rover.x,y:s.rover.y},position);assert.equal(s.survey.totalProbes,1);
});

test('new model rejects old schema, explicit transfer preserves old actions and starts six zero input weights',()=>{
  assert.throws(()=>createDepositController({model}));
  const transferred=transferSurfaceModel(model);
  assert.throws(()=>createNeuralController({model:transferred}));
  for(let j=0;j<32;j++)assert.ok(transferred.network.w1.slice(j*35+29,j*35+35).every(v=>v===0));
  const old=createNeuralController({model,learning:false}),fresh=createDepositController({model:transferred,learning:false});
  const s=fixture(),obs=sampleSensors(s.world,s.rover,s.time);
  assert.deepEqual(old.act(obs),fresh.act(obs));assert.deepEqual(old.info().qValues,fresh.info().qValues);
  assert.deepEqual(createDepositController({model:JSON.parse(JSON.stringify(fresh.save()))}).save(),fresh.save());
  const a=createDepositController({model:transferred,seed:73}),b=createDepositController({model:transferred,seed:73});
  const sa=createSimulation(42,{preset:DEPOSIT_PRESET,controller:a}),sb=createSimulation(42,{preset:DEPOSIT_PRESET,controller:b});
  for(let i=0;i<100;i++){step(sa);step(sb);}
  assert.ok(a.info().updates>transferred.updates);assert.deepEqual(a.save(),b.save());
});

test('historical deposit evaluation preserves disjoint maps, model and original source provenance',async()=>{
  const all=[...DEPOSIT_PROTOCOL.trainSeeds,...DEPOSIT_PROTOCOL.validationSeeds,...DEPOSIT_PROTOCOL.testSeeds];
  assert.equal(new Set(all).size,all.length);
  const packaged=JSON.parse(await readFile(new URL('models/deposit-dqn-v1.json',root),'utf8'));
  const report=JSON.parse(await readFile(new URL('experiments/deposit-benchmark.json',root),'utf8'));
  const sha=text=>createHash('sha256').update(text).digest('hex');
  assert.equal(sha(JSON.stringify(packaged)),report.modelSha256);
  assert.deepEqual(report.protocol,DEPOSIT_PROTOCOL);
  assert.equal(report.runs.length,2);
  assert.equal(report.sourceRevision,'143bc805a738c9b77b2509e8d9b439dbc3839d4e');
  for(const hash of Object.values(report.sourceHashes))assert.match(hash,/^[a-f0-9]{64}$/);
  for(const result of Object.values(report.test)){
    assert.deepEqual(result.trials.map(t=>t.seed),DEPOSIT_PROTOCOL.testSeeds);
    assert.equal(result.candidates,result.trials.filter(t=>t.candidate).length);
  }
});
