import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,step} from '../src/sim/engine.js';
import {createWorld} from '../src/sim/world.js';
import {createMemory,remember,memoryPercent} from '../src/sim/memory.js';
import {sampleSensors} from '../src/sim/sensors.js';
import {chooseBaselineAction} from '../src/sim/policy.js';

test('seed generates deterministic world; changing seed changes terrain',()=>{
  const a=createWorld(42),b=createWorld(42),c=createWorld(43);
  assert.deepEqual(a.cells,b.cells);
  assert.notDeepEqual(a.cells,c.cells);
});

test('agent observation does not contain hidden map, ice data or world reference',()=>{
  const s=createSimulation(42);
  const o=sampleSensors(s.world,s.rover,s.time,{scan:true});
  assert.equal('world' in o,false);
  assert.equal('cells' in o,false);
  assert.equal('ice' in o,false);
  assert.ok(o.lidar.length>0);
  const action=chooseBaselineAction(o,s.rover.brain,s.rover.mission);
  assert.ok(['wait','turn','move'].includes(action.type));
});

test('bounded memory evicts old observations without exceeding capacity',()=>{
  const m=createMemory(384*3);
  for(let i=0;i<12;i++)remember(m,i,0,{rock:false,seenAt:i});
  assert.equal(m.cells.size,3);
  assert.equal(m.lost,9);
  assert.equal(memoryPercent(m),100);
  assert.equal(m.cells.has('0,0'),false);
  assert.equal(m.cells.has('11,0'),true);
});

test('complete discharge stops active operation; reboots at 70%, not at 69%',()=>{
  const s=createSimulation(42);
  s.rover.mode='HIBERNATING';
  s.rover.batteryWh=s.rover.capacityWh*.69;
  s.time=448;
  step(s,2);
  assert.equal(s.rover.mode,'HIBERNATING');
  for(let i=0;i<250;i++)step(s,2);
  assert.equal(s.rover.mode,'ACTIVE');
});

test('without light, an empty rover cannot magically recharge',()=>{
  const s=createSimulation(42);
  s.rover.mode='HIBERNATING';s.rover.batteryWh=0;
  s.time=1400; // night of accelerated laboratory cycle
  for(let i=0;i<50;i++)step(s,2);
  assert.equal(s.rover.batteryWh,0);
  assert.equal(s.rover.mode,'HIBERNATING');
});

test('same seed and steps produce identical trajectory and battery',()=>{
  const a=createSimulation(17),b=createSimulation(17);
  for(let i=0;i<100;i++){step(a,2);step(b,2);}
  for(const key of ['x','y','heading','batteryWh','bodyTempC','mode','travelM']) assert.equal(a.rover[key],b.rover[key],key);
  assert.deepEqual(a.events,b.events);
});
