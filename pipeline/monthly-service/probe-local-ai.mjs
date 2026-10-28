// Run against the existing service. Read-only bridge probe; no business data fetch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectId = process.argv[2];
const output = process.argv[3];
if (!projectId || !output) throw new Error('Usage: node probe-local-ai.mjs PROJECT_ID OUTPUT.json');
const client = new Client({ name: 'monthly-local-ai-probe', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, 'mcp-bridge.mjs')],
  stderr: 'pipe',
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const response = await client.callTool({ name: 'get_project', arguments: { projectId, objectIds: ['connection-test-title'] } });
  if (response.isError) throw new Error(response.content[0].text);
  const project = JSON.parse(response.content[0].text);
  const objects = project.pages.flatMap(page => page.objects).filter(object => object.content);
  if (!objects.length) throw new Error('Probe object not found');
  const result = { checkedAt: new Date().toISOString(), transport: 'local stdio bridge -> HTTP MCP', endpoint: process.env.REPORT_SERVICE_URL || 'http://127.0.0.1:4320/mcp', toolCount: tools.tools.length, projectId: project.id, revision: project.revision, objects };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: true, toolCount: result.toolCount, projectId, revision: result.revision, output }));
} finally {
  await client.close();
}
