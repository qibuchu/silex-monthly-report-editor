const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const logs = path.join(root, 'work/demo-logs');
fs.mkdirSync(logs, { recursive: true });
const owned = [];
let stopping=false;
const restarts=new Map();
async function available(url,name) {
  let response;
  try { response=await fetch(url,{signal:AbortSignal.timeout(1800),headers:process.env.REPORT_SERVICE_TOKEN?{Authorization:`Bearer ${process.env.REPORT_SERVICE_TOKEN}`}:{}}); } catch { return false; }
  if(!response.ok)throw Error(`${name} 端口已有服务但返回HTTP ${response.status}，请检查令牌、端口和日志。`);
  if(name==='monthly-service'){
    const info=await response.json().catch(()=>({}));
    if(info.application!=='steam-monthly-service'||info.version!=='0.2.0')throw Error('4320端口服务版本不匹配，请保存编辑后停止旧服务，再重新启动。');
  }else if(!/Silex/i.test(await response.text()))throw Error('6805端口被其他程序占用，请检查后重新启动。');
  return true;
}
async function start(name, url, directory, entry, extra = {}) {
  if (await available(url,name)) { console.log(`${name} 已在运行`); return; }
  const file = path.join(directory, entry);
  if (!fs.existsSync(file)) throw Error(`缺少 ${file}，请先完成依赖安装与构建。`);
  const log = fs.openSync(path.join(logs, name + '.log'), 'a');
  const child = spawn(process.execPath, [file], { cwd: directory, env: { ...process.env, ...extra }, windowsHide: true, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  owned.push(child);
  let failure;
  child.on('error', error => { failure = error.message; });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (failure || child.exitCode !== null) throw Error(`${name} 启动失败：${failure || child.exitCode}。请查看 work/demo-logs/${name}.log`);
    if (await available(url,name)) {
      console.log(`${name} 已就绪`);
      child.once('exit',()=>{
        if(stopping)return;
        const count=(restarts.get(name)||0)+1;restarts.set(name,count);
        if(count>3){console.error(`${name} 多次异常退出，已停止自动重启，请查看日志。`);return;}
        console.error(`${name} 异常退出，准备第${count}次恢复；中断的生成任务需要重新提交。`);
        setTimeout(()=>{if(!stopping)start(name,url,directory,entry,extra).catch(error=>console.error(error.message));},1000);
      });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`${name} 启动超时，请查看 work/demo-logs/${name}.log`);
}
function stop() { stopping=true;for (const child of owned) if (child.exitCode === null) child.kill(); }
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
(async () => {
  const silex = path.join(root, 'work/silex-poc');
  await start('silex', 'http://localhost:6805/', silex, 'dist/server/server/index.js', {
    STORAGE_CONNECTORS: 'fs', SILEX_FS_ROOT: path.join(silex, 'silex/storage'), HOSTING_CONNECTORS: 'download',
  });
  await start('monthly-service', 'http://127.0.0.1:4320/api/health', path.join(root, 'pipeline/monthly-service'), 'server.mjs');
  console.log('\n打开 http://127.0.0.1:4320/\n保持本窗口运行；Ctrl+C 停止本次启动的服务。');
  // Keep the launcher alive even if both services were already running.
  setInterval(() => {}, 60000);
})().catch(error => { console.error(error.message); stop(); process.exit(1); });
