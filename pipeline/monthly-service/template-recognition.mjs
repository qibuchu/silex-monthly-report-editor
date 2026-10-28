// Deterministic, local recognition. It proposes bindings, never infers business formulas.
import {detectPptDataRegions} from './ppt-data-regions.mjs';
export const bindingLabels={
 'report.period_text':'按目标月份更新原文字中的月份/截止日期',
 'report.title':'封面标题','report.period_label':'封面期间标签','report.version':'版本/期间',
 'head.top20':'头部游戏营收榜','market.review_trend':'玩家评价趋势表',
 'market.kpi.release_total':'大盘上新总量','market.kpi.release_growth':'大盘上新增速',
 'market.kpi.review_total':'大盘评测总数','market.kpi.positive_rate':'大盘总体好评率',
 'market.chart.release_total':'月度新品数量图','market.chart.daily_average':'日均上新趋势图',
 'market.month_1.total':'最近月上新数量标注','market.month_2.total':'前一月上新数量标注','market.month_3.total':'前两月上新数量标注',
 'new_releases.gold':'新游金榜','new_releases.silver':'新游银榜','new_releases.bronze':'新游铜榜',
 'topics.hot.title':'热门新游标题','topics.indie.0.title':'亮眼独游一标题','topics.indie.1.title':'亮眼独游二标题',
};
export const pageRoleLabels={cover:'封面',head:'头部榜单',movement:'游戏异动分析',market:'大盘总览',releases:'新游榜单',hot:'热门新游',indie:'亮眼独游',other:'待确认页面'};
const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const compact=s=>clean(s).replace(/\s/g,'');
function roleFor(page){
 const heading=page.objects.filter(o=>Number.parseFloat(o.style?.top||'0')<Number(page.height||1080)*.23).map(o=>clean(o.content)).join(' ');
 const text=compact(heading+' '+page.name);
 if(/新品概况|大盘总览|Bro[ad]+erMarket/i.test(text))return 'market';
 if(/热门新游/.test(text))return 'hot';
 if(/新游.*[金银铜]榜|[金银铜]榜.*游戏|金银榜/.test(text))return 'releases';
 if(/头部.*(?:排名|榜单|概况)|营收排名概况/.test(text))return 'head';
 if(/亮眼独游|独游推荐|独立游戏/.test(text))return 'indie';
 if(/头部异动|游戏异动|Movement/i.test(text))return 'movement';
 if(/(?:Steam|小游戏)\d{1,2}月(?:月报|月度报告)|^\d{1,2}月.{0,30}排名概况$|Steam.*月报|月报封面/i.test(text))return 'cover';
 return 'other';
}
function chartBinding(o,role){
 if(role!=='market')return null;
 let c;try{c=JSON.parse(o.attributes?.['data-pptx-chart']||'null');}catch{return null;}
 const labels=compact([c?.title,...(c?.series||[]).map(s=>s.name)].join(' '));
 if(/日均.*(?:上新|上线)|日均上新/.test(labels))return ['market.chart.daily_average','图表系列明确标为日均上新'];
 if(/发售即解封|月度新品数|上新数量/.test(labels)&&! /AI|人工智能/i.test(labels))return ['market.chart.release_total','图表系列包含发售即解封/上新数量'];
 return null;
}
function sourceRequirements(project,objects){
 const text=clean(project.deck.pages.map(p=>p.name+' '+p.objects.map(o=>o.content).join(' ')).join(' '));
 const sources=[];
 if(/小游戏|微信.*(?:畅销|畅玩|榜)|AdXray/i.test(text)){
  if(/AdXray|买量/i.test(text))sources.push({name:'AdXray / 买量数据源',fields:'目标月买量大盘、产品/品类排名及模板所需环比'});
  if(/IAP|畅销榜/i.test(text))sources.push({name:'微信小游戏 IAP / 畅销榜数据源',fields:'目标月榜单排名、游戏名、收入及模板所需变化指标'});
  if(/IAA|畅玩榜/i.test(text))sources.push({name:'微信小游戏 IAA / 畅玩榜数据源',fields:'目标月榜单、游戏名、品类异动及模板所需变化指标'});
  if(!sources.length)sources.push({name:'小游戏业务数据源',fields:'目标月榜单、大盘及模板所需业务指标'});
 }
 const businessBindings=objects.filter(o=>o.mode==='auto'&&o.binding&&!o.binding.startsWith('report.')).length;
 const status=sources.length?'new-source-required':businessBindings?'existing-source':'needs-confirmation';
 return {status,domain:sources.length?'微信小游戏':businessBindings?'Steam':'待确认',provider:status==='existing-source'?'SteamAuto':null,
  title:status==='new-source-required'?'识别到新的业务模板，请上传对应数据源':status==='needs-confirmation'?'数据源尚未确认，请提供数据源或目标月数据文件':'已匹配现有 SteamAuto 数据源',
  sources:sources.length?sources:status==='needs-confirmation'?[{name:'待确认的数据源',fields:'请提供该模板使用的数据平台/Skill、字段说明及目标月数据文件'}]:[],
  instructions:['请在“导入数据并匹配”上传目标月份Excel（.xlsx）、CSV/TSV、JSON，或读取GET JSON数据接口。','根据来源数据的表头、指标名称与图表系列核对填充位置；缺失或有歧义的字段可手动选择或留空。','确认映射后可生成独立可编辑预览稿；接口鉴权请求头只用于当次读取，不保存。历史数据必须匹配统计窗口，不从PPT样例推算公式。']};
}
export function analyzePptxTemplate(project){
 const pages=[],objects=[];
 for(const [pageIndex,page] of project.deck.pages.entries()){
  const role=roleFor(page),rows=[];
  for(const o of page.objects){
   let headerCells=[];
   const a=o.attributes||{},id=a['data-object-id'],text=clean(o.content),c=compact(text),kind=a['data-kind'],pptKind=a['data-pptx-kind'];
   const row={id,pageIndex,name:a['data-name']||id,mode:'blank',confidence:'review',reason:'未匹配到明确数据字段；保留位置，生成时留空',sample:text.slice(0,150),kind};
   const set=(mode,reason,binding)=>Object.assign(row,{mode,reason,confidence:'high',...(binding?{binding}: {})});
   if(kind==='shape'&&!text)set('static','纯装饰对象，固定保留');
   else if(a['data-content-layer']==='template'&&text&&!/\d/.test(c))set('static','已标记的固定模板装饰/品牌');
   else if(kind==='image'&&/master-image|layout-image/.test(id))set('static','继承的母版/布局图片，建议作为固定装饰');
   else if(kind==='image')row.reason='配图用途无法从图片内容确认，留作人工上传';
   else if(kind==='container')row.reason='组合含多种内容，需要拆分或人工确认，不整体绑定数据';
   else if(kind==='table'||o.tagName==='table'){
    const rawRows=[...o.content.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0,3);
    headerCells=rawRows.map(r=>[...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>compact(m[1]))).find(cells=>cells.length>1)||[];
    const topRows=rawRows.map(m=>compact(m[1])).join(' ');
    if(/定级率|即解锁率/.test(c)&&/简中好评率/.test(c)&&/总[测评]{2}数|总评论数|总评测/.test(c))set('auto','表格包含定级/解锁、总评测、好评及简中好评字段','market.review_trend');
    else if(role==='head'&&/游戏/.test(topRows)&&/营收榜排名环比|排名环比/.test(topRows)&&/环比|涨幅/.test(topRows))set('auto','头部榜页面，表头包含游戏、涨幅与排名环比','head.top20');
    else if(/游戏/.test(topRows)&&/预估收入|预估营收/.test(topRows)&&/上线14日玩家数量环比/.test(topRows)){
     const tiers=[['金榜','gold'],['银榜','silver'],['铜榜','bronze']].filter(([label])=>topRows.includes(label));
     if(tiers.length===1)set('auto',`${tiers[0][0]}表头与收入、上线14日玩家环比字段一致`,'new_releases.'+tiers[0][1]);
     else row.reason='表头可匹配新游榜，但金/银/铜归属不明确，请选择榜单绑定';
    }else row.reason=/DAU|日活/.test(c)?'包含DAU/日活字段，不可用PCU替代，请核对数据源':'表格类型或列口径不明确，请人工确认；不会按位置猜测';
   }else if(pptKind==='chart'||a['data-pptx-chart']){
    const match=chartBinding(o,role);if(match)set('auto',match[1],match[0]);else row.reason='图表系列未能明确匹配；活动营收与研究图不从样例推算';
   }else if(text){
    if(role==='market'&&/上新总量|上线总量/.test(c)&&/\d/.test(c)&&c.length<100)set('auto','指标卡同时包含上新总量标签与数值','market.kpi.release_total');
    else if(role==='market'&&/新品增量|上新增速|新品增速/.test(c)&&/%/.test(c)&&c.length<100)set('auto','指标卡同时包含增量/增速标签与百分比','market.kpi.release_growth');
    else if(role==='market'&&/测评总数|评测总数|总评测数/.test(c)&&/\d/.test(c)&&c.length<100&&!/局限|剔除|历史/.test(c))set('auto','指标卡包含评测总数标签及数值','market.kpi.review_total');
    else if(role==='market'&&/总好评率/.test(c)&&/%/.test(c)&&c.length<100&&!/简中/.test(c))set('auto','指标卡包含总体好评率及百分比','market.kpi.positive_rate');
    else if(c.length<100&&/(?:(?:Steam|小游戏)\d{1,2}月(?:月报|月度报告)|^\d{1,2}月.{0,30}排名概况$|\d{4}年\d{1,2}月.*(?:榜|概况)|\d{1,2}月热门新游|^\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?(?:截止|截至|\/)?)|DATE.*\d{4}[./-]\d{1,2}|MiniGames.*20\d{2}[./-]\d{1,2}/i.test(c))set('auto','明确的月报标题/日期，只按目标月更新期间，保留原措辞','report.period_text');
    else if(/^\d{1,3}\/\d{1,3}$/.test(c))set('static','页码由最终模板页面数统一更新');
    else if(c.length<100&&/^(?:PCGAMESRESEARCH|RESEARCHTEAM|研究团队|研究组|DATA\b|DATE\s*\/\s*VER)/i.test(c)&&! /\d/.test(c))set('static','品牌、署名或数据来源标签');
    else if(c.length<55&&!/\d/.test(c)&&(/头部.*(?:原因|概况)|玩家评价趋势|整体活动框架|局内玩法拓展|局外商业化结构|观点总结|大盘总览|头部异动|月度新品数|日均上线趋势|新游.*榜|BroderMarket|Movement/.test(c)))set('static','页面/区块标题，保留原文');
    else if(/局限|剔除|口径|DAU|日活/.test(c))row.reason='包含统计口径或历史说明，需核对适用月份与公式，默认留空';
    else if(['movement','hot','indie'].includes(role))row.reason='活动分析、游戏研究或观点内容，需AI研究/人工填写';
   }
    if(row.mode==='auto'&&row.binding==='head.top20'&&(headerCells.length!==4||! /排名/.test(headerCells[0])||! /游戏/.test(headerCells[1])||! /排名/.test(headerCells[3]))){row.suggestedBinding=row.binding;delete row.binding;row.mode='blank';row.confidence='review';row.reason='已识别头部榜，但列数或顺序不同，需核对列映射后绑定';}
    if(row.mode==='auto'&&/^new_releases\./.test(row.binding)&&(headerCells.length!==5||! /排名/.test(headerCells[0])||! /游戏/.test(headerCells[1])||! /收入|营收/.test(headerCells[3])||! /14日玩家/.test(headerCells[4]))){row.suggestedBinding=row.binding;delete row.binding;row.mode='blank';row.confidence='review';row.reason='已识别新游榜，但列数或顺序与数据契约不同，需核对列映射后绑定';}
   rows.push(row);objects.push(row);
  }
  // Do not select one of several objects merely because it comes first.
  const groups=new Map();for(const row of rows)if(row.binding&&row.binding!=='report.period_text'){const list=groups.get(row.binding)||[];list.push(row);groups.set(row.binding,list);}
  for(const list of groups.values())if(list.length>1)for(const row of list){row.suggestedBinding=row.binding;delete row.binding;row.mode='blank';row.confidence='review';row.reason='同页出现多个候选对象，需确认具体绑定位置';}
  pages.push({pageIndex,name:page.name,role,label:pageRoleLabels[role],objects:rows.length,automatic:rows.filter(r=>r.mode==='auto').length,review:rows.filter(r=>r.confidence==='review').length});
 }
 const dataSource=sourceRequirements(project,objects);
 // Similar headings in a different business domain must not bind Steam values.
 if(dataSource.status==='new-source-required'){
  for(const o of objects)if(o.mode==='auto'&&!o.binding.startsWith('report.')){o.suggestedBinding=o.binding;delete o.binding;o.mode='blank';o.confidence='review';o.reason='识别到小游戏业务，需上传对应数据源并完成字段映射，不能填入Steam数据';}
  for(const p of pages){const rows=objects.filter(o=>o.pageIndex===p.pageIndex);p.automatic=rows.filter(o=>o.mode==='auto').length;p.review=rows.filter(o=>o.confidence==='review').length;}
 }
 return {version:3,method:'local-rules',profile:'full',structure:'pptx',pageCount:pages.length,pages,objects,dataSource,dataRegions:detectPptDataRegions(project).regions,
  summary:{automatic:objects.filter(r=>r.mode==='auto').length,fixed:objects.filter(r=>r.mode==='static').length,review:objects.filter(r=>r.confidence==='review').length},
  limitations:['识别依据是标题、表头、图表系列及对象内容，未调用在线模型。','业务公式和游戏筛选沿用SteamAuto数据规则，不从PPT样例数字推算。','未知区域留空；发布前需核对绑定、口径和页面用途。']};
}

