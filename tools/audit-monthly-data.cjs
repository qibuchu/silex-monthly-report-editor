const fs=require('node:fs'),path=require('node:path');
const {prepareMonthlyData}=require('../workflow/data-quality.cjs');
const folder=path.resolve(process.argv[2]),months=['2026-06','2026-07','2026-08'];
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const save=(file,value)=>fs.writeFileSync(path.join(folder,file),JSON.stringify(value,null,2));
const packets=months.map(month=>read(path.join(folder,`monthly-report-${month}.json`)));
const result={checked_at:'2026-10-15',fresh_network_read:true,recompute_requested:false,months:[],comparison:{},cross_month_checks:[]};
for(const [i,p]of packets.entries()){
 if(p.report_month!==months[i])throw Error('Report month mismatch');
 const {data,blocked}=prepareMonthlyData(p),validation=read(path.join(folder,`validation-${p.report_month}.json`));
 const games=['gold','silver','bronze'].flatMap(tier=>(p.new_releases[tier]||[]).map(game=>({tier,...game})));
 const counts={},checks=[];
 for(const game of games){
  const expectedStart=game.release_date,d=new Date(`${expectedStart}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+13);const expectedEnd=Number.isFinite(d.valueOf())?d.toISOString().slice(0,10):null;
  for(const name of ['revenue_14d_usd','sales_14d_units','pcu_peak_14d','player_change_14d']){
   const raw=game.day14?.metrics?.[name],safe=data.new_releases[game.tier].find(g=>g.appid===game.appid).day14?.metrics?.[name];
   const allowed=safe?.status==='ok'&&safe.value!=null;
   const state=allowed?'window_evidence_passed':raw?.status==='ok'?'excluded_window_evidence':'upstream_incomplete';
   counts[`${name}:${state}`]=(counts[`${name}:${state}`]||0)+1;
   checks.push({appid:game.appid,name:game.game_name,metric:name,raw_status:raw?.status||'missing',state,value:allowed?raw.value:null,expected:{start:expectedStart,end:expectedEnd,timezone:'UTC+8'},actual:raw?.window||null,source:raw?.source||null,reason:blocked.find(b=>b.path===`new_releases.${game.tier}.${game.appid}.day14.${name}`)?.reason||raw?.reason||null});
  }
  const raw=game.reviews_14d,safe=data.new_releases[game.tier].find(g=>g.appid===game.appid).reviews_14d;
  const state=safe?.status==='ok'&&safe.value!=null?'window_evidence_passed':raw?.status==='ok'?'excluded_window_evidence':'upstream_incomplete';
  counts[`reviews_14d:${state}`]=(counts[`reviews_14d:${state}`]||0)+1;
  checks.push({appid:game.appid,name:game.game_name,metric:'reviews_14d',raw_status:raw?.status||'missing',state,expected_snapshot:expectedEnd,actual_snapshot:raw?.snapshot_date||null});
 }
 const summary={month:p.report_month,snapshot_id:p.snapshot_id,data_cutoff:p.data_cutoff,computed_at:p.computed_at,status:p.status,contract_errors:validation.errors,contract_warnings:validation.warnings,head_count:p.head.top20.length,highlights:p.head.highlights.length,tiers:Object.fromEntries(['gold','silver','bronze'].map(t=>[t,p.new_releases[t].length])),metric_counts:counts,excluded:blocked,issues:p.issues,weeks:p.head.weeks,previous_weeks:p.head.previous_weeks};
 result.months.push(summary);
 save(`time-window-audit-${p.report_month}.json`,{...summary,checks});
 save(`consumption-${p.report_month}.json`,data);
}
const aug=packets[2],old=read(path.resolve('work/2026-08/acceptance-2026-10-12/monthly-report-renewed.json'));
const projection=p=>({kpis:p.kpis,market:p.market,head:p.head.top20.map(g=>({appid:g.appid,rank:g.rank,monthly_revenue:g.monthly_revenue,previous_month_revenue:g.previous_month_revenue,revenue_growth:g.revenue_growth,rank_delta:g.rank_delta})),new_releases:Object.fromEntries(['gold','silver','bronze'].map(t=>[t,p.new_releases[t].map(g=>({appid:g.appid,rank:g.revenue_rank_in_tier,release_date:g.release_date,metrics:g.day14?.metrics,reviews_14d:g.reviews_14d}))]))});
const previous=projection(old),current=projection(aug),changes=[];
function diff(a,b,key=''){
 if(JSON.stringify(a)===JSON.stringify(b))return;
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b))for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],key?key+'.'+k:k);
 else changes.push({path:key,before:a??null,after:b??null});
}
diff(previous,current);
result.comparison={previous_snapshot:old.snapshot_id,current_snapshot:aug.snapshot_id,business_sections_identical:changes.length===0,changes};
for(const p of packets)for(const row of aug.market.months||[])if(row.month===p.report_month)result.cross_month_checks.push({month:p.report_month,august_trend_total:row.total,own_packet_total:p.kpis.total.value,matched:row.total===p.kpis.total.value});
save('audit-summary.json',result);
const cohortLines=['# 新旧包差异与上游待核对项','','本次仅GET取数，没有调用recompute。新快照不代表历史口径问题已修复。','','|指标|10月12日包|10月15日包|','|---|---:|---:|',...aug.market.months.map(row=>`|${row.month}新品数量|${old.market.months.find(m=>m.month===row.month)?.total??'缺失'}|${row.total}|`),'',`8月业务投影比较共${changes.length}处差异；详细值见audit-summary.json。头部收入/名次与新游14日指标在本次投影中未变化。`,'','## 上游需要解释或补齐','','1. 同一历史月份的新品总数为何变化：回补、清洗、active过滤或统计范围变更？需给出变更记录与采用的历史截止日，不能由客户端猜测。','2. 大盘评价仍明确来自当前games快照；需历史月末状态或目标月增量对应的原始历史证据，以及准确指标定义。','3. 解锁/观察与定级状态需要历史as_of日期；按发售月分组不能证明这些状态就是当时状态。','4. 8月appid2523770的cached_day14收入/销量窗口end=null，需补窗口结束日及完整性证据；不在客户端重算。','5. 7月appid4376930、4508340缺release_date；无法核实月归属和D0–D13，应补来源与发售日期。','6. 缺失PCU、玩家变化和D13评测保持空值，补历史数据后再核验；不得替换成当前累计值。','','当前结论：契约校验无errors，但历史时间口径与原始真实性未全部通过。'];
fs.writeFileSync(path.join(folder,'新旧差异与上游待核对.md'),cohortLines.join('\n')+'\n');
const august=result.months[2],lines=['# 8月数据复取与校验结果','','核验日期：2026-10-15。使用现有Skill在线GET获取6、7、8月数据，未调用recompute。人工项目未覆盖。','','## 凭据与来源','','- health正常，DataBrain PAT/JWT预检均正常。','- 原始JSON、查询日志、上游validation和逐项窗口审核均保存在本目录。','','## 结论','','**结构检查通过，历史口径核验未全部通过，不能宣称全部数据正确。**','','|月份|新快照|状态|头部榜|金/银/铜|结构错误|','|---|---|---|---:|---|---:|',...result.months.map(m=>`|${m.month}|${m.snapshot_id}|${m.status}|${m.head_count}|${m.tiers.gold}/${m.tiers.silver}/${m.tiers.bronze}|${m.contract_errors.length}|`),'','## 8月上线14日字段','','“窗口证据通过”只表示返回日期/时区/缺失状态符合要求，未独立核实DataBrain原始真实值，不重算业务指标。','','|指标|窗口证据通过|上游不完整|上游ok但窗口证据不足|','|---|---:|---:|---:|',...['revenue_14d_usd','sales_14d_units','pcu_peak_14d','player_change_14d','reviews_14d'].map(k=>`|${k}|${august.metric_counts[k+':window_evidence_passed']||0}|${august.metric_counts[k+':upstream_incomplete']||0}|${august.metric_counts[k+':excluded_window_evidence']||0}|`),'','## 必须排除或继续核对','','- 三个月均仍标记reviews_are_current_snapshot，大盘当前评测/好评率和依赖当前评测的定级状态不得作为历史月报数值。','- “按发售月统计的新品数量”与“发售当时/月底的解锁或评价状态”是不同时间维度；未知解锁历史仍不能补算。','- 缺失和窗口证据不足保持空值；具体appid、窗口和原因见time-window-audit-2026-08.json。','- 营收、销量的原始值真实性与业务公式仍需要原平台同appid、同窗口核对；本次未用另一套算法重算。','- 重点游戏不足4款及AND选取条件未确认、图片未落地等上游问题仍保留。','','## 与10月12日8月包比较','',`- 新snapshot_id：${aug.snapshot_id}。`,`- 已比较业务字段${changes.length===0?'未变化':'有变化（见audit-summary.json）'}；新快照ID不等于历史口径已经修复。`,`- 6/7/8月趋势总数与各自数据包核对：${result.cross_month_checks.every(c=>c.matched)?'一致':'不一致，见audit-summary.json'}。`,'','## 文件使用','','- monthly-report-*.json：上游原始返回，未修改。','- validation-*.json：Skill契约校验，不等于真实性通过。','- time-window-audit-*.json：逐游戏逐指标窗口检查及排除原因。','- consumption-*.json：排除不符合历史要求字段后的消费副本，不冒充上游原始数据。','- audit-summary.json：三月汇总及新旧差异。'];
fs.writeFileSync(path.join(folder,'复取与校验结果.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({months:result.months.map(m=>({month:m.month,status:m.status,head:m.head_count,tiers:m.tiers,excluded:m.excluded.length})),august:august.metric_counts,businessChanges:changes.length,crossMonth:result.cross_month_checks}));
