import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildNativeDeck,diffDecks,readDeck,scan} from './native-project.mjs';
import {createCore} from './core.mjs';

const P='<p style="margin:0">',S='<span style="color:#123">';
const text=(id,...lines)=>({attributes:{'data-object-id':id,'data-kind':'text'},style:{left:'0px'},content:lines.map(line=>`${P}${[].concat(line).map(run=>`${S}${run}</span>`).join('')}</p>`).join('')});
const cell=(value,colspan=1)=>`<td colspan="${colspan}" rowspan="1"><div>${P}${S}${value}</span></p></div></td>`;
const row=(...cells)=>`<tr style="height: 10px;">${cells.join('')}</tr>`;
const table=(id,...rows)=>({tagName:'table',attributes:{'data-object-id':id,'data-kind':'table'},style:{height:'40px'},content:`<tbody>${rows.join('')}</tbody>`});
const deck=(...objects)=>({pages:[{name:'p',objects}]});
const id=name=>`pptx-x-slide-2-${name}`;

test('readDeck follows paragraphs, runs, merged cells and shapes nested in groups',()=>{
  const group={attributes:{'data-object-id':id('group-5'),'data-kind':'container'},content:`<div data-object-id="${id('shape-6')}" style="left:1px">${P}${S}内层</span></p></div><img data-object-id="${id('image-7')}" src="a.png">`};
  const entries=readDeck(deck(text(id('shape-4'),['8','月'],'第二段'),table(id('table-9'),row(cell('甲',2),cell('乙')),row(cell('丙'),cell('丁'),cell('戊'))),group));
  assert.deepEqual(entries.get(id('shape-4')).paragraphs,[['8','月'],['第二段']]);
  const cells=entries.get(id('table-9')).cells;
  assert.deepEqual([...cells.keys()],['0:0','0:2','1:0','1:1','1:2']);
  assert.deepEqual(cells.get('0:2').paragraphs,[['乙']]);
  assert.deepEqual(entries.get(id('shape-6')).paragraphs,[['内层']]);
  assert.equal(entries.has(id('group-5')),false);
});

test('scan tolerates markup an editor may produce',()=>{
  const owners=scan('<div>第一行</div><div>第&nbsp;二 &amp; 行<br></div>','root');
  assert.deepEqual(owners.get('root').paragraphs.map(p=>p.tokens.join('')),['第一行','第 二 & 行\n']);
  const svg=scan('<svg><text>不是正文</text></svg>','root');
  assert.equal(svg.get('root').paragraphs.length,0);
});

test('diffDecks returns only real text changes and names what cannot be written',()=>{
  const before=deck(text(id('shape-4'),'旧标题'),text(id('shape-5'),'不变'),table(id('table-9'),row(cell('a'),cell('b'))));
  const after=structuredClone(before);
  after.pages[0].objects[0].content=after.pages[0].objects[0].content.replace('旧标题','新标题');
  after.pages[0].objects[2].content=after.pages[0].objects[2].content.replace('>b<','>c<');
  after.pages[0].objects[1].style={left:'9px'};
  after.pages[0].objects.push(text('added','新对象'));
  const {changes,unsupported}=diffDecks(before,after);
  assert.deepEqual(changes.map(c=>[c.kind,c.slide,c.shapeId??c.tableId,c.row,c.column]),[['text',2,4,undefined,undefined],['cell',2,9,0,1]]);
  assert.deepEqual(changes[0].before,[['旧标题']]);
  assert.deepEqual(changes[0].paragraphs,[['新标题']]);
  assert.deepEqual(unsupported.map(u=>u.id),['added',id('shape-5')]);
  assert.equal(diffDecks(before,structuredClone(before)).changes.length,0);
});

