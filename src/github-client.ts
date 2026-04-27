import { Octokit as RestOctokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { RequestError } from "@octokit/request-error";
import type { EndpointDefaults } from "@octokit/types";
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

const ThrottledOctokit = RestOctokit.plugin(throttling);
type ThrottledOctokitInstance = InstanceType<typeof ThrottledOctokit>;

export class GithubClient {
  private readonly octokit: ThrottledOctokitInstance;
  private readonly logger: Logger;

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
    });
    this.installRateLimitHook();
  }

  private installRateLimitHook(): void {
    this.octokit.hook.error("request", (error, options) => {
      if (error instanceof RequestError && (error.status === 403 || error.status === 429)) {
        const headers = error.response?.headers ?? {};
        const summary = RATE_LIMIT_HEADERS
          .filter((name) => headers[name] !== undefined)
          .map((name) => `${name}=${headers[name]}`)
          .join(" ");
        if (summary.length > 0) {
          this.logger.warn(
            `GitHub ${error.status} on ${options.method} ${options.url}: ${summary}`,
          );
        }
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
    const stars = opts.minStars > 0 ? ` stars:>=${opts.minStars}` : "";
    const q = `is:pr is:merged is:public author:${login} merged:${fromIso}..${toIso}${stars}`;

    // Peek the first page to see total_count cheaply; bail if it exceeds the
    // 1000-result search cap before triggering follow-up page fetches.
    const peek = await this.octokit.request("GET /search/issues", {
      q,
      per_page: 100,
      advanced_search: "true",
    });

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

    return items.map((item) => ({
      github_id: item.id,
      merged_at: new Date(item.pull_request.merged_at),
      html_url: item.html_url,
      repo_full_name: repoFromUrl(item.repository_url),
    }));
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
    if (retryCount >= MAX_RATE_LIMIT_RETRIES) {
      log.warn(`${kind} hit ${route}; gave up after ${retryCount} retries`);
      return false;
    }
    log.warn(
      `${kind} hit ${route}; retrying in ${retryAfter}s (attempt ${retryCount + 1}/${MAX_RATE_LIMIT_RETRIES})`,
    );
    return true;
  };
}