export function refreshPeriodText(html,month){
 const [year,m]=month.split('-').map(Number),last=new Date(Date.UTC(year,m,0)).getUTCDate();
 const parts=html.split(/(<[^>]*>)/g),nodes=[];let plain='';
 parts.forEach((value,index)=>{if(!value.startsWith('<')){nodes.push({index,start:plain.length,end:plain.length+value.length});plain+=value;}});
 const pattern=/20\d{2}([./-])\d{1,2}\1\d{1,2}|(?:20\d{2}\s*年\s*)?\d{1,2}\s*[—–~]\s*\d{1,2}\s*月|20\d{2}\s*年\s*\d{1,2}\s*月|20\d{2}([./-])\d{1,2}|(?<!\d)\d{1,2}\s*月/g;
 for(const match of [...plain.matchAll(pattern)].reverse()){
  const range=match[0].match(/^(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*([—–~])\s*(\d{1,2})\s*月$/);
  const replacement=range?`${range[1]?year+'年':''}${((m-1-(Number(range[4])-Number(range[2])+12)%12)+12)%12+1}${range[3]}${m}月`:match[1]?`${year}${match[1]}${String(m).padStart(2,'0')}${match[1]}${String(last).padStart(2,'0')}`:match[2]?`${year}${match[2]}${String(m).padStart(2,'0')}`:match[0].includes('年')?`${year}年${m}月`:`${m}月`;
  const start=match.index,end=start+match[0].length;
  for(const node of nodes)if(node.end>start&&node.start<end){const l=Math.max(0,start-node.start),r=Math.min(node.end-node.start,end-node.start);parts[node.index]=parts[node.index].slice(0,l)+(start>=node.start?replacement:'')+parts[node.index].slice(r);}
 }
 return parts.join('');
}
