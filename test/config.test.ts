import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { InvalidConfig, OctoladderConfig } from "../src/config.js";

describe("OctoladderConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "octoladder-"));
  });

  it("defaults when given an empty object", () => {
    const config = new OctoladderConfig({});
    expect(config.timeZone).toBe("Asia/Tokyo");
  });

  it("honors explicit time_zone", () => {
    const config = new OctoladderConfig({ time_zone: "America/Los_Angeles" });
    expect(config.timeZone).toBe("America/Los_Angeles");
  });

  it("rejects unknown time_zone", () => {
    expect(() => new OctoladderConfig({ time_zone: "Mars/Olympus" })).toThrow(InvalidConfig);
  });

  it("rejects non-mapping input", () => {
    expect(() => new OctoladderConfig([])).toThrow(InvalidConfig);
    expect(() => new OctoladderConfig("nope")).toThrow(InvalidConfig);
  });

  it("backfillAnchor is Jan 1 of the previous calendar year in TZ", () => {
    const config = new OctoladderConfig({ time_zone: "Asia/Tokyo" });
    const now = new Date(Date.UTC(2026, 3, 27)); // 2026-04-27T00:00:00Z
    expect(config.backfillAnchor(now)).toEqual(new Date(Date.UTC(2025, 0, 1)));
  });

  it("backfillAnchor honors TZ when computing the previous year", () => {
    // 2026-01-01 00:30 UTC is still 2025-12-31 in Los Angeles, so the
    // "previous year" anchor is 2024-01-01, not 2025-01-01.
    const config = new OctoladderConfig({ time_zone: "America/Los_Angeles" });
    const now = new Date(Date.UTC(2026, 0, 1, 0, 30));
    expect(config.backfillAnchor(now)).toEqual(new Date(Date.UTC(2024, 0, 1)));
  });

  it("load returns defaults when the file does not exist", () => {
    const config = OctoladderConfig.load(join(dir, "no-such-file.yml"));
    expect(config.timeZone).toBe("Asia/Tokyo");
  });

  it("load reads time_zone from disk", () => {
    const path = join(dir, "octoladder.yml");
    writeFileSync(path, "time_zone: Europe/Berlin\n");
    const config = OctoladderConfig.load(path);
    expect(config.timeZone).toBe("Europe/Berlin");
  });

  it("load treats an empty file as defaults", () => {
    const path = join(dir, "empty.yml");
    writeFileSync(path, "");
    const config = OctoladderConfig.load(path);
    expect(config.timeZone).toBe("Asia/Tokyo");
  });
});
