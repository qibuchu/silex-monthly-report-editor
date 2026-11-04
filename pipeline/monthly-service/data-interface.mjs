import http from 'node:http';import https from 'node:https';import {lookup} from 'node:dns/promises';
// Pin DNS and reject host-local/metadata targets. User-requested intranet business APIs remain supported.
const forbidden=ip=>ip==='::1'||ip==='::'||/^127\.|^0\.|^169\.254\./.test(ip)||/^fe[89ab]/i.test(ip)||ip.toLowerCase().startsWith('::ffff:');
export async function fetchDataInterface(input){
 let url;try{url=new URL(input.url);}catch{throw Error('接口地址无效');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('接口只支持HTTP/HTTPS GET，请将鉴权填写在请求头中');
 if(/localhost|metadata\.google/i.test(url.hostname))throw Error('不能请求本机或云主机元数据接口');
 const resolved=await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});if(!resolved.length||resolved.some(r=>forbidden(r.address)))throw Error('接口解析到本机或元数据地址');
 const headers=input.headers||{};if(typeof headers!=='object'||Array.isArray(headers)||Object.entries(headers).some(([k,v])=>!/^[\w-]+$/.test(k)||typeof v!=='string'||/[\r\n]/.test(v)||['host','cookie','connection','content-length'].includes(k.toLowerCase())))throw Error('接口请求头格式不支持');
 const timeoutMs=Math.min(Math.max(Number(input.timeoutMs)||15000,1000),600000);
 const maxBytes=Math.min(Math.max(Number(input.maxBytes)||5*1024*1024,1024),30*1024*1024);
 const data=await new Promise((resolve,reject)=>{
  const pinned=resolved[0],request=(url.protocol==='https:'?https:http).get(url,{headers,lookup:(_host,options,cb)=>options?.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family)},response=>{
   if(response.statusCode===401||response.statusCode===403){response.resume();reject(Object.assign(Error('接口凭据已失效或没有权限，请续期凭据后重新导入；本次数据未替换'),{status:424}));return;}
   if(response.statusCode<200||response.statusCode>=300){response.resume();reject(Error('接口返回HTTP '+response.statusCode+'，不自动跟随跳转'));return;}
   const chunks=[];let total=0;response.on('data',c=>{total+=c.length;if(total>maxBytes){response.destroy();reject(Error('接口数据超过大小限制'));}else chunks.push(c)});response.on('error',reject);response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Error('接口没有返回有效JSON'))}});
  });request.setTimeout(timeoutMs,()=>request.destroy(Error('接口请求超时')));request.on('error',reject);
 });
 const sourceUrl=new URL(url);for(const key of [...sourceUrl.searchParams.keys()])if(/token|key|secret|password|signature|credential|auth/i.test(key))sourceUrl.searchParams.delete(key);
 return {name:input.name||url.hostname,json:data,origin:'api:'+sourceUrl.toString()};
}
