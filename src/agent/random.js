// Отдельный PRNG агента: генератор мира и его seed агенту не передаются.
export function makeRandom(seed=1){
  let state=Number(seed)>>>0;
  return ()=>{
    state=(state+0x6D2B79F5)|0;
    let z=Math.imul(state^state>>>15,1|state);
    z^=z+Math.imul(z^z>>>7,61|z);
    return ((z^z>>>14)>>>0)/4294967296;
  };
}
