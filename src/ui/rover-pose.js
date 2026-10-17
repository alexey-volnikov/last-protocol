// Только представление: движок и наблюдения агента эти позы не получают.
export const roverPose=rover=>({x:rover.x,y:rover.y,heading:rover.heading});
export function interpolatePose(before,after,fraction){
  const t=Math.max(0,Math.min(1,fraction));
  // Движок хранит непрерывный угол; соседний физический шаг не больше 0.28 rad.
  return {x:before.x+(after.x-before.x)*t,y:before.y+(after.y-before.y)*t,
    heading:before.heading+(after.heading-before.heading)*t};
}
