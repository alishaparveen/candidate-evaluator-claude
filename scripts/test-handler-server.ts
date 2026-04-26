/**
 * Tiny HTTP bridge so the Plum test pack's Python runner.py can call the
 * agent's TypeScript pipeline.
 *
 * Listens on http://localhost:9000/process and accepts a POST with the test
 * pack's normalized message dict in the body. Returns the dry-run result.
 *
 *   npm run test:server     # start in foreground
 *   then in another shell:
 *   cd .../test_pack && python runner.py --handler handler_my_agent:process_message --out results.json
 *   python checker.py results.json
 *
 * GET /reset  — clears the in-memory Message-ID dedup set between runs.
 */
import './_load-env';
import http from 'node:http';
import { dryRun, resetDryRunDedup, type TestPackMessage } from '../src/lib/dry-run';

const PORT = Number(process.env.TEST_HANDLER_PORT || 9000);

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && url === '/reset') {
    resetDryRunDedup();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, reset: true }));
    return;
  }

  if (req.method === 'POST' && url === '/process') {
    let raw = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk) => {
      raw += chunk;
      // Cap at 30 MB so a misbehaving client can't OOM us.
      if (raw.length > 30 * 1024 * 1024) {
        req.destroy(new Error('payload too large'));
      }
    });
    req.on('end', async () => {
      try {
        const message = JSON.parse(raw) as TestPackMessage;
        const startedAt = Date.now();
        const result = await dryRun(message);
        const elapsed = Date.now() - startedAt;
        const fxId = message.fixture_id || message.message_id;
        console.log(
          `[${fxId}] ${result.decision.padEnd(10)} ${result.weighted_total != null ? `${result.weighted_total.toFixed(2)}/10` : ''} (${elapsed}ms) — ${result.filter_layer || ''}`,
        );
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[handler] error:', msg);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ decision: 'ERROR', error: msg, response_email: '', reasoning: msg }));
      }
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', try: 'GET /health · GET /reset · POST /process' }));
});

server.listen(PORT, () => {
  console.log(`test-handler-server listening on http://localhost:${PORT}`);
  console.log('  POST /process   { ...test-pack message ... }  → dry-run result');
  console.log('  GET  /reset                                    → clear dedup');
  console.log('  GET  /health                                   → ok');
});
