import type { TestResult } from '@/lib/store';

// Shared styles for both dashboard pages.
export const S: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 1280,
    margin: '2rem auto',
    padding: '0 1.5rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#111',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid #eee',
    paddingBottom: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
    gap: 16,
  },
  brand: { display: 'flex', alignItems: 'baseline', gap: 12 },
  h1: { fontSize: 22, margin: 0, fontWeight: 700 },
  h1Sub: { fontSize: 13, color: '#888', margin: 0 },
  h2: { fontSize: 18, margin: '32px 0 12px 0', fontWeight: 600 },
  navWrap: { display: 'flex', alignItems: 'center', gap: 8 },
  navLink: {
    textDecoration: 'none',
    color: '#666',
    padding: '7px 14px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    border: '1px solid transparent',
  },
  navLinkActive: {
    textDecoration: 'none',
    color: '#111',
    padding: '7px 14px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    background: '#f3f3f3',
    border: '1px solid #e5e5e5',
  },
  refresh: {
    textDecoration: 'none',
    background: '#111',
    color: '#fff',
    padding: '7px 14px',
    borderRadius: 6,
    fontSize: 13,
    marginLeft: 4,
  },
  muted: { color: '#888', fontSize: 13, margin: '4px 0 0 0' },
  testsSection: {
    marginBottom: 32,
    border: '1px solid #eee',
    borderRadius: 8,
    padding: 18,
    background: '#fcfcfc',
  },
  testsHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  testsHeaderStats: { display: 'flex', gap: 6 },
  testsBadge: {
    color: '#fff',
    padding: '4px 10px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
  },
  testsCollapsed: {
    background: '#fafafa',
    border: '1px solid #eee',
    borderRadius: 8,
    padding: 14,
    marginBottom: 24,
  },
  testsSummaryEmpty: { fontSize: 13, color: '#888', cursor: 'pointer' },
  bucketBadge: {
    background: '#eee',
    color: '#444',
    padding: '2px 8px',
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 500,
  },
  codeInline: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    padding: '1px 5px',
    background: '#f3f3f3',
    borderRadius: 3,
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 1fr)',
    gap: 12,
    marginBottom: 20,
  },
  statBox: { background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 14 },
  statValue: { fontSize: 22, fontWeight: 600, marginTop: 4 },
  empty: {
    padding: '4rem 2rem',
    textAlign: 'center',
    color: '#888',
    background: '#fafafa',
    borderRadius: 8,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  tr: { borderBottom: '1px solid #eee' },
  th: {
    textAlign: 'left',
    padding: '10px 8px',
    color: '#666',
    fontWeight: 500,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  td: { padding: '12px 8px', verticalAlign: 'top' },
  candidateName: { fontWeight: 600 },
  subjectCell: { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge: {
    color: '#fff',
    padding: '3px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  score: { fontWeight: 600, fontSize: 16 },
  link: { color: '#0057ff', textDecoration: 'none' },
  footer: {
    marginTop: 30,
    paddingTop: 16,
    borderTop: '1px solid #eee',
    color: '#888',
    fontSize: 12,
  },
};

export type DashboardTab = 'inbox' | 'tests';

export function NavHeader({
  token,
  currentTab,
  subtitle,
  rightStats,
}: {
  token: string;
  currentTab: DashboardTab;
  subtitle?: string;
  rightStats?: React.ReactNode;
}) {
  const inboxHref = `/dashboard?token=${token}`;
  const testsHref = `/dashboard/tests?token=${token}`;
  const refreshHref = currentTab === 'inbox' ? inboxHref : testsHref;
  return (
    <header style={S.header}>
      <div style={S.brand}>
        <div>
          <h1 style={S.h1}>Candidate Evaluator</h1>
          {subtitle ? <p style={S.h1Sub}>{subtitle}</p> : null}
        </div>
      </div>
      <div style={S.navWrap}>
        <a href={inboxHref} style={currentTab === 'inbox' ? S.navLinkActive : S.navLink}>
          Inbox
        </a>
        <a href={testsHref} style={currentTab === 'tests' ? S.navLinkActive : S.navLink}>
          Test pack
        </a>
        {rightStats ? <span style={{ marginLeft: 8 }}>{rightStats}</span> : null}
        <a href={refreshHref} style={S.refresh}>↻ refresh</a>
      </div>
    </header>
  );
}

export function ErrorScreen({ msg, sub }: { msg: string; sub?: string }) {
  return (
    <main style={{ maxWidth: 560, margin: '6rem auto', padding: '0 1.5rem', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Candidate Evaluator — dashboard</h1>
      <p style={{ color: '#c00' }}>{msg}</p>
      {sub ? <p style={{ color: '#666', fontSize: 14 }}>{sub}</p> : null}
    </main>
  );
}

export function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={S.statBox}>
      <div style={{ ...S.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ ...S.statValue, color: accent || '#111' }}>{value}</div>
    </div>
  );
}

export function shortDim(id: string): string {
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

export function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return iso;
  const sec = (Date.now() - t) / 1000;
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

// ---------- Test pack rendering ----------

export function TestPackEmpty() {
  return (
    <div style={S.empty}>
      <p style={{ marginBottom: 8 }}>No test pack results in storage yet.</p>
      <p style={{ ...S.muted, fontSize: 13 }}>
        Run <code>npm run test:populate</code> after a test pack run to populate this view.
      </p>
    </div>
  );
}

export function TestPackSection({
  tests,
  summary,
}: {
  tests: TestResult[];
  summary: { total: number; pass: number; fail: number; softFail: number; recordedAt: string | null };
}) {
  if (!tests.length) return <TestPackEmpty />;

  const sorted = [...tests].sort((a, b) => {
    if (a.folder !== b.folder) return a.folder.localeCompare(b.folder);
    return a.fixtureId.localeCompare(b.fixtureId);
  });

  return (
    <section style={S.testsSection}>
      <header style={S.testsHeader}>
        <div>
          <h2 style={{ ...S.h2, marginTop: 0 }}>Plum test pack — last run</h2>
          <p style={S.muted}>
            22 adversarial fixtures across strong / weak / borderline / edge cases.{' '}
            {summary.recordedAt ? `Recorded ${relTime(summary.recordedAt)}.` : ''}
          </p>
        </div>
        <div style={S.testsHeaderStats}>
          <span style={{ ...S.testsBadge, background: '#0a7' }}>{summary.pass} PASS</span>
          {summary.softFail > 0 && (
            <span style={{ ...S.testsBadge, background: '#caa600' }}>{summary.softFail} SOFT</span>
          )}
          <span style={{ ...S.testsBadge, background: summary.fail > 0 ? '#c00' : '#666' }}>
            {summary.fail} FAIL
          </span>
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
