import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const file=path.join(os.homedir(),'.workbuddy','mcp.json');
const config=JSON.parse(fs.readFileSync(file,'utf8'));
const server=config.mcpServers?.['月报工作台'];
if(!server?.url||!server?.headers?.Authorization)throw Error('WorkBuddy 中尚未配置月报工作台 URL 或认证');
const client=new Client({name:'monthly-workbuddy-verify',version:'1.0.0'});
try{
 await client.connect(new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{headers:server.headers}}));
 const tools=(await client.listTools()).tools;
 const target=await client.callTool({name:'get_template_ai_target',arguments:{}});
 const result=JSON.parse(target.content?.find(c=>c.type==='text')?.text||'{}');
 if(target.isError)throw Error(result.error||'无法读取模板目标');
 console.log(JSON.stringify({connected:true,tools:tools.length,hasTemplateTool:tools.some(t=>t.name==='get_template_ai_target'),templateTarget:result.status,templateTitle:result.title||null}));
}finally{await client.close();}
