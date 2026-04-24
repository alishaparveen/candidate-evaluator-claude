import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const env = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    google_client_id: !!process.env.GOOGLE_CLIENT_ID,
    google_client_secret: !!process.env.GOOGLE_CLIENT_SECRET,
    google_refresh_token: !!process.env.GOOGLE_REFRESH_TOKEN,
    from_email: !!process.env.EVALUATOR_FROM_EMAIL,
    cron_secret: !!process.env.CRON_SECRET,
    github_token: !!process.env.GITHUB_TOKEN, // optional
  };
  const required = ['anthropic', 'google_client_id', 'google_client_secret', 'google_refresh_token', 'from_email', 'cron_secret'] as const;
  const ok = required.every((k) => env[k]);
  return NextResponse.json({ ok, env, time: new Date().toISOString() });
}
