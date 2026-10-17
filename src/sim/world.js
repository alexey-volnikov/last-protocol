// Состояние физического мира. Агенту нельзя передавать объект World.
export const WORLD_W = 68;
export const WORLD_H = 44;
export const LAB_DAY_SECONDS = 1800; // Условный ускоренный тестовый цикл, не реальная лунная механика.
export const SURFACE_PRESET='surface-water-v1';
export const DEPOSIT_PRESET='deposit-lab-v1';

export function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let z = Math.imul(state ^ state >>> 15, 1 | state);
    z ^= z + Math.imul(z ^ z >>> 7, 61 | z);
    return ((z ^ z >>> 14) >>> 0) / 4294967296;
  };
}

export function createWorld(seed=42,{preset=SURFACE_PRESET}={}) {
  if(![SURFACE_PRESET,DEPOSIT_PRESET].includes(preset))throw new Error('Неизвестный пресет мира');
  const rand=seededRandom(seed);
  const w=WORLD_W,h=WORLD_H;
  const home=preset===DEPOSIT_PRESET?{x:34.5,y:22.5}:{x:14.5,y:22.5};
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
  const world={seed,w,h,home,cells};
  if(preset===DEPOSIT_PRESET)addDeposit(world);
  return world;
}
function addDeposit(world){
  const rand=seededRandom((Number(world.seed)>>>0)^0x5AD31);
  let center;
  do{center={x:6+rand()*(world.w-12),y:6+rand()*(world.h-12)};}
  while(Math.hypot(center.x-world.home.x,center.y-world.home.y)<24);
  const source={...center,rx:6+rand()*3,ry:5+rand()*2};
  const small=Array.from({length:3},()=>({x:rand()*world.w,y:rand()*world.h,r:1+rand(),grade:.12+rand()*.15}));
  for(let y=0;y<world.h;y++)for(let x=0;x<world.w;x++){
    const dx=x+.5-source.x,dy=y+.5-source.y;
    const radius=(dx/source.rx)**2+(dy/source.ry)**2;
    let concentration=.9*Math.exp(-radius)+.16*Math.exp(-Math.hypot(dx,dy)/14);
    for(const p of small)concentration+=p.grade*Math.exp(-((x+.5-p.x)**2+(y+.5-p.y)**2)/p.r**2);
    concentration=Math.min(.98,concentration*(.94+rand()*.12));
    const cell=world.cells[y*world.w+x];
    cell.iceFraction=concentration;
    cell.ice=concentration>=.58||(concentration>.025&&rand()<concentration*.7);
  }
  world.preset=DEPOSIT_PRESET;
  world.deposit=source; // Истина для движка/dev-отрисовки. Никогда не передавать контроллеру.
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
