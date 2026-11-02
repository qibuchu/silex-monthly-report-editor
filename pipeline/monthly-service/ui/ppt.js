'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sourceNames = { 'minigame-monthly': '小游戏月报接口', steamauto: 'SteamAuto 月报数据' };
const state = { templates: [], busy: false, mobileSourceIds: new Set() };

async function call(name, args = {}) {
  const response = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) });
  const value = await response.json().catch(() => ({}));
  if (response.status === 401) throw Error('需要先在网页版工作台登录');
  if (!response.ok) throw Error(value.error || `请求失败 ${response.status}`);
  return value.result ?? value;
}
const time = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
function show(id, html, error = false) { const box = $(id); box.innerHTML = error ? `<span class="error">${esc(html)}</span>` : html; box.classList.add('show'); }

function lastFinishedMonth() {
  const now = new Date(); now.setDate(1); now.setMonth(now.getMonth() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function templateCard(t) {
  const status = t.ready ? `<span class="tag ok">已发布 v${t.revision}</span>${t.draftChanged ? '<span class="tag warn">有未发布的修改</span>' : ''}` : '<span class="tag gray">未发布</span>';
  const rules = t.mappingConfigured
    ? (t.mappingCheck && !t.mappingCheck.ok ? `<span class="tag bad">填数规则与 PPT 对不上</span>` : `<span class="tag ok">填数规则 ${t.mappingOperations} 项</span>`)
    : '<span class="tag bad">没有填数规则</span>';
  const notes = Object.entries(t.pageNotes || {}).map(([page, note]) => `<li>第 ${esc(page)} 页：${esc(note)}</li>`).join('');
  const problems = (t.mappingCheck?.problems || []).slice(0, 5).map(p => `<li>${esc(p.reason)}${p.object ? `（第 ${esc(p.slide)} 页对象 ${esc(p.object)}）` : ''}</li>`).join('');
  return `<div class="card"><h3>${esc(t.title)}</h3>
    <div>${status}${rules}</div>
    <div class="meta">数据源：${esc(sourceNames[t.dataSourceId] || t.dataSourceId)}${t.mappingSourceMonth ? ` · 原稿月份 ${esc(t.mappingSourceMonth)}` : ''} · 上传于 ${esc(time(t.createdAt))}${t.publishedAt ? ` · 发布于 ${esc(time(t.publishedAt))}` : ''}</div>
    ${problems ? `<ul class="notes error">${problems}</ul>` : ''}
    ${notes ? `<details><summary>各页说明</summary><ul class="notes">${notes}</ul></details>` : ''}
    <div class="actions">
      <a class="button small" href="${esc(t.source)}">下载原稿（在 PowerPoint 中核对）</a>
      ${t.mappingConfigured && (!t.ready || t.draftChanged) ? `<button class="small primary" data-publish="${esc(t.id)}" data-revision="${t.revision}">发布</button>` : ''}
      <button class="small" data-delete="${esc(t.id)}" data-revision="${t.revision}">删除</button>
    </div></div>`;
}

async function loadTemplates() {
  const sources = await call('list_data_sources');
  state.mobileSourceIds = new Set(sources.filter(s => s.kind === 'api' && String(s.reference || '').includes('/mobile-monthly')).map(s => s.id));
  $('upSource').querySelectorAll('option[data-mobile]').forEach(option => option.remove());
  for (const source of sources.filter(s => state.mobileSourceIds.has(s.id))) {
    const option = new Option(source.name, source.id); option.dataset.mobile = '1'; $('upSource').add(option);
    sourceNames[source.id] = source.name;
  }
  state.templates = await call('list_ppt_templates');
  $('templates').innerHTML = state.templates.map(templateCard).join('') || '<div class="empty">还没有 PPT 模板，请在下方上传。</div>';
  const ready = state.templates.filter(t => t.ready);
  const selected = $('genTemplate').value;
  $('genTemplate').innerHTML = ready.map(t => `<option value="${esc(t.id)}">${esc(t.title)}（v${t.revision}）</option>`).join('') || '<option value="">没有已发布的模板</option>';
  const requested = new URLSearchParams(location.search).get('template');
  if (ready.some(t => t.id === requested)) $('genTemplate').value = requested;
  else if (ready.some(t => t.id === selected)) $('genTemplate').value = selected;
  refreshInputs();
}

function refreshInputs() {
  const t = state.templates.find(item => item.id === $('genTemplate').value);
  const manual = Boolean(t) && t.dataSourceId !== 'minigame-monthly' && !state.mobileSourceIds.has(t.dataSourceId);
  $('dataLabel').hidden = !manual; $('auditLabel').hidden = !manual;
  $('generate').disabled = !t || state.busy;
}

function draftRow(d) {
  const statusTag = d.status === 'succeeded' ? '<span class="tag ok">完成</span>' : d.status === 'running' ? '<span class="tag warn">生成中</span>' : '<span class="tag bad">失败</span>';
  const summary = d.status === 'succeeded'
    ? `${d.pages} 页 · 待人工补 ${d.manualSlots} 处 · 数据提示 ${d.sourceIssues} 条${d.mappingIssues ? ` · 规则提示 ${d.mappingIssues} 条` : ''}${d.oldMonthText ? ` · <span class="error">疑似旧月份文字 ${d.oldMonthText} 处</span>` : ''}`
    : d.status === 'failed' ? `<span class="error">${esc(String(d.error || '').trim().split('\n').pop().slice(0, 300))}</span>` : '';
  const fetched = d.dataFetched?.current ? `接口取数${d.dataFetched.previous ? '（含上月）' : d.dataFetched.previousError ? '（上月未取到，环比留空）' : ''}` : '上传数据';
  const links = d.status === 'succeeded' ? `<a href="${esc(d.pptx)}">下载 PPTX</a> · <a href="${esc(d.issues)}">问题清单</a>` : '';
  return `<tr><td>${esc(d.month)}</td><td>${esc(d.template?.title)} v${esc(d.template?.revision)}</td><td>${statusTag}</td><td>${summary}<div class="meta">${esc(fetched)} · ${esc(time(d.startedAt))}</div></td><td>${links}</td></tr>`;
}

async function loadDrafts() {
  const drafts = await call('list_ppt_drafts');
  $('drafts').innerHTML = drafts.length
    ? `<table><thead><tr><th>月份</th><th>模板</th><th>状态</th><th>结果</th><th></th></tr></thead><tbody>${drafts.map(draftRow).join('')}</tbody></table>`
    : '<div class="empty">还没有生成过 PPT。</div>';
}

async function readJson(input, label) {
  const file = input.files[0];
  if (!file) return undefined;
  try { return JSON.parse(await file.text()); } catch { throw Error(`${label}不是有效的 JSON`); }
}

async function generate() {
  if (state.busy) return;
  const templateId = $('genTemplate').value, month = $('genMonth').value;
  const t = state.templates.find(item => item.id === templateId);
  if (!t || !month) return show('genStatus', '请选择模板和月份', true);
  state.busy = true; refreshInputs();
  try {
    const args = { templateId, month };
    if (t.dataSourceId !== 'minigame-monthly' && !state.mobileSourceIds.has(t.dataSourceId)) {
      args.data = await readJson($('genData'), '当月数据包');
      args.audit = await readJson($('genAudit'), '时间窗口审计');
      if (!args.data || !args.audit) throw Error('Steam 模板需要上传当月数据包和时间窗口审计');
    }
    show('genStatus', t.dataSourceId === 'minigame-monthly' ? '正在从小游戏接口取数并生成…' : state.mobileSourceIds.has(t.dataSourceId) ? '正在从手游接口取国区及海外月榜并生成…' : '正在生成…');
    let task = await call('generate_ppt', args);
    while (task.status === 'running') { await new Promise(r => setTimeout(r, 1500)); task = await call('get_task', { taskId: task.id }); }
    if (task.status !== 'succeeded') throw Error(String(task.error || '生成失败').trim().split('\n').pop());
    show('genStatus', `<b>${esc(task.month)} PPT 已生成</b>：${task.pages} 页，待人工补 ${task.manualSlots} 处，数据提示 ${task.sourceIssues} 条${task.oldMonthText ? `，<span class="error">疑似旧月份文字 ${task.oldMonthText} 处</span>` : ''}。<div class="actions"><a class="button primary" href="${esc(task.pptx)}">下载 PPTX</a><a class="button" href="${esc(task.issues)}">问题清单</a></div>`);
  } catch (error) {
    show('genStatus', error.message, true);
  } finally {
    state.busy = false; refreshInputs(); loadDrafts().catch(() => {});
  }
}

async function upload() {
  const file = $('upFile').files[0], title = $('upTitle').value.trim();
  if (!file || !title) return show('upStatus', '请选择 PPTX 文件并填写模板名称', true);
  if (!/\.pptx$/i.test(file.name) || file.size > 100 * 1024 * 1024) return show('upStatus', '请选择 100MB 以内的 .pptx 文件', true);
  $('upload').disabled = true; show('upStatus', '正在上传…');
  try {
    const response = await fetch('/api/ppt-templates', { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'X-Template-Title': encodeURIComponent(title), 'X-Data-Source': $('upSource').value }, body: file });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(value.error || `上传失败 ${response.status}`);
    show('upStatus', value.mappingConfigured
      ? `已上传，并自动带上填数规则（${value.mappingOperations} 项）。请下载原稿核对后发布。`
      : '已上传。这份 PPT 还没有登记填数规则，暂时不能发布生成；需要先为它配置规则。');
    $('upFile').value = ''; $('upTitle').value = '';
    await loadTemplates();
  } catch (error) { show('upStatus', error.message, true); }
  finally { $('upload').disabled = false; }
}

document.addEventListener('click', async event => {
  const publish = event.target.closest('[data-publish]'), remove = event.target.closest('[data-delete]');
  try {
    if (publish) {
      if (!confirm('发布后，生成 PPT 将使用这份原稿和填数规则。\n请确认已下载原稿并在 PowerPoint 中核对过。')) return;
      await call('publish_ppt_template', { templateId: publish.dataset.publish, baseRevision: Number(publish.dataset.revision) });
      await loadTemplates();
    } else if (remove) {
      if (!confirm('从模板列表中移除这个 PPT 模板？已生成的 PPT 不受影响。')) return;
      await call('delete_ppt_template', { templateId: remove.dataset.delete, baseRevision: Number(remove.dataset.revision) });
      await loadTemplates();
    }
  } catch (error) { alert(error.message); }
});
$('genTemplate').onchange = refreshInputs;
$('generate').onclick = () => { void generate(); };
$('upload').onclick = () => { void upload(); };
$('genMonth').value = lastFinishedMonth();
Promise.all([loadTemplates(), loadDrafts()]).catch(error => show('genStatus', error.message, true));
