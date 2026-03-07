import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (res) => {
  const t = res?.content?.[0]?.text;
  try { return t ? JSON.parse(t) : null; } catch { return { raw: t }; }
};

async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  return { ok: !res.isError, payload: parse(res), raw: res };
}

const transport = new StdioClientTransport({
  command: 'npm',
  args: ['run', 'dev:figjam'],
  cwd: '/Users/dante/work/repositories/figma-console-mcp',
  env: { ...process.env, FIGMA_WS_PORT: '9323' },
});

const client = new Client({ name: 'layout-validator', version: '1.0.0' }, { capabilities: {} });

(async () => {
  await client.connect(transport);
  const out = [];
  try {
    let connected = false;
    for (let i = 0; i < 30; i += 1) {
      const s = await call(client, 'figjam_get_status', {});
      out.push({ step: `status_${i+1}`, ok: s.ok, payload: s.payload });
      if (s.ok && s.payload?.connected === true && (s.payload?.websocket?.connectedFiles || 0) > 0) {
        connected = true;
        break;
      }
      await sleep(1200);
    }
    if (!connected) {
      out.push({ step: 'abort', reason: 'bridge_not_connected' });
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    const runId = `layout-validate-${Date.now()}`;
    const origin = { x: 16000, y: 260 };
    const refs = [
      { label: 'Mobbin', url: 'https://mobbin.com', theme: 'UI Inspirations', kind: 'article', tags: ['ui'] },
      { label: 'Land-book', url: 'https://land-book.com', theme: 'UI Inspirations', kind: 'article', tags: ['web'] },
      { label: 'MCP Official', url: 'https://modelcontextprotocol.io', theme: 'MCP / AI Agents', kind: 'article', tags: ['mcp'] },
      { label: 'Anthropic MCP Docs', url: 'https://docs.anthropic.com/en/docs/mcp', theme: 'MCP / AI Agents', kind: 'article', tags: ['docs'] },
      { label: 'r/UXDesign', url: 'https://www.reddit.com/r/UXDesign/', theme: 'Reddit / Forums', kind: 'other', tags: ['forum'] },
      { label: 'HN Show', url: 'https://news.ycombinator.com/show', theme: 'Reddit / Forums', kind: 'other', tags: ['forum'] },
      { label: 'Material Design 3', url: 'https://m3.material.io', theme: 'Design Systems', kind: 'article', tags: ['ds'] },
      { label: 'Shopify Polaris', url: 'https://polaris.shopify.com', theme: 'Design Systems', kind: 'article', tags: ['ds'] },
      { label: 'NN/g Methods', url: 'https://www.nngroup.com/articles/which-ux-research-methods/', theme: 'Product Research Methods', kind: 'report', tags: ['research'] },
      { label: 'JTBD Intro', url: 'https://www.intercom.com/blog/jobs-to-be-done/', theme: 'Product Research Methods', kind: 'article', tags: ['jtbd'] },
    ];

    const gen = await call(client, 'generateResearchBoard', {
      title: 'Layout Validation v2',
      runId,
      origin,
      notes: [],
      references: refs,
      themes: [
        { name: 'UI Inspirations', noteQueries: [] },
        { name: 'MCP / AI Agents', noteQueries: [] },
        { name: 'Reddit / Forums', noteQueries: [] },
        { name: 'Design Systems', noteQueries: [] },
        { name: 'Product Research Methods', noteQueries: [] },
      ],
      createLinks: false,
      dryRunLayout: false,
      uiPreset: 'dense',
      headerMode: 'full',
      themeColorMode: 'auto',
      scaffoldMode: 'clean',
      notesMode: 'none',
      referenceGrouping: 'theme',
      executionMode: 'sync_small',
      dedupePolicy: 'by_url',
      layoutPolicy: 'auto_expand',
      preRunCleanup: 'delete_by_run',
      continueOnError: true,
    });
    out.push({ step: 'generateResearchBoard', ok: gen.ok, payload: gen.payload });

    const summary = await call(client, 'summarizeBoard', {
      groupBy: 'type',
      includeSampleNodes: true,
      sampleLimit: 50,
      scope: { bbox: { x: origin.x - 200, y: origin.y - 220, width: 4200, height: 3800 } },
    });
    out.push({ step: 'summarizeBoard_region', ok: summary.ok, payload: summary.payload });

    const headerNodeId = gen.payload?.board?.headerIds?.boardHeaderNodeId || null;
    if (headerNodeId) {
      const shot = await call(client, 'figma_capture_screenshot', { nodeId: headerNodeId, scale: 1 });
      out.push({ step: 'figma_capture_screenshot_header', ok: shot.ok, payload: shot.payload });
    }

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await client.close().catch(() => {});
  }
})();
