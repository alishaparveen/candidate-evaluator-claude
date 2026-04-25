/**
 * Loads .env with override=true so a stale system-wide env var (e.g. an empty
 * ANTHROPIC_API_KEY left over from another session) cannot mask the .env value.
 * Imported at the top of every CLI script.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env'), override: true });
