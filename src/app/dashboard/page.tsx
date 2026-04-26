import {
  getRecentEvaluations,
  getStats,
  getTestResults,
  getTestSummary,
  isStoreConfigured,
  type StoredEvaluation,
  type TestResult,
  type TestVerdict,
} from '@/lib/store';
import { RUBRIC } from '@/lib/rubric';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Props = { searchParams: Promise<{ token?: string }> };

export default async function Dashboard({ searchParams }: Props) {
  const { token } = await searchParams;
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return <ErrorScreen msg="CRON_SECRET is not set on the server." />;
  }
  if (token !== expected) {
    return (
      <ErrorScreen
        msg='Unauthorized. Append ?token=<CRON_SECRET> to the URL.'
        sub='This page is only meant for the team — same secret used by cron-job.org.'
      />
    );
  }
  if (!isStoreConfigured()) {
    return (
      <ErrorScreen
        msg='Storage not configured.'
        sub='Provision an Upstash Redis instance via the Vercel Marketplace and connect it to this project. Expects UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL/TOKEN).'
      />
    );
  }

  const [evals, stats, tests, testSummary] = await Promise.all([
    getRecentEvaluations(50),
    getStats(),
    getTestResults(),
    getTestSummary(),
  ]);

  return (
    <main style={S.main}>
      <header style={S.header}>
        <div>
          <h1 style={S.h1}>Candidate Evaluator</h1>
          <p style={S.muted}>Last 50 processed messages from {process.env.EVALUATOR_FROM_EMAIL || 'inbox'}</p>
        </div>
        <a style={S.refresh} href={`?token=${token}`}>↻ refresh</a>
      </header>

      <section style={S.statsRow}>
        <Stat label='Total' value={String(stats.total)} />
        <Stat label='Evaluated' value={String(stats.byAction.evaluated)} />
        <Stat label='Asked for info' value={String(stats.byAction.requested_info)} />
        <Stat label='Skipped' value={String(stats.byAction.skipped)} />
        <Stat label='Spam-filtered' value={String(stats.byAction.spam_filtered)} />
        <Stat label='Errors' value={String(stats.byAction.error)} accent={stats.byAction.error > 0 ? '#e00' : undefined} />
        <Stat
          label='Pass rate'
          value={stats.passRate === null ? '—' : `${Math.round(stats.passRate * 100)}%`}
        />
        <Stat
          label='Avg score'
          value={stats.avgScore === null ? '—' : stats.avgScore.toFixed(2)}
        />
      </section>

      <TestPackSection tests={tests} summary={testSummary} />

      <h2 style={S.h2}>Inbox · last 50 processed messages</h2>
      {evals.length === 0 ? (
        <div style={S.empty}>No applications processed yet. Send an email to the inbox and wait one cron tick.</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr style={S.tr}>
              <th style={S.th}>When</th>
              <th style={S.th}>Candidate</th>
              <th style={S.th}>Subject</th>
              <th style={S.th}>Action</th>
              <th style={S.th}>Score</th>
              <th style={S.th}>Decision / Reason</th>
              <th style={S.th}>Thread</th>
            </tr>
          </thead>
          <tbody>
            {evals.map((e) => (
              <Row key={e.messageId} e={e} />
            ))}
          </tbody>
        </table>
      )}

      <footer style={S.footer}>
        <span>Rubric pass threshold: {RUBRIC.passThreshold}/10</span>
        <span> · </span>
        <span>Source: <a style={S.link} href='https://github.com/alishaparveen/candidate-evaluator-claude'>github</a></span>
      </footer>
    </main>
  );
}

