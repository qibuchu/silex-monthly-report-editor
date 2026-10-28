const fs=require('fs'),assert=require('node:assert/strict');const {generate}=require('./generate-draft.cjs');const {validateBindingContract}=require('./binding-contract.cjs');
const read=f=>JSON.parse(fs.readFileSync(require('path').join(__dirname,'fixtures',f)));const base=()=>read('acceptance-base.json');const data=read('monthly-2026-07.json');
const sel=read('july-selection.json');const out=generate(base(),data,sel).envelope;
const obj=(p,id)=>p.project.deck.pages.flatMap(x=>x.objects).find(o=>o.attributes['data-object-id']===id);
const plain=o=>o.content.replace(/<[^>]*>/g,'');
assert.deepEqual(out.project.deck.pages.map(p=>p.name),['1 · 封面','2 · 头部榜单','3 · 大盘总览','4 · 金银榜','5 · 附录铜榜']);
assert.equal(out.project.deck.notes.page_profile,'data-supported-five-page');
for(const [tier,id]of [['gold','s5o8'],['silver','s5o9'],['bronze','s9o10']]){const content=plain(obj(out,id));assert(content.includes('上线14日玩家数量环比'));assert(!content.includes('峰值 PCU'));const sorted=[...data.new_releases[tier]].sort((a,b)=>a.revenue_rank_in_tier-b.revenue_rank_in_tier);assert(content.indexOf(sorted[0].game_name)<content.indexOf(sorted[1].game_name));}
assert(plain(obj(out,'s5o9')).includes('hololive Dreams'));assert(!plain(obj(out,'s5o9')).includes('null'));
assert(obj(out,'s4o8').content.includes('font-size:40.0px'));assert(obj(out,'s4o8').content.includes('2,603'));
assert.equal(out.project.deck.pages[1].objects.filter(o=>o.attributes['data-card-role']==='name').length,data.head.highlights.length);
const contract=validateBindingContract(out);assert.equal(contract.valid,true,JSON.stringify(contract.issues));assert.equal(contract.objectCount,out.project.deck.pages.flatMap(p=>p.objects).length);
for(const page of out.project.deck.pages)for(const o of page.objects){const a=o.attributes;assert(a['data-content-layer']);assert(a['data-refresh-policy']);if(a['data-content-layer']==='fixed')assert(a['data-binding-id']);if(a['data-refresh-policy']==='replace')assert.equal(a['data-content-layer'],'fixed');}
assert.equal(obj(out,'s2o9').attributes['data-binding-id'],'head.top20');assert.equal(obj(out,'s4o8').attributes['data-content-layer'],'fixed');
const refreshed=generate(out,data,{...sel,mode:'refresh'}).envelope;assert.equal(refreshed.project.deck.pages.length,5);assert.equal(refreshed.project.deck.notes.page_profile,'data-supported-five-page');
const full=generate(base(),data,{...sel,page_mode:'full'}).envelope;assert.equal(full.project.deck.pages.length,9);assert.equal(full.project.deck.notes.page_profile,'full-nine-page');assert(!obj(full,'s3o21').content.includes('赛博朋克'));assert(obj(full,'s7o33').content.includes('report-upload-slot'));
assert.throws(()=>generate(base(),{...data,status:'error'}),/禁止/);
assert.throws(()=>generate(base(),{...data,schema_version:'1.0'}),/schema/);
const june=generate(base(),read('monthly-2026-06.json'),{}).envelope;assert(plain(obj(june,'s1o4')).includes('6月'));assert.equal(june.project.deck.pages.length,5);
for(const page of june.project.deck.pages)for(const o of page.objects){const s=o.style;assert(parseFloat(s.left)>=0&&parseFloat(s.top)>=0&&parseFloat(s.width)>0&&parseFloat(s.height)>0&&parseFloat(s.left)+parseFloat(s.width)<=1920&&parseFloat(s.top)+parseFloat(s.height)<=1080);}
console.log('PASS: canonical ranking, three tiers, null handling, empty slots, KPI typography, manual refresh preservation, upstream-error rejection, real June rollover, page bounds');
