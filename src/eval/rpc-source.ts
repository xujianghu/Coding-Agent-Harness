/** 候选进程只获得 RPC 服务代码与待测源码，不挂载任何隐藏断言。 */
export const candidateRpcSource = String.raw`
const path = require('node:path');
const readline = require('node:readline');
const root = process.env.CANDIDATE_ROOT || '/candidate';
function encodeValue(value) {
  const nodes=[]; const seen=new Map();
  function encode(current,depth) {
    if(depth>64) throw new Error('RPC nesting limit');
    if(current===undefined) return {undefined:true};
    if(typeof current==='number') {
      if(Number.isNaN(current)) return {number:'nan'};
      if(current===Infinity) return {number:'infinity'};
      if(current===-Infinity) return {number:'-infinity'};
      if(Object.is(current,-0)) return {number:'-zero'};
      return current;
    }
    if(current===null || typeof current==='string' || typeof current==='boolean') return current;
    if(typeof current!=='object') throw new Error('RPC requires data values');
    if(seen.has(current)) return {ref:seen.get(current)};
    if(nodes.length>=10000) throw new Error('RPC node limit');
    const ref=nodes.length; seen.set(current,ref);
    const node={type:Array.isArray(current)?'array':'object',nullPrototype:Object.getPrototypeOf(current)===null,items:[]};
    nodes.push(node);
    node.items=Array.isArray(current)?current.map(item=>encode(item,depth+1)):Object.keys(current).map(key=>[key,encode(current[key],depth+1)]);
    return {ref};
  }
  return {root:encode(value,0),nodes};
}
function decodeValue(graph) {
  if(!graph || !Array.isArray(graph.nodes) || graph.nodes.length>10000) throw new Error('Invalid RPC graph');
  const objects=graph.nodes.map(node=>node.type==='array'?[]:node.type==='object'?(node.nullPrototype?Object.create(null):{}):(()=>{throw new Error('Invalid node');})());
  function decode(value) {
    if(value===null || typeof value==='string' || typeof value==='boolean' || typeof value==='number') return value;
    if(!value || typeof value!=='object') throw new Error('Invalid RPC value');
    if('ref' in value && Number.isInteger(value.ref) && value.ref>=0 && value.ref<objects.length) return objects[value.ref];
    if(value.undefined===true) return undefined;
    if(value.number==='nan') return NaN;
    if(value.number==='infinity') return Infinity;
    if(value.number==='-infinity') return -Infinity;
    if(value.number==='-zero') return -0;
    throw new Error('Invalid RPC scalar');
  }
  graph.nodes.forEach((node,index)=>{
    if(!Array.isArray(node.items) || node.items.length>10000) throw new Error('Invalid node contents');
    if(node.type==='array') for(const item of node.items) objects[index].push(decode(item));
    else for(const entry of node.items) {
      if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string') throw new Error('Invalid property');
      Object.defineProperty(objects[index],entry[0],{value:decode(entry[1]),enumerable:true,configurable:true,writable:true});
    }
  });
  return decode(graph.root);
}
const stream=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
let chain=Promise.resolve();
stream.on('line',line=>{
  chain=chain.then(async()=>{
    let request; const attempts=[];
    try {
      request=JSON.parse(line);
      if(typeof request.id!=='string'||!['call','retry'].includes(request.method)) throw new Error('Invalid RPC request');
      if(typeof request.module!=='string'||!/^([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.cjs$/.test(request.module)) throw new Error('Invalid module path');
      const exported=require(path.join(root,'src',request.module));
      const args=decodeValue(request.args);
      if(!Array.isArray(args)) throw new Error('Invalid arguments');
      let value;
      if(request.method==='retry') {
        const steps=args[0];
        value=await exported.retry(async attempt=>{
          attempts.push(attempt);
          const step=steps[attempts.length-1];
          if(!step) throw new Error('No callback result for attempt');
          if(Object.prototype.hasOwnProperty.call(step,'error')) throw new Error(step.error);
          return step.value;
        },args[1]);
      } else {
        if(typeof request.name!=='string'||typeof exported[request.name]!=='function') throw new Error('Missing exported function');
        value=await exported[request.name](...args);
      }
      process.stdout.write(JSON.stringify({type:'rpc-result',id:request.id,ok:true,data:encodeValue({value,argsAfter:args,attempts})})+'\n');
    } catch(error) {
      process.stdout.write(JSON.stringify({type:'rpc-result',id:request && request.id,ok:false,error:{name:error && error.name || 'Error',message:error && error.message || String(error),attempts}})+'\n');
    }
  }).catch(error=>{process.stderr.write(String(error));process.exitCode=1;stream.close();});
});
`;
