// Карта наблюдений размещена в ОТДЕЛЬНОМ ограниченном накопителе.
// Весов обучаемой модели пока нет, они не должны делить этот счётчик с картой.
export const OBS_BYTES=384; // условный сериализованный размер одной записи (тестовый пресет)
export const MEMORY_CAP_BYTES=196608; // 192 KiB: карта заполняется постепенно
export function createMemory(capacityBytes=MEMORY_CAP_BYTES){
  return {capacityBytes,cells:new Map(),lost:0,totalSeen:0,uniqueSeen:0,novelty:new Uint8Array(1024)};
}
export function remember(memory,x,y,record){
  const key=`${Math.floor(x)},${Math.floor(y)}`;
  const previous=memory.cells.get(key);
  const ix=Math.floor(x),iy=Math.floor(y),index=iy*128+ix;
  if(ix>=0&&ix<128&&iy>=0&&iy<64){
    const byte=index>>>3,bit=1<<(index&7);
    if(!(memory.novelty[byte]&bit)){memory.novelty[byte]|=bit;memory.uniqueSeen++;}
  }
  const existed=memory.cells.has(key);
  if(existed)memory.cells.delete(key);
  else memory.totalSeen++;
  memory.cells.set(key,{...previous,...record,x:Math.floor(x),y:Math.floor(y)});
  let evictions=0;
  while(memory.cells.size*OBS_BYTES>memory.capacityBytes){
    const first=memory.cells.keys().next().value;
    if(first===undefined)break;
    memory.cells.delete(first);memory.lost++;evictions++;
  }
  return evictions;
}
export function memoryPercent(memory){return Math.min(100,Math.round(memory.cells.size*OBS_BYTES/memory.capacityBytes*100));}
