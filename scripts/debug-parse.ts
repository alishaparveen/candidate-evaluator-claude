import './_load-env';
import { fetchApplicationFromMessage } from '../src/lib/gmail';
import { getClaude, MODELS, extractText } from '../src/lib/claude';
import { PARSER_PROMPT } from '../src/lib/prompts';
import type Anthropic from '@anthropic-ai/sdk';

const messageId = process.argv[2] || '19dca43decfb3579';

(async () => {
  console.log(`fetching message ${messageId}...`);
  const app = await fetchApplicationFromMessage(messageId);
  console.log('  from:', app.from);
  console.log('  subject:', app.subject);
  console.log('  body length:', app.body.length);
  console.log('  attachments:', app.attachments.map((a) => `${a.filename} (${a.mimeType}, ${a.data.length} b64-bytes)`).join(' | '));

  const pdfAttachments = app.attachments.filter((a) => a.mimeType === 'application/pdf');
  const content: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: `## Email metadata\nFrom: ${app.fromName ? `${app.fromName} <${app.from}>` : app.from}\nSubject: ${app.subject}\n\n## Email body\n${app.body || '(empty body)'}\n\n${pdfAttachments.length ? `## Resume PDFs follow as attachments.` : '## No PDF attached.'}`,
    },
  ];
  for (const pdf of pdfAttachments) {
    const standard = pdf.data.replace(/-/g, '+').replace(/_/g, '/');
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: standard },
    } as any);
  }

  console.log('\ncalling Haiku parser...');
  const claude = getClaude();
  const res = await claude.messages.create({
    model: MODELS.parser,
    max_tokens: 4096,
    system: PARSER_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const raw = extractText(res.content);
  console.log('\n=== RAW HAIKU OUTPUT (length=' + raw.length + ') ===');
  console.log(raw);
  console.log('=== END ===\n');

  console.log('attempting JSON.parse...');
  try {
    let s = raw.trim();
    if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
    const parsed = JSON.parse(s);
    console.log('✓ parsed OK. Keys:', Object.keys(parsed).join(', '));
  } catch (err) {
    console.error('✗ parse failed:', err instanceof Error ? err.message : err);
    if (err instanceof Error && /position (\d+)/.test(err.message)) {
      const pos = Number(RegExp.$1);
      const start = Math.max(0, pos - 80);
      const end = Math.min(raw.length, pos + 80);
      console.log('\nContext around position', pos, ':\n>>>');
      console.log(raw.slice(start, end));
      console.log('<<<');
      console.log(' '.repeat(Math.min(80, pos - start)) + '^');
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
