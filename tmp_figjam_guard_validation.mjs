import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoCwd = '/Users/dante/work/repositories/figma-console-mcp';

function extractText(result) {
  const textBlock = (result?.content || []).find((c) => c.type === 'text');
  return textBlock?.text ?? null;
}

async function main() {
  const transport = new StdioClientTransport({
    command: './node_modules/.bin/tsx',
    args: ['src/figjam-local.ts'],
    cwd: repoCwd,
    stderr: 'pipe',
    env: { ...process.env, LOG_LEVEL: 'fatal' },
  });

  const client = new Client({ name: 'figjam-guard-validation', version: '0.1.0' }, { capabilities: {} });
  const stderrChunks = [];
  if (transport.stderr) {
    transport.stderr.on('data', (chunk) => stderrChunks.push(String(chunk)));
  }

  const out = { startedAt: new Date().toISOString(), steps: [], stderrTail: null };

  const run = async (name, args = {}) => {
    const started = Date.now();
    try {
      const raw = await client.callTool({ name, arguments: args });
      out.steps.push({
        name,
        args,
        durationMs: Date.now() - started,
        ok: !raw?.isError,
        raw,
        rawText: extractText(raw),
      });
      return raw;
    } catch (error) {
      out.steps.push({
        name,
        args,
        durationMs: Date.now() - started,
        ok: false,
        thrown: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  try {
    await client.connect(transport);

    const status = await run('figjam_get_status', {});
    const sticky = await run('createSticky', { text: 'Guard Smoke Sticky', x: 260, y: 220 });
    const shape = await run('createShape', { type: 'rectangle', text: 'Guard Smoke Shape', x: 560, y: 220 });

    const stickyText = extractText(sticky);
    const shapeText = extractText(shape);
    let stickyId = null;
    let shapeId = null;
    try { stickyId = JSON.parse(stickyText || '{}')?.sticky?.id || null; } catch {}
    try { shapeId = JSON.parse(shapeText || '{}')?.shape?.id || null; } catch {}

    await run('createConnector', {
      fromNodeId: stickyId || 'missing-sticky-id',
      toNodeId: shapeId || 'missing-shape-id',
    });

    await run('figma_get_variables', {});

    out.stderrTail = stderrChunks.join('').slice(-10000);
    console.log(JSON.stringify(out, null, 2));
  } catch (fatal) {
    out.fatal = fatal instanceof Error ? (fatal.stack || fatal.message) : String(fatal);
    out.stderrTail = stderrChunks.join('').slice(-10000);
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  } finally {
    try { await client.close(); } catch {}
    try { await transport.close(); } catch {}
  }
}

main();
