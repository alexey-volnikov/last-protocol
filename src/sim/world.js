// Состояние физического мира. Агенту нельзя передавать объект World.
export const WORLD_W = 68;
export const WORLD_H = 44;
export const LAB_DAY_SECONDS = 1800; // Условный ускоренный тестовый цикл, не реальная лунная механика.

export function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let z = Math.imul(state ^ state >>> 15, 1 | state);
    z ^= z + Math.imul(z ^ z >>> 7, 61 | z);
    return ((z ^ z >>> 14) >>> 0) / 4294967296;
  };
}

export function createWorld(seed=42) {
  const rand=seededRandom(seed);
  const w=WORLD_W,h=WORLD_H;
  const home={x:14.5,y:22.5};
  const craters=Array.from({length:15},()=>({x:rand()*w,y:rand()*h,r:2.4+rand()*6.8}));
  const cells=[];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    let depression=0,rim=0;
    for(const c of craters){
      const d=Math.hypot(x+0.5-c.x,y+0.5-c.y);
      if(d<c.r) depression=Math.max(depression,(1-d/c.r)*.95);
      else if(d<c.r*1.14)rim=Math.max(rim,(1-(d-c.r)/(c.r*.14))*.8);
    }
    const roughness=rand();
    const clearSpawn=Math.hypot(x+.5-home.x,y+.5-home.y)<5;
    const rock=!clearSpawn && ((roughness>.954 && depression<.42) || rim>.73 && roughness>.73);
    cells.push({rock, crater:depression, rim, roughness, ice:depression>.62 && rand()>.78});
  }
  return {seed,w,h,home,cells};
}
export function tileAt(world,x,y){
  const tx=Math.floor(x),ty=Math.floor(y);
  if(tx<0||ty<0||tx>=world.w||ty>=world.h)return null;
  return world.cells[ty*world.w+tx];
}
export function sunlightAt(world,x,y,seconds){
  const cell=tileAt(world,x,y);
  if(!cell)return 0;
  const phase=((seconds%LAB_DAY_SECONDS)+LAB_DAY_SECONDS)%LAB_DAY_SECONDS/LAB_DAY_SECONDS;
  const solar=Math.max(0,Math.sin(2*Math.PI*phase));
  // Лабораторное приближение теней: глубина кратера и его стенки экранируют свет.
  const localShade=Math.max(.04,1-.72*cell.crater-.5*cell.rim);
  return Math.max(0,Math.min(1,solar*localShade));
}
export function surfaceTempC(world,x,y,seconds){
  // Условное тестовое приближение, НЕ научно-точная термическая модель.
  return -155 + sunlightAt(world,x,y,seconds)*157;
}
