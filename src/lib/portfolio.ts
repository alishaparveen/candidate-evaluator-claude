import { htmlToText } from 'html-to-text';
import type { PortfolioSignal } from '@/types';

export async function fetchPortfolio(url: string): Promise<PortfolioSignal | null> {
  if (!url) return null;
  const normalized = url.match(/^https?:\/\//i) ? url : `https://${url}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(normalized, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; CandidateEvaluator/0.1; +https://github.com/)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html') && !contentType.includes('text')) return null;

    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

    const text = htmlToText(html, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'nav', format: 'skip' },
        { selector: 'footer', format: 'skip' },
      ],
    })
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, 15_000);

    return {
      url: normalized,
      title: titleMatch?.[1]?.trim() || null,
      textContent: text,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[portfolio] fetch failed for', normalized, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
