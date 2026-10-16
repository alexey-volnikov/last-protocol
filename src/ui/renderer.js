import {tileAt,sunlightAt,WORLD_W,WORLD_H} from '../sim/world.js';
const TW=16;
function fillCell(ctx,x,y,cell,brightness,known){
  const rock=cell?.rock;
  const crater=cell?.crater||0,rim=cell?.rim||0;
  const colorBase=known?42:26;
  const r=Math.max(10,Math.round((colorBase+crater*-17+rim*20+brightness*18)));
  const g=Math.max(13,Math.round((colorBase+5+crater*-17+rim*18+brightness*16)));
  const b=Math.max(19,Math.round((colorBase+10+crater*-12+rim*14+brightness*15)));
  ctx.fillStyle=`rgb(${r},${g},${b})`;ctx.fillRect(x*TW,y*TW,TW,TW);
  if(known&&cell?.iceFraction>0){ctx.fillStyle=`rgba(86,186,211,${Math.min(.8,cell.iceFraction*.8)})`;ctx.fillRect(x*TW,y*TW,TW,TW);}
  ctx.strokeStyle=known?'rgba(145,165,177,0.035)':'rgba(130,155,177,0.015)';ctx.strokeRect(x*TW+.5,y*TW+.5,TW,TW);
  if(rock){ctx.fillStyle=known?'#899199':'#52606d';ctx.beginPath();ctx.ellipse((x+.5)*TW,(y+.5)*TW,5,3.5,.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#384755';ctx.fillRect((x+.48)*TW,(y+.42)*TW,4,3);}
  if(cell?.ice && known){ctx.fillStyle='#7cdeeb';ctx.beginPath();ctx.moveTo(x*TW+8,y*TW+3);ctx.lineTo(x*TW+13,y*TW+8);ctx.lineTo(x*TW+8,y*TW+13);ctx.lineTo(x*TW+3,y*TW+8);ctx.closePath();ctx.fill();}
}
function drawCapsule(ctx,x,y){
  ctx.save();ctx.translate(x*TW,y*TW);
  ctx.fillStyle='#111d24';ctx.fillRect(-20,-19,40,38);
  ctx.fillStyle='#345d70';ctx.fillRect(-30,-17,11,34);ctx.fillRect(19,-17,11,34);
  ctx.strokeStyle='#76a7b7';ctx.lineWidth=1;
  for(let i=-16;i<17;i+=8){ctx.beginPath();ctx.moveTo(-30,i);ctx.lineTo(-19,i);ctx.moveTo(19,i);ctx.lineTo(30,i);ctx.stroke();}
  ctx.fillStyle='#beccd3';ctx.fillRect(-15,-13,30,26);
  ctx.fillStyle='#4a6576';ctx.fillRect(-9,-8,18,16);
  ctx.fillStyle='#e0b46a';ctx.fillRect(-3,-3,6,6);
  ctx.strokeStyle='#e8bc75';ctx.lineWidth=1;ctx.strokeRect(-18,-16,36,32);ctx.restore();
}
function drawRover(ctx,x,y,heading){
  ctx.save();ctx.translate(x*TW,y*TW);ctx.rotate(heading);
  ctx.fillStyle='#070e16';ctx.fillRect(-12,-10,24,20);
  ctx.fillStyle='#a1abb3';ctx.fillRect(-9,-7,18,14);
  ctx.fillStyle='#d9a856';ctx.fillRect(-5,-5,10,10);
  ctx.fillStyle='#233543';ctx.fillRect(-7,-10,7,3);ctx.fillRect(1,-10,7,3);ctx.fillRect(-7,7,7,3);ctx.fillRect(1,7,7,3);
  ctx.strokeStyle='#f3ca78';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(4,0);ctx.lineTo(14,0);ctx.stroke();ctx.beginPath();ctx.moveTo(10,-4);ctx.lineTo(15,0);ctx.lineTo(10,4);ctx.stroke();ctx.restore();
  ctx.beginPath();ctx.arc(x*TW,y*TW,17,0,Math.PI*2);ctx.strokeStyle='#efbc6b70';ctx.lineWidth=1;ctx.stroke();
}
export function drawWorld(canvas,sim,mapMode='memory'){
  const ctx=canvas.getContext('2d'),{world,rover}=sim;
  const sunlight=sunlightAt(world,rover.x,rover.y,sim.time);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let y=0;y<WORLD_H;y++)for(let x=0;x<WORLD_W;x++){
    const known=mapMode==='truth'||rover.memory.cells.has(`${x},${y}`);
    const cell=mapMode==='truth'?tileAt(world,x,y):rover.memory.cells.get(`${x},${y}`);
    fillCell(ctx,x,y,cell,sunlight,known);
    if(!known){ctx.fillStyle='#0c1721dd';ctx.fillRect(x*TW,y*TW,TW,TW);}
    else if(mapMode==='memory' && cell){
      const age=Math.min(1,(sim.time-cell.seenAt)/1200);
      ctx.fillStyle=`rgba(0,0,0,${age*.25})`;ctx.fillRect(x*TW,y*TW,TW,TW);
    }
  }
  const homeKey=`${Math.floor(world.home.x)},${Math.floor(world.home.y)}`;
  if(mapMode==='truth'||rover.memory.cells.has(homeKey))drawCapsule(ctx,world.home.x,world.home.y);
  if(rover.lastObservation?.lidar?.length){
    ctx.lineWidth=1;
    for(const ray of rover.lastObservation.lidar){
      ctx.strokeStyle=ray.hit?'#d5ac6260':'#75b6c860';
      ctx.beginPath();ctx.moveTo(rover.x*TW,rover.y*TW);
      ctx.lineTo((rover.x+Math.cos(ray.angle)*ray.distance)*TW,(rover.y+Math.sin(ray.angle)*ray.distance)*TW);ctx.stroke();
    }
  }
  drawRover(ctx,rover.x,rover.y,rover.heading);
  if(sim.water.found&&!sim.survey){
    const p=sim.water.sample;ctx.strokeStyle='#84efcd';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(p.x*TW,p.y*TW,23,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#b5f5e5';ctx.font='bold 12px monospace';ctx.fillText('H₂O ✓',p.x*TW+27,p.y*TW-10);
  }
  if(sim.survey){
    for(const p of sim.survey.probes){ctx.fillStyle=p.concentration>=.65?'#b7f5db':'#e6c184';ctx.beginPath();ctx.arc(p.x*TW,p.y*TW,3,0,Math.PI*2);ctx.fill();}
    if(mapMode==='truth'&&world.deposit){
      const d=world.deposit;ctx.strokeStyle='#83cfdf90';ctx.setLineDash([4,5]);ctx.beginPath();ctx.ellipse(d.x*TW,d.y*TW,d.rx*TW,d.ry*TW,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='#a7d9e5';ctx.font='11px monospace';ctx.fillText('ПЛАСТ / DEV',d.x*TW-35,d.y*TW-10);
    }
  }
  const gradient=ctx.createLinearGradient(0,0,canvas.width,0);
  gradient.addColorStop(0,'#0f182900');gradient.addColorStop(1,'#0308131b');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
}
