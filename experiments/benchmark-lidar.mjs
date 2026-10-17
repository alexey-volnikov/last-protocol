import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {LIDAR_PROTOCOL,evaluateLidar,lidarPasses} from '../src/lab/lidar-experiment.js';
const root=new URL('../',import.meta.url),file=name=>new URL(name,root),sha=s=>createHash('sha256').update(s).digest('hex');
const model=JSON.parse(await readFile(file(LIDAR_PROTOCOL.model),'utf8'));
const report={schema_version:1,kind:'matched-online-sensor-comparison',protocol:LIDAR_PROTOCOL,
  sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:{},modelSha256:sha(JSON.stringify(model)),validation:{},test:{},criteria:{}};
for(const name of ['src/agent/controller.js','src/agent/network.js','src/agent/random.js','src/agent/curiosity-controller.js','src/agent/deposit-controller.js','src/agent/motion-controller.js','src/agent/sequential-controller.js',
  'src/sim/engine.js','src/sim/lidar.js','src/sim/sensors.js','src/sim/exploration.js','src/sim/world.js','src/sim/memory.js','src/sim/survey.js','src/lab/online-audit.js','src/lab/motion-experiment.js','src/lab/lidar-experiment.js','experiments/benchmark-lidar.mjs'])
  report.sourceHashes[name]=sha((await readFile(file(name),'utf8')).replace(/\r\n/g,'\n'));
for(const phase of ['validation','test']){
 for(const variant of Object.keys(LIDAR_PROTOCOL.variants)){
   console.log(`${phase}: ${variant}`);
   report[phase][variant]=evaluateLidar(model,LIDAR_PROTOCOL[phase],{variant,onProgress:p=>console.log(`${phase}/${variant}: ${p.map}, ${p.seed}`)});
   console.log(JSON.stringify({phase,variant,...report[phase][variant].summary}));
 }
 report.criteria[phase]=lidarPasses(report[phase].continuous.summary,report[phase].sampled.summary);
}
report.criteria.accepted=report.criteria.validation&&report.criteria.test;
await mkdir(file('experiments/runs/'),{recursive:true});
const raw=JSON.stringify(report);await writeFile(file('experiments/runs/lidar-full.json'),raw+'\n','utf8');
report.rawDetails={path:'runs/lidar-full.json',sha256:sha(raw),scope:'JSON content excluding final LF; local window log intentionally excluded from Git'};
for(const phase of ['validation','test'])for(const result of Object.values(report[phase]))for(const c of result.cases)for(const run of [...c.restarts,c.life]){
  const windows=run.windows;run.windowCount=windows.length;
  run.examples=[windows.find(w=>w.spin),windows.find(w=>w.stalled),windows.findLast(w=>w.active>0)].filter((w,i,a)=>w&&a.indexOf(w)===i);delete run.windows;
}
await writeFile(file('experiments/lidar-benchmark.json'),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({criteria:report.criteria}));
