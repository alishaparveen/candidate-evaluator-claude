import { google, gmail_v1 } from 'googleapis';
import type { CandidateApplication, EmailAttachment } from '@/types';

let cachedClient: gmail_v1.Gmail | null = null;

export function getGmailClient(): gmail_v1.Gmail {
  if (cachedClient) return cachedClient;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth credentials missing (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN).');
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  cachedClient = google.gmail({ version: 'v1', auth: oauth2 });
  return cachedClient;
}

const labelIdCache = new Map<string, string>();

async function ensureLabelId(name: string): Promise<string> {
  if (labelIdCache.has(name)) return labelIdCache.get(name)!;
  const gmail = getGmailClient();
  const list = await gmail.users.labels.list({ userId: 'me' });
  const existing = list.data.labels?.find((l) => l.name === name);
  if (existing?.id) {
    labelIdCache.set(name, existing.id);
    return existing.id;
  }
  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  const id = created.data.id;
  if (!id) throw new Error(`Could not create label: ${name}`);
  labelIdCache.set(name, id);
  return id;
}

export function labelName(suffix: string): string {
  const prefix = process.env.APPLICATION_LABEL_PREFIX || 'evaluator';
  return `${prefix}/${suffix}`;
}

/**
 * List unread messages that haven't been processed yet.
 * State is encoded purely in Gmail labels — no external DB.
 */
export async function listPendingMessageIds(limit = 10): Promise<string[]> {
  const gmail = getGmailClient();
  const evaluated = labelName('evaluated');
  const errored = labelName('error');
  const skipped = labelName('skipped');
  const spamFiltered = labelName('spam-filtered');
  // Source of truth for "already handled" is per-message KV state, NOT this
  // query. We exclude THREADS that reached a terminal state (evaluated /
  // error / spam-filtered / explicitly skipped) but DO include threads in
  // `needs-info` — that's how we pick up the candidate replying with the
  // resume / GitHub link we asked for. The processor uses
  // wasMessageProcessed() to dedupe individual messages so we never
  // re-process the same message ID. Bound by newer_than:7d so the agent
  // doesn't re-discover the entire inbox history on first deploy.
  const q = `in:inbox -from:me newer_than:7d -label:${evaluated} -label:${errored} -label:${skipped} -label:${spamFiltered}`;
  const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: limit * 3 });
  return (res.data.messages || []).map((m) => m.id!).filter(Boolean);
}

export async function fetchMessageIdHeader(messageId: string): Promise<string> {
  const gmail = getGmailClient();
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['Message-ID', 'Message-Id'],
  });
  const hdr = res.data.payload?.headers || [];
  return (
    hdr.find((h) => (h.name || '').toLowerCase() === 'message-id')?.value || ''
  );
}

/**
 * Fetch a single message PLUS the full thread context, so when a candidate
 * replies to our "needs info" email we see the original application too.
 */
