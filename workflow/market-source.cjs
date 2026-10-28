// Only consume upstream business values. Stacking and axis positioning belong
// to rendering; do not derive an "other" count, ratios or review totals here.
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
function marketSeries(data,issues=[]){
 const months=data.market?.months||[];
 const fields=['post_unlock','watching','unknown','release_unlock'];
 const complete=months.map(row=>fields.every(key=>number(row[key])));
 months.forEach((row,index)=>{
  for(const key of [...fields,'total','daily_avg'])if(!number(row[key]))issues.push({code:'market_source_field_missing',path:`market.months.${row.month}.${key}`,message:`${row.month}大盘缺少有效的${key}，不在月报端补算。`});
  if(!complete[index])issues.push({code:'market_stack_incomplete',message:`${row.month}新品分类不完整，该月堆叠柱留空；总量及日均仍可独立展示。`});
 });
 return {
  categories:months.map(row=>Number(row.month.slice(5))+'月'),
  series:fields.map((field,index)=>({name:['后解锁','观察中','未知状态','发售即解封数量'][index],color:index===3?'#c89c4a':'#002b5c',source:`market.months[].${field}`,values:months.map((row,i)=>complete[i]?row[field]:null)})),
  daily:months.map(row=>number(row.daily_avg)?row.daily_avg:null),
 };
}
module.exports={marketSeries};
