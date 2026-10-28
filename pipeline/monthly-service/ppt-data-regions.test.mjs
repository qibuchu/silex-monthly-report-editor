import test from 'node:test';import assert from 'node:assert/strict';
import {detectPptDataRegions} from './ppt-data-regions.mjs';import {matchTemplateData,fillTemplateData} from './template-data.mjs';import {matchSourceViews} from './minigame-data-fields.mjs';
const cell=(id,content,x,y,w=100,h=24)=>({tagName:'div',attributes:{'data-object-id':id,'data-kind':'text'},style:{left:x+'px',top:y+'px',width:w+'px',height:h+'px','font-family':'TestFont',color:'#123456'},content:'<p><span style="font-weight:400">'+content+'</span></p>'});
const frame=id=>({...cell(id,'',0,180,650,200),style:{...cell(id,'',0,180,650,200).style,background:'#ffffff'}});
const grid=prefix=>[...['#','游戏','厂商','环比','MAU（万）'].map((v,i)=>cell(prefix+'h'+i,v,10+i*120,200)),...['1','旧游戏','旧厂商','+1','999'].map((v,i)=>cell(prefix+'r'+i,v,10+i*120,240)),...['2','旧游戏2','旧厂商','-1','999'].map((v,i)=>cell(prefix+'s'+i,v,10+i*120,278))];
const project=()=>({format:'steam-grapesjs-v2',deck:{css:'.original{color:red}',notes:{},pages:[{name:'微信畅销榜',width:1000,height:700,objects:[cell('heading','9月微信畅销榜Top20',10,60,600,40),frame('old-frame'),...grid('old-'),frame('new-frame'),...grid('new-'),cell('side-note','旁边的人工观察',720,230,200,30)]}]}});
const sources=()=>[{id:'s0',name:'月报接口',origin:'api:http://server/minigame-db/api/report/monthly/export',tables:[{id:'t0',name:'bestseller',columns:['game_name','publisher','rank_delta'],rows:[['新游戏A','新厂商A','0.4'],['新游戏B','新厂商B','-0.1']]},{id:'t1',name:'most_played',columns:['game_name','publisher','rank_delta'],rows:[['错误榜','错误厂商','999']]}],scalars:[]}];
test('recognizes only visible positioned cells, maps the right board and retains all IDs and styles',()=>{
 const p=project(),before=JSON.stringify(p),d=detectPptDataRegions(p);assert.equal(d.regions.length,1);assert.equal(d.regions[0].capacity,2);assert.ok(d.occludedIds.has('old-r1'));
 const targets=matchTemplateData(p,sources()),region=targets.find(t=>t.representation);assert.equal(region.suggestion.sourceId,'t0');assert.equal(region.suggestion.columnMap.at(-1),-1);
 const filled=fillTemplateData(p,sources(),[region.suggestion],'2026-09',()=>{throw Error('not a chart')});const objects=new Map(filled.project.deck.pages[0].objects.map(o=>[o.attributes['data-object-id'],o]));
 assert.match(objects.get('new-r1').content,/新游戏A/);assert.match(objects.get('new-r3').content,/\+0.4/);assert.ok(!objects.get('new-r4').content.includes('999'));assert.equal(objects.get('old-r1').content,'');assert.match(objects.get('side-note').content,/人工观察/);assert.equal(JSON.stringify(p),before);
 for(const original of p.deck.pages[0].objects)assert.deepEqual(objects.get(original.attributes['data-object-id']).style,original.style);
 assert.equal(filled.project.deck.pages[0].objects.length,p.deck.pages[0].objects.length);assert.ok(filled.issues.some(i=>i.message.includes('MAU')));
 const viewed=matchSourceViews(sources());assert.deepEqual(matchSourceViews(viewed),viewed);assert.equal(viewed[0].tables[0].rows[0].at(-1),'1');
});
test('does not arbitrarily pick two overlapping text cells for one column',()=>{
 const p=project();p.deck.pages[0].objects.push(cell('ambiguous','另一个同列值',130,240));assert.equal(detectPptDataRegions(p).regions.length,0);
});
test('separate new-game cards use explicit source row offsets and retain date presentation and raw evidence',()=>{
 const objects=[cell('page-title','IAP 9月新游关注',10,50,600,40)];
 for(let card=0;card<2;card++){const x=card*550;objects.push({...cell('name'+card,'旧游戏',x+10,180,400,40),style:{...cell('', '',0,0).style,left:(x+10)+'px',top:'180px',width:'400px',height:'40px','font-size':'32px'}});objects.push(cell('analysis'+card,'旧游戏研究文字',x+10,230,400,50));['首次投放','冲榜时间','月均排名','日均计划数'].forEach((v,c)=>objects.push(cell('h'+card+c,v,x+10+c*120,300)));['7.1','8.1','10.2','1,000'].forEach((v,c)=>objects.push(cell('v'+card+c,v,x+10+c*120,326)));}
 const p={format:'steam-grapesjs-v2',deck:{css:'',notes:{},pages:[{name:'IAP新游',width:1200,height:700,objects}]}},s=[{id:'s',name:'接口',origin:'api:http://server/minigame-db/api/report/monthly/export',tables:[{id:'n',name:'new_games.bestseller',columns:['game_name','first_buying_date','first_entry_date','avg_rank','avg_plan'],rows:[['游戏A','2026-07-19','2026-09-01','42.9','4964.8'],['游戏B','2025-12-17','2026-09-08','55.8','674.3']]}],scalars:[]}];
 const targets=matchTemplateData(p,s),regions=targets.filter(t=>t.representation);assert.equal(regions.length,2);assert.equal(regions[1].suggestion.rowOffset,1);
 const result=fillTemplateData(p,s,regions.map(t=>t.suggestion),'2026-09',()=>''),out=new Map(result.project.deck.pages[0].objects.map(o=>[o.attributes['data-object-id'],o]));
 assert.match(out.get('name1').content,/游戏B/);assert.match(out.get('v10').content,/25.12.17/);assert.equal(out.get('v10').attributes['data-source-value'],'2025-12-17');assert.ok(!out.get('analysis1').content.includes('旧游戏研究'));
});

test('period headings and TOP counts are not metric slots or historical narrative replacements',()=>{
 const p=project();p.deck.pages[0].objects.push(cell('split-title','IA A 8 月新游关注',10,560,700),cell('contents','—— 8月买量大盘 —— 8月 IAP 榜单及重点新游',10,600,700),cell('top-title','TOP50 品类分布',700,40),cell('month-title','8月供给变化',700,80),cell('range-title','6—8月小游戏双端趋势',700,120,500),cell('cover','小游戏8月月度报告',0,0,700),cell('manual','在6、9月的排名下跌后，9月活动频繁上线，日均计划数由18,396增至26,450',700,400,250,130));
 const r=fillTemplateData(p,sources(),[],'2026-10',()=>''),o=new Map(r.project.deck.pages[0].objects.map(o=>[o.attributes['data-object-id'],o]));
 assert.match(o.get('split-title').content,/10月新游关注/);assert.match(o.get('contents').content,/9月|10月/);assert.match(o.get('top-title').content,/TOP50/);assert.match(o.get('month-title').content,/10月供给变化/);assert.match(o.get('range-title').content,/8—10月/);assert.match(o.get('cover').content,/10月月度报告/);assert.match(o.get('manual').content,/9月活动/);
});
