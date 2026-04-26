import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { toZonedTime } from "date-fns-tz";

export class InvalidConfig extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfig";
  }
}

export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

export class OctoladderConfig {
  readonly timeZone: string;

  constructor(raw: unknown) {
    if (!isPlainObject(raw)) {
      throw new InvalidConfig(`expected a mapping, got ${describe(raw)}`);
    }
    const tz = raw["time_zone"] ?? DEFAULT_TIME_ZONE;
    if (typeof tz !== "string" || !isValidTimeZone(tz)) {
      throw new InvalidConfig(`unknown time_zone: ${JSON.stringify(tz)}`);
    }
    this.timeZone = tz;
  }

  static load(path: string): OctoladderConfig {
    if (!existsSync(path)) return new OctoladderConfig({});
    const raw = (parse(readFileSync(path, "utf8")) as unknown) ?? {};
    return new OctoladderConfig(raw);
  }

  // Earliest merged_at to ingest on first sync. Fixed at Jan 1 of the previous
  // calendar year in the configured TZ — wide enough that the most recent
  // closed weekly / monthly / yearly periods are all populated on day 1, and
  // narrow enough to avoid runaway rate-limited backfills.
  backfillAnchor(now: Date = new Date()): Date {
    const local = toZonedTime(now, this.timeZone);
    const year = local.getFullYear() - 1;
    return new Date(Date.UTC(year, 0, 1));
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
