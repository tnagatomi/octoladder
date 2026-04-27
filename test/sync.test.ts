import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OctoladderConfig } from "../src/config.js";
import { State } from "../src/state.js";
import { Sync, type Logger } from "../src/sync.js";
import { TeamsConfig } from "../src/teams-config.js";
import { makeClient, makePullRequest, makeUser } from "./helpers.js";

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());
afterAll(() => nock.enableNetConnect());

const NOW = new Date("2026-04-27T17:00:00Z");

function makeSync(
  state: State,
  teamsConfig?: TeamsConfig,
  config?: OctoladderConfig,
  logger?: Logger,
): Sync {
  return new Sync({
    state,
    teamsConfig: teamsConfig ?? defaultTeamsConfig(),
    githubClient: makeClient(),
    config: config ?? new OctoladderConfig({ time_zone: "Asia/Tokyo" }),
    now: NOW,
    logger,
  });
}

function defaultTeamsConfig(): TeamsConfig {
  return new TeamsConfig([
    { org: "acme", team_slug: "platform" },
    { org: "acme", team_slug: "infra" },
  ]);
}

function stubMembers(org: string, slug: string, members: { id: number; login: string; avatar_url: string }[]): void {
  nock("https://api.github.com")
    .get(`/orgs/${org}/teams/${slug}/members`)
    .query({ per_page: 100 })
    .reply(200, members);
}

function stubSearch(login: string, items: SearchItem[] = [], totalCount?: number): void {
  nock("https://api.github.com")
    .get("/search/issues")
    .query((q) => typeof q["q"] === "string" && q["q"].includes(`author:${login}`))
    .reply(200, { total_count: totalCount ?? items.length, items });
}

interface SearchItem {
  id: number;
  html_url: string;
  repository_url: string;
  pull_request: { merged_at: string };
}

function prItem(id: number, repo: string, mergedAt: string): SearchItem {
  return {
    id,
    html_url: `https://github.com/${repo}/pull/${id}`,
    repository_url: `https://api.github.com/repos/${repo}`,
    pull_request: { merged_at: mergedAt },
  };
}

