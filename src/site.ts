import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Period, PERIOD_TYPES, type PeriodType } from "./period.js";
import { Ranking, type RankingEntry } from "./ranking.js";
import { SITE_STYLE_CSS } from "./site-style.js";
import type { State, StateUser } from "./state.js";

interface ParsedPr {
  author: string;
  mergedAt: Date;
}

type RowUser = StateUser | { login: string };

export class Site {
  private readonly state: State;
  private readonly outputDir: string;
  private readonly timeZone: string;
  private readonly now: Date;
  private readonly usersByLogin: Map<string, StateUser>;
  private readonly parsedPrs: ParsedPr[];

  constructor(opts: { state: State; outputDir: string; timeZone: string; now?: Date }) {
    this.state = opts.state;
    this.outputDir = opts.outputDir;
    this.timeZone = opts.timeZone;
    this.now = opts.now ?? new Date();
    this.usersByLogin = new Map(opts.state.users.map((u) => [u.login, u]));
    this.parsedPrs = opts.state.pullRequests.map((pr) => ({
      author: pr.author_login,
      mergedAt: new Date(pr.merged_at),
    }));
  }

  call(): Map<PeriodType, Period[]> {
    const enumerated = new Map<PeriodType, Period[]>();
    for (const type of PERIOD_TYPES) {
      enumerated.set(type, this.enumeratePeriods(type));
    }
    const latest = Object.fromEntries(
      PERIOD_TYPES.map((type) => [type, enumerated.get(type)?.at(-1) ?? null]),
    ) as Record<PeriodType, Period | null>;
    for (const periods of enumerated.values()) {
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i]!;
        const prev = i > 0 ? periods[i - 1]! : null;
        const next = i < periods.length - 1 ? periods[i + 1]! : null;
        this.renderPeriod(period, prev, next, latest);
      }
    }
    this.renderIndex(latest.weekly);
    this.writeFile(join("assets", "style.css"), SITE_STYLE_CSS);
    return enumerated;
  }

  enumeratePeriods(type: PeriodType): Period[] {
    if (!this.state.backfillAnchor) return [];

    const first = new Period({
      type,
      startsAt: this.state.backfillAnchor,
      timeZone: this.timeZone,
    });
    const last = Period.latestClosed(type, this.now, this.timeZone);
    if (first.startsAt.getTime() > last.startsAt.getTime()) return [];

    const periods: Period[] = [];
    let current = first;
    while (current.startsAt.getTime() <= last.startsAt.getTime()) {
      periods.push(current);
      current = current.next();
    }
    return periods;
  }

  private renderPeriod(
    period: Period,
    prev: Period | null,
    next: Period | null,
    latest: Record<PeriodType, Period | null>,
  ): void {
    const counts = this.prCountsFor(period);
    const entries: RankingEntry<RowUser>[] = [];
    for (const [login, count] of counts) {
      entries.push({ user: this.usersByLogin.get(login) ?? { login }, count });
    }
    const ranking = new Ranking(entries);

    const body = renderPeriodBody({ period, ranking, prev, next, latest });
    const html = renderLayout({ title: period.label, assetPrefix: "../", body });
    this.writeFile(join(period.type, `${period.param}.html`), html);
  }

  private renderIndex(latestWeekly: Period | null): void {
    const target = latestWeekly ? `weekly/${latestWeekly.param}.html` : null;
    this.writeFile("index.html", renderIndexHtml(target));
  }

  private prCountsFor(period: Period): Map<string, number> {
    const counts = new Map<string, number>();
    for (const pr of this.parsedPrs) {
      if (!period.contains(pr.mergedAt)) continue;
      counts.set(pr.author, (counts.get(pr.author) ?? 0) + 1);
    }
    return counts;
  }

  private writeFile(relPath: string, content: string): void {
    const full = join(this.outputDir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function renderLayout(opts: { title: string; assetPrefix: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)} · Octoladder</title>
  <link rel="stylesheet" href="${escapeHtml(opts.assetPrefix)}assets/style.css">
</head>
<body>
  <main>
    ${opts.body}
  </main>
</body>
</html>
`;
}

function renderPeriodBody(opts: {
  period: Period;
  ranking: Ranking<RowUser>;
  prev: Period | null;
  next: Period | null;
  latest: Record<PeriodType, Period | null>;
}): string {
  const { period, ranking, prev, next, latest } = opts;
  const tabs = renderPeriodTabs(period, latest);
  const subtitle = period.subtitle ? `<p class="subtitle">${escapeHtml(period.subtitle)}</p>` : "";
  const prevLink = prev
    ? `<a href="${escapeHtml(prev.param)}.html" rel="prev">← Previous</a>`
    : "";
  const nextLink = next
    ? `<a href="${escapeHtml(next.param)}.html" rel="next">Next →</a>`
    : "";

  const table = ranking.isEmpty
    ? `<p class="empty">No merged PRs in this period.</p>`
    : `<table class="ranking">
  <thead><tr><th>Rank</th><th>Contributor</th><th>PRs</th></tr></thead>
  <tbody>
${ranking.rows.map(rankingRow).join("\n")}
  </tbody>
</table>
<p class="totals">${ranking.contributorCount} contributors · ${ranking.totalCount} merged PRs</p>`;

  return `<header>
  ${tabs}
  <h1>${escapeHtml(period.label)}</h1>
  ${subtitle}
  <nav class="period-nav">
    ${prevLink}
    ${nextLink}
  </nav>
</header>

${table}`;
}

function renderPeriodTabs(
  period: Period,
  latest: Record<PeriodType, Period | null>,
): string {
  const items = PERIOD_TYPES.map((type) => {
    const label = `Latest ${type}`;
    const target = latest[type];
    if (!target) {
      return `<span class="disabled">${label}</span>`;
    }
    const href = type === period.type
      ? `${target.param}.html`
      : `../${type}/${target.param}.html`;
    const current = period.equals(target) ? ` aria-current="page"` : "";
    return `<a href="${escapeHtml(href)}"${current}>${label}</a>`;
  });
  return `<nav class="period-tabs">
    ${items.join("\n    ")}
  </nav>`;
}

function rankingRow(row: { rank: number; user: RowUser; count: number }): string {
  const user = row.user as Partial<StateUser> & { login: string };
  const avatar = user.avatar_url
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="" width="24" height="24">`
    : "";
  const name = (user as { name?: string }).name ?? user.login;
  const inactive =
    user.active === false
      ? `<span class="inactive" title="No longer in any tracked team">(inactive)</span>`
      : "";
  return `    <tr>
      <td class="rank">${row.rank}</td>
      <td class="contributor">${avatar}<span>${escapeHtml(name)}</span>${inactive}</td>
      <td class="count">${row.count}</td>
    </tr>`;
}

function renderIndexHtml(target: string | null): string {
  if (!target) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Octoladder</title></head>
<body><p>No data yet. Run a sync.</p></body>
</html>
`;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Octoladder</title>
  <meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(target)}">${escapeHtml(target)}</a>…</p>
</body>
</html>
`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
