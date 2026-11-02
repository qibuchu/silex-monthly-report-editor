// Connects the HTML editing view to the native PPTX, which stays the source file.
// Objects are matched by the slide and shape numbers in their stable IDs.

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'col', 'source']);
const OPAQUE = new Set(['svg', 'style', 'script']);
const TOKEN = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|[^<]+|</g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = value => value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, code) => {
  if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? all;
  return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
});
const escapeText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attribute = (attrs, name) => {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? decode(match[1] ?? match[2] ?? '') : undefined;
};

// A tolerant walk of object HTML, so edited markup still yields its text.
export function scan(html, rootId) {
  const owners = new Map();
  const owner = id => {
    if (!owners.has(id)) owners.set(id, { id, paragraphs: [], cells: [], rows: [] });
    return owners.get(id);
  };
  const root = owner(rootId);
  const stack = [{ tag: '#root', owner: root }];
  let paragraph = null, cell = null, table = null, opaque = 0;
  const close = end => {
    if (paragraph?.implicit) paragraph.end = end;
    if (paragraph?.implicit) paragraph = null;
  };
  for (const match of html.matchAll(TOKEN)) {
    const [text, closing, opening, attrs = '', selfClosing] = match, start = match.index, end = start + text.length;
    if (text.startsWith('<!--')) continue;
    if (closing) {
      const name = closing.toLowerCase();
      if (OPAQUE.has(name) && opaque) opaque--;
      if (opaque) continue;
      if (name === 'p' && paragraph) { paragraph.end = end; paragraph = null; }
      if (name === 'div') close(start);
      if ((name === 'td' || name === 'th') && cell) { close(start); cell.end = end; cell = null; }
      if (name === 'tr' && table?.row) { table.row.end = end; table.row = null; }
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag !== name) continue;
        const [entry] = stack.splice(index);
        if (entry.declared) { entry.declared.innerEnd = start; entry.declared.outerEnd = end; }
        if (name === 'table') table = entry.outerTable;
        break;
      }
      continue;
    }
    if (opening) {
      const name = opening.toLowerCase();
      if (OPAQUE.has(name)) { if (!selfClosing) opaque++; if (name !== 'svg') continue; }
      if (opaque && name !== 'svg') continue;
      if (VOID.has(name) || selfClosing) {
        if (name === 'br' && paragraph) paragraph.tokens.push('\n');
        continue;
      }
      const entry = { tag: name, owner: stack.at(-1).owner };
      const id = attribute(attrs, 'data-object-id');
      if (id) {
        entry.owner = owner(id);
        entry.declared = entry.owner;
        Object.assign(entry.owner, { outerStart: start, innerStart: end, openTag: text });
      }
      stack.push(entry);
      if (name === 'p') {
        close(start);
        paragraph = { start, end, open: text, firstSpan: null, tokens: [], texts: [] };
        (cell || entry.owner).paragraphs.push(paragraph);
      } else if (name === 'span' && paragraph && !paragraph.firstSpan) {
        paragraph.firstSpan = text;
      } else if (name === 'div') {
        close(start);
      } else if (name === 'table') {
        entry.outerTable = table;
        table = { rowIndex: -1, occupied: new Map(), row: null };
      } else if (name === 'tr') {
        table ||= { rowIndex: -1, occupied: new Map(), row: null };
        table.rowIndex++;
        table.column = 0;
        const height = attribute(attrs, 'style')?.match(/(?:^|;)\s*height:\s*([\d.]+)px/)?.[1];
        table.row = { start, end, height: height ? Number(height) : 0 };
        entry.owner.rows.push(table.row);
      } else if ((name === 'td' || name === 'th') && table) {
        while (table.occupied.get(`${table.rowIndex}:${table.column}`)) table.column++;
        const colspan = Number(attribute(attrs, 'colspan')) || 1, rowspan = Number(attribute(attrs, 'rowspan')) || 1;
        for (let row = 0; row < rowspan; row++) for (let column = 0; column < colspan; column++) table.occupied.set(`${table.rowIndex + row}:${table.column + column}`, true);
        cell = { row: table.rowIndex, column: table.column, colspan, paragraphs: [], start, end };
        entry.owner.cells.push(cell);
        table.column += colspan;
      }
      continue;
    }
    if (opaque || text === '<') continue;
    if (!paragraph) {
      if (!text.trim()) continue;
      paragraph = { start, end, open: null, firstSpan: null, tokens: [], texts: [], implicit: true };
      (cell || stack.at(-1).owner).paragraphs.push(paragraph);
    }
    paragraph.tokens.push(decode(text));
    paragraph.texts.push({ start, end });
    paragraph.end = Math.max(paragraph.end, end);
  }
  return owners;
}

