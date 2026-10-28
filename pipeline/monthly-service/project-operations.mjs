import {randomUUID} from 'node:crypto';

const fail = message => { throw Object.assign(Error(message), {status:400}); };
const objectId = object => object?.attributes?.['data-object-id'];
const children = node => Array.isArray(node?.components) ? node.components : [];
export function canvas(page) {
  const visit = node => {
    if (node?.attributes?.['data-report-page'] || node?.attributes?.['data-pptx-page']) return node;
    for (const child of children(node)) { const found=visit(child); if(found)return found; }
  };
  return visit(page?.frames?.[0]?.component || page?.component);
}
function nativeComponent(object) {
  return {tagName:object.tagName || 'div',type:object.attributes?.['data-kind']==='text'?'text':'default',name:object.attributes?.['data-name'],attributes:{...object.attributes,id:objectId(object)},classes:object.classes || ['object'],style:{...object.style},components:object.content};
}
function findNode(root,id) {
  if(objectId(root)===id)return root;
  for(const child of children(root)){const found=findNode(child,id);if(found)return found;}
}
export function syncNativePatch(project,changes) {
  if(!project.silexState)return;
  for(const change of changes){
    const nodes=project.silexState.pages?.map(p=>findNode(canvas(p),change.id)).filter(Boolean) || [];
    if(nodes.length!==1)fail(`原生编辑状态无法唯一定位对象 ${change.id}，已停止保存，未重建或丢弃原生状态。`);
    const node=nodes[0];
    if(change.style)node.style={...node.style,...change.style};
    if(change.name!==undefined){node.name=change.name;node.attributes={...node.attributes,'data-name':change.name};}
    if(change.content!==undefined){
      // Only the explicitly replaced object's inner content changes. Preserve
      // traits, symbols, page settings and all other components verbatim.
      node.components=change.content;delete node.content;
      if(node.tagName==='img'||node.type==='image'){
        node.tagName='div';node.type='default';delete node.attributes.src;delete node.attributes.alt;
      }
    }
  }
}
function freshObject(source,ids=new Map()) {
  const copy=structuredClone(source);
  const original=objectId(copy);if(original)ids.set(original,`ai-${randomUUID()}`);
  for(const match of copy.content?.matchAll(/\bid=["']([^"']+)["']/g) || [])if(!ids.has(match[1]))ids.set(match[1],`ai-${randomUUID()}`);
  const rename = text => {
    for(const [old,id] of ids){const escaped=old.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');text=text.replace(new RegExp(`(\\bid=["']|["']#|url\\(#)${escaped}(?=["')])`,'g'),`$1${id}`);}
    return text;
  };
  copy.content=rename(copy.content || '');
  copy.attributes={...copy.attributes,id:ids.get(original)||`ai-${randomUUID()}`};
  copy.attributes['data-object-id']=copy.attributes.id;
  copy.attributes['data-binding-id']=copy.attributes.id;
  return copy;
}
function duplicate(project,source,native) {
  const ids=new Map();
  const collect=node=>{if(node?.attributes?.id)ids.set(node.attributes.id,`ai-${randomUUID()}`);children(node).forEach(collect);};
  if(native)collect(native);
  const object=freshObject(source,ids);
  if(!native)return {object};
  ids.set(objectId(source),objectId(object));
  if(native.attributes?.id)ids.set(native.attributes.id,objectId(object));
  const rewrite=value=>{
    if(typeof value==='string'){
      if(ids.has(value))return ids.get(value);
      for(const [old,id] of ids){const escaped=old.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');value=value.replace(new RegExp(`#${escaped}(?![\\w-])`,'g'),'#'+id).replace(new RegExp(`(\\bid=["'])${escaped}(?=["'])`,'g'),`$1${id}`);}
      return value;
    }
    if(Array.isArray(value))return value.map(rewrite);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)]));
    return value;
  };
  const node=rewrite(native);node.attributes={...node.attributes,...object.attributes};
  node.style={...node.style,...object.style};
  const rules=project.silexState.styles;
  if(Array.isArray(rules))rules.push(...rules.filter(rule=>(rule.selectors||[]).some(s=>typeof s==='string'?rewrite(s)!==s:s.type===2&&ids.has(s.name))).map(rewrite));
  return {object,node};
}
export function applyStructure(project,operations) {
  if(!Array.isArray(operations)||!operations.length||operations.length>100)fail('operations须包含1到100项操作');
  const value=structuredClone(project),pages=value.deck.pages,native=value.silexState?.pages;
  if(value.silexState&&(!Array.isArray(native)||native.length!==pages.length||native.some(p=>!canvas(p))))fail('原生页面结构不一致，已停止保存');
  const addedObjectIds=[];
  const pageAt=index=>{if(!Number.isInteger(index)||!pages[index])fail('无效页码（从0开始）');return pages[index];};
  const indexAt=(index,max)=>{if(index===undefined)return max;if(!Number.isInteger(index)||index<0||index>max)fail('无效插入位置');return index;};
  const locate=id=>{for(let p=0;p<pages.length;p++){const i=pages[p].objects.findIndex(o=>objectId(o)===id);if(i>=0)return {p,i,object:pages[p].objects[i]};}fail(`对象不存在：${id}`);};
  const insert=(p,index,object,node)=>{
    const target=pageAt(p);index=indexAt(index,target.objects.length);target.objects.splice(index,0,object);
    if(native){const root=canvas(native[p]);if(!Array.isArray(root.components))fail('原生页面组件不是数组');root.components.splice(index,0,node || nativeComponent(object));}
  };
  const remove=entry=>{
    pages[entry.p].objects.splice(entry.i,1);
    if(native){const root=canvas(native[entry.p]);const i=children(root).findIndex(o=>objectId(o)===objectId(entry.object));if(i<0)fail('原生对象不存在');return root.components.splice(i,1)[0];}
  };
  const nativePage=page=>{const id=`ai-page-${randomUUID()}`;return {id,name:page.name,frames:[{width:page.width||1920,height:page.height||1080,component:{type:'wrapper',components:[{tagName:'section',attributes:{id:`${id}-canvas`,'data-report-page':'true'},classes:['slide','monthly-report-slide'],style:{width:`${page.width||1920}px`,height:`${page.height||1080}px`,background:page.background||'#fff'},components:page.objects.map(nativeComponent)}]}}]};};
  for(const operation of operations){
    if(!operation||typeof operation!=='object')fail('无效结构操作');
    const fields={add_object:['pageIndex','index','object'],remove_object:['id'],move_object:['id','pageIndex','index'],duplicate_object:['id','pageIndex','index','style'],add_page:['index','name','width','height','background'],remove_page:['pageIndex'],move_page:['pageIndex','index'],duplicate_page:['pageIndex','index','name']}[operation.op];
    if(!fields||Object.keys(operation).some(k=>k!=='op'&&!fields.includes(k)))fail('无效结构操作字段');
    if(operation.width!==undefined&&(!Number.isInteger(operation.width)||operation.width<1||operation.width>8192))fail('页面宽度须为1到8192');
    if(operation.height!==undefined&&(!Number.isInteger(operation.height)||operation.height<1||operation.height>8192))fail('页面高度须为1到8192');
    switch(operation.op){
      case 'add_object': {
        const object=structuredClone(operation.object);if(!object||typeof object.content!=='string'||!object.style)fail('新对象须提供content和style');
        if(/<script\b|\bon\w+\s*=|javascript:/i.test(object.content)||Object.keys(object.attributes||{}).some(k=>/^on/i.test(k)))fail('Invalid HTML content');
        if(object.tagName&&!['div','table','section','p'].includes(object.tagName))fail('无效对象标签');
        object.attributes={...object.attributes,'data-object-id':`ai-${randomUUID()}`,'data-kind':object.attributes?.['data-kind']||'container','data-content-layer':'manual','data-refresh-policy':'preserve'};
        object.attributes.id=objectId(object);object.classes=[...new Set(['object',...(object.classes||[])])];
        insert(operation.pageIndex,operation.index,object);addedObjectIds.push(objectId(object));break;
      }
      case 'remove_object':remove(locate(operation.id));break;
      case 'move_object':{const entry=locate(operation.id);pageAt(operation.pageIndex);const node=remove(entry);insert(operation.pageIndex,operation.index,entry.object,node);break;}
      case 'duplicate_object':{const entry=locate(operation.id),copy=duplicate(value,entry.object,native&&findNode(canvas(native[entry.p]),operation.id));copy.object.style={...copy.object.style,...operation.style};if(copy.node)copy.node.style={...copy.node.style,...operation.style};insert(operation.pageIndex??entry.p,operation.index,copy.object,copy.node);addedObjectIds.push(objectId(copy.object));break;}
      case 'add_page':{const index=indexAt(operation.index,pages.length),page={name:operation.name||'新页面',width:operation.width||1920,height:operation.height||1080,background:operation.background||'#ffffff',objects:[]};pages.splice(index,0,page);if(native)native.splice(index,0,nativePage(page));break;}
      case 'remove_page':pageAt(operation.pageIndex);if(pages.length===1)fail('至少保留一页');pages.splice(operation.pageIndex,1);native?.splice(operation.pageIndex,1);break;
      case 'move_page':{pageAt(operation.pageIndex);const index=indexAt(operation.index,pages.length-1);pages.splice(index,0,pages.splice(operation.pageIndex,1)[0]);if(native)native.splice(index,0,native.splice(operation.pageIndex,1)[0]);break;}
      case 'duplicate_page':{const source=pageAt(operation.pageIndex),index=indexAt(operation.index,pages.length),sourceNative=native?.[operation.pageIndex];const copies=source.objects.map(o=>duplicate(value,o,sourceNative&&findNode(canvas(sourceNative),objectId(o))));const page={...structuredClone(source),name:operation.name||`${source.name}（副本）`,objects:copies.map(c=>c.object)};pages.splice(index,0,page);if(native){const copy=structuredClone(sourceNative);copy.id=`ai-page-${randomUUID()}`;copy.name=page.name;for(const frame of copy.frames||[])frame.id=`ai-frame-${randomUUID()}`;const root=canvas(copy);const renameWrappers=node=>{if(node===root)return;if(node?.attributes?.id)node.attributes.id=`ai-wrapper-${randomUUID()}`;children(node).forEach(renameWrappers);};for(const frame of copy.frames||[])renameWrappers(frame.component);root.attributes={...root.attributes,id:`${copy.id}-canvas`};root.components=copies.map(c=>c.node);native.splice(index,0,copy);}addedObjectIds.push(...page.objects.map(objectId));break;}
      default:fail(`不支持的操作：${operation.op}`);
    }
  }
  value.current=Math.min(value.current||0,pages.length-1);
  const originals=new Map(project.deck.pages.flatMap((p,index)=>p.objects.map(o=>[objectId(o),{object:o,page:project.silexState?.pages?.[index]?.id,canonical:p}])));
  for(const [index,page] of pages.entries())for(const object of page.objects){
    const original=originals.get(objectId(object));
    if(original&&JSON.stringify(original.object.style)===JSON.stringify(object.style)&&(native?native[index].id===original.page:page.name===original.canonical.name))continue;
    const style=object.style;if(!style||Array.isArray(style)||Object.entries(style).some(([key,val])=>!/^[-a-z][a-z-]*$/.test(key)||!['number','string'].includes(typeof val)))fail('无效对象样式');
    const [x,y,w,h]=['left','top','width','height'].map(key=>Number.parseFloat(style[key]));
    if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<=0||h<=0||x+w>(page.width||1920)||y+h>(page.height||1080))fail('Object geometry outside slide bounds');
  }
  return {project:value,addedObjectIds};
}
