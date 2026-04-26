import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidTeamsConfig, TeamsConfig } from "../src/teams-config.js";

describe("TeamsConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "octoladder-"));
  });

  afterEach(() => {
    // mkdtempSync leaves the directory behind; not cleaned for simplicity.
  });

  it("parses a list of org/team_slug entries", () => {
    const config = new TeamsConfig([
      { org: "acme", team_slug: "platform" },
      { org: "acme", team_slug: "infra" },
    ]);
    expect(config.entries).toHaveLength(2);
    expect(config.entries[0]).toEqual({ org: "acme", slug: "platform" });
  });

  it("entries are frozen so callers cannot mutate them", () => {
    const config = new TeamsConfig([{ org: "acme", team_slug: "platform" }]);
    expect(Object.isFrozen(config.entries)).toBe(true);
  });

  it("strips surrounding whitespace", () => {
    const config = new TeamsConfig([{ org: "  acme ", team_slug: "platform\n" }]);
    expect(config.entries[0]).toEqual({ org: "acme", slug: "platform" });
  });

  it("accepts an empty list", () => {
    const config = new TeamsConfig([]);
    expect(config.entries).toEqual([]);
  });

  it("rejects a non-list top-level value", () => {
    expect(() => new TeamsConfig("nope")).toThrow(InvalidTeamsConfig);
    expect(() => new TeamsConfig({ teams: [] })).toThrow(InvalidTeamsConfig);
  });

  it("rejects an entry that is not a mapping", () => {
    expect(() => new TeamsConfig(["acme/platform"])).toThrow(InvalidTeamsConfig);
  });

  it("rejects a missing org", () => {
    expect(() => new TeamsConfig([{ team_slug: "platform" }])).toThrow(/missing org/);
  });

  it("rejects a missing team_slug", () => {
    expect(() => new TeamsConfig([{ org: "acme" }])).toThrow(/missing team_slug/);
  });

  it("rejects a blank org", () => {
    expect(() => new TeamsConfig([{ org: "  ", team_slug: "platform" }])).toThrow(InvalidTeamsConfig);
  });

  it("rejects duplicate entries", () => {
    expect(
      () =>
        new TeamsConfig([
          { org: "acme", team_slug: "platform" },
          { org: "acme", team_slug: "platform" },
        ]),
    ).toThrow(/duplicate/);
  });

  it("allows the same slug under different orgs", () => {
    const config = new TeamsConfig([
      { org: "acme", team_slug: "platform" },
      { org: "beta", team_slug: "platform" },
    ]);
    expect(config.entries).toHaveLength(2);
  });

  it("load reads a YAML file from disk", () => {
    const path = join(dir, "teams.yml");
    writeFileSync(
      path,
      "- org: acme\n  team_slug: platform\n- org: beta\n  team_slug: sre\n",
    );
    const config = TeamsConfig.load(path);
    expect(config.entries.map((e) => [e.org, e.slug])).toEqual([
      ["acme", "platform"],
      ["beta", "sre"],
    ]);
  });

  it("load treats an empty file as an empty list", () => {
    const path = join(dir, "empty.yml");
    writeFileSync(path, "");
    const config = TeamsConfig.load(path);
    expect(config.entries).toEqual([]);
  });
});
