import './_load-env';
import { getGmailClient } from '../src/lib/gmail';

(async () => {
  const g = getGmailClient();
  for (const q of [
    'newer_than:1d in:inbox',
    'newer_than:1d in:spam',
    'newer_than:1d in:anywhere',
  ]) {
    console.log(`\n=== ${q} ===`);
    const res = await g.users.messages.list({ userId: 'me', q, maxResults: 10 });
    const ids = (res.data.messages || []).map((m) => m.id!);
    console.log(`${ids.length} message(s)`);
    for (const id of ids) {
      const m = await g.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date', 'To'],
      });
      const h = (n: string) => m.data.payload?.headers?.find((x) => x.name === n)?.value || '';
      const labels = m.data.labelIds?.join(',') || '';
      console.log(`  ${id} | ${h('Date')}\n    From: ${h('From')}\n    To:   ${h('To')}\n    Subj: ${h('Subject')}\n    Lbls: ${labels}`);
    }
  }
})();
