import { describe, expect, it } from "vitest";
import { InvalidParam, Period } from "../src/period.js";
import { TZ, tokyo } from "./helpers.js";

describe("Period", () => {
  describe("latestClosed", () => {
    it("weekly returns the previous Mon-Sun week in TZ", () => {
      // Sun 2026-04-19 23:00 JST -> previous completed week = Mon 4/6 .. Sun 4/12
      const period = Period.latestClosed("weekly", tokyo(2026, 4, 19, 23), TZ);
      expect(period.type).toBe("weekly");
      expect(period.startsAt).toEqual(tokyo(2026, 4, 6));
      expect(period.endsAt).toEqual(tokyo(2026, 4, 13));
    });

    it("weekly on a Monday morning returns the week that just ended", () => {
      const period = Period.latestClosed("weekly", tokyo(2026, 4, 13, 0, 0, 1), TZ);
      expect(period.startsAt).toEqual(tokyo(2026, 4, 6));
    });

    it("monthly returns the previous calendar month", () => {
      const period = Period.latestClosed("monthly", tokyo(2026, 4, 19), TZ);
      expect(period.startsAt).toEqual(tokyo(2026, 3, 1));
      expect(period.endsAt).toEqual(tokyo(2026, 4, 1));
    });

    it("yearly returns the previous calendar year", () => {
      const period = Period.latestClosed("yearly", tokyo(2026, 4, 19), TZ);
      expect(period.startsAt).toEqual(tokyo(2025, 1, 1));
      expect(period.endsAt).toEqual(tokyo(2026, 1, 1));
    });
  });

  describe("prev/next", () => {
    it("weekly steps exactly 7 days", () => {
      const period = new Period({ type: "weekly", startsAt: tokyo(2026, 4, 6), timeZone: TZ });
      expect(period.prev().startsAt).toEqual(tokyo(2026, 3, 30));
      expect(period.next().startsAt).toEqual(tokyo(2026, 4, 13));
    });

    it("monthly steps by calendar month", () => {
      const period = new Period({ type: "monthly", startsAt: tokyo(2026, 3, 1), timeZone: TZ });
      expect(period.prev().startsAt).toEqual(tokyo(2026, 2, 1));
      expect(period.next().startsAt).toEqual(tokyo(2026, 4, 1));
    });

    it("yearly steps by calendar year", () => {
      const period = new Period({ type: "yearly", startsAt: tokyo(2025, 1, 1), timeZone: TZ });
      expect(period.prev().startsAt).toEqual(tokyo(2024, 1, 1));
      expect(period.next().startsAt).toEqual(tokyo(2026, 1, 1));
    });
  });

  describe("isComplete", () => {
    it("is true when endsAt is at or before now", () => {
      const period = new Period({ type: "weekly", startsAt: tokyo(2026, 4, 6), timeZone: TZ });
      expect(period.isComplete(tokyo(2026, 4, 13))).toBe(true);
      expect(period.isComplete(tokyo(2026, 4, 12, 23, 59, 59))).toBe(false);
    });
  });

  describe("contains", () => {
    it("uses half-open interval [startsAt, endsAt)", () => {
      const period = new Period({ type: "weekly", startsAt: tokyo(2026, 4, 6), timeZone: TZ });
      expect(period.contains(tokyo(2026, 4, 6))).toBe(true);
      expect(period.contains(tokyo(2026, 4, 12, 23, 59, 59))).toBe(true);
      expect(period.contains(tokyo(2026, 4, 13))).toBe(false);
      expect(period.contains(tokyo(2026, 4, 5, 23, 59, 59))).toBe(false);
    });
  });

  describe("label", () => {
    it("renders human-readable labels per type", () => {
      expect(
        new Period({ type: "weekly", startsAt: tokyo(2026, 4, 6), timeZone: TZ }).label,
      ).toBe("April 6 — April 12");
      expect(
        new Period({ type: "monthly", startsAt: tokyo(2026, 3, 1), timeZone: TZ }).label,
      ).toBe("March 2026");
      expect(
        new Period({ type: "yearly", startsAt: tokyo(2025, 1, 1), timeZone: TZ }).label,
      ).toBe("2025");
    });
  });

  describe("subtitle", () => {
    it("weekly reports ISO week", () => {
      const period = new Period({ type: "weekly", startsAt: tokyo(2026, 4, 6), timeZone: TZ });
      expect(period.subtitle).toBe("Week 15 · 2026");
    });

    it("non-weekly is null", () => {
      expect(
        new Period({ type: "monthly", startsAt: tokyo(2026, 3, 1), timeZone: TZ }).subtitle,
      ).toBeNull();
      expect(
        new Period({ type: "yearly", startsAt: tokyo(2025, 1, 1), timeZone: TZ }).subtitle,
      ).toBeNull();
    });
  });

  describe("param round-trip", () => {
    it("survives parse for every type", () => {
      const periods = [
        new Period({ type: "weekly", startsAt: tokyo(2026, 4, 6), timeZone: TZ }),
        new Period({ type: "monthly", startsAt: tokyo(2026, 3, 1), timeZone: TZ }),
        new Period({ type: "yearly", startsAt: tokyo(2025, 1, 1), timeZone: TZ }),
      ] as const;
      for (const period of periods) {
        const parsed = Period.parse(period.type, period.param, TZ);
        expect(parsed.equals(period)).toBe(true);
      }
    });
  });

  describe("parse rejects bad input", () => {
    it("malformed params", () => {
      expect(() => Period.parse("weekly", "2026W15", TZ)).toThrow(InvalidParam);
      expect(() => Period.parse("weekly", "2026-15", TZ)).toThrow(InvalidParam);
      expect(() => Period.parse("monthly", "2026/04", TZ)).toThrow(InvalidParam);
      expect(() => Period.parse("yearly", "20xx", TZ)).toThrow(InvalidParam);
    });

    it("out-of-range months", () => {
      expect(() => Period.parse("monthly", "2026-13", TZ)).toThrow(InvalidParam);
      expect(() => Period.parse("monthly", "2026-00", TZ)).toThrow(InvalidParam);
    });

    it("impossible ISO weeks (2025 has 52 weeks)", () => {
      expect(() => Period.parse("weekly", "2025-W53", TZ)).toThrow(InvalidParam);
    });
  });

  describe("normalize", () => {
    it("snaps a mid-period startsAt to the canonical start", () => {
      const period = new Period({
        type: "weekly",
        startsAt: tokyo(2026, 4, 10, 15),
        timeZone: TZ,
      });
      expect(period.startsAt).toEqual(tokyo(2026, 4, 6));
    });
  });

  describe("constructor", () => {
    it("rejects unknown types", () => {
      expect(
        () =>
          new Period({
            // @ts-expect-error -- testing runtime guard
            type: "daily",
            startsAt: tokyo(2026, 4, 6),
            timeZone: TZ,
          }),
      ).toThrow(TypeError);
    });
  });

  describe("equals", () => {
    it("is true for two periods with the same type and instant", () => {
      const a = new Period({ type: "weekly", startsAt: tokyo(2026, 4, 6), timeZone: TZ });
      const b = new Period({ type: "weekly", startsAt: tokyo(2026, 4, 6), timeZone: TZ });
      const c = new Period({ type: "weekly", startsAt: tokyo(2026, 4, 13), timeZone: TZ });
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });
  });
});
