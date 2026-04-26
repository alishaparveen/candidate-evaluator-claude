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

/**
 * Find the first complete top-level JSON object in `text` by walking from
 * the first `{` and tracking brace depth, with awareness of strings and
 * escapes. Stops when the depth returns to zero. This is much more robust
 * than `text.slice(first, lastIndexOf('}'))` — that approach breaks on
 * trailing prose ("Here's the JSON: {…}\n\nLet me know if you need more.")
 * because it includes the trailing text in the slice.
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Best-effort parser for free-form text that should contain a JSON object.
 *
 * 1. Strip markdown fences.
 * 2. Use brace-counting (string-/escape-aware) to isolate the FIRST complete
 *    top-level JSON object — robust against trailing prose, multiple JSON
 *    blocks, and "Here's the JSON: {…}" preambles.
 * 3. Try strict JSON.parse.
 * 4. On failure, fall back to jsonrepair — fixes common LLM output mistakes
 *    (unescaped quotes inside string values, trailing commas, missing
 *    commas, single-quoted keys, etc.) and re-parses.
 *
 * Used as a safety net only. Primary callers (extractApplication, evaluate)
 * use Anthropic tool_use mode which returns structured input directly and
 * never goes through this path.
 */
export function parseJsonFromText<T = unknown>(text: string): T {
  let s = text.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const isolated = extractFirstJsonObject(s);
  if (isolated) s = isolated;
  try {
    return JSON.parse(s) as T;
  } catch (err) {
    // Lazy-load jsonrepair only on the failure path so happy-path bundle
    // size on Vercel isn't affected.
    const { jsonrepair } = require('jsonrepair') as typeof import('jsonrepair');
    try {
      const repaired = jsonrepair(s);
      return JSON.parse(repaired) as T;
    } catch {
      // Re-throw the original error so logs point at the actual failure
      // location rather than the jsonrepair internals.
      throw err;
    }
  }
}
