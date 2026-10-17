export const SURVEY_CAPACITY=64;
export const RICH_THRESHOLD=.65;
export function createSurvey(){
  return {probes:[],seen:new Uint8Array(1024),totalProbes:0,uniqueProbes:0,best:0,last:null,delta:0,
    rich:[],richCount:0,confirmed:false,confirmedAt:null};
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function evidence(points){
  let count=points.length?1:0;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
    if(distance(points[i],points[j])<2)continue;
    count=2;
    for(let k=j+1;k<points.length;k++){
      const distances=[distance(points[i],points[j]),distance(points[i],points[k]),distance(points[j],points[k])];
      if(Math.min(...distances)>=2&&Math.max(...distances)>=4&&Math.max(...distances)<=12)return {count:3,confirmed:true};
    }
  }
  return {count,confirmed:false};
}
// Только результаты реально выполненных проб. Истина о месторождении сюда не передаётся.
export function registerProbe(survey,{x,y,concentration,time},physicalCell){
  const [ix,iy]=physicalCell;
  const index=iy*128+ix,byte=index>>>3,bit=1<<(index&7);
  const fresh=ix>=0&&ix<128&&iy>=0&&iy<64&&!(survey.seen[byte]&bit);
  if(fresh){survey.seen[byte]|=bit;survey.uniqueProbes++;}
  const record={x,y,concentration,time,fresh};
  survey.totalProbes++;
  survey.delta=survey.last?concentration-survey.last.concentration:0;
  survey.last=record;survey.best=Math.max(survey.best,concentration);
  survey.probes.push(record);if(survey.probes.length>SURVEY_CAPACITY)survey.probes.shift();
  const oldCount=survey.richCount,wasConfirmed=survey.confirmed;
  if(fresh&&concentration>=RICH_THRESHOLD){survey.rich.push(record);if(survey.rich.length>12)survey.rich.shift();}
  const state=evidence(survey.rich);survey.richCount=Math.max(survey.richCount,state.count);
  if(state.confirmed&&!survey.confirmed){survey.confirmed=true;survey.confirmedAt=time;}
  return {newSurvey:fresh,sampleConcentration:concentration,newRich:survey.richCount>oldCount,newDeposit:!wasConfirmed&&survey.confirmed};
}
export function surveySummary(survey){
  return {lastConcentration:survey.last?.concentration??null,bestConcentration:survey.best,
    concentrationDelta:survey.delta,uniqueProbes:survey.uniqueProbes,richCount:survey.richCount,confirmed:survey.confirmed};
}
