import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {transferMotionModel} from '../src/agent/sequential-controller.js';
import {SEQUENTIAL_PROTOCOL,trainSequential,evaluateSequential,compareSequential,sequentialPasses} from '../src/lab/sequential-experiment.js';
const root=new URL('../',import.meta.url),file=name=>new URL(name,root),sha=s=>createHash('sha256').update(s).digest('hex');
const origin=JSON.parse(await readFile(file('models/motion-context-dqn-v1.json'),'utf8')),initial=transferMotionModel(origin);
const report={schema_version:1,protocol:SEQUENTIAL_PROTOCOL,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceHashes:{},originSha256:sha(JSON.stringify(origin)),initialSha256:sha(JSON.stringify(initial)),training:[],validation:{},selection:{},test:{}};
for(const name of ['src/agent/controller.js','src/agent/network.js','src/agent/random.js','src/agent/curiosity-controller.js','src/agent/deposit-controller.js','src/agent/motion-controller.js','src/agent/sequential-controller.js',
  'src/sim/engine.js','src/sim/sensors.js','src/sim/exploration.js','src/sim/world.js','src/sim/memory.js','src/sim/survey.js','src/lab/online-audit.js','src/lab/motion-experiment.js','src/lab/sequential-experiment.js','experiments/train-sequential.mjs'])report.sourceHashes[name]=sha((await readFile(file(name),'utf8')).replace(/\r\n/g,'\n'));
const models={initial};
for(const group of ['after','decision'])for(const trainingSeed of SEQUENTIAL_PROTOCOL.trainingSeeds){
  const name=`${group}-${trainingSeed}`;console.log(`Train ${name}`);
  const result=await trainSequential({model:initial,variant:group,trainingSeed,onProgress:p=>console.log(`${name}: ${p.episode}/${p.total}, E${p.updates}, observed ${p.observed.toFixed(1)}`)});
  const {model,...training}=result;models[name]=model;report.training.push({name,...training,modelSha256:sha(JSON.stringify(model))});
}
for(const [name,model] of Object.entries(models)){
  const variant=name.startsWith('decision')?'decision':'after';console.log(`Validation ${name}`);
  report.validation[name]=evaluateSequential(model,SEQUENTIAL_PROTOCOL.validation,{variant,onProgress:p=>console.log(`${name}: map ${p.map}, seed ${p.seed}`)});
  console.log(JSON.stringify({name,...report.validation[name].summary}));
}
for(const group of ['after','decision']){
  report.selection[group]=SEQUENTIAL_PROTOCOL.trainingSeeds.map(s=>`${group}-${s}`).sort((a,b)=>compareSequential(report.validation[a].summary,report.validation[b].summary))[0];
  await writeFile(file(`models/motion-${group}-dqn-v2.json`),JSON.stringify(models[report.selection[group]],null,2)+'\n','utf8');
}
await mkdir(file('experiments/runs/'),{recursive:true});
await writeFile(file('experiments/runs/sequential-selection.json'),JSON.stringify({selection:report.selection,validation:report.validation},null,2)+'\n','utf8');
for(const group of ['initial','after','decision']){
  const name=report.selection[group]||'initial';console.log(`Held-out ${group}: ${name}`);
  report.test[group]=evaluateSequential(models[name],SEQUENTIAL_PROTOCOL.test,{variant:group,onProgress:p=>console.log(`${group}: map ${p.map}, seed ${p.seed}`)});
  report.test[group].modelSha256=sha(JSON.stringify(models[name]));console.log(JSON.stringify({group,...report.test[group].summary}));
}
report.promotion={validation:sequentialPasses(report.validation[report.selection.decision].summary,report.validation[report.selection.after].summary,report.validation.initial.summary),
  test:sequentialPasses(report.test.decision.summary,report.test.after.summary,report.test.initial.summary)};
report.promotion.accepted=report.promotion.validation&&report.promotion.test;
const raw=JSON.stringify(report);await writeFile(file('experiments/runs/sequential-full.json'),raw+'\n','utf8');
report.rawDetails={path:'runs/sequential-full.json',sha256:sha(raw),scope:'JSON content excluding final LF; local window log intentionally excluded from Git'};
for(const group of [report.validation,report.test])for(const result of Object.values(group))for(const c of result.cases)for(const run of [...c.restarts,c.life]){
  const windows=run.windows;run.windowCount=windows.length;
  run.examples=[windows.find(w=>w.spin),windows.find(w=>w.stalled),windows.findLast(w=>w.active>0)].filter((w,i,a)=>w&&a.indexOf(w)===i);delete run.windows;
}
await writeFile(file('experiments/sequential-benchmark.json'),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({selection:report.selection,promotion:report.promotion}));
