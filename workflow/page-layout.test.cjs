const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
const {generate}=require('./generate-draft.cjs');
const {fitRankingTables,materializeGeneratedCss,updatePageCounters}=require('./page-layout.cjs');
const {applyBindingContract}=require('./binding-contract.cjs');
const base=()=>JSON.parse(fs.readFileSync(require('path').join(__dirname,'../pipeline/monthly-toolkit/templates/steam-ppt-v1.json')));
const data=JSON.parse(fs.readFileSync(require('path').join(__dirname,'fixtures/monthly-2026-08.json')));
test('complete layout keeps source metrics, editable image slots and empty research content',()=>{
 const result=generate(base(),structuredClone(data),{page_mode:'finished-eight',movement_appid:3932890,indie_appids:[4001890,1478500]});
 assert(result.contract.valid,JSON.stringify(result.contract.issues));
 const pages=result.envelope.project.deck.pages,objects=pages.flatMap(p=>p.objects);
 assert(pages.length>=8);
 assert(pages.some(p=>p.objects.some(o=>o.attributes['data-object-id']==='s3o4')));
 assert(pages.some(p=>p.objects.some(o=>o.attributes['data-object-id']==='s7o4')));
 assert(pages.some(p=>p.objects.some(o=>o.attributes['data-object-id']==='s8o6')));
 const cover=objects.find(o=>o.attributes['data-object-id']==='s7o12');
 assert(cover.content.includes('report-upload-slot'));
 assert(cover.content.includes('<img'));
 assert.equal(cover.attributes['data-slot-role'],'game-cover');
 assert.equal(objects.find(o=>o.attributes['data-object-id']==='s7o26').content.replace(/<[^>]+>/g,'').trim(),'');
 assert(objects.find(o=>o.attributes['data-object-id']==='s7o15').content.includes('2942.1'));
 for(const o of objects){const s=o.style;assert(parseFloat(s.left)>=0&&parseFloat(s.top)>=0&&parseFloat(s.width)>0&&parseFloat(s.height)>0&&parseFloat(s.left)+parseFloat(s.width)<=1920&&parseFloat(s.top)+parseFloat(s.height)<=1080,o.attributes['data-object-id']);}
});
test('pagination preserves every row and makes stable IDs/bindings unique',()=>{
 const source=base().project.deck.pages.find(p=>p.objects.some(o=>o.attributes['data-object-id']==='s9o10'));
 const entry=source.objects.find(o=>o.attributes['data-object-id']==='s9o10');
 const rows=[...entry.content.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(m=>m[0]);
 const cell=rows[2];
 entry.content=entry.content.replace(/<tbody>[\s\S]*?<\/tbody>/,'<tbody>'+rows.slice(0,2).join('')+Array.from({length:65},(_,i)=>cell.replace(/>([^<]+)</g,(all,text)=>text.trim()?`>Row${i}<`:all)).join('')+'</tbody>');
 const deck={pages:[source],css:'',notes:{}};
 fitRankingTables(deck);
 assert(deck.pages.length>1);
 const total=deck.pages.flatMap(p=>p.objects).filter(o=>o.attributes['data-kind']==='table').flatMap(o=>[...o.content.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].slice(2));
 assert.equal(total.length,65);
 assert(applyBindingContract(deck).valid);
});
test('cloned Silex text preserves formatting without duplicate generated child IDs',()=>{
 const result=materializeGeneratedCss('<p id="iabcde"><span id="i12345" style="color:#002b5c">原始标题</span></p>','#iabcde{margin:0}#i12345{font-size:48px;font-family:SimSun}');
 assert(result.includes('font-size:48px'));
 assert(result.includes('原始标题'));
 assert(!result.includes('id="i12345"'));
});
test('long game names do not change row height or page count',()=>{
 const original=base().project.deck.pages.find(p=>p.objects.some(o=>o.attributes['data-object-id']==='s5o8'));
 const short={pages:[structuredClone(original)],css:''},long=structuredClone(short);
 for(const o of long.pages[0].objects.filter(o=>['s5o8','s5o9'].includes(o.attributes['data-object-id'])))o.content=o.content.replace(/(<td\b[^>]*>)([\s\S]*?)(<\/td>)/g,(_,a,b,c)=>a+'超长游戏名称'.repeat(60)+c);
 fitRankingTables(short);fitRankingTables(long);
 assert.equal(short.pages.length,long.pages.length);
 const heights=d=>d.pages.flatMap(p=>p.objects).filter(o=>['s5o8','s5o9'].includes(o.attributes['data-object-id'])).map(o=>[...o.content.matchAll(/height:[\d.]+px/g)].map(m=>m[0]));
 assert.deepEqual(heights(short),heights(long));
 assert(long.pages[0].objects.find(o=>o.attributes['data-object-id']==='s5o8').content.includes('text-overflow:ellipsis'));
});
test('page counters never rewrite image payloads or HTML attributes',()=>{
 const source='<img src="data:image/png;base64,abc21/29xyz">';
 const deck={pages:[{objects:[{attributes:{'data-kind':'image'},content:source},{attributes:{'data-kind':'text'},content:'<p title="98/99"><span>03 / 09</span></p>'},{attributes:{'data-kind':'text'},content:'<p>收入21/29</p>'}]}]};
 updatePageCounters(deck);
 assert.equal(deck.pages[0].objects[0].content,source);
 assert.equal(deck.pages[0].objects[1].content,'<p title="98/99"><span>01 / 01</span></p>');
 assert.equal(deck.pages[0].objects[2].content,'<p>收入21/29</p>');
});
