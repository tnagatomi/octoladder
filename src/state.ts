import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isoSeconds } from "./util.js";

export const SCHEMA_VERSION = 1;

export class IncompatibleSchema extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleSchema";
  }
}

export interface StateTeam {
  org: string;
  slug: string;
}

export interface StateUser {
  github_id: number;
  login: string;
  avatar_url?: string;
  team_keys: string[];
  active: boolean;
  [extra: string]: unknown;
}

export interface StatePullRequest {
  github_id: number;
  author_login: string;
  merged_at: string;
  html_url: string;
  repo_full_name: string;
  [extra: string]: unknown;
}

export class State {
  syncedAt: Date | null;
  backfillAnchor: Date | null;
  readonly teams: StateTeam[];
  readonly users: StateUser[];
  readonly pullRequests: StatePullRequest[];

  constructor(
    init: {
      syncedAt?: Date | null;
      backfillAnchor?: Date | null;
      teams?: StateTeam[];
      users?: StateUser[];
      pullRequests?: StatePullRequest[];
    } = {},
  ) {
    this.syncedAt = init.syncedAt ?? null;
    this.backfillAnchor = init.backfillAnchor ?? null;
    this.teams = init.teams ?? [];
    this.users = init.users ?? [];
    this.pullRequests = init.pullRequests ?? [];
  }

  static load(path: string): State {
    if (!existsSync(path)) return new State();

    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const version = raw["schema_version"];
    if (version !== SCHEMA_VERSION) {
      throw new IncompatibleSchema(
        `schema_version=${JSON.stringify(version)} (expected ${SCHEMA_VERSION})`,
      );
    }

    return new State({
      syncedAt: typeof raw["synced_at"] === "string" ? new Date(raw["synced_at"]) : null,
      backfillAnchor:
        typeof raw["backfill_anchor"] === "string"
          ? parseAnchorDate(raw["backfill_anchor"])
          : null,
      teams: (raw["teams"] as StateTeam[] | undefined) ?? [],
      users: (raw["users"] as StateUser[] | undefined) ?? [],
      pullRequests: (raw["pull_requests"] as StatePullRequest[] | undefined) ?? [],
    });
  }

  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(this.toJSON(), null, 2) + "\n");
  }

  toJSON(): Record<string, unknown> {
    return {
      schema_version: SCHEMA_VERSION,
      synced_at: this.syncedAt ? isoSeconds(this.syncedAt) : null,
      backfill_anchor: this.backfillAnchor ? formatAnchorDate(this.backfillAnchor) : null,
      teams: [...this.teams].sort((a, b) => compareTuple([a.org, a.slug], [b.org, b.slug])),
      users: [...this.users].sort((a, b) => a.github_id - b.github_id),
      pull_requests: [...this.pullRequests].sort((a, b) =>
        compareTuple([a.merged_at, a.github_id], [b.merged_at, b.github_id]),
      ),
    };
  }
}

function compareTuple(a: [string | number, ...unknown[]], b: [string | number, ...unknown[]]): number {
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) continue;
    return (av as number | string) < (bv as number | string) ? -1 : 1;
  }
  return 0;
}

function parseAnchorDate(value: string): Date {
  // YYYY-MM-DD interpreted as UTC midnight (matches Ruby Date.iso8601 semantics).
  return new Date(`${value}T00:00:00Z`);
}

function formatAnchorDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
