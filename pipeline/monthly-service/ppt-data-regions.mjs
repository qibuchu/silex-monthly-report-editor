// Virtual data regions preserve original PPT object IDs, coordinates and styles.
const text=o=>String(o.content||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
const key=s=>s.trim()==='#'?'#':s.replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
const labels=new Set(['#','排名','序号','游戏','游戏名','厂商','发行商','玩法','品类','环比','日均计划数','计划数环比','日均素材数','素材数环比','MAU（万）','MAU环比','抖音畅销排名','首次投放','冲榜时间','月均排名','收入','营收','数量','指标','数值','当月','上月'].map(key));
const box=o=>({x:parseFloat(o.style?.left)||0,y:parseFloat(o.style?.top)||0,w:parseFloat(o.style?.width)||0,h:parseFloat(o.style?.height)||0});
const contains=(a,b)=>a.x<=b.x+1&&a.y<=b.y+1&&a.x+a.w>=b.x+b.w-1&&a.y+a.h>=b.y+b.h-1;
function opaque(o){const bg=o.style?.background||o.style?.['background-color']||'';return !o.style?.transform&&o.style?.display!=='none'&&o.style?.visibility!=='hidden'&&Number(o.style?.opacity??1)===1&&(/^(?:#[a-f\d]{3}|#[a-f\d]{6}|white|black|rgb\([^)]*\))$/i.test(bg));}
export function detectPptDataRegions(project){
 const regions=[],excludedIds=new Set(),occludedIds=new Set();
 project.deck.pages.forEach((page,pageIndex)=>{
  const all=page.objects.map((o,index)=>({o,index,...box(o),text:text(o),id:o.attributes?.['data-object-id']}));
  const small=all.filter(v=>v.id&&v.text&&v.h>0&&v.h<=75&&v.w>0&&v.w<=600&&!/<(?:img|svg)\b/i.test(v.o.content)&&v.o.tagName!=='table'&&!['image','container','shape'].includes(v.o.attributes?.['data-kind'])&&v.o.style?.display!=='none'&&v.o.style?.visibility!=='hidden');
  const visible=small.filter(v=>{const covered=all.some(n=>n.index>v.index&&opaque(n.o)&&contains(n,v));if(covered)occludedIds.add(v.id);return !covered;});
  const bands=[];for(const v of visible.sort((a,b)=>a.y-b.y||a.x-b.x)){let band=bands.find(b=>Math.abs(b.y-v.y)<=4);if(!band){band={y:v.y,items:[]};bands.push(band);}band.items.push(v);}
  const pageText=all.filter(v=>v.y<160).map(v=>v.text).join(' ');
  const role=/畅玩榜/.test(pageText)?'most_played':/畅销榜/.test(pageText)?'bestseller':/新游/.test(pageText)?(/IAA|IA A/i.test(pageText)?'new_games.most_played':/IAP/i.test(pageText)?'new_games.bestseller':null):null;
  for(const band of bands){
   const headers=band.items.filter(v=>labels.has(key(v.text))).sort((a,b)=>a.x-b.x),groups=[];
   for(const h of headers){let group=groups.at(-1);if(!group||h.x-(group.at(-1).x+group.at(-1).w)>60){group=[];groups.push(group);}group.push(h);}
   for(const hs of groups){if(hs.length<3||new Set(hs.map(h=>key(h.text))).size!==hs.length)continue;
    const rows=[];let previous=band.y;const bottom=Math.min(Number(page.height)||1080,band.y+800);
    for(const dataBand of bands.filter(b=>b.y>band.y+Math.max(12,hs[0].h*.65)&&b.y<bottom)){
     if(dataBand.y-previous>Math.max(58,hs[0].h*3))break;
     let ambiguous=false;const cells=hs.map(h=>{const possible=dataBand.items.filter(v=>v.x+v.w/2>=h.x-6&&v.x+v.w/2<=h.x+h.w+6&&v.w<=h.w*1.55&&v.w>=Math.min(15,h.w*.35));if(possible.length>1)ambiguous=true;return possible[0]?.id||null;});
     if(!cells.some(Boolean))continue;
     if(ambiguous||cells.filter(Boolean).length<Math.max(3,Math.ceil(hs.length*.65)))break;
     rows.push(cells);previous=dataBand.y;
    }
    if(!rows.length)continue;
    const id='ppt-region:'+hs[0].id,columns=hs.map(h=>h.text),left=hs[0].x,right=hs.at(-1).x+hs.at(-1).w;
    const isCard=rows.length===1&&columns.some(c=>key(c)==='首次投放')&&role?.startsWith('new_games.');
    let titleObjectId=null,manualObjectIds=[];
    if(isCard){const title=visible.filter(v=>v.y<band.y-65&&v.y>band.y-180&&v.x>=left-5&&v.x+v.w<=right+12&&v.text.length<35&&!labels.has(key(v.text))).sort((a,b)=>(parseFloat(b.o.style['font-size'])||0)-(parseFloat(a.o.style['font-size'])||0))[0];titleObjectId=title?.id||null;
     // Images include title icons and raster charts, whose edges can extend beyond header cells.
     manualObjectIds=all.filter(v=>v.id!==titleObjectId&&v.x>=left-24&&v.x+v.w<=right+30&&v.y>= (/<img\b/i.test(v.o.content)?band.y-190:(title?.y||band.y-160)-3)&&v.y<Number(page.height||1080)-45&&(v.h>45||/<img\b/i.test(v.o.content))&&!rows.flat().includes(v.id)&&!hs.some(h=>h.id===v.id)).map(v=>v.id);
    }
    const region={id,pageIndex,page:page.name,name:isCard?'新游指标卡':'文字拼接表格',kind:'table',representation:'positioned-text',columns,headerObjectIds:hs.map(h=>h.id),cellObjectIds:rows,capacity:rows.length,index:0,sourceHint:role,label:pageText,bounds:{left,top:band.y,right,bottom:previous+hs[0].h},rowOffset:0,titleObjectId,manualObjectIds};
    regions.push(region);hs.forEach(h=>excludedIds.add(h.id));rows.flat().filter(Boolean).forEach(id=>excludedIds.add(id));if(titleObjectId)excludedIds.add(titleObjectId);manualObjectIds.forEach(id=>excludedIds.add(id));
   }
  }
 });
 for(const region of regions.filter(r=>r.titleObjectId)){const siblings=regions.filter(r=>r.pageIndex===region.pageIndex&&r.titleObjectId&&r.sourceHint===region.sourceHint).sort((a,b)=>a.bounds.left-b.bounds.left);region.rowOffset=siblings.indexOf(region);}
 return {regions,excludedIds,occludedIds};
}
