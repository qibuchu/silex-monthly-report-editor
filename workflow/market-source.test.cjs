const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {marketSeries}=require('./market-source.cjs');
const {generate}=require('./generate-draft.cjs');
const {applyMarketDetails}=require('./market-details.cjs');
const base=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../pipeline/monthly-toolkit/templates/steam-ppt-v1.json')));
const data=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/monthly-2026-08.json')));
test('market categories and daily averages are copied without subtraction, normalization or null-to-zero',()=>{
 const input={market:{months:[{month:'2026-08',total:999,release_unlock:7,post_unlock:2,watching:3,unknown:4,daily_avg:12.34}]}};
 const output=marketSeries(input);
 assert.deepEqual(output.series.map(s=>s.values[0]),[2,3,4,7]);assert.deepEqual(output.daily,[12.34]);
 delete input.market.months[0].unknown;const issues=[];const missing=marketSeries(input,issues);
 assert(missing.series.every(s=>s.values[0]===null));assert(issues.some(i=>i.path==='market.months.2026-08.unknown'));
 input.market.months[0].daily_avg=0;assert.deepEqual(marketSeries(input).daily,[0]);
});
test('generator preserves upstream bar values and leaves historical review snapshots blank',()=>{
 const input=data(),out=generate(base(),input,{}),objects=out.envelope.project.deck.pages.flatMap(p=>p.objects);
 const content=objects.find(o=>o.attributes['data-object-id']==='s4o15').content;
 const definition=JSON.parse(content.match(/data-chart="([^"]+)"/)[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&'));
 assert.deepEqual(definition.series.map(s=>s.values[2]),[178,2376,13,284]);
 assert(objects.find(o=>o.attributes['data-object-id']==='s4o43').content.includes('—'));
 assert.equal(out.envelope.project.deck.notes.market_source_policy.business_recalculation,false);
});
test('review distribution takes returned rate with matching denominator and never derives count/denominator',()=>{
 const deck=base().project.deck,table=deck.pages.flatMap(p=>p.objects).find(o=>o.attributes['data-object-id']==='s4o43');
 const input={report_month:'2026-08',snapshot_id:'test-only',market:{months:[{month:'2026-08'}],review_trend:[],review_distribution:[{label:'好评如潮',rate:.23,count:99,denominator:100,includes_insufficient:false}]},kpis:{},metric_contracts:{rated_game_count:{status:'ok',value:100}}};
 applyMarketDetails(deck,input,[]);assert(table.content.includes('23.0%'));assert(!table.content.includes('99.0%'));
 input.market.review_distribution[0].denominator=999;applyMarketDetails(deck,input,[]);assert(!table.content.includes('23.0%'));
});
test('verified upstream review values without optional status are displayed, while legacy history summaries are rejected',()=>{
 const input=data();
 for(const key of ['review_rate_all','review_rate_sc','rated_game'])input.kpis[key].snapshot_date='2026-08-31';
 input.issues=input.issues.filter(i=>i.code!=='reviews_are_current_snapshot');
 const result=generate(base(),input,{market_history:[{report_month:'2026-07',total_reviews:999999}]});
 const table=result.envelope.project.deck.pages.flatMap(p=>p.objects).find(o=>o.attributes['data-object-id']==='s4o43').content;
 assert(table.includes((input.kpis.review_rate_all.total/10000).toFixed(1)+'万'));
 assert(!table.includes('100.0万'));
 assert(result.issues.some(i=>i.code==='market_history_evidence_missing'));
});
test('chart renderer skips missing bars and breaks missing line points instead of plotting zero',()=>{
 const scope={escapeHTML:v=>String(v)};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(__dirname,'../outputs/monthly-editor/chart.js'),'utf8'),scope);
 const render=definition=>{const el={dataset:{chart:JSON.stringify(definition)},parentElement:{style:{width:'800',height:'400'}}};scope.renderChart(el);return el.innerHTML;};
 const common={categories:['1','2','3'],hideY:true,hideX:true,legend:false,format:''};
 const bars=render({...common,type:'bar',stacked:true,series:[{color:'blue',values:[2,null,0]},{color:'gold',values:[3,8,0]}]});
 assert.equal((bars.match(/<rect /g)||[]).length,4);assert(!bars.includes('NaN'));
 const line=render({...common,type:'line',series:[{color:'blue',values:[2,null,0]}]});assert.equal((line.match(/<circle /g)||[]).length,2);assert.equal((line.match(/<polyline /g)||[]).length,2);assert(!line.includes('NaN'));
});