export const paragraphTokens = paragraph => {
  const tokens = paragraph.tokens.map(token => token.replace(/\u00a0/g, ' '));
  return tokens.join('').replace(/\n/g, '').trim() ? tokens : [];
};
const tokensOf = paragraphs => paragraphs.map(paragraphTokens);
const fingerprint = paragraphs => {
  const lines = paragraphs.map(tokens => tokens.join(''));
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines.join('\u0001');
};
const NATIVE = /slide-(\d+)-(shape|table)-(\d+)$/;

export function readDeck(deck) {
  const entries = new Map();
  for (const page of deck.pages) for (const object of page.objects) {
    const rootId = object.attributes?.['data-object-id'];
    if (!rootId) continue;
    for (const [id, owner] of scan(String(object.content ?? ''), rootId)) {
      const match = id.match(NATIVE);
      if (!match) continue;
      const base = { id, slide: Number(match[1]), number: Number(match[3]) };
      if (match[2] === 'shape') entries.set(id, { ...base, kind: 'text', paragraphs: tokensOf(owner.paragraphs) });
      else entries.set(id, { ...base, kind: 'table', rows: owner.rows.length, cells: new Map(owner.cells.map(cell => [`${cell.row}:${cell.column}`, { row: cell.row, column: cell.column, paragraphs: tokensOf(cell.paragraphs) }])) });
    }
  }
  return entries;
}

const objectsById = deck => new Map(deck.pages.flatMap(page => page.objects).map(object => [object.attributes?.['data-object-id'], object]).filter(([id]) => id));
const IMAGE_SOURCE = /<img\b[^>]*\bsrc="([^"]*)"/gi;
const imageSources = object => [object.attributes?.src || '', ...[...String(object.content ?? '').matchAll(IMAGE_SOURCE)].map(match => match[1])].join('\n');

// Lists writable text changes, plus every edit the PPTX cannot receive yet.
export function diffDecks(before, after) {
  const previous = readDeck(before), next = readDeck(after), changes = [], unsupported = new Map();
  const note = (id, reason) => { if (!unsupported.has(id)) unsupported.set(id, { id, reason }); };
  for (const [id, old] of previous) {
    const current = next.get(id);
    if (!current || current.kind !== old.kind) continue;
    if (old.kind === 'text') {
      if (fingerprint(old.paragraphs) !== fingerprint(current.paragraphs)) changes.push({ kind: 'text', id, slide: old.slide, shapeId: old.number, before: old.paragraphs, paragraphs: current.paragraphs });
      continue;
    }
    if (old.rows !== current.rows || old.cells.size !== current.cells.size) { note(id, '表格行列变化暂不写回 PPTX'); continue; }
    for (const [key, cell] of old.cells) {
      const updated = current.cells.get(key);
      if (!updated) { note(id, '表格结构变化暂不写回 PPTX'); continue; }
      if (fingerprint(cell.paragraphs) !== fingerprint(updated.paragraphs)) changes.push({ kind: 'cell', id, slide: old.slide, tableId: old.number, row: cell.row, column: cell.column, before: cell.paragraphs, paragraphs: updated.paragraphs });
    }
  }
  const oldObjects = objectsById(before), newObjects = objectsById(after);
  for (const id of oldObjects.keys()) if (!newObjects.has(id)) note(id, '删除对象暂不写回 PPTX');
  for (const id of newObjects.keys()) if (!oldObjects.has(id)) note(id, '新增对象暂不写回 PPTX');
  for (const [id, object] of newObjects) {
    const old = oldObjects.get(id);
    if (!old) continue;
    if (JSON.stringify(old.style ?? {}) !== JSON.stringify(object.style ?? {})) note(id, '位置或样式修改暂不写回 PPTX');
    if (imageSources(old) !== imageSources(object)) note(id, '图片替换暂不写回 PPTX');
  }
  return { changes, unsupported: [...unsupported.values()] };
}

