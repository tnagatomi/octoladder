import { describe, expect, it } from "vitest";
import { Ranking } from "../src/ranking.js";

describe("Ranking", () => {
  it("assigns competitive ranks: ties share, next rank skips", () => {
    const ranking = new Ranking([
      { user: "a", count: 5 },
      { user: "b", count: 3 },
      { user: "c", count: 3 },
      { user: "d", count: 2 },
    ]);
    expect(ranking.rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(ranking.rows.map((r) => r.user)).toEqual(["a", "b", "c", "d"]);
  });

  it("three-way tie gives everyone rank 1", () => {
    const ranking = new Ranking([
      { user: "a", count: 2 },
      { user: "b", count: 2 },
      { user: "c", count: 2 },
    ]);
    expect(ranking.rows.map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it("two leaders tie at rank 1 and next rank is 3", () => {
    const ranking = new Ranking([
      { user: "a", count: 5 },
      { user: "b", count: 5 },
      { user: "c", count: 4 },
    ]);
    expect(ranking.rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("omits zero-count entries", () => {
    const ranking = new Ranking([
      { user: "a", count: 0 },
      { user: "b", count: 3 },
      { user: "c", count: 0 },
    ]);
    expect(ranking.rows.map((r) => r.user)).toEqual(["b"]);
    expect(ranking.rows.map((r) => r.rank)).toEqual([1]);
    expect(ranking.contributorCount).toBe(1);
  });

  it("empty input yields empty rows", () => {
    const ranking = new Ranking([]);
    expect(ranking.isEmpty).toBe(true);
    expect(ranking.totalCount).toBe(0);
    expect(ranking.contributorCount).toBe(0);
  });

  it("orders by count descending", () => {
    const ranking = new Ranking([
      { user: "a", count: 1 },
      { user: "b", count: 10 },
      { user: "c", count: 5 },
    ]);
    expect(ranking.rows.map((r) => r.user)).toEqual(["b", "c", "a"]);
  });

  it("totalCount sums visible entries only", () => {
    const ranking = new Ranking([
      { user: "a", count: 5 },
      { user: "b", count: 3 },
      { user: "c", count: 0 },
    ]);
    expect(ranking.totalCount).toBe(8);
  });

  it("preserves opaque buckets metadata on each row", () => {
    const ranking = new Ranking([{ user: "a", count: 5, buckets: [1, 2, 3] }]);
    expect(ranking.rows[0]!.buckets).toEqual([1, 2, 3]);
  });

  it("missing buckets default to empty array", () => {
    const ranking = new Ranking([{ user: "a", count: 5 }]);
    expect(ranking.rows[0]!.buckets).toEqual([]);
  });

  it("passes through arbitrary user object", () => {
    const user = { login: "octocat", name: "The Octocat" };
    const ranking = new Ranking([{ user, count: 1 }]);
    expect(ranking.rows[0]!.user).toEqual(user);
  });
});
