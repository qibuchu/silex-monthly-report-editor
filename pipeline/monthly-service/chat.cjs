// Local AI fallback when a running chat has not reloaded its MCP tool list yet.
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const option = name => { const index=args.indexOf(name); return index<0?undefined:args[index+1]; };
(async () => {
  if (!args.length || args.includes('--help')) {
    console.log('node pipeline/monthly-service/chat.cjs context [--project ID]\nnode pipeline/monthly-service/chat.cjs TOOL_NAME --input arguments.json [--output result.json]\nUses REPORT_SERVICE_URL (HTTP base or /mcp) and optional REPORT_SERVICE_TOKEN.');
    return;
  }
  const name = args[0] === 'context' ? 'get_editing_context' : args[0];
  const input = option('--input');
  const values = input ? JSON.parse(fs.readFileSync(path.resolve(input),'utf8')) : option('--project') ? {projectId:option('--project')} : {};
  const endpoint=new URL(process.env.REPORT_SERVICE_URL || 'http://127.0.0.1:4320');
  const editingTargetId=option('--target')||process.env.REPORT_EDITING_TARGET||endpoint.searchParams.get('editingTargetId');
  endpoint.pathname='/api/call';endpoint.search='';endpoint.hash='';
  const headers={'Content-Type':'application/json'};
  if(process.env.REPORT_SERVICE_TOKEN)headers.Authorization='Bearer '+process.env.REPORT_SERVICE_TOKEN;
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({name,arguments:values,...(editingTargetId?{editingTargetId}:{})})});
  const result=await response.json();
  if(!response.ok)throw Error(`HTTP ${response.status}: ${result.error}`);
  const output=option('--output');
  if(output){fs.writeFileSync(path.resolve(output),JSON.stringify(result,null,2));console.log('Saved '+path.resolve(output));}
  else console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
