import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const configPath=path.join(os.homedir(),'.workbuddy','mcp.json');
let serviceUrl=process.env.REPORT_SERVICE_URL||'';
let token=process.env.REPORT_SERVICE_TOKEN||'';
if((!serviceUrl||!token)&&fs.existsSync(configPath)){
 const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
 const connection=config.mcpServers?.['月报工作台'];
 if(connection?.url&&connection?.headers?.Authorization){
  serviceUrl||=String(connection.url);
  token||=String(connection.headers.Authorization).replace(/^Bearer\s+/i,'');
 }
}
if(!serviceUrl||!token||token.includes('<访问令牌>')){
 console.error('找不到已配置的月报工作台地址或访问令牌。请先在 WorkBuddy 连接器中完成配置，或设置 REPORT_SERVICE_URL 和 REPORT_SERVICE_TOKEN。');
 process.exit(2);
}
const endpoint=new URL(serviceUrl);
if(!['http:','https:'].includes(endpoint.protocol))throw Error('月报服务地址必须是 HTTP(S)');
endpoint.pathname='/';endpoint.search='';endpoint.hash='';
const worker=spawn(process.execPath,[fileURLToPath(new URL('./template-ai-worker.mjs',import.meta.url)),'--watch'],{
 env:{...process.env,REPORT_SERVICE_URL:endpoint.toString(),REPORT_SERVICE_TOKEN:token},stdio:'inherit',windowsHide:true
});
console.log('本地 PPT AI 识别器已启动，将自动处理新上传的模板。关闭此终端将停止识别。');
worker.on('exit',code=>{process.exitCode=code||0;});
