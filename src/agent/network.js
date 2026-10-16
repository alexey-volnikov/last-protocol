// Маленькая настоящая MLP, без библиотек и сетевых API. Q-learning, не LLM.
export class QNetwork{
  constructor(inputs,hidden,outputs,random){
    this.inputs=inputs;this.hidden=hidden;this.outputs=outputs;
    this.w1=Array.from({length:inputs*hidden},()=>(random()*2-1)*Math.sqrt(3/inputs));
    this.b1=Array(hidden).fill(0);
    this.w2=Array.from({length:hidden*outputs},()=>(random()*2-1)*Math.sqrt(3/hidden));
    this.b2=Array(outputs).fill(0);
  }
  forward(x){
    const h=new Array(this.hidden),q=new Array(this.outputs);
    for(let j=0;j<this.hidden;j++){
      let z=this.b1[j];
      for(let i=0;i<this.inputs;i++)z+=x[i]*this.w1[j*this.inputs+i];
      h[j]=Math.tanh(z);
    }
    for(let a=0;a<this.outputs;a++){
      let z=this.b2[a];
      for(let j=0;j<this.hidden;j++)z+=h[j]*this.w2[a*this.hidden+j];
      q[a]=z;
    }
    return {h,q};
  }
  train(x,action,target,rate=.003){
    const {h,q}=this.forward(x);
    const error=Math.max(-1,Math.min(1,q[action]-target)); // Huber gradient
    for(let j=0;j<this.hidden;j++){
      const index=action*this.hidden+j;
      const delta=error*this.w2[index]*(1-h[j]*h[j]);
      this.w2[index]-=rate*error*h[j];
      for(let i=0;i<this.inputs;i++)this.w1[j*this.inputs+i]-=rate*delta*x[i];
      this.b1[j]-=rate*delta;
    }
    this.b2[action]-=rate*error;
  }
  save(){return {inputs:this.inputs,hidden:this.hidden,outputs:this.outputs,w1:[...this.w1],b1:[...this.b1],w2:[...this.w2],b2:[...this.b2]};}
  static load(data){
    const {inputs,hidden,outputs}=data||{};
    if(inputs!==29||hidden!==32||outputs!==5)throw new Error('Несовместимая архитектура модели');
    const net=new QNetwork(inputs,hidden,outputs,()=>.5);
    for(const [key,size] of [['w1',inputs*hidden],['b1',hidden],['w2',hidden*outputs],['b2',outputs]]){
      if(!Array.isArray(data[key])||data[key].length!==size||data[key].some(v=>!Number.isFinite(v)||Math.abs(v)>1e4))throw new Error('Повреждённые веса модели');
      net[key]=[...data[key]];
    }
    return net;
  }
}
