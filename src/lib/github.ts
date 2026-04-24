import type { GitHubSignal } from '@/types';

export function extractGithubUsername(url: string): string | null {
  if (!url) return null;
  const normalized = url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const m = normalized.match(/^github\.com\/([^\/\?#\s]+)/i);
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  // Filter obvious non-user paths
  const banned = new Set([
    'explore', 'topics', 'collections', 'settings', 'search', 'marketplace',
    'pricing', 'features', 'enterprise', 'about', 'contact', 'login', 'join',
    'new', 'notifications', 'issues', 'pulls', 'trending',
  ]);
  if (banned.has(name.toLowerCase())) return null;
  if (name.includes('.')) return null;
  return name;
}

async function gh(path: string): Promise<any> {
  const headers: Record<string, string> = {
    'User-Agent': 'candidate-evaluator',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return res.json();
}

export async function fetchGithubSignal(username: string): Promise<GitHubSignal | null> {
  try {
    const [profile, repos] = await Promise.all([
      gh(`/users/${encodeURIComponent(username)}`),
      gh(`/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=30&type=owner`),
    ]);

    const langCount: Record<string, number> = {};
    for (const r of repos) {
      if (r.language && !r.fork) langCount[r.language] = (langCount[r.language] || 0) + 1;
    }
    const topLanguages = Object.entries(langCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([l]) => l);

    const nonForks = repos.filter((r: any) => !r.fork);
    const totalStars = nonForks.reduce((acc: number, r: any) => acc + (r.stargazers_count || 0), 0);
    const activitySummary =
      `${nonForks.length} original repos out of ${repos.length} recent; ` +
      `${totalStars} total stars on recent originals; top languages: ${topLanguages.join(', ') || 'none'}.`;

    return {
      username,
      profile: {
        name: profile.name ?? null,
        bio: profile.bio ?? null,
        publicRepos: profile.public_repos ?? 0,
        followers: profile.followers ?? 0,
        following: profile.following ?? 0,
        createdAt: profile.created_at ?? '',
      },
      repos: repos.slice(0, 15).map((r: any) => ({
        name: r.name,
        description: r.description ?? null,
        language: r.language ?? null,
        stars: r.stargazers_count ?? 0,
        forks: r.forks_count ?? 0,
        isFork: !!r.fork,
        updatedAt: r.updated_at,
        url: r.html_url,
      })),
      topLanguages,
      activitySummary,
    };
  } catch (err) {
    console.error('[github] fetch failed for', username, err);
    return null;
  }
}
