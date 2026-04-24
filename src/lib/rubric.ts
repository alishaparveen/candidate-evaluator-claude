export const RUBRIC = {
  passThreshold: 6.5, // weighted score out of 10
  dimensions: [
    {
      id: 'shipped_products',
      name: 'Shipped Production Products',
      weight: 0.25,
      description:
        'Evidence of real products launched to real users. Not tutorials, not toy demos. Look for live URLs, paying users, app-store listings, credible user counts, or revenue.',
      anchors: {
        0: 'No shipped products. Only course projects or tutorials.',
        3: 'Side projects on GitHub, no production deployment visible.',
        5: 'At least one project with a live deployment; may have some users.',
        7: 'Multiple shipped projects with evidence of real users (signups, reviews, customers).',
        10: 'Founded a company, shipped a product used at scale (thousands of users), or led a key feature at a known company.',
      },
    },
    {
      id: 'technical_depth',
      name: 'Technical Depth',
      weight: 0.25,
      description:
        'Quality of engineering. Are repos non-trivial? Clean code, appropriate abstractions, meaningful commit history? Do they go beyond glue code and tutorials?',
      anchors: {
        0: 'No substantive technical work visible.',
        3: 'Basic CRUD apps, follows tutorials, limited original architecture.',
        5: 'Competent full-stack work; handles common patterns correctly.',
        7: 'Shows system design, non-trivial algorithms, or infra work.',
        10: 'Deep expertise — open-source maintainer, systems-level work, or advanced ML / distributed / compilers.',
      },
    },
    {
      id: 'business_thinking',
      name: 'Business Thinking',
      weight: 0.2,
      description:
        'Understanding of why and for whom. Revenue, users, market, customer problems. Not just "what I built" but "why it matters".',
      anchors: {
        0: 'Projects framed purely as technical exercises. No user/market context.',
        3: 'Occasional mention of users but no depth.',
        5: 'Projects connected to real problems; some reasoning about users.',
        7: 'Clear articulation of user needs, market, revenue, or growth.',
        10: 'Founder-level thinking. Owns metrics, P&L, or strategic decisions.',
      },
    },
    {
      id: 'speed_execution',
      name: 'Speed of Execution',
      weight: 0.15,
      description:
        'Cadence of shipping. Evidence of rapid iteration, end-to-end ownership. Consistent GitHub activity, multiple projects shipped in short timeframes.',
      anchors: {
        0: 'Very sparse activity; projects abandoned early.',
        3: 'One or two projects, long gaps.',
        5: 'Steady activity; ships small things regularly.',
        7: 'Ships multiple end-to-end projects per year; consistent commits.',
        10: 'Extraordinary output. Multiple shipped products, hackathon wins, rapid iteration.',
      },
    },
    {
      id: 'github_signal',
      name: 'GitHub Signal',
      weight: 0.15,
      description:
        'Overall quality of the GitHub profile. Original repos (not forks), stars, languages, contribution graph, meaningful READMEs.',
      anchors: {
        0: 'Empty profile or only forks.',
        3: 'A few small repos, mostly tutorials.',
        5: 'Solid profile with original work, reasonable READMEs.',
        7: 'Strong profile — multiple original repos with traction or stars.',
        10: 'Exceptional — notable open source work or widely-used repos.',
      },
    },
  ],
} as const;

export type RubricDimensionId = (typeof RUBRIC.dimensions)[number]['id'];
