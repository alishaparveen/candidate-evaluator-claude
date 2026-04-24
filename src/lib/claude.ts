import Anthropic from '@anthropic-ai/sdk';

let cached: Anthropic | null = null;

export function getClaude(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  cached = new Anthropic({ apiKey });
  return cached;
}

export const MODELS = {
  parser: 'claude-haiku-4-5-20251001',
  evaluator: 'claude-opus-4-7',
  writer: 'claude-haiku-4-5-20251001',
} as const;

export function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

export function parseJsonFromText<T = unknown>(text: string): T {
  let s = text.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s) as T;
}
