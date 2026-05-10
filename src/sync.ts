import type { OctoladderConfig } from "./config.js";
import {
  NOOP_LOGGER,
  ResultsTruncated,
  UserNotSearchable,
  type GithubClient,
  type Logger,
} from "./github-client.js";
import type { State, StatePullRequest, StateUser } from "./state.js";
import type { TeamsConfig } from "./teams-config.js";
import { isoSeconds } from "./util.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface MembershipBucket {
  login: string;
  avatar_url: string;
  team_keys: string[];
}

export type { Logger } from "./github-client.js";

export class Sync {
  private readonly state: State;
  private readonly teamsConfig: TeamsConfig;
  private readonly client: GithubClient;
  private readonly config: OctoladderConfig;
  private readonly now: Date;
  private readonly logger: Logger;

  constructor(opts: {
    state: State;
    teamsConfig: TeamsConfig;
    githubClient: GithubClient;
    config: OctoladderConfig;
    now?: Date;
    logger?: Logger;
  }) {
    this.state = opts.state;
    this.teamsConfig = opts.teamsConfig;
    this.client = opts.githubClient;
    this.config = opts.config;
    this.now = opts.now ?? new Date();
    this.logger = opts.logger ?? NOOP_LOGGER;
  }

  async call(): Promise<State> {
    this.reconcileTeams();
    const membership = await this.fetchTeamMembers();
    this.reconcileUsers(membership);
    await this.fetchPullRequests();
    this.state.syncedAt = this.now;
    this.state.backfillAnchor ??= this.config.backfillAnchor(this.now);
    return this.state;
  }

  private reconcileTeams(): void {
    this.state.teams.length = 0;
    for (const entry of this.teamsConfig.entries) {
      this.state.teams.push({ org: entry.org, slug: entry.slug });
    }
  }

  private async fetchTeamMembers(): Promise<Map<number, MembershipBucket>> {
    const membership = new Map<number, MembershipBucket>();
    for (const entry of this.teamsConfig.entries) {
      const teamKey = `${entry.org}/${entry.slug}`;
      const members = await this.client.teamMembers(entry.org, entry.slug);
      for (const m of members) {
        const bucket = membership.get(m.github_id) ?? {
          login: m.login,
          avatar_url: m.avatar_url,
          team_keys: [],
        };
        if (!bucket.team_keys.includes(teamKey)) bucket.team_keys.push(teamKey);
        membership.set(m.github_id, bucket);
      }
    }
    return membership;
  }

  private reconcileUsers(membership: Map<number, MembershipBucket>): void {
    const byId = new Map<number, StateUser>(this.state.users.map((u) => [u.github_id, u]));

    for (const [ghId, attrs] of membership) {
      let user = byId.get(ghId);
      if (!user) {
        user = { github_id: ghId, login: "", team_keys: [], active: false };
        this.state.users.push(user);
      }
      user.login = attrs.login;
      user.avatar_url = attrs.avatar_url;
      user.team_keys = [...attrs.team_keys].sort();
      user.active = true;
    }

    for (const user of this.state.users) {
      if (membership.has(user.github_id)) continue;
      user.active = false;
      user.team_keys = [];
    }
  }

  private async fetchPullRequests(): Promise<void> {
    const latestByLogin = this.indexLatestMergedAt();
    const seenIds = new Set(this.state.pullRequests.map((p) => p.github_id));

    for (const user of this.state.users) {
      if (!user.active) continue;
      const from = this.fetchWindowStart(latestByLogin.get(user.login));
      let prs;
      try {
        prs = await this.client.mergedPrs(user.login, {
          from,
          to: this.now,
          minStars: this.config.minStars,
        });
      } catch (err) {
        if (err instanceof ResultsTruncated || err instanceof UserNotSearchable) {
          this.logger.warn(`Skipping ${user.login}: ${err.message}`);
          continue;
        }
        throw err;
      }
      for (const pr of prs) {
        if (seenIds.has(pr.github_id)) continue;
        const record: StatePullRequest = {
          github_id: pr.github_id,
          author_login: user.login,
          merged_at: isoSeconds(pr.merged_at),
          html_url: pr.html_url,
          repo_full_name: pr.repo_full_name,
          title: pr.title,
        };
        this.state.pullRequests.push(record);
        seenIds.add(pr.github_id);
      }
    }
  }

  private indexLatestMergedAt(): Map<string, Date> {
    const index = new Map<string, Date>();
    for (const pr of this.state.pullRequests) {
      const t = new Date(pr.merged_at);
      const current = index.get(pr.author_login);
      if (!current || t > current) index.set(pr.author_login, t);
    }
    return index;
  }

  private fetchWindowStart(latest: Date | undefined): Date {
    if (latest) return new Date(latest.getTime() - ONE_DAY_MS);
    const anchor = this.state.backfillAnchor ?? this.config.backfillAnchor(this.now);
    return anchor;
  }
}
