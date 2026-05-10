import { fromZonedTime } from "date-fns-tz";
import { GithubClient, type Logger } from "../src/github-client.js";
import type { StatePullRequest, StateUser } from "../src/state.js";

export const TZ = "Asia/Tokyo";

export function makeClient(token = "test-token", logger?: Logger): GithubClient {
  return new GithubClient(token, logger, { throttle: false });
}

export function tokyo(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return fromZonedTime(new Date(year, month - 1, day, hour, minute, second), TZ);
}

export function makeUser(overrides: Partial<StateUser> = {}): StateUser {
  return {
    github_id: 1,
    login: "alice",
    avatar_url: "x",
    team_keys: ["acme/platform"],
    active: true,
    ...overrides,
  };
}

export function makePullRequest(overrides: Partial<StatePullRequest> = {}): StatePullRequest {
  return {
    github_id: 100,
    author_login: "alice",
    merged_at: "2026-04-20T09:00:00Z",
    html_url: "https://github.com/acme/widget/pull/100",
    repo_full_name: "acme/widget",
    ...overrides,
  };
}
