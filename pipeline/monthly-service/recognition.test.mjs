import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePptxTemplate,refreshPeriodText} from './template-recognition.mjs';
import {applyTemplate} from './templates.mjs';
const object=(id,text,kind='text',attrs={})=>({tagName:kind==='table'?'table':'div',attributes:{'data-object-id':id,'data-kind':kind,'data-content-layer':'manual',...attrs},style:{left:'30px',top:'100px',width:'1000px',height:'300px'},content:text});
const page=(name,objects)=>({name,width:1920,height:1080,objects});
const project=pages=>({format:'steam-grapesjs-v2',deck:{css:'',notes:{report_month:'2026-08'},pages}});
const row=cells=>'<tr>'+cells.map(v=>'<td><p>'+v+'</p></td>').join('')+'</tr>';
test('recognition follows headings and table semantics, not page order or IDs',()=>{
 const p=project([
  page('2026年7月新游铜榜',[object('random-a','2026年7月新游铜榜'),object('random-b',row(['7月铜榜游戏上线14日收入排行'])+row(['排名','游戏名','品类','预估收入（美元）','上线14日玩家数量环比'])+row(['1','旧游戏','RPG','99万','20%']),'table')]),
  page('封面',[object('different-id','<p><span>Steam7</span><span>月月报</span></p>')]),
  page('7月Steam头部游戏营收排名概况',[object('head',row(['排名','游戏名','营收涨幅','营收榜排名环比']),'table')]),
 ]);
 const a=analyzePptxTemplate(p);assert.equal(a.pageCount,3);assert.equal(a.structure,'pptx');
 assert.equal(a.objects.find(o=>o.id==='random-b').binding,'new_releases.bronze');assert.equal(a.objects.find(o=>o.id==='different-id').binding,'report.period_text');assert.equal(a.objects.find(o=>o.id==='head').binding,'head.top20');
 const wrong=structuredClone(p);wrong.deck.pages[0].objects[1].content=row(['铜榜游戏上线14日收入排行'])+row(['游戏名','排名','品类','预估收入','上线14日玩家数量环比']);
 const b=analyzePptxTemplate(wrong).objects.find(o=>o.id==='random-b');assert.equal(b.mode,'blank');assert.match(b.reason,/列/);
});
test('ambiguous metrics, unknown formulas, research and DAU never become guessed data',()=>{
 const p=project([page('大盘总览',[object('a','上新总量 100'),object('b','上线总量 200'),object('dau',row(['游戏名','DAU日活']),'table'),object('formula','局限：7月剔除历史数据36万')]),page('头部异动',[object('analysis','某游戏联动营收上涨100%，据此推算下期翻倍')])]);
 const a=analyzePptxTemplate(p);for(const id of ['a','b','dau','formula','analysis'])assert.equal(a.objects.find(o=>o.id===id).mode,'blank');
 assert.match(a.objects.find(o=>o.id==='a').reason,/多个候选/);assert.match(a.objects.find(o=>o.id==='dau').reason,/PCU/);
});
test('period updates span rich-text runs, preserve HTML styles and handle leap-month end',()=>{
 const html='<p style="color:#003366"><span>2026</span><span>年7</span><span>月新品概况</span></p><p>DATE 2026.07.31截止</p>';
 const result=refreshPeriodText(html,'2028-02');assert.match(result,/2028年2月/);assert.match(result,/2028\.02\.29/);assert.match(result,/color:#003366/);assert.ok(!result.includes('2026'));
 assert.equal(refreshPeriodText('<p>Steam<span>7</span><b>月月报</b></p>','2026-08'),'<p>Steam<span>8月</span><b>月报</b></p>');
 assert.equal(refreshPeriodText('<p>数据：AdXray 2026年6—8月买量大盘</p>','2026-09'),'<p>数据：AdXray 2026年7—9月买量大盘</p>');
});
test('uploaded mini-game cover recognizes its month title, date label and research signature',()=>{
 const p=project([page('PPT 1 · 小游戏8月月度报告',[object('title','小游戏8月月度报告'),object('date','MiniGames · 2026.8'),object('team','研究组')])]);
 const rows=analyzePptxTemplate(p).objects;
 assert.equal(rows.find(o=>o.id==='title').binding,'report.period_text');
 assert.equal(rows.find(o=>o.id==='date').binding,'report.period_text');
 assert.equal(rows.find(o=>o.id==='team').mode,'static');
});

test('new business requests matching sources and never reuses similarly named Steam metrics',()=>{
 const a=analyzePptxTemplate(project([page('微信小游戏8月大盘总览',[object('new','上新总量 100'),object('sources','AdXray 买量 IAP畅销榜 IAA畅玩榜')])]));
 assert.equal(a.dataSource.status,'new-source-required');assert.equal(a.dataSource.sources.length,3);assert.match(a.dataSource.title,/上传/);
 assert.equal(a.objects.find(o=>o.id==='new').mode,'blank');assert.equal(a.objects.find(o=>o.id==='new').binding,undefined);
 assert.equal(a.pages[0].automatic,0);
 const steam=analyzePptxTemplate(project([page('Steam大盘总览',[object('n','上新总量 100')])]));
 assert.equal(steam.dataSource.status,'existing-source');assert.equal(steam.dataSource.provider,'SteamAuto');
 const unknown=analyzePptxTemplate(project([page('自定义报告',[object('n','某个未识别指标 100')])]));
 assert.equal(unknown.dataSource.status,'needs-confirmation');assert.match(unknown.dataSource.instructions.join(' '),/统计(?:时间)?窗口/);
});
test('PPT template fills new month and native table without nested table or old chart cache, retaining page structure',()=>{
 const layout=project([page('自定义封面',[object('my-title','<p>Steam7月月报</p>')]),page('自定义榜',[object('my-table',row(['排名','游戏名'])+row(['1','旧游戏']),'table')])]);
 const fresh=project([page('内置数据',[object('source','<table>'+row(['排名','游戏名'])+row(['1','新游戏'])+'</table>','table',{'data-binding-id':'head.top20'})])]);
 const result=applyTemplate(fresh,{project:layout,rules:{structure:'pptx',objects:[{id:'my-title',mode:'auto',binding:'report.period_text'},{id:'my-table',mode:'auto',binding:'head.top20'}]}},{id:'test',revision:1});
 assert.deepEqual(result.deck.pages.map(p=>p.name),['自定义封面','自定义榜']);assert.match(result.deck.pages[0].objects[0].content,/Steam8月月报/);const table=result.deck.pages[1].objects[0];assert.equal(table.tagName,'table');assert.match(table.content,/新游戏/);assert.ok(!/<table\b/.test(table.content));assert.equal(table.style.left,'30px');
 const blank=applyTemplate(fresh,{project:layout,rules:{objects:[{id:'my-title',mode:'blank'},{id:'my-table',mode:'blank'}]}},{id:'test',revision:1});assert.match(blank.deck.pages[1].objects[0].content,/<td>/);assert.ok(!blank.deck.pages[1].objects[0].content.includes('旧游戏'));
});
