const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
try{
 const root=path.resolve(process.argv[2]||'releases/monthly-demo-0.2.0'),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('缺少文件清单');
 for(const file of manifest.files){const target=path.resolve(root,...file.path.split('/'));if(!target.startsWith(root+path.sep)||file.path.includes('\\')||file.path.split('/').includes('..'))throw Error('无效路径');const bytes=fs.readFileSync(target);if(bytes.length!==file.size||crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('校验失败：'+file.path);}
 console.log(`发布包${manifest.version}完整：${manifest.files.length}个文件，校验通过。`);
}catch(error){console.error(error.message);process.exitCode=1;}