const SLOT_STYLE = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;box-sizing:border-box;background:#f0f0f0;border:1px solid #c8cdd3;color:#8a96a5;font-size:14px';
const slot = label => `<div data-pptx-slot="1" style="${SLOT_STYLE}">${label}</div>`;

function rebuildParagraphs(found, target) {
  const lines = target.length ? target : [[]];
  const model = found[0] || {};
  const open = model.open || '<p style="margin:0;min-height:1em">';
  const span = model.firstSpan || '<span>';
  return lines.map((tokens, index) => {
    const source = found[Math.min(index, found.length - 1)] || model;
    const inner = tokens.map(token => (token === '\n' ? '<br>' : `${source.firstSpan || span}${escapeText(token)}</span>`)).join('');
    return `${source.open || open}${inner || `${source.firstSpan || span}</span>`}</p>`;
  }).join('');
}

function paragraphEdits(found, target, base = null) {
  const lines = target.length ? target : [[]];
  const current = found.map(paragraphTokens);
  if (fingerprint(current) === fingerprint(lines)) return [];
  const sameShape = found.length === lines.length && found.every((paragraph, index) => {
    const texts = lines[index].filter(token => token !== '\n');
    return paragraph.texts.length === texts.length && paragraph.texts.length > 0 && !paragraph.implicit && paragraph.tokens.filter(token => token === '\n').length === lines[index].filter(token => token === '\n').length;
  });
  if (sameShape) {
    return found.flatMap((paragraph, index) => {
      const texts = lines[index].filter(token => token !== '\n');
      return paragraph.texts.map((text, position) => ({ start: text.start, end: text.end, value: escapeText(texts[position]) }));
    });
  }
  if (!found.length) return base === null ? [] : [{ start: base, end: base, value: rebuildParagraphs(found, lines) }];
  return [{ start: found[0].start, end: found.at(-1).end, value: rebuildParagraphs(found, lines) }];
}

const applyEdits = (html, edits) => [...edits].sort((a, b) => b.start - a.start).reduce((value, edit) => value.slice(0, edit.start) + edit.value + value.slice(edit.end), html);

function syncChart(chart, native, render, width, height) {
  const updated = { ...chart, categories: native.categories };
  if (native.series.length === (chart.series || []).length) updated.series = chart.series.map((item, index) => ({ ...item, values: native.series[index].values }));
  // A preview failure must not stop the PPTX draft; never leave the old chart showing.
  try { return { chart: updated, svg: render(updated, width, height) }; }
  catch { return { chart: updated, svg: slot('图表预览失败，请以 PPTX 为准') }; }
}

// The chart data in the tag drives AI reads and editor redraws, so it must not keep old values.
const withChartAttribute = (tag, chart) => {
  const pattern = /\s*data-pptx-chart\s*=\s*(?:"[^"]*"|'[^']*')/;
  if (!chart) return tag.replace(pattern, '');
  const value = JSON.stringify(chart).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return tag.replace(pattern, () => ` data-pptx-chart="${value}"`);
};
// Older drafts turned slots into shapes; newer ones keep the picture with a placeholder image.
const isImageSlot = (native, number) => Boolean(native) && (number in native.shapes || (native.placeholders || []).includes(number));
const px = value => Number(String(value ?? '').match(/[\d.]+/)?.[0]) || 0;

