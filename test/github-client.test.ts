import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  GithubClient,
  InvalidLogin,
  MissingToken,
  rateLimitRetryHandler,
  ResultsTruncated,
  UserNotSearchable,
} from "../src/github-client.js";
import { makeClient } from "./helpers.js";

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

    const client = makeClient();
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

    const client = makeClient();
    const members = await client.teamMembers("acme", "platform");
    expect(members.map((m) => m.login)).toEqual(["a", "b"]);
  });

  it("propagates 401 errors", async () => {
    nock("https://api.github.com").get(/.*/).reply(401, {});
    const client = makeClient("bad-token");
    const error = await client.teamMembers("acme", "platform").catch((e) => e);
    expect(error).toMatchObject({ status: 401 });
  });

  it("propagates 404 errors", async () => {
    nock("https://api.github.com").get(/.*/).reply(404, {});
    const client = makeClient();
    const error = await client.teamMembers("acme", "missing").catch((e) => e);
    expect(error).toMatchObject({ status: 404 });
  });
});

describe("GithubClient.mergedPrs", () => {
  it("builds a half-open search range and normalizes results", async () => {
    const expectedQ =
      "is:pr is:merged is:public author:octocat merged:2026-04-06T00:00:00Z..2026-04-12T23:59:59Z stars:>=20";

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

    const client = makeClient();
    const prs = await client.mergedPrs("octocat", {
      from: new Date("2026-04-06T00:00:00Z"),
      to: new Date("2026-04-13T00:00:00Z"),
      minStars: 20,
    });
    expect(prs).toHaveLength(1);
    expect(prs[0]).toEqual({
      github_id: 999,
      merged_at: new Date("2026-04-07T10:15:30Z"),
      html_url: "https://github.com/acme/widget/pull/12",
      repo_full_name: "acme/widget",
    });
  });

  it("forwards a custom minStars to the search query", async () => {
    const expectedQ =
      "is:pr is:merged is:public author:octocat merged:2026-04-06T00:00:00Z..2026-04-12T23:59:59Z stars:>=100";

    nock("https://api.github.com")
      .get("/search/issues")
      .query((q) => q["q"] === expectedQ)
      .reply(200, { total_count: 0, items: [] });

    const client = makeClient();
    await client.mergedPrs("octocat", {
      from: new Date("2026-04-06T00:00:00Z"),
      to: new Date("2026-04-13T00:00:00Z"),
      minStars: 100,
    });
    expect(nock.isDone()).toBe(true);
  });

  it("omits the stars qualifier when minStars is 0", async () => {
    const expectedQ =
      "is:pr is:merged is:public author:octocat merged:2026-04-06T00:00:00Z..2026-04-12T23:59:59Z";

    nock("https://api.github.com")
      .get("/search/issues")
      .query((q) => q["q"] === expectedQ)
      .reply(200, { total_count: 0, items: [] });

    const client = makeClient();
    await client.mergedPrs("octocat", {
      from: new Date("2026-04-06T00:00:00Z"),
      to: new Date("2026-04-13T00:00:00Z"),
      minStars: 0,
    });
    expect(nock.isDone()).toBe(true);
  });

  it("returns an empty list when search has no hits", async () => {
    nock("https://api.github.com")
      .get("/search/issues")
      .query(true)
      .reply(200, { total_count: 0, items: [] });

    const client = makeClient();
    const prs = await client.mergedPrs("octocat", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-02-01T00:00:00Z"),
      minStars: 20,
    });
    expect(prs).toEqual([]);
  });

  it("rejects logins that GitHub would never issue", async () => {
    const client = makeClient();
    for (const bad of ["", "bad login", "foo OR is:public", "-leading-hyphen", "a".repeat(40)]) {
      await expect(
        client.mergedPrs(bad, {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-02-01T00:00:00Z"),
          minStars: 20,
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

    const client = makeClient();
    const error = await client
      .mergedPrs("octocat", {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2027-01-01T00:00:00Z"),
        minStars: 20,
      })
      .then(() => null)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ResultsTruncated);
    expect((error as Error).message).toMatch(/1001/);
  });

  it("raises UserNotSearchable when GitHub returns 422 Search/q/invalid", async () => {
    nock("https://api.github.com")
      .get("/search/issues")
      .query(true)
      .reply(422, {
        message: "Validation Failed",
        errors: [
          {
            message:
              "The listed users cannot be searched either because the users do not exist or you do not have permission to view the users.",
            resource: "Search",
            field: "q",
            code: "invalid",
          },
        ],
      });

    const client = makeClient();
    const error = await client
      .mergedPrs("ghost", {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-02-01T00:00:00Z"),
        minStars: 20,
      })
      .then(() => null)
      .catch((e) => e);
    expect(error).toBeInstanceOf(UserNotSearchable);
    expect((error as Error).message).toMatch(/author:ghost/);
  });

  it("propagates 422 errors that are not Search/q/invalid as the original RequestError", async () => {
    nock("https://api.github.com")
      .get("/search/issues")
      .query(true)
      .reply(422, {
        message: "Validation Failed",
        errors: [{ resource: "Search", field: "q", code: "unrelated" }],
      });

    const client = makeClient();
    const error = await client
      .mergedPrs("octocat", {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-02-01T00:00:00Z"),
        minStars: 20,
      })
      .then(() => null)
      .catch((e) => e);
    expect(error).not.toBeInstanceOf(UserNotSearchable);
    expect(error).toMatchObject({ status: 422 });
  });

  it("authenticates with the supplied token", async () => {
    nock("https://api.github.com", {
      reqheaders: { authorization: "token test-token" },
    })
      .get("/search/issues")
      .query(true)
      .reply(200, { total_count: 0, items: [] });

    const client = makeClient();
    await client.mergedPrs("octocat", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-02-01T00:00:00Z"),
      minStars: 20,
    });
    expect(nock.isDone()).toBe(true);
  });
});

describe("GithubClient request error logging", () => {
  it("logs status, route, rate-limit headers, search query, and message on 403", async () => {
    nock("https://api.github.com")
      .get("/search/issues")
      .query(true)
      .reply(
        403,
        { message: "API rate limit exceeded" },
        {
          "x-ratelimit-resource": "search",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-limit": "30",
          "x-ratelimit-reset": "1700000000",
          "retry-after": "42",
        },
      );

    const warnings: string[] = [];
    const client = makeClient("test-token", { warn: (msg) => warnings.push(msg) });
    await client
      .mergedPrs("octocat", {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-02-01T00:00:00Z"),
        minStars: 20,
      })
      .catch(() => undefined);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/GitHub 403 on GET \/search\/issues/);
    expect(warnings[0]).toMatch(/x-ratelimit-resource=search/);
    expect(warnings[0]).toMatch(/x-ratelimit-remaining=0/);
    expect(warnings[0]).toMatch(/retry-after=42/);
    expect(warnings[0]).toMatch(/q="[^"]*author:octocat[^"]*"/);
    expect(warnings[0]).toMatch(/message="API rate limit exceeded"/);
  });

  it("logs status, route, params, and message on 422 even without rate-limit headers", async () => {
    nock("https://api.github.com")
      .get("/search/issues")
      .query(true)
      .reply(422, {
        message:
          "Validation Failed: The listed users cannot be searched either because the users do not exist or you do not have permission to view the users.",
      });

    const warnings: string[] = [];
    const client = makeClient("test-token", { warn: (msg) => warnings.push(msg) });
    await client
      .mergedPrs("ghost", {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-02-01T00:00:00Z"),
        minStars: 20,
      })
      .catch(() => undefined);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/GitHub 422 on GET \/search\/issues/);
    expect(warnings[0]).toMatch(/q="[^"]*author:ghost[^"]*"/);
    expect(warnings[0]).toMatch(/message="Validation Failed:/);
    expect(warnings[0]).not.toMatch(/x-ratelimit/);
  });

  it("logs status, resolved URL, and message on team-member 404", async () => {
    nock("https://api.github.com").get(/.*/).reply(404, { message: "Not Found" });

    const warnings: string[] = [];
    const client = makeClient("test-token", { warn: (msg) => warnings.push(msg) });
    await client.teamMembers("acme", "missing").catch(() => undefined);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/GitHub 404 on GET/);
    expect(warnings[0]).toMatch(/\/orgs\/acme\/teams\/missing\/members/);
    expect(warnings[0]).toMatch(/message="Not Found"/);
  });

  it("does not include sensitive headers like authorization in the log line", async () => {
    nock("https://api.github.com").get(/.*/).reply(500, { message: "boom" });

    const warnings: string[] = [];
    const client = makeClient("super-secret-token", { warn: (msg) => warnings.push(msg) });
    await client.teamMembers("acme", "platform").catch(() => undefined);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toMatch(/super-secret-token/);
    expect(warnings[0]).not.toMatch(/authorization/i);
  });
});

