import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';

export function authenticated(req,token){
  const digest=createHash('sha256').update(token).digest('hex');
  const equal=(a,b)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
  return equal(String(req.headers.authorization||''),'Bearer '+token)||String(req.headers.cookie||'').split(';').some(c=>equal(c.trim(),'monthly_session='+digest));
}
export function createGateway({token,authMode='token',editor=false,targetPort,publicUrl,editorUrl}){
  if(!['token','network'].includes(authMode))throw Error('Invalid authentication mode');
  if(authMode==='token'&&(!token||token.length<32))throw Error('A strong service token is required');
  const origins=new Set([new URL(publicUrl).origin,new URL(editorUrl).origin]);
  const server=http.createServer((req,res)=>{
    if(editor&&authMode==='token'&&!authenticated(req,token)){
      res.writeHead(401,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return res.end(`<!doctype html><meta charset="utf-8"><title>请先登录月报工作台</title><p>请先在月报工作台输入访问令牌，再打开编辑器。</p><a href="${publicUrl}">打开月报工作台</a>`);
    }
    if(editor&&req.headers.origin&&!origins.has(req.headers.origin)){res.writeHead(403);return res.end('Invalid origin');}
    const proxy=http.request({hostname:'127.0.0.1',port:targetPort,path:req.url,method:req.method,headers:req.headers},upstream=>{
      res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);
    });
    proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});res.end('月报服务正在启动，请稍后重试。');});
    req.on('aborted',()=>proxy.destroy());res.on('close',()=>{if(!res.writableEnded)proxy.destroy();});req.pipe(proxy);
  });
  server.requestTimeout=300000;server.headersTimeout=65000;
  return server;
}
