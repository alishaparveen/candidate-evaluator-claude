/**
 * Reads tests/results.json (latest output from runner.py) + the test pack's
 * expected_results.json, and writes the merged "expected vs actual" record
 * for each fixture into Upstash so the dashboard can render a Test Pack
 * section.
 *
 * Run order:
 *   1. Start the bridge:   npm run test:server     (in another shell)
 *   2. Run the test pack:  cd tests && python runner.py --handler handler_my_agent:process_message --out results.json
 *   3. Populate the dashboard:   npm run test:populate
 *
 * Or use:   npm run test:full     (does steps 2 + 3 in one go, assuming the bridge is up)
 */
import './_load-env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  saveTestResult,
  setTestResultIndex,
  isStoreConfigured,
  type TestResult,
  type TestVerdict,
} from '../src/lib/store';

const ROOT = resolve(process.cwd(), 'tests');
const RESULTS_PATH = resolve(ROOT, 'results.json');
const EXPECTED_PATH = resolve(ROOT, 'expected_results.json');

type Result = {
  fixture_id: string;
  folder: string;
  from: string;
  subject: string;
  result: {
    decision?: string;
    reasoning?: string;
    response_email?: string;
    weighted_total?: number;
    scores?: Record<string, number>;
    filter_layer?: string;
  };
};

type Expected = Record<
  string,
  {
    decision: string;
    must_mention?: string[];
    notes?: string;
  }
>;

function normalize(d: string | undefined | null): string | null {
  if (!d) return null;
  return d.trim().toLowerCase().replace(/-/g, '_').replace(/ /g, '_');
}

function decisionMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const accepted = expected.split('_or_').map((s) => normalize(s)!);
  return accepted.includes(actual);
}

function mentionsOk(reasoning: string, response: string, mustMention: string[]): boolean {
  if (!mustMention.length) return true;
  const haystack = `${reasoning}\n${response}`.toLowerCase();
  return mustMention.every((m) => haystack.includes(m.toLowerCase()));
}

async function main() {
  if (!isStoreConfigured()) {
    console.error('KV not configured. Need KV_REST_API_URL + KV_REST_API_TOKEN in .env.');
    process.exit(1);
  }

  let results: Result[];
  let expected: Expected;
  try {
    results = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'));
  } catch (err) {
    console.error(`Could not read ${RESULTS_PATH}. Run the test pack first:`);
    console.error('  cd tests && python runner.py --handler handler_my_agent:process_message --out results.json');
    process.exit(1);
  }
  try {
    expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf-8'));
  } catch (err) {
    console.error(`Could not read ${EXPECTED_PATH}.`);
    process.exit(1);
  }

  // Strip leading underscore-prefixed metadata keys from expected_results.json.
  const cleanExpected = Object.fromEntries(
    Object.entries(expected).filter(([k]) => !k.startsWith('_')),
  ) as Expected;

  const recordedAt = new Date().toISOString();
  const fixtureIds: string[] = [];
  let counts = { pass: 0, fail: 0, softFail: 0 };

  for (const fixtureId of Object.keys(cleanExpected)) {
    const exp = cleanExpected[fixtureId];
    const row = results.find((r) => r.fixture_id === fixtureId);
    if (!row) {
      console.warn(`  · skip ${fixtureId} — not in results.json`);
      continue;
    }

    const actual = normalize(row.result?.decision);
    const decOk = decisionMatches(actual, exp.decision);
    const mustMention = exp.must_mention || [];
    const reasoning = row.result?.reasoning || '';
    const response = row.result?.response_email || '';
    const ok = mentionsOk(reasoning, response, mustMention);

    let verdict: TestVerdict;
    if (decOk && ok) verdict = 'PASS';
    else if (decOk && !ok) verdict = 'SOFT-FAIL';
    else verdict = 'FAIL';

    if (verdict === 'PASS') counts.pass++;
    else if (verdict === 'SOFT-FAIL') counts.softFail++;
    else counts.fail++;

    const record: TestResult = {
      fixtureId,
      folder: row.folder,
      from: row.from,
      subject: row.subject,
      expectedDecision: exp.decision,
      actualDecision: actual || 'unknown',
      verdict,
      weightedTotal: row.result?.weighted_total,
      scores: row.result?.scores,
      reasoning: reasoning.slice(0, 2000),
      filterLayer: row.result?.filter_layer,
      notes: exp.notes,
      recordedAt,
    };

    await saveTestResult(record);
    fixtureIds.push(fixtureId);
    console.log(
      `  ${verdict.padEnd(9)} ${fixtureId.padEnd(48)} expected=${exp.decision.padEnd(28)} actual=${actual}`,
    );
  }

  await setTestResultIndex(fixtureIds);
  console.log(`\nWrote ${fixtureIds.length} records to KV. PASS ${counts.pass} · SOFT-FAIL ${counts.softFail} · FAIL ${counts.fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
