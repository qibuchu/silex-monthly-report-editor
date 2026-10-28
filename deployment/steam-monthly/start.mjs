import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createGateway} from './gateway.mjs';
const token=fs.readFileSync('/run/secrets/monthly_token','utf8').trim();
const config=JSON.parse(fs.readFileSync('/runtime/config.json','utf8'));
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;children.forEach(c=>c.kill('SIGTERM'));setTimeout(()=>process.exit(code),9000).unref();}
function launch(name,entry,cwd,env){const child=spawn(process.execPath,[entry],{cwd,env:{...process.env,...env},stdio:'inherit'});children.push(child);child.on('error',e=>{console.error(name,e.message);stop(1);});child.on('exit',code=>{if(!stopping){console.error(name,'exited',code);stop(1);}});}
launch('monthly-service','server.mjs','/app/pipeline/monthly-service',{REPORT_SERVICE_TOKEN:token,REPORT_SERVICE_CONFIG:'/runtime/config.json'});
launch('editor','dist/server/server/index.js','/app/work/silex-poc',{
 SILEX_PORT:'6805',SILEX_URL:config.silexUrl,SILEX_CLIENT_CONFIG:'/app/deployment/steam-monthly/client-config.js',
 SILEX_FS_ROOT:'/state/editor',SILEX_FS_HOSTING_ROOT:'/state/editor-exports',STORAGE_CONNECTORS:'fs',HOSTING_CONNECTORS:'download',
 SILEX_SESSION_SECRET:token,SILEX_CORS_URL:new URL(config.publicUrl).origin,NODE_ENV:'production',
});
createGateway({token,targetPort:4320,publicUrl:config.publicUrl,editorUrl:config.silexUrl}).listen(14320,'0.0.0.0');
createGateway({token,editor:true,targetPort:6805,publicUrl:config.publicUrl,editorUrl:config.silexUrl}).listen(16805,'0.0.0.0');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop());
