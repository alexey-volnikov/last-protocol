// Карта наблюдений размещена в ОТДЕЛЬНОМ ограниченном накопителе.
// Весов обучаемой модели пока нет, они не должны делить этот счётчик с картой.
export const OBS_BYTES=384; // условный сериализованный размер одной записи (тестовый пресет)
export const MEMORY_CAP_BYTES=196608; // 192 KiB: карта заполняется постепенно
export function createMemory(capacityBytes=MEMORY_CAP_BYTES){
  return {capacityBytes,cells:new Map(),lost:0,totalSeen:0};
}
export function remember(memory,x,y,record){
  const key=`${Math.floor(x)},${Math.floor(y)}`;
  const existed=memory.cells.has(key);
  if(existed)memory.cells.delete(key);
  else memory.totalSeen++;
  memory.cells.set(key,{...record,x:Math.floor(x),y:Math.floor(y)});
  let evictions=0;
  while(memory.cells.size*OBS_BYTES>memory.capacityBytes){
    const first=memory.cells.keys().next().value;
    if(first===undefined)break;
    memory.cells.delete(first);memory.lost++;evictions++;
  }
  return evictions;
}
export function memoryPercent(memory){return Math.min(100,Math.round(memory.cells.size*OBS_BYTES/memory.capacityBytes*100));}
