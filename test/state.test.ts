import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { IncompatibleSchema, State } from "../src/state.js";

describe("State", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "octoladder-state-"));
  });

  it("load on a missing file returns an empty state", () => {
    const state = State.load(join(dir, "missing.json"));
    expect(state.syncedAt).toBeNull();
    expect(state.backfillAnchor).toBeNull();
    expect(state.teams).toEqual([]);
    expect(state.users).toEqual([]);
    expect(state.pullRequests).toEqual([]);
  });

  it("save creates parent directories", () => {
    const path = join(dir, "nested", "subdir", "state.json");
    new State().save(path);
    expect(() => readFileSync(path, "utf8")).not.toThrow();
  });

  it("save then load round-trips syncedAt and backfillAnchor", () => {
    const path = join(dir, "state.json");
    new State({
      syncedAt: new Date("2026-04-27T17:00:00Z"),
      backfillAnchor: new Date("2025-01-01T00:00:00Z"),
    }).save(path);

    const loaded = State.load(path);
    expect(loaded.syncedAt).toEqual(new Date("2026-04-27T17:00:00Z"));
    expect(loaded.backfillAnchor).toEqual(new Date("2025-01-01T00:00:00Z"));
  });

  it("save sorts users by github_id", () => {
    const state = new State({
      users: [
        { github_id: 30, login: "c", team_keys: [], active: true },
        { github_id: 10, login: "a", team_keys: [], active: true },
        { github_id: 20, login: "b", team_keys: [], active: true },
      ],
    });
    const sorted = (state.toJSON()["users"] as { github_id: number }[]).map((u) => u.github_id);
    expect(sorted).toEqual([10, 20, 30]);
  });

  it("save sorts pull_requests by merged_at then github_id", () => {
    const state = new State({
      pullRequests: [
        {
          github_id: 2,
          author_login: "x",
          merged_at: "2026-04-20T10:00:00Z",
          html_url: "x",
          repo_full_name: "x/y",
        },
        {
          github_id: 1,
          author_login: "x",
          merged_at: "2026-04-20T10:00:00Z",
          html_url: "x",
          repo_full_name: "x/y",
        },
        {
          github_id: 3,
          author_login: "x",
          merged_at: "2026-04-19T10:00:00Z",
          html_url: "x",
          repo_full_name: "x/y",
        },
      ],
    });
    const keys = (state.toJSON()["pull_requests"] as { merged_at: string; github_id: number }[]).map(
      (p) => [p.merged_at, p.github_id] as const,
    );
    expect(keys).toEqual([
      ["2026-04-19T10:00:00Z", 3],
      ["2026-04-20T10:00:00Z", 1],
      ["2026-04-20T10:00:00Z", 2],
    ]);
  });

  it("save sorts teams by org then slug", () => {
    const state = new State({
      teams: [
        { org: "rails", slug: "core" },
        { org: "rails", slug: "activerecord" },
        { org: "anthropic", slug: "core" },
      ],
    });
    const keys = (state.toJSON()["teams"] as { org: string; slug: string }[]).map(
      (t) => [t.org, t.slug] as const,
    );
    expect(keys).toEqual([
      ["anthropic", "core"],
      ["rails", "activerecord"],
      ["rails", "core"],
    ]);
  });

  it("saved JSON is human-readable and stable", () => {
    const path = join(dir, "state.json");
    const state = new State({
      syncedAt: new Date("2026-04-27T17:00:00Z"),
      users: [{ github_id: 1, login: "dhh", team_keys: [], active: true }],
    });
    state.save(path);
    const first = readFileSync(path, "utf8");
    state.save(path);
    const second = readFileSync(path, "utf8");
    expect(first).toBe(second);
    expect(first).toContain('"schema_version": 1');
    expect(first.endsWith("\n")).toBe(true);
  });

  it("load rejects unknown schema versions", () => {
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify({ schema_version: 99 }, null, 2));
    expect(() => State.load(path)).toThrow(IncompatibleSchema);
  });

  it("syncedAt is normalized to UTC seconds on save", () => {
    const state = new State({
      syncedAt: new Date("2026-04-27T03:00:00.123Z"),
    });
    expect(state.toJSON()["synced_at"]).toBe("2026-04-27T03:00:00Z");
  });

  it("backfillAnchor serializes as YYYY-MM-DD", () => {
    const state = new State({ backfillAnchor: new Date("2025-01-01T00:00:00Z") });
    expect(state.toJSON()["backfill_anchor"]).toBe("2025-01-01");
  });
});
