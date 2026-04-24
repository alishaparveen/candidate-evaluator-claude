/**
 * One-shot helper to obtain a long-lived Gmail OAuth refresh token.
 *
 * Usage:
 *   1. Create an OAuth 2.0 Client (type: "Desktop app") in Google Cloud Console
 *      for a project with the Gmail API enabled.
 *   2. Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET into .env (or paste when prompted).
 *   3. Run: npm run get-token
 *   4. A browser will open. Sign in with the Gmail account the evaluator should
 *      read/send from. Approve the scopes. The script prints the refresh token.
 *   5. Put the refresh token into .env as GOOGLE_REFRESH_TOKEN (and into Vercel env vars).
 */
import { google } from 'googleapis';
import http from 'node:http';
import { URL } from 'node:url';
import readline from 'node:readline';

const PORT = 4321;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];

function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(q, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID || (await ask('GOOGLE_CLIENT_ID: '));
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (await ask('GOOGLE_CLIENT_SECRET: '));
  if (!clientId || !clientSecret) {
    console.error('Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required.');
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token on every run
    scope: SCOPES,
  });

  console.log('\nOpen this URL in a browser, sign in, and approve the scopes:\n');
  console.log(authUrl);
  console.log(`\nWaiting for callback on ${REDIRECT_URI} ...\n`);

  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/oauth2callback')) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('code');
    if (!code) {
      res.writeHead(400);
      res.end('missing code');
      return;
    }
    try {
      const { tokens } = await oauth2.getToken(code);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h2>Success</h2><p>You can close this tab and return to the terminal.</p>');
      console.log('\n==============================');
      console.log('COPY THIS INTO YOUR .env FILE:');
      console.log('==============================');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('==============================\n');
      if (!tokens.refresh_token) {
        console.warn('WARNING: no refresh_token returned. Revoke the app under');
        console.warn('https://myaccount.google.com/permissions and run this again.');
      }
      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500);
      res.end(`Error: ${(err as Error).message}`);
      console.error(err);
      process.exit(1);
    }
  });

  server.listen(PORT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
