import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CURIOSITY_PROTOCOL,trainCuriosity,evaluateCuriosity} from '../src/lab/curiosity-experiment.js';
import {transferDepositModel} from '../src/agent/curiosity-controller.js';
const root=new URL('../',import.meta.url),path=new URL('models/curiosity-dqn-v1.json',root);
const deposit=JSON.parse(await readFile(new URL('models/deposit-dqn-v1.json',root),'utf8'));
const initial=transferDepositModel(deposit),runs=[];
let model;
if(process.argv.includes('--evaluate'))model=JSON.parse(await readFile(path,'utf8'));
else{
  let bestScore=-Infinity;
  for(const trainingSeed of CURIOSITY_PROTOCOL.trainingSeeds){
    const result=await trainCuriosity({depositModel:deposit,trainingSeed,onProgress:p=>console.log(`LAB curiosity ${trainingSeed}: ${p.episode}/${p.total}, observed=${p.observed.toFixed(0)}, E${p.updates}`)});
    const validation=evaluateCuriosity(result.model);
    runs.push({...result,model:undefined,validation});
    if(validation.score>bestScore){model=result.model;bestScore=validation.score;}
  }
  await writeFile(path,JSON.stringify(model)+'\n','utf8');
}
const report={schema_version:1,kind:'curiosity-lab-v1: fixed-horizon sensing and power comparison',runtime:process.version,
  protocol:CURIOSITY_PROTOCOL,modelSha256:createHash('sha256').update(JSON.stringify(model)).digest('hex'),runs,
  test:{trained:evaluateCuriosity(model,CURIOSITY_PROTOCOL.testSeeds),transferred:evaluateCuriosity(initial,CURIOSITY_PROTOCOL.testSeeds),
    deposit:evaluateCuriosity(deposit,CURIOSITY_PROTOCOL.testSeeds,{kind:'deposit'}),random:evaluateCuriosity(null,CURIOSITY_PROTOCOL.testSeeds,{kind:'random'})},
  limitations:['Directional novelty is an estimate from measured footprints, not hidden terrain or a prescribed route.',
    'Coverage is in quantized odometry coordinates. No camera, autonomous deletion, compression or mineable reserves.',
    'Two training seeds and a limited horizon do not establish long-term survival or universal learning.'],sourceHashes:{}};
for(const name of ['src/sim/world.js','src/sim/sensors.js','src/sim/engine.js','src/sim/memory.js','src/sim/survey.js','src/sim/exploration.js',
  'src/agent/network.js','src/agent/controller.js','src/agent/deposit-controller.js','src/agent/curiosity-controller.js','src/agent/random.js',
  'src/lab/curiosity-experiment.js','experiments/train-curiosity.mjs'])report.sourceHashes[name]=createHash('sha256').update((await readFile(new URL(name,root),'utf8')).replace(/\r\n/g,'\n')).digest('hex');
await writeFile(new URL(process.argv.includes('--evaluate')?'experiments/curiosity-evaluation.json':'experiments/curiosity-benchmark.json',root),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.test).map(([key,value])=>[key,{observed:value.observed,visited:value.visited,shutdowns:value.shutdowns,energyWh:value.energyWh,candidates:value.candidates}]))));
