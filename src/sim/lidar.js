// Пересечение с первой занятой клеткой. Только сенсорная система читает world.
export const LIDAR_MODE='continuous-v2';
export const LEGACY_LIDAR_MODE='sampled-v1';
export function traceLidar(world,x,y,angle,range){
  const dx=Math.cos(angle),dy=Math.sin(angle);
  let cx=Math.floor(x),cy=Math.floor(y),distance=0;
  const sx=Math.sign(dx),sy=Math.sign(dy);
  const tx=Math.abs(dx)<1e-14?Infinity:Math.abs(1/dx),ty=Math.abs(dy)<1e-14?Infinity:Math.abs(1/dy);
  let nextX=tx===Infinity?Infinity:(cx+(sx>0?1:0)-x)/dx;
  let nextY=ty===Infinity?Infinity:(cy+(sy>0?1:0)-y)/dy;
  while(distance<=range){
    if(cx<0||cy<0||cx>=world.w||cy>=world.h||world.cells[cy*world.w+cx].rock)return {distance,hit:true};
    distance=Math.min(nextX,nextY);
    if(distance>range)break;
    // При точном попадании в угол луч входит сразу в диагональную клетку.
    const crossX=nextX<=nextY,crossY=nextY<=nextX;
    if(crossX){cx+=sx;nextX+=tx;}
    if(crossY){cy+=sy;nextY+=ty;}
  }
  return {distance:range,hit:false};
}
