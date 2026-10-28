import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {aiOutputSchema} from './template-ai.mjs';

const base=process.env.REPORT_SERVICE_URL||'http://127.0.0.1:4320';
const token=process.env.REPORT_SERVICE_TOKEN||'';
const args=new Set(process.argv.slice(2));
const watch=args.has('--watch');
const templateId=process.argv.find((a,i)=>process.argv[i-1]==='--template');
const model=process.argv.find((a,i)=>process.argv[i-1]==='--model');
if(!templateId&&!watch){console.error('用法: node template-ai-worker.mjs --template 模板ID [--watch] [--model 模型名]；或 --watch 监听所有新模板');process.exit(2);}
async function call(name,input){const response=await fetch(new URL('/api/call',base),{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({name,arguments:input})});const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);return result;}
async function codex(task){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-template-ai-'));const schema=path.join(folder,'schema.json'),output=path.join(folder,'result.json');
 try{fs.writeFileSync(schema,JSON.stringify(aiOutputSchema));const command=process.env.CODEX_CLI||'codex';const cli=['exec','--ephemeral','--skip-git-repo-check','-s','read-only','--output-schema',schema,'-o',output];if(model)cli.push('--model',model);cli.push('-');
  await new Promise((resolve,reject)=>{const child=spawn(command,cli,{stdio:['pipe','inherit','inherit'],windowsHide:true});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`本地AI进程退出码 ${code}`)));child.stdin.end(JSON.stringify(task.prompt));});
  return JSON.parse(fs.readFileSync(output,'utf8'));
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
}
async function run(){let done=0;for(;;){const task=await call('get_template_ai_task',{...(templateId?{templateId}:{}),mode:'local'});if(task.status==='empty'||task.status==='stale')return done;
 try{const result=await codex(task);await call('submit_template_ai_task',{taskId:task.taskId,projectRevision:task.projectRevision,decisions:result.decisions});done++;console.log(`已完成 ${done} 个批次`);}
 catch(error){await call('fail_template_ai_task',{taskId:task.taskId,error:error.message});console.error('AI识别失败:',error.message);return done;}}
}
do{try{await run();}catch(error){console.error(error.message);if(!watch)process.exitCode=1;}if(watch)await new Promise(resolve=>setTimeout(resolve,5000));}while(watch);
