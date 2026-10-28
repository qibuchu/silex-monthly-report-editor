const fs = require('node:fs');
const path = require('node:path');
const {fileURLToPath} = require('node:url');
const {JSDOM, VirtualConsole} = require('jsdom');
const root = path.resolve(__dirname, '../silex/storage');
function dom(html) { return new JSDOM(html, {virtualConsole:new VirtualConsole()}); }
function editor() {
  const w=dom('<!doctype html><html><body></body></html>').window;
  global.window=w; global.document=w.document; global.DOMParser=w.DOMParser;
  const parser=require('grapesjs-parser-postcss');
  return require('grapesjs').init({headless:true,storageManager:false,plugins:[parser.default||parser]});
}
function write(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2));}
function cssRules(css){
  const rules=[];const postcss=require('postcss');
  function visit(node,atRuleType,mediaText){
    if(node.type==='rule'||node.type==='atrule'&&node.name==='font-face'){
      const style={};for(const d of node.nodes||[])if(d.type==='decl')style[d.prop]=d.value+(d.important?' !important':'');
      rules.push({selectors:[],selectorsAdd:node.type==='rule'?node.selector:'',style,...(node.name==='font-face'?{atRuleType:'font-face'}:atRuleType?{atRuleType,mediaText}: {})});
    }else if(node.nodes)for(const n of node.nodes)visit(n,node.type==='atrule'?node.name:atRuleType,node.type==='atrule'?node.params:mediaText);
  }
  let parsed;for(let attempt=0;attempt<10;attempt++){
    try{parsed=postcss.parse(css);break;}catch(error){
      if(error.reason!=='Unexpected }')throw error;
      const lines=css.split('\n');const line=error.line-1;const column=error.column-1;
      if(lines[line][column]!=='}')throw error;
      console.error('移除编辑副本中多余的 CSS 右括号：第 '+error.line+' 行');
      lines[line]=lines[line].slice(0,column)+lines[line].slice(column+1);css=lines.join('\n');
    }
  }
  if(!parsed)throw Error('CSS 无法修复');visit(parsed);return rules;
}
function importHtml(source,id){
  if(!/^[a-z0-9-]+$/.test(id))throw Error('项目ID仅允许小写字母、数字和连字符');
  const folder=path.join(root,id);if(fs.existsSync(folder))throw Error('项目已存在，请使用新项目ID，避免覆盖人工修改');
  const original=fs.readFileSync(source,'utf8');const d=dom(original).window.document;
  const base=d.querySelector('base')?.href||new URL('file:///'+path.dirname(source).replace(/\\/g,'/')+'/').href;
  const assets=[];
  function asset(url){
    if(!url||/^(data:|https?:|#)/i.test(url))return url;
    const resolved=new URL(url,base);if(resolved.protocol!=='file:')return url;
    const file=fileURLToPath(resolved);if(!fs.existsSync(file))throw Error('缺少本地资源：'+file);
    const name=assets.length+'-'+path.basename(file);const out=path.join(folder,'assets',name);
    fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(file,out);assets.push({source:file,name});
    return '/api/website/assets/'+encodeURIComponent(name)+'?websiteId='+id+'&connectorId=fs-storage';
  }
  const script=[...d.scripts].map(s=>s.textContent).join('\n');
  const match=script.match(/const weeklyImages\s*=\s*(\{[\s\S]*?\});/);
  if(match){const images=JSON.parse(match[1]);for(const el of d.querySelectorAll('[data-weekly-image-target]')){
    const src=images[el.getAttribute('data-weekly-image-target')];if(!src)continue;
    const img=d.createElement('img');img.src=src;img.alt=el.getAttribute('data-weekly-image-target');
    img.setAttribute('style','width:100%;height:100%;object-fit:cover');el.replaceChildren(img);el.classList.add('has-image');
  }}
  for(const img of d.images)img.setAttribute('src',asset(img.getAttribute('src')));
  const css=[...d.querySelectorAll('style')].map(s=>s.textContent).join('\n').replace(/url\(["']?([^"')]+)["']?\)/g,(_,u)=>'url("'+asset(u)+'")');
  d.querySelectorAll('script,style,base').forEach(el=>el.remove());
  let count=0;const ids=new Set();for(const el of d.body.querySelectorAll('*')){
    let objectId=el.id||'weekly-'+String(++count).padStart(4,'0');while(ids.has(objectId))objectId+='-copy';ids.add(objectId);
    el.id=objectId;el.setAttribute('data-object-id',objectId);
  }
  const e=editor();e.setComponents(d.body.innerHTML);e.setStyle(css);
  const project=e.getProjectData();project.styles=[...cssRules(css),...project.styles.filter(s=>s.selectors?.some(x=>typeof x==='object'?x.type===2:String(x).startsWith('#')))];project.pages[0].id='weekly-index';project.pages[0].name='index';
  const page=project.pages[0];project.pages=[{id:page.id,name:'index',isFile:true}];project.pagesFolder='pages';
  project.settings={title:d.title,lang:'zh-CN'};project.publication={};project.symbols=[];
  write(path.join(folder,'pages/index-weekly-index.json'),page);write(path.join(folder,'website.json'),project);
  write(path.join(folder,'meta.json'),{name:'周报邮件 · 9.21–9.27',connectorUserSettings:{}});
  fs.writeFileSync(path.join(folder,'original.html'),original);write(path.join(folder,'import-audit.json'),{source,assets,objects:ids.size,images:d.images.length,tables:d.querySelectorAll('table').length});
  e.destroy();console.log(JSON.stringify({folder,objects:ids.size,images:d.images.length,url:'http://localhost:6805/?id='+id+'&connectorId=fs-storage&lang=zh'}));
}
function exportHtml(id,out){
  const folder=path.join(root,id);const project=JSON.parse(fs.readFileSync(path.join(folder,'website.json')));
  project.pages=project.pages.map(p=>JSON.parse(fs.readFileSync(path.join(folder,'pages/index-'+p.id+'.json'))));
  const e=editor();e.loadProjectData(project);const html='<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>周报编辑导出</title><style>'+e.getCss()+'</style></head><body>'+e.getHtml()+'</body></html>';
  const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ttf':'font/ttf','.woff2':'font/woff2'};
  const portable=html.replace(/\/api\/website\/assets\/([^?"')]+)\?websiteId=[^&"')]+(?:&amp;|&)connectorId=fs-storage/g,(_,name)=>{
    const file=path.join(folder,'assets',decodeURIComponent(name));
    return 'data:'+(mime[path.extname(file).toLowerCase()]||'application/octet-stream')+';base64,'+fs.readFileSync(file).toString('base64');
  });
  fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,portable);e.destroy();console.log(JSON.stringify({output:path.resolve(out),status:'portable browser-html; email compatibility not verified'}));
}
const [mode,...args]=process.argv.slice(2);
try{if(mode==='import')importHtml(...args);else if(mode==='export')exportHtml(...args);else throw Error('用法：node scripts/weekly-html.cjs import <html路径> <新项目ID> 或 export <项目ID> <输出html>');}catch(e){console.error(e.message);process.exitCode=1;}
