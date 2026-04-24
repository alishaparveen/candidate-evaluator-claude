export default function Home() {
  return (
    <main style={{ maxWidth: 680, margin: '3rem auto', padding: '0 1.5rem', lineHeight: 1.6, color: '#111' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Candidate Evaluator</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Email-based AI agent that screens job applications.
      </p>
      <p>
        Send an application (resume PDF + GitHub link + portfolio link) to the configured inbox.
        The agent polls Gmail every minute, evaluates, and replies in the same thread.
      </p>
      <ul>
        <li>Health: <a href="/api/health">/api/health</a></li>
        <li>Manual trigger: <code>POST /api/cron/poll</code> with <code>Authorization: Bearer $CRON_SECRET</code></li>
      </ul>
      <hr style={{ margin: '2rem 0', border: 0, borderTop: '1px solid #eee' }} />
      <p style={{ color: '#888', fontSize: 14 }}>
        Built for the Plum Residency take-home. See <code>README.md</code> for architecture and deployment.
      </p>
    </main>
  );
}
