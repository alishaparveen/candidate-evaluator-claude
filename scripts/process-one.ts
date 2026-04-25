import './_load-env';
import { processMessage } from '../src/lib/processor';

const id = process.argv[2];
if (!id) {
  console.error('usage: tsx scripts/process-one.ts <messageId>');
  process.exit(1);
}

(async () => {
  const r = await processMessage(id);
  console.log(JSON.stringify(r, null, 2));
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
