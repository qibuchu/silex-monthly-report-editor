import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const endpoint = process.env.REPORT_SERVICE_URL || 'http://127.0.0.1:4320/mcp';
const remote = new Client({ name: 'monthly-local-bridge', version: '0.1.0' });
await remote.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: process.env.REPORT_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.REPORT_SERVICE_TOKEN}` } : {} } }));
const local = new Server({ name: 'monthly-local-bridge', version: '0.1.0' }, { capabilities: { tools: {} } });
local.setRequestHandler(ListToolsRequestSchema, async () => {
  const result = await remote.listTools();
  return { tools: result.tools.map(tool => tool.name === 'generate_monthly_report' ? { ...tool, description: tool.description + '。本地连接器额外支持 dataFile：上传本地 skill 生成的 JSON 文件，不需在对话中展开数据。', inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, dataFile: { type: 'string', description: '本地 monthly-report JSON 文件的绝对路径' } } } } : tool) };
});
local.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const args = { ...request.params.arguments };
    if (request.params.name === 'generate_monthly_report' && args.dataFile) {
      if (args.data) throw Error('Use dataFile or data, not both');
      const file = args.dataFile;
      if (typeof file !== 'string' || !file.toLowerCase().endsWith('.json')) throw Error('Expected local JSON data file');
      if (fs.statSync(file).size > 70 * 1024 * 1024) throw Error('Data file too large');
      args.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (args.data.schema_version !== '2.0' || args.data.report_month !== args.month) throw Error('Local data schema/month mismatch');
      delete args.dataFile;
    }
    return await remote.callTool({ name: request.params.name, arguments: args });
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
await local.connect(new StdioServerTransport());
process.on('SIGINT', async () => { await remote.close(); await local.close(); process.exit(0); });
