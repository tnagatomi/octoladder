import { Octokit } from "@octokit/rest";
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

export class GithubClient {
  private readonly octokit: Octokit;

  static fromEnv(): GithubClient {
    const token = (process.env["GITHUB_TOKEN"] ?? "").trim();
    if (token.length === 0) throw new MissingToken("GITHUB_TOKEN is not set");
    return new GithubClient(token);
  }

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
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
  async mergedPrs(login: string, opts: { from: Date; to: Date }): Promise<MergedPr[]> {
    if (!LOGIN_PATTERN.test(login)) {
      throw new InvalidLogin(`invalid GitHub login: ${JSON.stringify(login)}`);
    }
    const fromIso = isoSeconds(opts.from);
    const toIso = isoSeconds(new Date(opts.to.getTime() - 1000));
    const q = `is:pr is:merged is:public author:${login} merged:${fromIso}..${toIso}`;

    // Peek the first page to see total_count cheaply; bail if it exceeds the
    // 1000-result search cap before triggering follow-up page fetches.
    const peek = await this.octokit.request("GET /search/issues", {
      q,
      per_page: 100,
      advanced_search: "true",
    });

    if (peek.data.total_count > SEARCH_RESULT_CAP) {
      throw new ResultsTruncated(
        `GitHub search returned ${peek.data.total_count} results for ${login}, exceeding the ${SEARCH_RESULT_CAP}-result cap`,
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
