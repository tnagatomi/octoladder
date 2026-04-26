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
});
