import { readFileSync } from "node:fs";
import { parse } from "yaml";

export interface TeamEntry {
  readonly org: string;
  readonly slug: string;
}

export class InvalidTeamsConfig extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTeamsConfig";
  }
}

export class TeamsConfig {
  readonly entries: readonly TeamEntry[];

  constructor(raw: unknown) {
    this.entries = Object.freeze(parseEntries(raw));
  }

  static load(path: string): TeamsConfig {
    const raw = (parse(readFileSync(path, "utf8")) as unknown) ?? [];
    return new TeamsConfig(raw);
  }
}

function parseEntries(raw: unknown): TeamEntry[] {
  if (!Array.isArray(raw)) {
    throw new InvalidTeamsConfig(`expected a list of teams, got ${describe(raw)}`);
  }

  const seen = new Set<string>();
  return raw.map((row, i) => {
    if (!isPlainObject(row)) {
      throw new InvalidTeamsConfig(`entry ${i}: expected a mapping`);
    }
    const org = requireString(row, "org", i);
    const slug = requireString(row, "team_slug", i);
    const key = `${org}/${slug}`;
    if (seen.has(key)) {
      throw new InvalidTeamsConfig(`duplicate entry: ${key}`);
    }
    seen.add(key);
    return Object.freeze({ org, slug });
  });
}

function requireString(row: Record<string, unknown>, key: string, index: number): string {
  const raw = row[key];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) {
    throw new InvalidTeamsConfig(`entry ${index}: missing ${key}`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
