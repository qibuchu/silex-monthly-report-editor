const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
const {assertDataCredentials,prepareMonthlyData}=require('./data-quality.cjs');
const read=()=>JSON.parse(fs.readFileSync(require('path').join(__dirname,'fixtures/monthly-2026-08.json')));
test('expired credentials stop the task even when a partial packet was returned',()=>{
 assert.throws(()=>assertDataCredentials({...read(),issues:[{code:'auth_expired',message:'JWT expired HTTP 401'}]}),error=>error.code==='CREDENTIALS_REQUIRED'&&error.exitCode===3);
 assert.doesNotThrow(()=>assertDataCredentials(read('monthly-report-renewed.json')));
});
test('current review snapshots are excluded without changing raw evidence',()=>{
 const original=read('monthly-report-renewed.json'),before=JSON.stringify(original),result=prepareMonthlyData(original);
 assert.equal(JSON.stringify(original),before);
 assert.equal(result.data.kpis.review_rate_all.total,null);
 assert.equal(result.data.metric_contracts.rated_game_rate.value,null);
 assert(result.data.market.review_trend.every(row=>row.review_rate_all===null));
 assert(result.blocked.length>=3);
 assert.equal(result.data.kpis.total.value,2851);
});
test('valid release D0-D13 windows survive, including windows crossing month end',()=>{
 const data=read('monthly-report-renewed.json');
 const game=data.new_releases.gold.find(g=>g.appid===4001890),metric=game.day14.metrics.revenue_14d_usd;
 assert.equal(metric.window.end,'2026-09-02');
 assert.equal(prepareMonthlyData(data).data.new_releases.gold.find(g=>g.appid===4001890).day14.metrics.revenue_14d_usd.value,metric.value);
});
test('wrong day14 date or timezone is excluded rather than recomputed',()=>{
 const data=read('monthly-report-renewed.json'),game=data.new_releases.gold[0];
 game.day14.metrics.revenue_14d_usd.window.end='2026-10-12';
 game.day14.metrics.sales_14d_units.window.timezone='UTC';
 game.reviews_14d.snapshot_date='2026-10-12';
 const cleaned=prepareMonthlyData(data).data.new_releases.gold[0];
 assert.equal(cleaned.day14.metrics.revenue_14d_usd.value,null);
 assert.equal(cleaned.day14.metrics.sales_14d_units.value,null);
 assert.equal(cleaned.reviews_14d.value,null);
});
test('removing the current-snapshot warning does not count as historical evidence',()=>{
 const data=read('monthly-report-renewed.json');
 data.issues=data.issues.filter(issue=>issue.code!=='reviews_are_current_snapshot');
 assert.equal(prepareMonthlyData(data).data.kpis.review_rate_all.total,null);
});
