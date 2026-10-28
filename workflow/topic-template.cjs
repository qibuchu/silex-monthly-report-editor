const slots = require('./topic-slots.json');
function clearText(content) {
  return content.replace(/>([^<]+)</g, (all, text) => /^\s*$/.test(text) ? all : '><');
}
function applyTopicTemplate(deck, {newDraft = false, monthLabel = ''} = {}) {
  const objects = deck.pages.flatMap(page => page.objects);
  const find = id => objects.find(o => o.attributes?.['data-object-id'] === id);
  const blank = (id, role) => {
    const o = find(id); if (!o) return;
    o.attributes['data-template-slot'] = role;
    o.attributes['data-content-layer'] = role === 'data' ? '1' : '3';
    if (o.attributes['data-kind'] === 'text' || o.attributes['data-kind'] === 'table') o.content = clearText(o.content);
    else o.content = '<div class="topic-empty-slot" style="position:absolute;inset:0;width:100%;height:100%"></div>';
  };
  slots.blankText.forEach(id => blank(id, 'manual-text'));
  slots.blankImages.forEach(id => blank(id, 'manual-image'));
  slots.blankCharts.forEach(id => blank(id, 'manual-chart'));
  slots.blankTables.forEach(id => blank(id, 'manual-table'));
  if (newDraft) {
    slots.dataSlots.forEach(id => blank(id, 'data'));
    for (const [id, title] of Object.entries(slots.caseTitles)) {
      const o = find(id); if (!o) continue;
      let filled = false;
      o.content = clearText(o.content).replace(/(<span\b[^>]*>)/, m => {filled = true; return m + monthLabel + title;});
      if (!filled) o.content = `<div class="text"><div class="rich">${monthLabel}${title}</div></div>`;
    }
    const title = find('s6o5');
    if (title) title.content = title.content.replace(/\d+月热门新游/g, `${monthLabel}热门新游`);
  }
  return deck;
}
module.exports = {applyTopicTemplate};