function Row({ e }: { e: StoredEvaluation }) {
  const action = e.action;
  const actionStyle = {
    ...S.badge,
    background:
      action === 'evaluated' && e.decision === 'pass'
        ? '#0a7'
        : action === 'evaluated'
          ? '#a40'
          : action === 'requested_info'
            ? '#36b'
            : action === 'error'
              ? '#c00'
              : action === 'spam_filtered'
                ? '#999'
                : '#666',
  };
  const dim = e.scores
    ? Object.entries(e.scores)
        .map(([k, v]) => `${shortDim(k)}:${v.score}`)
        .join(' · ')
    : '';
  const reason =
    e.action === 'evaluated'
      ? `${e.decision === 'pass' ? 'PASS' : 'FAIL'} — ${e.summary || ''}`
      : e.action === 'requested_info'
        ? `Asked for: ${(e.missing || []).join(', ')}`
        : e.action === 'spam_filtered'
          ? `Filtered — ${e.reason || ''}`
          : e.action === 'skipped'
            ? `Skipped — ${e.reason || ''}`
            : `Error — ${e.errorMessage || ''}`;
  return (
    <tr style={S.tr}>
      <td style={S.td} title={e.processedAt}>{relTime(e.processedAt)}</td>
      <td style={S.td}>
        <div style={S.candidateName}>{e.candidateName || '—'}</div>
        <div style={S.muted}>{e.candidateEmail}</div>
      </td>
      <td style={{ ...S.td, ...S.subjectCell }}>{e.subject || '(no subject)'}</td>
      <td style={S.td}>
        <span style={actionStyle}>{action.replace('_', ' ')}</span>
      </td>
      <td style={S.td}>
        {typeof e.weightedTotal === 'number' ? (
          <>
            <div style={S.score}>{e.weightedTotal.toFixed(2)}</div>
            {dim ? <div style={{ ...S.muted, fontSize: 11 }}>{dim}</div> : null}
          </>
        ) : (
          <span style={S.muted}>—</span>
        )}
      </td>
      <td style={S.td}>
        <div style={{ maxWidth: 480, lineHeight: 1.4, whiteSpace: 'normal' }}>{reason}</div>
        {e.action === 'evaluated' && e.concerns && e.concerns.length > 0 ? (
          <div style={{ ...S.muted, fontSize: 12, marginTop: 4 }}>Concerns: {e.concerns.slice(0, 2).join(' · ')}</div>
        ) : null}
      </td>
      <td style={S.td}>
        <a
          style={S.link}
          href={`https://mail.google.com/mail/u/0/#inbox/${e.threadId}`}
          target='_blank'
          rel='noopener noreferrer'
        >
          open ↗
        </a>
      </td>
    </tr>
  );
}

function shortDim(id: string): string {
  return (
    {
      shipped_products: 'ship',
      technical_depth: 'tech',
      business_thinking: 'biz',
      speed_execution: 'spd',
      github_signal: 'gh',
    } as Record<string, string>
  )[id] || id.slice(0, 4);
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return iso;
  const sec = (Date.now() - t) / 1000;
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={S.statBox}>
      <div style={{ ...S.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ ...S.statValue, color: accent || '#111' }}>{value}</div>
    </div>
  );
}

