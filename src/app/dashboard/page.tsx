import { getRecentEvaluations, getStats, isStoreConfigured, type StoredEvaluation } from '@/lib/store';
import { RUBRIC } from '@/lib/rubric';
import { ErrorScreen, NavHeader, S, Stat, relTime, shortDim } from '@/components/dashboard-ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Props = { searchParams: Promise<{ token?: string }> };

export default async function DashboardInbox({ searchParams }: Props) {
  const { token } = await searchParams;
  const expected = process.env.CRON_SECRET;
  if (!expected) return <ErrorScreen msg="CRON_SECRET is not set on the server." />;
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

  const [evals, stats] = await Promise.all([getRecentEvaluations(50), getStats()]);
  const inboxEmail = process.env.EVALUATOR_FROM_EMAIL || '';

  return (
    <main style={S.main}>
      <NavHeader
        token={token}
        currentTab='inbox'
        subtitle={`Last 50 processed messages from ${process.env.EVALUATOR_FROM_EMAIL || 'inbox'}`}
      />

      <section style={S.statsRow}>
        <Stat label='Total' value={String(stats.total)} />
        <Stat label='Evaluated' value={String(stats.byAction.evaluated)} />
        <Stat label='Asked for info' value={String(stats.byAction.requested_info)} />
        <Stat label='Skipped' value={String(stats.byAction.skipped)} />
        <Stat label='Spam-filtered' value={String(stats.byAction.spam_filtered)} />
        <Stat
          label='Errors'
          value={String(stats.byAction.error)}
          accent={stats.byAction.error > 0 ? '#e00' : undefined}
        />
        <Stat
          label='Pass rate'
          value={stats.passRate === null ? '—' : `${Math.round(stats.passRate * 100)}%`}
        />
        <Stat
          label='Avg score'
          value={stats.avgScore === null ? '—' : stats.avgScore.toFixed(2)}
        />
      </section>

      {evals.length === 0 ? (
        <div style={S.empty}>
          No applications processed yet. Send an email to the inbox and wait one cron tick.
        </div>
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
              <Row key={e.messageId} e={e} inboxEmail={inboxEmail} />
            ))}
          </tbody>
        </table>
      )}

      <footer style={S.footer}>
        <span>Rubric pass threshold: {RUBRIC.passThreshold}/10</span>
        <span> · </span>
        <span>
          Source:{' '}
          <a style={S.link} href='https://github.com/alishaparveen/candidate-evaluator-claude'>
            github
          </a>
        </span>
      </footer>
    </main>
  );
}

function Row({ e, inboxEmail }: { e: StoredEvaluation; inboxEmail: string }) {
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
          <div style={{ ...S.muted, fontSize: 12, marginTop: 4 }}>
            Concerns: {e.concerns.slice(0, 2).join(' · ')}
          </div>
        ) : null}
      </td>
      <td style={S.td}>
        <a
          style={S.link}
          href={
            inboxEmail
              ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(inboxEmail)}#inbox/${e.threadId}`
              : `https://mail.google.com/mail/u/0/#inbox/${e.threadId}`
          }
          target='_blank'
          rel='noopener noreferrer'
          title={`Open thread in ${inboxEmail || 'Gmail'}`}
        >
          open ↗
        </a>
      </td>
    </tr>
  );
}
