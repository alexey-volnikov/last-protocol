// Запись делит бюджет подробной карты. Отдельной вечной копии координат нет.
export function recallCapsule(memory,time){
  for(const cell of memory.cells.values())if(cell.capsulePosition){
    return {known:true,position:{...cell.capsulePosition},seenAt:cell.capsuleSeenAt,
      ageSeconds:Math.max(0,time-cell.capsuleSeenAt)};
  }
  return {known:false,position:null,seenAt:null,ageSeconds:null};
}
