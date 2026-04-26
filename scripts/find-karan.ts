import './_load-env';
import { getGmailClient } from '../src/lib/gmail';

(async () => {
  const g = getGmailClient();
  const res = await g.users.messages.list({
    userId: 'me',
    q: 'in:inbox newer_than:1d',
    maxResults: 30,
  });
  console.log(`scanning ${(res.data.messages || []).length} recent messages\n`);
  for (const m of res.data.messages || []) {
    const detail = await g.users.messages.get({
      userId: 'me',
      id: m.id!,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });
    const h = (n: string) =>
      detail.data.payload?.headers?.find((x) => (x.name || '').toLowerCase() === n.toLowerCase())?.value || '';
    const labels = detail.data.labelIds || [];
    const interesting =
      /karan/i.test(h('From') + h('Subject')) ||
      labels.some((l) => l.toLowerCase().includes('error'));
    if (interesting) {
      console.log('★', m.id);
      console.log('   From:', h('From'));
      console.log('   Subject:', h('Subject'));
      console.log('   Date:', h('Date'));
      console.log('   Labels:', labels.join(','));
      console.log('   threadId:', detail.data.threadId);
      console.log();
    }
  }
})();
