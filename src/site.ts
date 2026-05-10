import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatInTimeZone } from "date-fns-tz";
import { Period, PERIOD_TYPES, type PeriodType } from "./period.js";
import { Ranking, type RankingEntry } from "./ranking.js";
import { computeRankDeltas, type RankDelta } from "./ranking-delta.js";
import { SITE_STYLE_CSS } from "./site-style.js";
import type { State, StateUser } from "./state.js";

interface ParsedPr {
  author: string;
  mergedAt: Date;
  htmlUrl: string;
  repoFullName: string;
  title?: string;
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
      htmlUrl: pr.html_url,
      repoFullName: pr.repo_full_name,
      title: pr.title,
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
    const { ranking, detailJobs } = this.rankingFor(period);
    const prevRanking = prev ? this.rankingFor(prev).ranking : null;
    const deltas = computeRankDeltas(ranking, prevRanking, (u) => u.login);

    const body = renderPeriodBody({ period, ranking, deltas, prev, next, latest });
    const html = renderLayout({ title: period.label, assetPrefix: "../", body });
    this.writeFile(join(period.type, `${period.param}.html`), html);

    for (const { user, prs } of detailJobs) {
      this.renderUserDetail(period, user, prs);
    }
  }

  private rankingFor(period: Period): {
    ranking: Ranking<RowUser>;
    detailJobs: Array<{ user: RowUser; prs: ParsedPr[] }>;
  } {
    const prsByLogin = this.prsByLoginFor(period);
    const entries: RankingEntry<RowUser>[] = [];
    const detailJobs: Array<{ user: RowUser; prs: ParsedPr[] }> = [];
    for (const [login, prs] of prsByLogin) {
      const user = this.usersByLogin.get(login) ?? { login };
      entries.push({ user, count: prs.length });
      detailJobs.push({ user, prs });
    }
    return { ranking: new Ranking(entries), detailJobs };
  }

  private renderUserDetail(period: Period, user: RowUser, prs: ParsedPr[]): void {
    const body = renderUserDetailBody({ period, user, prs, timeZone: this.timeZone });
    const login = (user as { login: string }).login;
    const title = `${login} · ${period.label}`;
    const html = renderLayout({ title, assetPrefix: "../../", body });
    this.writeFile(join(period.type, period.param, `${login}.html`), html);
  }

  private renderIndex(latestWeekly: Period | null): void {
    const target = latestWeekly ? `weekly/${latestWeekly.param}.html` : null;
    this.writeFile("index.html", renderIndexHtml(target));
  }

  private prsByLoginFor(period: Period): Map<string, ParsedPr[]> {
    const byLogin = new Map<string, ParsedPr[]>();
    for (const pr of this.parsedPrs) {
      if (!period.contains(pr.mergedAt)) continue;
      const list = byLogin.get(pr.author);
      if (list) list.push(pr);
      else byLogin.set(pr.author, [pr]);
    }
    return byLogin;
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
  deltas: Map<string, RankDelta>;
  prev: Period | null;
  next: Period | null;
  latest: Record<PeriodType, Period | null>;
}): string {
  const { period, ranking, deltas, prev, next, latest } = opts;
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
${ranking.rows.map((row) => rankingRow(row, deltas.get(row.user.login) ?? null, period)).join("\n")}
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

function renderUserDetailBody(opts: {
  period: Period;
  user: RowUser;
  prs: ParsedPr[];
  timeZone: string;
}): string {
  const { period, user, prs, timeZone } = opts;
  const partial = user as Partial<StateUser> & { login: string };
  const avatar = partial.avatar_url
    ? `<img src="${escapeHtml(partial.avatar_url)}" alt="" width="48" height="48">`
    : "";
  const profileHref = `https://github.com/${encodeURIComponent(partial.login)}`;
  const repoCount = new Set(prs.map((pr) => pr.repoFullName)).size;
  const summary = `${prs.length} merged ${pluralize("PR", prs.length)} across ${repoCount} ${pluralize("repository", repoCount, "repositories")}`;

  return `<header class="profile">
  <a class="back" href="../${escapeHtml(period.param)}.html">← Back to ${escapeHtml(period.label)}</a>
  <div class="profile-card">
    ${avatar}
    <div>
      <h1><a href="${escapeHtml(profileHref)}" rel="noopener noreferrer">${escapeHtml(partial.login)}</a></h1>
      <p class="summary">${escapeHtml(summary)}</p>
    </div>
  </div>
</header>

${renderRepoGroups(prs, timeZone)}`;
}

function renderRepoGroups(prs: ParsedPr[], timeZone: string): string {
  const byRepo = new Map<string, ParsedPr[]>();
  for (const pr of prs) {
    const list = byRepo.get(pr.repoFullName);
    if (list) list.push(pr);
    else byRepo.set(pr.repoFullName, [pr]);
  }
  const repos = [...byRepo.keys()].sort();
  return repos
    .map((repo) => {
      const repoHref = `https://github.com/${repo
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
      const items = byRepo
        .get(repo)!
        .slice()
        .sort((a, b) => b.mergedAt.getTime() - a.mergedAt.getTime())
        .map((pr) => renderPrItem(pr, timeZone))
        .join("\n");
      return `<section class="repo-group">
  <h2><a href="${escapeHtml(repoHref)}" rel="noopener noreferrer">${escapeHtml(repo)}</a></h2>
  <ul class="prs">
${items}
  </ul>
</section>`;
    })
    .join("\n");
}

function renderPrItem(pr: ParsedPr, timeZone: string): string {
  const numberLabel = `#${extractPrNumber(pr.htmlUrl)}`;
  const linkText = pr.title ? `${numberLabel} ${pr.title}` : numberLabel;
  const isoDateTime = pr.mergedAt.toISOString();
  const localized = formatInTimeZone(pr.mergedAt, timeZone, "yyyy-MM-dd HH:mm");
  return `    <li>
      <a href="${escapeHtml(pr.htmlUrl)}">${escapeHtml(linkText)}</a>
      <time datetime="${escapeHtml(isoDateTime)}">${escapeHtml(localized)}</time>
    </li>`;
}

function extractPrNumber(htmlUrl: string): string {
  const m = htmlUrl.match(/\/pull\/(\d+)(?:[/?#]|$)/);
  if (!m) throw new Error(`unexpected PR html_url shape: ${htmlUrl}`);
  return m[1]!;
}

function pluralize(noun: string, count: number, plural = `${noun}s`): string {
  return count === 1 ? noun : plural;
}

function rankingRow(
  row: { rank: number; user: RowUser; count: number },
  delta: RankDelta,
  period: Period,
): string {
  const user = row.user as Partial<StateUser> & { login: string };
  const avatar = user.avatar_url
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="" width="24" height="24">`
    : "";
  const name = (user as { name?: string }).name ?? user.login;
  const detailHref = `${period.param}/${user.login}.html`;
  const inactive =
    user.active === false
      ? `<span class="inactive" title="No longer in any tracked team">(inactive)</span>`
      : "";
  return `    <tr>
      <td class="rank"><span class="rank-num">${row.rank}</span>${renderRankDelta(delta)}</td>
      <td class="contributor">${avatar}<a href="${escapeHtml(detailHref)}">${escapeHtml(name)}</a>${inactive}</td>
      <td class="count">${row.count}</td>
    </tr>`;
}

function renderRankDelta(delta: RankDelta): string {
  if (delta === null) return ` <span class="rank-delta-none" title="No comparison available">—</span>`;
  if (delta === 0) return "";
  if (delta > 0) return ` <span class="rank-delta-up" title="Up ${delta} from previous period">↑</span>`;
  return ` <span class="rank-delta-down" title="Down ${-delta} from previous period">↓</span>`;
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
