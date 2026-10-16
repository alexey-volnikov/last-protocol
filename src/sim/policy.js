// ПОЛИТИКА-baseline: явная эвристика, пока НЕ машинное обучение.
// Контракт: на вход только показания сенсоров, память (обобщённые данные) и миссия.
export function chooseBaselineAction(obs,brain,mission){
  const pct=obs.batteryPct;
  const pos=obs.odometry;
  // Объём накопителя провоцирует сокращение исследования/переход к базе.
  const cautious=pct<30 || obs.memoryUsedPct>96;
  let targetAngle=brain.wanderHeading;
  if(cautious){
    if(obs.homeBeacon && obs.homeBearing!==null)targetAngle=obs.homeBearing;
    else if(mission.rememberedHome)targetAngle=Math.atan2(mission.rememberedHome.y-pos.y,mission.rememberedHome.x-pos.x);
  }
  // Ночью базовая политика просто экономит энергию. Обученной стратегии пока нет.
  if(obs.sunlight<.12 && pct<55)return {type:'wait',reason:'Низкая освещённость; экономия заряда'};
  if(pct<14 && obs.sunlight>.25)return {type:'wait',reason:'Ожидание пассивной зарядки'};
  const headingDifference=Math.atan2(Math.sin(targetAngle-pos.heading),Math.cos(targetAngle-pos.heading));
  if(Math.abs(headingDifference)>.26)return {type:'turn',amount:Math.sign(headingDifference)*.28,reason:'Коррекция направления'};
  const front=obs.lidar?.reduce((a,r)=>Math.abs(Math.atan2(Math.sin(r.angle-pos.heading),Math.cos(r.angle-pos.heading)))<.31 ? Math.min(a,r.distance):a,99);
  if(front!==undefined && front<1.45){
    brain.wanderHeading=pos.heading+1.1;
    return {type:'turn',amount:.48,reason:'Обход препятствия'};
  }
  return {type:'move',reason:cautious?'Попытка вернуться к базе':'Исследование'};
}
