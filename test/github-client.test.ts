import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GithubClient, InvalidLogin, MissingToken, ResultsTruncated } from "../src/github-client.js";

beforeAll(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  vi.unstubAllEnvs();
});

afterAll(() => {
  nock.enableNetConnect();
});

describe("GithubClient.fromEnv", () => {
  it("builds a client when GITHUB_TOKEN is set", () => {
    vi.stubEnv("GITHUB_TOKEN", "abc");
    expect(GithubClient.fromEnv()).toBeInstanceOf(GithubClient);
  });

  it("raises when GITHUB_TOKEN is missing", () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    expect(() => GithubClient.fromEnv()).toThrow(MissingToken);
  });

  it("raises when GITHUB_TOKEN is blank", () => {
    vi.stubEnv("GITHUB_TOKEN", "  ");
    expect(() => GithubClient.fromEnv()).toThrow(MissingToken);
  });
});

describe("GithubClient.teamMembers", () => {
  it("returns normalized objects", async () => {
    nock("https://api.github.com")
      .get("/orgs/acme/teams/platform/members")
      .query({ per_page: 100 })
      .reply(200, [
        { id: 42, login: "octocat", avatar_url: "https://example.com/a.png" },
        { id: 101, login: "hubot", avatar_url: "https://example.com/h.png" },
      ]);

    const client = new GithubClient("test-token");
    const members = await client.teamMembers("acme", "platform");
    expect(members).toEqual([
      { github_id: 42, login: "octocat", avatar_url: "https://example.com/a.png" },
      { github_id: 101, login: "hubot", avatar_url: "https://example.com/h.png" },
    ]);
  });

  it("follows pagination via Link header", async () => {
    nock("https://api.github.com")
      .get("/orgs/acme/teams/platform/members")
      .query({ per_page: 100 })
      .reply(200, [{ id: 1, login: "a", avatar_url: "x" }], {
        Link: '<https://api.github.com/orgs/acme/teams/platform/members?page=2&per_page=100>; rel="next"',
      })
      .get("/orgs/acme/teams/platform/members")
      .query({ page: "2", per_page: "100" })
      .reply(200, [{ id: 2, login: "b", avatar_url: "y" }]);

    const client = new GithubClient("test-token");
    const members = await client.teamMembers("acme", "platform");
    expect(members.map((m) => m.login)).toEqual(["a", "b"]);
  });

  it("propagates 401 errors", async () => {
    nock("https://api.github.com").get(/.*/).reply(401, {});
    const client = new GithubClient("bad-token");
    const error = await client.teamMembers("acme", "platform").catch((e) => e);
    expect(error).toMatchObject({ status: 401 });
  });

  it("propagates 404 errors", async () => {
    nock("https://api.github.com").get(/.*/).reply(404, {});
    const client = new GithubClient("test-token");
    const error = await client.teamMembers("acme", "missing").catch((e) => e);
    expect(error).toMatchObject({ status: 404 });
  });
});

describe("GithubClient.mergedPrs", () => {
  it("builds a half-open search range and normalizes results", async () => {
    const expectedQ =
      "is:pr is:merged is:public author:octocat merged:2026-04-06T00:00:00Z..2026-04-12T23:59:59Z";

    nock("https://api.github.com")
      .get("/search/issues")
      .query((q) => q["q"] === expectedQ)
      .reply(200, {
        total_count: 1,
        items: [
          {
            id: 999,
            html_url: "https://github.com/acme/widget/pull/12",
            repository_url: "https://api.github.com/repos/acme/widget",
            pull_request: { merged_at: "2026-04-07T10:15:30Z" },
          },
        ],
      });

    const client = new GithubClient("test-token");
    const prs = await client.mergedPrs("octocat", {
      from: new Date("2026-04-06T00:00:00Z"),
      to: new Date("2026-04-13T00:00:00Z"),
    });
    expect(prs).toHaveLength(1);
    expect(prs[0]).toEqual({
      github_id: 999,
      merged_at: new Date("2026-04-07T10:15:30Z"),
      html_url: "https://github.com/acme/widget/pull/12",
      repo_full_name: "acme/widget",
    });
  });

  it("returns an empty list when search has no hits", async () => {
    nock("https://api.github.com")
      .get("/search/issues")
      .query(true)
      .reply(200, { total_count: 0, items: [] });

    const client = new GithubClient("test-token");
    const prs = await client.mergedPrs("octocat", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-02-01T00:00:00Z"),
    });
    expect(prs).toEqual([]);
  });

  it("rejects logins that GitHub would never issue", async () => {
    const client = new GithubClient("test-token");
    for (const bad of ["", "bad login", "foo OR is:public", "-leading-hyphen", "a".repeat(40)]) {
      await expect(
        client.mergedPrs(bad, {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-02-01T00:00:00Z"),
        }),
      ).rejects.toThrow(InvalidLogin);
    }
    expect(nock.isDone()).toBe(true);
  });

  it("raises ResultsTruncated when GitHub reports more than 1000 hits", async () => {
    nock("https://api.github.com")
      .get("/search/issues")
      .query(true)
      .reply(200, { total_count: 1001, items: [] });

    const client = new GithubClient("test-token");
    const error = await client
      .mergedPrs("octocat", {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2027-01-01T00:00:00Z"),
      })
      .then(() => null)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ResultsTruncated);
    expect((error as Error).message).toMatch(/1001/);
  });

  it("authenticates with the supplied token", async () => {
    nock("https://api.github.com", {
      reqheaders: { authorization: "token test-token" },
    })
      .get("/search/issues")
      .query(true)
      .reply(200, { total_count: 0, items: [] });

    const client = new GithubClient("test-token");
    await client.mergedPrs("octocat", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-02-01T00:00:00Z"),
    });
    expect(nock.isDone()).toBe(true);
  });
});
