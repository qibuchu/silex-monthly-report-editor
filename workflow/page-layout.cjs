const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = value => String(value || '').replace(/<[^>]*>/g, '').trim();
const font = "'Noto Sans SC','Microsoft YaHei',sans-serif";
const serif = "'Noto Serif SC','SimSun',serif";
function materializeGeneratedCss(content, css) {
  const rules = new Map();
  for (const match of (css || '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) for (const selector of match[1].split(',')) if (/^#i[a-z0-9]{4,}$/i.test(selector.trim())) rules.set(selector.trim().slice(1),match[2]);
  return content.replace(/<[^>]+\bid="(i[a-z0-9]{4,})"[^>]*>/gi, (tag,id) => {
    const previous = tag.match(/\bstyle="([^"]*)"/)?.[1] || '';
    const style = (rules.get(id) || '')+';'+previous;
    const clean = tag.replace(/\s+id="[^"]*"/,'').replace(/\s+style="[^"]*"/,'');
    return clean.replace(/>$/, ` style="${escape(style)}">`);
  });
}
function object(id, kind, label, box, content, extra = {}) {
  return { type: 'report-object', classes: ['object'], attributes: { 'data-object-id': id, 'data-kind': kind, 'data-name': label, ...extra }, style: { left: `${box[0]}px`, top: `${box[1]}px`, width: `${box[2]}px`, height: `${box[3]}px` }, content };
}
function text(id, label, box, value = '', size = 24, bold = false, extra = {}) {
  return object(id, 'text', label, box, `<div class="text" style="height:100%;width:100%"><div class="rich" style="height:100%"><p style="margin:0;min-height:100%;line-height:1.35;white-space:pre-wrap"><span style="font-family:${bold ? serif : font};font-size:${size}px;color:#002b5c;font-weight:${bold ? 700 : 400}">${escape(value) || '<br>'}</span></p></div></div>`, extra);
}
function panel(id, label, box) {
  const result = object(id, 'shape', label, box, '');
  Object.assign(result.style, { background: '#ffffff', 'border-radius': '12px', 'box-shadow': '2px 3px 7px rgba(0,0,0,.14)' });
  return result;
}
function imageSlot(id, label, box, role = 'image') {
  const w = box[2], h = box[3];
  const small = w < 100 || h < 100;
  const center = role === 'game-cover' ? 58 : h/2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="report-upload-slot" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="1" y="1" width="${w-2}" height="${h-2}" rx="8" fill="#eef2f5" stroke="#adbdca" stroke-width="2" stroke-dasharray="8 6"/><path d="M${w/2-15} ${center-20}h30v22h-30z M${w/2-12} ${center-1}l9-10 8 7 7-12" fill="none" stroke="#8198ad" stroke-width="2"/>${small ? '' : `<text x="${w/2}" y="${center+28}" text-anchor="middle" font-family="Microsoft YaHei,sans-serif" font-size="20" fill="#526c83">${escape(label)}</text><text x="${w/2}" y="${center+55}" text-anchor="middle" font-family="Microsoft YaHei,sans-serif" font-size="15" fill="#8198ad">双击图片替换</text>`}</svg>`;
  return object(id, 'image', label, box, `<div class="imagebox"><img data-slot-image="true" data-name="${escape(label)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="${escape(label)}" style="width:100%;height:100%;object-fit:contain"></div>`, { 'data-template-slot': 'manual-image', 'data-slot-role': role, 'data-slot-label': label });
}
function blank(id, label, box) { return text(id, label, box, '', 22, false, { 'data-template-slot': 'manual-text', 'data-slot-label': label }); }
function chartSlot(id, label, box) {
  const result = object(id, 'chart', label, box, `<div class="topic-empty-slot" style="position:absolute;inset:0;border:1px dashed #adbdca;border-radius:8px;background:#f4f6f8;display:flex;align-items:center;justify-content:center;font-family:${font};font-size:22px;color:#526c83">${escape(label)}</div>`, { 'data-template-slot': 'manual-chart', 'data-slot-label': label });
  return result;
}
function footer(source) {
  return source.objects.filter(o => o.attributes['data-kind'] === 'text' && Number.parseFloat(o.style.top) >= 1000 && !o.attributes['data-archival']).map(o => structuredClone(o));
}
function heading(source, prefix, titleId, title, section) {
  return [
    text(prefix + '-section', '栏目名称', [80,65,1100,28], section, 17),
    text(titleId, '页面标题', [80,111,1680,75], title, 44, true),
    text(prefix + '-page-number', '页码', [1740,70,100,28], '00 / 00', 16),
    ...footer(source),
  ];
}
function movementPage(source, monthLabel, gameName = '') {
  const objects = heading(source, 'movement', 's3o4', `${monthLabel}Steam头部游戏异动${gameName ? '——《'+gameName+'》' : ''}`, 'Movement / 头部异动');
  objects.push(imageSlot('s3o27', '游戏图标', [80,110,64,64], 'game-icon'));
  objects.find(o => o.attributes['data-object-id'] === 's3o4').style.left = '160px';
  objects.find(o => o.attributes['data-object-id'] === 's3o4').style.width = '1600px';
  objects.push(panel('movement-summary-bg', '活动结论背景', [80,205,1760,64]), blank('s3o21', '活动结论', [102,217,1716,40]));
  objects.push(chartSlot('movement-revenue-chart', '近期营收趋势', [80,290,560,300]), chartSlot('movement-sales-chart', '销量趋势', [680,290,560,300]), chartSlot('s3o28', 'PCU趋势', [1280,290,560,300]));
  objects.push(panel('movement-mechanics-bg', '玩法更新面板', [80,615,850,380]), panel('movement-analysis-bg', '营收分析面板', [970,615,870,380]));
  objects.push(text('s3o14', '玩法栏目标题', [106,638,800,38], '核心更新与玩法机制', 28, true), blank('s3o16', '玩法机制说明', [106,690,800,195]));
  objects.push(text('s3o12', '分析栏目标题', [996,638,818,38], '营收异动原因分析', 28, true), blank('s3o9', '原因分析正文', [996,690,818,195]));
  objects.push(text('movement-player-label', '玩家评价标签', [106,916,142,34], '玩家评价', 21, true), blank('movement-player-comment', '玩家评论引用', [260,906,642,64]));
  objects.push(text('movement-review-label', '研究总结标签', [996,916,142,34], '研究总结', 21, true), blank('movement-review-comment', '研究总结', [1150,906,660,64]));
  return { ...source, name: '入选游戏异动', background:'#f7f5ef', objects };
}
function indiePage(source, prefix, titleId, monthLabel, data, mechanism) {
  const get = id => plain(source.objects.find(o => o.attributes['data-object-id'] === id)?.content);
  const title = get(titleId) || `${monthLabel}Steam亮眼独游`;
  const objects = heading(source, prefix, titleId, title, 'Brilliant indie hit / 亮眼新游');
  objects.push(panel(prefix+'-summary-bg', '专题结论背景', [80,205,1760,64]), blank(prefix+'-summary', '专题结论', [102,217,1716,40]));
  const coverId = mechanism ? 's8o3' : 's7o12';
  objects.push(imageSlot(coverId, '游戏封面', [80,290,580,320], 'game-cover'));
  const ids = mechanism ? ['s8o19','s8o20','s8o21','s8o22'] : ['s7o14','s7o15','s7o16','s7o17'];
  ids.forEach((id, index) => {
    const x = 100+(index%2)*280, y = 425+Math.floor(index/2)*76;
    objects.push(panel(prefix+'-metric-bg-'+index, '数据卡背景', [x,y,260,66]));
    const original = source.objects.find(o => o.attributes['data-object-id'] === id);
    objects.push(text(id, ['销量指标','收入指标','玩家评价','统计窗口'][index], [x+10,y+8,240,52], get(id), 18, false, { ...original?.attributes, 'data-object-id': id, 'data-template-slot': 'data' }));
  });
  objects.push(text(prefix+'-badge', '榜单徽章', [92,303,116,50], '', 22, true, { 'data-template-slot': 'manual-text' }));
  if (!mechanism) {
    objects.push(chartSlot('indie-pcu-chart', 'PCU趋势', [80,630,580,360]));
    objects.push(panel(prefix+'-basic-bg', '基础玩法面板', [700,290,1140,325]), panel(prefix+'-features-bg', '核心亮点面板', [700,640,1140,355]));
    objects.push(text(prefix+'-basic-title', '基础玩法标题', [726,312,1086,42], '1.基础玩法介绍', 28, true), blank('s7o26', '核心循环说明', [726,366,1086,65]));
    objects.push(imageSlot('s7o33', '基础玩法截图', [726,445,370,146], 'gameplay-main'), blank('s7o27', '玩法说明', [1120,445,692,146]));
    objects.push(text(prefix+'-features-title', '核心亮点标题', [726,660,1086,42], '2.核心玩法特色', 28, true));
    for (let i=0;i<3;i++) {
      const x=726+i*365;
      objects.push(blank(['s7o28','s7o29','s7o30'][i], `特色${i+1}说明`, [x,715,340,88]));
      objects.push(imageSlot(['s7o35','s7o38','indie-feature-image-3'][i], `特色${i+1}截图`, [x,823,340,148], 'gameplay-feature'));
    }
  } else {
    objects.push(panel(prefix+'-loop-bg', '基础玩法面板', [80,640,580,355]), text(prefix+'-loop-title', '基础玩法标题', [106,662,528,42], '1.基础玩法介绍', 28, true));
    objects.push(imageSlot('s8o30', '核心循环机制图', [106,724,528,245], 'mechanism-diagram'));
    objects.push(panel(prefix+'-features-bg', '核心亮点面板', [700,290,1140,705]), text(prefix+'-features-title', '核心亮点标题', [726,312,1086,42], '2.核心亮点介绍', 28, true));
    objects.push(blank('s8o25', '机制说明', [726,370,660,70]), imageSlot('s8o31', '沟通机制示意图', [726,458,660,208], 'mechanism-diagram'));
    objects.push(blank('s8o27', '地图与体验分析', [726,684,660,135]), blank('s8o28', '结局与情绪分析', [726,843,660,126]));
    for (let i=0;i<3;i++) objects.push(imageSlot(['s8o33','s8o35','mechanism-feature-image-3'][i], `机制${i+1}配图`, [1410,370+i*202,404,182], 'gameplay-feature'));
  }
  return { ...source, name: '亮眼独游', background:'#f7f5ef', objects };
}
function applyImageSlots(deck) {
  const slots = require('./topic-slots.json');
  const known = new Set(slots.blankImages);
  for (const page of deck.pages) for (const entry of page.objects) {
    if (entry.attributes['data-kind'] !== 'image' || entry.content.includes('<img')) continue;
    if (!known.has(entry.attributes['data-object-id']) && entry.attributes['data-template-slot'] !== 'manual-image') continue;
    const name = entry.attributes['data-card-role'] === 'icon' ? (entry.attributes['data-name'] || '').replace(/\s*[·-]\s*icon$/i,'')+' · 游戏图标' : entry.attributes['data-name'] || '待上传图片';
    const replacement = imageSlot(entry.attributes['data-object-id'], name, ['left','top','width','height'].map(k => Number.parseFloat(entry.style[k])), entry.attributes['data-card-role'] === 'icon' ? 'game-icon' : 'image');
    entry.content = replacement.content;
    Object.assign(entry.attributes, replacement.attributes, { 'data-name': name });
  }
}
function applyFinishedPages(deck, data, selection) {
  const lookup = id => deck.pages.find(page => page.objects.some(o => o.attributes['data-object-id'] === id));
  const movement = lookup('s3o4'), first = lookup('s7o4'), second = lookup('s8o6');
  if (!movement || !first || !second) throw Error('成品结构模板缺少专题页。');
  const name = (data.head.top20 || []).find(game => String(game.appid) === String(selection.movement_appid))?.name || '';
  const month = `${Number(data.report_month.slice(5))}月`;
  deck.pages = [lookup('s1o4'),lookup('s2o9'),movementPage(movement, month, name),lookup('s4o43'),lookup('s5o8'),indiePage(first,'indie','s7o4',month,data,false),indiePage(second,'mechanism','s8o6',month,data,true),lookup('s9o10')];
  const subject = (page,id) => plain(page.objects.find(o=>o.attributes['data-object-id']===id)?.content).match(/《([^》]+)》/)?.[1];
  const firstName=subject(first,'s7o4'),secondName=subject(second,'s8o6');
  const labels = ['封面','头部榜单','入选游戏异动'+(name?' · '+name:''),'大盘总览','金银榜','亮眼独游'+(firstName?' · '+firstName:''),'亮眼独游'+(secondName?' · '+secondName:''),'附录铜榜'];
  deck.pages.forEach((page,index) => page.name = `${index+1} · ${labels[index]}`);
  applyImageSlots(deck);
}
// Fixed row capacity: long names must not change row height or page count.
function fitRankingTables(deck) {
  const ids = new Set(['s5o8','s5o9','s9o10']);
  const expanded = [];
  for (const page of deck.pages) {
   const paginated = [];
   for (const entry of page.objects) {
    if (!ids.has(entry.attributes['data-object-id'])) continue;
    // Silex moves inline formatting into generated #i... CSS rules. Materialize
    // those before changing rows, so old child selectors cannot undo new sizing.
    entry.content = materializeGeneratedCss(entry.content, deck.css);
    const rows = [...entry.content.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(match => match[0]);
    if (rows.length < 3) continue;
    const cols = [...entry.content.matchAll(/<col\s+style="width:\s*([\d.]+)%/g)].map(match => Number(match[1])/100);
    const width = Number.parseFloat(entry.style.width), height = Number.parseFloat(entry.style.height);
    const demand = rows.slice(2).map(() => 36);
    const header = rows.slice(0,2).reduce((total,row) => total + (Number(row.match(/height:\s*([\d.]+)px/)?.[1]) || 50),0);
    const budget = height-header-8;
    const chunks = []; let chunk = [], used = 0;
    demand.forEach((value,index) => {
      if (value > budget) throw Error(`表格单行内容过长：${entry.attributes['data-object-id']} 第${index+1}行；请提供经确认的展示简称。`);
      if (chunk.length && used+value > budget) { chunks.push(chunk); chunk=[]; used=0; }
      chunk.push(index); used+=value;
    });
    if (chunk.length) chunks.push(chunk);
    function contentFor(indices, part) {
      const remaining = Math.max(0,(budget-indices.reduce((sum,index) => sum+demand[index],0))/indices.length);
      const extra = part ? Math.min(18,remaining) : remaining;
      const content = rows.slice(0,2).join('')+indices.map(index => rows[index+2].replace(/height:\s*[\d.]+px/g,`height:${(demand[index]+extra).toFixed(2)}px`).replace(/padding:\s*[\d.]+px\s+[\d.]+px/g,'padding:4px 8px').replace(/line-height:\s*[\d.]+/g,'line-height:1.15').replace(/overflow-wrap:\s*normal/g,'overflow-wrap:anywhere')).join('');
      const fixedContent = content.replace(/(<td\b[^>]*>)([\s\S]*?)(<\/td>)/g, (_, open, body, close) => {
        const label = plain(body).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
        return `${open}<div title="${label}" style="display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${body}</div>${close}`;
      });
      const output = entry.content.replace(/<tbody>[\s\S]*?<\/tbody>/,`<tbody>${fixedContent}</tbody>`).replace(/<table\b[^>]*>/, tag => /style="/.test(tag) ? tag.replace(/style="/, 'style="table-layout:fixed;width:100%;') : tag.replace(/>$/, ' style="table-layout:fixed;width:100%">'));
      return part ? output.replace(/<table\b[^>]*>/,tag=>tag.replace(/height:\s*[\d.]+px/g,'height:auto')) : output;
    }
    const contents = chunks.map(contentFor);
    paginated.push({ entry, contents });
   }
   if (!paginated.length) { expanded.push(page); continue; }
   const count = Math.max(...paginated.map(item => item.contents.length));
   for (let part=0;part<count;part++) {
     const next = structuredClone(page);
     next.objects = next.objects.filter(entry => {
       const table = paginated.find(item => item.entry.attributes['data-object-id'] === entry.attributes['data-object-id']);
       if (table && !table.contents[part]) return false;
       if (table) entry.content = table.contents[part];
       if (part) {
         const id = entry.attributes['data-object-id'];
         entry.attributes['data-object-id'] = `${id}-continued-${part}`;
         if(entry.attributes.id)entry.attributes.id=entry.attributes['data-object-id'];
         entry.attributes['data-continuation-of'] = id;
         entry.attributes['data-page-part'] = String(part);
         entry.content = materializeGeneratedCss(entry.content,deck.css);
       }
       return true;
     });
     if (part) { next.name = page.name+'（续）'; next.layoutContinuationOf = paginated[0].entry.attributes['data-object-id']; }
     expanded.push(next);
   }
  }
  deck.pages = expanded;
}
function updatePageCounters(deck) {
  deck.pages.forEach((page,index) => {
    for (const entry of page.objects) {
      if (entry.attributes['data-kind'] !== 'text' || !/^\d{2}\s*\/\s*\d+$/.test(plain(entry.content))) continue;
      const counter = `${String(index+1).padStart(2,'0')} / ${String(deck.pages.length).padStart(2,'0')}`;
      let written = false;
      entry.content = entry.content.replace(/>([^<]*)</g, (all,value) => {
        if (!value.trim()) return all;
        const text = written ? '' : counter;
        written = true;
        return `>${text}<`;
      });
    }
  });
}
module.exports = { applyFinishedPages, applyImageSlots, fitRankingTables, imageSlot, materializeGeneratedCss, updatePageCounters };
