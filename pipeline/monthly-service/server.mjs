import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createCore, tools, render } from './core.mjs';
import {acquireStoreLock,backupStore} from './maintenance.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));

export function createService(config) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host) && !config.token) throw Error('非本机监听必须设置 REPORT_SERVICE_TOKEN');
  const release=acquireStoreLock(config.dataDir);
  const editorTarget=()=>{
    const target=new URL(config.silexUrl || 'http://localhost:6805/'),service=new URL(config.publicUrl);
    if(config.token&&['localhost','127.0.0.1'].includes(target.hostname)&&['localhost','127.0.0.1'].includes(service.hostname))target.hostname=service.hostname;
    return target;
  };
  let core;try{core=createCore(config);}catch(error){release();throw error;}
  const dispatch=async(name,input,target)=>{
    const args={...(input||{})};
    if(target&&name==='get_editing_context'){if(args.editingTargetId&&args.editingTargetId!==target)throw Object.assign(Error('AI连接标识与工具参数不一致'),{status:409});args.editingTargetId=target;}
    if(target&&['get_template_ai_target','get_visual_rule_context','apply_visual_rule_patch','apply_visual_template_patch'].includes(name)){if(args.editingTargetId&&args.editingTargetId!==target)throw Object.assign(Error('AI连接标识与工具参数不一致'),{status:409});args.editingTargetId=target;}
    if(target&&['apply_object_patch','apply_structure_patch','restore_project_version','propose_object_patch'].includes(name)){
      const selected=await core.call('get_editing_target',{editingTargetId:target});
      if(!selected.projectId||selected.projectId!==args.projectId)throw Object.assign(Error('AI目标已切换，请重新读取get_editing_context后修改'),{status:409});
    }
    return core.call(name,args);
  };
  const json = (res, status, data) => {
    const payload = Buffer.from(JSON.stringify(data));
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    const acceptsGzip = String(res.req.headers['accept-encoding'] || '').split(',').some(value => /^\s*gzip\s*(?:;\s*q=(?!0(?:\.0*)?\s*$)[\d.]+)?\s*$/i.test(value));
    if (payload.length < 65536 || !acceptsGzip) { res.writeHead(status, headers); return res.end(payload); }
    const vary = String(res.getHeader('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
    res.setHeader('Vary', [...new Set([...vary, 'Accept-Encoding'])].join(', '));
    gzip(payload, (error, compressed) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { ...headers, ...(error ? {} : { 'Content-Encoding': 'gzip' }), 'Content-Length': error ? payload.length : compressed.length });
      res.end(error ? payload : compressed);
    });
  };
  const cookieToken = config.token ? createHash('sha256').update(config.token).digest('hex') : null;
  const recycledNotice = res => {
    res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>草稿已移入回收站</title><style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f7f5f1;color:#133e66;max-width:680px;margin:15vh auto;padding:28px}a{color:#1a6daa}</style><h1>这份草稿已移入回收站</h1><p>内容和历史版本仍保留。请到月报工作台的回收站恢复后再预览或编辑。</p><a href="/#recycle">打开回收站 →</a></html>');
  };
  const body = async req => { let size = 0; const chunks = []; for await (const c of req) { size += c.length; if (size > 180 * 1024 * 1024) throw Object.assign(Error('项目请求超过180MB，请保留页面并检查重复的内嵌字体或素材。'), {status:413}); chunks.push(c); } return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, config.publicUrl);
      if(req.method==='GET'&&['/ui/dashboard.css','/ui/dashboard.js','/ui/template-data.js','/ui/source-library.js','/ui/pptx-reader.js','/ui/monthly-data-reader.js','/ui/visual-rules.css','/ui/visual-rules.js'].includes(url.pathname)){
        res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        return res.end(fs.readFileSync(path.join(here,'ui',path.basename(url.pathname))));
      }
      const origins = [new URL(config.publicUrl).origin, new URL(config.silexUrl || 'http://localhost:6805/').origin,editorTarget().origin, ...(config.allowedOrigins || [])];
      if (req.headers.origin && !origins.includes(req.headers.origin)) return json(res, 403, { error: 'Invalid origin' });
      if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.writeHead(204); return res.end(); }
      if (url.pathname === '/api/login' && req.method === 'POST') {
        if (!config.token || (await body(req)).token !== config.token) return json(res, 401, { error: 'Invalid token' });
        res.setHeader('Set-Cookie', `monthly_session=${cookieToken}; HttpOnly; SameSite=Strict; Path=/${config.publicUrl.startsWith('https:') ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }
      const authenticated = !config.token || req.headers.authorization === `Bearer ${config.token}` || String(req.headers.cookie || '').split(';').some(c => c.trim() === `monthly_session=${cookieToken}`);
      if (!authenticated && url.pathname !== '/') return json(res, 401, { error: 'Authentication required' });
      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Stateless MCP supports POST' });
        const mcp = new Server({ name: 'steam-monthly-service', version: '0.2.0' }, { capabilities: { tools: {} } });
        mcp.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
        mcp.setRequestHandler(CallToolRequestSchema, async request => {
          try { return { content: [{ type: 'text', text: JSON.stringify(await dispatch(request.params.name,request.params.arguments,url.searchParams.get('editingTargetId')),null,2) }] }; }
          catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error.message, status: error.status || 400 }) }] }; }
        });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => { transport.close(); mcp.close(); });
        await mcp.connect(transport); await transport.handleRequest(req, res, await body(req)); return;
      }
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(here, 'dashboard.html')));
      }
      if(url.pathname==='/visual-rules'&&req.method==='GET'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(fs.readFileSync(path.join(here,'visual-rules.html')));
      }
      const canvas=url.pathname.match(/^\/api\/templates\/([a-f0-9-]+)\/canvas$/);
      if(canvas&&req.method==='GET'){
        const t=core.db.templates[canvas[1]];if(!t?.projectId)throw Object.assign(Error('模板不存在'),{status:404});
        const original=core.project(t.projectId).project,index=Number(url.searchParams.get('pageIndex')||0);if(!Number.isInteger(index)||!original.deck.pages[index])throw Object.assign(Error('页面不存在'),{status:404});
        const html=render({...original,deck:{...original.deck,pages:[original.deck.pages[index]]}}).replace('</style>','.report-page{zoom:1!important;margin:0!important}</style>');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:; font-src data:",'X-Content-Type-Options':'nosniff'});return res.end(html);
      }
      if (url.pathname === '/api/tools' && req.method === 'GET') return json(res, 200, { tools });
      if (url.pathname === '/api/health' && req.method === 'GET') {
        let editorAvailable = false;
        try { editorAvailable = (await fetch(config.editorHealthUrl || config.silexUrl || 'http://localhost:6805/', { signal: AbortSignal.timeout(1500) })).ok; } catch {}
        return json(res, 200, { service: 'ok', application:'steam-monthly-service',version:'0.2.0',tools:tools.length,editorAvailable, onlineGenerationConfigured: Boolean(config.generationConfig), templateAiServerConfigured:Boolean(config.templateAi?.key&&config.templateAi?.model&&config.templateAi?.url),demoMonth: '2026-08' });
      }
      if(url.pathname==='/api/backup'&&req.method==='POST')return json(res,200,runBackup());
      if (url.pathname === '/api/demo' && req.method === 'POST') {
        const input=await body(req);
        const data = JSON.parse(fs.readFileSync(path.join(here, 'demo/monthly-report-2026-08.json'), 'utf8'));
        return json(res, 200, await core.call('generate_monthly_report', { month: '2026-08', data, ...(input.templateId?{templateId:input.templateId}:{profile:'finished-eight'}) }));
      }
      if (url.pathname === '/api/import' && req.method === 'POST') return json(res, 200, core.importProject(await body(req)));
      if (url.pathname === '/api/templates/import-pptx' && req.method === 'POST') return json(res, 200, core.importPptxTemplate(await body(req)));
      const asset = url.pathname.match(/^\/api\/projects\/([a-f0-9-]+)\/assets(?:\/([^/]+))?$/);
      if(asset){
        if(!asset[2] && req.method==='POST')return json(res,200,core.putAsset(asset[1],await body(req)));
        if(asset[2] && req.method==='GET'){
          const value=core.getAsset(asset[1],asset[2]);
          res.writeHead(200,{'Content-Type':value.mime,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':'private, max-age=31536000, immutable'});return res.end(value.bytes);
        }
      }
      if (url.pathname === '/api/call' && req.method === 'POST') { const input = await body(req); return json(res, 200, await dispatch(input.name,input.arguments,input.editingTargetId)); }
      const match = url.pathname.match(/^\/api\/projects\/([a-f0-9-]+)(?:\/(status|proposals|export\.html|export\.json|deck\.js|silex|ai-requests|editor-context))?$/);
      if (match) {
        const [, id, action] = match; const value = core.project(id);
        if (!action && req.method === 'GET') return json(res, 200, value);
        if (!action && req.method === 'PUT') { const input = await body(req); return json(res, 200, { revision: core.save(id, input.baseRevision, input.project, input.author).revision }); }
        if (action === 'status') return json(res, 200, { revision: value.revision, author: value.author, updatedAt: value.updatedAt, title: value.title, month: value.month });
        if (action === 'editor-context' && req.method === 'POST') return json(res,200,core.updateEditorContext(id,await body(req)));
        if (action === 'silex' && req.method === 'GET') return json(res, 200, core.silex(id));
        if (action === 'ai-requests' && req.method === 'POST') return json(res, 200, core.submitRequest(id, await body(req)));
        if (action === 'ai-requests' && req.method === 'GET') return json(res, 200, await core.call('list_ai_requests', { projectId: id, status: 'all' }));
        if (action === 'proposals') return json(res, 200, Object.values(core.db.proposals).filter(p => p.projectId === id));
        if (action === 'export.json') { res.setHeader('Content-Disposition', `attachment; filename="monthly-${value.month}-v${value.revision}.json"`); return json(res, 200, core.archive(id)); }
        if (action === 'export.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="monthly-${value.month}-v${value.revision}.html"` }); return res.end(core.preview(id,undefined,true)); }
        if (action === 'deck.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); return res.end('const DECK = ' + JSON.stringify(value.project.deck) + ';'); }
      }
      const preview = url.pathname.match(/^\/preview\/([a-f0-9-]+)$/);
      if (preview) { if(core.db.deletedProjects[preview[1]])return recycledNotice(res);res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:; font-src data:" }); return res.end(core.preview(preview[1], url.searchParams.get('proposal'))); }
      if (url.pathname === '/editor') {
        const id = url.searchParams.get('project'); if(core.db.deletedProjects[id])return recycledNotice(res);core.project(id);
        const target = editorTarget();
        for (const [key, value] of Object.entries({ id, connectorId: 'fs-storage', lang: 'zh', ui: 'native', serviceProject: id, serviceUrl: config.publicUrl })) target.searchParams.set(key, value);
        res.writeHead(302, { Location: target.toString() }); return res.end();
      }
      if (url.pathname === '/legacy-editor') {
        const id = url.searchParams.get('project'); core.project(id);
        const html = fs.readFileSync(path.join(config.workspaceRoot, 'outputs/monthly-editor/index.html'), 'utf8').replace('src="deck.js"', `src="/api/projects/${id}/deck.js"`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
      }
      if (req.method === 'GET' && ['/outputs/monthly-editor/', '/outputs/editor-tests/vendor/'].some(prefix => url.pathname.startsWith(prefix))) {
        const file = path.resolve(config.workspaceRoot, '.' + decodeURIComponent(url.pathname));
        const prefix = ['/outputs/monthly-editor/', '/outputs/editor-tests/vendor/'].find(value => url.pathname.startsWith(value));
        const allowed = path.resolve(config.workspaceRoot, '.' + prefix);
        if (!file.startsWith(allowed + path.sep)) return json(res, 403, { error: 'Invalid path' });
        const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); return res.end(fs.readFileSync(file));
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) { if (!res.headersSent) json(res, error.status || 400, { error: error.message }); else res.end(); }
  });
  function runBackup(){return backupStore(config.dataDir,config.backupDir||path.resolve(config.dataDir,'../backups'));}
  const backupHours=config.backupIntervalHours??24;
  if(!Number.isFinite(backupHours)||backupHours<0||backupHours>500){release();throw Error('backupIntervalHours须为0到500，0表示关闭定时备份');}
  const backupTimer=backupHours?setInterval(()=>{try{const result=runBackup();console.log('Monthly backup completed',result.directory);}catch(error){console.error('月报定时备份失败：',error.message);}},backupHours*3600000):undefined;
  backupTimer?.unref();
  server.once('close',()=>{clearInterval(backupTimer);release();});
  server.once('error',()=>{if(!server.listening)release();});
  return { server, core };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.resolve(process.env.REPORT_SERVICE_CONFIG || path.join(here, 'config.json'));
  const input = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  const base = path.dirname(file); const resolve = value => path.resolve(base, value);
  const port = input.port || 4320;
  const config = { host: '127.0.0.1', port, publicUrl: `http://127.0.0.1:${port}`, ...input, token: process.env.REPORT_SERVICE_TOKEN, dataDir: resolve(input.dataDir || './data'), toolkitDir: resolve(input.toolkitDir || '../../releases/monthly-toolkit-portable'), workspaceRoot: resolve(input.workspaceRoot || '../..'), backupDir:input.backupDir?resolve(input.backupDir):undefined,generationConfig: input.generationConfig ? resolve(input.generationConfig) : undefined };
  const service=createService(config);
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
    service.server.close(()=>process.exit(0));
    setTimeout(()=>process.exit(1),8000).unref();
  });
  service.server.listen(port, config.host, () => console.log(`Monthly service: ${config.publicUrl}; MCP: ${config.publicUrl}/mcp`));
}
