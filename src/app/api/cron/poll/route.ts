import { NextRequest, NextResponse } from 'next/server';
import { labelMessage, listPendingMessageIds } from '@/lib/gmail';
import { processMessage } from '@/lib/processor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Requires Vercel Pro for >10s; 60s is the default on Pro. Hobby caps at 10s.
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  // Vercel Cron attaches this header on its own invocations.
  if (req.headers.get('x-vercel-cron')) return true;
  const auth = req.headers.get('authorization') || '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET) return false;
  return auth === expected;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const maxPerTick = Math.max(1, Number(process.env.MAX_PER_TICK || '3'));
  const startedAt = Date.now();
  const hardBudgetMs = 55_000; // leave 5s headroom under 60s maxDuration

  const results: unknown[] = [];

  try {
    const ids = await listPendingMessageIds(maxPerTick * 2);
    for (const id of ids.slice(0, maxPerTick)) {
      if (Date.now() - startedAt > hardBudgetMs) {
        results.push({ id, skipped: 'time budget exhausted — will retry next tick' });
        break;
      }
      try {
        const r = await processMessage(id);
        results.push({ id, ...r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[cron] failed to process', id, err);
        try {
          await labelMessage(id, 'error', true);
        } catch {
          // best-effort
        }
        results.push({ id, action: 'error', error: msg });
      }
    }
    return NextResponse.json({
      ok: true,
      processed: results.length,
      elapsedMs: Date.now() - startedAt,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron] fatal', err);
    return NextResponse.json({ ok: false, error: msg, results }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
