import { Octokit as RestOctokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { RequestError } from "@octokit/request-error";
import type { EndpointDefaults, RequestError as RequestErrorPayload } from "@octokit/types";
import { isoSeconds } from "./util.js";

export interface TeamMember {
  github_id: number;
  login: string;
  avatar_url: string;
}

export interface MergedPr {
  github_id: number;
  merged_at: Date;
  html_url: string;
  repo_full_name: string;
}

export interface Logger {
  warn(message: string): void;
}

export const NOOP_LOGGER: Logger = { warn: () => {} };

class GithubClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class MissingToken extends GithubClientError {}
export class InvalidLogin extends GithubClientError {}
export class ResultsTruncated extends GithubClientError {}
export class UserNotSearchable extends GithubClientError {}

const LOGIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/;
const SEARCH_RESULT_CAP = 1000;
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_HEADERS = [
  "x-ratelimit-resource",
  "x-ratelimit-remaining",
  "x-ratelimit-limit",
  "x-ratelimit-reset",
  "x-ratelimit-used",
  "retry-after",
] as const;
// Allowlist of request parameter keys safe to surface in logs. Anything
// sensitive (notably `headers` carrying the PAT) must never appear here.
// Path params (org, repo, etc.) are already embedded in `options.url`, so
// only fields that aren't readable from the URL alone are listed here.
const LOGGABLE_PARAM_KEYS = ["q"] as const;

const ThrottledOctokit = RestOctokit.plugin(throttling);
type ThrottledOctokitInstance = InstanceType<typeof ThrottledOctokit>;

export class GithubClient {
  private readonly octokit: ThrottledOctokitInstance;
  private readonly logger: Logger;
  // Per-instance cache of stargazer counts keyed by `owner/repo`. Search
  // results from many authors typically converge on the same handful of
  // popular repos, so caching avoids hammering /repos/{owner}/{repo} for
  // every PR. Lifetime is one CLI run, which matches when star counts are
  // expected to be stable for filtering purposes.
  private readonly stargazersByRepo = new Map<string, number>();

  static fromEnv(logger?: Logger): GithubClient {
    const token = (process.env["GITHUB_TOKEN"] ?? "").trim();
    if (token.length === 0) throw new MissingToken("GITHUB_TOKEN is not set");
    return new GithubClient(token, logger);
  }

  constructor(token: string, logger?: Logger, options: { throttle?: boolean } = {}) {
    this.logger = logger ?? NOOP_LOGGER;
    const handlers = {
      onRateLimit: rateLimitRetryHandler(this.logger, "primary rate limit"),
      onSecondaryRateLimit: rateLimitRetryHandler(this.logger, "secondary rate limit"),
    };
    this.octokit = new ThrottledOctokit({
      auth: token,
      throttle: options.throttle === false ? { ...handlers, enabled: false } : handlers,
      // Suppress @octokit/plugin-request-log's per-attempt URL-encoded error
      // line; throttling-managed retries are reported through onRateLimit /
      // onSecondaryRateLimit, and terminal failures still surface via the
      // hook.error handler installed below.
      log: { debug: () => {}, info: () => {}, warn: console.warn, error: () => {} },
    });
    this.installRequestErrorHook();
  }

  private installRequestErrorHook(): void {
    this.octokit.hook.error("request", (error, options) => {
      if (error instanceof RequestError) {
        const parts: string[] = [`GitHub ${error.status} on ${options.method} ${options.url}`];

        const headers = error.response?.headers ?? {};
        const rateLimitInfo = RATE_LIMIT_HEADERS
          .filter((name) => headers[name] !== undefined)
          .map((name) => `${name}=${headers[name]}`)
          .join(" ");
        if (rateLimitInfo.length > 0) parts.push(rateLimitInfo);

        const params = describeRequestParams(options);
        if (params.length > 0) parts.push(params);

        const message = extractResponseMessage(error.response?.data);
        if (message !== undefined) parts.push(`message="${message}"`);

        this.logger.warn(parts.join(" | "));
      }
      throw error;
    });
  }

  async teamMembers(org: string, slug: string): Promise<TeamMember[]> {
    const members = await this.octokit.paginate(
      "GET /orgs/{org}/teams/{team_slug}/members",
      { org, team_slug: slug, per_page: 100 },
    );
    return members.map((m) => ({
      github_id: m.id,
      login: m.login,
      avatar_url: m.avatar_url,
    }));
  }

  // from is inclusive, to is exclusive (matches Period's half-open interval).
  async mergedPrs(
    login: string,
    opts: { from: Date; to: Date; minStars: number },
  ): Promise<MergedPr[]> {
    if (!LOGIN_PATTERN.test(login)) {
      throw new InvalidLogin(`invalid GitHub login: ${JSON.stringify(login)}`);
    }
    const fromIso = isoSeconds(opts.from);
    const toIso = isoSeconds(new Date(opts.to.getTime() - 1000));
    // GitHub's issue search has no `stars:` qualifier — it's a repository-
    // search-only field, so any `stars:>=N` token gets parsed as free text
    // and silently throws off the result set. The star floor is enforced
    // post-search via `/repos/{owner}/{repo}` lookups below.
    const q = `is:pr is:merged is:public archived:false author:${login} merged:${fromIso}..${toIso}`;

    // Peek the first page to see total_count cheaply; bail if it exceeds the
    // 1000-result search cap before triggering follow-up page fetches.
    let peek;
    try {
      peek = await this.octokit.request("GET /search/issues", {
        q,
        per_page: 100,
        advanced_search: "true",
      });
    } catch (err) {
      // The team membership API can still return a user that the global
      // search index has dropped (rename lag, suspended account, deletion in
      // progress); convert that into a per-user skip instead of failing sync.
      if (isUserNotSearchable(err)) {
        throw new UserNotSearchable(`GitHub search index does not recognize author:${login}`);
      }
      throw err;
    }

    if (peek.data.total_count > SEARCH_RESULT_CAP) {
      throw new ResultsTruncated(
        `GitHub search returned ${peek.data.total_count} results, exceeding the ${SEARCH_RESULT_CAP}-result cap`,
      );
    }

    const items =
      peek.data.total_count > peek.data.items.length
        ? ((await this.octokit.paginate("GET /search/issues", {
            q,
            per_page: 100,
            advanced_search: "true",
          })) as MergedPrItem[])
        : (peek.data.items as MergedPrItem[]);

    const candidates: MergedPr[] = items.map((item) => ({
      github_id: item.id,
      merged_at: new Date(item.pull_request.merged_at),
      html_url: item.html_url,
      repo_full_name: repoFromUrl(item.repository_url),
    }));

    if (opts.minStars <= 0) return candidates;

    const uniqueRepos = [...new Set(candidates.map((c) => c.repo_full_name))];
    await Promise.all(uniqueRepos.map((r) => this.repoStargazerCount(r)));
    return candidates.filter(
      (pr) => this.stargazersByRepo.get(pr.repo_full_name)! >= opts.minStars,
    );
  }

  private async repoStargazerCount(fullName: string): Promise<number> {
    const cached = this.stargazersByRepo.get(fullName);
    if (cached !== undefined) return cached;
    const slash = fullName.indexOf("/");
    const owner = fullName.slice(0, slash);
    const repo = fullName.slice(slash + 1);
    const res = await this.octokit.request("GET /repos/{owner}/{repo}", { owner, repo });
    const count = res.data.stargazers_count;
    this.stargazersByRepo.set(fullName, count);
    return count;
  }
}

interface MergedPrItem {
  id: number;
  html_url: string;
  repository_url: string;
  pull_request: { merged_at: string };
}

function repoFromUrl(url: string): string {
  // https://api.github.com/repos/<owner>/<repo>
  const m = url.match(/\/repos\/([^/]+)\/([^/]+)$/);
  if (!m) throw new Error(`unexpected repository_url shape: ${url}`);
  return `${m[1]}/${m[2]}`;
}

function isUserNotSearchable(error: unknown): error is RequestError {
  if (!(error instanceof RequestError) || error.status !== 422) return false;
  const data = error.response?.data as RequestErrorPayload | undefined;
  return (
    data?.errors?.some(
      (e) => e.resource === "Search" && e.field === "q" && e.code === "invalid",
    ) ?? false
  );
}

type RateLimitKind = "primary rate limit" | "secondary rate limit";

/** @internal exported for unit tests; not part of the public API. */
export function rateLimitRetryHandler(log: Logger, kind: RateLimitKind) {
  return (
    retryAfter: number,
    options: Required<EndpointDefaults>,
    _octokit: unknown,
    retryCount: number,
  ): boolean => {
    const route = `${options.method} ${options.url}`;
    const params = describeRequestParams(options);
    const paramsClause = params.length > 0 ? ` (${params})` : "";
    if (retryCount >= MAX_RATE_LIMIT_RETRIES) {
      log.warn(`${kind} hit ${route}${paramsClause}; gave up after ${retryCount} retries`);
      return false;
    }
    log.warn(
      `${kind} hit ${route}${paramsClause}; retrying in ${retryAfter}s (attempt ${retryCount + 1}/${MAX_RATE_LIMIT_RETRIES})`,
    );
    return true;
  };
}

function describeRequestParams(options: unknown): string {
  if (!options || typeof options !== "object") return "";
  const record = options as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of LOGGABLE_PARAM_KEYS) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      parts.push(`${key}="${value}"`);
    }
  }
  return parts.join(" ");
}

function extractResponseMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}
