import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DEPOSIT_PROTOCOL,trainDeposit,evaluateDeposit} from '../src/lab/deposit-experiment.js';
import {transferSurfaceModel} from '../src/agent/deposit-controller.js';
const root=new URL('../',import.meta.url),path=new URL('models/deposit-dqn-v1.json',root);
const surface=JSON.parse(await readFile(new URL('models/water-dqn-v1.json',root),'utf8'));
const initial=transferSurfaceModel(surface);
const all=[...DEPOSIT_PROTOCOL.trainSeeds,...DEPOSIT_PROTOCOL.validationSeeds,...DEPOSIT_PROTOCOL.testSeeds];
if(new Set(all).size!==all.length)throw new Error('Пересекаются карты обучения/проверки');
const runs=[];
let model;
if(process.argv.includes('--evaluate'))model=JSON.parse(await readFile(path,'utf8'));
else{
  let score=-Infinity;
  for(const trainingSeed of DEPOSIT_PROTOCOL.trainingSeeds){
    const result=await trainDeposit({surfaceModel:surface,trainingSeed,onProgress:p=>console.log(`LAB seed=${trainingSeed} ${p.episode}/${p.total}, candidates=${p.successes}, E${p.updates}`)});
    const validation=evaluateDeposit(result.model);
    runs.push({trainingSeed,history:result.history,checkpoints:result.checkpoints,validation});
    if(validation.score>score){score=validation.score;model=result.model;}
  }
  await writeFile(path,JSON.stringify(model)+'\n','utf8');
}
const report={schema_version:1,kind:'deposit-lab-v1: limited-horizon trials, not full lifetime',runtime:process.version,
  protocol:DEPOSIT_PROTOCOL,modelSha256:createHash('sha256').update(JSON.stringify(model)).digest('hex'),
  initialization:'Explicit transfer of surface-water-v1; concentration inputs initially zero',runs,
  test:{trained:evaluateDeposit(model,DEPOSIT_PROTOCOL.testSeeds),transferred:evaluateDeposit(initial,DEPOSIT_PROTOCOL.testSeeds),
    random:evaluateDeposit(null,DEPOSIT_PROTOCOL.testSeeds,{random:true})},
  limitations:['Candidate means three rich measured probes, not proven mineable reserves.',
    'LAB trials stop on first shutdown or time budget; live expedition continues through passive recovery.',
    'No scripted steering, hidden target distance or guaranteed search success.']};
report.sourceHashes={};
for(const name of ['src/sim/world.js','src/sim/sensors.js','src/sim/engine.js','src/sim/survey.js','src/sim/memory.js',
  'src/agent/network.js','src/agent/controller.js','src/agent/deposit-controller.js','src/agent/random.js','src/lab/deposit-experiment.js','experiments/train-deposit.mjs']){
  report.sourceHashes[name]=createHash('sha256').update((await readFile(new URL(name,root),'utf8')).replace(/\r\n/g,'\n')).digest('hex');
}
await writeFile(new URL(process.argv.includes('--evaluate')?'experiments/deposit-evaluation.json':'experiments/deposit-benchmark.json',root),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.test).map(([name,r])=>[name,{candidates:r.candidates,total:r.total,best:r.meanBestConcentration,probes:r.meanUniqueProbes}])),null,2));
