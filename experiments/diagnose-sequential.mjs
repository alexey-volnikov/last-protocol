import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {transferMotionModel} from '../src/agent/sequential-controller.js';
import {runMotionCase} from '../src/lab/motion-experiment.js';
import {sequentialFactory} from '../src/lab/sequential-experiment.js';
const root=new URL('../',import.meta.url),file=name=>new URL(name,root),sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const old=transferMotionModel(JSON.parse(await readFile(file('models/motion-context-dqn-v1.json'),'utf8'))),next=JSON.parse(await readFile(file('models/motion-decision-dqn-v2.json'),'utf8'));
const report={kind:'diagnostic-only-not-model-selection',maps:[42,4295],seed:71,resets:6,steps:2400,modelHashes:{initial:sha(old),decision:sha(next)},cases:{}};
for(const [variant,model] of [['initial',old],['decision',next]]){
  report.cases[variant]=[];
  for(const map of report.maps){
    const c=runMotionCase(model,map,71,{createController:sequentialFactory(variant),lifeSteps:0});
    for(const run of [...c.restarts,c.life])delete run.windows;
    report.cases[variant].push(c);
    console.log(JSON.stringify({variant,map,earlyDistance:c.restarts.map(r=>+r.early.distance.toFixed(2)),earlySpin:c.restarts.map(r=>r.early.spin),visited:c.restarts.map(r=>r.visited)}));
  }
}
await writeFile(file('experiments/sequential-known.json'),JSON.stringify(report,null,2)+'\n','utf8');
