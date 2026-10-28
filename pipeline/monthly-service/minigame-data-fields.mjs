// Only label known fields; never recompute ranking, growth, revenue or player metrics.
const names={game_name:'游戏',publisher:'厂商',genre:'玩法',avg_rank:'月均排名',rank_delta:'环比',avg_plan:'日均计划数',plan_delta_pct:'计划数环比',avg_material:'日均素材数',material_delta_pct:'素材数环比',douyin_bestseller_avg_rank:'抖音畅销排名',first_buying_date:'首次投放',first_entry_date:'冲榜时间'};
export function matchSourceViews(sources){return sources.map(s=>{
 const minigame=s.origin?.includes('/minigame-db/api/report/monthly/export');if(!minigame)return s;
 return {...s,tables:s.tables.map(t=>{
  const role=['bestseller','most_played','new_games.bestseller','new_games.most_played'].includes(t.name)?t.name:null;
  if(!role||t.columns.includes('__source_row_number'))return t;
  // New-game tables: when the source provides featured_rank, rows follow it (cards, leads and sentences share one order).
  const fr=t.columns.indexOf('featured_rank');
  if(role.startsWith('new_games.')&&fr>=0){const key=r=>{const n=Number(String(r[fr]).replace(/,/g,''));return String(r[fr]??'').trim()===''||!Number.isFinite(n)?Infinity:n;};t={...t,rows:t.rows.map((r,i)=>({r,i})).sort((a,b)=>key(a.r)-key(b.r)||a.i-b.i).map(v=>v.r)};}
  return {...t,role,columns:[...t.columns,'__source_row_number'],columnLabels:[...t.columns.map(c=>names[c]||c),'#'],rows:t.rows.map((r,i)=>[...r,String(i+1)]),derivedDisplayColumns:['__source_row_number']};
 })};
 });}
