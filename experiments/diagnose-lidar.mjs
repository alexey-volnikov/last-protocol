import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSequentialController} from '../src/agent/sequential-controller.js';
import {createSimulation,step} from '../src/sim/engine.js';
const root=new URL('../',import.meta.url),file=name=>new URL(name,root);
const model=JSON.parse(await readFile(file('models/motion-decision-dqn-v2.json'),'utf8'));
const report={kind:'diagnostic-only-not-model-selection',maps:[42,4295,17001,17002,17003,17004],seeds:[113,929],resets:6,steps:2400,epsilon:.12,
  lidarMode:'sampled-v1',modelSha256:createHash('sha256').update(JSON.stringify(model)).digest('hex'),
  counts:{collisions:0,repeat:0,near:0,clear:0,absent:0},examples:[]};
for(const map of report.maps)for(const seed of report.seeds){
  const c=createSequentialController({model,seed,epsilon:report.epsilon,learning:true});let obs,lastScan;
  const wrapped={...c,act(o){obs=o;return c.act(o);}};
  for(let trial=0;trial<report.resets;trial++){
    c.newTrial();const sim=createSimulation(map,{controller:wrapped,preset:'deposit-lab-v1',curiosity:true,lidarMode:report.lidarMode});lastScan=-100;
    for(let i=0;i<report.steps;i++){
      const collisions=sim.stats.collisions;step(sim);
      if(sim.stats.collisions>collisions){
        const heading=obs.odometry.heading;
        const nearest=obs.lidar.map(r=>({...r,delta:Math.abs(Math.atan2(Math.sin(r.angle-heading),Math.cos(r.angle-heading)))})).sort((a,b)=>a.delta-b.delta)[0];
        const n=report.counts;n.collisions++;n.repeat+=Number(obs.contact);n.absent+=Number(!nearest);n.near+=Number(nearest?.distance<.8);n.clear+=Number(nearest?.distance>=.8);
        if(report.examples.length<10)report.examples.push({map,seed,trial,tick:sim.tick,pos:[sim.rover.x,sim.rover.y],heading,scanAge:sim.tick-lastScan,contact:obs.contact,forward:nearest,q:c.info().qValues});
      }
      if(sim.rover.lastObservation?.scanFresh)lastScan=sim.tick;
    }
  }
  console.log(`Diagnostic: ${map}, ${seed}`);
}
await writeFile(file('experiments/lidar-diagnosis.json'),JSON.stringify(report,null,2)+'\n','utf8');console.log(JSON.stringify(report.counts));
