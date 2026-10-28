const all = (e, name) => Array.from(e.querySelectorAll('*')).filter(n => n.localName === name);
const first = (e, name) => all(e, name)[0];
const value = (e, name) => first(e, name)?.getAttribute('val');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
function points(root) {
    if (!root)
        return [];
    const count = Number(value(root, 'ptCount') || all(root, 'pt').length);
    const values = Array.from({ length: Math.min(2000, count) }, () => '');
    for (const point of all(root, 'pt')) {
        const index = Number(point.getAttribute('idx'));
        if (index >= 0 && index < values.length)
            values[index] = first(point, 'v')?.textContent || '';
    }
    return values;
}
export function readImportedChart(document, color) {
    const plots = all(document, 'plotArea')[0];
    if (!plots)
        return;
    const types = Array.from(plots.children).filter(n => n.localName.endsWith('Chart'));
    if (types.length !== 1 || !['lineChart', 'barChart'].includes(types[0].localName))
        return;
    if (types[0].localName === 'barChart' && value(types[0], 'barDir') !== 'col')
        return;
    if (value(types[0], 'grouping') === 'percentStacked')
        return;
    if (types[0].localName === 'lineChart' && value(types[0], 'grouping') === 'stacked')
        return;
    const series = all(types[0], 'ser');
    const categories = points(series[0] && first(series[0], 'cat'));
    const cat = series[0] && first(series[0], 'cat');
    const categoryAxis = first(plots, 'catAx') || first(plots, 'dateAx');
    const categoryFormat = (categoryAxis && first(categoryAxis, 'numFmt')?.getAttribute('formatCode')) || (cat && first(cat, 'formatCode')?.textContent) || '';
    if (/[dm]/i.test(categoryFormat) && !/[hs]/i.test(categoryFormat))
        categories.forEach((v, i) => {
            const serial = Number(v);
            if (!v || !Number.isFinite(serial) || serial < 1 || serial > 100000)
                return;
            const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
            categories[i] = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
        });
    if (!categories.length)
        return;
    const result = {
        title: all(first(document, 'title') || document.createElement('empty'), 't').map(n => n.textContent || '').join(''),
        categories, type: types[0].localName === 'barChart' ? 'bar' : 'line', stacked: value(types[0], 'grouping') === 'stacked',
        legend: Boolean(first(document, 'legend')),
        series: series.map((s, index) => ({ name: first(first(s, 'tx') || s, 'v')?.textContent || `系列${index + 1}`, values: points(first(s, 'val')).map(v => v.trim() && Number.isFinite(Number(v)) ? Number(v) : null), color: color(first(s, 'spPr'), ['#002b5c', '#c89c4a', '#5a8a9a', '#da7755'][index % 4]) })),
    };
    const axis = first(plots, 'valAx');
    if (axis) {
        const min = value(axis, 'min'), max = value(axis, 'max');
        if (min !== undefined && Number.isFinite(Number(min)))
            result.minimum = Number(min);
        if (max !== undefined && Number.isFinite(Number(max)))
            result.maximum = Number(max);
    }
    if (!result.series.some(s => s.values.some(v => v !== null)))
        return;
    if (result.stacked && result.series.some(s => s.values.some(v => v !== null && v < 0)))
        return;
    return result;
}
export function renderImportedChart(data, width, height) {
    if (data.type === 'hbar' || data.type === 'combo' || data.series?.some(s => s.render || s.axis || s.stack || s.labels)) return renderDeclaredChart(data, width, height);
    if (!['line', 'bar'].includes(data.type) || !Array.isArray(data.categories) || !data.categories.length || data.categories.length > 2000 || !Array.isArray(data.series) || !data.series.length || data.series.length > 20)
        throw Error('图表需要1至20组系列和有效分类。');
    for (const series of data.series)
        if (!Array.isArray(series.values) || series.values.length !== data.categories.length || series.values.some(v => v !== null && (typeof v !== 'number' || !Number.isFinite(v))))
            throw Error('每组数值数量须与分类一致；缺失值使用 null。');
    const w = Math.max(150, width), h = Math.max(120, height), font = Math.max(10, Math.min(22, h / 22));
    const left = font * 4, right = w - font, top = data.title ? font * 2.7 : font, bottom = h - font * (data.legend ? 4 : 2.2);
    const vals = data.series.flatMap(s => s.values.filter((v) => v !== null));
    const totals = data.categories.map((_, i) => data.series.reduce((sum, s) => sum + Math.max(0, s.values[i] || 0), 0));
    const minimum = data.minimum ?? Math.min(0, ...vals);
    const maximum = data.maximum ?? Math.max(1, ...(data.stacked ? totals : vals)) * 1.1;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum)
        throw Error('坐标轴最大值必须大于最小值。');
    const y = (v) => bottom - (v - minimum) / (maximum - minimum) * (bottom - top);
    const x = (i) => left + (right - left) * (data.type === 'bar' ? (i + .5) / data.categories.length : i / Math.max(1, data.categories.length - 1));
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(data.title || '导入图表')}" style="font-family:Arial,'Microsoft YaHei',sans-serif;font-size:${font}px">`];
    if (data.title)
        parts.push(`<text x="${w / 2}" y="${font * 1.3}" text-anchor="middle" fill="#444">${esc(data.title)}</text>`);
    for (let i = 0; i <= 5; i++) {
        const v = minimum + (maximum - minimum) * i / 5;
        parts.push(`<line x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}" stroke="#d7dce1" stroke-width="1"/><text x="${left - 8}" y="${y(v) + font * .35}" text-anchor="end" fill="#666">${esc(Number(v.toPrecision(4)))}</text>`);
    }
    const stack = data.categories.map(() => 0);
    data.series.forEach((series, index) => {
        const c = /^#[a-f\d]{6}$/i.test(series.color) ? series.color : '#002b5c';
        if (data.type === 'line') {
            let path = '', drawing = false;
            series.values.forEach((v, i) => { if (v === null) {
                drawing = false;
                return;
            } ; path += `${drawing ? 'L' : 'M'}${x(i)} ${y(v)} `; drawing = true; });
            parts.push(`<path d="${path}" fill="none" stroke="${c}" stroke-width="2.5"/>`);
        }
        else {
            const step = (right - left) / data.categories.length, bw = step * .65 / (data.stacked ? 1 : data.series.length);
            series.values.forEach((v, i) => {
                if (v === null)
                    return;
                const base = data.stacked ? stack[i] : 0;
                const xx = x(i) - step * .325 + (data.stacked ? 0 : index * bw);
                parts.push(`<rect x="${xx}" y="${Math.min(y(base + v), y(base))}" width="${bw}" height="${Math.abs(y(base + v) - y(base))}" fill="${c}"/>`);
                if (data.stacked)
                    stack[i] += v;
            });
        }
        if (data.legend) {
            const xx = left + index * (right - left) / data.series.length;
            parts.push(`<rect x="${xx}" y="${h - font * 1.2}" width="${font}" height="${font * .5}" fill="${c}"/><text x="${xx + font * 1.4}" y="${h - font * .7}" fill="#555">${esc(series.name)}</text>`);
        }
    });
    const stride = Math.max(1, Math.ceil(data.categories.length / 18));
    data.categories.forEach((category, i) => { if (i % stride === 0)
        parts.push(`<text x="${x(i)}" y="${bottom + font * 1.5}" text-anchor="middle" fill="#666">${esc(category)}</text>`); });
    return parts.join('') + '</svg>';
}

