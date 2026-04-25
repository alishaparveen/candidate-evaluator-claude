/**
 * One-shot migration: walk every message that currently has the
 * evaluator/skipped label and re-classify it as evaluator/spam-filtered if
 * it shows bulk-mail signals (List-Unsubscribe header, role-style sender,
 * etc.). Run once after upgrading to the layered-filter architecture so
 * historical newsletters stop polluting the "skipped" bucket on the dashboard.
 */
import './_load-env';
import { getGmailClient, labelName } from '../src/lib/gmail';

(async () => {
  const g = getGmailClient();
  const skippedLabel = labelName('skipped');
  const spamLabel = labelName('spam-filtered');

  const labels = await g.users.labels.list({ userId: 'me' });
  const skippedId = labels.data.labels?.find((l) => l.name === skippedLabel)?.id;
  let spamId = labels.data.labels?.find((l) => l.name === spamLabel)?.id;
  if (!spamId) {
    const created = await g.users.labels.create({
      userId: 'me',
      requestBody: { name: spamLabel, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    });
    spamId = created.data.id || undefined;
  }
  console.log('skipped label id:', skippedId, '  spam label id:', spamId);
  if (!skippedId || !spamId) {
    console.log('Missing labels, nothing to migrate.');
    return;
  }

  const ids = await g.users.messages.list({ userId: 'me', q: `label:${skippedLabel}`, maxResults: 50 });
  const messageIds = (ids.data.messages || []).map((m) => m.id!).filter(Boolean);
  console.log(`found ${messageIds.length} message(s) with the old skipped label`);

  let migrated = 0;
  for (const id of messageIds) {
    const m = await g.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['List-Unsubscribe', 'Precedence', 'Auto-Submitted', 'From'],
    });
    const get = (n: string) =>
      m.data.payload?.headers?.find((x) => (x.name || '').toLowerCase() === n.toLowerCase())?.value || '';
    const hasListUnsub = !!get('List-Unsubscribe');
    const precBulk = /bulk|junk|list/i.test(get('Precedence'));
    const auto = get('Auto-Submitted');
    const autoSubmitted = !!(auto && auto.toLowerCase() !== 'no');
    const fromAddr = get('From').toLowerCase();
    const looksRole =
      /<(no-?reply|noreply|mailer-daemon|postmaster|bounce|notifications?|alerts?|info|hello|news|newsletter|updates?|team|support|marketing|notify|admin|account|billing|sales|community|help)@/i.test(
        fromAddr,
      );
    if (hasListUnsub || precBulk || autoSubmitted || looksRole) {
      await g.users.messages.modify({
        userId: 'me',
        id,
        requestBody: { addLabelIds: [spamId], removeLabelIds: [skippedId] },
      });
      migrated++;
    }
  }
  console.log(`migrated ${migrated} of ${messageIds.length} messages to spam-filtered`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
