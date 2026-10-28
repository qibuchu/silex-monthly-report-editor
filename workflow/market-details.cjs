// Apply display-only legend and verified historical review metrics.
function applyMarketDetails(deck, data, history = [], issues = []) {
 const find=id=>deck.pages.flatMap(p=>p.objects).find(o=>o.attributes['data-object-id']===id);
 const key=find('market-chart-key');
 if(key)key.content='<div class="text" style="position:absolute;inset:0;padding:0"><div class="rich" style="font-family:Microsoft YaHei,sans-serif;font-size:16px;line-height:1.6"><p style="margin:0 0 20px;color:#002b5c"><span style="display:inline-block;width:26px;border-top:3px solid #002b5c;position:relative;vertical-align:middle;margin-right:7px"><span style="position:absolute;width:7px;height:7px;border-radius:50%;background:#c89c4a;top:-5px;left:10px"></span></span>日均上新数量</p><p style="margin:0 0 20px;color:#c89c4a"><span style="display:inline-block;width:14px;height:14px;background:#c89c4a;margin-right:8px"></span>发售即解封数量</p><p style="margin:0;color:#002b5c"><span style="display:inline-block;width:14px;height:14px;background:#002b5c;margin-right:8px"></span>其他新品数量</p></div></div>';
 const table=find('s4o43');if(!table)return;
 const months=[...(data.market.months||[])].reverse().map(x=>x.month);
 const records=new Map();
 for(const h of history){
  if(h.schema_version==='2.0'&&h.report_month)records.set(h.report_month,require('./data-quality.cjs').prepareMonthlyData(h).data);
  else issues.push({code:'market_history_evidence_missing',message:`${h.report_month||'历史月份'}大盘缺少原始月报数据包，不能仅凭旧摘要回填历史指标。`});
 }
 records.set(data.report_month,data);let row=0;
 table.content=table.content.replace(/<tr\b[\s\S]*?<\/tr>/g,r=>{const ri=row++;if(![1,2,3,4].includes(ri))return r;let col=-1;return r.replace(/<td\b[^>]*>[\s\S]*?<\/td>/g,cell=>{col++;if(!col)return cell;const month=months[col-1],h=records.get(month),trend=data.market.review_trend?.find(t=>t.month===month),metric=h?.metric_contracts?.rated_game_rate;
  const all=h?.kpis?.review_rate_all,sc=h?.kpis?.review_rate_sc;
  const allValid=all&&(!all.status||all.status==='ok'),scValid=sc&&(!sc.status||sc.status==='ok');
  const value=ri===1?(metric?.status==='ok'&&metric.definition_id===data.metric_contracts?.rated_game_rate?.definition_id?metric.value:null):ri===2?(allValid?all.total:null):ri===3?(allValid?all.value:null)??trend?.review_rate_all:(scValid?sc.value:null)??trend?.review_rate_sc;
  const display=typeof value==='number'&&Number.isFinite(value)?(ri===2?(value/10000).toFixed(1)+'万':(value*100).toFixed(1)+'%'):'—';
  if(display==='—')issues.push({code:'market_source_field_missing',message:`${month}玩家评价趋势第${ri}项缺少可用历史数据，未在月报端补算。`});
  let used=false;return cell.replace(/>([^<]+)</g,(a,t)=>{if(!t.trim())return a;const v=used?'':display;used=true;return '>'+v+'<';});});});
 const rated=data.metric_contracts?.rated_game_count;
 const distribution=(data.market.review_distribution||[]).filter(item=>item.includes_insufficient===false&&rated?.status==='ok'&&typeof rated.value==='number'&&item.denominator===rated.value&&typeof item.rate==='number'&&Number.isFinite(item.rate)&&item.rate>=0&&item.rate<=1);
 const rows=[...table.content.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(m=>m[0]);
 const labels=(rows[6]?.match(/<td\b[^>]*>[\s\S]*?<\/td>/g)||[]).map(cell=>cell.replace(/<[^>]*>/g,'').trim());
 const missing=[];let index=0;
 table.content=table.content.replace(/<tr\b[\s\S]*?<\/tr>/g,r=>{if(index++!==7)return r;let col=0;return r.replace(/<td\b[^>]*>[\s\S]*?<\/td>/g,cell=>{const label=labels[col++],metric=distribution.find(item=>item.label===label);if(!metric)missing.push(label);const display=metric?(metric.rate*100).toFixed(1)+'%':'—';let used=false;return cell.replace(/>([^<]+)</g,(s,t)=>{if(!t.trim())return s;const value=used?'':display;used=true;return '>'+value+'<';});});});
 if(missing.length)issues.push({code:'rated_distribution_unavailable',message:'定级产品好评分布缺少相同标签、历史窗口或相符定级分母：'+missing.join('、')+'；不由计数重算或重新归一化。'});
 deck.notes={...deck.notes,market_history:history,market_source_policy:{mode:'upstream-values-only',endpoint:'/api/v1/monthly-dashboard/',business_recalculation:false,stack_fields:['post_unlock','watching','unknown','release_unlock'],snapshot_id:data.snapshot_id}};
}
module.exports={applyMarketDetails};