test('buildNativeDeck mirrors the PPTX: text, trimmed rows, slots, charts and continuations',()=>{
  const oldChart=JSON.stringify({type:'line',title:'旧游戏趋势',categories:['D0'],series:[{name:'n',values:[1]}]}).replace(/"/g,'&quot;');
  const group={attributes:{'data-object-id':'pptx-x-slide-5-group-20','data-kind':'container'},style:{},content:`<div data-object-id="pptx-x-slide-5-chart-21" data-pptx-chart="${oldChart}" style="width:80px;height:40px"><svg><text>旧</text></svg></div>`};
  const chart={attributes:{'data-object-id':'pptx-x-slide-5-chart-8','data-kind':'text','data-pptx-chart':JSON.stringify({type:'bar',categories:['6月'],series:[{name:'n',values:[1]}]})},style:{width:'100px',height:'50px'},content:'<svg></svg>'};
  const picture={attributes:{'data-object-id':'pptx-x-slide-5-image-3','src':'old.png'},content:'<img src="old.png">',style:{}};
  const template={format:'steam-grapesjs-v2',deck:{css:'',pages:[{name:'金榜',objects:[text('pptx-x-slide-5-shape-4',['7','月金榜']),table('pptx-x-slide-5-table-6',row(cell('表头')),row(cell('旧1')),row(cell('旧2'))),picture,chart,group]}]},silexState:{pages:[]}};
  const slide=(title,rows)=>({shapes:{4:title,3:[['图片待补']],21:[['图表待补']]},tables:{6:rows},charts:{8:{categories:['7月'],series:[{name:'n',values:[5]}]}},pictures:[]});
  const extraction={order:[5,10],slides:{5:slide([['8','月金榜']],[[[['表头']]],[[['新1']]]]),10:slide([['8','月金榜']],[[[['表头']]],[[['新2']]]])}};
  const built=buildNativeDeck(template,extraction,[{sourceSlide:5,newSlide:10}],data=>`<svg>${data.categories[0]}</svg>`);
  const pages=built.project.deck.pages;
  assert.equal(pages.length,2);assert.equal(built.project.silexState,undefined);
  assert.equal(pages[1].objects[0].attributes['data-object-id'],'pptx-x-slide-10-shape-4');
  const entries=readDeck(built.project.deck);
  assert.deepEqual(entries.get('pptx-x-slide-5-shape-4').paragraphs,[['8','月金榜']]);
  assert.equal(entries.get('pptx-x-slide-5-table-6').rows,2);
  assert.deepEqual(entries.get('pptx-x-slide-5-table-6').cells.get('1:0').paragraphs,[['新1']]);
  assert.deepEqual(entries.get('pptx-x-slide-10-table-6').cells.get('1:0').paragraphs,[['新2']]);
  assert.equal(pages[0].objects[1].style.height,'20px');
  assert.match(pages[0].objects[2].content,/图片待补/);assert.equal(pages[0].objects[2].attributes.src,undefined);
  assert.equal(pages[0].objects[3].content,'<svg>7月</svg>');
  assert.deepEqual(JSON.parse(pages[0].objects[3].attributes['data-pptx-chart']).series[0].values,[5]);
  assert.doesNotMatch(pages[0].objects[4].content,/旧游戏趋势|旧<\/text>/);assert.match(pages[0].objects[4].content,/图表待补/);
  assert.deepEqual(built.missing,[]);
  const placeholders={order:[5],slides:{5:{shapes:{4:[['8','月金榜']]},tables:{6:[[[['表头']]],[[['新1']]]]},charts:{8:{categories:[],series:[{name:'系列1',values:[]}],title:'图表标题待补',placeholder:true}},pictures:['3'],placeholders:['3']}}};
  const rebuilt=buildNativeDeck(template,placeholders,[],()=>{throw Error('placeholder charts are not drawn');}).project.deck.pages[0];
  assert.match(rebuilt.objects[2].content,/图片待补/);assert.equal(rebuilt.objects[2].attributes.src,undefined);
  assert.match(rebuilt.objects[3].content,/图表待补/);assert.equal(rebuilt.objects[3].attributes['data-pptx-chart'],undefined);
  assert.equal(template.deck.pages[0].objects[0].content.includes('8'),false);
});

test('a chart drawn from data replaces the template picture in the web view',()=>{
  const picture={attributes:{'data-object-id':'pptx-x-slide-2-image-121','data-name':'Picture 70'},content:'<img src="old.png" style="top:-17%">',style:{}};
  const inGroup={attributes:{'data-object-id':'pptx-x-slide-2-group-9'},content:'<img data-object-id="pptx-x-slide-2-image-7" src="old2.png">',style:{}};
  const template={format:'steam-grapesjs-v2',deck:{css:'',pages:[{name:'大盘',objects:[picture,inGroup]}]}};
  const stored=[];
  const extraction={order:[2],slides:{2:{shapes:{},tables:{},charts:{},pictures:['121','7'],placeholders:[],generated:{121:'data:image/svg+xml;base64,PHN2Zy8+',7:'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='}}}};
  const page=buildNativeDeck(template,extraction,[],()=>'',data=>{stored.push(data);return `/assets/${stored.length}.svg`;}).project.deck.pages[0];
  assert.match(page.objects[0].content,/src="\/assets\/1\.svg"/);assert.doesNotMatch(page.objects[0].content,/old\.png|-17%/);
  assert.match(page.objects[1].content,/data-object-id="pptx-x-slide-2-image-7" src="\/assets\/2\.svg"/);
  assert.equal(stored.length,2);
});

test('objects the mapping removed from the PPTX leave the web view',()=>{
  const keep={attributes:{'data-object-id':'pptx-x-slide-3-shape-5'},content:'<p>榜单观察</p>',style:{}};
  const line={attributes:{'data-object-id':'pptx-x-slide-3-shape-453'},content:'',style:{}};
  const picture={attributes:{'data-object-id':'pptx-x-slide-3-image-2'},content:'<img src="a.png">',style:{}};
  const other={attributes:{'data-object-id':'pptx-x-slide-6-shape-453'},content:'',style:{}};
  const template={format:'steam-grapesjs-v2',deck:{css:'',pages:[{name:'畅销',objects:[keep,line,picture]},{name:'畅玩',objects:[other]}]}};
  const extraction={order:[3,6],slides:{3:{shapes:{5:[['榜单观察']]},tables:{},charts:{},pictures:[],placeholders:[]},6:{shapes:{453:[]},tables:{},charts:{},pictures:[],placeholders:[]}}};
  const pages=buildNativeDeck(template,extraction,[],()=>'',undefined,[{slide:3,objectId:453},{slide:3,objectId:2}]).project.deck.pages;
  assert.deepEqual(pages[0].objects.map(o=>o.attributes['data-object-id']),['pptx-x-slide-3-shape-5']);
  assert.equal(pages[1].objects.length,1);
});

test('saving a linked project queues write-back, reports problems and blocks stale downloads',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-native-project-'));
  try{
    const dataDir=path.join(root,'data');
    let core=createCore({dataDir,publicUrl:'http://127.0.0.1:4320',pythonExecutable:process.platform==='win32'?'python':'python3'});
    const value={format:'steam-grapesjs-v2',deck:{css:'',pages:[{name:'p',objects:[text(id('shape-4'),'旧标题'),text(id('shape-5'),'保持')]}]}};
    const projectId='aaaaaaaa-0000-4000-8000-000000000001';
    core.db.projects[projectId]={id:projectId,revision:1,month:'2026-08',title:'t',project:value,native:{syncedRevision:1,pending:[],rejected:[],unsupported:[],missing:[]}};
    assert.equal(core.nativeSummary(core.db.projects[projectId]).status,'synced');
    await assert.rejects(async()=>core.nativeDraft('missing-project'));
    const edited=structuredClone(value);edited.deck.pages[0].objects[1].style={left:'9px'};
    const moved=core.save(projectId,1,edited,'human');
    assert.equal(moved.native.syncedRevision,2);assert.equal(moved.native.pending.length,0);
    assert.equal(core.nativeSummary(moved).unsupportedCount,1);
    const undone=core.save(projectId,2,value,'human');
    assert.equal(core.nativeSummary(undone).unsupportedCount,0);
    const text2=structuredClone(value);text2.deck.pages[0].objects[0].content=text2.deck.pages[0].objects[0].content.replace('旧标题','新标题');
    const saved=core.save(projectId,3,text2,'ai');
    assert.equal(core.nativeSummary(saved).status,'syncing');
    assert.throws(()=>core.nativeDraft(projectId),e=>e.status===409);
    await core.nativeSettled(projectId);
    const failed=core.db.projects[projectId];
    assert.equal(core.nativeSummary(failed).status,'failed');assert.ok(failed.native.lastError);
    assert.throws(()=>core.nativeDraft(projectId),/写回失败/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