describe("Sync", () => {
  it("empty state backfill adds users and PRs from the anchor", async () => {
    stubMembers("acme", "platform", [
      { id: 1, login: "alice", avatar_url: "https://example.com/a.png" },
    ]);
    stubMembers("acme", "infra", []);
    stubSearch("alice", [prItem(100, "acme/widget", "2026-04-20T09:00:00Z")]);

    const state = new State();
    await makeSync(state).call();

    expect(state.users).toHaveLength(1);
    const alice = state.users[0]!;
    expect(alice.login).toBe("alice");
    expect(alice.active).toBe(true);
    expect(alice.team_keys).toEqual(["acme/platform"]);

    expect(state.pullRequests).toHaveLength(1);
    const pr = state.pullRequests[0]!;
    expect(pr).toMatchObject({
      github_id: 100,
      author_login: "alice",
      merged_at: "2026-04-20T09:00:00Z",
      repo_full_name: "acme/widget",
    });

    expect(state.syncedAt).toEqual(NOW);
    expect(state.backfillAnchor).toEqual(new Date("2025-01-01T00:00:00Z"));
  });

  it("incremental fetch starts one day before the latest recorded PR", async () => {
    stubMembers("acme", "platform", [{ id: 1, login: "alice", avatar_url: "x" }]);
    stubMembers("acme", "infra", []);

    const expectedFromIso = "2026-04-19T09:00:00Z";
    nock("https://api.github.com")
      .get("/search/issues")
      .query((q) => typeof q["q"] === "string" && q["q"].includes(`merged:${expectedFromIso}`))
      .reply(200, { total_count: 0, items: [] });

    const state = new State({
      syncedAt: new Date("2026-04-20T00:00:00Z"),
      backfillAnchor: new Date("2025-01-01T00:00:00Z"),
      users: [makeUser()],
      pullRequests: [makePullRequest()],
    });
    await makeSync(state).call();

    expect(nock.isDone()).toBe(true);
  });

  it("newly added team member is recorded as active", async () => {
    stubMembers("acme", "platform", [
      { id: 1, login: "alice", avatar_url: "x" },
      { id: 2, login: "bob", avatar_url: "y" },
    ]);
    stubMembers("acme", "infra", []);
    stubSearch("alice");
    stubSearch("bob");

    const state = new State({
      syncedAt: new Date("2026-04-20T00:00:00Z"),
      backfillAnchor: new Date("2025-01-01T00:00:00Z"),
      users: [makeUser()],
    });
    await makeSync(state).call();

    const bob = state.users.find((u) => u.login === "bob");
    expect(bob).toBeDefined();
    expect(bob!.active).toBe(true);
    expect(bob!.team_keys).toEqual(["acme/platform"]);
  });

  it("user who left every tracked team is deactivated, PRs preserved", async () => {
    stubMembers("acme", "platform", []);
    stubMembers("acme", "infra", []);

    const state = new State({
      syncedAt: new Date("2026-04-20T00:00:00Z"),
      backfillAnchor: new Date("2025-01-01T00:00:00Z"),
      users: [makeUser()],
      pullRequests: [makePullRequest()],
    });
    await makeSync(state).call();

    const alice = state.users.find((u) => u.login === "alice")!;
    expect(alice.active).toBe(false);
    expect(alice.team_keys).toEqual([]);
    expect(state.pullRequests).toHaveLength(1);
  });

  it("removing a team from config stops fetching for users only in that team", async () => {
    stubMembers("acme", "platform", []);

    const teamsConfig = new TeamsConfig([{ org: "acme", team_slug: "platform" }]);
    const state = new State({
      syncedAt: new Date("2026-04-20T00:00:00Z"),
      backfillAnchor: new Date("2025-01-01T00:00:00Z"),
      users: [makeUser({ team_keys: ["acme/infra"] })],
    });
    await makeSync(state, teamsConfig).call();

    expect(state.users[0]!.active).toBe(false);
    expect(state.teams).toEqual([{ org: "acme", slug: "platform" }]);
  });

  it("user belonging to multiple tracked teams gets sorted team_keys", async () => {
    stubMembers("acme", "platform", [{ id: 1, login: "alice", avatar_url: "x" }]);
    stubMembers("acme", "infra", [{ id: 1, login: "alice", avatar_url: "x" }]);
    stubSearch("alice");

    const state = new State();
    await makeSync(state).call();

    expect(state.users[0]!.team_keys).toEqual(["acme/infra", "acme/platform"]);
  });

  it("forwards configured min_stars to the search query", async () => {
    stubMembers("acme", "platform", [{ id: 1, login: "alice", avatar_url: "x" }]);
    stubMembers("acme", "infra", []);

    nock("https://api.github.com")
      .get("/search/issues")
      .query((q) => typeof q["q"] === "string" && q["q"].includes("stars:>=50"))
      .reply(200, { total_count: 0, items: [] });

    const state = new State();
    const config = new OctoladderConfig({ time_zone: "Asia/Tokyo", min_stars: 50 });
    await makeSync(state, undefined, config).call();

    expect(nock.isDone()).toBe(true);
  });

  it("user exceeding the search cap is skipped with a warning, others still processed", async () => {
    stubMembers("acme", "platform", [
      { id: 1, login: "alice", avatar_url: "x" },
      { id: 2, login: "bob", avatar_url: "y" },
    ]);
    stubMembers("acme", "infra", []);
    stubSearch("alice", [], 1234);
    stubSearch("bob", [prItem(200, "acme/widget", "2026-04-20T09:00:00Z")]);

    const warn = vi.fn();
    const state = new State();
    await makeSync(state, undefined, undefined, { warn }).call();

    expect(state.pullRequests).toHaveLength(1);
    expect(state.pullRequests[0]!.author_login).toBe("bob");
    expect(state.syncedAt).toEqual(NOW);
    expect(state.backfillAnchor).toEqual(new Date("2025-01-01T00:00:00Z"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^Skipping alice: /);
    expect(warn.mock.calls[0]![0]).toContain("1234");
  });

  it("non-truncation errors propagate and abort the sync", async () => {
    stubMembers("acme", "platform", [{ id: 1, login: "alice", avatar_url: "x" }]);
    stubMembers("acme", "infra", []);
    nock("https://api.github.com")
      .get("/search/issues")
      .query(true)
      .reply(500, { message: "boom" });

    const warn = vi.fn();
    const state = new State();
    await expect(makeSync(state, undefined, undefined, { warn }).call()).rejects.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("PRs returned again on subsequent sync are deduped by github_id", async () => {
    stubMembers("acme", "platform", [{ id: 1, login: "alice", avatar_url: "x" }]);
    stubMembers("acme", "infra", []);

    nock("https://api.github.com")
      .get("/search/issues")
      .query(true)
      .reply(200, {
        total_count: 1,
        items: [prItem(100, "acme/widget", "2026-04-20T09:00:00Z")],
      });

    const state = new State({
      syncedAt: new Date("2026-04-20T00:00:00Z"),
      backfillAnchor: new Date("2025-01-01T00:00:00Z"),
      users: [makeUser()],
      pullRequests: [makePullRequest()],
    });
    await makeSync(state).call();

    expect(state.pullRequests).toHaveLength(1);
  });
});
