import { getTestResults, getTestSummary, isStoreConfigured } from '@/lib/store';
import { RUBRIC } from '@/lib/rubric';
import {
  ErrorScreen,
  NavHeader,
  S,
  TestPackEmpty,
  TestPackSection,
} from '@/components/dashboard-ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Props = { searchParams: Promise<{ token?: string }> };

export default async function DashboardTests({ searchParams }: Props) {
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
        sub='Provision an Upstash Redis instance via the Vercel Marketplace and connect it to this project.'
      />
    );
  }

  const [tests, summary] = await Promise.all([getTestResults(), getTestSummary()]);

  return (
    <main style={S.main}>
      <NavHeader
        token={token}
        currentTab='tests'
        subtitle={
          summary.total > 0
            ? `${summary.total} fixtures · ${summary.pass} pass · ${summary.softFail} soft-fail · ${summary.fail} fail`
            : 'No test pack results in storage yet'
        }
      />

      {tests.length === 0 ? (
        <TestPackEmpty />
      ) : (
        <TestPackSection tests={tests} summary={summary} />
      )}

      <footer style={S.footer}>
        <span>Rubric pass threshold: {RUBRIC.passThreshold}/10</span>
        <span> · </span>
        <span>
          Re-run via:{' '}
          <code>cd tests && python runner.py --handler handler_my_agent:process_message --out results.json</code>
          {' '}then{' '}
          <code>npm run test:populate</code>
        </span>
      </footer>
    </main>
  );
}
