const fs=require('fs'),path=require('path'),vm=require('vm');
const {applyTopicTemplate}=require('./topic-template.cjs');
const {applyBindingContract}=require('./binding-contract.cjs');
const {applyFinishedPages,applyImageSlots,fitRankingTables}=require('./page-layout.cjs');
const {prepareMonthlyData}=require('./data-quality.cjs');
const {marketSeries}=require('./market-source.cjs');
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>valid(v)?Math.round(v).toLocaleString('en-US'):'—';
const money=v=>valid(v)?(v/10000).toFixed(1)+'万':'—';
const pct=(v,ratio=true)=>valid(v)?(v*(ratio?100:1)).toFixed(1)+'%':'—';
function generate(envelope,data,selection={}){
 if(data.schema_version!=='2.0'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.report_month||'')||!data.head||!data.new_releases||!data.market)throw Error('需要 Skill monthly-report schema 2.0 数据包；不再接受旧版自行计算输入');
 data=prepareMonthlyData(data).data;
 const incomplete=data.status==='error'&&selection.allow_incomplete===true;
 if(!['ok','partial'].includes(data.status)&&!incomplete)throw Error('上游月报状态为 '+data.status+'，禁止生成有效草稿');
 if(incomplete){if(!['ok','partial'].includes(data.market.status))throw Error('没有可用大盘数据，不能生成数据草稿');data={...data,head:{...data.head,top20:[],highlights:[]},new_releases:{...data.new_releases,gold:[],silver:[],bronze:[]}};}
 const refresh=selection.mode==='refresh';
 if(refresh&&envelope.project.deck.pages.some(page=>page.layoutContinuationOf||page.objects.some(o=>o.attributes?.['data-continuation-of'])))throw Error('分页稿暂不支持整包刷新，请生成独立新稿或按对象更新，避免覆盖人工分页布局');
 const deck=envelope.project.deck,month=data.report_month,m=Number(month.slice(5))+'月',year=month.slice(0,4),issues=[...(data.issues||[])];
 const objects=()=>deck.pages.flatMap(p=>p.objects),find=id=>objects().find(o=>o.attributes?.['data-object-id']===id);
 const plain=s=>s.replace(/<[^>]*>/g,'');
 function text(id,value){const o=find(id);if(!o)return;let first=true;o.content=o.content.replace(/>([^<]+)</g,(s,t)=>/^\s*$/.test(t)?s:'><');o.content=o.content.replace(/(<span\b[^>]*>)/g,s=>{if(!first)return s;first=false;return s+esc(value)});if(first)o.content='<div class="text"><div class="rich">'+esc(value)+'</div></div>';}
 if(incomplete)issues.push({code:'incomplete_draft',message:'上游error：隔离头部榜与金银铜榜，仅填入可用大盘数据；原始错误状态保留。'});
 const oldTitles=[plain(find('s7o4')?.content||''),plain(find('s8o6')?.content||'')];
 const sameMonth=plain(find('s4o2')?.content||'').includes(`${year}年${m}`);
 if(!sameMonth&&!refresh){const footer=find('s4o7');if(footer){issues.push({code:'previous_month_specific_footnote',message:'原稿含旧月份的具体评论剔除说明，已从新月份页面留空，原文归档。',original:plain(footer.content)});text('s4o7','');}}
 if(!refresh)applyTopicTemplate(deck,{newDraft:true,monthLabel:m});
 function table(id,headers,rows,title,highlight=new Set()){
  const o=find(id);if(!o)return;
  const rowTags=[...o.content.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(x=>x[0]);
  const cells=r=>[...r.matchAll(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/g)].map(x=>x[0]);
  const head=rowTags.find(r=>cells(r).length===headers.length)||'';
  const body=rowTags.slice(rowTags.indexOf(head)+1).find(r=>cells(r).length===headers.length)||head;
  const replace=(cell,value)=>{let first=true;let s=cell.replace(/>([^<]+)</g,(all,t)=>/^\s*$/.test(t)?all:'><');s=s.replace(/(<span\b[^>]*>)/g,a=>{if(!first)return a;first=false;return a+esc(value)});return first?s.replace(/(<t[dh]\b[^>]*>)/,'$1'+esc(value)):s;};
  const make=(template,values)=>{let i=0;return template.replace(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/g,c=>replace(c,values[i++]??'—'));};
  const titleRow=title&&rowTags[0]&&cells(rowTags[0]).length===1?make(rowTags[0],[title]):'';
  if(!rows.length){const count=id==='s2o9'||id==='s9o10'?20:id==='s5o8'?11:8;rows=Array.from({length:count},()=>headers.map(()=>''));}
  const rowHeight=Math.max(22,(parseFloat(o.style.height)-(titleRow?45:0)-55)/Math.max(1,rows.length)-4);
  const regularBody=body.replace(/font-weight\s*:\s*[^;"']+/gi,'font-weight:400').replace(/<\/?(?:b|strong)\b[^>]*>/gi,'');
  const output=titleRow+make(head,headers)+rows.map((values,i)=>make(regularBody,values).replace(/height:\s*[\d.]+px/g,`height:${rowHeight.toFixed(2)}px`).replace(/background(?:-color)?:\s*[^;"']+/g,`background:${highlight.has(i)?'#faf3e3':'#ffffff'}`)).join('');
  o.content=o.content.replace(/<tbody>[\s\S]*?<\/tbody>/,`<tbody>${output}</tbody>`);
 }
 function chart(id,d){const o=find(id);if(!o)return;const el={dataset:{chart:JSON.stringify(d)},parentElement:{style:o.style},innerHTML:''};const ctx={escapeHTML:esc};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../outputs/monthly-editor/chart.js'),'utf8'),ctx);ctx.renderChart(el);o.content=`<div class="chart" data-chart="${esc(JSON.stringify(d))}">${el.innerHTML}</div>`;}
 text('s6o5',`${m}热门新游：`);
 text('s1o3',`PC GAMES RESEARCH · ${month.replace('-','.')}`);text('s1o4',`Steam${m}月报`);if(!refresh)text('s1o6','');text('s1o10',`${month.replace('-','.')} / 草稿`);
 text('s2o2',`${m}Steam头部游戏营收排名概况`);text('s4o2',`${year}年${m}新品概况`);text('s5o2',`${year}年${m}新游金银榜`);text('s9o2',`${year}年${m}新游铜榜`);
 const head=[...(data.head.top20||[])].sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity));const hi=data.head.highlights||[];const ids=new Set(hi.map(g=>String(g.appid)));
 table('s2o9',['排名','游戏名',`${m}预估收入（美元）`,'营收榜排名环比'],head.map(g=>[g.rank,g.name,money(g.monthly_revenue),g.rank_delta_status==='ok'&&valid(g.rank_delta)?(g.rank_delta>0?'+':'')+g.rank_delta:'—']),null,new Set(head.flatMap((g,i)=>ids.has(String(g.appid))?[i]:[])));
 const manualCards=new Map(deck.pages[1].objects.filter(o=>o.attributes['data-appid']).map(o=>[o.attributes['data-appid']+'-'+o.attributes['data-card-role'],o]));
 const p2=deck.pages[1];p2.objects=p2.objects.filter(o=>!['s2o15','s2o17','s2-apex-summary','s2o18','selected-cover-0','selected-cover-1'].includes(o.attributes['data-object-id'])&&!o.attributes['data-object-id']?.startsWith('movement-card-'));
 hi.forEach((g,i)=>{const x=1020+i%2*420,y=320+Math.floor(i/2)*165;for(const [suffix,k,left,width,height,content]of [['icon','image',x,64,64,'<div class="imagebox"></div>'],['name','text',x+80,314,40,`<div class="text"><div class="rich"><p style="margin:0;line-height:1.3"><span style="font-size:21px;color:#002b5c;font-weight:700">${esc(g.name)}</span></p></div></div>`],['text','text',x+80,314,85,'<div class="text"><div class="rich"><p style="margin:0;line-height:1.55"><span style="font-size:17px;color:#28527d"></span></p></div></div>']])p2.objects.push({type:'report-object',classes:['object'],attributes:{'data-kind':k,'data-name':g.name+' · '+suffix,'data-appid':String(g.appid),'data-card-role':suffix,'data-object-id':`movement-card-${i}-${suffix}`,'data-template-slot':suffix==='name'?'data':'manual-'+k},style:{left:left+'px',top:(y+(suffix==='text'?42:0))+'px',width:width+'px',height:height+'px'},content});});
 if(refresh)for(const o of p2.objects){const saved=manualCards.get(o.attributes['data-appid']+'-'+o.attributes['data-card-role']);if(saved){o.style={...saved.style};if(o.attributes['data-card-role']!=='name')o.content=saved.content;}}
 const tiers={};for(const [tier,id,label]of [['gold','s5o8','金'],['silver','s5o9','银'],['bronze','s9o10','铜']]){tiers[tier]=[...(data.new_releases[tier]||[])].sort((a,b)=>(a.revenue_rank_in_tier??Infinity)-(b.revenue_rank_in_tier??Infinity));table(id,['排名','游戏名','类型标签','预估收入（美元）','上线14日玩家数量环比'],tiers[tier].map(g=>[g.revenue_rank_in_tier,g.game_name,(g.tags||[]).slice(0,2).join(' / '),money(metric(g,'revenue_14d_usd')),pct(metric(g,'player_change_14d'),false)]),`${m}${label}榜游戏上线14日表现`);}
 function metric(g,key){const a=g?.day14?.metrics?.[key];return a?.status==='ok'?a.value:null;}
 const k=data.kpis||{},months=data.market.months||[],trend=data.market.review_trend||[];
 function kpi(id,lines){const o=find(id);let i=0;o.content=o.content.replace(/<p\b[\s\S]*?<\/p>/g,p=>{let used=false;const value=lines[i++]||'';return p.replace(/(<span\b[^>]*>)[\s\S]*?(<\/span>)/g,(all,start,end)=>{const v=used?'':esc(value);used=true;return start+v+end;});});}
 kpi('s4o8',[m+'上新总量（环比）',num(k.total?.value),'']);kpi('s4o9',['新品增量',pct(k.mom_growth?.value),'']);kpi('s4o10',['快照总评测数',money(k.review_rate_all?.total),'']);kpi('s4o11',['快照总好评率',pct(k.review_rate_all?.value),'简中 '+pct(k.review_rate_sc?.value)]);if(!refresh){text('s4o40','');text('s4o42','');}
 const marketSource=marketSeries(data,issues),categories=marketSource.categories;
 chart('s4o15',{title:'',categories,type:'bar',stacked:true,legend:false,format:'',series:marketSource.series});
 if(find('s4o16'))find('s4o16').style.top='235px';
 chart('s4o16',{title:'',categories,type:'line',hideY:true,hideX:true,legend:false,format:'',series:[{name:'日均上新',color:'#002b5c',source:'market.months[].daily_avg',values:marketSource.daily}]});
 ['s4o24','s4o25','s4o26'].forEach((id,i)=>{text(id,num(months[i]?.total));const o=find(id),c=find('s4o15');const raw=Math.max(...months.map(x=>x.total),1),unit=10**Math.floor(Math.log10(raw)),max=Math.ceil(raw/unit)*unit;const w=parseFloat(c.style.width),h=parseFloat(c.style.height);o.style.left=(parseFloat(c.style.left)+68+(i+.5)*(w-88)/months.length-50)+'px';o.style.top=(parseFloat(c.style.top)+22+(h-68)*(1-months[i].total/max)-28)+'px';o.style.width='100px';o.style.height='28px';});text('market-chart-key','■ 其他\n■ 发售即解封');find('market-chart-key').content=find('market-chart-key').content.replace(/\n/g,'<br>');
 const mt=find('s4o43');if(mt){let row=0;const rev=[...trend].reverse();mt.content=mt.content.replace(/<tr\b[\s\S]*?<\/tr>/g,r=>{let c=-1;const ri=row++;return r.replace(/<td\b[^>]*>[\s\S]*?<\/td>/g,cell=>{c++;let value;if(ri===0&&c>0)value=Number(rev[c-1]?.month.slice(5))+'月';if(ri===1)value=c===0?'定级率':c===1?pct(data.metric_contracts?.rated_game_rate?.status==='ok'?data.metric_contracts.rated_game_rate.value:null):'—';if(ri===2&&c>0)value=c===1?money(k.review_rate_all?.total):'—';if(ri===3&&c>0)value=pct(rev[c-1]?.review_rate_all);if(ri===4&&c>0)value=pct(rev[c-1]?.review_rate_sc);if(ri===7)value='—';if(value===undefined)return cell;let done=false;return cell.replace(/>([^<]+)</g,(s,t)=>{if(/^\s*$/.test(t))return s;const v=done?'':esc(value);done=true;return '>'+v+'<';});});});}
 const all=[...tiers.gold,...tiers.silver,...tiers.bronze];const byId=id=>all.find(g=>String(g.appid)===String(id));
 const hot=(selection.hot_appids||(sameMonth?deck.notes?.selection?.hot_appids:[])||[]).map(byId).filter(Boolean); // No implicit research selection.
 const indies=selection.indie_appids?selection.indie_appids.map(byId):sameMonth?oldTitles.map(t=>all.find(g=>t.includes(g.game_name))):[];
 for(const [i,nameId,statsId,badge]of [[0,'s6o6','s6o7','s6o20'],[1,'s6o10','s6o27','s6o21'],[2,'s6o22','s6o26','s6o25']]){const g=hot[i];text(nameId,g?.game_name||'');text(statsId,g?`14日收入 ${money(metric(g,'revenue_14d_usd'))} USD | 14日销量 ${num(metric(g,'sales_14d_units'))} | 峰值PCU ${num(metric(g,'pcu_peak_14d'))}`:'');text(badge,'');}
 for(const [i,pre,tit,sales,revenue,reviews,win,pcu,badge] of [[0,'s7','s7o4','s7o14','s7o15','s7o16','s7o17','s7o19','s7o13'],[1,'s8','s8o6','s8o19','s8o20','s8o21','s8o22','s8o16','s8o18']]){const g=indies[i];text(tit,`${m}Steam亮眼独游${g?'——《'+g.game_name+'》':''}`);text(sales,g?'14日预估销量 '+num(metric(g,'sales_14d_units'))+' 份':'');text(revenue,g?'14日预估收入 '+money(metric(g,'revenue_14d_usd'))+' USD':'');text(reviews,g?.reviews_14d?.status==='ok'?`14日评论 ${num(g.reviews_14d.value)} · 好评 ${pct(g.reviews_14d.positive_rate)}`:'');text(win,g?.day14?.metrics?.revenue_14d_usd?.window?`${g.day14.metrics.revenue_14d_usd.window.start} 至 ${g.day14.metrics.revenue_14d_usd.window.end}`:'');text(pcu,g?'14日峰值PCU '+num(metric(g,'pcu_peak_14d')):'');text(badge,'');const topicPage=deck.pages.find(p=>p.objects.some(o=>o.attributes?.['data-object-id']===tit));if(topicPage)topicPage.name=`${i+7} · ${g?.game_name||'亮眼独游'}`;}
 // Default to the pages that can be populated from stable data and explicit rules.
 // Full mode remains available for reopening historical nine-page drafts.
 const pageMode=['full','finished-eight'].includes(selection.page_mode)?selection.page_mode:'data-supported';
 if(pageMode==='finished-eight'&&!refresh)applyFinishedPages(deck,data,selection);
 if(pageMode==='data-supported'){
  const pageFor=id=>deck.pages.find(page=>page.objects.some(object=>object.attributes?.['data-object-id']===id));
  const keep=['s1o4','s2o9','s4o43','s5o8','s9o10'].map(pageFor).filter(Boolean);
  if(keep.length!==5)throw Error(`数据支撑版需要5个模板页面，当前只匹配到${keep.length}个`);
  const names=['封面','头部榜单','大盘总览','金银榜','附录铜榜'];
  keep.forEach((page,i)=>page.name=`${i+1} · ${names[i]}`);
  deck.pages=keep;
 }
 if(!refresh){applyImageSlots(deck);if(pageMode==='finished-eight')fitRankingTables(deck);}
 deck.pages.forEach((page,index)=>page.name=`${index+1} · ${page.name.replace(/^\d+\s*·\s*/,'')}`);
 // Metadata/footer dates remain template wording; update date tokens only.
 const cutoff=String(data.data_cutoff||'').slice(0,10).replace(/-/g,'.');
 deck.pages.forEach((p,i)=>p.objects.forEach(o=>{if(o.attributes['data-kind']!=='text')return;let v=plain(o.content);if(/^\d{2}\s*\/\s*\d+$/.test(v.trim()))text(o.attributes['data-object-id'],`${String(i+1).padStart(2,'0')} / ${String(deck.pages.length).padStart(2,'0')}`);if(/DATE/.test(v)&&/\d{4}[.-]\d{2}[.-]\d{2}/.test(v))o.content=o.content.replace(/\d{4}[.-]\d{2}[.-]\d{2}/g,cutoff);}));
 // Off-slide source notes from PPT are archival, not visible slide content.
 for(const id of ['s2o5','s9o5']){const o=find(id);if(o){o.attributes['data-archival']='true';o.style.display='none';o.style.top='1040px';o.style.height='31px';}}
 if(find('s4o17')){find('s4o17').style.height='1.333px';find('s4o17').style.display='none';}
 for(const pg of deck.pages)for(const o of pg.objects){const t=plain(o.content);if(o.attributes['data-kind']==='text'&&(/^(DATA|DATE|⚠)/.test(t.trim())||o.attributes['data-object-id']==='s4o6')&&parseFloat(o.style.top)>1000){o.style.top='1028px';o.style.height='36px';}}
 if(find('s4o7'))find('s4o7').content=find('s4o7').content.replace(/font-size:[\d.]+px/g,'font-size:13px').replace(/letter-spacing:[\d.]+px/g,'letter-spacing:0px');
 deck.css+='\n.native-table td,.native-table th{border-color:#dce1e7!important;}';
 deck.notes={...deck.notes,upstream_status:data.status,draft_state:incomplete?'incomplete':'draft',page_profile:pageMode==='full'?'full-nine-page':pageMode==='finished-eight'?'finished-eight-page':'data-supported-five-page',report_month:month,snapshot_id:data.snapshot_id,calculation_version:data.calculation_version,issues,selection:{...deck.notes?.selection,...selection},generated_at:new Date().toISOString()};
 require('./market-details.cjs').applyMarketDetails(deck,data,selection.market_history||deck.notes.market_history||[],issues);
 envelope.project.current=0;const contract=applyBindingContract(deck);return {envelope,issues,contract};
}
module.exports={generate};
if(require.main===module){const [base,input,out,sel]=process.argv.slice(2);if(!out)throw Error('Usage: node workflow/generate-draft.cjs base.json monthly-report.json draft.json [selection.json]');const result=generate(JSON.parse(fs.readFileSync(base)),JSON.parse(fs.readFileSync(input)),sel?JSON.parse(fs.readFileSync(sel)):{});fs.writeFileSync(out,JSON.stringify(result.envelope));fs.writeFileSync(out+'.issues.json',JSON.stringify(result.issues,null,2));fs.writeFileSync(out+'.contract.json',JSON.stringify(result.contract,null,2));console.log(JSON.stringify({output:out,issues:result.issues.length,contract:result.contract}));}