const generatedImage = (src, name) => `<img src="${escapeText(src)}" alt="${escapeText(name || '数据生成图表')}" style="position: absolute; left: 0%; top: 0%; width: 100%; height: 100%; object-fit: fill;">`;

function syncObject(object, extraction, render, report, storeImage) {
  const rootId = object.attributes?.['data-object-id'];
  if (!rootId) return;
  const owners = scan(String(object.content ?? ''), rootId);
  const edits = [];
  for (const [id, owner] of owners) {
    const match = id.match(/slide-(\d+)-(shape|table|image|chart)-(\d+)$/);
    const native = match && extraction.slides[match[1]];
    if (!native) continue;
    const number = match[3], kind = match[2];
    if (kind === 'shape') {
      if (!(number in native.shapes)) { report.missing.push(id); continue; }
      edits.push(...paragraphEdits(owner.paragraphs, native.shapes[number], id === rootId ? 0 : owner.innerStart));
    } else if (kind === 'table') {
      const rows = native.tables[number];
      if (!rows) { report.missing.push(id); continue; }
      if (owner.rows.length < rows.length) report.missing.push(id);
      const trimmed = owner.rows.slice(rows.length);
      for (const row of trimmed) edits.push({ start: row.start, end: row.end, value: '' });
      for (const cell of owner.cells) {
        if (cell.row >= rows.length) continue;
        edits.push(...paragraphEdits(cell.paragraphs, rows[cell.row][cell.column] || []));
      }
      if (trimmed.length && id === rootId && object.style) object.style = { ...object.style, height: `${owner.rows.slice(0, rows.length).reduce((sum, row) => sum + row.height, 0)}px` };
    } else if (kind === 'chart' && id !== rootId && native.generated?.[number] && storeImage && owner.innerStart !== undefined) {
      edits.push({ start: owner.outerStart, end: owner.innerStart, value: withChartAttribute(owner.openTag, null) });
      edits.push({ start: owner.innerStart, end: owner.innerEnd, value: generatedImage(storeImage(native.generated[number])) });
    } else if (kind === 'chart' && id !== rootId && native.charts[number]?.placeholder && owner.innerStart !== undefined) {
      edits.push({ start: owner.outerStart, end: owner.innerStart, value: withChartAttribute(owner.openTag, null) });
      edits.push({ start: owner.innerStart, end: owner.innerEnd, value: slot('图表待补') });
    } else if (kind === 'chart' && id !== rootId && number in native.charts && owner.innerStart !== undefined) {
      const raw = attribute(owner.openTag, 'data-pptx-chart');
      const style = attribute(owner.openTag, 'style') || '';
      if (!raw) continue;
      const { chart, svg } = syncChart(JSON.parse(raw), native.charts[number], render, px(style.match(/width:\s*([\d.]+)px/)?.[1]), px(style.match(/height:\s*([\d.]+)px/)?.[1]));
      edits.push({ start: owner.outerStart, end: owner.innerStart, value: withChartAttribute(owner.openTag, chart) });
      edits.push({ start: owner.innerStart, end: owner.innerEnd, value: svg });
    } else if (kind === 'chart' && id !== rootId && number in native.shapes && owner.innerStart !== undefined) {
      edits.push({ start: owner.outerStart, end: owner.innerStart, value: withChartAttribute(owner.openTag, null) });
      edits.push({ start: owner.innerStart, end: owner.innerEnd, value: slot('图表待补') });
    }
  }
  let content = applyEdits(String(object.content ?? ''), edits);
  content = content.replace(/<img\b[^>]*>/gi, tag => {
    const id = attribute(tag, 'data-object-id')?.match(/slide-(\d+)-image-(\d+)$/);
    if (!id || id[0] === rootId.match(/slide-\d+-image-\d+$/)?.[0]) return tag;
    const native = extraction.slides[id[1]];
    const drawn = native?.generated?.[id[2]];
    if (drawn && storeImage) return tag.replace(/\ssrc\s*=\s*("[^"]*"|'[^']*')/i, ` src="${escapeText(storeImage(drawn))}"`);
    if (!isImageSlot(native, id[2])) return tag;
    const style = attribute(tag, 'style') || '';
    return `<div data-object-id="${attribute(tag, 'data-object-id')}" style="${escapeText(style)}">${slot('图片待补')}</div>`;
  });
  object.content = content;
  // Charts the browser reader cannot draw arrive as 'unsupported' placeholders with the same object id.
  const top = rootId.match(/slide-(\d+)-(image|chart|unsupported)-(\d+)$/);
  const native = top && extraction.slides[top[1]];
  if (!native) return;
  if (native.generated?.[top[3]] && storeImage && ['image', 'chart', 'unsupported'].includes(top[2])) {
    delete object.attributes['data-pptx-chart'];
    // A chart the generator drew from data: the web view shows the same SVG as the PPTX.
    object.content = generatedImage(storeImage(native.generated[top[3]]), object.attributes['data-name']);
  } else if (top[2] === 'image' && isImageSlot(native, top[3])) {
    object.content = slot('图片待补');
    delete object.attributes.src;
    delete object.attributes.alt;
  } else if (top[2] === 'chart' && native.charts[top[3]]?.placeholder) {
    object.content = slot('图表待补');
    delete object.attributes['data-pptx-chart'];
  } else if (top[2] === 'chart' && top[3] in native.charts && object.attributes['data-pptx-chart']) {
    const { chart, svg } = syncChart(JSON.parse(object.attributes['data-pptx-chart']), native.charts[top[3]], render, px(object.style?.width), px(object.style?.height));
    object.attributes['data-pptx-chart'] = JSON.stringify(chart);
    object.content = svg;
  } else if (top[2] === 'chart' && top[3] in native.shapes) {
    object.content = slot('图表待补');
    delete object.attributes['data-pptx-chart'];
  }
}

const slideOf = page => Number(page.objects.map(object => object.attributes?.['data-object-id']?.match(/slide-(\d+)-/)?.[1]).find(Boolean));

// Builds the editing view for a generated PPTX from the template's published deck.
export function buildNativeDeck(templateProject, extraction, continuations, render, storeImage, removed = []) {
  const project = structuredClone(templateProject);
  delete project.silexState;
  project.current = 0;
  const pages = new Map(project.deck.pages.map(page => [slideOf(page), page]));
  const report = { missing: [] };
  for (const { sourceSlide, newSlide } of continuations) {
    const source = pages.get(sourceSlide);
    if (!source) continue;
    const copy = JSON.parse(JSON.stringify(source).split(`-slide-${sourceSlide}-`).join(`-slide-${newSlide}-`));
    copy.name = `${source.name} · 续页`;
    pages.set(newSlide, copy);
  }
  project.deck.pages = extraction.order.map(slide => pages.get(slide)).filter(Boolean);
  // Objects the mapping deleted from the PPTX leave the editing view too.
  const gone = new Set(removed.map(item => `slide-${item.slide}-${item.objectId}`));
  for (const page of project.deck.pages) page.objects = page.objects.filter(object => {
    const match = object.attributes?.['data-object-id']?.match(/slide-(\d+)-(?:shape|image|chart|table)-(\d+)$/);
    return !match || !gone.has(`slide-${match[1]}-${match[2]}`);
  });
  project.deck.pages.forEach((page, index) => { page.index = index; });
  for (const page of project.deck.pages) for (const object of page.objects) syncObject(object, extraction, render, report, storeImage);
  return { project, missing: [...new Set(report.missing)] };
}
