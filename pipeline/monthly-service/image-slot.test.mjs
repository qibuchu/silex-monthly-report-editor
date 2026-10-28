import test from 'node:test';
import assert from 'node:assert/strict';
import {blankContent, isImageSlot} from './image-slot.mjs';
import {fillTemplateData} from './template-data.mjs';
import {renderImportedChart} from './template-chart-render.mjs';

test('imported PPT image stored as text remains an image upload slot', () => {
  const image = {tagName:'div',attributes:{'data-kind':'text','data-object-id':'slide-4-image-121'},content:'<img src="old.png">'};
  assert.equal(isImageSlot(image),true);
  assert.match(blankContent(image),/data-image-slot="true"/);
});

test('explicit period binding updates a static heading', () => {
  const id='slide-1-text-1';
  const project={deck:{pages:[{name:'8月',objects:[{tagName:'div',attributes:{'data-object-id':id,'data-kind':'text'},style:{width:'100px',height:'20px'},content:'<p>IAA类游戏8月品类异动</p>'}]}],notes:{}}};
  const result=fillTemplateData(project,[],[],'2026-09',()=>'',{visual:true,objects:[{id,mode:'static',binding:'report.period_text'}]});
  assert.match(result.project.deck.pages[0].objects[0].content,/9月品类异动/);
});

test('declared PNG chart uses upstream rows, sorts and limits without changing bounds', () => {
  const id='pptx-a-slide-5-image-6';
  const project={deck:{pages:[{name:'TOP50',objects:[{tagName:'div',attributes:{'data-object-id':id,'data-kind':'text'},style:{left:'10px',top:'20px',width:'891px',height:'620px'},content:'<img src="old.png">'}]}],notes:{}}};
  const sources=[{name:'月报',tables:[{id:'s0t0',name:'iaa.top50.rows',columns:['genre','current_count','delta'],rows:[['箭头like','4','0'],['沙画like','11','3'],['收纳三消','5','-1']]}],scalars:[]}];
  const rules={objects:[{id,mode:'chart',chart:{type:'hbar',sourceRole:'iaa.top50.rows',category:'genre',sort:{by:'current_count',order:'desc'},limit:2,series:[{name:'数量',column:'current_count',render:'bar',color:'#002b5c',label:{show:true,format:'{value}（{delta:+d}）',deltaColumn:'delta'}}],legend:false}}]};
  const result=fillTemplateData(project,sources,[],'2026-09',renderImportedChart,rules);
  const output=result.project.deck.pages[0].objects[0];
  assert.match(output.content,/<svg/);
  assert.match(output.content,/沙画like/);
  assert.match(output.content,/11（\+3）/);
  assert.match(output.content,/5（-1）/);
  assert.doesNotMatch(output.content,/箭头like/);
  assert.equal(output.style.width,'891px');
});

test('chart renderer supports grouped stacks, right-axis line and null gaps', () => {
  const svg=renderImportedChart({type:'combo',categories:['7月','8月','9月'],legend:true,series:[
    {name:'信息流',render:'bar',stack:'抖音',color:'#e8202a',values:[2,3,4]},
    {name:'达人',render:'bar',stack:'抖音',color:'#f8a0a6',values:[1,2,3]},
    {name:'信息流',render:'bar',stack:'微信',color:'#0a9f45',values:[2,3,4]},
    {name:'在投游戏',render:'line',axis:'right',color:'#002b5c',values:[100,null,120],labels:['100','','120']},
  ]},1185,602);
  assert.match(svg,/7月/);
  assert.equal((svg.match(/<rect /g)||[]).length>=9,true);
  assert.equal((svg.match(/<path /g)||[]).length,1);
  assert.match(svg,/120/);
  assert.doesNotMatch(svg,/NaN/);
});

test('chart with missing upstream series stays a chart placeholder, not an upload slot', () => {
  const id='pptx-a-slide-2-image-121';
  const project={deck:{pages:[{name:'买量',objects:[{tagName:'div',attributes:{'data-object-id':id,'data-kind':'text'},style:{width:'1185px',height:'602px'},content:'<img src="old.png">'}]}],notes:{}}};
  const spec={type:'combo',sourceRole:'charts.ads_trend',category:'month_label',series:[{name:'抖音素材',column:'douyin_info_flow_wan',render:'bar'}]};
  const result=fillTemplateData(project,[],[],'2026-09',renderImportedChart,{objects:[{id,mode:'chart',chart:spec}]});
  assert.match(result.project.deck.pages[0].objects[0].content,/class="chartbox"/);
  assert.match(result.project.deck.pages[0].objects[0].content,/charts.ads_trend/);
  assert.doesNotMatch(result.project.deck.pages[0].objects[0].content,/data-image-slot/);
  assert.match(result.issues[0].message,/图表来源缺失/);
});

test('numeric progress bars bind to source growth and preserve track bounds', () => {
  const id='slide-2-shape-68',trackId='slide-2-shape-66';
  const project={deck:{pages:[{name:'P2',objects:[
    {tagName:'div',attributes:{'data-object-id':trackId,'data-kind':'shape'},style:{width:'252px'},content:''},
    {tagName:'div',attributes:{'data-object-id':id,'data-kind':'shape'},style:{width:'123px'},content:''}
  ]}],notes:{}}};
  const sources=[{name:'report',tables:[],scalars:[{id:'s0v0',path:'adx_kpi.douyin_material_growth_pct',label:'douyin_material_growth_pct',value:'-20.9'}]}];
  const bar={sourceRole:'adx_kpi.douyin_material_growth_pct',trackId,max:100,minWidth:4,negativeColor:'#2e9e5b'};
  const result=fillTemplateData(project,sources,[],'2026-09',renderImportedChart,{visual:true,objects:[{id,mode:'bar',bar}]});
  assert.equal(result.project.deck.pages[0].objects[1].style.width,'52.668px');
  assert.equal(result.project.deck.pages[0].objects[1].style['background-color'],'#2e9e5b');
  assert.equal(result.project.deck.pages[0].objects[0].style.width,'252px');
});

test('multi-field text template replaces both values while retaining spans', () => {
  const id='slide-2-shape-129';
  const project={deck:{pages:[{name:'P2',objects:[{tagName:'div',attributes:{'data-object-id':id,'data-kind':'text'},style:{width:'200px'},content:'<p><span style="color:red">+46%</span> <span style="color:blue">-12%</span></p>'}]}],notes:{}}};
  const sources=[{name:'report',tables:[],scalars:[
    {id:'s0v0',path:'adx_kpi.douyin_info_flow_growth',label:'douyin_info_flow_growth',value:'+10%'},
    {id:'s0v1',path:'adx_kpi.douyin_talent_growth',label:'douyin_talent_growth',value:null}
  ]}];
  const result=fillTemplateData(project,sources,[],'2026-09',renderImportedChart,{visual:true,objects:[{id,mode:'auto',textTemplate:'{douyin_info_flow_growth} {douyin_talent_growth}'}]});
  assert.match(result.project.deck.pages[0].objects[0].content,/<span style="color:red">\+10%<\/span>/);
  assert.match(result.project.deck.pages[0].objects[0].content,/<span style="color:blue"><\/span>/);
});
