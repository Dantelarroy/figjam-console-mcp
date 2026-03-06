import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoCwd = '/Users/dante/work/repositories/figma-console-mcp';

function textOf(result) {
  const blk = (result?.content || []).find((c) => c.type === 'text');
  return blk?.text ?? null;
}

function parseText(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  const transport = new StdioClientTransport({
    command: './node_modules/.bin/tsx',
    args: ['src/figjam-local.ts'],
    cwd: repoCwd,
    stderr: 'pipe',
    env: { ...process.env, LOG_LEVEL: 'fatal' },
  });

  const client = new Client({ name: 'figjam-connected-validation', version: '0.1.0' }, { capabilities: {} });
  const stderr = [];
  if (transport.stderr) transport.stderr.on('data', (c) => stderr.push(String(c)));

  const out = { startedAt: new Date().toISOString(), waited: [], steps: [], stderrTail: null };

  const call = async (name, args = {}) => {
    const t0 = Date.now();
    const raw = await client.callTool({ name, arguments: args });
    const rawText = textOf(raw);
    const parsed = parseText(rawText);
    const row = { name, args, durationMs: Date.now() - t0, ok: !raw?.isError, raw, rawText, parsed };
    out.steps.push(row);
    return row;
  };

  try {
    await client.connect(transport);

    let statusRow = null;
    const maxAttempts = 60;
    for (let i = 1; i <= maxAttempts; i++) {
      statusRow = await call('figjam_get_status', {});
      const p = statusRow.parsed || {};
      out.waited.push({ attempt: i, connected: !!p.connected, connectedFiles: p?.websocket?.connectedFiles ?? null });
      if (p.connected === true && (p?.websocket?.connectedFiles ?? 0) >= 1) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    const finalStatus = statusRow?.parsed || {};
    if (!(finalStatus.connected === true && (finalStatus?.websocket?.connectedFiles ?? 0) >= 1)) {
      out.error = 'Bridge did not reach connectedFiles:1 within timeout';
      out.stderrTail = stderr.join('').slice(-10000);
      console.log(JSON.stringify(out, null, 2));
      return;
    }

    const sticky = await call('createSticky', { text: 'Connected Smoke Sticky', x: 260, y: 220 });
    const shape = await call('createShape', { type: 'rectangle', text: 'Connected Smoke Shape', x: 560, y: 220 });

    let stickyId = null;
    let shapeId = null;
    try { stickyId = sticky?.parsed?.sticky?.id ?? null; } catch {}
    try { shapeId = shape?.parsed?.shape?.id ?? null; } catch {}

    await call('createConnector', {
      fromNodeId: stickyId || 'missing-sticky-id',
      toNodeId: shapeId || 'missing-shape-id',
    });

    const vars = await call('figma_get_variables', {});

    let resolvedEditorType = null;
    let guardExercised = false;
    if (vars?.parsed && typeof vars.parsed === 'object') {
      const err = vars.parsed.error;
      if (err && typeof err === 'object') {
        resolvedEditorType = err.editorType ?? null;
        guardExercised = err.code === 'CAPABILITY_NOT_SUPPORTED';
      }
    }

    out.summary = {
      resolvedEditorType,
      guardExercised,
      conditionConnected: finalStatus.connected === true,
      conditionConnectedFiles: (finalStatus?.websocket?.connectedFiles ?? 0) >= 1,
    };

    out.stderrTail = stderr.join('').slice(-10000);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    try { await client.close(); } catch {}
    try { await transport.close(); } catch {}
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ fatal: e instanceof Error ? (e.stack || e.message) : String(e) }, null, 2));
  process.exit(1);
});
