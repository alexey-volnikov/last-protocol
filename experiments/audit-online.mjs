import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ONLINE_PROTOCOL,ONLINE_VARIANTS,runOnlineCase,summarizeOnline,compareOnline} from '../src/lab/online-audit.js';
const root=new URL('../',import.meta.url),model=JSON.parse(await readFile(new URL('models/curiosity-dqn-v1.json',root),'utf8'));
const stage=process.argv.find(s=>s.startsWith('--stage='))?.slice(8)||'validate';
const file=name=>new URL(`experiments/${name}`,root);
const append=process.argv.includes('--append');
const prior=stage!=='validate'||append?JSON.parse(await readFile(file('online-audit-validation.json'),'utf8')):null;
const results=append?prior.results:{};
const set=stage==='diagnose'?ONLINE_PROTOCOL.diagnostic:stage==='test'?ONLINE_PROTOCOL.test:ONLINE_PROTOCOL.validation;
const variants=stage!=='validate'?[...new Set(['legacy','pending',prior.selected])]:Object.keys(ONLINE_VARIANTS).filter(v=>!results[v]);
for(const variant of variants){
  const cases=[];
  for(const map of set.maps)for(const seed of set.seeds){
    console.log(`${stage} ${variant}: map ${map}, learner ${seed}`);
    cases.push(runOnlineCase(model,variant,map,seed));
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  results[variant]={summary:summarizeOnline(cases),cases};
  console.log(JSON.stringify({variant,...results[variant].summary}));
}
const selected=stage==='test'?prior.selected:Object.keys(results).sort((a,b)=>compareOnline(results[a].summary,results[b].summary))[0];
const report={schema_version:1,stage,protocol:ONLINE_PROTOCOL,settings:ONLINE_VARIANTS,modelSha256:createHash('sha256').update(JSON.stringify(model)).digest('hex'),
  selected,results,sourceHashes:{}};
for(const name of ['src/agent/controller.js','src/agent/network.js','src/agent/curiosity-controller.js','src/agent/deposit-controller.js',
  'src/sim/engine.js','src/sim/sensors.js','src/sim/exploration.js','src/sim/world.js','src/sim/memory.js','src/sim/survey.js',
  'src/lab/online-audit.js','experiments/audit-online.mjs'])report.sourceHashes[name]=createHash('sha256').update((await readFile(new URL(name,root),'utf8')).replace(/\r\n/g,'\n')).digest('hex');
if(stage==='test')report.validation=prior;
if(append)report.previousSourceHashes=prior.sourceHashes;
await mkdir(file('runs/'),{recursive:true});
const raw=JSON.stringify(report),rawPath=`runs/online-audit-${stage}-full.json`;
await writeFile(file(rawPath),raw+'\n','utf8');
report.rawDetails={path:rawPath,sha256:createHash('sha256').update(raw).digest('hex'),scope:'Local detailed window log; intentionally excluded from Git'};
for(const value of Object.values(report.results))for(const c of value.cases)for(const run of [...c.restarts,c.life]){
  const windows=run.windows;if(!windows)continue;
  run.windowCount=windows.length;
  run.examples=[windows.find(w=>w.spin),windows.find(w=>w.stalled),windows.findLast(w=>w.active>0)].filter((w,i,a)=>w&&a.indexOf(w)===i);
  delete run.windows;
}
await writeFile(file(stage==='test'?'online-audit.json':`online-audit-${stage==='diagnose'?'diagnosis':'validation'}.json`),JSON.stringify(report,null,2)+'\n','utf8');
console.log(`Selected on validation: ${selected}`);