// "Nice" axis: 1/2/2.5/5 x 10^n steps, upper bound rounded up, integer labels when the step allows.
export function niceAxis(maxValue, count = 5, integer = false) {
    const max = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1;
    const raw = max / count, power = 10 ** Math.floor(Math.log10(raw)), unit = raw / power;
    let step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
    // Counts cannot use 2.5 steps below 10; prefer 2 (up to 7 ticks) before jumping to 5.
    if (integer && step === 2.5 * power && power < 10) step = max / (2 * power) <= 7 ? 2 * power : 5 * power;
    if (integer) step = Math.max(1, Math.round(step));
    const top = Math.ceil(max / step - 1e-9) * step;
    return { max: top, step, ticks: Math.round(top / step) };
}
const tickText = (value, step) => {
    const digits = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
    return Number(value.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits });
};
export function renderDeclaredChart(data, width, height) {
    if (!['bar','hbar','line','combo'].includes(data.type) || !Array.isArray(data.categories) || !data.categories.length || data.categories.length > 2000 || !Array.isArray(data.series) || !data.series.length || data.series.length > 20) throw Error('图表分类或系列无效');
    const w=Math.max(200,width),h=Math.max(140,height),horizontal=data.type==='hbar',font=Math.max(11,Math.min(20,h/25));
    const hasRight=data.series.some(s=>s.axis==='right');
    const left=horizontal?Math.min(w*.38,Math.max(110,font*10)):font*4,right=w-(hasRight?font*5:font*2),top=font*(data.stackTotals?2.6:2),bottom=h-font*3;
    const color=s=>/^#[0-9a-f]{6}$/i.test(s.color||'')?s.color:'#002b5c';
    const renderOf=s=>s.render||(data.type==='line'?'line':'bar');
    const groups=[...new Set(data.series.map((s,i)=>renderOf(s)==='line'?null:(s.stack||`series-${i}`)).filter(Boolean))];
    // Axis maximum: bars of the same stack are summed per category; lines use their own values.
    const axisMax=axis=>{let m=0;data.categories.forEach((_,i)=>{const sums=new Map();data.series.forEach((s,j)=>{if((s.axis||'left')!==axis)return;const v=s.values[i];if(v===null||v===undefined)return;if(renderOf(s)==='line'){m=Math.max(m,v);return;}const g=s.stack||`series-${j}`;sums.set(g,(sums.get(g)||0)+Math.max(0,v));});for(const v of sums.values())m=Math.max(m,v);});return m;};
    const integerAxis=axis=>data.series.filter(s=>(s.axis||'left')===axis).every(s=>s.values.every(v=>v===null||v===undefined||Number.isInteger(v)));
    const L=niceAxis(axisMax('left')*1.05,5,integerAxis('left')),R=niceAxis(axisMax('right')*1.05,5,integerAxis('right'));
    const py=(v,axis='left')=>bottom-v/(axis==='right'?R.max:L.max)*(bottom-top);
    const px=v=>left+v/L.max*(right-left);
    const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(data.title||'数据图表')}" style="font-family:'Microsoft YaHei',Arial,sans-serif;font-size:${font}px">`];
    if(data.title)parts.push(`<text x="${left}" y="${font*1.2}" fill="#c89c4a">${esc(data.title)}</text>`);
    for(let i=0;i<=L.ticks;i++){const v=L.step*i;if(horizontal){const xx=px(v);parts.push(`<line x1="${xx}" y1="${top}" x2="${xx}" y2="${bottom}" stroke="#e3e6ea"/><text x="${xx}" y="${bottom+font*1.4}" text-anchor="middle" fill="#6c7480">${esc(tickText(v,L.step))}</text>`);}else{const yy=py(v);parts.push(`<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#e3e6ea"/><text x="${left-6}" y="${yy+font*.35}" text-anchor="end" fill="#6c7480">${esc(tickText(v,L.step))}</text>`);}}
    if(hasRight&&!horizontal)for(let i=0;i<=R.ticks;i++){const v=R.step*i,yy=py(v,'right');parts.push(`<text x="${right+6}" y="${yy+font*.35}" fill="#6c7480">${esc(tickText(v,R.step))}</text>`);}
    const step=(horizontal?(bottom-top):(right-left))/data.categories.length;
    const totalFormat=v=>Number(v.toFixed(data.totalDecimals??1)).toLocaleString('en-US',{maximumFractionDigits:data.totalDecimals??1});
    data.categories.forEach((category,i)=>{
      if(horizontal){const cy=top+step*(i+.5);parts.push(`<text x="${left-9}" y="${cy+font*.35}" text-anchor="end" fill="#002b5c">${esc(String(category).slice(0,20))}</text>`);}
      else{const xx=left+step*(i+.5);parts.push(`<text x="${xx}" y="${bottom+font*1.4}" text-anchor="middle" fill="#002b5c">${esc(String(category).slice(0,12))}</text>`);}
      if(data.series.every(s=>s.values[i]===null||s.values[i]===undefined)){const cx=horizontal?(left+right)/2:left+step*(i+.5),cy=horizontal?top+step*(i+.5)+font*.35:(top+bottom)/2;parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" fill="#9aa3ad">数据待补</text>`);return;}
      const stacks=new Map(),members=new Map();data.series.forEach((s,j)=>{if(renderOf(s)!=='line'){const g=s.stack||`series-${j}`;members.set(g,(members.get(g)||0)+1);}});
      data.series.forEach((s,j)=>{const v=s.values[i];if(v===null||v===undefined||renderOf(s)==='line')return;const c=color(s);
        const group=s.stack||`series-${j}`,gi=groups.indexOf(group),base=stacks.get(group)||0,stacked=members.get(group)>1;stacks.set(group,base+Math.max(0,v));
        if(horizontal){const bh=step*.72/groups.length,yy=top+step*i+step*.14+gi*bh,x0=px(base),x1=px(base+Math.max(0,v));parts.push(`<rect x="${x0}" y="${yy}" width="${Math.max(0,x1-x0)}" height="${bh}" fill="${c}"/>`);
          if(s.labels?.[i])parts.push(stacked&&x1-x0>font*3?`<text x="${(x0+x1)/2}" y="${yy+bh/2+font*.35}" text-anchor="middle" fill="#fff">${esc(s.labels[i])}</text>`:`<text x="${Math.min(w-font,x1+5)}" y="${yy+bh/2+font*.35}" fill="#002b5c">${esc(s.labels[i])}</text>`);}
        else{const bw=step*.72/groups.length,xx=left+step*i+step*.14+gi*bw,y0=py(base,s.axis),y1=py(base+Math.max(0,v),s.axis);parts.push(`<rect x="${xx}" y="${y1}" width="${bw}" height="${Math.max(0,y0-y1)}" fill="${c}"/>`);
          if(s.labels?.[i]){if(stacked){if(y0-y1>font*1.3)parts.push(`<text x="${xx+bw/2}" y="${(y0+y1)/2+font*.35}" text-anchor="middle" fill="#fff">${esc(s.labels[i])}</text>`);}else parts.push(`<text x="${xx+bw/2}" y="${y1-4}" text-anchor="middle" fill="#002b5c">${esc(s.labels[i])}</text>`);}}
      });
      if(data.stackTotals&&!horizontal)for(const [group,total] of stacks){if((members.get(group)||0)<2||total<=0)continue;const gi=groups.indexOf(group),bw=step*.72/groups.length,xx=left+step*i+step*.14+gi*bw,axis=(data.series.find((s,j)=>(s.stack||`series-${j}`)===group)?.axis)||'left';parts.push(`<text x="${xx+bw/2}" y="${py(total,axis)-5}" text-anchor="middle" fill="#002b5c" font-weight="700">${esc(totalFormat(total))}</text>`);}
    });
    data.series.forEach((s,j)=>{if(renderOf(s)!=='line')return;const c=color(s);let path='',open=false;s.values.forEach((v,i)=>{if(v===null||v===undefined){open=false;return;}const x=left+(right-left)*(i+.5)/data.categories.length,y=py(v,s.axis);path+=`${open?'L':'M'}${x} ${y} `;open=true;parts.push(`<circle cx="${x}" cy="${y}" r="3" fill="${c}"/>`);if(s.labels?.[i])parts.push(`<text x="${x}" y="${y-8}" text-anchor="middle" fill="${c}">${esc(s.labels[i])}</text>`);});parts.push(`<path d="${path}" fill="none" stroke="${c}" stroke-width="2.5"/>`);});
    if(data.legend) data.series.forEach((s,j)=>{const x=left+j*(right-left)/data.series.length;parts.push(`<rect x="${x}" y="${h-font}" width="${font}" height="${font*.5}" fill="${esc(color(s))}"/><text x="${x+font*1.3}" y="${h-font*.5}" fill="#334">${esc(s.name)}</text>`);});
    return parts.join('')+'</svg>';
}
