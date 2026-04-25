import './_load-env';
import { getGmailClient } from '../src/lib/gmail';

(async () => {
  const g = getGmailClient();
  const res = await g.users.messages.list({ userId: 'me', q: 'is:unread in:inbox', maxResults: 20 });
  const ids = (res.data.messages || []).map((m) => m.id!);
  console.log(`Found ${ids.length} unread:\n`);
  for (const id of ids) {
    const m = await g.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });
    const h = (n: string) => m.data.payload?.headers?.find((x) => x.name === n)?.value || '';
    console.log(`${id}  ${h('Date')}\n  From: ${h('From')}\n  Subj: ${h('Subject')}\n`);
  }
})();
