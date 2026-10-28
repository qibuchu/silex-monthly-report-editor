const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2);
function run(command,argv,cwd=root){
 const windows=process.platform==='win32';
 // Commands and arguments below are fixed, never interpolated user text.
 const result=spawnSync(windows&&['npm','pnpm'].includes(command)?process.env.ComSpec||'cmd.exe':command,windows&&['npm','pnpm'].includes(command)?['/d','/c',command,...argv]:argv,{cwd,stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} ${argv.join(' ')} 失败`);
}
try{
 if(Number(process.versions.node.split('.')[0])<24)throw Error('需要Node.js 24或更新版本');
 const service=path.join(root,'pipeline/monthly-service'),editor=path.join(root,'work/silex-poc');
 if(args.includes('--install')){run('npm',['ci'],service);run('pnpm',['install','--filter','@silexlabs/silex','--frozen-lockfile','--config.confirmModulesPurge=false'],editor);}
 if(args.includes('--build')){run('npm',['run','build'],editor);run(process.execPath,[path.join(root,'tools/build-pptx-reader.cjs')]);run(process.execPath,[path.join(root,'tools/build-monthly-data-reader.cjs')]);}
 const toolkit=path.join(root,'releases/monthly-toolkit-portable');
 if(!fs.existsSync(toolkit))run(process.execPath,[path.join(root,'tools/package-monthly.cjs'),toolkit]);
 const required=['pipeline/monthly-service/node_modules/@modelcontextprotocol/sdk/package.json','pipeline/monthly-service/ui/pptx-reader.js','work/silex-poc/dist/client/index.html','work/silex-poc/dist/server/server/index.js','releases/monthly-toolkit-portable/run.cjs'];
 const missing=required.filter(file=>!fs.existsSync(path.join(root,file)));
 if(missing.length)throw Error('缺少：\n'+missing.join('\n')+'\n首次安装运行 node tools/prepare-demo.cjs --install --build');
 const files=[['pipeline/monthly-toolkit/run.cjs','run.cjs'],['work/silex-poc/scripts/monthly-report-adapter.cjs','lib/silex-adapter.cjs'],['outputs/monthly-editor/chart.js','outputs/monthly-editor/chart.js'],...['generate-draft.cjs','topic-template.cjs','topic-slots.json','market-details.cjs','market-source.cjs','binding-contract.cjs','page-layout.cjs','data-quality.cjs'].map(file=>['workflow/'+file,'workflow/'+file])];
 const outdated=files.filter(([source,dest])=>!fs.existsSync(path.join(toolkit,dest))||!fs.readFileSync(path.join(root,source)).equals(fs.readFileSync(path.join(toolkit,dest))));
 if(outdated.length)throw Error('生成器包与源码不同步，请用 tools/package-monthly.cjs 生成新目录并配置toolkitDir：\n'+outdated.map(([source])=>source).join('\n'));
 console.log('运行依赖、编辑器构建和生成器一致性检查通过。启动：node tools/start-demo.cjs');
}catch(error){console.error(error.message);process.exitCode=1;}
