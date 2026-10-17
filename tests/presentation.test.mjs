import test from 'node:test';
import assert from 'node:assert/strict';
import {roverPose,interpolatePose} from '../src/ui/rover-pose.js';
import {createSimulation,step} from '../src/sim/engine.js';
test('presentation interpolates intermediate turns continuously across a full revolution without mutating physics',()=>{
  const a={x:2,y:3,heading:Math.PI*2-.1},b={x:2.09,y:3,heading:Math.PI*2+.18},saved=structuredClone([a,b]);
  const halfway=interpolatePose(a,b,.5);assert.ok(Math.abs(halfway.heading-(Math.PI*2+.04))<1e-12);
  assert.ok(halfway.heading>a.heading&&halfway.heading<b.heading);assert.ok(Math.abs(halfway.x-2.045)<1e-12);
  assert.deepEqual([a,b],saved);assert.deepEqual(interpolatePose(a,b,-1),a);assert.deepEqual(interpolatePose(a,b,2),b);
});
test('rendering at different frame rates cannot change simulation movement, energy or decisions',()=>{
  function run(frames){const s=createSimulation(42,{controller:{act:()=>({type:'turn',amount:.28})}});for(let i=0;i<40;i++){
    const before=roverPose(s.rover);step(s);for(let f=0;f<frames;f++)interpolatePose(before,s.rover,f/frames);
  }return {pose:roverPose(s.rover),battery:s.rover.batteryWh,time:s.time,steps:s.rover.steps};}
  assert.deepEqual(run(1),run(120));
});
