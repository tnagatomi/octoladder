import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Period } from "../src/period.js";
import { Site } from "../src/site.js";
import { State, type StatePullRequest, type StateUser } from "../src/state.js";
import { TZ, makePullRequest, makeUser, tokyo } from "./helpers.js";

const NOW = tokyo(2026, 4, 27, 12);

function siteFor(state: State, outputDir: string): Site {
  return new Site({ state, outputDir, timeZone: TZ, now: NOW });
}

function stateWith(opts: {
  prs?: StatePullRequest[];
  users?: StateUser[];
  anchor?: Date;
}): State {
  return new State({
    syncedAt: NOW,
    backfillAnchor: opts.anchor ?? new Date("2026-04-01T00:00:00Z"),
    users: opts.users ?? [],
    pullRequests: opts.prs ?? [],
  });
}

describe("Site", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "octoladder-site-"));
  });

  it("enumeratePeriods returns no periods when state has no anchor", () => {
    const site = new Site({ state: new State(), outputDir: dir, timeZone: TZ, now: NOW });
    expect(site.enumeratePeriods("weekly")).toEqual([]);
  });

  it("enumeratePeriods covers anchor through latest closed for weekly", () => {
    const state = stateWith({ anchor: new Date("2026-04-01T00:00:00Z") });
    const site = siteFor(state, dir);
    const weeks = site.enumeratePeriods("weekly");
    // Anchor 2026-04-01 sits in the week of Mon 2026-03-30 (in JST). Latest
    // closed weekly relative to NOW (Mon 2026-04-27 12:00 JST) is the week of
    // Mon 2026-04-20. Span = {03-30, 04-06, 04-13, 04-20} = 4 weeks.
    expect(weeks).toHaveLength(4);
    expect(weeks[0]!.startsAt).toEqual(tokyo(2026, 3, 30));
    expect(weeks[weeks.length - 1]!.startsAt).toEqual(tokyo(2026, 4, 20));
  });

  it("enumeratePeriods covers monthly periods", () => {
    const state = stateWith({ anchor: new Date("2025-11-15T00:00:00Z") });
    const site = siteFor(state, dir);
    const months = site.enumeratePeriods("monthly");
    expect(months).toHaveLength(5);
    expect(months[0]!.startsAt).toEqual(tokyo(2025, 11, 1));
    expect(months[months.length - 1]!.startsAt).toEqual(tokyo(2026, 3, 1));
  });

  it("enumeratePeriods covers yearly periods", () => {
    const state = stateWith({ anchor: new Date("2025-01-01T00:00:00Z") });
    const site = siteFor(state, dir);
    const years = site.enumeratePeriods("yearly");
    expect(years).toHaveLength(1);
    expect(years[0]!.startsAt).toEqual(tokyo(2025, 1, 1));
  });

  it("call writes period files for every type at expected paths", () => {
    const state = stateWith({
      anchor: new Date("2025-01-01T00:00:00Z"),
      users: [makeUser()],
      prs: [
        makePullRequest({
          github_id: 100,
          merged_at: "2026-04-22T09:00:00Z",
        }),
      ],
    });
    siteFor(state, dir).call();

    const weekly = Period.latestClosed("weekly", NOW, TZ).param;
    const monthly = Period.latestClosed("monthly", NOW, TZ).param;
    const yearly = Period.latestClosed("yearly", NOW, TZ).param;
    expect(() => readFileSync(join(dir, "weekly", `${weekly}.html`))).not.toThrow();
    expect(() => readFileSync(join(dir, "monthly", `${monthly}.html`))).not.toThrow();
    expect(() => readFileSync(join(dir, "yearly", `${yearly}.html`))).not.toThrow();
    expect(() => readFileSync(join(dir, "index.html"))).not.toThrow();
  });

  it("writes a ranking with the contributor login in the period file", () => {
    const state = stateWith({
      users: [makeUser()],
      prs: [
        makePullRequest({ github_id: 100, merged_at: "2026-04-22T09:00:00Z" }),
        makePullRequest({ github_id: 101, merged_at: "2026-04-23T09:00:00Z" }),
      ],
    });
    siteFor(state, dir).call();

    const weekly = Period.latestClosed("weekly", NOW, TZ).param;
    const html = readFileSync(join(dir, "weekly", `${weekly}.html`), "utf8");
    expect(html).toMatch(/alice/);
    expect(html).toMatch(/<td class="count">2<\/td>/);
  });

  it("links the ranking row login to the contributor's detail page", () => {
    const state = stateWith({
      users: [makeUser()],
      prs: [makePullRequest({ github_id: 100, merged_at: "2026-04-22T09:00:00Z" })],
    });
    siteFor(state, dir).call();

    const weekly = Period.latestClosed("weekly", NOW, TZ).param;
    const html = readFileSync(join(dir, "weekly", `${weekly}.html`), "utf8");
    expect(html).toContain(`<a href="${weekly}/alice.html">alice</a>`);
  });

  it("renders an empty period without crashing", () => {
    const state = stateWith({});
    siteFor(state, dir).call();

    const weekly = Period.latestClosed("weekly", NOW, TZ).param;
    const html = readFileSync(join(dir, "weekly", `${weekly}.html`), "utf8");
    expect(html).toMatch(/No merged PRs/);
  });

  it("writes index.html that redirects to the latest weekly period", () => {
    const state = stateWith({});
    siteFor(state, dir).call();

    const weekly = Period.latestClosed("weekly", NOW, TZ).param;
    const html = readFileSync(join(dir, "index.html"), "utf8");
    expect(html).toMatch(
      new RegExp(`<meta http-equiv="refresh" content="0; url=weekly/${weekly}\\.html">`),
    );
  });

  it("copies CSS into output_dir/assets", () => {
    siteFor(stateWith({}), dir).call();
    const css = readFileSync(join(dir, "assets", "style.css"), "utf8");
    expect(css.length).toBeGreaterThan(0);
    expect(css).toMatch(/--accent/);
  });

  it("PRs from inactive users still appear in historical rankings", () => {
    const state = stateWith({
      users: [makeUser({ active: false })],
      prs: [makePullRequest({ github_id: 100, merged_at: "2026-04-22T09:00:00Z" })],
    });
    siteFor(state, dir).call();

    const weekly = Period.latestClosed("weekly", NOW, TZ).param;
    const html = readFileSync(join(dir, "weekly", `${weekly}.html`), "utf8");
    expect(html).toMatch(/alice/);
    expect(html).toMatch(/inactive/);
  });

  describe("period tabs", () => {
    function render(anchor: Date) {
      siteFor(stateWith({ anchor }), dir).call();
      return {
        weekly: Period.latestClosed("weekly", NOW, TZ).param,
        monthly: Period.latestClosed("monthly", NOW, TZ).param,
        yearly: Period.latestClosed("yearly", NOW, TZ).param,
      };
    }

    const FULL_ANCHOR = new Date("2025-01-01T00:00:00Z");

    it("renders Latest weekly/monthly/yearly tabs on every period page", () => {
      const { weekly, monthly, yearly } = render(FULL_ANCHOR);

      for (const path of [
        join(dir, "weekly", `${weekly}.html`),
        join(dir, "monthly", `${monthly}.html`),
        join(dir, "yearly", `${yearly}.html`),
      ]) {
        const html = readFileSync(path, "utf8");
        expect(html).toMatch(/<nav class="period-tabs">/);
        expect(html).toMatch(/Latest weekly/);
        expect(html).toMatch(/Latest monthly/);
        expect(html).toMatch(/Latest yearly/);
      }
    });

    it("marks the current type's tab with aria-current on its latest page", () => {
      const { weekly } = render(FULL_ANCHOR);
      const html = readFileSync(join(dir, "weekly", `${weekly}.html`), "utf8");
      expect(html).toMatch(
        new RegExp(`<a href="${weekly}\\.html" aria-current="page">Latest weekly</a>`),
      );
    });

    it("does not mark a tab with aria-current on a non-latest page of that type", () => {
      render(FULL_ANCHOR);
      const olderWeekly = Period.latestClosed("weekly", NOW, TZ).prev().param;
      const html = readFileSync(join(dir, "weekly", `${olderWeekly}.html`), "utf8");
      expect(html).not.toMatch(/aria-current="page"/);
    });

    it("uses ../{type}/{param}.html for cross-type tab links", () => {
      const { weekly, monthly, yearly } = render(FULL_ANCHOR);
      const html = readFileSync(join(dir, "weekly", `${weekly}.html`), "utf8");
      expect(html).toMatch(new RegExp(`href="\\.\\./monthly/${monthly}\\.html"`));
      expect(html).toMatch(new RegExp(`href="\\.\\./yearly/${yearly}\\.html"`));
    });

    it("renders disabled spans for tabs whose type has no enumerated periods", () => {
      const { weekly } = render(new Date("2026-04-15T00:00:00Z"));
      const html = readFileSync(join(dir, "weekly", `${weekly}.html`), "utf8");
      expect(html).toMatch(/<span class="disabled">Latest monthly<\/span>/);
      expect(html).toMatch(/<span class="disabled">Latest yearly<\/span>/);
    });
  });

  describe("rank delta", () => {
    it("renders up, down, and no-comparison markers based on the previous period", () => {
      const state = stateWith({
        anchor: new Date("2026-04-01T00:00:00Z"),
        users: [
          makeUser({ github_id: 1, login: "alice" }),
          makeUser({ github_id: 2, login: "bob" }),
          makeUser({ github_id: 3, login: "carol" }),
        ],
        prs: [
          // Week of Mon 2026-04-13 JST (previous): alice=2, bob=1.
          makePullRequest({ github_id: 200, author_login: "alice", merged_at: "2026-04-14T09:00:00Z" }),
          makePullRequest({ github_id: 201, author_login: "alice", merged_at: "2026-04-15T09:00:00Z" }),
          makePullRequest({ github_id: 202, author_login: "bob", merged_at: "2026-04-16T09:00:00Z" }),
          // Week of Mon 2026-04-20 JST (latest): bob=3, alice=1, carol=1.
          makePullRequest({ github_id: 210, author_login: "bob", merged_at: "2026-04-21T09:00:00Z" }),
          makePullRequest({ github_id: 211, author_login: "bob", merged_at: "2026-04-22T09:00:00Z" }),
          makePullRequest({ github_id: 212, author_login: "bob", merged_at: "2026-04-23T09:00:00Z" }),
          makePullRequest({ github_id: 213, author_login: "alice", merged_at: "2026-04-24T09:00:00Z" }),
          makePullRequest({ github_id: 214, author_login: "carol", merged_at: "2026-04-25T09:00:00Z" }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(join(dir, "weekly", `${weekly}.html`), "utf8");
      // bob: rank 2 -> 1 (up 1)
      expect(html).toMatch(/<span class="rank-delta-up" title="Up 1[^"]*">↑<\/span><\/td>[\s\S]*?>bob</);
      // alice: rank 1 -> 2 (down 1)
      expect(html).toMatch(/<span class="rank-delta-down" title="Down 1[^"]*">↓<\/span><\/td>[\s\S]*?>alice</);
      // carol: not in previous week -> no comparison
      expect(html).toMatch(/<span class="rank-delta-none"[^>]*>—<\/span><\/td>[\s\S]*?>carol</);
    });

    it("shows no-comparison markers when there is no previous period", () => {
      const state = stateWith({
        anchor: new Date("2026-04-20T00:00:00Z"),
        users: [makeUser()],
        prs: [makePullRequest({ merged_at: "2026-04-22T09:00:00Z" })],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(join(dir, "weekly", `${weekly}.html`), "utf8");
      expect(html).toMatch(/<span class="rank-delta-none"[^>]*>—<\/span>/);
    });
  });


  describe("contributor detail page", () => {
    function detailPath(periodType: string, periodParam: string, login: string): string {
      return join(dir, periodType, periodParam, `${login}.html`);
    }

    it("writes a detail page per contributor with PRs in the period", () => {
      const state = stateWith({
        users: [makeUser({ login: "alice" }), makeUser({ github_id: 2, login: "bob" })],
        prs: [
          makePullRequest({
            github_id: 100,
            author_login: "alice",
            merged_at: "2026-04-22T09:00:00Z",
          }),
          makePullRequest({
            github_id: 101,
            author_login: "bob",
            merged_at: "2026-04-23T09:00:00Z",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      expect(() => readFileSync(detailPath("weekly", weekly, "alice"))).not.toThrow();
      expect(() => readFileSync(detailPath("weekly", weekly, "bob"))).not.toThrow();
    });

    it("does not write a detail page for users with no PRs in the period", () => {
      const state = stateWith({
        users: [makeUser({ login: "alice" }), makeUser({ github_id: 2, login: "bob" })],
        prs: [
          makePullRequest({
            github_id: 100,
            author_login: "alice",
            merged_at: "2026-04-22T09:00:00Z",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      expect(() => readFileSync(detailPath("weekly", weekly, "bob"))).toThrow();
    });

    it("renders profile with avatar, GitHub-linked login, and summary", () => {
      const state = stateWith({
        users: [
          makeUser({
            login: "alice",
            avatar_url: "https://example.com/a.png",
          }),
        ],
        prs: [
          makePullRequest({
            github_id: 100,
            author_login: "alice",
            merged_at: "2026-04-22T09:00:00Z",
            repo_full_name: "acme/widget",
          }),
          makePullRequest({
            github_id: 101,
            author_login: "alice",
            merged_at: "2026-04-23T09:00:00Z",
            repo_full_name: "acme/gizmo",
          }),
          makePullRequest({
            github_id: 102,
            author_login: "alice",
            merged_at: "2026-04-24T09:00:00Z",
            repo_full_name: "acme/gizmo",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(detailPath("weekly", weekly, "alice"), "utf8");
      expect(html).toContain('<img src="https://example.com/a.png"');
      expect(html).toMatch(
        /<a href="https:\/\/github\.com\/alice" rel="noopener noreferrer">alice<\/a>/,
      );
      expect(html).toMatch(/3 merged PRs across 2 repositories/);
    });

    it("uses singular wording when there is one PR in one repository", () => {
      const state = stateWith({
        users: [makeUser({ login: "alice" })],
        prs: [
          makePullRequest({
            github_id: 100,
            author_login: "alice",
            merged_at: "2026-04-22T09:00:00Z",
            repo_full_name: "acme/widget",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(detailPath("weekly", weekly, "alice"), "utf8");
      expect(html).toMatch(/1 merged PR across 1 repository/);
    });

    it("includes a Back link to the period page", () => {
      const state = stateWith({
        users: [makeUser({ login: "alice" })],
        prs: [
          makePullRequest({
            github_id: 100,
            author_login: "alice",
            merged_at: "2026-04-22T09:00:00Z",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ);
      const html = readFileSync(detailPath("weekly", weekly.param, "alice"), "utf8");
      expect(html).toContain(
        `<a class="back" href="../${weekly.param}.html">← Back to ${weekly.label}</a>`,
      );
    });

    it("groups PRs by repo (alphabetical) with repo heading linked to GitHub", () => {
      const state = stateWith({
        users: [makeUser({ login: "alice" })],
        prs: [
          makePullRequest({
            github_id: 200,
            author_login: "alice",
            merged_at: "2026-04-22T09:00:00Z",
            repo_full_name: "zed/widget",
            html_url: "https://github.com/zed/widget/pull/200",
          }),
          makePullRequest({
            github_id: 201,
            author_login: "alice",
            merged_at: "2026-04-23T09:00:00Z",
            repo_full_name: "acme/widget",
            html_url: "https://github.com/acme/widget/pull/201",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(detailPath("weekly", weekly, "alice"), "utf8");
      const acmeIdx = html.indexOf("acme/widget");
      const zedIdx = html.indexOf("zed/widget");
      expect(acmeIdx).toBeGreaterThan(-1);
      expect(zedIdx).toBeGreaterThan(-1);
      expect(acmeIdx).toBeLessThan(zedIdx);
      expect(html).toMatch(
        /<a href="https:\/\/github\.com\/acme\/widget" rel="noopener noreferrer">acme\/widget<\/a>/,
      );
    });

    it("sorts PRs within a repo by merged_at desc", () => {
      const state = stateWith({
        users: [makeUser({ login: "alice" })],
        prs: [
          makePullRequest({
            github_id: 1,
            author_login: "alice",
            merged_at: "2026-04-22T09:00:00Z",
            repo_full_name: "acme/widget",
            html_url: "https://github.com/acme/widget/pull/1",
            title: "Older",
          }),
          makePullRequest({
            github_id: 2,
            author_login: "alice",
            merged_at: "2026-04-25T09:00:00Z",
            repo_full_name: "acme/widget",
            html_url: "https://github.com/acme/widget/pull/2",
            title: "Newer",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(detailPath("weekly", weekly, "alice"), "utf8");
      const newerIdx = html.indexOf("#2 Newer");
      const olderIdx = html.indexOf("#1 Older");
      expect(newerIdx).toBeGreaterThan(-1);
      expect(olderIdx).toBeGreaterThan(-1);
      expect(newerIdx).toBeLessThan(olderIdx);
    });

    it("renders the PR link as #number title when title is present", () => {
      const state = stateWith({
        users: [makeUser({ login: "alice" })],
        prs: [
          makePullRequest({
            github_id: 5,
            author_login: "alice",
            merged_at: "2026-04-22T09:00:00Z",
            repo_full_name: "acme/widget",
            html_url: "https://github.com/acme/widget/pull/5",
            title: "Add baz",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(detailPath("weekly", weekly, "alice"), "utf8");
      expect(html).toContain(
        `<a href="https://github.com/acme/widget/pull/5">#5 Add baz</a>`,
      );
    });

    it("falls back to #number when title is missing", () => {
      const state = stateWith({
        users: [makeUser({ login: "alice" })],
        prs: [
          makePullRequest({
            github_id: 9,
            author_login: "alice",
            merged_at: "2026-04-22T09:00:00Z",
            repo_full_name: "acme/widget",
            html_url: "https://github.com/acme/widget/pull/9",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(detailPath("weekly", weekly, "alice"), "utf8");
      expect(html).toContain(`<a href="https://github.com/acme/widget/pull/9">#9</a>`);
      expect(html).not.toMatch(/#9 [A-Za-z]/);
    });

    it("renders <time> with ISO datetime attribute and tz-localized text", () => {
      const state = stateWith({
        users: [makeUser({ login: "alice" })],
        prs: [
          makePullRequest({
            github_id: 1,
            author_login: "alice",
            merged_at: "2026-04-22T09:15:00Z",
            repo_full_name: "acme/widget",
            html_url: "https://github.com/acme/widget/pull/1",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(detailPath("weekly", weekly, "alice"), "utf8");
      expect(html).toContain(
        `<time datetime="2026-04-22T09:15:00.000Z">2026-04-22 18:15</time>`,
      );
    });

    it("generates detail pages for inactive contributors too", () => {
      const state = stateWith({
        users: [makeUser({ login: "alice", active: false })],
        prs: [
          makePullRequest({
            github_id: 100,
            author_login: "alice",
            merged_at: "2026-04-22T09:00:00Z",
          }),
        ],
      });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(detailPath("weekly", weekly, "alice"), "utf8");
      expect(html).toMatch(/alice/);
    });

    it("writes detail pages for monthly and yearly periods too", () => {
      const state = stateWith({
        anchor: new Date("2025-01-01T00:00:00Z"),
        users: [makeUser({ login: "alice" })],
        prs: [
          makePullRequest({
            github_id: 100,
            author_login: "alice",
            merged_at: "2026-03-15T09:00:00Z",
          }),
          makePullRequest({
            github_id: 101,
            author_login: "alice",
            merged_at: "2025-12-15T09:00:00Z",
          }),
        ],
      });
      siteFor(state, dir).call();

      const monthly = Period.latestClosed("monthly", NOW, TZ).param;
      const yearly = Period.latestClosed("yearly", NOW, TZ).param;
      expect(() => readFileSync(detailPath("monthly", monthly, "alice"))).not.toThrow();
      expect(() => readFileSync(detailPath("yearly", yearly, "alice"))).not.toThrow();
    });
  });

  describe("period-nav prev/next", () => {
    it("omits Next on the latest page of a type", () => {
      const state = stateWith({ anchor: new Date("2025-01-01T00:00:00Z") });
      siteFor(state, dir).call();

      const weekly = Period.latestClosed("weekly", NOW, TZ).param;
      const html = readFileSync(join(dir, "weekly", `${weekly}.html`), "utf8");
      expect(html).not.toMatch(/Next →/);
      expect(html).toMatch(/← Previous/);
    });

    it("omits Previous on the oldest page of a type", () => {
      const state = stateWith({ anchor: new Date("2025-01-01T00:00:00Z") });
      siteFor(state, dir).call();

      const html = readFileSync(join(dir, "weekly", "2025-W01.html"), "utf8");
      expect(html).not.toMatch(/← Previous/);
      expect(html).toMatch(/Next →/);
    });
  });
});
