import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PROTOCOL,trainWater,evaluate} from '../src/lab/experiment.js';
import {createNeuralController} from '../src/agent/controller.js';
const root=new URL('../',import.meta.url);
const modelPath=new URL('models/water-dqn-v1.json',root);
const reportPath=new URL('experiments/water-benchmark.json',root);
const checksum=text=>createHash('sha256').update(text).digest('hex');
const args=process.argv.slice(2),evaluateOnly=args.includes('--evaluate');
const all=[...PROTOCOL.trainSeeds,...PROTOCOL.validationSeeds,...PROTOCOL.testSeeds];
if(new Set(all).size!==all.length)throw new Error('Пересекаются наборы карт');
let model,training=null;
if(evaluateOnly)model=JSON.parse(await readFile(modelPath,'utf8'));
else{
  training=await trainWater({onProgress:p=>console.log(`LAB ${p.episode}/${p.total}: samples=${p.successes}, updates=${p.updates}`)});
  model=training.model;
  await mkdir(new URL('models/',root),{recursive:true});
  await writeFile(modelPath,JSON.stringify(model)+'\n','utf8');
}
const initial=createNeuralController({seed:PROTOCOL.trainingSeed,learning:false}).save();
const sourceFiles=['src/sim/engine.js','src/sim/world.js','src/sim/sensors.js','src/sim/memory.js',
  'src/agent/controller.js','src/agent/network.js','src/agent/random.js','src/lab/experiment.js',
  'src/sim/policy.js','experiments/train-water.mjs'];
const sourceHashes={};
for(const name of sourceFiles)sourceHashes[name]=checksum((await readFile(new URL(name,root),'utf8')).replace(/\r\n/g,'\n'));
const report={schema_version:1,kind:'LAB independent map evaluation',runtime:process.version,protocol:PROTOCOL,
  hashFormat:'model=JSON.stringify(parsed model); sources=UTF-8 with LF line endings',
  modelSha256:checksum(JSON.stringify(model)),sourceHashes,
  training:training?{successes:training.successes,history:training.history,checkpoints:training.checkpoints}:null,
  validation:evaluate(model,PROTOCOL.validationSeeds),
  test:{trained:evaluate(model,PROTOCOL.testSeeds),untrained:evaluate(initial,PROTOCOL.testSeeds),
    random:evaluate(null,PROTOCOL.testSeeds,'random'),baseline:evaluate(null,PROTOCOL.testSeeds,'baseline')},
  limitations:['Surface ice approximation, not subsurface water or mining.',
    'LAB resets run on an external computer. They do not respawn the live rover.',
    'Original baseline has no sampling action; random and untrained networks have the same actions as the trained network.',
    'Water search only; return, repair and safe long-term survival are not proven.']};
await writeFile(evaluateOnly?new URL('experiments/water-evaluation.json',root):reportPath,JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({validation:report.validation.successRate,test:Object.fromEntries(Object.entries(report.test).map(([k,v])=>[k,{found:v.found,total:v.total}]))},null,2));