describe("rateLimitRetryHandler", () => {
  const fakeOptions = { method: "GET", url: "/search/issues" } as Parameters<
    ReturnType<typeof rateLimitRetryHandler>
  >[1];

  it("returns true and logs while under the retry budget", () => {
    const warnings: string[] = [];
    const handler = rateLimitRetryHandler({ warn: (m) => warnings.push(m) }, "primary rate limit");

    expect(handler(5, fakeOptions, null, 0)).toBe(true);
    expect(handler(5, fakeOptions, null, 2)).toBe(true);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/primary rate limit/);
    expect(warnings[0]).toMatch(/retrying in 5s/);
    expect(warnings[0]).toMatch(/attempt 1\/3/);
    expect(warnings[1]).toMatch(/attempt 3\/3/);
  });

  it("returns false and logs once the retry budget is exhausted", () => {
    const warnings: string[] = [];
    const handler = rateLimitRetryHandler(
      { warn: (m) => warnings.push(m) },
      "secondary rate limit",
    );

    expect(handler(10, fakeOptions, null, 3)).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/secondary rate limit/);
    expect(warnings[0]).toMatch(/gave up after 3 retries/);
  });

  it("includes whitelisted request params (search query) in the log line", () => {
    const warnings: string[] = [];
    const handler = rateLimitRetryHandler({ warn: (m) => warnings.push(m) }, "primary rate limit");
    const optionsWithQuery = {
      method: "GET",
      url: "/search/issues",
      q: "is:pr is:merged author:mktakuya",
    } as unknown as Parameters<ReturnType<typeof rateLimitRetryHandler>>[1];

    handler(2, optionsWithQuery, null, 0);

    expect(warnings[0]).toMatch(/q="is:pr is:merged author:mktakuya"/);
  });
});
