import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {transferSequentialModel} from '../src/agent/capsule-controller.js';
import {CAPSULE_PROTOCOL,trainCapsule,evaluateCapsule,compareCapsule,capsulePasses} from '../src/lab/capsule-experiment.js';
const root=new URL('../',import.meta.url),file=name=>new URL(name,root),sha=s=>createHash('sha256').update(s).digest('hex');
const origin=JSON.parse(await readFile(file('models/motion-decision-dqn-v2.json'),'utf8')),initial=transferSequentialModel(origin);
const report={schema_version:1,protocol:CAPSULE_PROTOCOL,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceHashes:{},originSha256:sha(JSON.stringify(origin)),initialSha256:sha(JSON.stringify(initial)),training:[],validation:{},selection:{},test:{}};
for(const name of ['src/agent/controller.js','src/agent/network.js','src/agent/random.js','src/agent/curiosity-controller.js','src/agent/deposit-controller.js','src/agent/motion-controller.js','src/agent/sequential-controller.js','src/agent/capsule-controller.js',
  'src/sim/engine.js','src/sim/sensors.js','src/sim/lidar.js','src/sim/capsule-memory.js','src/sim/exploration.js','src/sim/world.js','src/sim/memory.js','src/sim/survey.js','src/lab/online-audit.js','src/lab/motion-experiment.js','src/lab/capsule-experiment.js','experiments/train-capsule.mjs'])
  report.sourceHashes[name]=sha((await readFile(file(name),'utf8')).replace(/\r\n/g,'\n'));
const models={initial};
for(const group of ['control','penalty'])for(const trainingSeed of CAPSULE_PROTOCOL.trainingSeeds){
  const name=`${group}-${trainingSeed}`;console.log(`Train ${name}`);
  const result=await trainCapsule({model:initial,variant:group,trainingSeed,onProgress:p=>console.log(`${name}: ${p.episode}/${p.total}, E${p.updates}, observed ${p.observed.toFixed(1)}`)});
  const {model,...training}=result;models[name]=model;report.training.push({name,...training,modelSha256:sha(JSON.stringify(model))});
}
for(const [name,model] of Object.entries(models)){
  const variant=name.startsWith('control')?'control':'penalty';console.log(`Validation ${name}`);
  report.validation[name]=evaluateCapsule(model,CAPSULE_PROTOCOL.validation,{variant,onProgress:p=>console.log(`${name}: ${p.map}, ${p.seed}`)});
  console.log(JSON.stringify({name,...report.validation[name].summary}));
}
for(const group of ['control','penalty']){
  report.selection[group]=CAPSULE_PROTOCOL.trainingSeeds.map(s=>`${group}-${s}`).sort((a,b)=>compareCapsule(report.validation[a].summary,report.validation[b].summary))[0];
  await writeFile(file(`models/capsule-${group}-dqn-v1.json`),JSON.stringify(models[report.selection[group]],null,2)+'\n','utf8');
}
report.selection.bundled=capsulePasses(report.validation[report.selection.penalty].summary,report.validation.initial.summary)?report.selection.penalty:'initial';
await writeFile(file('models/capsule-memory-dqn-v1.json'),JSON.stringify(models[report.selection.bundled],null,2)+'\n','utf8');
await mkdir(file('experiments/runs/'),{recursive:true});
await writeFile(file('experiments/runs/capsule-selection.json'),JSON.stringify({selection:report.selection,validation:report.validation},null,2)+'\n','utf8');
for(const group of ['initial','control','penalty']){
  const name=report.selection[group]||'initial';console.log(`Held-out ${group}: ${name}`);
  report.test[group]=evaluateCapsule(models[name],CAPSULE_PROTOCOL.test,{variant:group,onProgress:p=>console.log(`${group}: ${p.map}, ${p.seed}`)});
  report.test[group].modelSha256=sha(JSON.stringify(models[name]));console.log(JSON.stringify({group,...report.test[group].summary}));
}
report.criteria={validation:capsulePasses(report.validation[report.selection.penalty].summary,report.validation[report.selection.control].summary,report.validation.initial.summary),
  test:capsulePasses(report.test.penalty.summary,report.test.control.summary,report.test.initial.summary)};
report.criteria.accepted=report.criteria.validation&&report.criteria.test;
const raw=JSON.stringify(report);await writeFile(file('experiments/runs/capsule-full.json'),raw+'\n','utf8');
report.rawDetails={path:'runs/capsule-full.json',sha256:sha(raw),scope:'JSON content excluding final LF; local window log intentionally excluded from Git'};
for(const phase of ['validation','test'])for(const result of Object.values(report[phase]))for(const c of result.cases)for(const run of [...c.restarts,c.life]){
  const windows=run.windows;run.windowCount=windows.length;
  run.examples=[windows.find(w=>w.spin),windows.find(w=>w.stalled),windows.findLast(w=>w.active>0)].filter((w,i,a)=>w&&a.indexOf(w)===i);delete run.windows;
}
await writeFile(file('experiments/capsule-benchmark.json'),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({selection:report.selection,criteria:report.criteria}));