function TestPackSection({
  tests,
  summary,
}: {
  tests: TestResult[];
  summary: { total: number; pass: number; fail: number; softFail: number; recordedAt: string | null };
}) {
  if (!tests.length) {
    return (
      <details style={S.testsCollapsed}>
        <summary style={S.testsSummaryEmpty}>
          Test pack — no results in KV yet. Run <code>npm run test:populate</code> after a test pack run.
        </summary>
      </details>
    );
  }

  const sorted = [...tests].sort((a, b) => {
    // Group by folder, then alphabetical within
    if (a.folder !== b.folder) return a.folder.localeCompare(b.folder);
    return a.fixtureId.localeCompare(b.fixtureId);
  });

  return (
    <section style={S.testsSection}>
      <header style={S.testsHeader}>
        <div>
          <h2 style={S.h2}>Plum test pack — last run</h2>
          <p style={S.muted}>
            22 adversarial fixtures. {summary.recordedAt ? `Recorded ${relTime(summary.recordedAt)}` : ''}
          </p>
        </div>
        <div style={S.testsHeaderStats}>
          <span style={{ ...S.testsBadge, background: '#0a7' }}>{summary.pass} PASS</span>
          {summary.softFail > 0 && (
            <span style={{ ...S.testsBadge, background: '#caa600' }}>{summary.softFail} SOFT</span>
          )}
          <span style={{ ...S.testsBadge, background: summary.fail > 0 ? '#c00' : '#666' }}>{summary.fail} FAIL</span>
        </div>
      </header>

      <table style={S.table}>
        <thead>
          <tr style={S.tr}>
            <th style={S.th}>Fixture</th>
            <th style={S.th}>Bucket</th>
            <th style={S.th}>Expected</th>
            <th style={S.th}>Actual</th>
            <th style={S.th}>Verdict</th>
            <th style={S.th}>Score</th>
            <th style={S.th}>Layer</th>
            <th style={S.th}>Reasoning</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <TestRow key={t.fixtureId} t={t} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TestRow({ t }: { t: TestResult }) {
  const verdictStyle = {
    ...S.badge,
    background:
      t.verdict === 'PASS' ? '#0a7' : t.verdict === 'SOFT-FAIL' ? '#caa600' : '#c00',
  };
  const scoreLine = t.scores
    ? Object.entries(t.scores)
        .map(([k, v]) => `${shortDim(k)}:${v}`)
        .join(' · ')
    : '';
  const decisionMatches = t.expectedDecision
    .split('_or_')
    .map((s) => s.trim())
    .includes(t.actualDecision);
  return (
    <tr style={S.tr}>
      <td style={S.td}>
        <div style={S.candidateName}>{t.fixtureId}</div>
        <div style={S.muted}>{t.from}</div>
      </td>
      <td style={S.td}>
        <span style={S.bucketBadge}>{t.folder.replace(/^\d+_/, '')}</span>
      </td>
      <td style={S.td}>
        <code style={S.codeInline}>{t.expectedDecision}</code>
      </td>
      <td style={S.td}>
        <code style={{ ...S.codeInline, color: decisionMatches ? '#0a7' : '#c00' }}>
          {t.actualDecision}
        </code>
      </td>
      <td style={S.td}>
        <span style={verdictStyle}>{t.verdict}</span>
      </td>
      <td style={S.td}>
        {typeof t.weightedTotal === 'number' ? (
          <>
            <div style={S.score}>{t.weightedTotal.toFixed(2)}</div>
            {scoreLine ? <div style={{ ...S.muted, fontSize: 11 }}>{scoreLine}</div> : null}
          </>
        ) : (
          <span style={S.muted}>—</span>
        )}
      </td>
      <td style={S.td}>
        <code style={{ ...S.codeInline, fontSize: 11 }}>{t.filterLayer || '—'}</code>
      </td>
      <td style={{ ...S.td, maxWidth: 460 }}>
        <div style={{ lineHeight: 1.4, whiteSpace: 'normal', fontSize: 12, color: '#333' }}>
          {(t.reasoning || '').split('\n')[0].slice(0, 280)}
        </div>
        {t.notes ? (
          <div style={{ ...S.muted, fontSize: 11, marginTop: 4, fontStyle: 'italic' }}>
            test pack note: {t.notes}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function ErrorScreen({ msg, sub }: { msg: string; sub?: string }) {
  return (
    <main style={{ maxWidth: 560, margin: '6rem auto', padding: '0 1.5rem', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Candidate Evaluator — dashboard</h1>
      <p style={{ color: '#c00' }}>{msg}</p>
      {sub ? <p style={{ color: '#666', fontSize: 14 }}>{sub}</p> : null}
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  main: { maxWidth: 1280, margin: '2rem auto', padding: '0 1.5rem', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#111' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 20 },
  h1: { fontSize: 24, margin: 0 },
  h2: { fontSize: 18, margin: '32px 0 12px 0', fontWeight: 600 },
  muted: { color: '#888', fontSize: 13, margin: '4px 0 0 0' },
  refresh: { textDecoration: 'none', background: '#111', color: '#fff', padding: '8px 14px', borderRadius: 6, fontSize: 13 },
  testsSection: { marginBottom: 32, border: '1px solid #eee', borderRadius: 8, padding: 18, background: '#fcfcfc' },
  testsHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  testsHeaderStats: { display: 'flex', gap: 6 },
  testsBadge: { color: '#fff', padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600 },
  testsCollapsed: { background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 14, marginBottom: 24 },
  testsSummaryEmpty: { fontSize: 13, color: '#888', cursor: 'pointer' },
  bucketBadge: { background: '#eee', color: '#444', padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 500 },
  codeInline: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, padding: '1px 5px', background: '#f3f3f3', borderRadius: 3 },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 12, marginBottom: 20 },
  statBox: { background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 14 },
  statValue: { fontSize: 22, fontWeight: 600, marginTop: 4 },
  empty: { padding: '4rem 2rem', textAlign: 'center', color: '#888', background: '#fafafa', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  tr: { borderBottom: '1px solid #eee' },
  th: { textAlign: 'left', padding: '10px 8px', color: '#666', fontWeight: 500, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  td: { padding: '12px 8px', verticalAlign: 'top' },
  candidateName: { fontWeight: 600 },
  subjectCell: { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge: { color: '#fff', padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 },
  score: { fontWeight: 600, fontSize: 16 },
  link: { color: '#0057ff', textDecoration: 'none' },
  footer: { marginTop: 30, paddingTop: 16, borderTop: '1px solid #eee', color: '#888', fontSize: 12 },
};
