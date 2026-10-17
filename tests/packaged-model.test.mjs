import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createNeuralController} from '../src/agent/controller.js';
import {runTrial,PROTOCOL} from '../src/lab/experiment.js';
const root=new URL('../',import.meta.url);
const sha=text=>createHash('sha256').update(text).digest('hex');

test('historical surface checkpoint matches its benchmark and original source provenance',async()=>{
  const model=JSON.parse(await readFile(new URL('models/water-dqn-v1.json',root),'utf8'));
  const report=JSON.parse(await readFile(new URL('experiments/water-benchmark.json',root),'utf8'));
  assert.equal(sha(JSON.stringify(model)),report.modelSha256);
  assert.deepEqual(report.protocol,PROTOCOL);
  assert.equal(report.sourceRevision,'66557bca1fe522121f74767d62cc953ce6426a63');
  for(const expected of Object.values(report.sourceHashes))assert.match(expected,/^[a-f0-9]{64}$/);
  assert.equal(report.training.history.length,PROTOCOL.episodes);
  assert.ok(report.training.checkpoints.some(c=>c.updates===model.updates&&c.found===report.validation.found));
  for(const result of Object.values(report.test)){
    assert.deepEqual(result.trials.map(t=>t.seed),PROTOCOL.testSeeds);
    assert.equal(result.found,result.trials.filter(t=>t.found).length);
  }
});

test('packaged frozen network confirms an actual sample on the documented demonstration map',async()=>{
  const model=JSON.parse(await readFile(new URL('models/water-dqn-v1.json',root),'utf8'));
  const controller=createNeuralController({model,learning:false});
  const result=runTrial(42,controller);
  assert.equal(result.found,true);
  assert.equal(result.samples,1);
  assert.ok(result.batteryWh>0);
  assert.equal(controller.info().updates,model.updates);
});