export async function fetchApplicationFromMessage(messageId: string): Promise<CandidateApplication> {
  const gmail = getGmailClient();
  const msgMeta = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'minimal' });
  const threadId = msgMeta.data.threadId!;
  const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  const messages = thread.data.messages || [];

  const myEmail = (process.env.EVALUATOR_FROM_EMAIL || '').toLowerCase();
  const getHeader = (hs: gmail_v1.Schema$MessagePartHeader[], name: string) =>
    hs.find((h) => (h.name || '').toLowerCase() === name.toLowerCase())?.value || '';

  // Canonical sender info comes from the first message in the thread.
  const first = messages[0];
  const firstHeaders = first?.payload?.headers || [];
  const fromRaw = getHeader(firstHeaders, 'From');
  const toRaw = getHeader(firstHeaders, 'To');
  const subject = getHeader(firstHeaders, 'Subject');
  const dateStr = getHeader(firstHeaders, 'Date');
  const listUnsubscribe = getHeader(firstHeaders, 'List-Unsubscribe');
  const precedence = getHeader(firstHeaders, 'Precedence');
  const autoSubmitted = getHeader(firstHeaders, 'Auto-Submitted');
  const fromMatch = fromRaw.match(/^\s*(?:"?([^"<]*)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?/);
  const fromName = fromMatch?.[1]?.trim() || '';
  const fromEmail = (fromMatch?.[2] || fromRaw).trim();

  const bodyParts: string[] = [];
  const attachments: EmailAttachment[] = [];

  for (const m of messages) {
    const mHeaders = m.payload?.headers || [];
    const mFrom = getHeader(mHeaders, 'From').toLowerCase();
    if (myEmail && mFrom.includes(myEmail)) continue; // skip our own outbound messages

    let sawPlain = false;
    const collectPlain = (part: gmail_v1.Schema$MessagePart | undefined) => {
      if (!part) return;
      if (part.mimeType === 'text/plain' && part.body?.data) sawPlain = true;
      if (part.parts) part.parts.forEach(collectPlain);
    };
    collectPlain(m.payload);

    const walk = async (part: gmail_v1.Schema$MessagePart | undefined) => {
      if (!part) return;
      if (part.parts) {
        for (const p of part.parts) await walk(p);
      }
      if (part.filename && part.body?.attachmentId) {
        const att = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: m.id!,
          id: part.body.attachmentId,
        });
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          data: att.data.data || '',
        });
      } else if (part.mimeType === 'text/plain' && part.body?.data) {
        bodyParts.push(Buffer.from(part.body.data, 'base64').toString('utf-8'));
      } else if (part.mimeType === 'text/html' && part.body?.data && !sawPlain) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        bodyParts.push(stripHtml(html));
      }
    };
    await walk(m.payload);
  }

  return {
    messageId,
    threadId,
    from: fromEmail,
    fromName,
    to: toRaw,
    listUnsubscribe: listUnsubscribe || undefined,
    precedence: precedence || undefined,
    autoSubmitted: autoSubmitted || undefined,
    subject,
    body: bodyParts.join('\n\n---\n\n'),
    receivedAt: dateStr,
    attachments,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function sendReply(params: {
  threadId: string;
  to: string;
  toName?: string;
  originalSubject: string;
  subject?: string;
  body: string;
  inReplyTo?: string;
}): Promise<void> {
  const gmail = getGmailClient();
  const fromEmail = process.env.EVALUATOR_FROM_EMAIL;
  const fromName = process.env.EVALUATOR_FROM_NAME || 'Hiring Team';
  if (!fromEmail) throw new Error('EVALUATOR_FROM_EMAIL is not set');

  const rawSubject = params.subject || params.originalSubject;
  const subject = rawSubject.toLowerCase().startsWith('re:') ? rawSubject : `Re: ${rawSubject}`;
  const toHeader = params.toName ? `"${sanitizeQuoted(params.toName)}" <${params.to}>` : params.to;

  const lines = [
    `From: "${sanitizeQuoted(fromName)}" <${fromEmail}>`,
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    params.inReplyTo ? `In-Reply-To: ${params.inReplyTo}` : '',
    params.inReplyTo ? `References: ${params.inReplyTo}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    params.body,
  ].filter(Boolean);

  const encoded = Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded, threadId: params.threadId },
  });
}

function sanitizeQuoted(s: string): string {
  return s.replace(/"/g, '').replace(/[\r\n]+/g, ' ').trim();
}

export async function labelMessage(messageId: string, suffix: string, markRead = true): Promise<void> {
  const gmail = getGmailClient();
  const id = await ensureLabelId(labelName(suffix));
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      addLabelIds: [id],
      removeLabelIds: markRead ? ['UNREAD'] : [],
    },
  });
}

/**
 * Mark a message as read without applying an evaluator label — used for
 * messages we intentionally skip (auto-replies, bounces, our own replies).
 */
export async function markReadOnly(messageId: string): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
}
